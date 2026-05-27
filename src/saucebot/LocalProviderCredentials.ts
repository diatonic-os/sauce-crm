// V2 — credential surface for local providers (LM Studio + Ollama).
// Endpoints are non-secret config (live in plugin settings JSON), API keys live in KeyVault.
import type { KeyVault } from "../security/KeyVault";

export interface LocalProviderConfig {
  ollama: { endpoint: string; defaultModel?: string; hasApiKey: boolean };
  lmstudio: {
    endpoint: string;
    defaultModel?: string;
    toolUse: boolean;
    hasApiKey: boolean;
  };
}

export const DEFAULT_LOCAL_PROVIDER_CONFIG: LocalProviderConfig = {
  ollama: {
    endpoint: "http://localhost:11434",
    defaultModel: "llama3",
    hasApiKey: false,
  },
  lmstudio: {
    endpoint: "http://localhost:1234/v1",
    defaultModel: "local-model",
    toolUse: false,
    hasApiKey: false,
  },
};

export class LocalProviderCredentials {
  constructor(private readonly vault: KeyVault) {}

  async setOllamaKey(key: string): Promise<void> {
    await this.vault.put("copilot:ollama:api-key", key);
  }
  async getOllamaKey(): Promise<string | null> {
    try {
      return await this.vault.get("copilot:ollama:api-key");
    } catch {
      return null;
    }
  }
  async clearOllamaKey(): Promise<void> {
    try {
      await this.vault.put("copilot:ollama:api-key", "");
    } catch {
      /* vault locked — caller handles */
    }
  }

  async setLMStudioKey(key: string): Promise<void> {
    await this.vault.put("copilot:lmstudio:api-key", key);
  }
  async getLMStudioKey(): Promise<string | null> {
    try {
      return await this.vault.get("copilot:lmstudio:api-key");
    } catch {
      return null;
    }
  }
  async clearLMStudioKey(): Promise<void> {
    try {
      await this.vault.put("copilot:lmstudio:api-key", "");
    } catch {
      /* vault locked */
    }
  }
}
