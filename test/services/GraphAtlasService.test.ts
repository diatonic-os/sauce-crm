// @vitest-environment node
import { describe, expect, it } from "vitest";
import { App } from "obsidian";
import { DEFAULT_PATHS, EntityService } from "../../src/services/EntityService";
import { GraphAtlasService } from "../../src/services/GraphAtlasService";

async function makeEntity(
  app: App,
  path: string,
  frontmatter: Record<string, unknown>,
): Promise<void> {
  await app.vault.create(path, `---\n${JSON.stringify(frontmatter)}\n---\nbody`);
  app.metadataCache.setFrontmatter(path, frontmatter);
}

describe("GraphAtlasService", () => {
  it("weights relationship-heavy and geo-close nodes more strongly", async () => {
    const app = new App();
    const entities = new EntityService(app, DEFAULT_PATHS);

    await makeEntity(app, "people/Alice.md", {
      type: "warm-contact",
      name: "Alice",
      knows: ["[[Bob]]"],
      worked_with: ["[[Acme]]"],
      tags: ["vip", "founder"],
      last_touch: "2026-05-22",
      lat: 41.8781,
      lon: -87.6298,
    });
    await makeEntity(app, "people/Bob.md", {
      type: "warm-contact",
      name: "Bob",
      tags: ["peer"],
      last_touch: "2026-03-01",
      lat: 41.88,
      lon: -87.63,
    });
    await makeEntity(app, "orgs/Acme.md", {
      type: "org",
      name: "Acme",
      parent: "",
      tags: ["priority"],
      lat: 41.881,
      lon: -87.63,
    });
    await makeEntity(app, "notes/Memo.md", {
      type: "knowledge-note",
      title: "Memo",
      tags: ["research"],
    });
    await makeEntity(app, "tasks/Followup.md", {
      type: "task",
      title: "Follow up",
      status: "todo",
      contact: "[[Alice]]",
      due: "2026-05-24",
    });

    const atlas = new GraphAtlasService(app, entities);
    const snapshot = atlas.snapshot({ now: new Date("2026-05-23T12:00:00Z").getTime(), width: 1200, height: 800 });
    const alice = snapshot.nodeById.get("people/Alice.md");
    const bob = snapshot.nodeById.get("people/Bob.md");
    const acme = snapshot.nodeById.get("orgs/Acme.md");
    const note = snapshot.nodeById.get("notes/Memo.md");
    const task = snapshot.nodeById.get("tasks/Followup.md");

    expect(alice?.kind).toBe("person");
    expect(acme?.kind).toBe("org");
    expect(alice?.icon).toBe("sauce-person");
    expect(acme?.icon).toBe("sauce-org");
    expect((alice?.score ?? 0)).toBeGreaterThan((bob?.score ?? 0));
    expect((alice?.radius ?? 0)).toBeGreaterThan((note?.radius ?? 0));
    expect((task?.score ?? 0)).toBeGreaterThan(0);
    expect(snapshot.edges.some((e) => e.relation === "geo")).toBe(true);
    expect(snapshot.edges.some((e) => e.source === "people/Alice.md" && e.target === "people/Bob.md")).toBe(true);
  });
});
