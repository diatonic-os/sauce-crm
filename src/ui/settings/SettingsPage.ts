// SPEC §35.1 — Settings page base. Renders into a container element.
export abstract class SettingsPage {
  abstract readonly id: string;
  abstract readonly title: string;
  abstract readonly group: string;
  readonly icon: string | null = null;
  abstract render(containerEl: HTMLElement): void;
}

export interface SettingsHost {
  getConfig<T>(key: string, fallback: T): T;
  setConfig<T>(key: string, value: T): Promise<void>;
}

export function el(tag: string, attrs: Record<string, string> = {}, text?: string): HTMLElement {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text !== undefined) e.textContent = text;
  return e;
}
