// Prompt + session management settings (PLAN T6). Global system prompt
// (prepended to every conversation) and the session autonaming toggle.
import { Setting } from "obsidian";
import type SauceGraphPlugin from "../../../main";
import { addToggleRow } from "../../components/v2/ToggleRow";

export function renderPrompts(containerEl: HTMLElement, plugin: SauceGraphPlugin): void {
  const prompts = plugin.settings.features.prompts;
  const save = () => plugin.saveSettings();

  containerEl.createEl("h3", { text: "Prompts & Sessions" });
  containerEl.createEl("p", {
    cls: "setting-item-description",
    text: "A global prompt is prepended to every conversation, ahead of the copilot's base prompt and any per-session override.",
  });

  new Setting(containerEl)
    .setName("Global system prompt")
    .setDesc("Always-on instructions sent before every session (e.g. tone, house rules).")
    .addTextArea((t) => t
      .setValue(prompts.globalSystemPrompt)
      .onChange(async (v) => { prompts.globalSystemPrompt = v; await save(); }));

  addToggleRow(containerEl, {
    name: "Session autonaming",
    desc: "Name new sessions automatically from their first message. Off ⇒ keep the default/session id.",
    value: prompts.sessionAutoNaming,
    onChange: async (v) => { prompts.sessionAutoNaming = v; await save(); },
  });
}
