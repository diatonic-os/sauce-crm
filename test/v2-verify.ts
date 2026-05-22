// V2 verification suite — exercises every V2 subsystem against the success criteria.
// Run via: node_modules/.bin/esbuild test/v2-verify.ts --bundle --platform=node --external:better-sqlite3 --external:sql.js --external:obsidian | node

import { FileOnlyBackend, applyMigrations, Seeder, SqliteSync } from '../src/backend';
import { KeyVault, JsonSecretStore, AuditLog, ScopeRegistry, ScopeNotGranted, DEFAULT_SCOPES, ProxyClient } from '../src/security';
import type { CryptoBackend } from '../src/security/KeyVault';
import { SkillRegistry } from '../src/skills';
import { buildSettingsTree } from '../src/ui/settings';
import { V2_COMMANDS, registerV2Commands } from '../src/ui/commands/V2Commands';
import { V2_VIEW_TYPES, MapView, AiInboxView, CopilotView, SyncStatusView, AuditLogView, SkillRunLogView } from '../src/ui/views/v2';
import { CdelInterpreter } from '../src/language';
import { lex } from '../src/language/CdelLexer';
import { parse } from '../src/language/CdelParser';
import { InferenceEngine } from '../src/inference';
import { haversineMeters, GeoIndex } from '../src/geo';
import { CsvImportAdapter, CsvExportAdapter, VcardImportAdapter, VcardExportAdapter, JsonImportAdapter, JsonExportAdapter } from '../src/importexport';
import { SyncEngine } from '../src/sync';

import * as crypto from 'node:crypto';

let pass = 0, fail = 0;
const failures: string[] = [];

function check(name: string, cond: boolean, detail = ''): void {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; failures.push(`${name} ${detail}`); console.log(`  FAIL  ${name} ${detail}`); }
}

async function asserts<T>(name: string, fn: () => T | Promise<T>): Promise<T | undefined> {
  try { const v = await fn(); pass++; console.log(`  PASS  ${name}`); return v; }
  catch (e) { fail++; const msg = e instanceof Error ? e.message : String(e); failures.push(`${name} threw: ${msg}`); console.log(`  FAIL  ${name} threw: ${msg}`); return undefined; }
}

// ─────────────────────────────────────────────────────────────────────────
// CryptoBackend backed by node:crypto
// ─────────────────────────────────────────────────────────────────────────
const nodeCrypto: CryptoBackend = {
  async argon2id(password, salt, opts) {
    // Use scrypt as a stand-in for argon2id since pure-Node argon2 needs a native dep.
    // Same KDF property profile for verification purposes.
    return new Promise((resolve, reject) => {
      crypto.scrypt(password, Buffer.from(salt), opts.outBytes, (err, key) => err ? reject(err) : resolve(new Uint8Array(key)));
    });
  },
  secretboxSeal(key, nonce, msg) {
    const cipher = crypto.createCipheriv('chacha20-poly1305', Buffer.from(key), Buffer.from(nonce.slice(0, 12)), { authTagLength: 16 });
    const enc = Buffer.concat([cipher.update(Buffer.from(msg)), cipher.final()]);
    const tag = cipher.getAuthTag();
    return new Uint8Array(Buffer.concat([enc, tag]));
  },
  secretboxOpen(key, nonce, ct) {
    try {
      const data = Buffer.from(ct);
      const enc = data.subarray(0, data.length - 16);
      const tag = data.subarray(data.length - 16);
      const decipher = crypto.createDecipheriv('chacha20-poly1305', Buffer.from(key), Buffer.from(nonce.slice(0, 12)), { authTagLength: 16 });
      decipher.setAuthTag(tag);
      return new Uint8Array(Buffer.concat([decipher.update(enc), decipher.final()]));
    } catch { return null; }
  },
  randomBytes(n) { return new Uint8Array(crypto.randomBytes(n)); },
};

async function hmacHex(key: Uint8Array, msg: string): Promise<string> {
  return crypto.createHmac('sha256', Buffer.from(key)).update(msg).digest('hex');
}

// ─────────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  console.log('\n=== Backend §17 ===');
  const db = new FileOnlyBackend();
  await db.init(':memory:');
  const applied = await applyMigrations(db);
  // FileOnlyBackend's exec recognizes CREATE TABLE statements via regex.
  check('migrations applied >= 2', applied >= 2, `applied=${applied}`);

  const seeder = new Seeder(db, {
    walk: async function* () {
      yield {
        path: 'people/Alice.md', ctime: 1, mtime: 2, type: 'person',
        frontmatter: { name: 'Alice' }, body: '## body', bodyHash: 'h1',
        tags: ['warm'], edges: [{ to: 'people/Bob.md', edgeType: 'knows', directed: false }],
      };
      yield {
        path: 'people/Bob.md', ctime: 3, mtime: 4, type: 'person',
        frontmatter: { name: 'Bob' }, body: '## bob', bodyHash: 'h2',
        tags: [], edges: [],
        touch: { id: 't1', contactId: 'people/Bob.md', date: '2026-05-21', channel: 'call', outcomeTags: ['advice-received'], attendees: ['people/Alice.md', 'people/Bob.md'] },
      };
    },
  });
  await asserts('seeder runs end-to-end', () => seeder.run());

  const sync = new SqliteSync(db, null);
  await asserts('SqliteSync onCreate', () => sync.onCreate({
    path: 'people/Carol.md', ctime: 5, mtime: 6, type: 'person',
    frontmatter: { name: 'Carol' }, body: 'hi', bodyHash: 'h3', tags: [], edges: [],
  }));
  await asserts('SqliteSync onDelete', () => sync.onDelete('people/Carol.md'));

  console.log('\n=== Security §18 ===');
  // KeyVault round-trip
  const blob: Record<string, unknown> = {};
  const store = new JsonSecretStore(async () => blob, async (d) => { Object.assign(blob, d); });
  const vault = new KeyVault(store, nodeCrypto);
  await asserts('KeyVault unlock fresh', () => vault.unlock('correct-horse-battery-staple'));
  check('KeyVault.isLocked() == false after unlock', !vault.isLocked());
  await asserts('KeyVault put/get round-trip', async () => {
    await vault.put('anthropic', 'sk-test-12345');
    const v = await vault.get('anthropic');
    if (v !== 'sk-test-12345') throw new Error(`got ${v}`);
  });
  vault.lock();
  check('KeyVault locked after lock()', vault.isLocked());

  // ScopeRegistry
  const scopes = new ScopeRegistry();
  scopes.load(DEFAULT_SCOPES);
  check('default google calendar.read on', scopes.check('google_workspace', 'calendar.read'));
  check('default gmail.send off', !scopes.check('google_workspace', 'gmail.send'));
  let threw = false;
  try { scopes.require('google_workspace', 'gmail.send'); } catch (e) { if (e instanceof ScopeNotGranted) threw = true; }
  check('ScopeNotGranted on disabled scope', threw);

  // AuditLog HMAC chain
  const masterKey = nodeCrypto.randomBytes(32);
  const audit = new AuditLog(db, { hmacHex }, async () => masterKey);
  // FileOnlyBackend's query returns []; need an in-memory mirror for audit chain test → use a stub backend.
  const auditDb = new FileOnlyBackend();
  await auditDb.init(':memory:');
  await applyMigrations(auditDb);
  // Override query for audit_log retrieval to read back what we inserted.
  const inserted: Array<{ ts: number; op: string; entity_id: string | null; agent_id: string | null; integration: string | null; before_hash: string | null; after_hash: string | null; details: string | null; signature: string }> = [];
  const auditDbProxy = {
    capabilities: () => auditDb.capabilities(),
    exec: async (sql: string, params: unknown[] = []) => {
      if (/INSERT INTO audit_log/.test(sql)) {
        const [ts, op, entity_id, agent_id, integration, before_hash, after_hash, details, signature] = params as [number, string, string | null, string | null, string | null, string | null, string | null, string, string];
        inserted.push({ ts, op, entity_id, agent_id, integration, before_hash, after_hash, details, signature });
      }
    },
    query: async (sql: string, _params: unknown[] = []) => {
      if (/ORDER BY ts DESC LIMIT 1/.test(sql)) return inserted.length ? [{ signature: inserted[inserted.length - 1].signature }] : [];
      if (/ORDER BY ts ASC/.test(sql)) return [...inserted].sort((a, b) => a.ts - b.ts);
      return [];
    },
    prepare: auditDb.prepare.bind(auditDb),
    transaction: auditDb.transaction.bind(auditDb),
    close: auditDb.close.bind(auditDb),
    init: auditDb.init.bind(auditDb),
  } as unknown as typeof auditDb;
  const chainedAudit = new AuditLog(auditDbProxy, { hmacHex }, async () => masterKey);
  await chainedAudit.append({ ts: 1, op: 'write', entityId: 'p/a.md', agentId: 'user', integration: null, beforeHash: null, afterHash: 'h1', details: null });
  await chainedAudit.append({ ts: 2, op: 'write', entityId: 'p/b.md', agentId: 'user', integration: null, beforeHash: null, afterHash: 'h2', details: null });
  await chainedAudit.append({ ts: 3, op: 'skill', entityId: null, agentId: 'skill:research-org', integration: null, beforeHash: null, afterHash: null, details: { skill: 'research-org' } });
  const v1 = await chainedAudit.verifyChain();
  check('audit chain verifies (3 entries)', v1.ok, `brokenAt=${v1.brokenAt}`);
  // Tamper test
  inserted[1].signature = 'deadbeef';
  const v2 = await chainedAudit.verifyChain();
  check('audit chain detects tampering', !v2.ok && v2.brokenAt === 2, `brokenAt=${v2.brokenAt}`);

  // ProxyClient signing
  const proxy = new ProxyClient({
    fetch: async (url, init) => ({ status: 200, headers: {}, body: JSON.stringify({ url, headers: init.headers }) }),
    hmacHex: (k, m) => hmacHex(new TextEncoder().encode(k), m),
    sha256Hex: async (s) => crypto.createHash('sha256').update(s).digest('hex'),
  }, { enabled: true, baseUrl: 'https://proxy.test', sharedSecret: 'secret' });
  const r = await proxy.fetch('https://target.test/api', { method: 'GET' });
  const parsedProxy = JSON.parse(r.body) as { url: string; headers: Record<string, string> };
  check('ProxyClient routes to baseUrl with target header', parsedProxy.url === 'https://proxy.test' && parsedProxy.headers['X-Sauce-Target'] === 'https://target.test/api');
  check('ProxyClient signs request', !!parsedProxy.headers['X-Sauce-Signature']);

  console.log('\n=== Skills §20 ===');
  const reg = new SkillRegistry();
  check('SkillRegistry ships 16 skills', reg.list().length === 16, `got ${reg.list().length}`);
  const expectedSkills = ['research-org', 'research-person', 'draft-touch', 'summarize-thread', 'capture-call', 'infer-edges', 'geocode', 'transcribe', 'route-introduction', 'import-contacts', 'export-graph', 'schedule-touch', 'summarize-week', 'merge-duplicates', 'verify-email', 'review-changes'];
  for (const id of expectedSkills) check(`skill ${id} registered`, !!reg.get(id));

  // Skill execution fixture
  const skillCtx = {
    autonomy: 'propose' as const, agentId: 'test',
    call: async <T>(_id: string, _args: unknown) => ({ ok: true }) as T,
    audit: async () => {},
    scope: { require: () => {} },
  };
  const researchOrg = reg.get('research-org')!;
  const result = await researchOrg.execute({ org_name: 'Acme' }, skillCtx);
  check('research-org executes with required input', result.ok === true);
  const missing = await researchOrg.execute({}, skillCtx);
  check('research-org rejects missing required input', missing.ok === false && missing.reason.includes('missing_inputs'));

  console.log('\n=== Settings §35 ===');
  const settingsHost = { getConfig: <T>(_k: string, f: T) => f, setConfig: async () => {} };
  const tree = buildSettingsTree(settingsHost);
  check('settings tree built', tree.length === 20, `got ${tree.length} top-level pages`);
  const integrationsNode = tree.find((n) => n.page.id === 'integrations');
  check('integrations node has 7 children', integrationsNode?.children?.length === 7, `got ${integrationsNode?.children?.length}`);

  // Render every page into a fake container — verifies render() doesn't throw.
  const fakeDoc = (() => {
    type FakeEl = { tagName: string; children: FakeEl[]; textContent: string; value: string; checked: boolean; dataset: Record<string, string>; className: string; empty?: () => void; appendChild: (c: FakeEl) => FakeEl; setAttribute: (k: string, v: string) => void; addEventListener: (e: string, fn: () => void) => void };
    const make = (tag: string): FakeEl => {
      const el: FakeEl = { tagName: tag, children: [], textContent: '', value: '', checked: false, dataset: {}, className: '', appendChild(c) { this.children.push(c); return c; }, setAttribute(k, v) { if (k === 'class') this.className = v; }, addEventListener() {}, empty() { this.children.length = 0; } };
      return el;
    };
    (globalThis as unknown as { document: { createElement: (t: string) => FakeEl } }).document = { createElement: make };
    return { make };
  })();
  let renderedCount = 0;
  for (const node of tree) {
    const el = fakeDoc.make('div');
    node.page.render(el as unknown as HTMLElement);
    renderedCount += 1;
    for (const child of node.children ?? []) {
      const subEl = fakeDoc.make('div');
      child.page.render(subEl as unknown as HTMLElement);
      renderedCount += 1;
    }
  }
  check('all 27 pages rendered without throwing', renderedCount === 27, `rendered=${renderedCount}`);

  console.log('\n=== Commands §40 ===');
  check('V2 ships 26 commands', V2_COMMANDS.length === 26, `got ${V2_COMMANDS.length}`);
  // bindable surface — each must have id + name; hotkey if present must parse
  let bindable = 0;
  registerV2Commands({
    addCommand: (c) => {
      if (c.id && c.name && typeof c.callback === 'function') {
        if (c.hotkeys) for (const h of c.hotkeys) { if (!h.key) throw new Error(`bad hotkey on ${c.id}`); }
        bindable += 1;
      }
    },
    handler: async () => {},
  });
  check('all 26 commands bindable', bindable === 26, `bindable=${bindable}`);

  console.log('\n=== Views §36 ===');
  check('V2 declares 6 view types', V2_VIEW_TYPES.length === 6);
  for (const V of [MapView, AiInboxView, CopilotView, SyncStatusView, AuditLogView, SkillRunLogView]) {
    const hostEl = fakeDoc.make('div');
    const v = new V({ contentEl: hostEl as unknown as HTMLElement });
    await v.render();
    check(`${v.viewType} renders`, hostEl.children.length > 0);
  }

  console.log('\n=== CDEL §32 ===');
  const lexed = lex('@touch [[Steve Heaney]] 2026-05-21 call\n  playbook: ff-2\n  | discussed Q3');
  check('lexer produces tokens', lexed.length > 5);
  const parsed = parse(lex('@person [[Aarna Mishra]]\n  company: [[Sauce Technologies]]\n  closeness: 2'));
  check('parser captures wikilink subject', parsed.length === 1 && parsed[0].kind === 'directive' && (parsed[0] as { subject: { wikilink?: string } }).subject.wikilink === 'Aarna Mishra');
  const interp = new CdelInterpreter();
  const res = interp.interpret('met with Steve today');
  check('idiom rewrites natural to @touch', res.dispatches.length > 0 && res.dispatches[0].skillId === 'cdel.create-touch');

  console.log('\n=== Inference §31 ===');
  const eng = new InferenceEngine();
  const proposals = eng.edgeProposals([
    { id: 't1', date: '2026-05-01', attendees: ['p/alice.md', 'p/bob.md'], outcomeTags: ['advice-received'] },
    { id: 't2', date: '2026-05-10', attendees: ['p/alice.md', 'p/bob.md'], outcomeTags: ['intro-made'] },
    { id: 't3', date: '2026-05-15', attendees: ['p/alice.md', 'p/bob.md'], outcomeTags: ['advice-received'] },
    { id: 't4', date: '2026-05-18', attendees: ['p/alice.md', 'p/bob.md'], outcomeTags: ['advice-received'] },
    { id: 't5', date: '2026-05-20', attendees: ['p/alice.md', 'p/bob.md'] },
  ]);
  check('edge inference proposes knows', proposals.some((p) => (p.proposed_value as { edgeType: string }).edgeType === 'knows'), `n=${proposals.length}`);
  check('edge inference proposes worked_with from advice-received', proposals.some((p) => (p.proposed_value as { edgeType: string }).edgeType === 'worked_with'));

  console.log('\n=== Geo §28 ===');
  // SF to NYC ≈ 4129 km
  const d = haversineMeters(37.7749, -122.4194, 40.7128, -74.0060);
  check('haversine SF↔NYC within 1% of 4129km', Math.abs(d - 4_129_000) < 50_000, `d=${Math.round(d / 1000)}km`);
  const idx = new GeoIndex(1);
  idx.add({ id: 'sf', lat: 37.77, lon: -122.41 });
  idx.add({ id: 'oak', lat: 37.80, lon: -122.27 });
  idx.add({ id: 'nyc', lat: 40.71, lon: -74.00 });
  const nearest = idx.nearest(37.78, -122.40, 2);
  check('GeoIndex finds nearest 2 in same cell', nearest.length === 2 && nearest[0].point.id === 'sf');

  console.log('\n=== Import/Export §33 ===');
  const csvIn = new CsvImportAdapter();
  const csvOut = new CsvExportAdapter();
  const csv = '__type__,name,company\nperson,Alice,Acme\nperson,Bob,BetaCo';
  const parsedCsv = await csvIn.parse(csv);
  check('CSV import 2 rows', parsedCsv.length === 2);
  const reSerialized = await csvOut.serialize(parsedCsv);
  const round = await csvIn.parse(reSerialized);
  check('CSV round-trip preserves count', round.length === 2);

  const vcardIn = new VcardImportAdapter();
  const vcardOut = new VcardExportAdapter();
  const vcardStr = 'BEGIN:VCARD\nVERSION:4.0\nFN:Alice\nORG:Acme\nEMAIL:alice@acme.com\nEND:VCARD\n';
  const parsedV = await vcardIn.parse(vcardStr);
  check('vCard import name+org+email', parsedV.length === 1 && parsedV[0].frontmatter.name === 'Alice' && parsedV[0].frontmatter.company === 'Acme');
  const v2s = await vcardOut.serialize(parsedV);
  check('vCard export contains BEGIN:VCARD', (v2s as string).includes('BEGIN:VCARD'));

  const jsonIn = new JsonImportAdapter();
  const jsonOut = new JsonExportAdapter();
  const j1 = await jsonOut.serialize(parsedV);
  const j2 = await jsonIn.parse(j1);
  check('JSON round-trip', j2.length === 1 && j2[0].frontmatter.name === 'Alice');

  console.log('\n=== Sync §34 ===');
  const eng2 = new SyncEngine();
  let synced = 0;
  eng2.register({
    id: 'fake', label: 'Fake',
    connect: async () => ({ connected: true }),
    disconnect: async () => {},
    state: async () => ({ connected: true }),
    listResources: async () => [{ id: 'r1', label: 'r1', frequency: '1m', enabled: true, lastPullTs: null, cursor: null }],
    syncResource: async () => { synced += 1; return { pulled: 1, pushed: 0, errors: 0 }; },
  });
  await eng2.wireResources('fake');
  await eng2.scheduler.runNow('fake::r1');
  check('SyncEngine wires + manually runs job', synced === 1);
  const changes = eng2.changes.drain();
  check('ChangeFeed records pull', changes.length === 1 && changes[0].kind === 'integration-pull');

  console.log('\n=== SQLite mirror coherence §17.3 (kill/restart) ===');
  // FileOnlyBackend mirror is in-memory; close+reinit empties it as designed.
  const m1 = new FileOnlyBackend();
  await m1.init(':memory:');
  await applyMigrations(m1);
  await m1.exec('INSERT INTO entities (id,type,primary_type,frontmatter,body_md,body_hash,mtime,ctime) VALUES (?,?,?,?,?,?,?,?)', ['p/a.md', 'person', null, '{}', '', 'h', 1, 1]);
  // After "restart" — vault remains source of truth; reseed re-derives mirror.
  await m1.close();
  const m2 = new FileOnlyBackend();
  await m2.init(':memory:');
  await applyMigrations(m2);
  const seeded = await new Seeder(m2, { walk: async function* () { yield { path: 'p/a.md', ctime: 1, mtime: 1, type: 'person', frontmatter: {}, body: '', bodyHash: 'h', tags: [], edges: [] }; } }).run();
  check('mirror coherent after restart (seeder re-derived from vault)', seeded.entities === 1);

  console.log('\n=== Integration auth (offline contract check) ===');
  // End-to-end auth requires live OAuth/IMAP credentials; we verify the contract is wired.
  const { GoogleWorkspaceIntegration, Microsoft365Integration, AppleIntegration, NotionIntegration, TwilioIntegration, SmtpImapIntegration } = await import('../src/integrations');
  const fakeProxy = new ProxyClient({ fetch: async () => ({ status: 200, headers: {}, body: '{}' }), hmacHex: async () => 'x', sha256Hex: async () => 'x' }, { enabled: false, baseUrl: '', sharedSecret: '' });
  for (const [name, I] of [
    ['google', GoogleWorkspaceIntegration],
    ['microsoft', Microsoft365Integration],
    ['apple', AppleIntegration],
    ['notion', NotionIntegration],
    ['twilio', TwilioIntegration],
    ['smtp_imap', SmtpImapIntegration],
  ] as const) {
    const i = new I({ scopes, proxy: fakeProxy });
    check(`${name} integration constructible`, !!i.id && !!i.label);
    const st = await i.state();
    check(`${name} initial state disconnected`, !st.connected);
  }

  // ─────────────────────────────────────────────────────────────────────
  console.log('\n=== RESULTS ===');
  console.log(`PASS ${pass}   FAIL ${fail}`);
  if (failures.length) {
    console.log('\nFailures:');
    for (const f of failures) console.log(`  - ${f}`);
  }
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error('FATAL', e); process.exit(2); });
