// CON-OBS-WIZARD — provider connection test, reused by the onboarding wizard
// and provider settings. Wraps ModelCatalog.list(): for local providers
// (ollama / lmstudio / nim) listing actually hits the endpoint, so a thrown
// error or empty list is a genuine reachability/auth signal. openai / anthropic
// serve a static curated catalog (no network), so listing them confirms the
// catalog is wired but does NOT validate the key — the result says so honestly.

import {
  sharedModelCatalog,
  type ModelCatalog,
  type ProviderId,
} from "./ModelCatalog";
import type { Logger } from "../telemetry";

/** Providers whose catalog is fetched live (so listing is a real probe). */
const DYNAMIC_PROVIDERS = new Set<ProviderId>(["ollama", "lmstudio", "nim"]);

export interface ProviderTestInput {
  provider: ProviderId;
  endpoint?: string;
  apiKey?: string;
  kind?: "chat" | "embedding";
  /** Injectable for tests. */
  catalog?: ModelCatalog;
  logger?: Logger | null;
}

export interface ProviderTestResult {
  ok: boolean;
  /** Human-readable, secret-free summary suitable for an InlineStatus line. */
  detail: string;
  modelCount: number;
  /** True when the result reflects a live network probe (local providers). */
  live: boolean;
}

export async function testProviderConnection(
  input: ProviderTestInput,
): Promise<ProviderTestResult> {
  const live = DYNAMIC_PROVIDERS.has(input.provider);
  const catalog = input.catalog ?? sharedModelCatalog(input.logger ?? null);
  try {
    const models = await catalog.list({
      provider: input.provider,
      ...(input.endpoint !== undefined ? { endpoint: input.endpoint } : {}),
      ...(input.apiKey !== undefined ? { apiKey: input.apiKey } : {}),
      ...(input.kind !== undefined ? { kind: input.kind } : {}),
      logger: input.logger ?? null,
    });
    const n = models.length;
    if (n === 0) {
      return {
        ok: false,
        detail: live
          ? "Reached endpoint but no models found"
          : "Catalog returned no models",
        modelCount: 0,
        live,
      };
    }
    const plural = n === 1 ? "model" : "models";
    return {
      ok: true,
      detail: live
        ? `Connected · ${n} ${plural}`
        : `Catalog ready · ${n} ${plural} (key verified on first use)`,
      modelCount: n,
      live,
    };
  } catch (e) {
    return {
      ok: false,
      detail: e instanceof Error ? e.message : String(e),
      modelCount: 0,
      live,
    };
  }
}
