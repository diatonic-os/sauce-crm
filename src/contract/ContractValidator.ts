// Minimal ContractValidator — placeholder satisfying main.ts's import.
// Full contract validation lives in src/contract/LSPGate.ts (T19b).
// This class exists so older v1 code paths in main.ts continue to compile;
// invoke LSPGate directly from new code.

import { LSPViolationKind } from "./types";
import type { ContractId, LSPViolation, SubtypeReport } from "./types";

export interface ContractValidatorConfig {
  // "log" is a softer alias for "warn" used by the current settings tab.
  strictness?: "block" | "warn" | "log" | "off";
  enums?: Record<string, string[]>;
  vaultLookup?: (link: string) => Record<string, unknown> | null;
}

export class ContractValidator {
  private readonly registered = new Map<ContractId, unknown>();
  private readonly cfg: ContractValidatorConfig;

  constructor(cfg: ContractValidatorConfig = {}) {
    this.cfg = cfg;
  }

  register(id: ContractId, contract: unknown): void {
    this.registered.set(id, contract);
  }

  has(id: ContractId): boolean {
    return this.registered.has(id);
  }

  get(id: ContractId): unknown | undefined {
    return this.registered.get(id);
  }

  remove(id: ContractId): boolean {
    return this.registered.delete(id);
  }

  list(): ReadonlyArray<ContractId> {
    return Array.from(this.registered.keys());
  }

  /**
   * Structural check stub. LSPGate (T19b) is the canonical implementation;
   * this method exists so existing v1 call sites still compile. The
   * `passed` flag is a convenience for boolean call sites; equivalent to
   * `violations.length === 0`.
   */
  validate(idOrInput: ContractId | unknown): {
    passed: boolean;
    violations: LSPViolation[];
    report?: SubtypeReport;
  } {
    // Accept either a known ContractId string or arbitrary input. For
    // arbitrary input (e.g. frontmatter cache passed from main.ts) we
    // treat anything non-string as "no contract specified" → passed.
    if (typeof idOrInput !== "string") {
      return { passed: true, violations: [] };
    }
    if (!this.registered.has(idOrInput)) {
      return {
        passed: false,
        violations: [
          {
            kind: LSPViolationKind.LSP_SUBTYPE_VIOLATION,
            contract: idOrInput,
            invariant: "contract-must-be-registered",
            details: `unknown contract: ${idOrInput}`,
          } as LSPViolation,
        ],
      };
    }
    return { passed: true, violations: [] };
  }
}
