import { beforeEach, describe, expect, it } from "vitest";
import { App } from "obsidian";
import { VaultBootstrapper } from "../../src/services/VaultBootstrapper";
import { DEFAULT_PATHS } from "../../src/services/EntityService";

describe("VaultBootstrapper", () => {
  let app: App;
  let bootstrapper: VaultBootstrapper;

  beforeEach(() => {
    app = new App();
    bootstrapper = new VaultBootstrapper(app, DEFAULT_PATHS);
  });

  it("creates the canonical user folders and bootstrap notes", async () => {
    const result = await bootstrapper.ensure();

    expect(result.created).toEqual(
      expect.arrayContaining([
        "people",
        "orgs",
        "touches",
        "_addenda",
        "notes",
        "ideas",
        "observations",
        "tasks",
        "events",
        "ledger",
        "pipeline",
        "_templates",
        "_playbooks",
        "$user",
      ]),
    );

    for (const path of [
      "CLAUDE.md",
      "_README.md",
      "_MOC.md",
      "_DASHBOARD.md",
      "_TASKS.md",
      "_ADDENDA.md",
      "_IDEAS.md",
      "_EVENTS.md",
      "_LEDGER.md",
      "_POLICY.md",
      "_PLUGIN-CONFIG.md",
    ]) {
      expect(app.vault.getAbstractFileByPath(path)).toBeTruthy();
    }
  });
});
