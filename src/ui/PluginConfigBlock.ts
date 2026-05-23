// Renders the plugin auto-configuration dashboard into an element — used by the
// `sauce-plugin-config` code block (in _PLUGIN-CONFIG.md) and the
// "Plugin auto-config" command's modal. Propose-diff → apply-on-approval per
// the operator decision. Reuses existing sauce-cp-* / sauce-button styles so it
// needs no new CSS.

import { Notice } from "obsidian";
import type SauceGraphPlugin from "../main";

const STATE_LABEL: Record<string, string> = {
  "not-installed": "Not installed",
  installed: "Needs configuration",
  configured: "Configured ✓",
  drift: "Drifted from canon",
};

export async function renderPluginConfigBlock(
  el: HTMLElement,
  plugin: SauceGraphPlugin,
): Promise<void> {
  el.empty();
  el.addClass("sauce-cp-suggestions");
  const svc = plugin.pluginConfig;
  if (!svc) {
    el.createEl("p", {
      cls: "sauce-cp-empty",
      text: "Plugin auto-config not initialized.",
    });
    return;
  }

  const head = el.createDiv({ cls: "sauce-cp-sec" });
  head.createEl("h4", {
    cls: "sauce-cp-sec-title",
    text: "Plugin auto-configuration",
  });
  head.createEl("p", {
    cls: "sauce-cp-empty",
    text: "Sauce proposes canonical settings for supported plugins; nothing is written until you Apply. Changes back up + trace first, and take effect after reloading the plugin.",
  });
  const applyAll = head.createEl("button", { cls: "sauce-button" });
  applyAll.setText("Apply all proposed");

  const body = el.createDiv({ cls: "sauce-cp-sec" });
  body.createEl("p", { cls: "sauce-cp-empty", text: "loading…" });

  const render = async (): Promise<void> => {
    const rows = await svc.statusAll();
    body.empty();
    let anyActionable = false;
    for (const st of rows) {
      const card = body.createDiv({ cls: "sauce-cp-card" });
      const main = card.createDiv({ cls: "sauce-cp-card-main" });
      main.createEl("div", {
        cls: "sauce-cp-card-title",
        text: `${st.profile.label}  (${st.profile.kind})`,
      });
      const sub =
        STATE_LABEL[st.state] +
        (st.changes.length
          ? ` · ${st.changes.length} setting(s) to apply`
          : "");
      main.createEl("div", { cls: "sauce-cp-card-sub", text: sub });
      if (st.state === "installed" || st.state === "drift") {
        anyActionable = true;
        const apply = card.createEl("button", {
          cls: "sauce-button sauce-button-secondary",
        });
        apply.setText("Apply");
        apply.onclick = async () => {
          try {
            const changed = await svc.apply(st.profile);
            new Notice(
              changed.length
                ? `${st.profile.label}: applied ${changed.length} setting(s). Reload the plugin to take effect.`
                : `${st.profile.label}: nothing to apply.`,
            );
          } catch (e) {
            new Notice(
              `Apply failed: ${e instanceof Error ? e.message : String(e)}`,
            );
          }
          await render();
        };
      }
    }
    applyAll.disabled = !anyActionable;
    if (!rows.length)
      body.createEl("p", {
        cls: "sauce-cp-empty",
        text: "No supported plugins configured.",
      });
  };

  applyAll.onclick = async () => {
    try {
      const summary = await svc.applyAll();
      new Notice(
        summary.length
          ? `Auto-configured ${summary.length} plugin(s). Reload them to take effect.`
          : "All supported plugins already match canon.",
      );
    } catch (e) {
      new Notice(
        `Apply-all failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    await render();
  };

  await render();
}
