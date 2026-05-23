import { SettingsPage, type SettingsHost, el } from "../SettingsPage";
export class TwilioPage extends SettingsPage {
  readonly id = "integrations.twilio";
  readonly title = "Twilio";
  readonly group = "integrations";
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
        "Connection, scopes, per-resource sync controls.",
      ),
    );
    const knobs = containerEl.appendChild(
      el("div", { class: "sauce-settings-knobs" }),
    );
    knobs.dataset.pageId = this.id;
  }
}
