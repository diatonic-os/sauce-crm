// MOB-BRIDGE-001 · T-F — HybridMemoryBackend.
//
// The mobile orchestration layer. Composes a bridge backend (T-D, talks to the
// reachable desktop over Tailscale) with a local backend (T-E, lexical fallback
// over synced markdown). Strategy per call:
//
//   reachable AND bridge.ready()  → try bridge; on a *transient* BridgeError
//                                    (unreachable | timeout | server-error)
//                                    fall through to local.
//   not reachable                 → local directly.
//
// Local search/recall hits already carry `degraded:true` (set by T-E); the
// hybrid preserves them verbatim. Local `embed` returns null (no model offline)
// — that is the contract and is passed through unchanged.
//
// Mobile-safe: NO node builtins. Everything is injected.

import {
  BackendMode,
  BridgeError,
  EmbedResult,
  MemoryBackend,
  MemoryHit,
  MemoryQuery,
  ReachabilityProbe,
} from "../../contract";
import type { ProvenanceRecord } from "../../../services/Provenance";

export interface HybridMemoryBackendDeps {
  bridge: MemoryBackend;
  local: MemoryBackend;
  probe: ReachabilityProbe;
}

/** BridgeError codes for which falling back to the local backend is correct.
 *  These are transient/availability faults. Non-transient faults (e.g.
 *  `unauthorized`, `protocol-mismatch`, `bad-response`, `not-paired`) indicate a
 *  misconfiguration the local backend cannot paper over, so they propagate. */
const FALLBACK_CODES: ReadonlySet<string> = new Set([
  "unreachable",
  "timeout",
  "server-error",
]);

function isFallbackError(err: unknown): boolean {
  return err instanceof BridgeError && FALLBACK_CODES.has(err.code);
}

export class HybridMemoryBackend implements MemoryBackend {
  readonly mode: BackendMode = "hybrid";

  private readonly bridge: MemoryBackend;
  private readonly local: MemoryBackend;
  private readonly probe: ReachabilityProbe;

  constructor(deps: HybridMemoryBackendDeps) {
    this.bridge = deps.bridge;
    this.local = deps.local;
    this.probe = deps.probe;
  }

  async semanticSearch(q: MemoryQuery): Promise<MemoryHit[]> {
    return this.route(
      () => this.bridge.semanticSearch(q),
      () => this.local.semanticSearch(q),
    );
  }

  async recall(q: string, k?: number): Promise<MemoryHit[]> {
    return this.route(
      () => this.bridge.recall(q, k),
      () => this.local.recall(q, k),
    );
  }

  async embed(text: string, fp: string): Promise<EmbedResult | null> {
    return this.route(
      () => this.bridge.embed(text, fp),
      () => this.local.embed(text, fp),
    );
  }

  async provenance(fp: string): Promise<ProvenanceRecord[]> {
    return this.route(
      () => this.bridge.provenance(fp),
      () => this.local.provenance(fp),
    );
  }

  /** Hybrid is ready if EITHER backend can serve. */
  async ready(): Promise<boolean> {
    const [b, l] = await Promise.all([
      this.bridge.ready().catch(() => false),
      this.local.ready().catch(() => false),
    ]);
    return b || l;
  }

  /** Shared routing: prefer the bridge when the desktop is reachable AND ready;
   *  fall back to local on a transient BridgeError. When not reachable, go
   *  straight to local. */
  private async route<T>(viaBridge: () => Promise<T>, viaLocal: () => Promise<T>): Promise<T> {
    let reachable = false;
    try {
      reachable = await this.probe.isReachable();
    } catch {
      reachable = false;
    }

    if (reachable) {
      let bridgeReady = false;
      try {
        bridgeReady = await this.bridge.ready();
      } catch {
        bridgeReady = false;
      }

      if (bridgeReady) {
        try {
          return await viaBridge();
        } catch (err) {
          if (isFallbackError(err)) {
            return viaLocal();
          }
          throw err;
        }
      }
    }

    return viaLocal();
  }
}
