import { TFile } from "obsidian";

export type ContractLevel = "nosubtype" | "subtype" | "core" | "simple" | "extended" | "full";

export interface IEntity {
  readonly file: TFile;
  readonly type: string;
  readonly subtype_of: string;
  readonly contract: ContractLevel;
  readonly frontmatter: Record<string, any>;
  readonly mutable: string[];
  readonly tags: string[];
  invariants(): InvariantDef[];
}

export interface InvariantDef {
  name: string;
  predicate: string;
}

export abstract class Entity implements IEntity {
  constructor(
    public readonly file: TFile,
    public readonly frontmatter: Record<string, any>,
  ) {}

  get type(): string { return this.frontmatter.type ?? "entity"; }
  get subtype_of(): string { return this.frontmatter.subtype_of ?? "Entity"; }
  get contract(): ContractLevel { return (this.frontmatter.contract ?? "core") as ContractLevel; }
  get mutable(): string[] { return this.frontmatter.mutable ?? []; }
  get tags(): string[] { return this.frontmatter.tags ?? []; }

  invariants(): InvariantDef[] {
    const raw = this.frontmatter.constrains ?? [];
    const out: InvariantDef[] = [];
    for (const item of raw) {
      if (typeof item === "string") out.push({ name: item, predicate: item });
      else if (typeof item === "object" && item) {
        for (const [k, v] of Object.entries(item)) {
          out.push({ name: k, predicate: String(v) });
        }
      }
    }
    return out;
  }
}

export const ENTITY_TYPES = [
  "warm-contact", "org", "subsidiary", "touch", "addendum",
  "user-agent", "sub-vault", "parent-vault", "plugin-config",
  "dashboard", "orientation", "vault-contract",
] as const;
export type EntityType = typeof ENTITY_TYPES[number];
