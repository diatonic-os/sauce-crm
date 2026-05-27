import { Setting, Notice, setIcon } from "obsidian";
import type SauceGraphPlugin from "../../../main";

function markAdvanced(set: Setting): Setting {
  set.settingEl.addClass("sg-advanced");
  return set;
}

function runCommand(plugin: SauceGraphPlugin, id: string): void {
  // Bare ids are prefixed with the plugin's manifest id (e.g. "sauce-crm:");
  // hardcoding "sauce-graph:" broke after the rename.
  const full = id.includes(":") ? id : `${plugin.manifest.id}:${id}`;
  // app.commands is ambient-typed in src/types/obsidian-augment.ts
  plugin.app.commands?.executeCommandById?.(full);
}

export function renderBasic(
  containerEl: HTMLElement,
  plugin: SauceGraphPlugin,
): void {
  plugin.logger?.debug?.("settings.section_render", { section: "basic" });
  // settings only types the public contract; this section reads/writes
  // additional dynamic keys (hasDismissedFirstRun, hasInitialized, vaultName,
  // defaultCadence, language, telemetry, debugLogging) some of which live in
  // the typed interface and some are stored as extra JSON fields.
  const s = plugin.settings as unknown as Record<string, unknown>;

  // ── Sauce Plus hero (coming soon) — models the Copilot Plus hero card ──
  const hero = containerEl.createDiv({ cls: "sauce-hero sauce-hero--plus" });
  const heroHead = hero.createDiv({ cls: "sauce-hero-head" });
  heroHead.createEl("h3", { text: "Sauce Plus", cls: "sauce-hero-title" });
  heroHead.createEl("span", { text: "Coming soon", cls: "sauce-badge" });
  hero.createEl("p", {
    cls: "sauce-hero-body",
    text: "Sauce Plus takes your vault CRM further: hosted sync, multi-vault federation at scale, shared OAuth relays, and premium SauceBot models — without leaving Obsidian. Join the waitlist to lock in early-access pricing.",
  });
  const heroRow = hero.createDiv({ cls: "sauce-hero-row" });
  const lic = heroRow.createEl("input", {
    cls: "sauce-input sauce-hero-input",
  });
  lic.type = "text";
  lic.placeholder = "Enter your license key";
  lic.disabled = true;
  const applyBtn = heroRow.createEl("button", {
    text: "Apply",
    cls: "sauce-btn sauce-btn--primary",
  });
  applyBtn.disabled = true;
  const joinBtn = heroRow.createEl("button", {
    text: "Join waitlist  ↗",
    cls: "sauce-btn sauce-btn--secondary",
  });
  joinBtn.onclick = () =>
    window.open("https://github.com/Diatonic-OS/sauce-crm", "_blank");

  // First-run banner
  if (s.hasDismissedFirstRun !== true && s.hasInitialized !== true) {
    const banner = containerEl.createDiv({ cls: "sg-first-run-banner" });
    const head = banner.createDiv({ cls: "sg-first-run-head" });
    head.createEl("h3", { text: "Welcome to Sauce Graph" });
    const dismiss = head.createEl("button", {
      text: "×",
      cls: "sg-first-run-dismiss",
    });
    dismiss.onclick = async () => {
      s.hasDismissedFirstRun = true;
      await plugin.saveSettings();
      banner.remove();
    };
    banner.createEl("p", {
      text: "Get started by bootstrapping your vault structure. This creates the folders for people, organizations, touches, notes, ideas, observations, tasks, events, ledger entries, pipeline deals, and your $user workspace.",
    });
    const startBtn = banner.createEl("button", {
      text: "Start",
      cls: "mod-cta",
    });
    startBtn.onclick = async () => {
      try {
        await plugin.bootstrap?.ensure?.();
        s.hasInitialized = true;
        await plugin.saveSettings();
        new Notice("Sauce Graph initialized.");
        banner.remove();
      } catch (e: unknown) {
        new Notice(`Bootstrap failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    };
  }

  // Getting started — wizard / walkthrough / reset
  containerEl.createEl("h3", {
    text: "Getting started",
    cls: "sauce-settings-section-title",
  });
  const gs = containerEl.createDiv({ cls: "sauce-button-row" });
  const gsBtn = (
    label: string,
    icon: string,
    primary: boolean,
    fn: () => void,
  ) => {
    const b = gs.createEl("button", {
      cls: `sauce-btn ${primary ? "sauce-btn--primary" : "sauce-btn--secondary"}`,
    });
    setIcon(b.createSpan({ cls: "sauce-btn-icon" }), icon);
    b.createSpan({ text: label });
    b.onclick = fn;
  };
  gsBtn("Initialization wizard", "wand", true, () =>
    runCommand(plugin, "onboarding"),
  );
  gsBtn("Walkthrough", "book-open", false, () =>
    runCommand(plugin, "onboarding"),
  );
  gsBtn("Reset & reload settings", "rotate-ccw", false, async () => {
    if (
      !window.confirm(
        "Reset onboarding state and reload settings? Your notes, keys, and integrations are not affected.",
      )
    )
      return;
    s.hasInitialized = false;
    s.hasDismissedFirstRun = false;
    await plugin.saveSettings();
    new Notice("Settings reloaded.");
    containerEl.empty();
    renderBasic(containerEl, plugin);
  });

  // At a glance — KPI cards
  containerEl.createEl("h3", {
    text: "At a glance",
    cls: "sauce-settings-section-title",
  });
  const kpis = containerEl.createDiv({ cls: "sauce-view-kpis" });
  const peopleCount = plugin.entityService?.allPeople?.()?.length ?? 0;
  const orgsCount = plugin.entityService?.allOrgs?.()?.length ?? 0;
  const touchesCount = plugin.entityService?.allTouches?.()?.length ?? 0;
  const mkStat = (
    label: string,
    value: number,
    icon: string,
    commandId: string,
  ) => {
    const cell = kpis.createEl("button", {
      cls: "sauce-kpi sauce-kpi--btn",
      attr: { "aria-label": label },
    });
    setIcon(cell.createDiv({ cls: "sauce-kpi-icon" }), icon);
    cell.createDiv({ cls: "value", text: String(value) });
    cell.createDiv({ cls: "label", text: label });
    cell.onclick = () => runCommand(plugin, commandId);
  };
  mkStat("People", peopleCount, "users", "open-dashboard");
  mkStat("Organizations", orgsCount, "building-2", "open-dashboard");
  mkStat("Touches", touchesCount, "activity", "open-dashboard");

  // Quick actions — styled button row
  containerEl.createEl("h3", {
    text: "Quick actions",
    cls: "sauce-settings-section-title",
  });
  const actions = containerEl.createDiv({ cls: "sauce-button-row" });
  const mkBtn = (
    label: string,
    icon: string,
    commandId: string,
    primary = false,
  ) => {
    const b = actions.createEl("button", {
      cls: `sauce-btn ${primary ? "sauce-btn--primary" : "sauce-btn--secondary"}`,
    });
    setIcon(b.createSpan({ cls: "sauce-btn-icon" }), icon);
    b.createSpan({ text: label });
    b.onclick = () => runCommand(plugin, commandId);
  };
  mkBtn("New person", "user-plus", "new-person", true);
  mkBtn("Log touch", "message-circle", "log-touch");
  mkBtn("Open dashboard", "layout-dashboard", "open-dashboard");

  // Default-visible settings
  containerEl.createEl("h3", { text: "Settings" });

  new Setting(containerEl)
    .setName("Vault name")
    .setDesc("Display name used in banners and exports.")
    .addText((t) =>
      t.setValue(typeof s.vaultName === "string" ? s.vaultName : "").onChange(async (v) => {
        s.vaultName = v;
        await plugin.saveSettings();
      }),
    );

  const cadenceEnum: string[] = plugin.settings.enums?.["cadence"] ?? [
    "weekly",
    "monthly",
    "quarterly",
    "annual",
  ];
  new Setting(containerEl)
    .setName("Default cadence")
    .setDesc(
      "How often you'd like to keep in touch with new contacts by default.",
    )
    .addDropdown((d) => {
      for (const c of cadenceEnum) d.addOption(c, c);
      d.setValue(typeof s.defaultCadence === "string" ? s.defaultCadence : (cadenceEnum[0] ?? "")).onChange(async (v) => {
        s.defaultCadence = v;
        await plugin.saveSettings();
      });
    });

  new Setting(containerEl)
    .setName("Language")
    .setDesc("Interface language.")
    .addDropdown((d) =>
      d
        .addOption("en", "English")
        .addOption("es", "Español")
        .addOption("fr", "Français")
        .setValue(typeof s.language === "string" ? s.language : "en")
        .onChange(async (v) => {
          s.language = v;
          await plugin.saveSettings();
        }),
    );

  new Setting(containerEl)
    .setName("Telemetry")
    .setDesc("Send anonymous usage statistics. Off by default.")
    .addToggle((t) =>
      t.setValue(s.telemetry === true).onChange(async (v) => {
        s.telemetry = v;
        await plugin.saveSettings();
      }),
    );

  // Advanced
  containerEl.createEl("h3", { text: "Advanced" });

  markAdvanced(
    new Setting(containerEl)
      .setName("Debug logging")
      .setDesc("Verbose log output to console.")
      .addToggle((t) =>
        t.setValue(s.debugLogging === true).onChange(async (v) => {
          s.debugLogging = v;
          await plugin.saveSettings();
        }),
      ),
  );

  markAdvanced(
    new Setting(containerEl)
      .setName("Reset all settings")
      .setDesc("Restore plugin defaults. Vault data is not touched.")
      .addButton((b) =>
        b
          .setButtonText("Reset…")
          .setWarning()
          .onClick(async () => {
            const ok = window.confirm(
              "Reset all plugin settings to defaults? Vault files are not deleted.",
            );
            if (!ok) return;
            try {
              await (plugin as unknown as { resetSettings?(): Promise<void> }).resetSettings?.();
              new Notice("Settings reset.");
            } catch {
              new Notice("Reset not yet wired; manual file edit required.");
            }
          }),
      ),
  );
}
