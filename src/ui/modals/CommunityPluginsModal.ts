// Modal that surfaces missing community plugins with per-plugin
// "Install" buttons + a "Don't ask again" toggle. Reuses the LanceDB
// modal's stylistic shape.

import { Modal, type App, Notice } from "obsidian";
import {
  detectCommunityPlugins,
  openCommunityPluginsPage,
  type CommunityPluginStatus,
} from "../../services/CommunityPluginInstaller";

export interface CommunityPluginsModalOpts {
  app: App;
  /** Persisted across reloads — when true, the modal never opens
   *  automatically again (still reachable from Settings). */
  initiallySuppressed: boolean;
  onDecision: (suppressFuturePrompts: boolean) => Promise<void>;
}

export class CommunityPluginsModal extends Modal {
  constructor(private readonly opts: CommunityPluginsModalOpts) {
    super(opts.app);
  }

  onOpen(): void {
    this.modalEl.addClass("sauce-modal");
    this.titleEl.setText("Sauce CRM — Community Plugin Integrations");
    const c = this.contentEl;
    c.empty();

    const intro = c.createDiv({ cls: "sauce-section" });
    intro.createEl("p", {
      text:
        "Sauce CRM integrates with several Obsidian community plugins. " +
        "Installing them unlocks the Pipeline / Tasks / Calendar dashboards.",
    });
    intro.createEl("p", {
      cls: "sauce-field-help",
      text:
        "Each plugin installs via Obsidian's official Settings → Community " +
        "plugins page — we never install silently. Click 'Install' next to " +
        "any row to jump to its install page.",
    });

    const statuses = detectCommunityPlugins(this.opts.app as unknown as Parameters<typeof detectCommunityPlugins>[0]);
    const list = c.createDiv({ cls: "sauce-card-grid" });
    for (const s of statuses) {
      this.renderRow(list, s);
    }

    // Footer.
    const footer = c.createDiv({ cls: "sauce-modal-footer sauce-button-row" });
    const noAskRow = footer.createEl("label", { cls: "sauce-clickable" });
    const cb = noAskRow.createEl("input", { type: "checkbox" });
    cb.checked = this.opts.initiallySuppressed;
    noAskRow.appendText(" Don't prompt automatically again");

    const closeBtn = footer.createEl("button", {
      cls: "sauce-button-secondary",
      text: "Close",
    });
    closeBtn.onclick = async () => {
      await this.opts.onDecision(cb.checked);
      this.close();
    };
  }

  private renderRow(parent: HTMLElement, s: CommunityPluginStatus): void {
    const card = parent.createDiv({ cls: "sauce-card" });
    const head = card.createDiv({ cls: "sauce-section-header" });
    head.createEl("h4", { cls: "sauce-card-title", text: s.spec.name });
    const badge = head.createSpan({
      cls: s.installed && s.enabled
        ? "sauce-badge sauce-badge--ok"
        : s.installed
        ? "sauce-badge sauce-badge--warn"
        : "sauce-badge sauce-badge--error",
      text: s.installed && s.enabled
        ? "active"
        : s.installed
        ? "installed (disabled)"
        : "not installed",
    });
    badge.setAttr("aria-label", "plugin status");
    card.createEl("p", { cls: "sauce-card-meta", text: s.spec.purpose });

    const actions = card.createDiv({ cls: "sauce-button-row" });
    if (!s.installed) {
      const install = actions.createEl("button", {
        cls: "sauce-button",
        text: "Open install page",
      });
      install.onclick = () => {
        openCommunityPluginsPage(this.opts.app as unknown as Parameters<typeof openCommunityPluginsPage>[0], s.spec.id);
        new Notice(`Opening community plugins → ${s.spec.name}`);
      };
    } else if (!s.enabled) {
      const enable = actions.createEl("button", {
        cls: "sauce-button",
        text: "Enable in Settings",
      });
      enable.onclick = () => {
        openCommunityPluginsPage(this.opts.app as unknown as Parameters<typeof openCommunityPluginsPage>[0]);
      };
    } else {
      const ok = actions.createEl("span", { cls: "sauce-field-help", text: "✓ ready" });
      ok.setAttr("aria-label", "ready");
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
