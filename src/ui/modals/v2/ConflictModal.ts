// SPEC §25 / §34 — Bidirectional conflict resolution.
// Presents local vs remote fields side-by-side; user picks per-field winner or "merge both".
import { App, Modal, Notice } from "obsidian";

export interface ConflictField {
  name: string;
  local: unknown;
  remote: unknown;
}

export interface ConflictResolution {
  resolved: Record<string, unknown>;
  perField: Record<string, "local" | "remote" | "both" | "skip">;
}

export class ConflictModal extends Modal {
  private decisions: Record<string, "local" | "remote" | "both" | "skip"> = {};

  constructor(
    app: App,
    private title: string,
    private fields: ConflictField[],
    private onResolve: (r: ConflictResolution | null) => void,
  ) {
    super(app);
  }

  override onOpen(): void {
    const c = this.contentEl;
    c.addClass("sauce-modal");
    c.createEl("h2", { text: `Conflict — ${this.title}` });
    c.createEl("p", {
      cls: "sauce-conflict-hint",
      text: "Pick the value to keep per field. 'Both' concatenates lists / preserves history.",
    });

    for (const f of this.fields) {
      const row = c.createDiv({ cls: "sauce-conflict-row" });
      row.createEl("div", { cls: "sauce-conflict-field", text: f.name });

      const local = row.createEl("div", { cls: "sauce-conflict-side" });
      local.createEl("strong", { text: "local" });
      local.createEl("pre", { text: fmt(f.local) });

      const remote = row.createEl("div", { cls: "sauce-conflict-side" });
      remote.createEl("strong", { text: "remote" });
      remote.createEl("pre", { text: fmt(f.remote) });

      const picker = row.createEl("div", { cls: "sauce-conflict-picker" });
      const sel = picker.createEl("select") as HTMLSelectElement;
      for (const opt of ["local", "remote", "both", "skip"])
        sel.createEl("option", { text: opt, value: opt });
      sel.value = "local";
      this.decisions[f.name] = "local";
      sel.onchange = () => {
        this.decisions[f.name] = sel.value as
          | "local"
          | "remote"
          | "both"
          | "skip";
      };
    }

    const btns = c.createDiv({ cls: "sauce-buttons" });
    btns.createEl("button", { text: "Resolve", cls: "sauce-button" }).onclick =
      () => this.resolve();
    btns.createEl("button", {
      text: "Cancel",
      cls: "sauce-button sauce-button-secondary",
    }).onclick = () => {
      this.onResolve(null);
      this.close();
    };
  }

  private resolve(): void {
    const resolved: Record<string, unknown> = {};
    for (const f of this.fields) {
      const choice = this.decisions[f.name] ?? "local";
      if (choice === "skip") continue;
      if (choice === "local") resolved[f.name] = f.local;
      else if (choice === "remote") resolved[f.name] = f.remote;
      else if (choice === "both") {
        if (Array.isArray(f.local) && Array.isArray(f.remote)) {
          resolved[f.name] = [
            ...new Set([...(f.local as unknown[]), ...(f.remote as unknown[])]),
          ];
        } else {
          resolved[f.name] = { local: f.local, remote: f.remote };
        }
      }
    }
    this.onResolve({ resolved, perField: this.decisions });
    new Notice(`Resolved ${Object.keys(resolved).length} field(s)`);
    this.close();
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}

function fmt(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "string") return v;
  if (Array.isArray(v))
    return v
      .map((x) => (typeof x === "string" ? x : JSON.stringify(x)))
      .join("\n");
  return JSON.stringify(v, null, 2);
}
