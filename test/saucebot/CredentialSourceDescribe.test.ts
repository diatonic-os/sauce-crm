import { describe, expect, it } from "vitest";
import {
  ChainedCredentialSource,
  type CredentialSource,
} from "../../src/saucebot/CredentialSource";

function fakeSource(label: string, avail: boolean): CredentialSource {
  return {
    label,
    available: () => avail,
    get: async () => null,
    put: async () => {},
    clear: async () => {},
  };
}

describe("ChainedCredentialSource.describe", () => {
  it("marks the FIRST available source active (where writes land)", () => {
    const chain = new ChainedCredentialSource([
      fakeSource("OS keychain (safeStorage)", false),
      fakeSource("KeyVault", true),
    ]);
    const d = chain.describe();
    expect(d).toEqual([
      { label: "OS keychain (safeStorage)", available: false, active: false },
      { label: "KeyVault", available: true, active: true },
    ]);
  });

  it("no active source when none available (no encrypted store)", () => {
    const chain = new ChainedCredentialSource([
      fakeSource("OS keychain (safeStorage)", false),
      fakeSource("KeyVault", false),
    ]);
    expect(chain.available()).toBe(false);
    expect(chain.describe().every((s) => !s.active)).toBe(true);
  });

  it("prefers the earliest available source as active", () => {
    const chain = new ChainedCredentialSource([
      fakeSource("OS keychain (safeStorage)", true),
      fakeSource("KeyVault", true),
    ]);
    const active = chain.describe().filter((s) => s.active);
    expect(active).toHaveLength(1);
    expect(active[0]!.label).toBe("OS keychain (safeStorage)");
  });
});
