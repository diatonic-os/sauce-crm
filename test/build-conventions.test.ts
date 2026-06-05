// Build-convention guard (regression guard for the 0.4.0 node:tls bundle break).
//
// Root cause that motivated this test: the plugin bundles for the Obsidian
// Electron *renderer* via esbuild. Node built-ins must be acquired with a
// LAZY, bare-name require at use-time (`const tls = require("tls") as typeof
// import("node:tls")`) — the pattern used by MemoryHttpServer, Pairing, and
// detectLmStudioEndpoint. A STATIC value import (`import * as tls from
// "node:tls"`) forces esbuild to resolve/bundle the builtin at module load,
// which (a) broke the production build and (b) runs native requires at plugin
// load for default-off features. Type-only imports (`import type * as tls from
// "node:tls"`) are fine — they are erased and never reach the bundler.
//
// tsc + vitest + eslint all PASS such a static import (none bundle for the
// renderer), so this test is the cheap gate that the production build would
// otherwise be the only thing to catch.

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "..", "src");

/** All non-test .ts/.svelte source files under src/. */
function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      sourceFiles(p, acc);
    } else if (
      (p.endsWith(".ts") || p.endsWith(".svelte")) &&
      !p.endsWith(".test.ts") &&
      !p.endsWith(".d.ts")
    ) {
      acc.push(p);
    }
  }
  return acc;
}

// Matches a STATIC, non-type import that pulls a `node:`-scheme builtin into
// the module's value graph. `import type ... from "node:..."` is allowed
// (erased); this regex deliberately excludes the `type` keyword.
const STATIC_NODE_VALUE_IMPORT =
  /^\s*import\s+(?!type\b)[^;]*?\bfrom\s+["']node:[^"']+["']/m;

describe("renderer bundle conventions", () => {
  it("no source file statically value-imports a node: builtin (use lazy require)", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const src = readFileSync(file, "utf8");
      // Scan line-by-line so the report names the exact import.
      for (const line of src.split("\n")) {
        if (STATIC_NODE_VALUE_IMPORT.test(line)) {
          offenders.push(`${file.replace(SRC, "src")}: ${line.trim()}`);
        }
      }
    }
    expect(
      offenders,
      `Static value imports of node: builtins force esbuild to bundle them at load.\n` +
        `Use lazy require at use-time (const x = require("name") as typeof import("node:name")) ` +
        `and keep types via 'import type'. Offenders:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});
