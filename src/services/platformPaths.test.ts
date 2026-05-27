import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  appDataRoot,
  lanceRuntimeDir,
  lanceDataDir,
  vaultId,
  legacyLanceDir,
  migrateLegacyStore,
  type PathEnv,
} from "./platformPaths";

const linux = (env: Record<string, string | undefined> = {}): PathEnv => ({
  platform: "linux",
  home: "/home/alice",
  env,
});
const mac: PathEnv = { platform: "darwin", home: "/Users/alice", env: {} };
const win = (env: Record<string, string | undefined> = {}): PathEnv => ({
  platform: "win32",
  home: "C:/Users/alice",
  env,
});

describe("appDataRoot", () => {
  it("linux: respects XDG_DATA_HOME", () => {
    expect(appDataRoot(linux({ XDG_DATA_HOME: "/home/alice/.xdgdata" }))).toBe(
      "/home/alice/.xdgdata/sauce-crm",
    );
  });
  it("linux: falls back to ~/.local/share", () => {
    expect(appDataRoot(linux())).toBe("/home/alice/.local/share/sauce-crm");
    expect(appDataRoot(linux({ XDG_DATA_HOME: "   " }))).toBe(
      "/home/alice/.local/share/sauce-crm",
    );
  });
  it("macOS: Library/Application Support", () => {
    expect(appDataRoot(mac)).toBe(
      "/Users/alice/Library/Application Support/sauce-crm",
    );
  });
  it("windows: prefers LOCALAPPDATA (not roaming)", () => {
    expect(appDataRoot(win({ LOCALAPPDATA: "C:/Users/alice/AppData/Local" }))).toBe(
      "C:/Users/alice/AppData/Local/sauce-crm",
    );
  });
  it("windows: derives from USERPROFILE when LOCALAPPDATA absent", () => {
    expect(appDataRoot(win())).toBe(
      "C:/Users/alice/AppData/Local/sauce-crm",
    );
  });
  it("windows: normalizes backslashes to forward slashes", () => {
    expect(
      appDataRoot(win({ LOCALAPPDATA: "C:\\Users\\alice\\AppData\\Local" })),
    ).toBe("C:/Users/alice/AppData/Local/sauce-crm");
  });
});

describe("runtime + data dirs", () => {
  it("runtime is shared under the root", () => {
    expect(lanceRuntimeDir(linux())).toBe(
      "/home/alice/.local/share/sauce-crm/runtime",
    );
  });
  it("data is per-vault under vaults/", () => {
    const d = lanceDataDir(linux(), "/home/alice/Documents/MyVault");
    expect(d).toMatch(
      /^\/home\/alice\/\.local\/share\/sauce-crm\/vaults\/MyVault-[0-9a-f]{8}\/lancedb$/,
    );
  });
});

describe("vaultId", () => {
  it("is stable for the same path", () => {
    expect(vaultId("/a/b/Vault")).toBe(vaultId("/a/b/Vault"));
  });
  it("ignores trailing slash and backslash style", () => {
    expect(vaultId("/a/b/Vault/")).toBe(vaultId("/a/b/Vault"));
    expect(vaultId("C:\\a\\Vault")).toBe(vaultId("C:/a/Vault"));
  });
  it("differs for different vaults", () => {
    expect(vaultId("/a/Vault1")).not.toBe(vaultId("/a/Vault2"));
  });
  it("sanitizes unsafe characters in the readable prefix", () => {
    const id = vaultId("/a/My Vault! (work)");
    expect(id).toMatch(/^My-Vault----work--[0-9a-f]{8}$|^[A-Za-z0-9._-]+-[0-9a-f]{8}$/);
    expect(id).not.toMatch(/[^A-Za-z0-9._-]/);
  });
});

describe("migrateLegacyStore", () => {
  it("no-op when there is no legacy store", async () => {
    const root = mkdtempSync(join(tmpdir(), "mig-"));
    const r = await migrateLegacyStore(join(root, "nope"), join(root, "target"));
    expect(r).toEqual({ migrated: false, reason: "no-legacy" });
  });

  it("moves a legacy store to the target", async () => {
    const root = mkdtempSync(join(tmpdir(), "mig-"));
    const legacy = join(root, "vault/.obsidian/plugins/sauce-crm/data/lancedb");
    mkdirSync(join(legacy, "entities.lance"), { recursive: true });
    writeFileSync(join(legacy, "entities.lance", "frag.lance"), "x");
    const target = join(root, "central/vaults/v1/lancedb");
    const r = await migrateLegacyStore(legacy, target);
    expect(r.migrated).toBe(true);
    expect(["moved", "copied"]).toContain(r.reason);
    expect(existsSync(join(target, "entities.lance", "frag.lance"))).toBe(true);
    expect(existsSync(legacy)).toBe(false); // legacy removed after move
  });

  it("never clobbers a populated target", async () => {
    const root = mkdtempSync(join(tmpdir(), "mig-"));
    const legacy = join(root, "legacy/lancedb");
    mkdirSync(legacy, { recursive: true });
    writeFileSync(join(legacy, "old.bin"), "old");
    const target = join(root, "target/lancedb");
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, "current.bin"), "current");
    const r = await migrateLegacyStore(legacy, target);
    expect(r).toEqual({ migrated: false, reason: "target-exists" });
    expect(readdirSync(target)).toEqual(["current.bin"]); // untouched
    expect(existsSync(legacy)).toBe(true); // legacy left in place
  });
});

describe("legacyLanceDir", () => {
  it("points at the v1 in-vault data path", () => {
    expect(legacyLanceDir("/v/.obsidian/plugins/sauce-crm")).toBe(
      "/v/.obsidian/plugins/sauce-crm/data/lancedb",
    );
  });
});
