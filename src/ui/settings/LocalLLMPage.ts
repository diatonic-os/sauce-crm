// V2 settings — Local LLM providers (Ollama + LM Studio).
// Endpoint URL + optional API key (key bound via KeyVault), live model picker, ping test.
import { SettingsPage, type SettingsHost, el } from './SettingsPage';
import { ProviderPicker } from '../components/v2/ProviderPicker';
import type SauceGraphPlugin from '../../main';

// Keys that must be stored encrypted via KeyVault, not in plugin settings JSON.
export const VAULT_BOUND_KEYS = new Set<string>([
  'copilot:ollama:api-key',
  'copilot:lmstudio:api-key',
  'copilot:anthropic:api-key',
  'copilot:openai:api-key',
  'copilot:gemini:api-key',
]);

export class LocalLLMPage extends SettingsPage {
  readonly id = 'copilot.local';
  readonly title = 'Local LLM (Ollama / LM Studio)';
  readonly group = 'ai';

  constructor(private readonly host: SettingsHost) { super(); }

  render(containerEl: HTMLElement): void {
    containerEl.empty?.();
    containerEl.appendChild(el('h2', {}, this.title));
    containerEl.appendChild(el('p', { class: 'sauce-settings-hint' },
      'Configure local providers. Endpoints are stored in plugin settings; API keys live in the encrypted KeyVault.'));

    this.section(containerEl, 'Ollama', [
      { label: 'Endpoint URL', key: 'copilot.ollama.endpoint', placeholder: 'http://localhost:11434', secret: false },
      { label: 'API key (optional, for reverse-proxied Ollama)', key: 'copilot:ollama:api-key', placeholder: 'leave blank if Ollama has no auth', secret: true },
    ]);
    this.modelPicker(containerEl, 'ollama', 'copilot.ollama.endpoint', 'copilot.ollama.defaultModel');

    this.section(containerEl, 'LM Studio', [
      { label: 'Endpoint URL (OpenAI-compatible base)', key: 'copilot.lmstudio.endpoint', placeholder: 'http://localhost:1234/v1', secret: false },
      { label: 'API key (optional)', key: 'copilot:lmstudio:api-key', placeholder: 'leave blank for default LM Studio setup', secret: true },
    ]);
    this.modelPicker(containerEl, 'lmstudio', 'copilot.lmstudio.endpoint', 'copilot.lmstudio.defaultModel');

    const toggleWrap = containerEl.appendChild(el('div', { class: 'sauce-settings-row' }));
    toggleWrap.appendChild(el('label', {}, 'LM Studio tool-use (OpenAI function-calling)'));
    const tg = toggleWrap.appendChild(el('input')) as HTMLInputElement;
    tg.setAttribute('type', 'checkbox');
    tg.checked = this.host.getConfig('copilot.lmstudio.toolUse', false) as boolean;
    tg.addEventListener('change', () => { void this.host.setConfig('copilot.lmstudio.toolUse', tg.checked); });

    const actions = containerEl.appendChild(el('div', { class: 'sauce-settings-actions' }));
    const pingOllama = actions.appendChild(el('button', {}, 'Ping Ollama')) as HTMLButtonElement;
    const pingLM = actions.appendChild(el('button', {}, 'Ping LM Studio')) as HTMLButtonElement;
    const statusEl = actions.appendChild(el('span', { class: 'sauce-settings-status' }));
    pingOllama.addEventListener('click', async () => {
      const fn = this.host.getConfig<(() => Promise<{ ok: boolean; latencyMs: number; error?: string }>) | null>('copilot.ollama.pingFn', null);
      statusEl.textContent = fn ? await this.formatPing('Ollama', fn) : 'Ping handler not wired';
    });
    pingLM.addEventListener('click', async () => {
      const fn = this.host.getConfig<(() => Promise<{ ok: boolean; latencyMs: number; error?: string }>) | null>('copilot.lmstudio.pingFn', null);
      statusEl.textContent = fn ? await this.formatPing('LM Studio', fn) : 'Ping handler not wired';
    });
  }

  private modelPicker(parent: HTMLElement, provider: 'ollama' | 'lmstudio', endpointKey: string, defaultKey: string): void {
    const plugin = this.host.getConfig<SauceGraphPlugin | null>('plugin.handle', null);
    if (!plugin) {
      parent.appendChild(el('div', { class: 'sauce-settings-hint' }, 'Plugin handle not wired — pickers disabled. (settings-host must expose plugin.handle for live model lookup)'));
      return;
    }
    const wrap = parent.appendChild(el('div', { class: 'sauce-settings-row' }));
    new ProviderPicker({
      container: wrap,
      plugin,
      lockedProvider: provider,
      initialModel: this.host.getConfig(defaultKey, '') as string,
      endpoint: this.host.getConfig(endpointKey, '') as string,
      onChange: ({ model }) => { void this.host.setConfig(defaultKey, model); },
    }).render();
  }

  private async formatPing(name: string, fn: () => Promise<{ ok: boolean; latencyMs: number; error?: string }>): Promise<string> {
    const r = await fn();
    return r.ok ? `${name}: OK (${r.latencyMs}ms)` : `${name}: ${r.error ?? 'fail'} (${r.latencyMs}ms)`;
  }

  private section(parent: HTMLElement, title: string, fields: Array<{ label: string; key: string; placeholder: string; secret: boolean }>): void {
    parent.appendChild(el('h3', {}, title));
    for (const f of fields) {
      const row = parent.appendChild(el('div', { class: 'sauce-settings-row' }));
      row.appendChild(el('label', {}, f.label));
      const input = row.appendChild(el('input')) as HTMLInputElement;
      input.setAttribute('type', f.secret ? 'password' : 'text');
      input.setAttribute('placeholder', f.placeholder);
      input.value = this.host.getConfig(f.key, '') as string;
      input.addEventListener('change', () => { void this.host.setConfig(f.key, input.value); });
    }
  }
}
