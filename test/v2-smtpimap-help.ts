import { SmtpImapPage } from '../src/ui/settings/integrations/SmtpImapPage';
import { PROVIDER_HELP, helpForEmail, helpById } from '../src/integrations/smtpimap/HelpLinks';

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${detail}`); }
}

async function main(): Promise<void> {
  console.log('\n=== SMTP/IMAP help links ===');
  check('5 providers registered', PROVIDER_HELP.length === 5, `n=${PROVIDER_HELP.length}`);
  check('Gmail matches drew@saucetech.io', helpForEmail('drew@saucetech.io')?.id === 'google_workspace');
  check('iCloud matches @icloud.com', helpForEmail('test@icloud.com')?.id === 'apple_icloud');
  check('Outlook matches @outlook.com', helpForEmail('foo@outlook.com')?.id === 'microsoft_365');
  check('Fastmail matches @fastmail.com', helpForEmail('a@fastmail.com')?.id === 'fastmail');
  check('Proton matches @proton.me', helpForEmail('x@proton.me')?.id === 'protonmail');
  check('Unknown returns null', helpForEmail('random@example.org') === null);

  console.log('\n=== App-password URLs (first-party only) ===');
  for (const p of PROVIDER_HELP) {
    if (!p.appPasswordUrl) continue;
    const u = new URL(p.appPasswordUrl);
    const okDomain = u.hostname.endsWith(p.domain) || u.hostname.includes(p.domain.replace(/^.*\.([^.]+\.[^.]+)$/, '$1'));
    check(`${p.id} appPasswordUrl on first-party (${u.hostname})`, u.protocol === 'https:' && okDomain);
  }

  console.log('\n=== Page render + openExternal + saveSecret ===');
  type FakeEl = { tagName: string; children: FakeEl[]; textContent: string; value: string; checked: boolean; type: string; dataset: Record<string, string>; className: string; appendChild: (c: FakeEl) => FakeEl; setAttribute: (k: string, v: string) => void; addEventListener: (e: string, fn: () => void) => void; empty?: () => void; _listeners: Record<string, (() => void)[]>; click: () => void };
  const make = (tag: string): FakeEl => ({
    tagName: tag, children: [], textContent: '', value: '', checked: false, type: '', dataset: {}, className: '',
    _listeners: {},
    appendChild(c) { this.children.push(c); return c; },
    setAttribute(k, v) { if (k === 'class') this.className = v; if (k === 'type') this.type = v; },
    addEventListener(e, fn) { (this._listeners[e] ||= []).push(fn); },
    empty() { this.children.length = 0; },
    click() { (this._listeners['click'] || []).forEach((fn) => fn()); },
  });
  (globalThis as unknown as { document: { createElement: (t: string) => FakeEl } }).document = { createElement: make };

  const settings: Record<string, unknown> = {};
  const saved: Record<string, string> = {};
  const opened: string[] = [];

  const page = new SmtpImapPage({
    getConfig: <T>(k: string, f: T) => (settings[k] ?? f) as T,
    setConfig: async <T>(k: string, v: T) => { settings[k] = v; },
    openExternal: (u: string) => opened.push(u),
    saveSecret: async (k: string, v: string) => { saved[k] = v; },
    testConnection: async () => ({ ok: true, message: 'OK', latencyMs: 50 }),
  });

  const root = make('div');
  page.render(root as unknown as HTMLElement);
  check('Page renders something', root.children.length > 0);

  // Find all buttons in the rendered tree
  function findButtons(el: FakeEl): FakeEl[] {
    const out: FakeEl[] = [];
    if (el.tagName === 'button') out.push(el);
    for (const c of el.children) out.push(...findButtons(c));
    return out;
  }
  const buttons = findButtons(root);
  const helpButtons = buttons.filter((b) => b.textContent.includes('app password'));
  check('5 "Open app password page" buttons rendered', helpButtons.length === 5, `n=${helpButtons.length}`);
  // Click the first (Gmail) button
  helpButtons[0].click();
  check('Clicking Gmail help opens myaccount.google.com', opened[0] === 'https://myaccount.google.com/apppasswords', `opened=${opened[0]}`);

  // OAuth buttons
  const oauthButtons = buttons.filter((b) => b.textContent === 'OAuth setup');
  check('OAuth setup buttons rendered for providers that support it', oauthButtons.length === 2, `n=${oauthButtons.length}`);

  // Verify static helper
  const h = SmtpImapPage.getHelp('drew@saucetech.io');
  check('Static getHelp resolves email', h?.id === 'google_workspace');

  console.log('\n=== RESULTS ===');
  console.log(`PASS ${pass}   FAIL ${fail}`);
  if (fail > 0) process.exit(1);
}
main().catch((e) => { console.error('FATAL', e); process.exit(2); });
