// Brain Ask structured parse + honesty guardrail.
// The load-bearing rule: NO CITATION ⇒ NO CLAIM. Uncited prose must degrade to
// the honest no-answer rather than surfacing as fact.

import { describe, expect, it } from "vitest";
import { parseBrainAnswer, NO_CITED_ANSWER } from "../../src/saucebot/BrainAsk";

describe("parseBrainAnswer", () => {
  it("parses a well-formed cited answer", () => {
    const raw = JSON.stringify({
      lead: "Two people match.",
      who: [{ name: "Alice", detail: "ML lead", status: "cleared" }],
      what: [],
      citations: ["people/alice.md:3"],
    });
    const a = parseBrainAnswer(raw);
    expect(a.lead).toBe("Two people match.");
    expect(a.who[0]?.name).toBe("Alice");
    expect(a.citations).toEqual(["people/alice.md:3"]);
  });

  it("replaces an UNCITED answer with the honest no-answer", () => {
    const raw = JSON.stringify({
      lead: "Sure, Bob knows everyone.",
      who: [{ name: "Bob", detail: "guy" }],
      what: [],
      citations: [],
    });
    expect(parseBrainAnswer(raw)).toEqual(NO_CITED_ANSWER);
  });

  it("extracts JSON wrapped in a ```json fence", () => {
    const raw =
      "Here you go:\n```json\n" +
      JSON.stringify({
        lead: "x",
        who: [],
        what: [],
        citations: ["notes/x.md:1"],
      }) +
      "\n```\nhope that helps";
    const a = parseBrainAnswer(raw);
    expect(a.lead).toBe("x");
    expect(a.citations).toEqual(["notes/x.md:1"]);
  });

  it("extracts a bare {...} block embedded in prose", () => {
    const raw =
      "Thinking... " +
      JSON.stringify({ lead: "y", who: [], what: [], citations: ["a.md:2"] }) +
      " done";
    expect(parseBrainAnswer(raw).lead).toBe("y");
  });

  it("degrades garbage to the honest no-answer", () => {
    expect(parseBrainAnswer("I cannot comply.")).toEqual(NO_CITED_ANSWER);
  });
});
