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
        // Visible CRM content stays in the vault root.
        "people",
        "orgs",
        "touches",
        "notes",
        "ideas",
        "observations",
        "tasks",
        "events",
        "pipeline",
        // Scaffolding + machine tiers consolidate under hidden .sauceBrain/.
        ".sauceBrain/addenda",
        ".sauceBrain/templates",
        ".sauceBrain/playbooks",
        ".sauceBrain/users",
        ".sauceBrain/saucebot",
        ".sauceBrain/brain",
        ".sauceBrain/cache",
        ".sauceBrain/.tmp",
        ".sauceBrain/artifacts",
        ".sauceBrain/dashboards",
      ]),
    );

    // CLAUDE.md stays at root; dashboard surfaces seed under .sauceBrain/dashboards/.
    expect(app.vault.getAbstractFileByPath("CLAUDE.md")).toBeTruthy();
    for (const name of [
      "_README.md",
      "_MOC.md",
      "_DASHBOARD.md",
      "_TASKS.md",
      "_ADDENDA.md",
      "_IDEAS.md",
      "_EVENTS.md",
      "_POLICY.md",
      "_PLUGIN-CONFIG.md",
    ]) {
      expect(
        app.vault.getAbstractFileByPath(`.sauceBrain/dashboards/${name}`),
      ).toBeTruthy();
    }
  });
});
