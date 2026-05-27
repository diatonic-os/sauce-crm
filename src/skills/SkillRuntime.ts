// SPEC §20 — Skill runtime. Wraps sibling's pure SkillRegistry with:
//   - SkillCtx adapter (calls into Copilot for LLM-backed skills; into vault APIs for structural ones)
//   - Autonomy gate (propose | confirm-each | confirm-bulk | autonomous)
//   - Mutation-threshold downgrade (default 5 entities force confirm-bulk)
//   - ToolUseAdapter binding (every enabled skill exposed to the copilot)

import { App, Notice } from "obsidian";
import {
  SkillRegistry,
  Skill,
  SkillCtx,
  SkillResult,
  AutonomyLevel,
} from "./index";
import { SauceBotRuntime } from "../saucebot/SauceBotRuntime";
import { ToolUseAdapter } from "../saucebot/ToolUseAdapter";
import { EntityService } from "../services/EntityService";
import { SearchService } from "../services/SearchService";
import { QueryService } from "../services/QueryService";
import { runPath } from "../query/PathQuery";
import type { TranscriptionProvider } from "../services/transcribe/TranscriptionProvider";

export interface SkillRunOptions {
  autonomyOverride?: AutonomyLevel;
  agentId?: string;
  providerHint?: string;
  /** Set to "scheduled" when invoked by SkillTaskScheduler (S3/S5). */
  trigger?: "manual" | "scheduled" | "chat" | "command";
  /** Task ID that triggered this run (populated by SkillTaskScheduler). */
  taskId?: string;
}

export class SkillRuntime {
  readonly registry: SkillRegistry;
  private mutationThreshold = 5;

  constructor(
    private app: App,
    private entities: EntityService,
    private search: SearchService,
    private query: QueryService,
    private copilot: () => SauceBotRuntime | null,
  ) {
    this.registry = new SkillRegistry();
  }

  /** Local/cloud STT engine for the `transcribe` skill (S8). Null until wired
   *  at onload (desktop) — dispatch reports a clear "not configured" otherwise. */
  private transcriber: TranscriptionProvider | null = null;
  setTranscriber(t: TranscriptionProvider | null): void {
    this.transcriber = t;
  }

  /** Durable audit sink for ctx.audit (S7). Null until wired at onload — when
   *  set, skill runs are recorded to the HMAC-chained LanceAuditStore; when
   *  unset, ctx.audit falls back to a console line. */
  private auditSink:
    | ((
        op: string,
        entityId: string | null,
        details: Record<string, unknown>,
      ) => Promise<void>)
    | null = null;
  setAuditSink(fn: SkillRuntime["auditSink"]): void {
    this.auditSink = fn;
  }

  list(): Skill[] {
    return this.registry.list();
  }
  enabled(): Skill[] {
    return this.registry.enabled();
  }
  get(id: string): Skill | undefined {
    return this.registry.get(id);
  }

  /**
   * Register every enabled skill as a Copilot tool. Re-call on settings change.
   */
  bindToCopilot(toolUse: ToolUseAdapter): void {
    for (const s of this.list()) toolUse.unregister(s.id);
    for (const s of this.enabled()) {
      toolUse.register({
        id: s.id,
        description: s.description,
        contract: {
          inputs: s.contract.inputs.map((i) => ({
            name: i.name,
            type: i.type,
            ...(i.description !== undefined && { description: i.description }),
            ...(i.required !== undefined && { required: i.required }),
          })),
          level: s.contract.level,
        },
        execute: async (args) => {
          const r = await this.run(s.id, args);
          return r;
        },
      });
    }
  }

  async run(
    id: string,
    args: Record<string, unknown>,
    opts: SkillRunOptions = {},
  ): Promise<SkillResult> {
    const skill = this.registry.get(id);
    if (!skill) return { ok: false, reason: `unknown skill ${id}` };
    const skillCfg = this.registry.getSettings(id);
    if (!skillCfg.enabled) return { ok: false, reason: `skill ${id} disabled` };

    const autonomy: AutonomyLevel = opts.autonomyOverride ?? skillCfg.autonomy;
    const resolvedProviderHint = opts.providerHint ?? skillCfg.providerOverride;
    const ctx: SkillCtx = {
      autonomy,
      agentId: opts.agentId ?? "$user/_default-A1",
      ...(resolvedProviderHint !== undefined && { providerHint: resolvedProviderHint }),
      call: <T>(serviceId: string, callArgs: unknown) =>
        this.dispatch<T>(serviceId, callArgs ?? args),
      audit: async (op, entityId, details) => {
        // S7: record to the durable HMAC-chained audit store when wired;
        // best-effort, falling back to a console line so a sink failure never
        // breaks a skill run.
        const enriched = { ...details, skill: id };
        if (this.auditSink) {
          try {
            await this.auditSink(op, entityId, enriched);
            return;
          } catch {
            /* fall through to console */
          }
        }
        // eslint-disable-next-line no-restricted-syntax -- fallback when no audit sink is wired
        console.log("Sauce skill audit", { op, entityId, ...enriched });
      },
      scope: {
        require: (integration: string, scope: string) => {
          // P15 → check ScopeRegistry; for now permissive
          void integration;
          void scope;
        },
      },
    };

    let result: SkillResult;
    try {
      result = await skill.execute(args, ctx);
    } catch (e: unknown) {
      result = { ok: false, reason: `skill threw: ${e instanceof Error ? e.message : String(e)}` };
    }

    // P15: push every run into the in-memory ring buffer for the Skill Run Log view.
    // Lazy-import to avoid a static cycle (the view imports back into the runtime indirectly).
    try {
      const { skillRunRing } = await import("../ui/views/v2/SkillRunLogView");
      skillRunRing.push({
        ts: Date.now(),
        skillId: id,
        ok: result.ok,
        ...(result.ok ? {} : { reason: result.reason }),
        mutatedCount: result.ok ? result.mutated.length : 0,
      });
    } catch {
      /* ring is best-effort */
    }

    // Mutation threshold gate: if a successful run mutated more than the threshold,
    // and autonomy was 'autonomous', surface a notice that the threshold was exceeded.
    if (
      result.ok &&
      autonomy === "autonomous" &&
      result.mutated.length > this.mutationThreshold
    ) {
      new Notice(
        `Skill ${id} mutated ${result.mutated.length} entities — exceeded threshold, surfacing for review.`,
      );
    }
    return result;
  }

  /**
   * Per-skill dispatch table. Each skill's `ctx.call(serviceId, args)` lands here.
   * Skills that need LLM grounding route through SauceBotRuntime.ask().
   * Skills that are structural use direct vault/query APIs.
   */
  private async dispatch<T>(serviceId: string, args: unknown): Promise<T> {
    const a = (args ?? {}) as Record<string, unknown>;
    switch (serviceId) {
      case "research-person":
      case "research-org":
      case "draft-touch":
      case "summarize-thread":
      case "summarize-week":
      case "review-changes":
        return (await this.runLlm(serviceId, a)) as T;

      case "route-introduction":
        return this.routeIntroduction(a) as T;

      case "infer-edges":
        return this.inferEdges() as T;

      case "merge-duplicates":
        return this.mergeDuplicates() as T;

      case "export-graph":
        return this.exportGraph() as T;

      case "transcribe":
        return (await this.runTranscribe(a)) as T;

      case "geocode":
      case "capture-call":
      case "schedule-touch":
      case "import-contacts":
      case "verify-email":
        // External integrations — wired in P11/P12. Return a structured "pending" payload.
        return {
          pending: serviceId,
          reason: "external integration not yet wired (P11/P12)",
        } as T;

      default:
        return { pending: serviceId, reason: "unhandled serviceId" } as T;
    }
  }

  private async runLlm(
    skillId: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const copilot = this.copilot();
    if (!copilot) return { error: "copilot not initialized" };
    const skill = this.registry.get(skillId);
    const prompt = renderSkillPrompt(skillId, args, skill);
    let text = "";
    for await (const ev of copilot.ask(prompt)) {
      if (ev.type === "text") text += ev.delta;
      if (ev.type === "done" && ev.reason === "error")
        return { error: ev.error ?? "unknown" };
    }
    return { text };
  }

  /** S8: run the configured transcription engine on an audio file path. */
  private async runTranscribe(args: Record<string, unknown>): Promise<unknown> {
    if (!this.transcriber)
      return {
        pending: "transcribe",
        reason: "no transcription engine configured (desktop only)",
      };
    const path = String(
      args.audio_path ?? args.path ?? args.file ?? args.audio ?? "",
    );
    if (!path)
      return { error: "transcribe: missing audio path (pass `audio_path`)" };
    try {
      const transcribeOpts = {
        ...(args.language ? { language: String(args.language) } : {}),
        ...(args.model ? { model: String(args.model) } : {}),
      };
      const r = await this.transcriber.transcribe(path, transcribeOpts);
      return { text: r.text, language: r.language, durationMs: r.durationMs };
    } catch (e) {
      return {
        error: `transcribe failed: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  }

  private routeIntroduction(args: Record<string, unknown>): {
    path: string[] | null;
    metric: number | null;
    from?: string;
    to?: string;
    error?: string;
  } {
    const from = String(args.from ?? args.a ?? "");
    const to = String(args.to ?? args.b ?? "");
    if (!from || !to)
      return { path: null, metric: null, error: "missing from/to" };
    const nodes = this.query.collectNodeBasenames();
    const edges = this.query.collectAdjacency();
    const r = runPath(nodes, edges, from, to, ["knows", "worked_with"], {
      mode: "MAXIMIZE",
      metric: "warmth",
    });
    if (!r) return { path: null, metric: null, from, to };
    return { path: r.nodes, metric: r.metric, from, to };
  }

  private inferEdges(): {
    proposals: {
      from: string;
      to: string;
      edge: string;
      confidence: number;
      reason: string;
    }[];
  } {
    // Heuristic: co-attendance in touches → 'knows' proposal between attendees (excluding contact).
    const proposals: {
      from: string;
      to: string;
      edge: string;
      confidence: number;
      reason: string;
    }[] = [];
    const seen = new Set<string>();
    for (const t of this.entities.allTouches()) {
      const fm = t.frontmatter as Record<string, unknown>;
      const attendees = Array.isArray(fm.attendees)
        ? fm.attendees
        : [];
      const names: string[] = attendees.map(
        (a: unknown) =>
          String(a)
            .replace(/\[\[|\]\]/g, "")
            .split("|")[0] ?? "",
      );
      for (let i = 0; i < names.length; i++) {
        for (let j = i + 1; j < names.length; j++) {
          // provably defined: i < names.length, j < names.length
          const ni = names[i]!;
          const nj = names[j]!;
          const key = ni < nj ? `${ni}|${nj}` : `${nj}|${ni}`;
          if (seen.has(key)) continue;
          seen.add(key);
          proposals.push({
            from: ni,
            to: nj,
            edge: "knows",
            confidence: 0.6,
            reason: `co-attended ${t.file.basename}`,
          });
        }
      }
    }
    return { proposals };
  }

  private mergeDuplicates(): {
    candidates: {
      a: string;
      b: string;
      similarity: number;
      reasons: string[];
    }[];
  } {
    const out: {
      a: string;
      b: string;
      similarity: number;
      reasons: string[];
    }[] = [];
    const people = this.entities.allPeople();
    for (let i = 0; i < people.length; i++) {
      for (let j = i + 1; j < people.length; j++) {
        // provably defined: i < people.length, j < people.length
        const a = people[i]!;
        const b = people[j]!;
        const reasons: string[] = [];
        const afm = a.frontmatter as Record<string, unknown>;
        const bfm = b.frontmatter as Record<string, unknown>;
        const aEmail = String(afm.email ?? "").toLowerCase();
        const bEmail = String(bfm.email ?? "").toLowerCase();
        if (aEmail && aEmail === bEmail) reasons.push("email match");
        const aLi = String(afm.linkedin ?? "");
        const bLi = String(bfm.linkedin ?? "");
        if (aLi && aLi === bLi) reasons.push("linkedin match");
        const aBn = a.file.basename.toLowerCase().replace(/[^a-z]/g, "");
        const bBn = b.file.basename.toLowerCase().replace(/[^a-z]/g, "");
        if (aBn === bBn && aBn) reasons.push("name match");
        if (reasons.length > 0)
          out.push({
            a: a.file.basename,
            b: b.file.basename,
            similarity: reasons.length / 3,
            reasons,
          });
      }
    }
    return { candidates: out.sort((x, y) => y.similarity - x.similarity) };
  }

  private exportGraph(): { entities: number; edges: number; pathHint: string } {
    return {
      entities:
        this.entities.allPeople().length + this.entities.allOrgs().length,
      edges: this.query.collectAdjacency().length,
      pathHint: "Run `Sauce: Export Graph JSON` command to write to disk.",
    };
  }
}

function renderSkillPrompt(
  skillId: string,
  args: Record<string, unknown>,
  skill: Skill | undefined,
): string {
  const argList = Object.entries(args)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    .join("\n");
  const desc = skill?.description ?? skillId;
  return `Skill: ${skillId}\n${desc}\n\nInputs:\n${argList}\n\nReturn a concise structured response. If proposing changes, list them as a bulleted plan.`;
}
