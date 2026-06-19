// EntityService — file IO round-trip tests. Uses the in-memory obsidian
// stub so the vault, files, and frontmatter cache live in JS heap only.

import { describe, expect, it, beforeEach } from "vitest";
import { App, TFile, TFolder } from "obsidian";
import { EntityService, DEFAULT_PATHS } from "../../src/services/EntityService";
import { TemplateService } from "../../src/services/TemplateService";

describe("EntityService — folder creation", () => {
  let app: App;
  let svc: EntityService;
  beforeEach(() => {
    app = new App();
    svc = new EntityService(app, DEFAULT_PATHS);
  });

  it("ensureFolder creates a new folder when absent", async () => {
    const folder = await svc.ensureFolder("people");
    expect(folder).toBeInstanceOf(TFolder);
    expect(app.vault.getAbstractFileByPath("people")).toBe(folder);
  });

  it("ensureFolder is idempotent — second call returns the existing folder", async () => {
    const f1 = await svc.ensureFolder("orgs");
    const f2 = await svc.ensureFolder("orgs");
    expect(f1).toBe(f2);
  });

  it("normalizes paths with extra slashes", async () => {
    const folder = await svc.ensureFolder("//touches//");
    expect(folder.path).toBe("touches");
  });
});

describe("EntityService — entity creation + frontmatter round-trip", () => {
  let app: App;
  let svc: EntityService;
  beforeEach(() => {
    app = new App();
    svc = new EntityService(app, DEFAULT_PATHS);
  });

  it("createEntity writes a file with serialized frontmatter + body", async () => {
    const fm = { type: "warm-contact", name: "Alice", roles: ["co-founder"] };
    const file = await svc.createEntity(
      "people",
      "Alice",
      fm,
      "## Notes\n\nFirst met at ETHDenver.",
    );
    expect(file).toBeInstanceOf(TFile);
    expect(file.path).toBe("people/Alice.md");
    const content = await app.vault.cachedRead(file);
    expect(content).toContain("---");
    expect(content).toContain("type: warm-contact");
    expect(content).toContain("name: Alice");
    expect(content).toContain("First met at ETHDenver.");
  });

  it("serializes frontmatter through the Obsidian YAML API shape", async () => {
    const fm = TemplateService.ideaFrontmatter({
      title: "Pricing: enterprise #1",
      contact: "[[Alice Example]]",
      next_action: undefined,
      tags: ["idea", "pricing"],
    });
    const file = await svc.createEntity(
      "ideas",
      "Pricing",
      {
        ...fm,
        unsafe_undefined: undefined,
        unsafe_date: new Date("2026-05-23T12:00:00.000Z"),
        unsafe_nan: Number.NaN,
      },
      "body",
    );

    const content = await app.vault.cachedRead(file);
    expect(content).toContain('title: "Pricing: enterprise #1"');
    expect(content).toContain('contact: "[[Alice Example]]"');
    expect(content).toContain('unsafe_date: "2026-05-23T12:00:00.000Z"');
    expect(content).toContain("unsafe_nan:");
    expect(content).not.toContain("unsafe_undefined");
    expect(content).not.toContain("undefined");
    expect(content).toContain(
      '  - "stage_enum: stage in [seed, shaping, planned, active, shipped, archived]"',
    );
  });

  it("createEntity creates parent folder if missing", async () => {
    await svc.createEntity(
      "people",
      "Bob",
      { type: "warm-contact", name: "Bob" },
      "",
    );
    expect(app.vault.getAbstractFileByPath("people")).toBeInstanceOf(TFolder);
  });

  it("createEntity updates an existing file rather than failing", async () => {
    const f1 = await svc.createEntity(
      "people",
      "Carol",
      { type: "warm-contact", name: "Carol", age: 30 },
      "",
    );
    const f2 = await svc.createEntity(
      "people",
      "Carol",
      { type: "warm-contact", name: "Carol", age: 31 },
      "",
    );
    // Same file path → same TFile reference.
    expect(f1.path).toBe(f2.path);
  });
});

describe("EntityService — frontmatter mutation", () => {
  let app: App;
  let svc: EntityService;
  beforeEach(() => {
    app = new App();
    svc = new EntityService(app, DEFAULT_PATHS);
  });

  it("updateFrontmatter applies the mutator and persists", async () => {
    const file = await svc.createEntity(
      "people",
      "Dana",
      { type: "warm-contact", name: "Dana", last_touch: "2026-01-15" },
      "",
    );
    await svc.updateFrontmatter(file, (fm) => {
      fm.last_touch = "2026-05-23";
      fm.cadence = "quarterly";
    });
    const content = await app.vault.cachedRead(file);
    expect(content).toContain("last_touch: 2026-05-23");
    expect(content).toContain("cadence: quarterly");
  });

  it("updateFrontmatter mutator returning a new object replaces the frontmatter", async () => {
    const file = await svc.createEntity(
      "people",
      "Eve",
      { type: "warm-contact", name: "Eve", old: "stale" },
      "",
    );
    await svc.updateFrontmatter(file, () => ({
      type: "warm-contact",
      name: "Eve",
      refreshed: true,
    }));
    const content = await app.vault.cachedRead(file);
    expect(content).toContain("refreshed: true");
    expect(content).not.toContain("old: stale");
  });

  it("normalizes processFrontMatter mutations before Obsidian writes them", async () => {
    const file = await svc.createEntity(
      "people",
      "Grace",
      { type: "warm-contact", name: "Grace" },
      "",
    );
    await svc.updateFrontmatter(file, (fm) => {
      fm.keep = "yes";
      fm.drop = undefined;
      fm.when = new Date("2026-05-23T12:00:00.000Z");
      fm.constrains = [{ ok_rule: "keep == yes" }];
    });
    const content = await app.vault.cachedRead(file);
    expect(content).toContain("keep: yes");
    expect(content).toContain("when: 2026-05-23T12:00:00.000Z");
    expect(content).toContain('constrains: ["ok_rule: keep == yes"]');
    expect(content).not.toContain("drop:");
  });
});

describe("EntityService — file lookup", () => {
  let app: App;
  let svc: EntityService;
  beforeEach(() => {
    app = new App();
    svc = new EntityService(app, DEFAULT_PATHS);
  });

  it("getFile returns the file for an existing path", async () => {
    const created = await svc.createEntity(
      "people",
      "Frank",
      { type: "warm-contact", name: "Frank" },
      "",
    );
    const found = svc.getFile("people/Frank.md");
    expect(found).toBe(created);
  });

  it("getFile returns null for a missing path", () => {
    expect(svc.getFile("people/ghost.md")).toBeNull();
  });

  it("getFile returns null when path is a folder", async () => {
    await svc.ensureFolder("orgs");
    expect(svc.getFile("orgs")).toBeNull();
  });
});
