import { describe, expect, it } from "vitest";
import {
  selfConsistency,
  critiqueRevise,
  verify,
} from "../../src/saucebot/harness/VerifyStage";
import {
  jsonSchemaResponseFormat,
  QUALITY_LATTICE,
} from "../../src/saucebot/lmstudio/LMStudioCapability";

describe("selfConsistency (N-sample majority vote)", () => {
  it("returns the majority answer across N samples", async () => {
    const seq = ["A", "B", "A", "A", "B"];
    const r = await selfConsistency((i) => Promise.resolve(seq[i]!), { n: 5 });
    expect(r.winner).toBe("A");
    expect(r.votes).toBe(3);
    expect(r.candidates).toHaveLength(5);
  });

  it("normalizes with a key fn so trivially-different answers group", async () => {
    const seq = ["  yes ", "YES", "no"];
    const r = await selfConsistency((i) => Promise.resolve(seq[i]!), {
      n: 3,
      key: (v) => v.trim().toLowerCase(),
    });
    expect(r.winner.trim().toLowerCase()).toBe("yes");
    expect(r.votes).toBe(2);
  });

  it("honors a custom tie/pick scorer", async () => {
    const seq = ["short", "the longest answer", "mid"];
    const r = await selfConsistency((i) => Promise.resolve(seq[i]!), {
      n: 3,
      pick: (cands) => cands.reduce((a, b) => (b.length > a.length ? b : a)),
    });
    expect(r.winner).toBe("the longest answer");
  });
});

describe("critiqueRevise (generate → critique → revise loop)", () => {
  it("accepts the first candidate when the critic approves immediately", async () => {
    const r = await critiqueRevise(
      () => Promise.resolve("good"),
      () => Promise.resolve({ ok: true, feedback: "" }),
      (c) => Promise.resolve(c + "!"),
      { maxRounds: 3 },
    );
    expect(r.value).toBe("good");
    expect(r.rounds).toBe(0);
    expect(r.accepted).toBe(true);
  });

  it("revises until the critic accepts", async () => {
    let draft = "v0";
    const r = await critiqueRevise(
      () => Promise.resolve(draft),
      (c) => Promise.resolve({ ok: c === "v2", feedback: "improve" }),
      (c) => {
        draft = c === "v0" ? "v1" : "v2";
        return Promise.resolve(draft);
      },
      { maxRounds: 5 },
    );
    expect(r.value).toBe("v2");
    expect(r.accepted).toBe(true);
    expect(r.rounds).toBe(2);
  });

  it("stops at maxRounds and returns best-effort when never accepted", async () => {
    const r = await critiqueRevise(
      () => Promise.resolve("x"),
      () => Promise.resolve({ ok: false, feedback: "never good" }),
      (c) => Promise.resolve(c + "x"),
      { maxRounds: 2 },
    );
    expect(r.accepted).toBe(false);
    expect(r.rounds).toBe(2);
    expect(r.value).toBe("xxx"); // x → xx → xxx
  });
});

describe("verify (compose: vote then critique-revise)", () => {
  it("votes for a winner then refines it through the critic", async () => {
    const seq = ["draft", "draft", "other"];
    const r = await verify({
      generate: (i) => Promise.resolve(seq[i]!),
      samples: 3,
      critique: (c) => Promise.resolve({ ok: c.includes("final"), feedback: "" }),
      revise: (c) => Promise.resolve(c + "-final"),
      maxRounds: 2,
    });
    expect(r.value).toBe("draft-final");
    expect(r.accepted).toBe(true);
  });
});

describe("structured output (LM Studio depth)", () => {
  it("builds a strict json_schema response_format envelope", () => {
    const rf = jsonSchemaResponseFormat("person", {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
    });
    expect(rf.type).toBe("json_schema");
    expect(rf.json_schema.name).toBe("person");
    expect(rf.json_schema.strict).toBe(true);
    expect(rf.json_schema.schema.required).toEqual(["name"]);
  });
});

describe("QUALITY_LATTICE source of truth", () => {
  it("includes the socratic gate and verify stages in order", () => {
    const ids = QUALITY_LATTICE.map((s) => s.id);
    expect(ids[0]).toBe("socratic");
    expect(ids).toContain("verify");
    expect(ids).toContain("decompose");
    expect(ids).toContain("remember");
  });
});
