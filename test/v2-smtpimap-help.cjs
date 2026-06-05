// src/ui/settings/SettingsPage.ts
var SettingsPage = class {
  constructor() {
    this.icon = null;
  }
};
function el(tag, attrs = {}, text) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs))
    e.setAttribute(k, v);
  if (text !== void 0)
    e.textContent = text;
  return e;
}

// src/integrations/smtpimap/HelpLinks.ts
var PROVIDER_HELP = [
  {
    id: "google_workspace",
    label: "Google Workspace / Gmail",
    domain: "google.com",
    appPasswordUrl: "https://myaccount.google.com/apppasswords",
    oauthSetupUrl: "https://console.cloud.google.com/apis/credentials",
    steps: [
      "Enable 2-Step Verification at https://myaccount.google.com/security if not already on.",
      "Open the App Passwords link below in your browser.",
      'Select app "Mail" and device "Other (Sauce Graph)" \u2014 name it whatever you like.',
      "Copy the 16-character password (4 groups of 4 letters) and paste it into Sauce Graph.",
      "The password is shown once \u2014 store it in Sauce Graph immediately. Sauce Graph encrypts it in the KeyVault."
    ],
    matchEmail: (e) => /@gmail\.com$|@googlemail\.com$/i.test(e) || /@saucetech\.io$/i.test(e),
    imap: { host: "imap.gmail.com", port: 993, tls: "implicit" },
    smtp: { host: "smtp.gmail.com", port: 465, tls: "implicit" }
  },
  {
    id: "microsoft_365",
    label: "Microsoft 365 / Outlook",
    domain: "microsoft.com",
    appPasswordUrl: "https://account.microsoft.com/security",
    oauthSetupUrl: "https://portal.azure.com/#blade/Microsoft_AAD_RegisteredApps/ApplicationsListBlade",
    steps: [
      "Enable two-step verification at https://account.microsoft.com/security.",
      'Under "Advanced security options" \u2192 "App passwords" \u2192 "Create a new app password".',
      'Name it "Sauce Graph" and copy the generated password.',
      "Paste into Sauce Graph. The password is encrypted in the KeyVault."
    ],
    matchEmail: (e) => /@outlook\.com$|@hotmail\.com$|@live\.com$/i.test(e),
    imap: { host: "outlook.office365.com", port: 993, tls: "implicit" },
    smtp: { host: "smtp.office365.com", port: 587, tls: "implicit" }
  },
  {
    id: "apple_icloud",
    label: "Apple iCloud",
    domain: "apple.com",
    appPasswordUrl: "https://appleid.apple.com/account/manage",
    oauthSetupUrl: null,
    steps: [
      "Sign in at https://appleid.apple.com/account/manage with your Apple ID.",
      'Under "Sign-In and Security" \u2192 "App-Specific Passwords" \u2192 "+".',
      'Label it "Sauce Graph" and copy the generated password.',
      "Paste into Sauce Graph. The password is encrypted in the KeyVault."
    ],
    matchEmail: (e) => /@icloud\.com$|@me\.com$|@mac\.com$/i.test(e),
    imap: { host: "imap.mail.me.com", port: 993, tls: "implicit" },
    smtp: { host: "smtp.mail.me.com", port: 587, tls: "implicit" }
  },
  {
    id: "fastmail",
    label: "Fastmail",
    domain: "fastmail.com",
    appPasswordUrl: "https://www.fastmail.com/settings/security/devicekeys",
    oauthSetupUrl: null,
    steps: [
      "Open https://www.fastmail.com/settings/security/devicekeys.",
      '"New app password" \u2014 name it "Sauce Graph", select access to "Mail (IMAP/POP/SMTP)".',
      "Copy the generated password.",
      "Paste into Sauce Graph. The password is encrypted in the KeyVault."
    ],
    matchEmail: (e) => /@fastmail\.com$|@fastmail\.fm$|@messagingengine\.com$/i.test(e),
    imap: { host: "imap.fastmail.com", port: 993, tls: "implicit" },
    smtp: { host: "smtp.fastmail.com", port: 465, tls: "implicit" }
  },
  {
    id: "protonmail",
    label: "Proton Mail (Bridge required)",
    domain: "proton.me",
    appPasswordUrl: "https://proton.me/mail/bridge",
    oauthSetupUrl: null,
    steps: [
      "Install Proton Mail Bridge from https://proton.me/mail/bridge.",
      "Sign in to Bridge with your Proton account. Bridge gives you per-account local credentials.",
      "In Sauce Graph, use host 127.0.0.1, port 1143 (or whatever Bridge reports), and the Bridge-issued password.",
      "The password is encrypted in the KeyVault."
    ],
    matchEmail: (e) => /@proton\.me$|@protonmail\.com$|@pm\.me$/i.test(e),
    imap: { host: "127.0.0.1", port: 1143, tls: "implicit" },
    smtp: { host: "127.0.0.1", port: 1025, tls: "implicit" }
  }
];
function helpForEmail(email) {
  return PROVIDER_HELP.find((p) => p.matchEmail?.(email)) ?? null;
}
function helpById(id) {
  return PROVIDER_HELP.find((p) => p.id === id) ?? null;
}

// src/ui/settings/integrations/SmtpImapPage.ts
var SmtpImapPage = class extends SettingsPage {
  constructor(host) {
    super();
    this.host = host;
    this.id = "integrations.smtp_imap";
    this.title = "Email (SMTP/IMAP)";
    this.group = "integrations";
  }
  render(containerEl) {
    containerEl.empty?.();
    containerEl.appendChild(el("h2", {}, this.title));
    containerEl.appendChild(el(
      "p",
      { class: "sauce-settings-hint" },
      "Connect a Gmail, Outlook, iCloud, Fastmail or other IMAP account. Sauce Graph uses TLS-only and stores credentials encrypted in the KeyVault. Live login passwords from your provider will NOT work \u2014 you must generate an app-specific password."
    ));
    const form = containerEl.appendChild(el("div", { class: "sauce-smtpimap-form" }));
    const inputs = {};
    for (const field of [
      { key: "account.id", label: "Account ID (internal, e.g. drew_saucetech)", type: "text", placeholder: "default" },
      { key: "account.username", label: "Email address", type: "email", placeholder: "you@example.com" },
      { key: "account.imapHost", label: "IMAP host", type: "text", placeholder: "auto-detected from email" },
      { key: "account.imapPort", label: "IMAP port", type: "number", placeholder: "993" },
      { key: "account.smtpHost", label: "SMTP host", type: "text", placeholder: "auto-detected from email" },
      { key: "account.smtpPort", label: "SMTP port", type: "number", placeholder: "465 or 587" }
    ]) {
      const row = form.appendChild(el("div", { class: "sauce-settings-row" }));
      row.appendChild(el("label", {}, field.label));
      const inp = row.appendChild(el("input"));
      inp.setAttribute("type", field.type);
      inp.setAttribute("placeholder", field.placeholder);
      inp.value = this.host.getConfig(field.key, "");
      inp.addEventListener("change", () => {
        void this.host.setConfig(field.key, inp.value);
        if (field.key === "account.username")
          this.autoDetect(inp.value, inputs);
      });
      inputs[field.key] = inp;
    }
    const pwRow = form.appendChild(el("div", { class: "sauce-settings-row" }));
    pwRow.appendChild(el("label", {}, "App-specific password (16 chars, 4 groups of 4)"));
    const pwInput = pwRow.appendChild(el("input"));
    pwInput.setAttribute("type", "password");
    pwInput.setAttribute("placeholder", "xxxx xxxx xxxx xxxx");
    pwInput.addEventListener("change", async () => {
      const accountId = inputs["account.id"].value || "default";
      if (this.host.saveSecret && pwInput.value) {
        await this.host.saveSecret(`smtp_imap:${accountId}:app-password`, pwInput.value);
        pwInput.value = "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022";
      }
    });
    const helpContainer = containerEl.appendChild(el("div", { class: "sauce-smtpimap-help" }));
    helpContainer.appendChild(el("h3", {}, "How to get an app password"));
    helpContainer.appendChild(el(
      "p",
      { class: "sauce-settings-hint" },
      "Click your email provider to open the app-password generation page. Follow the steps shown."
    ));
    for (const entry of PROVIDER_HELP) {
      const card = helpContainer.appendChild(el("div", { class: "sauce-help-card" }));
      const header = card.appendChild(el("div", { class: "sauce-help-card-header" }));
      header.appendChild(el("strong", {}, entry.label));
      if (entry.appPasswordUrl) {
        const btn = header.appendChild(el("button", { class: "mod-cta sauce-help-link" }, "Open app password page"));
        const url = entry.appPasswordUrl;
        btn.addEventListener("click", () => {
          if (this.host.openExternal)
            this.host.openExternal(url);
          else if (typeof window !== "undefined" && window.open)
            window.open(url);
        });
      }
      if (entry.oauthSetupUrl) {
        const ob = header.appendChild(el("button", { class: "sauce-help-link-secondary" }, "OAuth setup"));
        const ourl = entry.oauthSetupUrl;
        ob.addEventListener("click", () => {
          if (this.host.openExternal)
            this.host.openExternal(ourl);
          else if (typeof window !== "undefined" && window.open)
            window.open(ourl);
        });
      }
      const steps = card.appendChild(el("ol", { class: "sauce-help-steps" }));
      for (const s of entry.steps)
        steps.appendChild(el("li", {}, s));
      if (entry.imap) {
        const hostLine = card.appendChild(el("p", { class: "sauce-settings-hint" }, ""));
        hostLine.textContent = `Default IMAP: ${entry.imap.host}:${entry.imap.port} (implicit TLS) \xB7 SMTP: ${entry.smtp?.host ?? "(see provider)"}:${entry.smtp?.port ?? "?"}`;
      }
    }
    const actions = containerEl.appendChild(el("div", { class: "sauce-settings-actions" }));
    const testBtn = actions.appendChild(el("button", { class: "mod-cta" }, "Test connection"));
    const status = actions.appendChild(el("span", { class: "sauce-settings-status" }));
    testBtn.addEventListener("click", async () => {
      const accountId = inputs["account.id"].value || "default";
      if (!this.host.testConnection) {
        status.textContent = "Test handler not wired";
        return;
      }
      status.textContent = "Testing\u2026";
      const r = await this.host.testConnection(accountId);
      status.textContent = r.ok ? `\u2713 ${r.message} (${r.latencyMs ?? "?"}ms)` : `\u2717 ${r.message}`;
    });
    containerEl.appendChild(el(
      "div",
      { class: "sauce-security-notice" },
      "Security: Sauce Graph never accepts your real login password. App-specific passwords are encrypted at rest via libsodium secretbox in the KeyVault, gated by your master password. Passwords are zeroed in memory after each IMAP/SMTP call."
    ));
  }
  autoDetect(email, inputs) {
    const help = helpForEmail(email);
    if (!help)
      return;
    if (help.imap) {
      inputs["account.imapHost"].value = help.imap.host;
      inputs["account.imapPort"].value = String(help.imap.port);
      void this.host.setConfig("account.imapHost", help.imap.host);
      void this.host.setConfig("account.imapPort", help.imap.port);
    }
    if (help.smtp) {
      inputs["account.smtpHost"].value = help.smtp.host;
      inputs["account.smtpPort"].value = String(help.smtp.port);
      void this.host.setConfig("account.smtpHost", help.smtp.host);
      void this.host.setConfig("account.smtpPort", help.smtp.port);
    }
  }
  static getHelp(emailOrId) {
    return helpForEmail(emailOrId) ?? helpById(emailOrId);
  }
};

// test/v2-smtpimap-help.ts
var pass = 0;
var fail = 0;
function check(name, cond, detail = "") {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name} ${detail}`);
  }
}
async function main() {
  console.log("\n=== SMTP/IMAP help links ===");
  check("5 providers registered", PROVIDER_HELP.length === 5, `n=${PROVIDER_HELP.length}`);
  check("Gmail matches user@gmail.com", helpForEmail("user@gmail.com")?.id === "google_workspace");
  check("iCloud matches @icloud.com", helpForEmail("test@icloud.com")?.id === "apple_icloud");
  check("Outlook matches @outlook.com", helpForEmail("foo@outlook.com")?.id === "microsoft_365");
  check("Fastmail matches @fastmail.com", helpForEmail("a@fastmail.com")?.id === "fastmail");
  check("Proton matches @proton.me", helpForEmail("x@proton.me")?.id === "protonmail");
  check("Unknown returns null", helpForEmail("random@example.org") === null);
  console.log("\n=== App-password URLs (first-party only) ===");
  for (const p of PROVIDER_HELP) {
    if (!p.appPasswordUrl)
      continue;
    const u = new URL(p.appPasswordUrl);
    const okDomain = u.hostname.endsWith(p.domain) || u.hostname.includes(p.domain.replace(/^.*\.([^.]+\.[^.]+)$/, "$1"));
    check(`${p.id} appPasswordUrl on first-party (${u.hostname})`, u.protocol === "https:" && okDomain);
  }
  console.log("\n=== Page render + openExternal + saveSecret ===");
  const make = (tag) => ({
    tagName: tag,
    children: [],
    textContent: "",
    value: "",
    checked: false,
    type: "",
    dataset: {},
    className: "",
    _listeners: {},
    appendChild(c) {
      this.children.push(c);
      return c;
    },
    setAttribute(k, v) {
      if (k === "class")
        this.className = v;
      if (k === "type")
        this.type = v;
    },
    addEventListener(e, fn) {
      (this._listeners[e] ||= []).push(fn);
    },
    empty() {
      this.children.length = 0;
    },
    click() {
      (this._listeners["click"] || []).forEach((fn) => fn());
    }
  });
  globalThis.document = { createElement: make };
  const settings = {};
  const saved = {};
  const opened = [];
  const page = new SmtpImapPage({
    getConfig: (k, f) => settings[k] ?? f,
    setConfig: async (k, v) => {
      settings[k] = v;
    },
    openExternal: (u) => opened.push(u),
    saveSecret: async (k, v) => {
      saved[k] = v;
    },
    testConnection: async () => ({ ok: true, message: "OK", latencyMs: 50 })
  });
  const root = make("div");
  page.render(root);
  check("Page renders something", root.children.length > 0);
  function findButtons(el2) {
    const out = [];
    if (el2.tagName === "button")
      out.push(el2);
    for (const c of el2.children)
      out.push(...findButtons(c));
    return out;
  }
  const buttons = findButtons(root);
  const helpButtons = buttons.filter((b) => b.textContent.includes("app password"));
  check('5 "Open app password page" buttons rendered', helpButtons.length === 5, `n=${helpButtons.length}`);
  helpButtons[0].click();
  check("Clicking Gmail help opens myaccount.google.com", opened[0] === "https://myaccount.google.com/apppasswords", `opened=${opened[0]}`);
  const oauthButtons = buttons.filter((b) => b.textContent === "OAuth setup");
  check("OAuth setup buttons rendered for providers that support it", oauthButtons.length === 2, `n=${oauthButtons.length}`);
  const h = SmtpImapPage.getHelp("user@gmail.com");
  check("Static getHelp resolves email", h?.id === "google_workspace");
  console.log("\n=== RESULTS ===");
  console.log(`PASS ${pass}   FAIL ${fail}`);
  if (fail > 0)
    process.exit(1);
}
main().catch((e) => {
  console.error("FATAL", e);
  process.exit(2);
});
