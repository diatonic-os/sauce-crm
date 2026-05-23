import type SauceGraphPlugin from "../../../main";
import { IntegrationCredentialsModal } from "../../modals/v2/IntegrationCredentialsModal";
import { PROVIDER_MANIFESTS, type CredentialProviderId } from "../../../integrations/IntegrationCredentials";
import {
  detectCommunityPlugins,
  openCommunityPluginsPage,
  type CommunityPluginStatus,
} from "../../../services/CommunityPluginInstaller";

// ── Grouping ────────────────────────────────────────────────────────
// AI & Intelligence: model providers the Copilot/Skills runtimes call.
const AI_PROVIDERS: CredentialProviderId[] = ["anthropic", "openai", "nim"];
// 3rd-party tools that are fully wired (credentials + IIntegration connect).
const THIRD_PARTY_WIRED: CredentialProviderId[] = ["google_workspace", "microsoft_365", "notion", "twilio"];
// 3rd-party tools requested but not yet wired — honest "coming soon" cards
// (no credential manifest exists, so we don't fake a Configure button).
const THIRD_PARTY_SOON: { name: string; blurb: string; phase: string }[] = [
  { name: "Airtable",   blurb: "Two-way sync of bases ↔ vault entities.",                phase: "P15" },
  { name: "Wix Studio", blurb: "Publish and sync CMS collections into your graph.",      phase: "P15" },
  { name: "Supabase",   blurb: "Mirror entities to Postgres for realtime apps.",         phase: "P15" },
];
// Providers that expose an IIntegration connect()/disconnect() step.
const CONNECTABLE = new Set<string>(["google_workspace", "microsoft_365", "notion", "twilio"]);

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

async function summarizeCreds(plugin: SauceGraphPlugin, id: CredentialProviderId): Promise<{ text: string; btn: string; ok: boolean }> {
  const creds = plugin.credentials;
  if (!creds) return { text: "KeyVault not initialized — credentials unavailable.", btn: "Open", ok: false };
  if (plugin.keyVault?.isLocked()) return { text: "Vault locked — click to unlock and configure.", btn: "Unlock & configure", ok: false };
  const m = PROVIDER_MANIFESTS[id];
  if (m.kind === "oauth") {
    const cid = await creds.getKey(id, "client_id");
    return cid ? { text: `Client ID stored (${cid.slice(0, 8)}…)`, btn: "Edit", ok: true }
               : { text: "Not configured — paste OAuth client ID.", btn: "Configure", ok: false };
  } else if (m.keyFields) {
    for (const f of m.keyFields) {
      if (await creds.getKey(id, f.id)) return { text: "Credentials saved.", btn: "Edit", ok: true };
    }
    return { text: "Not configured.", btn: "Configure", ok: false };
  }
  return { text: "Not configured.", btn: "Configure", ok: false };
}

/** A bare card shell: title + a status badge slot in the header. */
function cardShell(grid: HTMLElement, title: string, badgeText?: string, badgeMod = ""): { card: HTMLElement; foot: HTMLElement } {
  const card = grid.createDiv({ cls: "sauce-card" });
  const head = card.createDiv({ cls: "sauce-card-head" });
  head.createEl("h4", { text: title, cls: "sauce-card-title" });
  if (badgeText) head.createEl("span", { cls: `sauce-badge${badgeMod ? " " + badgeMod : ""}`, text: badgeText });
  const foot = card.createDiv({ cls: "sauce-card-foot" });
  return { card, foot };
}

async function buildProviderCard(grid: HTMLElement, plugin: SauceGraphPlugin, credId: CredentialProviderId, rerender: () => void): Promise<void> {
  const m = PROVIDER_MANIFESTS[credId];
  const { card, foot } = cardShell(grid, m.label, m.kind === "oauth" ? "OAuth" : "API key", "sauce-badge--muted");
  // Insert blurb + status above the footer (which cardShell appended last).
  const blurb = createDiv({ cls: "sauce-card-meta", text: providerBlurb(credId) });
  const status = createDiv({ cls: "sauce-card-status", text: "Checking credentials…" });
  card.insertBefore(blurb, foot);
  card.insertBefore(status, foot);

  const cfgBtn = foot.createEl("button", { cls: "sauce-btn sauce-btn--primary", text: "Configure" });
  cfgBtn.onclick = () => new IntegrationCredentialsModal(plugin, credId).open();

  const s = await summarizeCreds(plugin, credId);
  status.setText(s.text);
  status.toggleClass("is-ok", s.ok);
  cfgBtn.setText(s.btn);

  if (!CONNECTABLE.has(credId)) {
    status.createEl("span", { cls: "sauce-card-hint", text: " Used by Copilot — save the key and the Copilot tab picks it up." });
    return;
  }

  // Connect/disconnect for IIntegration-backed providers.
  const integ = (plugin.integrations as { byId?: (id: string) => unknown } | null)?.byId?.(credId) as
    | { connect?: () => Promise<unknown>; disconnect?: () => Promise<void>; state?: () => Promise<{ connected: boolean; expiresAt?: number }> }
    | null;
  if (!integ) return;
  let conn = { connected: false } as { connected: boolean; expiresAt?: number };
  try { conn = (await integ.state?.()) ?? conn; } catch { /* ignore */ }
  status.setText(conn.connected
    ? (conn.expiresAt ? `Connected · expires in ${Math.max(0, Math.floor((conn.expiresAt - Date.now()) / 60_000))}m` : "Connected")
    : s.text);
  status.toggleClass("is-ok", conn.connected || s.ok);
  const connBtn = foot.createEl("button", { cls: "sauce-btn sauce-btn--secondary", text: conn.connected ? "Disconnect" : "Connect" });
  connBtn.onclick = async () => {
    try {
      if (conn.connected) await integ.disconnect?.();
      else await integ.connect?.();
      plugin.logger?.event?.("integrations.connect_toggle", { provider: credId, connected: !conn.connected });
    } catch (e: unknown) {
      status.setText(`Error: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    rerender();
  };
}

function buildComingSoonCard(grid: HTMLElement, cs: { name: string; blurb: string; phase: string }): void {
  const { card, foot } = cardShell(grid, cs.name, "Coming soon");
  const blurb = createDiv({ cls: "sauce-card-meta", text: cs.blurb });
  card.insertBefore(blurb, foot);
  const pill = foot.createEl("button", { cls: "sauce-btn sauce-btn--secondary", text: cs.phase });
  pill.disabled = true;
}

function buildCommunityCard(grid: HTMLElement, plugin: SauceGraphPlugin, st: CommunityPluginStatus, rerender: () => void): void {
  const state = st.enabled ? "Enabled" : st.installed ? "Installed" : "Not installed";
  const mod = st.enabled ? "sauce-badge--ok" : "sauce-badge--muted";
  const { card, foot } = cardShell(grid, st.spec.name, state, mod);
  const blurb = createDiv({ cls: "sauce-card-meta", text: st.spec.purpose });
  card.insertBefore(blurb, foot);

  const app = plugin.app as unknown as {
    plugins?: { enablePluginAndSave?: (id: string) => Promise<void>; enablePlugin?: (id: string) => Promise<void> };
  };
  if (st.enabled) {
    foot.createEl("button", { cls: "sauce-btn sauce-btn--secondary", text: "Open settings" }).onclick =
      () => openCommunityPluginsPage(plugin.app as never);
  } else if (st.installed) {
    const b = foot.createEl("button", { cls: "sauce-btn sauce-btn--primary", text: "Enable" });
    b.onclick = async () => {
      try { await (app.plugins?.enablePluginAndSave ?? app.plugins?.enablePlugin)?.call(app.plugins, st.spec.id); }
      finally { rerender(); }
    };
  } else {
    foot.createEl("button", { cls: "sauce-btn sauce-btn--primary", text: "Install ↗" }).onclick =
      () => openCommunityPluginsPage(plugin.app as never, st.spec.id);
  }
}

function sectionTitle(containerEl: HTMLElement, text: string, desc: string): void {
  containerEl.createEl("h3", { text, cls: "sauce-settings-section-title" });
  containerEl.createEl("p", { cls: "setting-item-description", text: desc });
}

export function renderIntegrations(containerEl: HTMLElement, plugin: SauceGraphPlugin): void {
  plugin.logger?.debug?.("settings.section_render", { section: "integrations" });
  const rerender = () => { containerEl.empty(); renderIntegrations(containerEl, plugin); };

  containerEl.createEl("h3", { text: "Integrations" });
  containerEl.createEl("p", {
    cls: "setting-item-description",
    text: "Connect external services. OAuth credentials and API keys land in the encrypted KeyVault — unlock once per session.",
  });

  // ── 1. AI & Intelligence ──────────────────────────────────────────
  sectionTitle(containerEl, "AI & Intelligence", "Model providers the Copilot and Skills runtimes call. Pick models per-runtime in the Copilot tab.");
  const aiGrid = containerEl.createDiv({ cls: "sauce-card-grid" });
  for (const id of AI_PROVIDERS) void buildProviderCard(aiGrid, plugin, id, rerender);

  // ── 2. 3rd-party tools ────────────────────────────────────────────
  sectionTitle(containerEl, "3rd-party tools", "Productivity and data services. Connected accounts sync into your vault graph.");
  const toolGrid = containerEl.createDiv({ cls: "sauce-card-grid" });
  for (const id of THIRD_PARTY_WIRED) void buildProviderCard(toolGrid, plugin, id, rerender);
  for (const cs of THIRD_PARTY_SOON) buildComingSoonCard(toolGrid, cs);

  // ── 3. Community plugins ──────────────────────────────────────────
  sectionTitle(containerEl, "Community plugins", "Obsidian plugins Sauce CRM works best with. Install opens the official community-plugin page — nothing is installed silently.");
  const pluginGrid = containerEl.createDiv({ cls: "sauce-card-grid" });
  const statuses = detectCommunityPlugins(plugin.app as never);
  for (const st of statuses) buildCommunityCard(pluginGrid, plugin, st, rerender);
  // Core plugins entry point — toggled in Obsidian's own settings tab.
  const { foot } = cardShell(pluginGrid, "Core plugins", "Built-in", "sauce-badge--muted");
  foot.createEl("button", { cls: "sauce-btn sauce-btn--secondary", text: "Open core plugins ↗" }).onclick = () => {
    const setting = (plugin.app as unknown as { setting?: { open?: () => void; openTabById?: (id: string) => void } }).setting;
    setting?.open?.();
    setting?.openTabById?.("core-plugins");
  };
}
