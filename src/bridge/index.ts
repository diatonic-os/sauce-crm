// MOB-BRIDGE-001 — barrel. The contract is always safe to export everywhere.
// Platform-specific implementations (desktop/server vs mobile) are imported
// directly by their wiring sites, NOT re-exported here, so the mobile bundle
// never transitively pulls in the Node http server.
export * from "./contract";
