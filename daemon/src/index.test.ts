// sauce-crm-daemon · argv/env parsing specs (pure; no process spawn).

import { describe, expect, it } from "vitest";
import { parseArgv, envOverrides } from "./index";

describe("parseArgv", () => {
  it("parses --flag value and --flag=value forms", () => {
    expect(
      parseArgv([
        "--port",
        "9000",
        "--config=/tmp/c.json",
        "--data-dir",
        "/data",
        "--vault=/vault/x",
        "--log-file",
        "/tmp/d.log",
      ]),
    ).toEqual({
      port: 9000,
      config: "/tmp/c.json",
      dataDir: "/data",
      vault: "/vault/x",
      logFile: "/tmp/d.log",
    });
  });

  it("ignores unknown flags", () => {
    expect(parseArgv(["--bogus", "x", "--port", "1"])).toEqual({ port: 1 });
  });

  it("returns empty object for no args", () => {
    expect(parseArgv([])).toEqual({});
  });
});

describe("envOverrides", () => {
  it("reads SAUCE_DAEMON_* env vars", () => {
    expect(
      envOverrides({
        SAUCE_DAEMON_PORT: "8788",
        SAUCE_DAEMON_VAULT: "/v",
      }),
    ).toEqual({ port: 8788, vault: "/v" });
  });

  it("returns empty object when no env set", () => {
    expect(envOverrides({})).toEqual({});
  });
});
