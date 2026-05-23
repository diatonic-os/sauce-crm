import { describe, expect, it, vi } from "vitest";
import {
  buildClassifyPrompt,
  parseClassifyResponse,
  llmClassifyStage,
  type ClassifyVocab,
} from "../../src/services/enrichment/LlmClassifyStage";
import type { EnrichmentInput } from "../../src/services/EnrichmentService";

const vocab: ClassifyVocab = {
  primaryTypes: ["advisor", "mentor", "prospect"],
  roles: ["advisor", "connector", "investor"],
};
const input = (over: Partial<EnrichmentInput> = {}): EnrichmentInput => ({
  path: "people/Jane.md", type: "person", frontmatter: { name: "Jane Doe" }, body: "Jane is an advisor and connector.", ...over,
});

describe("buildClassifyPrompt", () => {
  it("embeds the allowed vocabulary and the contact body", () => {
    const { system, user } = buildClassifyPrompt(input(), vocab);
    expect(system).toContain("advisor, mentor, prospect");
    expect(system).toContain("advisor, connector, investor");
    expect(user).toContain("Jane Doe");
    expect(user).toContain("advisor and connector");
  });

  it("caps very long bodies", () => {
    const { user } = buildClassifyPrompt(input({ body: "x".repeat(9000) }), vocab);
    expect(user.length).toBeLessThan(4200);
  });
});

describe("parseClassifyResponse", () => {
  it("parses + validates a clean JSON response", () => {
    const r = parseClassifyResponse('{"primary_type":"advisor","roles":["connector","investor"]}', vocab);
    expect(r).toEqual({ primary_type: "advisor", roles: ["connector", "investor"] });
  });

  it("drops values not in the vocabulary", () => {
    const r = parseClassifyResponse('{"primary_type":"ceo","roles":["connector","spy"]}', vocab);
    expect(r).toEqual({ roles: ["connector"] }); // "ceo" + "spy" rejected
  });

  it("tolerates surrounding prose", () => {
    const r = parseClassifyResponse('Sure! Here is the classification:\n{"primary_type":"mentor","roles":[]}\nHope that helps.', vocab);
    expect(r).toEqual({ primary_type: "mentor" });
  });

  it("returns null when no JSON / unparseable / nothing valid", () => {
    expect(parseClassifyResponse("no json here", vocab)).toBeNull();
    expect(parseClassifyResponse("{not valid json}", vocab)).toBeNull();
    expect(parseClassifyResponse('{"primary_type":"nope","roles":["nope"]}', vocab)).toBeNull();
  });

  it("de-duplicates roles", () => {
    const r = parseClassifyResponse('{"roles":["connector","connector","advisor"]}', vocab);
    expect(r?.roles).toEqual(["connector", "advisor"]);
  });
});

describe("llmClassifyStage", () => {
  it("calls complete and returns the validated result", async () => {
    const complete = vi.fn().mockResolvedValue('{"primary_type":"advisor","roles":["connector"]}');
    const stage = llmClassifyStage(complete, () => vocab);
    const r = await stage(input());
    expect(r).toEqual({ primary_type: "advisor", roles: ["connector"] });
    expect(complete).toHaveBeenCalledOnce();
  });

  it("returns null (and still calls) when the model output is unusable", async () => {
    const stage = llmClassifyStage(async () => "garbage", () => vocab);
    expect(await stage(input())).toBeNull();
  });

  it("returns null when the model is unreachable (complete → null)", async () => {
    const stage = llmClassifyStage(async () => null, () => vocab);
    expect(await stage(input())).toBeNull();
  });

  it("skips the model call entirely when the vocabulary is empty", async () => {
    const complete = vi.fn();
    const stage = llmClassifyStage(complete, () => ({ primaryTypes: [], roles: [] }));
    expect(await stage(input())).toBeNull();
    expect(complete).not.toHaveBeenCalled();
  });
});
