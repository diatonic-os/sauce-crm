import { SettingsPage, type SettingsHost, el } from './SettingsPage';
export class AboutPage extends SettingsPage {
  readonly id = 'about';
  readonly title = 'About';
  readonly group = 'system';
  constructor(private readonly host: SettingsHost) { super(); }
  render(containerEl: HTMLElement): void {
    containerEl.empty?.();
    containerEl.appendChild(el('h2', {}, this.title));
    containerEl.appendChild(el('p', { class: 'sauce-settings-hint' }, 'SPEC §35 — see plugin docs for the full knob catalogue.'));
    const knobs = containerEl.appendChild(el('div', { class: 'sauce-settings-knobs' }));
    knobs.dataset.pageId = this.id;
  }
}
