import { describe, expect, it } from "vitest";
import {
  DownstreamRegistry,
  satisfies,
} from "../../src/services/DownstreamRegistry";

describe("satisfies (minimal semver)", () => {
  it("handles exact, *, >=, and ^ (0.x caret = same minor)", () => {
    expect(satisfies("0.3.0", "0.3.0")).toBe(true);
    expect(satisfies("0.3.0", "*")).toBe(true);
    expect(satisfies("0.3.0", "")).toBe(true);
    expect(satisfies("0.3.0", ">=0.2.0")).toBe(true);
    expect(satisfies("0.3.0", ">=0.4.0")).toBe(false);
    expect(satisfies("0.3.0", "^0.3.0")).toBe(true);
    expect(satisfies("0.3.5", "^0.3.0")).toBe(true);
    expect(satisfies("0.4.0", "^0.3.0")).toBe(false); // 0.x caret pins minor
    expect(satisfies("0.2.0", "0.3.0")).toBe(false);
  });
});

describe("DownstreamRegistry", () => {
  it("negotiateVersion accepts compatible, rejects incompatible (no throw)", () => {
    const reg = new DownstreamRegistry("0.3.0");
    expect(reg.negotiateVersion("^0.3.0").ok).toBe(true);
    const bad = reg.negotiateVersion(">=0.4.0");
    expect(bad.ok).toBe(false);
    expect(bad.reason).toMatch(/does not satisfy/);
    expect(bad.svcVersion).toBe("0.3.0");
  });

  it("registers entities/touchSources/pipelines/views and lists them", () => {
    const reg = new DownstreamRegistry("0.3.0");
    reg.registerEntity({ type: "deal", prefix: "deal" });
    reg.registerTouchSource({ id: "webhook" });
    reg.registerPipeline({ name: "Sales", stages: ["lead", "won"] });
    reg.registerView({ id: "board", title: "Board" });
    const l = reg.list();
    expect(l.entities.map((e) => e.type)).toEqual(["deal"]);
    expect(l.touchSources[0].id).toBe("webhook");
    expect(l.pipelines[0].stages).toEqual(["lead", "won"]);
    expect(l.views[0].title).toBe("Board");
    expect(reg.unregister("entity", "deal")).toBe(true);
    expect(reg.list().entities).toEqual([]);
  });
});
