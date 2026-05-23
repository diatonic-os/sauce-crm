// CON-OBS-INTEG-001 · T-G-02 · SVC-downstream — registry for downstream plugins
// that inherit Sauce as a service layer (DEC-007).
//
// Downstream plugins register entity types, touch sources, pipelines, and views,
// and negotiate against the svcV1 semver. Incompatible callers are rejected
// cleanly (no throw on the happy path; negotiateVersion returns a typed result).

export interface EntityRegistration {
  type: string;
  prefix: string;
  label?: string;
}
export interface TouchSourceRegistration {
  id: string;
  label?: string;
}
export interface PipelineRegistration {
  name: string;
  stages: string[];
}
export interface ViewRegistration {
  id: string;
  title: string;
}

export interface VersionNegotiation {
  ok: boolean;
  svcVersion: string;
  requested: string;
  reason?: string;
}

/** Minimal semver compare: returns -1/0/1 for a vs b (major.minor.patch). */
function cmp(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0))
      return (pa[i] ?? 0) < (pb[i] ?? 0) ? -1 : 1;
  }
  return 0;
}

/** Does `version` satisfy `range`? Supports exact, `*`, `>=x.y.z`, and `^x.y.z`
 *  (0.x caret = same minor, per npm semantics). */
export function satisfies(version: string, range: string): boolean {
  const r = range.trim();
  if (r === "" || r === "*") return true;
  if (r.startsWith(">=")) return cmp(version, r.slice(2).trim()) >= 0;
  if (r.startsWith("^")) {
    const base = r.slice(1).trim();
    const [maj, min] = base.split(".").map((n) => parseInt(n, 10) || 0);
    if (cmp(version, base) < 0) return false;
    const [vMaj, vMin] = version.split(".").map((n) => parseInt(n, 10) || 0);
    // ^0.3.0 → >=0.3.0 <0.4.0 ; ^1.2.0 → >=1.2.0 <2.0.0
    return maj === 0 ? vMaj === 0 && vMin === min : vMaj === maj;
  }
  return cmp(version, r) === 0;
}

export class DownstreamRegistry {
  private readonly entities = new Map<string, EntityRegistration>();
  private readonly touchSources = new Map<string, TouchSourceRegistration>();
  private readonly pipelines = new Map<string, PipelineRegistration>();
  private readonly views = new Map<string, ViewRegistration>();

  constructor(private readonly svcVersion: string) {}

  /** Negotiate compatibility. Never throws — returns a typed result. */
  negotiateVersion(requested: string): VersionNegotiation {
    const ok = satisfies(this.svcVersion, requested);
    return {
      ok,
      svcVersion: this.svcVersion,
      requested,
      reason: ok
        ? undefined
        : `svcV1 ${this.svcVersion} does not satisfy "${requested}"`,
    };
  }

  registerEntity(reg: EntityRegistration): void {
    this.entities.set(reg.type, reg);
  }
  registerTouchSource(reg: TouchSourceRegistration): void {
    this.touchSources.set(reg.id, reg);
  }
  registerPipeline(reg: PipelineRegistration): void {
    this.pipelines.set(reg.name, reg);
  }
  registerView(reg: ViewRegistration): void {
    this.views.set(reg.id, reg);
  }

  unregister(
    kind: "entity" | "touchSource" | "pipeline" | "view",
    key: string,
  ): boolean {
    const map = {
      entity: this.entities,
      touchSource: this.touchSources,
      pipeline: this.pipelines,
      view: this.views,
    }[kind];
    return map.delete(key);
  }

  list(): {
    entities: EntityRegistration[];
    touchSources: TouchSourceRegistration[];
    pipelines: PipelineRegistration[];
    views: ViewRegistration[];
  } {
    return {
      entities: [...this.entities.values()],
      touchSources: [...this.touchSources.values()],
      pipelines: [...this.pipelines.values()],
      views: [...this.views.values()],
    };
  }
}
