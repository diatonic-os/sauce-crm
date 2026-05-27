// Document upload + harvesting (PLAN T7). Accepts txt/md/pdf/docx, extracts
// text, chunks it, embeds each chunk into LanceDB, and fingerprints the document
// + each chunk via provenance (chunk ← document lineage). Harvested chunks are
// RAG context — they never become vault notes.
//
// Extraction is pluggable: txt/md are built-in (no deps); pdf/docx use lazily-
// required parsers (pdf-parse / mammoth) so the plugin loads without them and
// surfaces a clear "install parser" error only when actually harvesting those.

import type { LanceDocChunkStore } from "../backend/lance/LanceDocChunkStore";
import type { DocChunkRow } from "../backend/lance/LanceSchema";

export type DocFormat = "txt" | "md" | "pdf" | "docx";
export const SUPPORTED_FORMATS: DocFormat[] = ["txt", "md", "pdf", "docx"];

export interface ExtractInput {
  bytes?: Uint8Array;
  text?: string;
}
export interface DocExtractor {
  extract(input: ExtractInput): Promise<string>;
}
export type ExtractorRegistry = Partial<Record<DocFormat, DocExtractor>>;

export type HarvestEmbedFn = (text: string) => Promise<number[] | null>;

export interface HarvestProvenance {
  record(
    op: string,
    subject: string,
    kind: string,
    content: string,
    opts?: { parentFp?: string; meta?: Record<string, unknown> | null },
  ): Promise<{ fp: string }>;
}

export interface HarvestInput {
  /** Stable document id (e.g. vault path or content hash). */
  id: string;
  name: string;
  format: DocFormat;
  bytes?: Uint8Array;
  text?: string;
}

export interface HarvestResult {
  docId: string;
  chunks: number;
  skippedChunks: number;
}

export interface HarvestOptions {
  dim: number;
  extractors?: ExtractorRegistry;
  chunkSize?: number;
  overlap?: number;
}

/** Lazily resolve an optional native parser; throws a clear error if absent. */
function lazyRequire<T = unknown>(mod: string): T {
  const req =
    (globalThis as unknown as { require?: NodeRequire }).require ??
    (typeof require !== "undefined" ? require : undefined);
  if (typeof req !== "function")
    throw new Error(`require() unavailable — cannot load ${mod}`);
  try {
    return req(mod) as T;
  } catch {
    throw new Error(
      `Parser "${mod}" is not installed. Run: npm install ${mod} --prefix <pluginDir>`,
    );
  }
}

function decode(input: ExtractInput): string {
  if (typeof input.text === "string") return input.text;
  return new TextDecoder().decode(input.bytes ?? new Uint8Array());
}

export function defaultExtractors(): ExtractorRegistry {
  const plain: DocExtractor = {
    async extract(i) {
      return decode(i);
    },
  };
  return {
    txt: plain,
    md: plain,
    pdf: {
      async extract(i) {
        if (!i.bytes) return decode(i);
        const pdfParse =
          lazyRequire<(b: Buffer) => Promise<{ text: string }>>("pdf-parse");
        return (await pdfParse(Buffer.from(i.bytes))).text;
      },
    },
    docx: {
      async extract(i) {
        if (!i.bytes) return decode(i);
        const mammoth = lazyRequire<{
          extractRawText(o: { buffer: Buffer }): Promise<{ value: string }>;
        }>("mammoth");
        return (await mammoth.extractRawText({ buffer: Buffer.from(i.bytes) }))
          .value;
      },
    },
  };
}

/** Split text into overlapping chunks, preferring whitespace breakpoints. */
export function chunkText(text: string, size = 1000, overlap = 150): string[] {
  const clean = text.replace(/\r\n/g, "\n").trim();
  if (!clean) return [];
  if (clean.length <= size) return [clean];
  const chunks: string[] = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(start + size, clean.length);
    if (end < clean.length) {
      const ws = clean.lastIndexOf(" ", end);
      if (ws > start + size * 0.5) end = ws; // only break on whitespace past the midpoint
    }
    const piece = clean.slice(start, end).trim();
    if (piece) chunks.push(piece);
    if (end >= clean.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return chunks;
}

/** djb2 — chunk dedup hash when no provenance fingerprint is available. */
function djb2(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}

export class DocumentHarvestService {
  private readonly extractors: ExtractorRegistry;
  private readonly chunkSize: number;
  private readonly overlap: number;
  private readonly dim: number;

  constructor(
    private readonly chunks: LanceDocChunkStore,
    private readonly embedFn: HarvestEmbedFn,
    opts: HarvestOptions,
    private readonly provenance: HarvestProvenance | null = null,
  ) {
    this.extractors = opts.extractors ?? defaultExtractors();
    this.chunkSize = opts.chunkSize ?? 1000;
    this.overlap = opts.overlap ?? 150;
    this.dim = opts.dim;
  }

  async harvest(input: HarvestInput): Promise<HarvestResult> {
    const extractor = this.extractors[input.format];
    if (!extractor)
      throw new Error(`Unsupported document format: ${input.format}`);

    const text = await extractor.extract({
      ...(input.bytes !== undefined && { bytes: input.bytes }),
      ...(input.text !== undefined && { text: input.text }),
    });
    const docFp = (
      await this.provenance?.record(
        "harvest",
        `doc:${input.id}`,
        "document",
        text,
        {
          meta: { name: input.name, format: input.format },
        },
      )
    )?.fp;

    const pieces = chunkText(text, this.chunkSize, this.overlap);
    const rows: DocChunkRow[] = [];
    let skipped = 0;
    for (let ord = 0; ord < pieces.length; ord++) {
      const piece = pieces[ord];
      if (piece === undefined) continue; // in-bounds: for-loop over pieces.length
      const vec = await this.embedFn(piece);
      if (!vec || vec.length !== this.dim) {
        skipped += 1;
        continue;
      }
      const chunkId = `${input.id}#${ord}`;
      const chunkRec = await this.provenance?.record(
        "embed",
        `chunk:${chunkId}`,
        "chunk",
        piece,
        {
          ...(docFp !== undefined && { parentFp: docFp }),
          meta: { ord },
        },
      );
      rows.push({
        chunk_id: chunkId,
        doc_id: input.id,
        doc_name: input.name,
        ord,
        text: piece,
        vector: vec,
        hash: chunkRec?.fp ?? djb2(piece),
      });
    }

    // Replace any prior chunks for this document, then insert the fresh set.
    await this.chunks.deleteByDoc(input.id);
    await this.chunks.addChunks(rows);
    return { docId: input.id, chunks: rows.length, skippedChunks: skipped };
  }

  /** Retrieve the k most relevant document chunks for an embedded query. */
  async search(queryVector: number[], k = 5) {
    return this.chunks.search(queryVector, k);
  }
}
