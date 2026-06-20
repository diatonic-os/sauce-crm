// Per-integration credentials modal. Handles three provider shapes:
//   - oauth     : Client ID + (optional) Client Secret → "Connect" → PKCE flow → status row
//   - key       : single secret field → "Save to vault"
//   - key-pair  : id + secret pair (Twilio: SID + auth token)
//
// All values land in KeyVault via IntegrationCredentials. Modal refuses to
// open and surfaces an explicit unlock prompt if the vault is locked.

import { Modal, Notice, Setting, requestUrl } from "obsidian";
import { pingAnthropic } from "../../../saucebot/AnthropicPing";
import type SauceGraphPlugin from "../../../main";
import { InlineStatus } from "../../components/v2/InlineStatus";
import {
  IntegrationCredentials,
  PROVIDER_MANIFESTS,
  type CredentialProviderId,
} from "../../../integrations/IntegrationCredentials";
import { testProviderConnection } from "../../../saucebot/testProviderConnection";
import {
  sharedModelCatalog,
  type ProviderId,
} from "../../../saucebot/ModelCatalog";

/** Credential providers that are also SauceBot chat/embedding providers — saving
 *  a key for these triggers a live auth + model-load probe. */
const AI_PROVIDER_IDS = new Set<CredentialProviderId>([
  "anthropic",
  "openai",
  "nim",
]);

export class IntegrationCredentialsModal extends Modal {
  constructor(
    private readonly plugin: SauceGraphPlugin,
    private readonly providerId: CredentialProviderId,
  ) {
    super(plugin.app);
  }

  override onOpen(): void {
    const m = PROVIDER_MANIFESTS[this.providerId];
    this.titleEl.setText(`Connect — ${m.label}`);
    const root = this.contentEl;
    root.empty();
    root.addClass("sauce-modal");
    root.addClass("sg-creds-modal");

    const creds = this.plugin.credentials;
    if (!creds || !this.plugin.keyVault) {
      this.renderVaultMissing(root);
      return;
    }
    if (this.plugin.keyVault.isLocked()) {
      this.renderVaultLocked(root, creds);
      return;
    }

    if (m.kind === "oauth") this.renderOAuth(root, creds);
    else this.renderKeyFields(root, creds);
  }

  private renderVaultMissing(root: HTMLElement): void {
    const card = root.createDiv({ cls: "sg-empty-state" });
    card.createEl("h4", { text: "Vault unavailable" });
    card.createEl("p", {
      text: "KeyVault did not initialize. Check the V2 backend status in settings; credentials can only be stored encrypted.",
    });
  }

  private renderVaultLocked(
    root: HTMLElement,
    creds: IntegrationCredentials,
  ): void {
    const card = root.createDiv({ cls: "sg-creds-unlock" });
    card.createEl("h4", { text: "Unlock the credential vault" });
    card.createEl("p", {
      text: "Sauce CRM stores API keys and OAuth refresh tokens encrypted with AES-256-GCM. Enter the master password you set on first unlock.",
    });
    let pw = "";
    new Setting(card).setName("Master password").addText((t) => {
      t.inputEl.type = "password";
      t.onChange((v) => {
        pw = v;
      });
    });
    new Setting(card).addButton((b) =>
      b
        .setButtonText("Unlock")
        .setCta()
        .onClick(async () => {
          try {
            await this.plugin.keyVault!.unlock(pw);
            await creds.hydrateOAuthConfigs();
            new Notice("Vault unlocked");
            this.onOpen(); // re-render with vault open
          } catch (e: unknown) {
            new Notice(
              `Unlock failed: ${e instanceof Error ? e.message : String(e)}`,
            );
          }
        }),
    );
  }

  private async renderOAuth(
    root: HTMLElement,
    creds: IntegrationCredentials,
  ): Promise<void> {
    const m = PROVIDER_MANIFESTS[this.providerId];
    root.createEl("p", {
      cls: "setting-item-description",
      text: `Bring-your-own OAuth client. Create an OAuth 2.0 app in the ${m.label} developer console, set the redirect URI to http://127.0.0.1:0/cb (any loopback port works — the plugin picks one at flow time), then paste your client ID and secret below.`,
    });

    const existingId = (await creds.getKey(this.providerId, "client_id")) ?? "";
    const existingSecret =
      (await creds.getKey(this.providerId, "client_secret")) ?? "";
    let cid = existingId;
    let csec = existingSecret;

    new Setting(root).setName("Client ID").addText((t) =>
      t
        .setPlaceholder("xxx.apps.googleusercontent.com / appid-uuid")
        .setValue(cid)
        .onChange((v) => {
          cid = v;
        }),
    );

    new Setting(root)
      .setName("Client Secret (optional for public clients)")
      .addText((t) => {
        t.inputEl.type = "password";
        t.setPlaceholder(
          "leave blank if your OAuth app is a public client (PKCE-only)",
        )
          .setValue(csec)
          .onChange((v) => {
            csec = v;
          });
      });

    if (!creds.oauthAvailable()) {
      root.createEl("p", {
        cls: "sg-error",
        text: "OAuth flow requires desktop Obsidian (Node http + Electron shell). This build appears to be mobile or sandboxed.",
      });
    }

    const ts = creds.oauth.current(this.providerId);
    const statusRow = root.createDiv({ cls: "sg-creds-status" });
    if (ts) {
      const ttl = Math.max(0, Math.floor((ts.expiresAt - Date.now()) / 60_000));
      statusRow.createEl("span", {
        text: `Connected · ${ts.scopes.length} scope${ts.scopes.length === 1 ? "" : "s"} · expires in ${ttl}m`,
      });
    } else {
      statusRow.createEl("span", { text: "Not connected." });
    }

    const status = new InlineStatus(root);
    const btns = root.createDiv({ cls: "sg-creds-buttons" });
    btns.createEl("button", {
      cls: "sauce-button",
      text: "Save client config",
    }).onclick = async () => {
      if (!cid) {
        status.error("Client ID is required");
        return;
      }
      status.pending("Saving…");
      try {
        await creds.configureOAuth(this.providerId, cid, csec || undefined);
        status.success("Client config saved to vault");
      } catch (e: unknown) {
        status.error(e instanceof Error ? e.message : String(e));
      }
    };
    const connectBtn = btns.createEl("button", {
      cls: "sauce-button mod-cta",
      text: ts ? "Reconnect" : "Connect",
    });
    connectBtn.onclick = async () => {
      if (!cid) {
        status.error("Save client config first");
        return;
      }
      // Make sure latest config is registered before authorize()
      await creds.configureOAuth(this.providerId, cid, csec || undefined);
      try {
        status.pending("Waiting for browser…");
        connectBtn.setText("Waiting for browser…");
        connectBtn.setAttribute("disabled", "true");
        await creds.connectOAuth(this.providerId);
        new Notice(`${m.label} connected`);
        this.onOpen(); // refresh status
      } catch (e: unknown) {
        status.error(
          `Connect failed: ${e instanceof Error ? e.message : String(e)}`,
        );
        connectBtn.removeAttribute("disabled");
        connectBtn.setText(ts ? "Reconnect" : "Connect");
      }
    };
    if (ts) {
      btns.createEl("button", {
        cls: "sauce-button",
        text: "Disconnect",
      }).onclick = async () => {
        await creds.disconnectOAuth(this.providerId);
        new Notice(`${m.label} disconnected`);
        this.onOpen();
      };
    }
  }

  private async renderKeyFields(
    root: HTMLElement,
    creds: IntegrationCredentials,
  ): Promise<void> {
    const m = PROVIDER_MANIFESTS[this.providerId];
    if (!m.keyFields) return;
    root.createEl("p", {
      cls: "setting-item-description",
      text: `Paste your ${m.label} credentials. Values are stored encrypted in the local KeyVault — never sent anywhere.`,
    });

    const values: Record<string, string> = {};
    for (const f of m.keyFields) {
      const cur = (await creds.getKey(this.providerId, f.id)) ?? "";
      values[f.id] = cur;
      new Setting(root).setName(f.label).addText((t) => {
        if (f.secret) t.inputEl.type = "password";
        t.setValue(cur).onChange((v) => {
          values[f.id] = v;
        });
      });
    }

    const status = new InlineStatus(root);
    const btns = root.createDiv({ cls: "sg-creds-buttons" });
    btns.createEl("button", {
      cls: "sauce-button mod-cta",
      text: "Save to vault",
    }).onclick = async () => {
      status.pending("Saving…");
      try {
        for (const f of m.keyFields!) {
          const fieldVal = values[f.id];
          if (fieldVal) await creds.putKey(this.providerId, f.id, fieldVal);
        }
        // For AI providers, immediately validate the key + load the model
        // catalog so the user sees auth health + available models (and the
        // SauceBot picker is populated). The key is already in the secure
        // KeyVault; this probe is live and secret-free.
        if (AI_PROVIDER_IDS.has(this.providerId)) {
          status.pending("Validating key + loading models…");
          const apiKey = values[m.keyFields![0]!.id];
          // Anthropic has no live /models endpoint, so do a real 1-token auth
          // ping (catches a bad key the static catalog would miss) before the
          // model-load probe.
          if (this.providerId === "anthropic" && apiKey) {
            const ping = await pingAnthropic(apiKey, (url, init) =>
              requestUrl({
                url,
                method: init.method,
                headers: init.headers,
                body: init.body,
                throw: false,
              }).then((rr) => ({ status: rr.status })),
            );
            if (!ping.ok) {
              status.error(ping.error ?? "Anthropic key check failed.");
              return;
            }
          }
          const r = await testProviderConnection({
            provider: this.providerId as ProviderId,
            ...(apiKey ? { apiKey } : {}),
            logger: this.plugin.logger ?? null,
          });
          if (r.ok) {
            status.success(
              `✓ Authenticated · ${r.modelCount} model${r.modelCount === 1 ? "" : "s"} available`,
            );
            this.autoConfigureSauceBot();
          } else {
            status.error(`Saved, but key check failed: ${r.detail}`);
          }
        } else {
          status.success(`${m.label} credentials saved to vault`);
        }
      } catch (e: unknown) {
        status.error(e instanceof Error ? e.message : String(e));
      }
    };
    btns.createEl("button", { cls: "sauce-button", text: "Clear" }).onclick =
      async () => {
        status.pending("Clearing…");
        try {
          for (const f of m.keyFields!) {
            // empty string write so KeyVault.get returns "" rather than missing-key throw
            await creds.putKey(this.providerId, f.id, "");
          }
          status.success("Cleared");
        } catch (e: unknown) {
          status.error(e instanceof Error ? e.message : String(e));
        }
      };
  }

  /**
   * On first-time setup (no chat model chosen yet) adopt this provider for
   * SauceBot so chat works straight after key entry — endpoint is built in for
   * cloud providers (ModelCatalog default base URLs). Never hijacks an
   * already-configured provider. Always refreshes the catalog so the picker
   * shows the newly-authorized models.
   */
  private autoConfigureSauceBot(): void {
    try {
      const cfg = this.plugin.settings.copilot;
      if (!cfg.model) {
        cfg.provider = this.providerId as ProviderId;
        void this.plugin.saveSettings();
        this.plugin.copilot?.updateSettings?.({ provider: cfg.provider });
      }
      // Bust the 30s catalog cache so the picker reflects the new auth now.
      sharedModelCatalog(this.plugin.logger ?? null).invalidate();
    } catch {
      /* best-effort auto-config; the key + validation already succeeded */
    }
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}
