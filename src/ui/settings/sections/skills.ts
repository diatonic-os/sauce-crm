import { Notice, Setting } from "obsidian";
import type SauceGraphPlugin from "../../../main";

const LEVELS = ["manual", "suggest", "assist", "auto"] as const;
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

interface TranscriptionUiSettings {
  binaryPath: string;
  model: string;
  preferDaemon: boolean;
}

/** Render the Whisper transcription controls: absolute binary path + Detect +
 *  Test (--help). The plugin NEVER installs whisper — these only point at an
 *  existing binary or defer to the daemon. */
function renderTranscription(
  containerEl: HTMLElement,
  plugin: SauceGraphPlugin,
): void {
  const s = plugin.settings as unknown as {
    transcription?: TranscriptionUiSettings;
  };
  const t: TranscriptionUiSettings = (s.transcription ??= {
    binaryPath: "",
    model: "large-v3-turbo",
    preferDaemon: true,
  });
  const save = () => plugin.saveSettings();

  containerEl.createEl("h3", { text: "Transcription (Whisper)" });
  containerEl.createEl("p", {
    cls: "sauce-field-help",
    text:
      "Local audio transcription via a Whisper CLI. The plugin never downloads " +
      "or installs Whisper — point it at an absolute binary path, or enable the " +
      "sauce-crm daemon (which can provision Whisper) and prefer it below.",
  });

  new Setting(containerEl)
    .setName("Whisper binary path")
    .setDesc(
      "Absolute path to the whisper CLI (e.g. /home/you/.venv/bin/whisper). " +
        "Relative paths and PATH lookups are rejected for safety.",
    )
    .addText((txt) =>
      txt
        .setPlaceholder("/absolute/path/to/whisper")
        .setValue(t.binaryPath)
        .onChange(async (v) => {
          t.binaryPath = v.trim();
          await save();
          // Re-wire the local engine so the change takes effect immediately.
          plugin.wireWhisperEngine?.();
        }),
    );

  new Setting(containerEl)
    .setName("Default model")
    .setDesc("Whisper model id (e.g. large-v3-turbo, base.en).")
    .addText((txt) =>
      txt
        .setPlaceholder("large-v3-turbo")
        .setValue(t.model)
        .onChange(async (v) => {
          t.model = v.trim() || "large-v3-turbo";
          await save();
          plugin.wireWhisperEngine?.();
        }),
    );

  new Setting(containerEl)
    .setName("Prefer daemon for transcription")
    .setDesc(
      "When the sauce-crm daemon advertises Whisper in /health, route " +
        "transcription to it (no local spawn needed).",
    )
    .addToggle((tog) =>
      tog.setValue(t.preferDaemon).onChange(async (v) => {
        t.preferDaemon = v;
        await save();
      }),
    );

  new Setting(containerEl)
    .setName("Detect binary")
    .setDesc("Scan common absolute install locations and offer what is found.")
    .addButton((b) =>
      b.setButtonText("Detect").onClick(async () => {
        const found = plugin.detectWhisperBinaries?.() ?? [];
        if (found.length === 0) {
          new Notice("No Whisper binary found in common locations.");
          return;
        }
        // Apply the first hit; surface all so the operator can adjust.
        t.binaryPath = found[0]!;
        await save();
        plugin.wireWhisperEngine?.();
        new Notice(
          `Found: ${found.join(", ")} — set to ${found[0]}. Edit if needed.`,
        );
        // Refresh so the text field shows the applied path.
        containerEl.empty();
        renderSkills(containerEl, plugin);
      }),
    );

  new Setting(containerEl)
    .setName("Test transcription")
    .setDesc(
      "Run a one-shot --help probe (exit 0) against the configured binary.",
    )
    .addButton((b) =>
      b.setButtonText("Test").onClick(async () => {
        const res = (await plugin.testWhisperBinary?.()) ?? {
          ok: false,
          message: "Test unavailable.",
        };
        new Notice(res.message);
      }),
    );
}

export function renderSkills(
  containerEl: HTMLElement,
  plugin: SauceGraphPlugin,
): void {
  plugin.logger?.debug?.("settings.section_render", { section: "skills" });
  // plugin.skills is SkillRuntime | null; narrow via the public field.
  const skillsRt = plugin.skills as {
    list?(): { id: string; description?: string }[];
    registry?: {
      getSettings?(id: string): { enabled?: boolean; autonomy?: string };
      setSettings?(id: string, patch: Record<string, unknown>): void;
    };
  } | null;
  if (!skillsRt) {
    const empty = containerEl.createDiv({ cls: "sg-empty-state" });
    empty.createEl("h4", { text: "Skills — coming soon" });
    empty.createEl("p", {
      text: "Skills runtime not initialized in this build.",
    });
    empty.createEl("span", { cls: "sg-phase-pill", text: "Phase P10" });
    return;
  }

  containerEl.createEl("h3", { text: "Skills" });

  const skills = skillsRt.list?.() ?? [];
  const s = plugin.settings as unknown as Record<string, unknown>;
  if (!s.skillsAutonomy) s.skillsAutonomy = "manual";
  const save = () => plugin.saveSettings();
  const rerender = () => {
    containerEl.empty();
    renderSkills(containerEl, plugin);
  };
  const setSkill = (id: string, patch: Record<string, unknown>) => {
    try {
      skillsRt.registry?.setSettings?.(id, patch);
    } catch {
      /* noop */
    }
  };

  // Master enable — enabling seeds every skill with the global autonomy.
  const masterOn =
    skills.length > 0 &&
    skills.every((sk) => skillsRt.registry?.getSettings?.(sk.id)?.enabled);
  new Setting(containerEl)
    .setName("Master enable")
    .setDesc(
      "Turn all skills on or off. Enabling sets each skill to the global autonomy below (Manual by default).",
    )
    .addToggle((t) =>
      t.setValue(masterOn).onChange(async (v) => {
        for (const sk of skills) {
          setSkill(sk.id, {
            enabled: v,
            ...(v && s.skillsAutonomy !== "custom"
              ? { autonomy: s.skillsAutonomy }
              : {}),
          });
        }
        await save();
        rerender();
      }),
    );

  // Global autonomy — concrete level applies to all; "Custom" → per-skill control.
  new Setting(containerEl)
    .setName("Autonomy (all skills)")
    .setDesc(
      "How much every skill may act without confirmation. Choose Custom to set each skill individually below.",
    )
    .addDropdown((d) => {
      for (const lvl of LEVELS) d.addOption(lvl, cap(lvl));
      d.addOption("custom", "Custom (per skill)");
      d.setValue(
        typeof s.skillsAutonomy === "string" ? s.skillsAutonomy : "manual",
      ).onChange(async (v) => {
        s.skillsAutonomy = v;
        if (v !== "custom")
          for (const sk of skills) setSkill(sk.id, { autonomy: v });
        await save();
        rerender();
      });
    });

  if (skills.length === 0) {
    containerEl.createEl("p", {
      cls: "sauce-field-help",
      text: "No skills registered.",
    });
    renderTranscription(containerEl, plugin);
    return;
  }

  const custom = s.skillsAutonomy === "custom";
  const tbl = containerEl.createEl("table", { cls: "sauce-settings-table" });
  const head = tbl.createEl("thead").createEl("tr");
  head.createEl("th", { text: "Skill" });
  head.createEl("th", { text: "Enabled", cls: "col-center" });
  head.createEl("th", { text: "Autonomy", cls: "col-center" });
  const tbody = tbl.createEl("tbody");

  for (const sk of skills) {
    const cur = skillsRt.registry?.getSettings?.(sk.id) ?? {};
    const tr = tbody.createEl("tr");

    const nameCell = tr.createEl("td");
    nameCell.createEl("strong", { text: sk.id });
    if (sk.description)
      nameCell.createEl("div", {
        cls: "sauce-skill-desc-sm",
        text: sk.description,
      });

    const enCell = tr.createEl("td", { cls: "col-center" });
    const cb = enCell.createEl("input", {
      type: "checkbox",
    }) as HTMLInputElement;
    cb.checked = !!cur.enabled;
    cb.onchange = async () => {
      setSkill(sk.id, { enabled: cb.checked });
      await save();
    };

    const autoCell = tr.createEl("td", { cls: "col-center" });
    const sel = autoCell.createEl("select", {
      cls: "dropdown sauce-skill-autonomy",
    }) as HTMLSelectElement;
    for (const lvl of LEVELS) {
      const o = sel.createEl("option", { text: cap(lvl) }) as HTMLOptionElement;
      o.value = lvl;
    }
    // Never blank: fall back to "manual" (|| also catches an empty string).
    sel.value = custom
      ? (typeof cur.autonomy === "string" && cur.autonomy) || "manual"
      : typeof s.skillsAutonomy === "string"
        ? s.skillsAutonomy
        : "manual";
    sel.disabled = !custom; // follows the global setting unless Custom
    sel.title = custom
      ? ""
      : "Set Autonomy (all skills) to Custom to edit per-skill.";
    sel.onchange = async () => {
      setSkill(sk.id, { autonomy: sel.value });
      await save();
    };
  }

  renderTranscription(containerEl, plugin);
}
