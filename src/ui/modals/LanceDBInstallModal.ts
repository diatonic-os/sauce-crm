// Informational modal surfaced when LanceDB is unavailable AND the
// operator has not yet decided. The plugin NEVER installs code at
// runtime (Obsidian Developer Policies prohibit downloading/executing
// code outside the reviewed release — see LanceDBInstaller.ts header).
// This modal only explains the optional manual install and re-detects.

import { Modal, type App, Notice } from "obsidian";
import {
  detectLanceDB,
  type LanceDBInstallDecision,
} from "../../services/LanceDBInstaller";

export interface LanceDBInstallModalOpts {
  app: App;
  /** Central out-of-vault runtime dir a manual install targets. */
  pluginDir: string;
  initialDecision: LanceDBInstallDecision;
  /** Called when the user decides; the host persists this to plugin
   *  settings so subsequent reloads honor the choice. */
  onDecision: (next: LanceDBInstallDecision) => Promise<void>;
}

export class LanceDBInstallModal extends Modal {
  constructor(private readonly opts: LanceDBInstallModalOpts) {
    super(opts.app);
  }

  override onOpen(): void {
    this.modalEl.addClass("sauce-modal");
    this.titleEl.setText("Vector search: optional LanceDB setup");
    const c = this.contentEl;
    c.empty();
    c.addClass("sauce-modal-content");

    const intro = c.createDiv({ cls: "sauce-section" });
    intro.createEl("p", {
      text:
        "Sauce CRM can use LanceDB for semantic vector search across your " +
        "graph — faster and more accurate than text-only search. LanceDB " +
        "is a native module that lives entirely on your machine; no cloud " +
        "calls, no telemetry.",
    });
    intro.createEl("p", {
      cls: "sauce-field-help",
      text:
        "Without it, SauceBot keeps working using graph + fuzzy search. " +
        "The plugin never downloads or installs code itself — if you want " +
        "vector search, run this one-time command in a terminal, then " +
        "click Re-check:",
    });

    // Copyable manual-install command. Plain text the user runs
    // themselves, outside Obsidian — never executed by the plugin.
    const cmd = `npm install @lancedb/lancedb --prefix "${this.opts.pluginDir}"`;
    const cmdBox = c.createEl("pre", {
      cls: "sauce-section",
      text: cmd,
      attr: { style: "user-select: all; overflow: auto; font-size: 0.85em;" },
    });
    const copyRow = c.createDiv({ cls: "sauce-field" });
    const copyBtn = copyRow.createEl("button", {
      cls: "sauce-button-secondary",
      text: "Copy command",
    });
    copyBtn.onclick = async () => {
      try {
        await navigator.clipboard.writeText(cmd);
        new Notice("Install command copied.");
      } catch {
        // Clipboard can be unavailable — the <pre> is select-all anyway.
        cmdBox.setText(cmd);
        new Notice("Copy failed — select the command text manually.");
      }
    };

    // Footer buttons.
    const footer = c.createDiv({ cls: "sauce-modal-footer" });
    const skipBtn = footer.createEl("button", {
      cls: "sauce-button-secondary",
      text: "Skip for now",
    });
    const recheckBtn = footer.createEl("button", {
      cls: "sauce-button",
      text: "I've installed it — re-check",
    });

    skipBtn.onclick = async () => {
      await this.opts.onDecision({
        state: "skipped",
        decidedAt: new Date().toISOString(),
      });
      new Notice(
        "Sauce CRM: using graph-RAG only. You can set up LanceDB later from Settings.",
      );
      this.close();
    };

    recheckBtn.onclick = async () => {
      const status = detectLanceDB(this.opts.pluginDir);
      const ok = status.state === "available";
      await this.opts.onDecision({
        state: ok ? "approved" : "pending",
        decidedAt: new Date().toISOString(),
        lastAttempt: {
          ok,
          ts: new Date().toISOString(),
          ...(ok
            ? {}
            : {
                error:
                  status.state === "unavailable" ? status.reason : status.state,
              }),
        },
      });
      if (ok) {
        new Notice(
          `LanceDB ${status.state === "available" ? `v${status.version} ` : ""}detected. Reload Obsidian to activate vector search.`,
        );
        this.close();
      } else {
        new Notice(
          "LanceDB not found yet — run the command above, then re-check.",
        );
      }
    };
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}
