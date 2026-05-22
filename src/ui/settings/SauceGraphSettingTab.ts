// Addendum A §C — 8-tab settings surface with internal ids preserved + plain labels.
// Internal tab ids (TAB-BASIC, etc.) live in code/audit; visible labels live below.

import { App, PluginSettingTab } from "obsidian";
import type SauceGraphPlugin from "../../main";
import { renderBasic } from "./sections/basic";
import { renderVault } from "./sections/vault";
import { renderContracts } from "./sections/contracts";
import { renderCopilot } from "./sections/copilot";
import { renderSkills } from "./sections/skills";
import { renderIntegrations } from "./sections/integrations";
import { renderData } from "./sections/data";
import { renderAdvanced } from "./sections/advanced";

interface TabDef {
  id: string;
  label: string;
  tooltip: string;
  icon: string;
  render: (containerEl: HTMLElement, plugin: SauceGraphPlugin) => void;
}

const TABS: TabDef[] = [
  { id: "TAB-BASIC",        label: "Basic",        tooltip: "Get started; pick your vault layout; daily actions",                                       icon: "settings",     render: renderBasic },
  { id: "TAB-VAULT",        label: "Vault",        tooltip: "Where your notes live and how sub-vaults connect",                                          icon: "folder-tree",  render: renderVault },
  { id: "TAB-CONTRACTS",    label: "Validation",   tooltip: "Rules that keep your data clean and consistent",                                            icon: "shield-check", render: renderContracts },
  { id: "TAB-COPILOT",      label: "Copilot",      tooltip: "Your AI assistant — pick a provider and tune it",                                           icon: "sparkles",     render: renderCopilot },
  { id: "TAB-SKILLS",       label: "Skills",       tooltip: "AI helpers that run when you ask — turn on what you need",                                  icon: "zap",          render: renderSkills },
  { id: "TAB-INTEGRATIONS", label: "Integrations", tooltip: "Connect Google / Microsoft / Apple / Notion / Twilio / Email / Web Search",                 icon: "plug",         render: renderIntegrations },
  { id: "TAB-DATA",         label: "Data",         tooltip: "Backups; import; export; map; database; sync schedule",                                     icon: "database",     render: renderData },
  { id: "TAB-ADVANCED",     label: "Advanced",     tooltip: "Security; AI inference tuning; diagnostics; about",                                         icon: "wrench",       render: renderAdvanced },
];

export class SauceGraphSettingTab extends PluginSettingTab {
  constructor(app: App, public plugin: SauceGraphPlugin) { super(app, plugin); }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    // Header row
    const header = containerEl.createDiv({ cls: "sg-header" });
    header.createEl("h2", { text: "Sauce Graph" });
    const version = this.plugin.manifest?.version ?? "0.0.0";
    header.createEl("span", { cls: "sg-version", text: `v${version}` });

    // Tab strip (Addendum A §C + A11Y-01..03)
    const stripWrap = containerEl.createDiv({ cls: "sg-tab-strip" });
    stripWrap.setAttribute("role", "tablist");
    const activeId = this.plugin.settings.activeTab ?? "TAB-BASIC";

    const body = containerEl.createDiv({ cls: "sg-tab-content" });
    body.setAttribute("role", "tabpanel");

    for (const t of TABS) {
      const tab = stripWrap.createEl("button", { cls: "sg-tab", text: t.label });
      tab.setAttribute("role", "tab");
      tab.setAttribute("title", t.tooltip);
      tab.setAttribute("aria-label", t.label);
      tab.id = `sg-tab-${t.id}`;
      tab.setAttribute("aria-selected", String(t.id === activeId));
      tab.onclick = async () => {
        this.plugin.settings.activeTab = t.id;
        await this.plugin.saveSettings();
        // re-render in place (avoid full close/reopen — keeps scroll position elsewhere)
        for (const c of Array.from(stripWrap.children)) c.setAttribute("aria-selected", "false");
        tab.setAttribute("aria-selected", "true");
        this.renderTabBody(body, t);
      };
    }

    // Initial content render
    const active = TABS.find((t) => t.id === activeId) ?? TABS[0];
    body.setAttribute("aria-labelledby", `sg-tab-${active.id}`);
    this.renderTabBody(body, active);

    // Keyboard nav (A11Y-01 — arrow keys)
    stripWrap.addEventListener("keydown", (ev) => {
      const tabs = Array.from(stripWrap.children) as HTMLElement[];
      const cur = tabs.findIndex((el) => el.getAttribute("aria-selected") === "true");
      let next = cur;
      if (ev.key === "ArrowRight") next = (cur + 1) % tabs.length;
      else if (ev.key === "ArrowLeft") next = (cur - 1 + tabs.length) % tabs.length;
      else if (ev.key === "Home") next = 0;
      else if (ev.key === "End") next = tabs.length - 1;
      else return;
      ev.preventDefault();
      tabs[next].click();
      tabs[next].focus();
    });
  }

  private renderTabBody(body: HTMLElement, tab: TabDef): void {
    body.empty();
    body.setAttribute("aria-labelledby", `sg-tab-${tab.id}`);
    body.setAttribute("data-tab", tab.id);
    // honor showAdvanced[tab.id] via data attribute consumed by .sg-tab-strip[data-advanced-visible] CSS
    const adv = !!this.plugin.settings.showAdvanced?.[tab.id];
    body.setAttribute("data-advanced-visible", String(adv));
    try {
      tab.render(body, this.plugin);
    } catch (e: any) {
      const err = body.createDiv({ cls: "sauce-error" });
      err.setText(`Section ${tab.id} failed to render: ${e?.message ?? String(e)}`);
    }
  }
}
