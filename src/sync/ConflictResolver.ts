// SPEC §34.3 — vault wins | external wins | latest wins | prompt.
export type ConflictPolicy =
  | "vault_wins"
  | "external_wins"
  | "latest_wins"
  | "prompt";
export interface ConflictRecord {
  entityId: string;
  integration: string;
  vault: { mtime: number; payload: unknown };
  external: { mtime: number; payload: unknown };
}
export interface Resolution {
  winner: "vault" | "external" | "prompt";
  payload: unknown;
}

export interface ConflictPromptHost {
  prompt(c: ConflictRecord): Promise<"vault" | "external">;
}

export class ConflictResolver {
  constructor(private readonly host: ConflictPromptHost) {}
  async resolve(
    c: ConflictRecord,
    policy: ConflictPolicy,
  ): Promise<Resolution> {
    switch (policy) {
      case "vault_wins":
        return { winner: "vault", payload: c.vault.payload };
      case "external_wins":
        return { winner: "external", payload: c.external.payload };
      case "latest_wins":
        return c.vault.mtime >= c.external.mtime
          ? { winner: "vault", payload: c.vault.payload }
          : { winner: "external", payload: c.external.payload };
      case "prompt": {
        const w = await this.host.prompt(c);
        return {
          winner: w,
          payload: w === "vault" ? c.vault.payload : c.external.payload,
        };
      }
      default: {
        const _exhaustive: never = policy;
        throw new Error(`unhandled: ${String(_exhaustive)}`);
      }
    }
  }
}
