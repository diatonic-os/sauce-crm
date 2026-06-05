// sauce-crm-daemon · esbuild bundle config.
//
// Produces a single CommonJS bundle the operator runs with bare `node`:
//   dist/sauce-crm-daemon.cjs
//
// Constants (FIXED): platform=node, format=cjs, target=node18.
// EXTERNAL: @lancedb/lancedb ONLY — the native N-API addon must stay external
// and is resolved at runtime from the shared central runtime install
// (<app.data.user>/sauce-crm/runtime/node_modules), exactly like the plugin.

import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const production = process.argv.includes("production");

await build({
  entryPoints: [resolve(here, "src/index.ts")],
  outfile: resolve(here, "dist/sauce-crm-daemon.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node18",
  // The native LanceDB addon is the ONLY external. Everything else (the plugin
  // src/** we import, apache-arrow types are type-only) is bundled in.
  external: ["@lancedb/lancedb"],
  sourcemap: production ? false : "inline",
  minify: production,
  logLevel: "info",
  // A shebang so the bundle is directly executable if chmod +x'd.
  banner: { js: "#!/usr/bin/env node" },
});

process.stdout.write("daemon: built dist/sauce-crm-daemon.cjs\n");
