import { describe, expect, it } from "vitest";
import { createLogger, LogLevel, TelemetrySink, parseLogLevel } from "../src/telemetry";

function makeSettings(level: "trace" | "debug" | "info" | "warn" | "error" = "info") {
  return { telemetry: { level } };
}

describe("TelemetrySink", () => {
  it("captures emitted events in the ring buffer when no adapter is provided", () => {
    const sink = new TelemetrySink(null);
    const logger = createLogger("test", sink, makeSettings("trace"));
    logger.trace("t");
    logger.debug("d");
    logger.info("i");
    logger.warn("w");
    logger.error("e");
    const events = sink.drain();
    expect(events.map(e => (e as { levelName: string }).levelName)).toEqual([
      "trace", "debug", "info", "warn", "error",
    ]);
  });

  it("filters events below the configured minimum level", () => {
    const sink = new TelemetrySink(null);
    const logger = createLogger("test", sink, makeSettings("warn"));
    logger.trace("t");
    logger.debug("d");
    logger.info("i");
    logger.warn("w");
    logger.error("e");
    const names = sink.drain().map(e => (e as { levelName: string }).levelName);
    expect(names).toEqual(["warn", "error"]);
  });

  it("emits telemetry events distinct from log events", () => {
    const sink = new TelemetrySink(null);
    const logger = createLogger("test", sink, makeSettings("info"));
    logger.event("custom.metric", { value: 42 });
    const events = sink.drain();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "telemetry", source: "test", event: "custom.metric", data: { value: 42 } });
  });

  it("child logger inherits sink and adds suffix to source", () => {
    const sink = new TelemetrySink(null);
    const root = createLogger("root", sink, makeSettings("trace"));
    const child = root.child("child");
    child.info("hello");
    const events = sink.drain();
    expect(events).toHaveLength(1);
    expect((events[0] as { source: string }).source).toBe("root.child");
  });

  it("ring buffer caps at 1000 entries", () => {
    const sink = new TelemetrySink(null);
    const logger = createLogger("flood", sink, makeSettings("trace"));
    for (let i = 0; i < 1100; i++) logger.trace(`msg-${i}`);
    const events = sink.drain();
    expect(events.length).toBeLessThanOrEqual(1000);
  });
});

describe("parseLogLevel", () => {
  it("maps known names", () => {
    expect(parseLogLevel("trace")).toBe(LogLevel.TRACE);
    expect(parseLogLevel("debug")).toBe(LogLevel.DEBUG);
    expect(parseLogLevel("info")).toBe(LogLevel.INFO);
    expect(parseLogLevel("warn")).toBe(LogLevel.WARN);
    expect(parseLogLevel("error")).toBe(LogLevel.ERROR);
  });

  it("falls back to INFO for unknown / undefined", () => {
    expect(parseLogLevel(undefined)).toBe(LogLevel.INFO);
    expect(parseLogLevel("nonsense")).toBe(LogLevel.INFO);
  });
});
