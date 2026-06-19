// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { tmpLance, type TmpLance } from "../backend/_lance-tmp";
import { TABLES } from "../../src/backend/lance/LanceSchema";
import { LanceDocChunkStore } from "../../src/backend/lance/LanceDocChunkStore";
import {
  DocumentHarvestService,
  chunkText,
  type HarvestProvenance,
} from "../../src/services/DocumentHarvest";

const DIM = 4;
// Deterministic fake embedder: chunks mentioning "alpha" point one way.
const embed = async (text: string) =>
  /alpha/i.test(text) ? [1, 0, 0, 0] : [0, 1, 0, 0];

describe("chunkText", () => {
  it("returns a single chunk for short text", () => {
    expect(chunkText("hello world", 1000)).toEqual(["hello world"]);
  });

  it("splits long text into overlapping chunks on whitespace", () => {
    const text = Array.from({ length: 50 }, (_, i) => `word${i}`).join(" ");
    const chunks = chunkText(text, 60, 10);
    expect(chunks.length).toBeGreaterThan(1);
    // no chunk exceeds the size budget by much, and all non-empty
    expect(chunks.every((c) => c.length > 0 && c.length <= 60)).toBe(true);
  });

  it("returns [] for empty/whitespace", () => {
    expect(chunkText("   \n  ")).toEqual([]);
  });
});

describe("DocumentHarvestService", () => {
  let h: TmpLance;
  afterEach(() => h?.cleanup());

  async function svc(prov: HarvestProvenance | null = null) {
    h = await tmpLance();
    const store = new LanceDocChunkStore(
      await h.table(TABLES.docChunks, DIM),
      DIM,
    );
    return {
      store,
      harvester: new DocumentHarvestService(
        store,
        embed,
        { dim: DIM, chunkSize: 40, overlap: 5 },
        prov,
      ),
    };
  }

  it("harvests a txt document into searchable chunks", async () => {
    const { harvester } = await svc();
    const text =
      "alpha section about founders. " +
      "beta section about something else entirely here.";
    const r = await harvester.harvest({
      id: "doc:notes",
      name: "notes.txt",
      format: "txt",
      text,
    });
    expect(r.chunks).toBeGreaterThan(0);

    const hits = await harvester.search([1, 0, 0, 0], 1);
    expect(hits[0].text.toLowerCase()).toContain("alpha");
    expect(hits[0].docId).toBe("doc:notes");
  });

  it("re-harvesting replaces a document's chunks", async () => {
    const { store, harvester } = await svc();
    await harvester.harvest({
      id: "doc:x",
      name: "x",
      format: "md",
      text: "alpha one alpha two alpha three",
    });
    const first = (await store.listDocs())[0].chunks;
    await harvester.harvest({
      id: "doc:x",
      name: "x",
      format: "md",
      text: "alpha solo",
    });
    const docs = await store.listDocs();
    expect(docs).toHaveLength(1);
    expect(docs[0].chunks).toBeLessThanOrEqual(first); // replaced, not appended
    expect(docs[0].chunks).toBe(1);
  });

  it("throws on an unsupported format", async () => {
    const { harvester } = await svc();
    // @ts-expect-error testing an invalid format at runtime
    await expect(
      harvester.harvest({ id: "d", name: "d", format: "xlsx", text: "x" }),
    ).rejects.toThrow(/Unsupported/);
  });

  it("records provenance lineage: chunk parentFp === document fp", async () => {
    const calls: {
      op: string;
      subject: string;
      kind: string;
      parentFp?: string;
      fp: string;
    }[] = [];
    let n = 0;
    const prov: HarvestProvenance = {
      async record(op, subject, kind, _content, opts) {
        const fp = `fp${n++}`;
        calls.push({ op, subject, kind, parentFp: opts?.parentFp, fp });
        return { fp };
      },
    };
    const { harvester } = await svc(prov);
    await harvester.harvest({
      id: "doc:p",
      name: "p",
      format: "txt",
      text: "alpha chunk content here for embedding",
    });

    const doc = calls.find((c) => c.kind === "document")!;
    const chunks = calls.filter((c) => c.kind === "chunk");
    expect(doc.op).toBe("harvest");
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.every((c) => c.parentFp === doc.fp)).toBe(true);
  });

  it("skips chunks whose embedding dimension mismatches", async () => {
    h = await tmpLance();
    const store = new LanceDocChunkStore(
      await h.table(TABLES.docChunks, DIM),
      DIM,
    );
    const badEmbed = async () => [1, 2, 3]; // dim 3 != 4
    const harvester = new DocumentHarvestService(store, badEmbed, {
      dim: DIM,
      chunkSize: 40,
    });
    const r = await harvester.harvest({
      id: "doc:bad",
      name: "bad",
      format: "txt",
      text: "alpha beta gamma delta epsilon",
    });
    expect(r.chunks).toBe(0);
    expect(r.skippedChunks).toBeGreaterThan(0);
  });
});
