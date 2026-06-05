// SyncEngine.wireResources tests — a fake IIntegration drives the scheduling
// path; no real scheduler timers are started.
import { describe, it, expect } from "vitest";
import { SyncEngine } from "./SyncEngine";
import type {
  IIntegration,
  SyncResource,
  ConnectionState,
} from "../integrations/IIntegration";

function makeResource(over: Partial<SyncResource>): SyncResource {
  return {
    id: "res",
    label: "Res",
    frequency: "1h",
    enabled: true,
    lastPullTs: null,
    cursor: null,
    ...over,
  };
}

function makeIntegration(
  id: string,
  resources: SyncResource[],
): IIntegration & { synced: string[] } {
  const synced: string[] = [];
  return {
    synced,
    id,
    label: id,
    async connect(): Promise<ConnectionState> {
      return { connected: true };
    },
    async disconnect() {},
    async state(): Promise<ConnectionState> {
      return { connected: true };
    },
    async listResources() {
      return resources;
    },
    async syncResource(rid: string) {
      synced.push(rid);
      return { pulled: 1, pushed: 0, errors: 0 };
    },
  };
}

describe("SyncEngine.wireResources", () => {
  it("schedules only enabled resources", async () => {
    const engine = new SyncEngine();
    const integ = makeIntegration("notion", [
      makeResource({ id: "on", enabled: true, frequency: "5m" }),
      makeResource({ id: "off", enabled: false }),
    ]);
    engine.register(integ);

    await engine.wireResources("notion");

    const jobs = engine.scheduler.all().map((j) => j.job);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.id).toBe("notion::on");
    expect(jobs[0]!.resource).toBe("on");
    expect(jobs[0]!.frequency).toBe("5m");
  });

  it("a scheduled job's run() pulls the resource via the integration", async () => {
    const engine = new SyncEngine();
    const integ = makeIntegration("g", [makeResource({ id: "calendar" })]);
    engine.register(integ);

    await engine.wireResources("g");
    const job = engine.scheduler.all()[0]!.job;

    // Capture the change emitted by the job run.
    const seen: unknown[] = [];
    engine.changes.subscribe((e) => seen.push(e));

    await job.run();

    expect(integ.synced).toEqual(["calendar"]);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      kind: "integration-pull",
      integration: "g",
      resource: "calendar",
    });
  });

  it("throws for an unknown integration id", async () => {
    const engine = new SyncEngine();
    await expect(engine.wireResources("missing")).rejects.toThrow(
      /no integration/,
    );
  });
});
