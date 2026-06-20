// ─────────────────────────────────────────────────────────────────────────────
//  HOST PROBE — derives a host compute envelope so the picker can hide models
//  that will not load.
// ─────────────────────────────────────────────────────────────────────────────
//
//  The picker shows a model only if we're confident it will load on the user's
//  machine. This module probes the host's VRAM (GPU info) and builds a "learned
//  ceiling" from known-good models that actually loaded. The union is the
//  HostEnvironment the rest of the system uses to gate models.

import { estimateModelBytes, type CapabilityModel, type HostEnvironment } from "./LMStudioCapability";

/**
 * Options for probing the host environment.
 *
 * @param knownGoodModels - Array of model IDs known to have loaded successfully
 * @param catalog - Catalog of models to look up known-good sizes/estimates
 * @param gpuInfo - Optional async function to fetch GPU VRAM info; must not throw
 */
export interface ProbeOpts {
  knownGoodModels?: string[];
  catalog?: CapabilityModel[];
  gpuInfo?: () => Promise<{ totalVramBytes?: number; freeVramBytes?: number }>;
}

/**
 * Derive the largest model (bytes) that we know successfully loaded on this host.
 * Returns the max among all known-good models found in the catalog; 0 if none found.
 *
 * Handles missing sizeBytes by estimating via estimateModelBytes; unknown models
 * are skipped silently.
 */
export function deriveLearnedCeiling(
  knownGoodModels: string[],
  catalog: CapabilityModel[],
): number {
  let maxBytes = 0;
  for (const modelId of knownGoodModels) {
    const model = catalog.find((m) => m.id === modelId);
    if (!model) continue;
    const bytes = estimateModelBytes(model);
    if (bytes > maxBytes) maxBytes = bytes;
  }
  return maxBytes;
}

/**
 * Probe the host environment by fetching GPU info (if available) and building
 * a learned ceiling from known-good models.
 *
 * Returns a HostEnvironment with:
 * - totalVramBytes, freeVramBytes (from gpuInfo if present)
 * - learnedMaxLoadedBytes (from knownGoodModels if ceiling > 0; omitted if 0)
 *
 * The gpuInfo callback is treated as optional and non-fatal: if it throws,
 * we catch and continue without erroring.
 */
export async function probeHostEnvironment(opts: ProbeOpts): Promise<HostEnvironment> {
  const env: HostEnvironment = {};

  // Fetch GPU VRAM info if available; catch any errors and continue
  if (opts.gpuInfo) {
    try {
      const gpu = await opts.gpuInfo();
      if (gpu.totalVramBytes !== undefined) env.totalVramBytes = gpu.totalVramBytes;
      if (gpu.freeVramBytes !== undefined) env.freeVramBytes = gpu.freeVramBytes;
    } catch {
      // gpuInfo threw; silently continue without VRAM data
    }
  }

  // Derive learned ceiling from known-good models
  if (opts.knownGoodModels && opts.catalog) {
    const ceiling = deriveLearnedCeiling(opts.knownGoodModels, opts.catalog);
    if (ceiling > 0) {
      env.learnedMaxLoadedBytes = ceiling;
    }
  }

  return env;
}
