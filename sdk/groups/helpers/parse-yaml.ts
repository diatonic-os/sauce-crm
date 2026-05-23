// SDK helper — source: sdk/groups/helpers/parse-yaml.md | api_version: 1.8.0 | gen_hash: hand-0006
//
// Wrap Obsidian's YAML engine so the SDK uses the host's exact dialect.

import { parseYaml as obsidianParseYaml, stringifyYaml as obsidianStringifyYaml } from 'obsidian';

/** Parse YAML using Obsidian's engine; caller asserts the shape via T. */
export function parseYaml<T = unknown>(src: string): T {
  return obsidianParseYaml(src) as T;
}

/** Serialize a value to YAML using Obsidian's engine. */
export function stringifyYaml(value: unknown): string {
  return obsidianStringifyYaml(value);
}
