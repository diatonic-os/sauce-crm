// MOB-BRIDGE-001 · T-B — server barrel. Desktop-only: importing this pulls in
// the Node `http` server, so wiring sites must guard with Platform.isMobile
// (or equivalent) before touching it. The mobile bundle must NOT import this.
export { MemoryHttpServer } from "./MemoryHttpServer";
export type { MemoryHttpServerDeps, LanceStatus } from "./MemoryHttpServer";
