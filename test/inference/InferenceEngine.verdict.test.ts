import { describe, expect, it } from "vitest";
import { InferenceEngine } from "../../src/inference/InferenceEngine";
import type { AttributeProposal } from "../../src/inference/AttributeInferrer";

describe("InferenceEngine.attributeProposalsFromSignature — verdict gating", () => {
  it("emits an attribute inference for a real, above-threshold signature", () => {
    const engine = new InferenceEngine();
    // "Acme Corporation" matches SIG_COMPANY_RX → conf ≈ 0.668 ≥ company.propose
    // (0.65) → verdict 'propose' → emitted.
    const out = engine.attributeProposalsFromSignature(
      "person:1",
      ["Acme Corporation"],
      "touch:1",
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.inference_kind).toBe("attribute");
    expect(out[0]!.target).toBe("person:1");
    expect(out[0]!.proposed_value).toMatchObject({
      attribute: "company",
      value: "Acme Corporation",
    });
  });

  it("emits nothing when the inferrer yields no proposal", () => {
    const engine = new InferenceEngine();
    // An email line is explicitly excluded by the inferrer (contains '@').
    const out = engine.attributeProposalsFromSignature(
      "person:1",
      ["someone@example.com"],
      "touch:1",
    );
    expect(out).toHaveLength(0);
  });

  it("suppresses emission when the proposal's verdict is 'discard'", () => {
    const engine = new InferenceEngine();
    const weak: AttributeProposal = {
      entityId: "person:1",
      attribute: "company",
      value: "Maybe Co",
      confidence: 0.4,
      verdict: "discard",
      sources: ["touch:1"],
    };
    // Force a below-propose-threshold proposal; the engine must gate it out.
    engine.attributes.inferCompanyFromSignature = () => weak;

    const out = engine.attributeProposalsFromSignature(
      "person:1",
      ["irrelevant"],
      "touch:1",
    );
    expect(out).toHaveLength(0);
  });

  it("emits when a forced proposal carries a 'propose' verdict", () => {
    const engine = new InferenceEngine();
    const strong: AttributeProposal = {
      entityId: "person:1",
      attribute: "company",
      value: "Strong Co",
      confidence: 0.9,
      verdict: "propose",
      sources: ["touch:1"],
    };
    engine.attributes.inferCompanyFromSignature = () => strong;

    const out = engine.attributeProposalsFromSignature(
      "person:1",
      ["irrelevant"],
      "touch:1",
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.confidence).toBe(0.9);
  });
});
