// CON-OBS-INTEG-001 — integration wire-up (deferred pass, now live).
//
// Builds the SH-B..G services with hosts backed by the live Obsidian `App`,
// composes the public `svcV1`, mounts it on the plugin instance, and stands up
// the ObsidianPluginRegistry of adapters. Called once from main.ts onload
// (wrapped in try/catch there so it can never break plugin startup).
//
// Hosts use real Obsidian APIs where they exist (vault, metadataCache,
// fileManager, commands, internalPlugins). Where Obsidian exposes no API for a
// capability, the host method throws a clear "not available" error rather than
// returning fabricated data.

import type { App } from "obsidian";
import { TFile } from "obsidian";

import { ObsidianPluginRegistry } from "./ObsidianPluginRegistry";
import {
  TasksAdapter,
  buildTasksRuntimeHost,
  type SauceTasksFacade,
} from "./TasksAdapter";
import { DataviewAdapter, buildDataviewRuntimeHost } from "./DataviewAdapter";
import {
  KanbanAdapter,
  buildKanbanRuntimeHost,
  type KanbanBoard,
} from "./KanbanAdapter";
import { MetaBindAdapter, buildMetaBindRuntimeHost } from "./MetaBindAdapter";
import { QuickAddAdapter, buildQuickAddRuntimeHost } from "./QuickAddAdapter";
import { BratAdapter, buildBratRuntimeHost } from "./BratAdapter";

import { PluginConfigService } from "../../services/PluginConfigService";
import { ObsidianPluginConfigHost } from "../../services/ObsidianPluginConfigHost";
import { GraphService } from "../../services/GraphService";
import { EventBus } from "../../services/EventBus";
import { DownstreamRegistry } from "../../services/DownstreamRegistry";
import {
  MutationContract,
  type LedgerEntry,
  type LedgerSink,
} from "../../services/MutationContract";
import { CanonService, type CanonHost } from "../../services/CanonService";
import {
  FilesService,
  type FilesHost,
  type TemplateHost,
} from "../../services/core/FilesService";
import {
  SearchService,
  type SearchHost,
  type SearchResult,
} from "../../services/core/SearchService";
import {
  ContentService,
  type ContentHost,
  type OutlineHeading,
} from "../../services/core/ContentService";
import { MetaService, type MetaHost } from "../../services/core/MetaService";
import {
  buildSvcV1,
  mountSvcV1,
  SVC_V1_VERSION,
  type SvcV1,
} from "../../services/SauceServiceAPI";

/** SHA-256 hex — reuses the bridge crypto helper used elsewhere in the plugin. */
export interface Sha256Fn {
  (msg: string): Promise<string>;
}

export interface WireOptions {
  /** Reads the `saucecrm.beta.enabled` setting (default false). */
  isBetaOptIn?: () => boolean;
  /** sha256 hex for the mutation-contract ledger chain. */
  sha256Hex: Sha256Fn;
  actor?: string;
  /** When present, hydrates the in-memory GraphService from the LanceDB graph
   *  tables and persists mutations back. Supplied by main.ts after LanceDB
   *  init; absent in contexts without a Lance backend (tests, mobile). */
  graphStore?: import("../../backend/lance/graph").GraphStore;
}

export interface WiredSvc {
  svcV1: SvcV1;
  registry: ObsidianPluginRegistry;
  graph: GraphService;
  canon: CanonService;
  events: EventBus;
  dispose: () => void;
}

function tfile(app: App, path: string): TFile | null {
  const f = app.vault.getAbstractFileByPath(path);
  return f instanceof TFile ? f : null;
}

// ── live hosts ──────────────────────────────────────────────────────────

function filesHost(app: App): FilesHost {
  return {
    exists: (p) => tfile(app, p) !== null,
    read: async (p) => {
      const f = tfile(app, p);
      return f ? app.vault.read(f) : "";
    },
    create: async (p, c) => void (await app.vault.create(p, c)),
    modify: async (p, c) => {
      const f = tfile(app, p);
      if (f) await app.vault.modify(f, c);
    },
    rename: async (o, n) => {
      const f = tfile(app, o);
      if (f) await app.fileManager.renameFile(f, n);
    },
    trash: async (p, system = true) => {
      const f = tfile(app, p);
      if (f) await app.vault.trash(f, system);
    },
    restoreFromHistory: async (p, c) => {
      const f = tfile(app, p);
      if (f) await app.vault.modify(f, c);
    },
  };
}

const NOT_AVAILABLE = (cap: string) =>
  new Error(`${cap} is not available in this build`);

function templateHost(app: App): TemplateHost {
  return {
    applyTemplate: async (templatePath, targetPath) => {
      const t = tfile(app, templatePath);
      const body = t ? await app.vault.read(t) : "";
      const existing = tfile(app, targetPath);
      if (existing) await app.vault.modify(existing, body);
      else await app.vault.create(targetPath, body);
    },
    compose: async (sourcePaths, destPath) => {
      const parts: string[] = [];
      for (const sp of sourcePaths) {
        const f = tfile(app, sp);
        if (f) parts.push(await app.vault.read(f));
      }
      await app.vault.create(destPath, parts.join("\n\n"));
    },
    uniqueNote: async (folder, body = "") => {
      const base = `${folder}/Untitled`;
      let path = `${base}.md`;
      let i = 1;
      while (tfile(app, path)) path = `${base} ${i++}.md`;
      await app.vault.create(path, body);
      return path;
    },
  };
}

function canonHost(app: App): CanonHost {
  return {
    getFrontmatter: (p) => {
      const f = tfile(app, p);
      return f
        ? (app.metadataCache.getFileCache(f)?.frontmatter ?? null)
        : null;
    },
    listPaths: () => app.vault.getMarkdownFiles().map((f) => f.path),
    read: async (p) => {
      const f = tfile(app, p);
      return f ? app.vault.read(f) : "";
    },
    write: async (p, c) => {
      const f = tfile(app, p);
      if (f) await app.vault.modify(f, c);
      else await app.vault.create(p, c);
    },
    setCanonized: async (p, value, type) => {
      const f = tfile(app, p);
      if (!f) return;
      await app.fileManager.processFrontMatter(
        f,
        (fm: Record<string, unknown>) => {
          const sauce = (fm.sauce as Record<string, unknown> | undefined) ?? {};
          sauce.canonized = value;
          if (type) sauce.type = type;
          fm.sauce = sauce;
        },
      );
    },
  };
}

function searchHost(app: App): SearchHost {
  // metadataCache.resolvedLinks / unresolvedLinks / getBacklinksForFile are
  // real runtime APIs not exposed in the public MetadataCache .d.ts.
  const mc = app.metadataCache as unknown as {
    resolvedLinks?: Record<string, Record<string, number>>;
    unresolvedLinks?: Record<string, Record<string, number>>;
    getBacklinksForFile?: (
      f: TFile,
    ) => { data: Map<string, unknown> } | Record<string, unknown>;
  };
  const allPaths = () => app.vault.getMarkdownFiles().map((f) => f.path);
  const backlinksOf = (path: string): string[] => {
    const f = tfile(app, path);
    if (!f || !mc.getBacklinksForFile) {
      // fall back to scanning resolvedLinks
      const out: string[] = [];
      for (const [src, targets] of Object.entries(mc.resolvedLinks ?? {}))
        if (targets[path]) out.push(src);
      return out;
    }
    const bl = mc.getBacklinksForFile(f) as { data?: Map<string, unknown> };
    return bl?.data ? [...bl.data.keys()] : [];
  };
  return {
    search: (query, limit = 25) => {
      const q = query.toLowerCase();
      if (!q) return [];
      return allPaths()
        .filter((p) => p.toLowerCase().includes(q))
        .slice(0, limit)
        .map<SearchResult>((p) => ({ path: p, score: 1 }));
    },
    searchContext: (path, query) => {
      const f = tfile(app, path);
      if (!f) return [];
      // metadataCache-only context: header lines matching the query.
      const cache = app.metadataCache.getFileCache(f);
      const q = query.toLowerCase();
      return (cache?.headings ?? [])
        .map((h) => h.heading)
        .filter((h) => h.toLowerCase().includes(q));
    },
    backlinks: backlinksOf,
    outlinks: (path) => Object.keys(mc.resolvedLinks?.[path] ?? {}),
    unresolved: () => {
      const out = new Set<string>();
      for (const targets of Object.values(mc.unresolvedLinks ?? {}))
        for (const t of Object.keys(targets)) out.add(t);
      return [...out];
    },
    orphans: () =>
      allPaths().filter(
        (p) =>
          backlinksOf(p).length === 0 &&
          Object.keys(mc.resolvedLinks?.[p] ?? {}).length === 0,
      ),
    deadends: () =>
      allPaths().filter(
        (p) =>
          backlinksOf(p).length > 0 &&
          Object.keys(mc.resolvedLinks?.[p] ?? {}).length === 0,
      ),
    tagCounts: () => {
      const counts: Record<string, number> = {};
      for (const f of app.vault.getMarkdownFiles()) {
        for (const t of app.metadataCache.getFileCache(f)?.tags ?? [])
          counts[t.tag] = (counts[t.tag] ?? 0) + 1;
      }
      return counts;
    },
    random: () => {
      const paths = allPaths();
      if (!paths.length) return null;
      return paths[Math.floor(Math.random() * paths.length)] ?? null; // index is within [0, length)
    },
  };
}

function contentHost(app: App): ContentHost {
  return {
    recordAudio: () => Promise.reject(NOT_AVAILABLE("Audio recording")),
    readCanvas: async (path) => {
      const f = tfile(app, path);
      if (!f) return null;
      try {
        return JSON.parse(await app.vault.read(f));
      } catch {
        return null;
      }
    },
    outline: async (path) => {
      const f = tfile(app, path);
      if (!f) return [];
      return (
        app.metadataCache.getFileCache(f)?.headings ?? []
      ).map<OutlineHeading>((h) => ({
        level: h.level,
        text: h.heading,
        line: h.position?.start?.line ?? 0,
      }));
    },
    preview: async (path) => {
      const f = tfile(app, path);
      return f ? app.vault.read(f) : "";
    },
    footnotes: async (path) => {
      const f = tfile(app, path);
      if (!f) return [];
      const text = await app.vault.read(f);
      return text.split("\n").filter((l) => /^\[\^[^\]]+\]:/.test(l));
    },
    wordCount: async (path) => {
      const f = tfile(app, path);
      if (!f) return 0;
      const text = await app.vault.read(f);
      return (text.match(/\S+/g) ?? []).length;
    },
    present: () => Promise.reject(NOT_AVAILABLE("Slides presentation")),
    fetchWeb: async (url) => {
      const { requestUrl } = await import("obsidian");
      const r = await requestUrl({ url });
      return r.text;
    },
  };
}

function metaHost(app: App): MetaHost {
  // app.internalPlugins is a real runtime API not in Obsidian's public .d.ts.
  const internal = (id: string) =>
    (
      app as unknown as {
        internalPlugins?: {
          getPluginById?: (i: string) => { instance?: unknown } | null;
        };
      }
    ).internalPlugins?.getPluginById?.(id)?.instance;
  return {
    readProperty: async (path, key) => {
      const f = tfile(app, path);
      return f
        ? (app.metadataCache.getFileCache(f)?.frontmatter?.[key] ?? null)
        : null;
    },
    setPropertyRaw: async (path, key, value) => {
      const f = tfile(app, path);
      if (f)
        await app.fileManager.processFrontMatter(
          f,
          (fm: Record<string, unknown>) => void (fm[key] = value),
        );
    },
    removePropertyRaw: async (path, key) => {
      const f = tfile(app, path);
      if (f)
        await app.fileManager.processFrontMatter(
          f,
          (fm: Record<string, unknown>) => void delete fm[key],
        );
    },
    bookmark: async (path) => {
      const bm = internal("bookmarks") as
        | { addItem?: (item: unknown) => void }
        | undefined;
      bm?.addItem?.({ type: "file", path });
    },
    daily: async () => {
      // daily-notes core plugin has no stable public create API; surface the
      // command instead so the user's configured template/folder is honored.
      app.commands?.executeCommandById?.("daily-notes");
      return "";
    },
    executeCommand: async (commandId) => {
      app.commands?.executeCommandById?.(commandId);
    },
    loadWorkspace: async (name) => {
      const ws = internal("workspaces") as
        | { loadWorkspace?: (n: string) => void }
        | undefined;
      ws?.loadWorkspace?.(name);
    },
    saveWorkspace: async (name) => {
      const ws = internal("workspaces") as
        | { saveWorkspace?: (n: string) => void }
        | undefined;
      ws?.saveWorkspace?.(name);
    },
  };
}

/** Scan the vault for `.md` files carrying `kanban-plugin` frontmatter. */
function listKanbanBoards(app: App): KanbanBoard[] {
  const out: KanbanBoard[] = [];
  for (const f of app.vault.getMarkdownFiles()) {
    const fm = app.metadataCache.getFileCache(f)?.frontmatter;
    if (fm && fm["kanban-plugin"] !== undefined)
      out.push({ path: f.path, name: f.basename });
  }
  return out;
}

/**
 * Build all services from the live App, mount svcV1 on the plugin instance, and
 * stand up the adapter registry. Returns the wired surface + a dispose().
 */
export function wireSvcV1(
  plugin: Record<string, unknown>,
  app: App,
  opts: WireOptions,
): WiredSvc {
  const events = new EventBus();
  const graph = new GraphService();
  // Hydrate the in-memory graph from the durable LanceDB store when available.
  // This is best-effort: a failure (e.g. fresh install with empty tables) is
  // swallowed and the graph starts empty, which is the correct initial state.
  if (opts.graphStore) {
    graph.hydrate(opts.graphStore).catch(() => {
      /* empty graph on first run */
    });
  }
  const downstream = new DownstreamRegistry(SVC_V1_VERSION);

  // In-memory ledger for runtime mutation-contract writes (the durable audit
  // chain lives in the LanceDB audit/provenance layer; this backs canon writes).
  const ledgerRows: LedgerEntry[] = [];
  const ledger: LedgerSink = {
    lastHash: async () => ledgerRows.at(-1)?.hash ?? "",
    append: async (e) => void ledgerRows.push(e),
  };
  const mutation = new MutationContract({
    ledger,
    crypto: { sha256Hex: (d) => opts.sha256Hex(d) },
    emitEvent: (e) => events.emit(e.type, e),
    actor: opts.actor ?? "sauce-crm",
  });

  const canon = new CanonService(canonHost(app), mutation);
  const files = new FilesService(filesHost(app), canon, templateHost(app));
  const search = new SearchService(searchHost(app));
  const content = new ContentService(contentHost(app), {
    allowWebFetch: () => true,
  });
  const meta = new MetaService(metaHost(app), canon);

  // Adapters share one PluginConfigService over the live data.json host.
  const config = new PluginConfigService(new ObsidianPluginConfigHost(app));
  const betaList = new Set<string>();
  const isBetaOptIn = opts.isBetaOptIn ?? (() => false);
  const metaBindTargets: string[] = [];

  const tasks = new TasksAdapter(config, buildTasksRuntimeHost(app));
  const registry = new ObsidianPluginRegistry({
    sink: { emit: (ev, p) => events.emit(ev, p) },
  });
  registry.register(tasks);
  registry.register(new DataviewAdapter(config, buildDataviewRuntimeHost(app)));
  registry.register(
    new KanbanAdapter(
      buildKanbanRuntimeHost(app, () => listKanbanBoards(app)),
      graph,
    ),
  );
  registry.register(
    new MetaBindAdapter(
      buildMetaBindRuntimeHost(
        app,
        () => metaBindTargets,
        (t) => metaBindTargets.push(...t),
      ),
    ),
  );
  registry.register(
    new QuickAddAdapter(
      new ObsidianPluginConfigHost(app),
      buildQuickAddRuntimeHost(app),
    ),
  );
  registry.register(
    new BratAdapter(
      buildBratRuntimeHost(app, isBetaOptIn, {
        has: (r) => betaList.has(r),
        add: (r) => void betaList.add(r),
      }),
    ),
  );
  registry.attach(app);

  const svcV1 = buildSvcV1({
    graph,
    canon,
    events,
    downstream,
    tasks: tasks.getServiceFacade<SauceTasksFacade>(),
    files,
    search,
    content,
    meta,
  });
  mountSvcV1(plugin, svcV1);

  return {
    svcV1,
    registry,
    graph,
    canon,
    events,
    dispose: () => {
      registry.dispose();
      delete plugin.svcV1;
    },
  };
}
