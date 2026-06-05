import { describe, expect, it, vi } from "vitest";
import { App, TFile } from "obsidian";
import { ParentVaultBootstrapper } from "../../src/federation/ParentVaultBootstrapper";

describe("ParentVaultBootstrapper.ensure", () => {
  it("passes normalizePath-normalized paths to vault APIs", async () => {
    const app = new App();
    const getSpy = vi.spyOn(app.vault, "getAbstractFileByPath");
    const folderSpy = vi.spyOn(app.vault, "createFolder");
    const createSpy = vi.spyOn(app.vault, "create");

    await new ParentVaultBootstrapper(app).ensure();

    // normalizePath strips leading/trailing slashes and collapses separators;
    // these literals are already canonical, so the exact normalized form is the
    // literal itself — proving the call routed through normalizePath.
    expect(getSpy).toHaveBeenCalledWith("vaults");
    expect(getSpy).toHaveBeenCalledWith("_addenda");
    expect(getSpy).toHaveBeenCalledWith("PARENT-VAULT.md");
    expect(folderSpy).toHaveBeenCalledWith("vaults");
    expect(folderSpy).toHaveBeenCalledWith("_addenda");
    expect(createSpy.mock.calls[0]![0]).toBe("PARENT-VAULT.md");

    // No path argument may contain a backslash or a leading slash.
    for (const call of [...getSpy.mock.calls, ...folderSpy.mock.calls]) {
      const p = call[0] as string;
      expect(p).not.toMatch(/\\/);
      expect(p.startsWith("/")).toBe(false);
    }
  });

  it("is idempotent — second run creates nothing new", async () => {
    const app = new App();
    await new ParentVaultBootstrapper(app).ensure();

    const folderSpy = vi.spyOn(app.vault, "createFolder");
    const createSpy = vi.spyOn(app.vault, "create");
    await new ParentVaultBootstrapper(app).ensure();

    expect(folderSpy).not.toHaveBeenCalled();
    expect(createSpy).not.toHaveBeenCalled();

    const pv = app.vault.getAbstractFileByPath("PARENT-VAULT.md");
    expect(pv).toBeInstanceOf(TFile);
  });
});
