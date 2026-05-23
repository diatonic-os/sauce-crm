// CON-OBS-INTEG-001 · T-G-01 · SVC-api / DEC-007 / DEC-012 — the public svcV1.
//
// Mounted at app.plugins.plugins['sauce-crm'].svcV1, semver-locked at 0.3.0.
// It composes the services built across SH-B..SH-E into a single stable facade
// downstream plugins inherit. G-010: every member is a read or contract-write
// surface — NO facade returns a raw Obsidian App/Vault/plugin handle.

import type { GraphService, GraphNode } from "./GraphService";
import type { CanonService } from "./CanonService";
import type { EventBus } from "./EventBus";
import type { DownstreamRegistry } from "./DownstreamRegistry";
import type { FilesService } from "./core/FilesService";
import type { SearchService } from "./core/SearchService";
import type { ContentService } from "./core/ContentService";
import type { MetaService } from "./core/MetaService";
import type { SauceTasksFacade } from "../integrations/obsidian/TasksAdapter";

export const SVC_V1_VERSION = "0.3.0";

/** Read facade over entity nodes (G-010 — returns plain data, never a handle). */
export interface EntitiesFacade {
  get(id: string): GraphNode | null;
  byType(type: string): GraphNode[];
}
export interface TouchesFacade {
  forEntity(entityId: string): GraphNode[];
}
export interface PipelinesFacade {
  list(): GraphNode[];
}

export interface SvcV1Deps {
  graph: GraphService;
  canon: CanonService;
  events: EventBus;
  downstream: DownstreamRegistry;
  tasks: SauceTasksFacade;
  files: FilesService;
  search: SearchService;
  content: ContentService;
  meta: MetaService;
}

/** The frozen public API surface. */
export interface SvcV1 {
  readonly version: string;
  readonly entities: EntitiesFacade;
  readonly touches: TouchesFacade;
  readonly pipelines: PipelinesFacade;
  readonly graph: GraphService;
  readonly canon: CanonService;
  readonly events: EventBus;
  readonly tasks: SauceTasksFacade;
  readonly files: FilesService;
  readonly search: SearchService;
  readonly content: ContentService;
  readonly meta: MetaService;
  registerEntity: DownstreamRegistry["registerEntity"];
  registerTouchSource: DownstreamRegistry["registerTouchSource"];
  registerPipeline: DownstreamRegistry["registerPipeline"];
  registerView: DownstreamRegistry["registerView"];
  negotiateVersion: DownstreamRegistry["negotiateVersion"];
}

/** Compose the svcV1 facade from the built services. */
export function buildSvcV1(deps: SvcV1Deps): SvcV1 {
  const { graph, downstream } = deps;
  const entities: EntitiesFacade = {
    get: (id) => graph.node(id),
    byType: (type) => graph.query((n) => n.type === type),
  };
  const touches: TouchesFacade = {
    // touches are graph edges of kind 'touch' from an entity → the touch nodes.
    forEntity: (entityId) =>
      graph
        .neighbors(entityId)
        .filter((e) => e.kind === "touch")
        .map((e) => graph.node(e.dst))
        .filter((n): n is GraphNode => !!n),
  };
  const pipelines: PipelinesFacade = {
    list: () => graph.query((n) => n.type === "pipeline"),
  };

  // Typed binding first so the register* arrows infer their param types from SvcV1.
  const api: SvcV1 = {
    version: SVC_V1_VERSION,
    entities,
    touches,
    pipelines,
    graph: deps.graph,
    canon: deps.canon,
    events: deps.events,
    tasks: deps.tasks,
    files: deps.files,
    search: deps.search,
    content: deps.content,
    meta: deps.meta,
    registerEntity: (reg) => downstream.registerEntity(reg),
    registerTouchSource: (reg) => downstream.registerTouchSource(reg),
    registerPipeline: (reg) => downstream.registerPipeline(reg),
    registerView: (reg) => downstream.registerView(reg),
    negotiateVersion: (req) => downstream.negotiateVersion(req),
  };
  return Object.freeze(api);
}

/** Mount svcV1 onto the live plugin instance: app.plugins.plugins['sauce-crm'].svcV1. */
export function mountSvcV1(
  pluginInstance: Record<string, unknown>,
  svc: SvcV1,
): void {
  pluginInstance.svcV1 = svc;
}
