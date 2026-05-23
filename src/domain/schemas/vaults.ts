// CON-OBS-INTEG-001 · T-E-01 · ENT-vaults — predicate schema (no Zod).

import {
  type EntitySchema,
  type ValidationError,
  isString,
  isStringArray,
} from "./index";

export interface VaultFrontmatter extends Record<string, unknown> {
  type: "vault";
  name: string;
  path: string;
  sauceVersion?: string;
  communityPlugins?: string[];
  corePlugins?: string[];
  canonized?: boolean;
}

export const VaultSchema: EntitySchema<VaultFrontmatter> = {
  type: "vault",
  description:
    "A registered Obsidian vault and its Sauce/plugin configuration.",
  defaultFrontmatter: () => ({
    type: "vault",
    name: "",
    path: "",
    communityPlugins: [],
    corePlugins: [],
  }),
  validate(fm) {
    const e: ValidationError[] = [];
    if (fm.type !== "vault")
      e.push({ field: "type", message: 'expected "vault"', severity: "error" });
    if (!isString(fm.name))
      e.push({
        field: "name",
        message: "name must be a string",
        severity: "error",
      });
    if (!isString(fm.path))
      e.push({
        field: "path",
        message: "path must be a string",
        severity: "error",
      });
    for (const k of ["communityPlugins", "corePlugins"] as const) {
      if (k in fm && !isStringArray(fm[k]))
        e.push({
          field: k,
          message: `${k} must be string[]`,
          severity: "error",
        });
    }
    return {
      passed: e.filter((x) => x.severity === "error").length === 0,
      errors: e,
    };
  },
  parse(fm) {
    return this.validate(fm).passed ? (fm as VaultFrontmatter) : null;
  },
};
