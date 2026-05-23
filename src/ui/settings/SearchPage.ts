import { SettingsPage, type SettingsHost, el } from "./SettingsPage";
export class SearchPage extends SettingsPage {
  readonly id = "search";
  readonly title = "Search";
  readonly group = "core";
  constructor(private readonly host: SettingsHost) {
    super();
  }
  render(containerEl: HTMLElement): void {
    containerEl.empty?.();
    containerEl.appendChild(el("h2", {}, this.title));
    containerEl.appendChild(
      el(
        "p",
        { class: "sauce-settings-hint" },
        "SPEC §35 — see plugin docs for the full knob catalogue.",
      ),
    );
    const knobs = containerEl.appendChild(
      el("div", { class: "sauce-settings-knobs" }),
    );
    knobs.dataset.pageId = this.id;
  }
}
