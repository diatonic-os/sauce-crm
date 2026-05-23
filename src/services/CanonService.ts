// CON-OBS-INTEG-001 · T-D-01 · DEC-002 — the canonization service.
//
// A file is "canonized" when its frontmatter carries `sauce.canonized: true`
// (+ `sauce.type: <ENT-id>`), or when a registered CanonRule matches it. A
// canonized file is a read-only graph projection — the ONLY legal write is
// mutateViaContract(), which routes through the MutationContract (ledger +
// redact + event). This class structurally satisfies the CanonGuard seam that
// FilesService/MetaService (SH-C) already depend on (G-003).

import type { MutationContract } from "./MutationContract";

export interface CanonHost {
  /** Resolved frontmatter for a path (null when absent / not markdown). */
  getFrontmatter(path: string): Record<string, unknown> | null;
  /** All markdown paths in the vault (for getCanonizedPaths). */
  listPaths(): string[];
  read(path: string): Promise<string>;
  write(path: string, content: string): Promise<void>;
  /** Write the `sauce.canonized` (+ optional `sauce.type`) frontmatter marker. */
  setCanonized(path: string, value: boolean, type?: string): Promise<void>;
}

/** A predicate that auto-canonizes paths (e.g. everything under people/). */
export type CanonRule = (
  path: string,
  frontmatter: Record<string, unknown> | null,
) => boolean;

/** Read `sauce.canonized` from either nested (`sauce: {canonized}`) or flat (`sauce.canonized`) frontmatter. */
function markerCanonized(fm: Record<string, unknown> | null): boolean {
  if (!fm) return false;
  const nested = fm.sauce as { canonized?: unknown } | undefined;
  if (nested && typeof nested === "object" && nested.canonized === true)
    return true;
  return fm["sauce.canonized"] === true;
}

export class CanonService {
  private readonly rules: CanonRule[] = [];

  constructor(
    private readonly host: CanonHost,
    private readonly mutation: Pick<MutationContract, "write">,
  ) {}

  /** Canonized iff the frontmatter marker is set OR a registered rule matches. */
  isCanonized(path: string): boolean {
    const fm = this.host.getFrontmatter(path);
    if (markerCanonized(fm)) return true;
    return this.rules.some((rule) => rule(path, fm));
  }

  getCanonizedPaths(): string[] {
    return this.host.listPaths().filter((p) => this.isCanonized(p));
  }

  registerCanonRule(rule: CanonRule): void {
    this.rules.push(rule);
  }

  /** Mark a file canonized (writes the frontmatter marker). */
  lock(path: string, type?: string): Promise<void> {
    return this.host.setCanonized(path, true, type);
  }

  unlock(path: string): Promise<void> {
    return this.host.setCanonized(path, false);
  }

  /**
   * The ONLY legal write path for a canonized file (G-003). Routes through the
   * MutationContract so every mutation is hashed into the ledger, redacted, and
   * emits an Event. Satisfies CanonGuard.mutateViaContract.
   */
  async mutateViaContract(
    path: string,
    mutator: (prev: string) => string,
  ): Promise<void> {
    const fm = this.host.getFrontmatter(path);
    const type =
      (fm?.sauce as { type?: string } | undefined)?.type ??
      String(fm?.["sauce.type"] ?? "unknown");
    await this.mutation.write({
      entityId: path,
      entityType: type,
      action: "update",
      delta: { path },
      apply: async () => {
        const prev = await this.host.read(path);
        await this.host.write(path, mutator(prev));
      },
    });
  }
}
