import { beforeEach, describe, expect, it } from "vitest";
import { App } from "obsidian";
import {
  SauceBrainMigration,
  SAUCE_BRAIN_MIGRATION_VERSION,
  type MigratedSettings,
} from "../../src/services/SauceBrainMigration";
import { DEFAULT_PATHS, SAUCE_BRAIN_ROOT } from "../../src/services/EntityService";

// A snapshot of the pre-consolidation defaults (≤0.5.0). New code no longer
// exports these, so the test pins them locally to simulate an existing install.
const LEGACY_PATHS = {
  ...DEFAULT_PATHS,
  addenda: "_addenda",
  templates: "_templates",
  playbooks: "_playbooks",
  user: "$user",
  meta: "_meta",
  weekly: "_weekly",
  staging: "_staging",
  scripts: "_scripts",
  saucebot: "_saucebot",
  saucebotAgents: "_saucebot/agents",
  saucebotPrompts: "_saucebot/prompts",
};

function legacySettings(): MigratedSettings {
  return {
    paths: { ...LEGACY_PATHS },
    brainFolder: "_brain",
  };
}

async function seed(app: App, path: string, body: string): Promise<void> {
  const parts = path.split("/");
  let acc = "";
  for (let i = 0; i < parts.length - 1; i++) {
    acc = acc ? `${acc}/${parts[i]}` : parts[i];
    await app.vault.createFolder(acc);
  }
  await app.vault.create(path, body);
}

describe("SauceBrainMigration", () => {
  let app: App;
  const fixedNow = () => Date.parse("2026-06-19T12:00:00.000Z");

  beforeEach(() => {
    app = new App();
  });

  it("moves legacy scaffolding into .sauceBrain, preserving content", async () => {
    await seed(app, "_addenda/_copilot/2026-06-01-chat.md", "# session one");
    await seed(app, "_meta/index.md", "meta body");
    await seed(app, "_saucebot/agents/_default-agent.md", "agent");
    await seed(app, "$user/profile.md", "me");
    await seed(app, "_brain/brain.json", "{}");
    // Visible content must NOT move.
    await seed(app, "people/Jane Doe.md", "person");

    const settings = legacySettings();
    const report = await new SauceBrainMigration(app, { now: fixedNow }).run(
      settings,
    );

    expect(report.skipped).toBe(false);
    expect(report.totalFilesMoved).toBe(5);

    // Files landed at new hidden locations with content intact.
    const moved = app.vault.getAbstractFileByPath(
      `${SAUCE_BRAIN_ROOT}/addenda/_copilot/2026-06-01-chat.md`,
    );
    expect(moved).not.toBeNull();
    expect((moved as any).contents).toBe("# session one");
    expect(
      app.vault.getAbstractFileByPath(
        `${SAUCE_BRAIN_ROOT}/saucebot/agents/_default-agent.md`,
      ),
    ).not.toBeNull();
    expect(
      app.vault.getAbstractFileByPath(`${SAUCE_BRAIN_ROOT}/users/profile.md`),
    ).not.toBeNull();
    expect(
      app.vault.getAbstractFileByPath(`${SAUCE_BRAIN_ROOT}/brain/brain.json`),
    ).not.toBeNull();

    // Legacy file paths are gone (moved, not copied).
    expect(
      app.vault.getAbstractFileByPath("_addenda/_copilot/2026-06-01-chat.md"),
    ).toBeNull();

    // Visible CRM content untouched.
    expect(app.vault.getAbstractFileByPath("people/Jane Doe.md")).not.toBeNull();

    // Settings rewired to new layout + stamped.
    expect(settings.paths.addenda).toBe(`${SAUCE_BRAIN_ROOT}/addenda`);
    expect(settings.paths.user).toBe(`${SAUCE_BRAIN_ROOT}/users`);
    expect(settings.brainFolder).toBe(`${SAUCE_BRAIN_ROOT}/brain`);
    expect(settings.sauceBrainMigration?.version).toBe(
      SAUCE_BRAIN_MIGRATION_VERSION,
    );
  });

  it("moves NON-markdown files too (scripts/CSVs/html), then clears the folder", async () => {
    await seed(app, "_scripts/enrich_batch.py", "print('x')");
    await seed(app, "_staging/candidates.csv", "a,b,c");
    await seed(app, "_brain/sauce-brain.html", "<html></html>");
    const settings = legacySettings();
    await new SauceBrainMigration(app, { now: fixedNow }).run(settings);
    expect(app.vault.getAbstractFileByPath(`${SAUCE_BRAIN_ROOT}/scripts/enrich_batch.py`)).not.toBeNull();
    expect(app.vault.getAbstractFileByPath(`${SAUCE_BRAIN_ROOT}/staging/candidates.csv`)).not.toBeNull();
    expect(app.vault.getAbstractFileByPath(`${SAUCE_BRAIN_ROOT}/brain/sauce-brain.html`)).not.toBeNull();
    expect(app.vault.getAbstractFileByPath("_scripts")).toBeNull();
    expect(app.vault.getAbstractFileByPath("_staging")).toBeNull();
  });

  it("removes the emptied legacy folder after moving its files (no hollow shells)", async () => {
    await seed(app, "_meta/index.md", "x");
    const settings = legacySettings();
    await new SauceBrainMigration(app, { now: fixedNow }).run(settings);
    // File moved AND the old folder is gone — not left as a hollow root shell.
    expect(app.vault.getAbstractFileByPath(`${SAUCE_BRAIN_ROOT}/meta/index.md`)).not.toBeNull();
    expect(app.vault.getAbstractFileByPath("_meta")).toBeNull();
  });

  it("removes an ALREADY-empty legacy folder ($user/_playbooks shells)", async () => {
    await app.vault.createFolder("$user");
    await app.vault.createFolder("_playbooks");
    const settings = legacySettings();
    const report = await new SauceBrainMigration(app, { now: fixedNow }).run(settings);
    expect(app.vault.getAbstractFileByPath("$user")).toBeNull();
    expect(app.vault.getAbstractFileByPath("_playbooks")).toBeNull();
    expect(report.moves.some((m) => m.removedLegacyFolder)).toBe(true);
  });

  it("remaps sub-path keys (saucebotAgents/Prompts) under a moved legacy root", async () => {
    const settings = legacySettings();
    settings.paths.saucebotAgents = "_saucebot/agents";
    settings.paths.saucebotPrompts = "_saucebot/prompts";
    await new SauceBrainMigration(app, { now: fixedNow }).run(settings);
    expect(settings.paths.saucebotAgents).toBe(`${SAUCE_BRAIN_ROOT}/saucebot/agents`);
    expect(settings.paths.saucebotPrompts).toBe(`${SAUCE_BRAIN_ROOT}/saucebot/prompts`);
  });

  it("is idempotent — a second run is skipped with no moves", async () => {
    await seed(app, "_meta/index.md", "meta");
    const settings = legacySettings();
    const mig = new SauceBrainMigration(app, { now: fixedNow });

    await mig.run(settings);
    const second = await mig.run(settings);

    expect(second.skipped).toBe(true);
    expect(second.totalFilesMoved).toBe(0);
  });

  it("never overwrites — a destination collision leaves the source in place", async () => {
    await seed(app, "_meta/index.md", "LEGACY");
    await seed(app, `${SAUCE_BRAIN_ROOT}/meta/index.md`, "ALREADY THERE");

    const settings = legacySettings();
    const report = await new SauceBrainMigration(app, { now: fixedNow }).run(
      settings,
    );

    // Destination preserved, source not destroyed.
    expect(
      (app.vault.getAbstractFileByPath(`${SAUCE_BRAIN_ROOT}/meta/index.md`) as any)
        .contents,
    ).toBe("ALREADY THERE");
    expect(
      (app.vault.getAbstractFileByPath("_meta/index.md") as any).contents,
    ).toBe("LEGACY");
    expect(report.conflicts.length).toBeGreaterThan(0);
  });

  it("fresh install (no legacy folders) stamps version and adopts new defaults", async () => {
    const settings: MigratedSettings = { paths: { ...DEFAULT_PATHS } };
    const report = await new SauceBrainMigration(app, { now: fixedNow }).run(
      settings,
    );

    expect(report.totalFilesMoved).toBe(0);
    expect(report.skipped).toBe(false);
    expect(settings.sauceBrainMigration?.version).toBe(
      SAUCE_BRAIN_MIGRATION_VERSION,
    );
  });
});
