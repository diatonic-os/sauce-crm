// MOB-BRIDGE-001 · T-D barrel. Re-exports the mobile bridge backend and its
// injected transport type. Safe for mobile: pulls in only the contract +
// ProvenanceRecord type, no Node builtins.
export {
  BridgeMemoryBackend,
  type BridgeMemoryBackendDeps,
  type HttpRequestFn,
  type HttpResponse,
} from "./BridgeMemoryBackend";
