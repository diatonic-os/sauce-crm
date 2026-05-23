// MOB-BRIDGE-001 · T-A — desktop barrel. Desktop-only: imported directly by the
// server/wiring sites, never re-exported from src/bridge/index.ts (which must
// stay mobile-bundle-safe).
export {
  LanceMemoryBackend,
  type LanceMemoryBackendDeps,
  type VectorIndexLike,
  type ResolvedHit,
} from "./LanceMemoryBackend";
