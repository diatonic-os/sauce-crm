// Modal surfaced when LanceDB is unavailable AND the operator has not
// yet decided. Two-button flow with mandatory consent checkbox on the
// install path. Skip-for-now persists the decision so we don't re-prompt
// on every reload.

import { Modal, type App, Notice } from "obsidian";
import {
  LanceDBInstaller,
  ObsidianInstallerHost,
  type InstallProgress,
  type LanceDBInstallDecision,
} from "../../services/LanceDBInstaller";

export interface LanceDBInstallModalOpts {
  app: App;
  pluginDir: string;
  initialDecision: LanceDBInstallDecision;
  /** Called when the user decides; the host persists this to plugin
   *  settings so subsequent reloads honor the choice. */
  onDecision: (next: LanceDBInstallDecision) => Promise<void>;
}

export class LanceDBInstallModal extends Modal {
  private consentChecked = false;
  private installing = false;
  private installer: LanceDBInstaller;

  constructor(private readonly opts: LanceDBInstallModalOpts) {
    super(opts.app);
    this.installer = new LanceDBInstaller(new ObsidianInstallerHost(opts.pluginDir));
  }

  onOpen(): void {
    this.modalEl.addClass("sauce-modal");
    this.titleEl.setText("Vector Search: Install LanceDB");
    const c = this.contentEl;
    c.empty();
    c.addClass("sauce-modal-content");

    const intro = c.createDiv({ cls: "sauce-section" });
    intro.createEl("p", {
      text:
        "Sauce CRM can use LanceDB for semantic vector search across your " +
        "graph — much faster and more accurate than text-only search. " +
        "LanceDB is a native module that lives entirely on your machine; " +
        "no cloud calls, no telemetry.",
    });
    intro.createEl("p", {
      cls: "sauce-field-help",
      text:
        "If you skip, the Copilot will keep working using graph + fuzzy " +
        "search only. You can install later from Settings → Sauce CRM → " +
        "Data → LanceDB.",
    });

    // Consent row — must be ticked before "Install now" enables.
    const consent = c.createDiv({ cls: "sauce-field sauce-section" });
    const cb = consent.createEl("label", { cls: "sauce-clickable" });
    const cbInput = cb.createEl("input", { type: "checkbox" });
    cb.appendText(
      " I understand this will run `npm install @lancedb/lancedb` inside the " +
      "plugin directory and download a native binary appropriate for my OS.",
    );

    // Output pane — fills during install.
    const log = c.createEl("pre", {
      cls: "sauce-section",
      attr: { style: "max-height: 220px; overflow: auto; font-size: 0.8em;" },
    });
    log.setText("(install output will appear here)");

    // Footer buttons.
    const footer = c.createDiv({ cls: "sauce-modal-footer" });
    const skipBtn = footer.createEl("button", {
      cls: "sauce-button-secondary",
      text: "Skip for now",
    });
    const installBtn = footer.createEl("button", {
      cls: "sauce-button",
      text: "Install LanceDB",
      attr: { disabled: "true" },
    });

    cbInput.onchange = () => {
      this.consentChecked = cbInput.checked;
      if (this.consentChecked) installBtn.removeAttribute("disabled");
      else installBtn.setAttribute("disabled", "true");
    };

    skipBtn.onclick = async () => {
      if (this.installing) return;
      await this.opts.onDecision({
        state: "skipped",
        decidedAt: new Date().toISOString(),
      });
      new Notice("Sauce CRM: using graph-RAG only. You can install LanceDB later from Settings.");
      this.close();
    };

    installBtn.onclick = async () => {
      if (this.installing || !this.consentChecked) return;
      this.installing = true;
      installBtn.setAttribute("disabled", "true");
      skipBtn.setAttribute("disabled", "true");
      log.setText("");
      const append = (line: string) => {
        log.appendText(line + "\n");
        log.scrollTop = log.scrollHeight;
      };
      const onProgress = (p: InstallProgress): void => {
        if (p.kind === "start") append("▶ " + p.message);
        else if (p.kind === "line") append(`[${p.stream}] ${p.line}`);
        else if (p.kind === "done") {
          if (p.ok) append(`✓ install complete in ${(p.durationMs / 1000).toFixed(1)}s`);
          else append(`✗ install failed: ${p.error ?? "unknown error"}`);
        }
      };
      const ok = await this.installer.install(onProgress);
      await this.opts.onDecision({
        state: ok ? "approved" : "skipped",
        decidedAt: new Date().toISOString(),
        lastAttempt: {
          ok,
          ts: new Date().toISOString(),
          error: ok ? undefined : "install failed (see modal log)",
        },
      });
      if (ok) {
        new Notice("LanceDB installed. Reload Obsidian to activate vector search.");
      } else {
        new Notice("LanceDB install failed — falling back to graph-RAG. See modal log.");
      }
      this.installing = false;
      installBtn.removeAttribute("disabled");
      skipBtn.removeAttribute("disabled");
      installBtn.setText("Close");
      installBtn.onclick = () => this.close();
    };
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
