import { Setting } from "obsidian";
import type SauceGraphPlugin from "../../../main";
import { IntegrationCredentialsModal } from "../../modals/v2/IntegrationCredentialsModal";
import { PROVIDER_MANIFESTS, type CredentialProviderId } from "../../../integrations/IntegrationCredentials";

interface RailProvider {
  credId: CredentialProviderId;
  integrationId: string; // matches IntegrationRegistry.byId
  phase: string;
  /** True when the underlying IIntegration's connect() is fully wired (OAuth or API-key). */
  connectable: boolean;
}

const RAIL: RailProvider[] = [
  { credId: "google_workspace", integrationId: "google_workspace", phase: "P11", connectable: true },
  { credId: "microsoft_365",    integrationId: "microsoft_365",    phase: "P11", connectable: true },
  { credId: "notion",           integrationId: "notion",           phase: "P12", connectable: true },
  { credId: "twilio",           integrationId: "twilio",           phase: "P12", connectable: true },
  { credId: "anthropic",        integrationId: "anthropic",        phase: "P9",  connectable: false },
  { credId: "openai",           integrationId: "openai",           phase: "P9",  connectable: false },
  { credId: "nim",              integrationId: "nim",              phase: "P9",  connectable: false },
];

async function renderProviderPanel(panel: HTMLElement, plugin: SauceGraphPlugin, prov: RailProvider): Promise<void> {
  panel.empty();
  const manifest = PROVIDER_MANIFESTS[prov.credId];
  panel.createEl("h3", { text: manifest.label });
  panel.createEl("p", { cls: "setting-item-description", text: providerBlurb(prov.credId) });

  // 1. Credentials row — always visible. Opens the credentials modal.
  const credsRow = panel.createDiv({ cls: "sg-section-row" });
  const credStatus = await summarizeCreds(plugin, prov.credId);
  new Setting(credsRow)
    .setName(manifest.kind === "oauth" ? "OAuth client" : "API credentials")
    .setDesc(credStatus.text)
    .addButton((b) => b.setButtonText(credStatus.btn).setCta().onClick(() => {
      new IntegrationCredentialsModal(plugin, prov.credId).open();
    }));

  // 2. Connection row — only for IIntegration-backed providers (Google, MS, Notion, Twilio).
  const integ = (plugin.integrations as { byId?: (id: string) => unknown } | null)?.byId?.(prov.integrationId) as
    | { connect?: () => Promise<unknown>; disconnect?: () => Promise<void>; state?: () => Promise<{ connected: boolean; expiresAt?: number }> }
    | null;

  if (prov.connectable && integ) {
    let connState = { connected: false } as { connected: boolean; expiresAt?: number };
    try { connState = (await integ.state?.()) ?? connState; } catch { /* ignore */ }
    const connRow = panel.createDiv({ cls: "sg-section-row" });
    const statusText = connState.connected
      ? (connState.expiresAt ? `Connected · expires in ${Math.max(0, Math.floor((connState.expiresAt - Date.now()) / 60_000))}m` : "Connected")
      : "Disconnected";
    new Setting(connRow)
      .setName("Connection")
      .setDesc(statusText)
      .addButton((b) => b.setButtonText(connState.connected ? "Disconnect" : "Connect").onClick(async () => {
        try {
          if (connState.connected) await integ.disconnect?.();
          else await integ.connect?.();
          plugin.logger?.event?.("integrations.connect_toggle", { provider: prov.credId, connected: !connState.connected });
          await renderProviderPanel(panel, plugin, prov);
        } catch (e: unknown) {
          panel.createEl("p", { cls: "sg-error", text: `Error: ${e instanceof Error ? e.message : String(e)}` });
        }
      }));
  } else if (!prov.connectable) {
    panel.createEl("p", { cls: "setting-item-description", text: "Used by Copilot only — no separate connect step. Save the API key above and the Copilot section will pick it up." });
  }
}

function providerBlurb(id: CredentialProviderId): string {
  switch (id) {
    case "google_workspace": return "Calendar, Mail, Contacts, Drive. PKCE flow with your own Google OAuth client.";
    case "microsoft_365":    return "Calendar, Mail, Contacts, OneDrive. PKCE flow with your own Microsoft Entra app.";
    case "notion":           return "Workspace pages + databases. Uses an internal integration token.";
    case "twilio":           return "Programmable SMS / Voice. Account SID + auth token.";
    case "anthropic":        return "Claude models for the Copilot. Key only — no OAuth.";
    case "openai":           return "GPT models for the Copilot. Key only — no OAuth.";
    case "nim":              return "NVIDIA NIM cloud models (Llama 4 Maverick, Nemotron). NGC API key.";
  }
}

async function summarizeCreds(plugin: SauceGraphPlugin, id: CredentialProviderId): Promise<{ text: string; btn: string }> {
  const creds = plugin.credentials;
  if (!creds) return { text: "KeyVault not initialized — credentials unavailable.", btn: "Open" };
  if (plugin.keyVault?.isLocked()) return { text: "Vault locked — click to unlock and configure.", btn: "Unlock & configure" };
  const m = PROVIDER_MANIFESTS[id];
  if (m.kind === "oauth") {
    const cid = await creds.getKey(id, "client_id");
    return cid ? { text: `Client ID stored (${cid.slice(0, 8)}…)`, btn: "Edit" }
               : { text: "Not configured — paste OAuth client ID.", btn: "Configure" };
  } else if (m.keyFields) {
    let any = false;
    for (const f of m.keyFields) {
      const v = await creds.getKey(id, f.id);
      if (v) { any = true; break; }
    }
    return any ? { text: "Credentials saved.", btn: "Edit" } : { text: "Not configured.", btn: "Configure" };
  }
  return { text: "Not configured.", btn: "Configure" };
}

export function renderIntegrations(containerEl: HTMLElement, plugin: SauceGraphPlugin): void {
  plugin.logger?.debug?.("settings.section_render", { section: "integrations" });
  containerEl.createEl("h3", { text: "Integrations" });
  containerEl.createEl("p", {
    cls: "setting-item-description",
    text: "Connect external services. OAuth credentials and API keys land in the encrypted KeyVault — unlock once per session.",
  });

  const layout = containerEl.createDiv({ cls: "sg-integrations-layout" });
  const rail = layout.createDiv({ cls: "sg-integrations-rail" });
  const panel = layout.createDiv({ cls: "sg-integrations-panel" });

  const railButtons: Record<string, HTMLElement> = {};
  const setActive = (id: string) => {
    for (const [pid, el] of Object.entries(railButtons)) {
      el.toggleClass?.("is-active", pid === id);
    }
    const prov = RAIL.find((p) => p.credId === id)!;
    void renderProviderPanel(panel, plugin, prov);
  };
  for (const prov of RAIL) {
    const btn = rail.createEl("button", { text: PROVIDER_MANIFESTS[prov.credId].label, cls: "sg-rail-btn" });
    btn.onclick = () => setActive(prov.credId);
    railButtons[prov.credId] = btn;
  }
  setActive(RAIL[0].credId);
}
