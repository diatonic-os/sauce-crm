import { SettingsPage, type SettingsHost, el } from "../SettingsPage";
import {
  PROVIDER_HELP,
  helpForEmail,
  helpById,
  type ProviderHelpEntry,
} from "../../../integrations/smtpimap/HelpLinks";

export interface SmtpImapPageHost extends SettingsHost {
  /** Open a URL in the user's browser. In Obsidian: `window.open(url)`; in test: stub. */
  openExternal?(url: string): void;
  /** Persist a credential to KeyVault. Bound to the V2 KeyVault when wired by main.ts. */
  saveSecret?(key: string, value: string): Promise<void>;
  /** Run a live IMAP probe and return a status message. */
  testConnection?(
    accountId: string,
  ): Promise<{ ok: boolean; message: string; latencyMs?: number }>;
}

export class SmtpImapPage extends SettingsPage {
  readonly id = "integrations.smtp_imap";
  readonly title = "Email (SMTP/IMAP)";
  readonly group = "integrations";

  constructor(private readonly host: SmtpImapPageHost) {
    super();
  }

  render(containerEl: HTMLElement): void {
    containerEl.empty?.();
    containerEl.appendChild(el("h2", {}, this.title));
    containerEl.appendChild(
      el(
        "p",
        { class: "sauce-settings-hint" },
        "Connect a Gmail, Outlook, iCloud, Fastmail or other IMAP account. Sauce Graph uses TLS-only and stores credentials encrypted in the KeyVault. Live login passwords from your provider will NOT work — you must generate an app-specific password.",
      ),
    );

    // Account form
    const form = containerEl.appendChild(
      el("div", { class: "sauce-smtpimap-form" }),
    );
    const inputs: Record<string, HTMLInputElement> = {};
    for (const field of [
      {
        key: "account.id",
        label: "Account ID (internal, e.g. drew_saucetech)",
        type: "text",
        placeholder: "default",
      },
      {
        key: "account.username",
        label: "Email address",
        type: "email",
        placeholder: "you@example.com",
      },
      {
        key: "account.imapHost",
        label: "IMAP host",
        type: "text",
        placeholder: "auto-detected from email",
      },
      {
        key: "account.imapPort",
        label: "IMAP port",
        type: "number",
        placeholder: "993",
      },
      {
        key: "account.smtpHost",
        label: "SMTP host",
        type: "text",
        placeholder: "auto-detected from email",
      },
      {
        key: "account.smtpPort",
        label: "SMTP port",
        type: "number",
        placeholder: "465 or 587",
      },
    ]) {
      const row = form.appendChild(el("div", { class: "sauce-settings-row" }));
      row.appendChild(el("label", {}, field.label));
      const inp = row.appendChild(el("input")) as HTMLInputElement;
      inp.setAttribute("type", field.type);
      inp.setAttribute("placeholder", field.placeholder);
      inp.value = this.host.getConfig(field.key, "") as string;
      inp.addEventListener("change", () => {
        void this.host.setConfig(field.key, inp.value);
        // Auto-detect host:port when user types email
        if (field.key === "account.username")
          this.autoDetect(inp.value, inputs);
      });
      inputs[field.key] = inp;
    }

    // App-password field (vault-bound, masked)
    const pwRow = form.appendChild(el("div", { class: "sauce-settings-row" }));
    pwRow.appendChild(
      el("label", {}, "App-specific password (16 chars, 4 groups of 4)"),
    );
    const pwInput = pwRow.appendChild(el("input")) as HTMLInputElement;
    pwInput.setAttribute("type", "password");
    pwInput.setAttribute("placeholder", "xxxx xxxx xxxx xxxx");
    pwInput.addEventListener("change", async () => {
      const accountId = inputs["account.id"]!.value || "default"; // key set by static field loop above
      if (this.host.saveSecret && pwInput.value) {
        await this.host.saveSecret(
          `smtp_imap:${accountId}:app-password`,
          pwInput.value,
        );
        pwInput.value = "••••••••••••••";
      }
    });

    // Provider help links — clickable buttons that open browser
    const helpContainer = containerEl.appendChild(
      el("div", { class: "sauce-smtpimap-help" }),
    );
    helpContainer.appendChild(el("h3", {}, "How to get an app password"));
    helpContainer.appendChild(
      el(
        "p",
        { class: "sauce-settings-hint" },
        "Click your email provider to open the app-password generation page. Follow the steps shown.",
      ),
    );

    for (const entry of PROVIDER_HELP) {
      const card = helpContainer.appendChild(
        el("div", { class: "sauce-help-card" }),
      );
      const header = card.appendChild(
        el("div", { class: "sauce-help-card-header" }),
      );
      header.appendChild(el("strong", {}, entry.label));
      if (entry.appPasswordUrl) {
        const btn = header.appendChild(
          el(
            "button",
            { class: "mod-cta sauce-help-link" },
            "Open app password page",
          ),
        ) as HTMLButtonElement;
        const url = entry.appPasswordUrl;
        btn.addEventListener("click", () => {
          if (this.host.openExternal) this.host.openExternal(url);
          else if (
            typeof window !== "undefined" &&
            (window as { open?: (u: string) => void }).open
          )
            (window as { open: (u: string) => void }).open(url);
        });
      }
      if (entry.oauthSetupUrl) {
        const ob = header.appendChild(
          el("button", { class: "sauce-help-link-secondary" }, "OAuth setup"),
        ) as HTMLButtonElement;
        const ourl = entry.oauthSetupUrl;
        ob.addEventListener("click", () => {
          if (this.host.openExternal) this.host.openExternal(ourl);
          else if (
            typeof window !== "undefined" &&
            (window as { open?: (u: string) => void }).open
          )
            (window as { open: (u: string) => void }).open(ourl);
        });
      }
      const steps = card.appendChild(el("ol", { class: "sauce-help-steps" }));
      for (const s of entry.steps) steps.appendChild(el("li", {}, s));
      if (entry.imap) {
        const hostLine = card.appendChild(
          el("p", { class: "sauce-settings-hint" }, ""),
        );
        hostLine.textContent = `Default IMAP: ${entry.imap.host}:${entry.imap.port} (implicit TLS) · SMTP: ${entry.smtp?.host ?? "(see provider)"}:${entry.smtp?.port ?? "?"}`;
      }
    }

    // Test connection
    const actions = containerEl.appendChild(
      el("div", { class: "sauce-settings-actions" }),
    );
    const testBtn = actions.appendChild(
      el("button", { class: "mod-cta" }, "Test connection"),
    ) as HTMLButtonElement;
    const status = actions.appendChild(
      el("span", { class: "sauce-settings-status" }),
    );
    testBtn.addEventListener("click", async () => {
      const accountId = inputs["account.id"]!.value || "default"; // key set by static field loop above
      if (!this.host.testConnection) {
        status.textContent = "Test handler not wired";
        return;
      }
      status.textContent = "Testing…";
      const r = await this.host.testConnection(accountId);
      status.textContent = r.ok
        ? `✓ ${r.message} (${r.latencyMs ?? "?"}ms)`
        : `✗ ${r.message}`;
    });

    // Security notice
    containerEl.appendChild(
      el(
        "div",
        { class: "sauce-security-notice" },
        "Security: Sauce Graph never accepts your real login password. App-specific passwords are encrypted at rest via libsodium secretbox in the KeyVault, gated by your master password. Passwords are zeroed in memory after each IMAP/SMTP call.",
      ),
    );
  }

  private autoDetect(
    email: string,
    inputs: Record<string, HTMLInputElement>,
  ): void {
    const help = helpForEmail(email);
    if (!help) return;
    if (help.imap) {
      inputs["account.imapHost"]!.value = help.imap.host; // key set by static field loop
      inputs["account.imapPort"]!.value = String(help.imap.port);
      void this.host.setConfig("account.imapHost", help.imap.host);
      void this.host.setConfig("account.imapPort", help.imap.port);
    }
    if (help.smtp) {
      inputs["account.smtpHost"]!.value = help.smtp.host; // key set by static field loop
      inputs["account.smtpPort"]!.value = String(help.smtp.port);
      void this.host.setConfig("account.smtpHost", help.smtp.host);
      void this.host.setConfig("account.smtpPort", help.smtp.port);
    }
  }

  static getHelp(emailOrId: string): ProviderHelpEntry | null {
    return helpForEmail(emailOrId) ?? helpById(emailOrId);
  }
}
