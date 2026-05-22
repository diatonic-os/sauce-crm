// scripts/lint-labels.mjs
import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";
import { fileURLToPath } from "url";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const SRC = join(ROOT, "src");

// Mirror of src/settings/copy/LabelTranslation.ts (kept in sync manually for the lint).
const TECHNICAL_TERMS = [
  "p_adm", "Cms", "Contract strictness", "Federation policy", "LSP validation",
  "Semiring", "Inference confidence", "Autonomy level", "Frame condition",
  "Pre/post-condition", "ρ_adm", "HMAC chain", "Argon2id", "PKCE",
];
const ALLOWLIST = new Set([
  "General", "Vault", "Validation", "Copilot", "Skills", "Integrations", "Data", "Advanced",
  "Provider", "Model", "Temperature", "API key", "Base URL", "Cadence", "Tags",
  "Backup", "Export", "Import", "Sync", "Map", "Audit log", "Skill run log",
  "Master password", "Auto-lock", "Telemetry", "Diagnostics", "About",
  "Google", "Microsoft", "Apple", "Notion", "Twilio", "Email", "Web Search",
  "Person", "Org", "Touch", "Addendum",
]);

function* walk(dir) {
  for (const ent of readdirSync(dir)) {
    const p = join(dir, ent);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (p.endsWith(".ts")) yield p;
  }
}

function findCalls(src, fnSuffix) {
  // find every `.setName("...")` literal — scans without regex.
  const needle = `.${fnSuffix}(`;
  const out = [];
  let i = 0;
  while (i < src.length) {
    const at = src.indexOf(needle, i);
    if (at === -1) break;
    let j = at + needle.length;
    // skip whitespace
    while (j < src.length && (src[j] === " " || src[j] === "\n")) j++;
    if (src[j] !== '"' && src[j] !== "'") { i = j; continue; }
    const q = src[j]; j++;
    let val = "";
    while (j < src.length && src[j] !== q) {
      if (src[j] === "\\" && j + 1 < src.length) { val += src[j + 1]; j += 2; continue; }
      val += src[j]; j++;
    }
    out.push({ line: (src.slice(0, at).match(/\n/g) || []).length + 1, value: val });
    i = j + 1;
  }
  return out;
}

let violations = 0;
const files = [...walk(SRC)];
for (const file of files) {
  // skip the label-translation fixtures themselves
  if (file.includes("LabelTranslation") || file.includes("empty-states")) continue;
  const src = readFileSync(file, "utf-8");
  for (const call of findCalls(src, "setName")) {
    const val = call.value;
    if (ALLOWLIST.has(val)) continue;
    for (const t of TECHNICAL_TERMS) {
      if (val === t || val.includes(t)) {
        console.error(`${relative(ROOT, file)}:${call.line}  setName("${val}") uses technical term "${t}" without translation`);
        violations++;
      }
    }
  }
}

if (violations > 0) { console.error(`\nlint-labels: ${violations} violation(s)`); process.exit(1); }
console.log(`lint-labels: ${files.length} files scanned, 0 violations`);
