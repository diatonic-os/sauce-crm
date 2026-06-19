// Tolerant local-model tool-call parsing: fenced/repaired/partial JSON args,
// and recovery of tool calls a local model emitted as plain text.

import { describe, expect, it } from "vitest";
import {
  parseToolArgs,
  extractTextToolCalls,
  firstJsonObject,
} from "../../src/saucebot/LocalToolParse";

describe("parseToolArgs", () => {
  it("parses clean JSON", () => {
    expect(parseToolArgs('{"path":"a.md"}')).toEqual({ path: "a.md" });
  });

  it("empty/whitespace ⇒ zero-arg call {}", () => {
    expect(parseToolArgs("")).toEqual({});
    expect(parseToolArgs("   ")).toEqual({});
    expect(parseToolArgs(null)).toEqual({});
  });

  it("strips a ```json fence around the args", () => {
    expect(parseToolArgs('```json\n{"q":"hi"}\n```')).toEqual({ q: "hi" });
  });

  it("repairs trailing commas and smart quotes", () => {
    expect(parseToolArgs('{"a":1,"b":2,}')).toEqual({ a: 1, b: 2 });
    expect(parseToolArgs("{“a”:“x”}")).toEqual({ a: "x" });
  });

  it("recovers the first balanced object from surrounding prose", () => {
    expect(
      parseToolArgs('Sure! here are the args {"path":"x.md"} ok?'),
    ).toEqual({ path: "x.md" });
  });

  it("falls back to {_raw} when nothing parses (call still dispatches)", () => {
    const out = parseToolArgs("totally not json");
    expect(out).toEqual({ _raw: "totally not json" });
  });
});

describe("firstJsonObject", () => {
  it("respects braces inside string values", () => {
    expect(firstJsonObject('{"a":"x}y","b":1} tail')).toBe('{"a":"x}y","b":1}');
  });
  it("returns null when no object present", () => {
    expect(firstJsonObject("no braces here")).toBeNull();
  });
});

describe("extractTextToolCalls", () => {
  const known = ["read_note", "log_touch"];

  it("recovers a name(args) call spoken in text", () => {
    const calls = extractTextToolCalls(
      'I will read_note({"path":"people/alice.md"}) now.',
      known,
    );
    expect(calls).toEqual([
      { name: "read_note", input: { path: "people/alice.md" } },
    ]);
  });

  it("recovers a JSON-envelope call ({tool, arguments})", () => {
    const calls = extractTextToolCalls(
      '```json\n{"tool":"log_touch","arguments":{"contact":"bob"}}\n```',
      known,
    );
    expect(calls).toEqual([
      { name: "log_touch", input: { contact: "bob" } },
    ]);
  });

  it("recovers {name, parameters} envelope shape", () => {
    const calls = extractTextToolCalls(
      '{"name":"read_note","parameters":{"path":"x.md"}}',
      known,
    );
    expect(calls).toEqual([{ name: "read_note", input: { path: "x.md" } }]);
  });

  it("ignores prose that names no known tool", () => {
    expect(
      extractTextToolCalls("just a normal answer about alice", known),
    ).toEqual([]);
  });

  it("ignores an unknown tool name in an envelope", () => {
    expect(
      extractTextToolCalls('{"tool":"rm_rf","arguments":{}}', known),
    ).toEqual([]);
  });

  it("returns [] when no tools are registered", () => {
    expect(extractTextToolCalls('read_note({"path":"x"})', [])).toEqual([]);
  });
});
