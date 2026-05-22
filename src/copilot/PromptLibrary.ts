// SPEC §19.2 — Versioned, contract-declared prompts. Loaded from bundled prompts/ or vault override.
export interface PromptDescriptor {
  promptId: string;
  version: string;
  contract: 'core' | 'simple' | 'extended' | 'full';
  inputs: string[];
  outputs: string[];
  requires: string[];
  ensures: string[];
  signals: string[];
  template: string;
}

export class PromptLibrary {
  private byId = new Map<string, PromptDescriptor>();

  register(p: PromptDescriptor): void { this.byId.set(p.promptId, p); }
  get(promptId: string): PromptDescriptor | null { return this.byId.get(promptId) ?? null; }
  list(): PromptDescriptor[] { return [...this.byId.values()].sort((a, b) => a.promptId.localeCompare(b.promptId)); }

  render(promptId: string, vars: Record<string, unknown>): string {
    const p = this.get(promptId);
    if (!p) throw new Error(`unknown prompt: ${promptId}`);
    return p.template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, k) => {
      const v = vars[k];
      return v == null ? '' : typeof v === 'string' ? v : JSON.stringify(v);
    });
  }
}
