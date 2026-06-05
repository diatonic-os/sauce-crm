// @vitest-environment node
import { describe, expect, it } from "vitest";
import { App, TFile } from "obsidian";
import { DEFAULT_PATHS, EntityService } from "../../src/services/EntityService";
import { GraphAtlasService } from "../../src/services/GraphAtlasService";

async function makeEntity(
  app: App,
  path: string,
  frontmatter: Record<string, unknown>,
): Promise<void> {
  await app.vault.create(
    path,
    `---\n${JSON.stringify(frontmatter)}\n---\nbody`,
  );
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
    const snapshot = atlas.snapshot({
      now: new Date("2026-05-23T12:00:00Z").getTime(),
      width: 1200,
      height: 800,
    });
    const alice = snapshot.nodeById.get("people/Alice.md");
    const bob = snapshot.nodeById.get("people/Bob.md");
    const acme = snapshot.nodeById.get("orgs/Acme.md");
    const note = snapshot.nodeById.get("notes/Memo.md");
    const task = snapshot.nodeById.get("tasks/Followup.md");

    expect(alice?.kind).toBe("person");
    expect(acme?.kind).toBe("org");
    expect(alice?.icon).toBe("sauce-person");
    expect(acme?.icon).toBe("sauce-org");
    expect(alice?.score ?? 0).toBeGreaterThan(bob?.score ?? 0);
    expect(alice?.radius ?? 0).toBeGreaterThan(note?.radius ?? 0);
    expect(task?.score ?? 0).toBeGreaterThan(0);
    expect(snapshot.edges.some((e) => e.relation === "geo")).toBe(true);
    expect(
      snapshot.edges.some(
        (e) => e.source === "people/Alice.md" && e.target === "people/Bob.md",
      ),
    ).toBe(true);
  });

  it("tallies incident interaction edges into node.interactions and score", async () => {
    const app = new App();
    const entities = new EntityService(app, DEFAULT_PATHS);
    const now = new Date("2026-05-23T12:00:00Z").getTime();

    // A person referenced by two touch notes (each links back via `contact`).
    await makeEntity(app, "people/Carol.md", {
      type: "warm-contact",
      name: "Carol",
      tags: ["vip"],
      last_touch: "2026-05-20",
    });
    // An otherwise-identical person with NO touches — the control.
    await makeEntity(app, "people/Dave.md", {
      type: "warm-contact",
      name: "Dave",
      tags: ["vip"],
      last_touch: "2026-05-20",
    });
    await makeEntity(app, "touches/2026/05/t1.md", {
      type: "touch",
      contact: "[[Carol]]",
      date: "2026-05-21",
    });
    await makeEntity(app, "touches/2026/05/t2.md", {
      type: "touch",
      contact: "[[Carol]]",
      date: "2026-05-22",
    });

    const atlas = new GraphAtlasService(app, entities);
    const snapshot = atlas.snapshot({ now, width: 1200, height: 800 });
    const carol = snapshot.nodeById.get("people/Carol.md");
    const dave = snapshot.nodeById.get("people/Dave.md");

    // Carol has two incident `contact` edges from touch nodes; the tally adds 2
    // on top of her intrinsic person interactionScore (1.5 + tag boost).
    expect(carol).toBeDefined();
    expect(dave).toBeDefined();
    expect(carol!.interactions).toBeGreaterThan(dave!.interactions);
    expect(carol!.interactions - dave!.interactions).toBeCloseTo(2, 5);
    // The blended score term (incidentInteractions * 0.25) lifts Carol above Dave.
    expect(carol!.score).toBeGreaterThan(dave!.score);
    // The touch nodes themselves are interaction endpoints — they receive no tally.
    const t1 = snapshot.nodeById.get("touches/2026/05/t1.md");
    expect(t1!.interactions).toBe(atlasIntrinsicTouchScore());
  });

  it("uses file mtime as a recency fallback when no date frontmatter exists", async () => {
    const app = new App();
    const entities = new EntityService(app, DEFAULT_PATHS);
    const now = new Date("2026-05-23T12:00:00Z").getTime();
    const atlas = new GraphAtlasService(app, entities);
    // recencyScore is private; exercise it via a narrow cast so we can drive the
    // mtime fallback directly without round-tripping through snapshot().
    const recency = (
      atlas as unknown as {
        recencyScore: (
          fm: Record<string, unknown>,
          now: number,
          file: TFile,
        ) => number;
      }
    ).recencyScore.bind(atlas);

    const recentFile = new TFile("notes/Recent.md");
    (recentFile as unknown as { stat: { mtime: number } }).stat = {
      mtime: now - 2 * 86_400_000, // 2 days old
    };
    const oldFile = new TFile("notes/Old.md");
    (oldFile as unknown as { stat: { mtime: number } }).stat = {
      mtime: now - 400 * 86_400_000, // ~13 months old
    };

    // No ISO date in frontmatter → mtime fallback engages.
    const recentScore = recency({}, now, recentFile);
    const oldScore = recency({}, now, oldFile);

    // A 2-day-old note scores well above the 0.15 flat floor.
    expect(recentScore).toBeGreaterThan(0.15);
    // An ~400-day-old note decays toward (and stays at/above) the 0.1 clamp floor,
    // and is far below the recent note.
    expect(oldScore).toBeLessThan(recentScore);
    expect(oldScore).toBeGreaterThanOrEqual(0.1);
    expect(oldScore).toBeLessThan(0.15);
  });
});

/** Intrinsic interactionScore for a touch node (kind === "touch") is the literal
 *  3 from interactionScore(); with zero incident-interaction tally the node's
 *  reported interactions equals that constant. */
function atlasIntrinsicTouchScore(): number {
  return 3;
}
