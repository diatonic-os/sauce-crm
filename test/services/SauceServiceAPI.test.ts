import { describe, expect, it } from "vitest";
import {
  buildSvcV1,
  mountSvcV1,
  SVC_V1_VERSION,
  type SvcV1Deps,
} from "../../src/services/SauceServiceAPI";
import { GraphService } from "../../src/services/GraphService";
import { DownstreamRegistry } from "../../src/services/DownstreamRegistry";
import { EventBus } from "../../src/services/EventBus";

// Minimal stand-ins for the SH-C/SH-D services + tasks facade (only identity matters here).
function deps(): SvcV1Deps {
  const graph = new GraphService();
  graph.upsertNode({
    id: "person-1",
    type: "warm-contact",
    fields: { name: "Alice" },
  });
  graph.upsertNode({ id: "pl-1", type: "pipeline", fields: { name: "Sales" } });
  graph.upsertNode({ id: "touch-1", type: "touch", fields: {} });
  graph.upsertEdge("person-1", "touch-1", "touch");
  return {
    graph,
    canon: {} as SvcV1Deps["canon"],
    events: new EventBus(),
    downstream: new DownstreamRegistry(SVC_V1_VERSION),
    tasks: {} as SvcV1Deps["tasks"],
    files: {} as SvcV1Deps["files"],
    search: {} as SvcV1Deps["search"],
    content: {} as SvcV1Deps["content"],
    meta: {} as SvcV1Deps["meta"],
  };
}

describe("buildSvcV1", () => {
  it("exposes the full SVC-api surface, frozen, at semver 0.3.0 (DEC-012)", () => {
    const svc = buildSvcV1(deps());
    expect(svc.version).toBe("0.3.0");
    for (const k of [
      "entities",
      "touches",
      "pipelines",
      "graph",
      "canon",
      "events",
      "tasks",
      "files",
      "search",
      "content",
      "meta",
    ]) {
      expect(svc).toHaveProperty(k);
    }
    expect(Object.isFrozen(svc)).toBe(true);
  });

  it("entities/pipelines/touches read facades return plain graph data (G-010, no raw handle)", () => {
    const svc = buildSvcV1(deps());
    expect(svc.entities.get("person-1")?.fields).toEqual({ name: "Alice" });
    expect(svc.entities.byType("warm-contact").map((n) => n.id)).toEqual([
      "person-1",
    ]);
    expect(svc.pipelines.list().map((n) => n.id)).toEqual(["pl-1"]);
    expect(svc.touches.forEntity("person-1").map((n) => n.id)).toEqual([
      "touch-1",
    ]);
    // G-010: no member is an Obsidian App/Vault handle
    expect((svc as unknown as { app?: unknown }).app).toBeUndefined();
    expect((svc as unknown as { vault?: unknown }).vault).toBeUndefined();
  });

  it("register* delegate to the DownstreamRegistry; negotiateVersion enforces semver", () => {
    const d = deps();
    const svc = buildSvcV1(d);
    svc.registerEntity({ type: "deal", prefix: "deal" });
    expect(d.downstream.list().entities.map((e) => e.type)).toEqual(["deal"]);
    expect(svc.negotiateVersion("^0.3.0").ok).toBe(true);
    expect(svc.negotiateVersion(">=0.4.0").ok).toBe(false);
  });

  it("mountSvcV1 attaches svcV1 to the plugin instance", () => {
    const svc = buildSvcV1(deps());
    const plugin: Record<string, unknown> = {};
    mountSvcV1(plugin, svc);
    expect(plugin.svcV1).toBe(svc);
  });
});
