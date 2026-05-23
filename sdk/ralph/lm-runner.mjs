#!/usr/bin/env node
// LM Studio ralph runner — drives a local Qwen model to implement the remaining
// Phase-1 SDK members, gated by typecheck + vitest. Resumable: skips members
// whose .ts already exists, so re-running continues where it left off.
//
// Usage:
//   MODEL="qwen/qwen2.5-coder-14b" node sdk/ralph/lm-runner.mjs
//   MODEL="qwen/qwen3.5-9b" MAX_RETRIES=5 node sdk/ralph/lm-runner.mjs
//
// SECURITY: all process calls use execFileSync with argument arrays (no shell),
// and member group/id are validated against /^[a-z0-9-]+$/ before use — so
// member-derived strings are never parsed by a shell (no command injection).
// Correctness is guaranteed by the gate (nothing red is committed); a member the
// model can't get green within MAX_RETRIES is logged to BLOCKERS.md and skipped.

import { readFileSync, writeFileSync, existsSync, rmSync, appendFileSync, mkdirSync } from 'fs';
import { execFileSync } from 'node:child_process';
import { dirname } from 'path';

const ROOT = process.cwd();
const BASE = process.env.LMS_URL || 'http://localhost:1234/v1';
const MODEL = process.env.MODEL || 'qwen/qwen2.5-coder-14b';
const MAX_RETRIES = Number(process.env.MAX_RETRIES || 4);
const TEMP = Number(process.env.TEMP || 0.15);
const SAFE = /^[a-z0-9-]+$/;

const groupsDir = `${ROOT}/sdk/groups`;
const mPath = (m, ext) => `${groupsDir}/${m.group}/${m.id}.${ext}`;

// No shell: execFile with an argv array. Returns combined stdout; throws on nonzero.
function run(cmd, args) {
  return execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}
function gate(testFile) {
  for (const [stage, cmd, args] of [
    ['typecheck', 'npm', ['run', '--silent', 'typecheck']],
    ['test', 'npx', ['vitest', 'run', testFile]],
  ]) {
    try {
      run(cmd, args);
    } catch (e) {
      return { ok: false, stage, log: (e.stdout || '') + (e.stderr || '') };
    }
  }
  return { ok: true };
}

async function chat(messages) {
  const res = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, messages, temperature: TEMP, max_tokens: 4000, stream: false }),
  });
  if (!res.ok) throw new Error(`LM Studio ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return json.choices?.[0]?.message?.content ?? '';
}

// Extract ===FILE: path=== ... ===END=== blocks; strip stray ``` fences.
function parseFiles(text) {
  const out = {};
  const re = /===FILE:\s*(.+?)\s*===\s*\n([\s\S]*?)\n===END===/g;
  let m;
  while ((m = re.exec(text))) {
    const body = m[2].replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```\s*$/, '');
    out[m[1].trim()] = body.endsWith('\n') ? body : body + '\n';
  }
  return out;
}

function buildPrompt(member, retryLog) {
  const ex = member.mirror;
  const exMd = readFileSync(`${groupsDir}/${ex}.md`, 'utf8');
  const exTs = readFileSync(`${groupsDir}/${ex}.ts`, 'utf8');
  const exTest = readFileSync(`${groupsDir}/${ex}.test.ts`, 'utf8');
  const contract = readFileSync(`${ROOT}/sdk/CONTRACT.md`, 'utf8').slice(0, 2600);
  const mdPath = `sdk/groups/${member.group}/${member.id}.md`;
  const tsPath = `sdk/groups/${member.group}/${member.id}.ts`;
  const testPath = `sdk/groups/${member.group}/${member.id}.test.ts`;

  const sys =
    'You implement one Sauce CRM SDK member as exactly three files. Mirror the EXAMPLE member structure precisely. ' +
    'Output ONLY three blocks in this exact format, no prose:\n' +
    `===FILE: ${mdPath}===\n<frontmatter contract>\n===END===\n` +
    `===FILE: ${tsPath}===\n<typescript impl>\n===END===\n` +
    `===FILE: ${testPath}===\n<vitest test>\n===END===\n` +
    'Rules: deterministic (no Date.now/wall-clock in logic); imports resolve to existing sdk modules or "obsidian"; ' +
    'the .ts must pass `tsc -noEmit`; the test must pass `vitest run`; obsidian.Plugin/Vault/etc are abstract so ' +
    'instantiate via `new (X as unknown as { new(): X })()`; TFile.contents is stub-only (cast to read it). ' +
    'If obsidian_api is not "none", add a test asserting hasApiSymbol("<symbol>") imported from "../../generated/api-catalog".';

  const user =
    `CONTRACT (excerpt):\n${contract}\n\n` +
    `EXAMPLE member ${ex}:\n` +
    `--- ${ex}.md ---\n${exMd}\n--- ${ex}.ts ---\n${exTs}\n--- ${ex}.test.ts ---\n${exTest}\n\n` +
    `NOW IMPLEMENT member:\n` +
    `group=${member.group} id=${member.id} platform=${member.platform} obsidian_api=${member.obsidian_api}\n` +
    `summary: ${member.summary}\n` +
    (retryLog ? `\nYOUR PREVIOUS ATTEMPT FAILED THE GATE. Fix these errors:\n${retryLog.slice(0, 2500)}\n` : '');

  return [
    { role: 'system', content: sys },
    { role: 'user', content: user },
  ];
}

async function doMember(member) {
  if (!SAFE.test(member.group) || !SAFE.test(member.id)) {
    console.log(`SKIP invalid member id/group: ${member.group}/${member.id}`);
    return 'blocked';
  }
  const mdP = mPath(member, 'md');
  const tsP = mPath(member, 'ts');
  const testP = mPath(member, 'test.ts');
  const rel = `sdk/groups/${member.group}/${member.id}`;
  if (existsSync(tsP)) {
    console.log(`SKIP ${member.group}/${member.id} (exists)`);
    return 'skip';
  }
  let retryLog = '';
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    console.log(`\n[${member.group}/${member.id}] attempt ${attempt}/${MAX_RETRIES} via ${MODEL}`);
    let content;
    try {
      content = await chat(buildPrompt(member, retryLog));
    } catch (e) {
      console.log(`  API error: ${e.message}`);
      retryLog = String(e.message);
      continue;
    }
    const files = parseFiles(content);
    const want = [`${rel}.md`, `${rel}.ts`, `${rel}.test.ts`];
    if (!want.every((w) => files[w])) {
      console.log(`  bad output (missing: ${want.filter((w) => !files[w]).join(', ')})`);
      retryLog = `Output must contain all three ===FILE: ...=== blocks for ${want.join(', ')}.`;
      continue;
    }
    mkdirSync(dirname(tsP), { recursive: true });
    for (const w of want) writeFileSync(`${ROOT}/${w}`, files[w]);
    const g = gate(`${rel}.test.ts`);
    if (g.ok) {
      run('npm', ['run', '--silent', 'sdk:gen']);
      run('git', ['add', mdP, tsP, testP, 'sdk/REGISTRY.md']);
      run('git', ['commit', '-q', '-m', `feat(sdk/${member.group}): ${member.id} — via ${MODEL} (gated)`]);
      console.log(`  ✓ COMMITTED ${member.group}/${member.id}`);
      return 'done';
    }
    console.log(`  ✗ gate failed at ${g.stage}`);
    retryLog = `[${g.stage}]\n${g.log}`;
    for (const w of want) rmSync(`${ROOT}/${w}`, { force: true }); // revert failed attempt
  }
  appendFileSync(
    `${ROOT}/sdk/ralph/BLOCKERS.md`,
    `- ${member.group}/${member.id}: gate failed after ${MAX_RETRIES} attempts (${MODEL}).\n\n\`\`\`\n${retryLog.slice(0, 1200)}\n\`\`\`\n\n`,
  );
  console.log(`  ⚠ BLOCKED ${member.group}/${member.id} → BLOCKERS.md`);
  return 'blocked';
}

async function main() {
  const queue = JSON.parse(readFileSync(`${ROOT}/sdk/ralph/queue.json`, 'utf8')).members;
  const tally = { done: 0, skip: 0, blocked: 0 };
  console.log(`LM runner: ${queue.length} members, model=${MODEL}, maxRetries=${MAX_RETRIES}`);
  for (const member of queue) {
    const r = await doMember(member);
    tally[r] = (tally[r] || 0) + 1;
  }
  console.log(`\n=== DONE: committed=${tally.done} skipped=${tally.skip} blocked=${tally.blocked} ===`);
}

main().catch((e) => {
  console.error('runner fatal:', e);
  process.exit(1);
});
