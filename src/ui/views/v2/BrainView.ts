/* Sauce Brain — hosts the Enterprise Brain standalone builds inside Obsidian.
 *
 * Folded in from the `sauce-brain` prototype. The brain is a fully self-
 * contained offline HTML file (React, fonts, data inlined) copied into the
 * vault's `_brain/` folder. This view iframes whichever builds it finds there —
 * one file loads directly, several get a tenant picker. No network, no server,
 * no write path: read-only by construction.
 *
 * The live "Ask" bridge is wired to THIS plugin's SauceBotRuntime (whatever
 * provider is configured — LM Studio / Anthropic / …) rather than the
 * prototype's `claude -p` spawn, so it shares model-switching, credentials,
 * health checks, and the citation/honesty contract. See SauceBotRuntime.
 * askBrainStructured + BrainAsk.ts.
 */
import { ItemView, Notice, WorkspaceLeaf, normalizePath } from "obsidian";
import { type ViewTypeId, asViewTypeId } from "@/types/brands";
import type SauceGraphPlugin from "../../../main";
import { SauceViewHelp } from "../../components/v2/SauceViewHelp";

export const VIEW_BRAIN: ViewTypeId = asViewTypeId("sauce-brain");

const DEFAULT_BRAIN_FOLDER = "_brain";

export class BrainView extends ItemView {
  current: string | null = null; // vault-relative path of the loaded build
  private iframe: HTMLIFrameElement | null = null;
  private inflight = false;
  private help!: SauceViewHelp;

  constructor(
    leaf: WorkspaceLeaf,
    public plugin: SauceGraphPlugin,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_BRAIN;
  }
  getDisplayText(): string {
    return "Sauce Brain";
  }
  override getIcon(): string {
    return "brain-circuit";
  }

  private get brainFolder(): string {
    return this.plugin.settings.brainFolder?.trim() || DEFAULT_BRAIN_FOLDER;
  }

  override async onOpen(): Promise<void> {
    this.addAction("rotate-cw", "Reload brain (after rebuild)", () =>
      this.loadCurrent(),
    );
    this.registerDomEvent(window, "message", (e: MessageEvent) =>
      this.onBridgeMessage(e),
    );
    await this.render();
  }

  override async onClose(): Promise<void> {
    this.inflight = false;
  }

  /* ---- Ask bridge ------------------------------------------------------- */
  // Outbound targetOrigin is the PARENT origin, not a wildcard: the build is
  // loaded via `srcdoc`, so the child frame inherits this window's origin
  // (app://obsidian.md). Targeting it precisely means a message is only ever
  // delivered to our own same-origin frame — no cross-origin disclosure. The
  // inbound `e.source` check below is the second gate.
  private postToIframe(msg: unknown): void {
    this.iframe?.contentWindow?.postMessage(msg, window.location.origin);
  }

  private onBridgeMessage(e: MessageEvent): void {
    if (!this.iframe || e.source !== this.iframe.contentWindow) return; // only OUR iframe
    const d = e.data as {
      type?: string;
      id?: string;
      q?: string;
      tenant?: string;
    };
    if (!d || typeof d !== "object") return;

    if (d.type === "sauce-brain-hello") {
      this.postToIframe({ type: "sauce-brain-ready" });
      return;
    }
    if (d.type !== "sauce-brain-ask" || typeof d.id !== "string") return;

    const fail = (error: string): void =>
      this.postToIframe({
        type: "sauce-brain-answer",
        id: d.id,
        ok: false,
        error,
      });

    if (typeof d.q !== "string" || !d.q.trim() || d.q.length > 500) {
      fail("Empty or oversized question.");
      return;
    }
    const copilot = this.plugin.copilot;
    if (!copilot) {
      fail(
        "SauceBot runtime is not initialized — open settings and configure a provider.",
      );
      return;
    }
    if (this.inflight) {
      fail("One question at a time — the brain is still thinking.");
      return;
    }

    this.inflight = true;
    const started = Date.now();
    copilot
      .askBrainStructured(d.q.trim())
      .then((answer) =>
        this.postToIframe({
          type: "sauce-brain-answer",
          id: d.id,
          ok: true,
          answer,
          elapsedMs: Date.now() - started,
        }),
      )
      .catch((err: Error) => {
        fail(err.message || "ask failed");
        new Notice(
          "Sauce Brain ask failed: " +
            (err.message || "unknown error").slice(0, 160),
        );
      })
      .finally(() => {
        this.inflight = false;
      });
  }

  /* ---- Build discovery + rendering -------------------------------------- */
  private async listBuilds(): Promise<string[]> {
    const folder = normalizePath(this.brainFolder);
    try {
      const ls = await this.app.vault.adapter.list(folder);
      return ls.files.filter((f) => f.toLowerCase().endsWith(".html")).sort();
    } catch {
      return [];
    }
  }

  private tenantLabel(p: string): string {
    const base = p.split("/").pop() ?? p;
    return (
      base
        .replace(/\.html$/i, "")
        .replace(/[-_]?brain[-_]?|standalone/gi, "")
        .replace(/[-_]+/g, " ")
        .trim() || base
    );
  }

  async render(): Promise<void> {
    const el = this.contentEl;
    el.empty();
    el.addClass("sauce-brain");

    // Branded Sauce header + toggleable help.
    this.help = new SauceViewHelp();
    this.help.mountHeader(el, {
      title: "Sauce Brain",
      icon: "brain-circuit",
      subtitle: "Read-only dashboard over your Enterprise Brain builds",
    });

    const builds = await this.listBuilds();
    if (!builds.length) {
      const empty = el.createDiv({ cls: "sauce-brain-empty" });
      empty.setText(
        `No brain builds found in ${this.brainFolder}/ — produce a standalone *.html build and drop it there, then hit reload.`,
      );
      this.help.register(
        empty,
        "Brain builds",
        "This view displays self-contained *.html brain builds from your vault's brain folder. The Ask box inside a build is answered by your configured SauceBot provider, with citations to your notes.",
      );
      return;
    }
    if (!this.current || !builds.includes(this.current))
      this.current = builds[0] ?? null;

    if (builds.length > 1) {
      const bar = el.createDiv({ cls: "sauce-brain-bar" });
      const select = bar.createEl("select", { cls: "sauce-brain-tenant" });
      this.help.register(
        select,
        "Tenant / build picker",
        "Switch between the different brain builds found in your brain folder (one per tenant or snapshot).",
      );
      for (const b of builds) {
        const opt = select.createEl("option", { text: this.tenantLabel(b) });
        opt.value = b;
        if (b === this.current) opt.selected = true;
      }
      select.addEventListener("change", () => {
        this.current = select.value;
        this.app.workspace.requestSaveLayout();
        void this.loadCurrent();
      });
    }

    this.iframe = el.createEl("iframe", { cls: "sauce-brain-frame" });
    this.help.register(
      this.iframe,
      "Brain dashboard",
      "A self-contained, offline view of your Enterprise Brain. Ask questions inside it — answers come from your configured SauceBot provider and cite real people and notes. Use the reload action (top-right) after rebuilding.",
    );
    // handshake: announce the bridge once the build loads (the UI also sends
    // hello on init — two directions so neither side can miss the race).
    this.iframe.addEventListener("load", () =>
      this.postToIframe({ type: "sauce-brain-ready" }),
    );
    void this.loadCurrent();
  }

  async loadCurrent(): Promise<void> {
    if (!this.iframe || !this.current) return;
    // srcdoc, NOT an app:// src: custom-protocol iframes report a null origin,
    // and Obsidian's main process reads frame.origin unguarded — the
    // "JavaScript error in the main process (reading 'origin')" crash. srcdoc
    // documents inherit the parent origin, so the frame is ordinary. The build
    // is fully self-contained (fonts/data inlined), so no base URL is needed.
    try {
      this.iframe.srcdoc = await this.app.vault.adapter.read(
        normalizePath(this.current),
      );
    } catch {
      this.iframe.srcdoc =
        '<body style="background:#0A0A09;color:#a09a90;font-family:sans-serif;padding:2em">' +
        "Could not read " +
        this.current +
        " — rebuild the brain and hit reload.</body>";
    }
  }

  override getState(): Record<string, unknown> {
    return { tenant: this.current };
  }

  override async setState(
    state: { tenant?: string },
    result: unknown,
  ): Promise<void> {
    if (state?.tenant) {
      this.current = state.tenant;
      await this.render();
    }
    // @ts-expect-error — ItemView.setState's result type is internal
    await super.setState(state, result);
  }
}
