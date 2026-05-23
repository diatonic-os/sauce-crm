// MOB-BRIDGE-001 · T-F — mobile orchestration barrel.
// Mobile-safe: pure TS, depends only on the shared contract. No node builtins,
// no global fetch — all side effects arrive via injected deps.

export { HybridMemoryBackend } from "./HybridMemoryBackend";
export type { HybridMemoryBackendDeps } from "./HybridMemoryBackend";

export { TailscaleReachabilityProbe } from "./ReachabilityProbe";
export type {
  HttpRequestFn,
  TailscaleReachabilityProbeDeps,
} from "./ReachabilityProbe";

export { CaptureQueue } from "./CaptureQueue";
export type {
  CaptureQueueDeps,
  QueuedCapture,
  QueueStore,
  VaultWriter,
} from "./CaptureQueue";
