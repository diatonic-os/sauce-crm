#!/usr/bin/env node
/*
 * install-to-vault.mjs — build the plugin from source and install it into a
 * target Obsidian vault. Used to seed a client vault before the plugin is in
 * the community store.
 *
 * Usage:
 *   node scripts/install-to-vault.mjs "/path/to/ClientVault"
 *   OBSIDIAN_VAULT="/path/to/ClientVault" node scripts/install-to-vault.mjs
 *
 * Or via npm (note the `--` so the path reaches this script, not npm):
 *   npm run install:vault -- "/path/to/ClientVault"
 *
 * Pass --no-build to skip the build and just copy the existing artifacts.
 */
import { execSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const PLUGIN_ID = "sauce-crm"; // must match manifest.json "id"
const ARTIFACTS = ["main.js", "manifest.json", "styles.css", "versions.json"];

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const argv = process.argv.slice(2);
const skipBuild = argv.includes("--no-build");
const vaultArg = argv.find((a) => !a.startsWith("--")) || process.env.OBSIDIAN_VAULT;

if (!vaultArg) {
  console.error(
    "✗ No vault path given.\n" +
      '  Usage: npm run install:vault -- "/path/to/ClientVault"\n' +
      "  (the vault is the folder you open in Obsidian — the one that contains .obsidian/)",
  );
  process.exit(1);
}

const vault = resolve(vaultArg);
if (!existsSync(vault) || !statSync(vault).isDirectory()) {
  console.error(`✗ Vault folder does not exist: ${vault}`);
  process.exit(1);
}

const obsidianDir = join(vault, ".obsidian");
if (!existsSync(obsidianDir)) {
  // .obsidian only appears once Obsidian has opened the folder at least once.
  console.warn(
    `! ${vault} has no .obsidian/ yet — open it once in Obsidian as a vault, then re-run.\n` +
      "  (Creating the folder anyway so the files are staged.)",
  );
}

if (!skipBuild) {
  console.log("→ Building plugin from source (npm run build)…");
  execSync("npm run build", { cwd: repoRoot, stdio: "inherit" });
}

const destDir = join(obsidianDir, "plugins", PLUGIN_ID);
mkdirSync(destDir, { recursive: true });

let copied = 0;
for (const f of ARTIFACTS) {
  const src = join(repoRoot, f);
  if (!existsSync(src)) {
    // versions.json/styles.css should always exist; main.js requires a build.
    console.warn(`! Skipping missing artifact: ${f}`);
    continue;
  }
  copyFileSync(src, join(destDir, f));
  copied++;
}

if (copied === 0) {
  console.error("✗ Nothing copied — did the build fail? Run `npm run build` and retry.");
  process.exit(1);
}

console.log(`✓ Installed ${copied} files to ${destDir}`);
console.log(
  "→ In Obsidian: Settings → Community plugins → enable “SauceOM”.\n" +
    "  (If Community plugins are off, toggle off Restricted/Safe mode first.\n" +
    "   If the plugin was already enabled, run Cmd/Ctrl-P → “Reload app without saving”.)",
);
