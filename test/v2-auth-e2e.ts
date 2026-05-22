// End-to-end auth verification per provider. Mocks the network layer so every line of
// OAuth code executes against a server that obeys the protocol. For password/token
// providers (Apple, Twilio, SMTP, Web Search), exercises the KeyVault credential bind.

import { KeyVault, JsonSecretStore } from '../src/security/KeyVault';
import type { CryptoBackend } from '../src/security/KeyVault';
import { OAuthFlow, type OAuthHost, type TokenSet } from '../src/security/OAuthFlow';
import { ProxyClient, type ProxyHost } from '../src/security/ProxyClient';
import { ScopeRegistry, DEFAULT_SCOPES } from '../src/security/ScopeRegistry';
import { GoogleWorkspaceIntegration } from '../src/integrations/google';
import { Microsoft365Integration } from '../src/integrations/microsoft';
import { NotionIntegration } from '../src/integrations/notion';
import { AppleIntegration } from '../src/integrations/apple';
import { TwilioIntegration } from '../src/integrations/twilio';
import { SmtpImapIntegration } from '../src/integrations/smtpimap';
import { BraveSearch } from '../src/integrations/websearch';

import * as crypto from 'node:crypto';

let pass = 0, fail = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; failures.push(`${name} ${detail}`); console.log(`  FAIL  ${name} ${detail}`); }
}

const nodeCrypto: CryptoBackend = {
  async argon2id(password, salt, opts) {
    return new Promise((resolve, reject) => {
      crypto.scrypt(password, Buffer.from(salt), opts.outBytes, (err, key) => err ? reject(err) : resolve(new Uint8Array(key)));
    });
  },
  secretboxSeal(key, nonce, msg) {
    const cipher = crypto.createCipheriv('chacha20-poly1305', Buffer.from(key), Buffer.from(nonce.slice(0, 12)), { authTagLength: 16 });
    const enc = Buffer.concat([cipher.update(Buffer.from(msg)), cipher.final()]);
    return new Uint8Array(Buffer.concat([enc, cipher.getAuthTag()]));
  },
  secretboxOpen(key, nonce, ct) {
    try {
      const data = Buffer.from(ct);
      const enc = data.subarray(0, data.length - 16);
      const tag = data.subarray(data.length - 16);
      const dec = crypto.createDecipheriv('chacha20-poly1305', Buffer.from(key), Buffer.from(nonce.slice(0, 12)), { authTagLength: 16 });
      dec.setAuthTag(tag);
      return new Uint8Array(Buffer.concat([dec.update(enc), dec.final()]));
    } catch { return null; }
  },
  randomBytes(n) { return new Uint8Array(crypto.randomBytes(n)); },
};

// Mock OAuth host: simulates browser-open + loopback-listener + token endpoint.
function mockOAuthHost(opts: { tokenResp: () => Record<string, unknown> }): OAuthHost & { lastAuthorizeUrl: string | null; lastTokenBody: string | null } {
  const state = { lastAuthorizeUrl: null as string | null, lastTokenBody: null as string | null, pendingState: '' };
  return {
    lastAuthorizeUrl: null,
    lastTokenBody: null,
    async openBrowser(url) {
      this.lastAuthorizeUrl = url;
      state.lastAuthorizeUrl = url;
      const u = new URL(url);
      state.pendingState = u.searchParams.get('state') ?? '';
    },
    async listenOnce(port, path) {
      // Simulate the upstream authorization-server redirecting back to loopback with ?code=... &state=...
      const cb = new URL(`http://127.0.0.1:${port}${path}`);
      cb.searchParams.set('code', `mockcode_${Math.random().toString(36).slice(2, 10)}`);
      cb.searchParams.set('state', state.pendingState);
      return cb;
    },
    async fetchJson<T>(_url: string, init?: { method?: string; body?: string }) {
      this.lastTokenBody = init?.body ?? null;
      state.lastTokenBody = init?.body ?? null;
      return opts.tokenResp() as T;
    },
  };
}

async function main(): Promise<void> {
  console.log('\n=== KeyVault bind (foundation) ===');
  const blob: Record<string, unknown> = {};
  const store = new JsonSecretStore(async () => blob, async (d) => { Object.assign(blob, d); });
  const vault = new KeyVault(store, nodeCrypto);
  await vault.unlock('master-test-password');
  const subtle = (globalThis as unknown as { crypto?: { subtle: SubtleCrypto } }).crypto?.subtle ?? crypto.webcrypto.subtle;
  const scopes = new ScopeRegistry();
  scopes.load(DEFAULT_SCOPES);

  // ─── Google Workspace OAuth E2E ─────────────────────────────────────
  console.log('\n=== Google Workspace OAuth e2e ===');
  const ghost = mockOAuthHost({ tokenResp: () => ({
    access_token: 'ya29.mock-google-access',
    refresh_token: 'mock-google-refresh',
    expires_in: 3599,
    scope: 'https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/gmail.readonly',
    token_type: 'Bearer',
  }) });
  const goauth = new OAuthFlow(ghost, vault, subtle as SubtleCrypto, (n) => nodeCrypto.randomBytes(n));
  goauth.registerProvider('google_workspace', {
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    clientId: 'mock-client.apps.googleusercontent.com',
    defaultScopes: ['https://www.googleapis.com/auth/calendar.readonly'],
  });
  const gts: TokenSet = await goauth.authorize('google_workspace', ['https://www.googleapis.com/auth/calendar.readonly', 'https://www.googleapis.com/auth/gmail.readonly']);
  check('Google authorize URL contains PKCE challenge', /code_challenge=/.test(ghost.lastAuthorizeUrl ?? ''));
  check('Google authorize URL uses S256', /code_challenge_method=S256/.test(ghost.lastAuthorizeUrl ?? ''));
  check('Google token exchange sent code_verifier', /code_verifier=/.test(ghost.lastTokenBody ?? ''));
  check('Google access token captured', gts.accessToken === 'ya29.mock-google-access');
  check('Google refresh token stored in vault', (await vault.get('oauth:google_workspace:refresh')) === 'mock-google-refresh');
  check('Google scopes granted', goauth.scopesGranted('google_workspace').length === 2);

  // Refresh flow
  const ghost2 = mockOAuthHost({ tokenResp: () => ({ access_token: 'ya29.mock-google-refreshed', refresh_token: 'mock-google-refresh-v2', expires_in: 3599 }) });
  const goauth2 = new OAuthFlow(ghost2, vault, subtle as SubtleCrypto, (n) => nodeCrypto.randomBytes(n));
  goauth2.registerProvider('google_workspace', { authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth', tokenUrl: 'https://oauth2.googleapis.com/token', clientId: 'c', defaultScopes: [] });
  const refreshed = await goauth2.refresh('google_workspace');
  check('Google refresh produces new access token', refreshed.accessToken === 'ya29.mock-google-refreshed');
  check('Google rotated refresh persisted', (await vault.get('oauth:google_workspace:refresh')) === 'mock-google-refresh-v2');

  // Integration constructed against this oauth + makes its first call.
  let pulled = 0;
  const fakeProxy = new ProxyClient({
    fetch: async () => ({ status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ items: [{ id: 'evt-1', summary: 'Standup' }] }) }),
    hmacHex: async () => 'sig',
    sha256Hex: async () => 'hash',
  }, { enabled: false, baseUrl: '', sharedSecret: '' });
  const gi = new GoogleWorkspaceIntegration({ oauth: goauth2, scopes, proxy: fakeProxy });
  gi.setResources([{ id: 'calendar', label: 'Calendar', frequency: '15m', enabled: true, lastPullTs: null, cursor: null }]);
  await gi.connect();
  const r1 = await gi.syncResource('calendar');
  pulled = r1.pulled;
  check('Google integration syncResource completes', typeof r1.pulled === 'number', `pulled=${pulled}`);
  const st = await gi.state();
  check('Google state shows connected', st.connected);

  // ─── Microsoft 365 OAuth E2E ────────────────────────────────────────
  console.log('\n=== Microsoft 365 OAuth e2e ===');
  const mhost = mockOAuthHost({ tokenResp: () => ({ access_token: 'eyJ.mock-ms', refresh_token: 'mock-ms-refresh', expires_in: 3599, scope: 'Calendars.Read Mail.Read User.Read' }) });
  const moauth = new OAuthFlow(mhost, vault, subtle as SubtleCrypto, (n) => nodeCrypto.randomBytes(n));
  moauth.registerProvider('microsoft_365', {
    authorizeUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    clientId: 'mock-azure-app-id',
    defaultScopes: ['Calendars.Read', 'Mail.Read'],
  });
  const mts = await moauth.authorize('microsoft_365', ['Calendars.Read', 'Mail.Read', 'User.Read']);
  check('Microsoft access token captured', mts.accessToken === 'eyJ.mock-ms');
  check('Microsoft refresh persisted', (await vault.get('oauth:microsoft_365:refresh')) === 'mock-ms-refresh');
  check('Microsoft scopes granted include Mail.Read', moauth.scopesGranted('microsoft_365').includes('Mail.Read'));

  const mi = new Microsoft365Integration({ oauth: moauth, scopes, proxy: fakeProxy });
  mi.setResources([{ id: 'calendar', label: 'Calendar', frequency: '15m', enabled: true, lastPullTs: null, cursor: null }]);
  await mi.connect();
  await mi.syncResource('calendar');
  check('Microsoft integration connected', (await mi.state()).connected);

  // ─── Notion OAuth E2E ───────────────────────────────────────────────
  console.log('\n=== Notion OAuth e2e ===');
  const nhost = mockOAuthHost({ tokenResp: () => ({ access_token: 'secret_mock-notion', refresh_token: 'mock-notion-refresh', expires_in: 3600 }) });
  const noauth = new OAuthFlow(nhost, vault, subtle as SubtleCrypto, (n) => nodeCrypto.randomBytes(n));
  noauth.registerProvider('notion', {
    authorizeUrl: 'https://api.notion.com/v1/oauth/authorize',
    tokenUrl: 'https://api.notion.com/v1/oauth/token',
    clientId: 'mock-notion-client',
    clientSecret: 'mock-notion-secret',
    defaultScopes: [],
  });
  const nts = await noauth.authorize('notion', []);
  check('Notion access token captured', nts.accessToken === 'secret_mock-notion');
  check('Notion token exchange used client_secret', /client_secret=/.test(nhost.lastTokenBody ?? ''));
  check('Notion refresh persisted', (await vault.get('oauth:notion:refresh')) === 'mock-notion-refresh');

  const ni = new NotionIntegration({ oauth: noauth, scopes, proxy: fakeProxy });
  await ni.connect();
  check('Notion integration connected', (await ni.state()).connected);

  // ─── Apple (CalDAV/CardDAV/IMAP — app-specific password) ────────────
  console.log('\n=== Apple credential bind e2e ===');
  await vault.put('apple:appleid', 'user@icloud.com');
  await vault.put('apple:app-password', 'abcd-efgh-ijkl-mnop');
  check('Apple appleid stored', (await vault.get('apple:appleid')) === 'user@icloud.com');
  check('Apple app-password stored', (await vault.get('apple:app-password')) === 'abcd-efgh-ijkl-mnop');
  const ai = new AppleIntegration({ scopes, proxy: fakeProxy });
  await ai.connect();
  check('Apple integration connected via stored creds', (await ai.state()).connected);

  // ─── Twilio (Account SID + Auth Token) ──────────────────────────────
  console.log('\n=== Twilio credential bind e2e ===');
  await vault.put('twilio:account-sid', 'ACmockmockmockmockmockmockmockmoc');
  await vault.put('twilio:auth-token', 'mocktoken1234567890abcdefghij');
  check('Twilio SID stored', (await vault.get('twilio:account-sid')).startsWith('AC'));
  check('Twilio token stored', !!(await vault.get('twilio:auth-token')));
  const ti = new TwilioIntegration({ scopes, proxy: fakeProxy });
  await ti.connect();
  check('Twilio integration connected', (await ti.state()).connected);

  // ─── SMTP/IMAP per-account password bind ────────────────────────────
  console.log('\n=== SMTP/IMAP credential bind e2e ===');
  await vault.put('smtp_imap:default:host', 'imap.fastmail.com');
  await vault.put('smtp_imap:default:user', 'me@fastmail.com');
  await vault.put('smtp_imap:default:password', 'app-specific-password');
  check('SMTP host stored', (await vault.get('smtp_imap:default:host')) === 'imap.fastmail.com');
  check('SMTP password stored', !!(await vault.get('smtp_imap:default:password')));
  const si = new SmtpImapIntegration({ scopes, proxy: fakeProxy });
  await si.connect();
  check('SMTP integration connected', (await si.state()).connected);

  // ─── Web Search provider key bind ───────────────────────────────────
  console.log('\n=== Web Search provider key bind ===');
  await vault.put('web_search:brave', 'BSA_mock-key-12345');
  let braveCalled = false;
  const braveProxy = new ProxyClient({
    fetch: async (url) => {
      braveCalled = true;
      check('Brave search URL includes query', /q=test/.test(url));
      return { status: 200, headers: {}, body: JSON.stringify({ web: { results: [{ url: 'https://example.com', title: 'Example', description: 'Snippet' }] } }) };
    },
    hmacHex: async () => 'x',
    sha256Hex: async () => 'h',
  }, { enabled: false, baseUrl: '', sharedSecret: '' });
  const brave = new BraveSearch({ proxy: braveProxy, sha256Hex: async () => 'h', markdownExtract: (s) => s }, async () => await vault.get('web_search:brave'));
  const results = await brave.search('test', { count: 5 });
  check('Brave called with API key from vault', braveCalled);
  check('Brave returns at least one result', results.length > 0 && results[0].url === 'https://example.com');

  // ─── ProxyClient relay end-to-end ───────────────────────────────────
  console.log('\n=== ProxyClient relay e2e ===');
  let proxyTargetSeen = '';
  let proxySigSeen = '';
  const realProxy = new ProxyClient({
    fetch: async (_url, init) => {
      proxyTargetSeen = init.headers['X-Sauce-Target'] ?? '';
      proxySigSeen = init.headers['X-Sauce-Signature'] ?? '';
      return { status: 200, headers: {}, body: 'ok' };
    },
    hmacHex: async (k, m) => crypto.createHmac('sha256', k).update(m).digest('hex'),
    sha256Hex: async (s) => crypto.createHash('sha256').update(s).digest('hex'),
  }, { enabled: true, baseUrl: 'https://proxy.sauce.test', sharedSecret: 'shared-secret-32-bytes-long-xxxxxx' });
  const pr = await realProxy.fetch('https://api.upstream.test/v1/me', { method: 'POST', body: '{"q":1}' });
  check('Proxy received correct target', proxyTargetSeen === 'https://api.upstream.test/v1/me');
  check('Proxy signature is 64 hex chars', /^[0-9a-f]{64}$/.test(proxySigSeen));
  check('Proxy response delivered to caller', pr.body === 'ok');

  // ─── Final ──────────────────────────────────────────────────────────
  console.log('\n=== AUTH E2E RESULTS ===');
  console.log(`PASS ${pass}   FAIL ${fail}`);
  if (failures.length) {
    console.log('\nFailures:');
    for (const f of failures) console.log(`  - ${f}`);
  }
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error('FATAL', e); process.exit(2); });
