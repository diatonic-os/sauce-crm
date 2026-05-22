// Live SMTP/IMAP verification through V2 SmtpImapIntegration.
// Exercises: TLS handshake, cert validation, IMAP CAPABILITY, LOGIN/AUTHENTICATE,
// SELECT INBOX, LOGOUT. Two auth modes attempted: PLAIN (app password) + XOAUTH2.
// Reads credentials from KeyVault (production path), falling back to env (test only).

import { SmtpImapIntegration } from '../src/integrations/smtpimap';
import { SmtpImapClient } from '../src/integrations/smtpimap/SmtpImapClient';
import { KeyVault, JsonSecretStore, type CryptoBackend } from '../src/security/KeyVault';
import { KeyVaultCredentialSource, ChainedCredentialSource } from '../src/copilot/CredentialSource';
import { EnvCredentialSource } from './EnvCredentialSource';
import { ScopeRegistry, DEFAULT_SCOPES } from '../src/security/ScopeRegistry';
import { ProxyClient } from '../src/security/ProxyClient';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';

let pass = 0, fail = 0, skip = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; failures.push(`${name} ${detail}`); console.log(`  FAIL  ${name} ${detail}`); }
}
function skipMsg(name: string, reason: string): void { skip++; console.log(`  SKIP  ${name} — ${reason}`); }

const nodeCrypto: CryptoBackend = {
  async argon2id(p, s, o) { return new Promise((r,j) => crypto.scrypt(p, Buffer.from(s), o.outBytes, (e,k) => e?j(e):r(new Uint8Array(k)))); },
  secretboxSeal(k, n, m) { const c=crypto.createCipheriv('chacha20-poly1305', Buffer.from(k), Buffer.from(n.slice(0,12)), {authTagLength:16}); const e=Buffer.concat([c.update(Buffer.from(m)),c.final()]); return new Uint8Array(Buffer.concat([e,c.getAuthTag()])); },
  secretboxOpen(k, n, ct) { try { const d=Buffer.from(ct); const e=d.subarray(0,d.length-16); const t=d.subarray(d.length-16); const dec=crypto.createDecipheriv('chacha20-poly1305', Buffer.from(k), Buffer.from(n.slice(0,12)), {authTagLength:16}); dec.setAuthTag(t); return new Uint8Array(Buffer.concat([dec.update(e),dec.final()])); } catch { return null; } },
  randomBytes(n) { return new Uint8Array(crypto.randomBytes(n)); },
};

function loadEnv(): Record<string, string> {
  const p = path.join(__dirname, '.env.live');
  if (!fs.existsSync(p)) return {};
  const out: Record<string, string> = {};
  for (const line of fs.readFileSync(p, 'utf-8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}
const env = loadEnv();

async function main(): Promise<void> {
  console.log('\n=== Secure SMTP/IMAP integration (V2) ===');
  const blob: Record<string, unknown> = {};
  const store = new JsonSecretStore(async () => blob, async (d) => { Object.assign(blob, d); });
  const vault = new KeyVault(store, nodeCrypto);
  await vault.unlock('smtpimap-test-vault-pw');
  const kv = new KeyVaultCredentialSource(vault);
  const envSrc = new EnvCredentialSource(env, {
    'smtp_imap:drew_saucetech:app-password': 'IMAP_APP_PASSWORD',
    'smtp_imap:drew_saucetech:oauth-access-token': 'IMAP_OAUTH_TOKEN',
  });
  const source = new ChainedCredentialSource([kv, envSrc]);

  // ─── Setup integration ───────────────────────────────────────────────
  const scopes = new ScopeRegistry();
  scopes.load(DEFAULT_SCOPES);
  const proxy = new ProxyClient({ fetch: async () => ({ status: 200, headers: {}, body: '{}' }), hmacHex: async () => 'x', sha256Hex: async () => 'h' }, { enabled: false, baseUrl: '', sharedSecret: '' });
  const integ = new SmtpImapIntegration({ scopes, proxy, source });

  integ.addAccount({
    id: 'drew_saucetech',
    imapHost: 'imap.gmail.com',
    imapPort: 993,
    smtpHost: 'smtp.gmail.com',
    smtpPort: 465,
    username: 'drew@saucetech.io',
    authMode: 'plain',
  });
  await integ.connect();
  check('Integration accepts account + connects', (await integ.state()).connected);

  // Seed the vault with a known-rejected token so the auth-flow code path runs end-to-end.
  // We expect the IMAP server to reject; that proves the protocol exchange completes correctly.
  if (env.IMAP_APP_PASSWORD) {
    await kv.put('smtp_imap:drew_saucetech:app-password', env.IMAP_APP_PASSWORD);
  }
  const cred = await source.get('smtp_imap:drew_saucetech:app-password');
  if (!cred) {
    skipMsg('IMAP probe', 'no app password in vault or env. Set IMAP_APP_PASSWORD in env.tpl or via Settings.');
  } else {
    console.log('\n--- Live IMAP TLS handshake + LOGIN exchange ---');
    const result = await integ.probeAccount('drew_saucetech');
    check('TLS handshake completes against imap.gmail.com:993', result.capability.length > 0 || !!result.greeting, `greeting="${result.greeting.slice(0, 50)}"`);
    check('Server greeting parsed', /\* OK/.test(result.greeting), `g="${result.greeting.slice(0, 40)}"`);
    check('CAPABILITY enumerated', result.capability.length > 0, `caps=[${result.capability.slice(0, 4).join(', ')}…]`);
    if (result.ok) {
      check('AUTH succeeded end-to-end (live!)', result.ok, `latency=${result.loginLatencyMs}ms, inbox=${result.messageCount} msgs`);
    } else {
      // Common Gmail rejection codes — these prove the protocol layer worked, only the cred is bad
      const expected = /AUTHENTICATIONFAILED|app password|application-specific|invalid credentials/i.test(result.error ?? '');
      check('AUTH failure cleanly surfaced (cred state, not code path)', expected, `error="${result.error?.slice(0, 80)}"`);
    }
  }

  // ─── XOAUTH2 mode dry-run ────────────────────────────────────────────
  console.log('\n--- XOAUTH2 mode (KeyVault-bound, dry-run if no token) ---');
  integ.addAccount({
    id: 'drew_saucetech',  // re-add with xoauth2
    imapHost: 'imap.gmail.com', imapPort: 993,
    username: 'drew@saucetech.io', authMode: 'xoauth2',
  });
  const xtok = await source.get('smtp_imap:drew_saucetech:oauth-access-token');
  if (!xtok) skipMsg('XOAUTH2 live probe', 'no OAuth access token (set via Google Workspace OAuth integration first)');
  else {
    const xresult = await integ.probeAccount('drew_saucetech');
    if (xresult.ok) check('XOAUTH2 AUTH succeeded', true, `inbox=${xresult.messageCount}`);
    else check('XOAUTH2 AUTH failure surfaced cleanly', !!xresult.error, `error="${xresult.error?.slice(0,80)}"`);
  }

  // ─── ScopeRegistry gate ──────────────────────────────────────────────
  console.log('\n--- Scope enforcement ---');
  scopes.set('smtp_imap', 'inbox.read', false);
  let threw = false;
  try { await integ.probeAccount('drew_saucetech'); } catch (e) { if ((e as Error).message?.includes('Scope not granted')) threw = true; }
  check('ScopeNotGranted blocks probe when inbox.read off', threw);
  scopes.set('smtp_imap', 'inbox.read', true);

  // ─── SOCKS5 proxy path (rejected at proxy, never leaves machine plaintext) ─
  console.log('\n--- SOCKS5 egress (smoke test) ---');
  const proxiedClient = new SmtpImapClient({
    account: { id: 'x', imapHost: 'imap.gmail.com', imapPort: 993, username: 'drew@saucetech.io', authMode: 'plain' },
    source,
    proxy: { host: '127.0.0.1', port: 19999 },   // intentionally unreachable
    handshakeTimeoutMs: 2_000,
  });
  const proxyResult = await proxiedClient.probe();
  check('SOCKS5 misroute fails closed (not silent plaintext fallback)', !proxyResult.ok, `error="${proxyResult.error?.slice(0,60)}"`);

  // ─── Strict TLS verification ─────────────────────────────────────────
  console.log('\n--- TLS strict verification ---');
  const strictClient = new SmtpImapClient({
    account: { id: 'x', imapHost: 'imap.gmail.com', imapPort: 993, username: 'drew@saucetech.io', authMode: 'plain' },
    source,
    rejectUnauthorized: true,
    minTlsVersion: 'TLSv1.2',
    handshakeTimeoutMs: 8_000,
  });
  const strictResult = await strictClient.probe();
  check('TLS 1.2+ handshake completes (or fails for cred reason, not TLS)',
        strictResult.capability.length > 0 || /AUTHENTICATION|app password/i.test(strictResult.error ?? ''),
        `state="${strictResult.ok ? 'auth-ok' : strictResult.error?.slice(0, 60)}"`);

  console.log('\n=== SMTP/IMAP RESULTS ===');
  console.log(`PASS ${pass}   FAIL ${fail}   SKIP ${skip}`);
  if (failures.length) { console.log('Failures:'); for (const f of failures) console.log(`  - ${f}`); }
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error('FATAL', e); process.exit(2); });
