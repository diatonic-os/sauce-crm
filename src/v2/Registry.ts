export interface CapabilityDescriptor {
  id: string;            // e.g. "copilot", "skills", "integrations.google", "geocoding", "sync", "backend", "security", "import_export"
  ready: boolean;        // true if module loaded AND any required dep present
  reason?: string;       // when ready=false, why (e.g. "OAuth never completed")
  phase: "P8" | "P9" | "P10" | "P11" | "P12" | "P13" | "P14" | "P15";
}

export class V2Registry {
  private caps = new Map<string, CapabilityDescriptor>();
  register(d: CapabilityDescriptor): void { this.caps.set(d.id, d); }
  unregister(id: string): void { this.caps.delete(id); }
  get(id: string): CapabilityDescriptor | undefined { return this.caps.get(id); }
  list(): CapabilityDescriptor[] { return [...this.caps.values()]; }
  /** Returns "IMPLEMENTED" | "DEGRADED" | "COMING_SOON" per addendum §B detect_state rules */
  state(id: string): "IMPLEMENTED" | "DEGRADED" | "COMING_SOON" {
    const c = this.caps.get(id);
    if (!c) return "COMING_SOON";
    if (c.ready === false) return "DEGRADED";
    return "IMPLEMENTED";
  }
}
