import { App, TFile } from "obsidian";
import { Entity } from "../domain/Entity";
import { EntityService } from "./EntityService";
import { GeoIndex } from "../geo/GeoIndex";
import { daysBetween } from "../util/DateUtil";
import { parseWikilink, basenameFromLink } from "../util/Wikilink";

export type GraphKind =
  | "person"
  | "org"
  | "touch"
  | "note"
  | "idea"
  | "observation"
  | "task"
  | "event"
  | "ledger"
  | "pipeline"
  | "addendum"
  | "vault"
  | "copilot"
  | "other";

export interface GraphNode {
  id: string;
  path: string;
  label: string;
  kind: GraphKind;
  layer: number;
  color: string;
  icon: string;
  score: number;
  degree: number;
  recency: number;
  geo: number;
  interactions: number;
  radius: number;
  mass: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  fx?: number | null;
  fy?: number | null;
  lat?: number;
  lon?: number;
  file: TFile;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  relation: string;
  directed: boolean;
  weight: number;
  length: number;
  color: string;
}

export interface GraphSnapshot {
  nodes: GraphNode[];
  edges: GraphEdge[];
  nodeById: Map<string, GraphNode>;
}

interface StyleDef {
  color: string;
  icon: string;
  layer: number;
}

const STYLE_BY_KIND: Record<GraphKind, StyleDef> = {
  person: { color: "#4cc9f0", icon: "sauce-person", layer: 1 },
  org: { color: "#f59e0b", icon: "sauce-org", layer: 1 },
  touch: { color: "#22c55e", icon: "sauce-touch", layer: 2 },
  note: { color: "#60a5fa", icon: "sauce-note", layer: 3 },
  idea: { color: "#f472b6", icon: "sauce-idea", layer: 3 },
  observation: { color: "#14b8a6", icon: "sauce-observation", layer: 3 },
  task: { color: "#fb923c", icon: "sauce-task", layer: 2 },
  event: { color: "#a3e635", icon: "sauce-event", layer: 2 },
  ledger: { color: "#ef4444", icon: "sauce-ledger", layer: 2 },
  pipeline: { color: "#eab308", icon: "sauce-pipeline", layer: 2 },
  addendum: { color: "#94a3b8", icon: "sauce-addendum", layer: 3 },
  vault: { color: "#c084fc", icon: "sauce-parent-vault", layer: 0 },
  copilot: { color: "#38bdf8", icon: "sauce-copilot", layer: 0 },
  other: { color: "#94a3b8", icon: "circle-dot", layer: 3 },
};

const RELATION_KEYS = new Set([
  "knows",
  "worked_with",
  "intro_via",
  "family_of",
  "parent",
  "contact",
  "org",
  "related_contacts",
  "blocked_by",
  "addends",
]);

const TYPE_TO_KIND: Record<string, GraphKind> = {
  "warm-contact": "person",
  org: "org",
  subsidiary: "org",
  touch: "touch",
  "knowledge-note": "note",
  idea: "idea",
  observation: "observation",
  task: "task",
  event: "event",
  "ledger-entry": "ledger",
  "pipeline-deal": "pipeline",
  addendum: "addendum",
  "parent-vault": "vault",
  "sub-vault": "vault",
  "user-agent": "copilot",
};

const KIND_WEIGHTS: Record<GraphKind, number> = {
  person: 1.4,
  org: 1.3,
  touch: 1.1,
  note: 0.9,
  idea: 1.0,
  observation: 1.0,
  task: 1.0,
  event: 1.0,
  ledger: 1.1,
  pipeline: 1.1,
  addendum: 0.8,
  vault: 1.6,
  copilot: 1.5,
  other: 0.75,
};

const EDGE_COLORS: Record<string, string> = {
  knows: "#60a5fa",
  worked_with: "#22d3ee",
  intro_via: "#a78bfa",
  family_of: "#f472b6",
  parent: "#eab308",
  contact: "#22c55e",
  org: "#f59e0b",
  related_contacts: "#38bdf8",
  blocked_by: "#ef4444",
  addends: "#94a3b8",
  geo: "#34d399",
  default: "#94a3b8",
};
/** Look up an edge colour, falling back to the hardcoded default. */
function edgeColor(rel: string): string {
  return EDGE_COLORS[rel] ?? "#94a3b8";
}

export class GraphAtlasService {
  constructor(
    public app: App,
    public entities: EntityService,
  ) {}

  snapshot(
    opts: {
      now?: number;
      width?: number;
      height?: number;
      focusId?: string | null;
    } = {},
  ): GraphSnapshot {
    const now = opts.now ?? Date.now();
    const entities = this.collectEntities();
    const nodeById = new Map<string, GraphNode>();
    const nodes = entities.map((entity) => this.makeNode(entity, now));
    for (const n of nodes) nodeById.set(n.id, n);

    const edges = this.collectEdges(nodes, nodeById);
    this.scoreNodes(nodes, edges, now);
    this.layout(
      nodes,
      edges,
      opts.width ?? 1200,
      opts.height ?? 800,
      opts.focusId ?? null,
    );
    return { nodes, edges, nodeById };
  }

  private collectEntities(): Entity[] {
    const out: Entity[] = [];
    for (const file of this.app.vault.getMarkdownFiles()) {
      const entity = this.entities.loadEntity(file);
      if (entity) out.push(entity);
    }
    return out;
  }

  private makeNode(entity: Entity, now: number): GraphNode {
    const kind = this.kindFor(entity);
    const style = STYLE_BY_KIND[kind];
    const label = this.labelFor(entity);
    const fm = entity.frontmatter;
    const lat =
      typeof fm.lat === "number" && Number.isFinite(fm.lat)
        ? fm.lat
        : undefined;
    const lon =
      typeof fm.lon === "number" && Number.isFinite(fm.lon)
        ? fm.lon
        : undefined;
    const recent = this.recencyScore(fm, now, entity.file);
    const geo = lat != null && lon != null ? 1 : 0;
    const degree = 0;
    const score = Math.max(0.1, KIND_WEIGHTS[kind] + recent + geo * 0.5);
    const radius = clamp(10 + score * 4.5, 11, 30);
    return {
      id: entity.file.path,
      path: entity.file.path,
      label,
      kind,
      layer: style.layer,
      color: style.color,
      icon: style.icon,
      score,
      degree,
      recency: recent,
      geo,
      interactions: 0,
      radius,
      mass: Math.max(0.9, score),
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      ...(lat !== undefined && { lat }),
      ...(lon !== undefined && { lon }),
      file: entity.file,
    };
  }

  private collectEdges(
    nodes: GraphNode[],
    nodeById: Map<string, GraphNode>,
  ): GraphEdge[] {
    const edges: GraphEdge[] = [];
    const seen = new Set<string>();
    const byName = new Map<string, GraphNode>();
    for (const node of nodes) {
      byName.set(node.label.toLowerCase(), node);
      byName.set(node.file.basename.toLowerCase(), node);
      byName.set(node.path.toLowerCase(), node);
    }

    for (const node of nodes) {
      const fm =
        this.app.metadataCache.getFileCache(node.file)?.frontmatter ?? {};
      const rels = this.extractRelations(node, fm as Record<string, unknown>);
      for (const rel of rels) {
        const target = this.resolveTarget(rel.target, nodeById, byName);
        if (!target) continue;
        const id = `${node.id}::${rel.relation}::${target.id}`;
        const directed = !rel.symmetric;
        if (seen.has(id)) continue;
        seen.add(id);
        const base = relationWeight(
          rel.relation,
          rel.symmetric,
          node.kind,
          target.kind,
        );
        const distance = rel.distance ?? 1;
        const weight = base * distance;
        edges.push({
          id,
          source: node.id,
          target: target.id,
          relation: rel.relation,
          directed,
          weight,
          length: desiredLength(weight, node, target),
          color: edgeColor(rel.relation),
        });
      }
    }

    const geoNodes = nodes.filter((n) => n.lat != null && n.lon != null);
    if (geoNodes.length > 1) {
      const geoIndex = new GeoIndex(5);
      for (const n of geoNodes)
        geoIndex.add({ id: n.id, lat: n.lat!, lon: n.lon! });
      for (const n of geoNodes) {
        const nearest = geoIndex.nearest(n.lat!, n.lon!, 4, 80_000);
        for (const hit of nearest) {
          if (hit.point.id === n.id) continue;
          const id = `${n.id}::geo::${hit.point.id}`;
          if (seen.has(id)) continue;
          seen.add(id);
          const weight = clamp(1.6 - hit.distanceM / 80_000, 0.35, 1.6);
          edges.push({
            id,
            source: n.id,
            target: hit.point.id,
            relation: "geo",
            directed: false,
            weight,
            length: clamp(170 - weight * 70, 80, 220),
            color: edgeColor("geo"),
          });
        }
      }
    }

    return edges;
  }

  private extractRelations(
    node: GraphNode,
    fm: Record<string, unknown>,
  ): Array<{
    relation: string;
    target: string;
    symmetric: boolean;
    distance?: number;
  }> {
    const out: Array<{
      relation: string;
      target: string;
      symmetric: boolean;
      distance?: number;
    }> = [];
    const directTargets = new Set<string>();

    for (const [key, value] of Object.entries(fm)) {
      const arr = this.asStringList(value);
      if (arr.length === 0) continue;
      if (!RELATION_KEYS.has(key)) {
        for (const raw of arr) {
          const target = this.extractLinkishTargetString(raw);
          if (target) directTargets.add(target);
        }
        continue;
      }
      for (const raw of arr) {
        const target = this.extractTargetString(raw);
        if (!target) continue;
        out.push({
          relation: key,
          target,
          symmetric:
            key === "knows" ||
            key === "worked_with" ||
            key === "related_contacts",
        });
      }
    }

    if (node.kind === "touch" && typeof fm.contact === "string") {
      const target = this.extractTargetString(fm.contact);
      if (target) out.push({ relation: "contact", target, symmetric: false });
    }
    if (node.kind === "task") {
      for (const key of ["contact", "org", "blocked_by"]) {
        const raw = fm[key];
        for (const item of this.asStringList(raw)) {
          const target = this.extractTargetString(item);
          if (target)
            out.push({
              relation: key,
              target,
              symmetric: key === "blocked_by",
            });
        }
      }
    }
    if (node.kind === "idea") {
      for (const item of this.asStringList(fm.related_contacts)) {
        const target = this.extractTargetString(item);
        if (target)
          out.push({ relation: "related_contacts", target, symmetric: true });
      }
    }
    if (node.kind === "ledger") {
      const target = this.extractTargetString(String(fm.contact ?? ""));
      if (target) out.push({ relation: "contact", target, symmetric: false });
    }
    if (node.kind === "event") {
      const contact = this.extractTargetString(String(fm.contact ?? ""));
      if (contact)
        out.push({ relation: "contact", target: contact, symmetric: false });
      const org = this.extractTargetString(String(fm.org ?? ""));
      if (org) out.push({ relation: "org", target: org, symmetric: false });
    }
    if (node.kind === "addendum") {
      const target = this.extractTargetString(String(fm.addends ?? ""));
      if (target) out.push({ relation: "addends", target, symmetric: false });
    }

    for (const target of directTargets) {
      out.push({ relation: "link", target, symmetric: false });
    }
    return out;
  }

  private extractTargetString(raw: string): string | null {
    const link = parseWikilink(raw) ?? raw.trim();
    if (!link) return null;
    if (link.includes("://")) return null;
    return basenameFromLink(link);
  }

  private extractLinkishTargetString(raw: string): string | null {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    if (trimmed.startsWith("[[") && trimmed.endsWith("]]"))
      return this.extractTargetString(trimmed);
    if (
      trimmed.includes("/") ||
      trimmed.endsWith(".md") ||
      trimmed.includes("|")
    )
      return this.extractTargetString(trimmed);
    return null;
  }

  private resolveTarget(
    target: string,
    nodeById: Map<string, GraphNode>,
    byName: Map<string, GraphNode>,
  ): GraphNode | null {
    const exact =
      nodeById.get(target) ??
      nodeById.get(target.endsWith(".md") ? target : `${target}.md`);
    if (exact) return exact;
    return (
      byName.get(target.toLowerCase()) ??
      byName.get(target.replace(/\.md$/i, "").toLowerCase()) ??
      null
    );
  }

  private scoreNodes(
    nodes: GraphNode[],
    edges: GraphEdge[],
    now: number,
  ): void {
    const degreeById = new Map<string, number>();
    const interactionById = new Map<string, number>();
    const edgeAdj = new Map<string, GraphEdge[]>();
    for (const edge of edges) {
      degreeById.set(edge.source, (degreeById.get(edge.source) ?? 0) + 1);
      degreeById.set(edge.target, (degreeById.get(edge.target) ?? 0) + 1);
      const a = edgeAdj.get(edge.source) ?? [];
      a.push(edge);
      edgeAdj.set(edge.source, a);
      const b = edgeAdj.get(edge.target) ?? [];
      b.push(edge);
      edgeAdj.set(edge.target, b);
    }

    for (const node of nodes) {
      const fm =
        this.app.metadataCache.getFileCache(node.file)?.frontmatter ?? {};
      const degree = degreeById.get(node.id) ?? 0;
      const interactions = this.interactionScore(node.kind, fm);
      const recency = this.recencyScore(fm, now, node.file);
      const geo = node.geo;
      const tagCount = Array.isArray(fm.tags) ? fm.tags.length : 0;
      const relationBoost = Math.sqrt(degree + 1) * 1.2;
      const base = KIND_WEIGHTS[node.kind];
      const score =
        base +
        relationBoost +
        interactions * 0.35 +
        recency * 1.6 +
        geo * 0.7 +
        tagCount * 0.08;
      node.degree = degree;
      node.interactions = interactions;
      node.recency = recency;
      node.score = score;
      node.mass = Math.max(0.8, score);
      node.radius = clamp(10 + score * 3.3, 11, 32);
    }

    for (const edge of edges) {
      const source = nodeById(nodes, edge.source);
      const target = nodeById(nodes, edge.target);
      if (!source || !target) continue;
      const influence = (source.score + target.score) / 2;
      edge.weight = edge.weight * Math.max(0.8, Math.sqrt(influence) / 2);
      edge.length = clamp(edge.length - influence * 4, 55, 260);
    }
  }

  private interactionScore(
    kind: GraphKind,
    fm: Record<string, unknown>,
  ): number {
    if (kind === "touch") return 3;
    if (kind === "event") return 2.5;
    if (kind === "task")
      return String(fm.status ?? "todo") === "done" ? 0.5 : 2;
    if (kind === "idea")
      return String(fm.status ?? "open") === "shipped" ? 0.8 : 1.6;
    if (kind === "ledger")
      return Math.min(4, Math.log10(Math.abs(Number(fm.amount ?? 0)) + 10));
    if (kind === "note" || kind === "observation")
      return (Array.isArray(fm.tags) ? fm.tags.length : 0) * 0.4 + 1;
    if (kind === "person" || kind === "org")
      return 1.5 + (Array.isArray(fm.tags) ? fm.tags.length * 0.2 : 0);
    return 1;
  }

  private recencyScore(
    fm: Record<string, unknown>,
    now: number,
    file: TFile,
  ): number {
    const dates: string[] = [];
    for (const key of [
      "date",
      "due",
      "last_touch",
      "created",
      "updated",
      "modified",
    ]) {
      const value = fm[key];
      if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value))
        dates.push(value.slice(0, 10));
    }
    const latest = dates.sort().at(-1);
    if (!latest) return 0.15;
    const d = new Date(`${latest}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) return 0.15;
    const daysOld = Math.max(0, daysBetween(d, new Date(now)));
    return clamp(1.6 / (1 + daysOld / 21), 0.1, 1.6);
  }

  private layout(
    nodes: GraphNode[],
    edges: GraphEdge[],
    width: number,
    height: number,
    focusId: string | null,
  ): void {
    if (nodes.length === 0) return;
    const w = Math.max(640, width);
    const h = Math.max(420, height);
    const centerX = w / 2;
    const centerY = h / 2;
    const minDim = Math.min(w, h);
    const layerRadius = [0, 0.22, 0.35, 0.5, 0.62].map(
      (ratio) => ratio * minDim,
    );
    const focus = focusId
      ? (nodes.find((n) => n.id === focusId) ?? null)
      : null;
    const focusSet = focus
      ? new Set<string>([
          focus.id,
          ...edges
            .filter((e) => e.source === focus.id || e.target === focus.id)
            .flatMap((e) => [e.source, e.target]),
        ])
      : null;

    for (const node of nodes) {
      const seed = hash(node.id);
      const angle = ((seed % 3600) / 3600) * Math.PI * 2;
      // Clamp layer index to layerRadius bounds so the access is provably in-bounds.
      const layerIdx = Math.min(Math.max(node.layer, 0), layerRadius.length - 1);
      const radius = layerRadius[layerIdx] ?? 0; // in-bounds: clamped above
      node.x = centerX + Math.cos(angle) * (radius + (node.geo ? 22 : 0));
      node.y = centerY + Math.sin(angle) * (radius + (node.geo ? 22 : 0));
      node.vx = 0;
      node.vy = 0;
    }

    const geoNodes = nodes.filter((n) => n.lat != null && n.lon != null);
    const geoMinLat = geoNodes.length
      ? Math.min(...geoNodes.map((n) => n.lat!))
      : 0;
    const geoMaxLat = geoNodes.length
      ? Math.max(...geoNodes.map((n) => n.lat!))
      : 1;
    const geoMinLon = geoNodes.length
      ? Math.min(...geoNodes.map((n) => n.lon!))
      : 0;
    const geoMaxLon = geoNodes.length
      ? Math.max(...geoNodes.map((n) => n.lon!))
      : 1;

    const geoAnchor = (n: GraphNode): { x: number; y: number } | null => {
      if (n.lat == null || n.lon == null) return null;
      const gx =
        28 +
        ((n.lon - geoMinLon) / Math.max(0.001, geoMaxLon - geoMinLon)) *
          (w - 56);
      const gy =
        28 +
        (1 - (n.lat - geoMinLat) / Math.max(0.001, geoMaxLat - geoMinLat)) *
          (h - 56);
      return { x: gx, y: gy };
    };

    const iterations = Math.min(
      90,
      Math.max(30, Math.round(180 / Math.sqrt(nodes.length))),
    );
    const repulsion = 1400;
    const damping = 0.82;
    for (let step = 0; step < iterations; step++) {
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        if (a === undefined) continue; // in-bounds: for-loop over nodes.length
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j];
          if (b === undefined) continue; // in-bounds: for-loop over nodes.length
          let dx = b.x - a.x;
          let dy = b.y - a.y;
          let dist2 = dx * dx + dy * dy;
          if (dist2 < 0.5) dist2 = 0.5;
          const dist = Math.sqrt(dist2);
          const minDist = a.radius + b.radius + 10;
          if (dist < minDist) {
            const push = ((minDist - dist) / minDist) * 1.8;
            dx /= dist;
            dy /= dist;
            a.vx -= dx * push * (b.mass / (a.mass + b.mass));
            a.vy -= dy * push * (b.mass / (a.mass + b.mass));
            b.vx += dx * push * (a.mass / (a.mass + b.mass));
            b.vy += dy * push * (a.mass / (a.mass + b.mass));
          }
          const force = (repulsion * (a.mass * b.mass)) / dist2;
          const fx = (dx / dist) * force * 0.00008;
          const fy = (dy / dist) * force * 0.00008;
          a.vx -= fx;
          a.vy -= fy;
          b.vx += fx;
          b.vy += fy;
        }
      }

      for (const edge of edges) {
        const source = nodeById(nodes, edge.source);
        const target = nodeById(nodes, edge.target);
        if (!source || !target) continue;
        let dx = target.x - source.x;
        let dy = target.y - source.y;
        let dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 0.5) dist = 0.5;
        const desired = edge.length;
        const delta = dist - desired;
        const spring = (delta / desired) * edge.weight * 0.08;
        dx /= dist;
        dy /= dist;
        source.vx += dx * spring;
        source.vy += dy * spring;
        target.vx -= dx * spring;
        target.vy -= dy * spring;
      }

      for (const node of nodes) {
        const anchorLayerIdx = Math.min(Math.max(node.layer, 0), layerRadius.length - 1);
        const anchorRadius = layerRadius[anchorLayerIdx] ?? 0; // in-bounds: clamped above
        const angle =
          ((hash(`${node.kind}:${node.id}`) % 3600) / 3600) * Math.PI * 2;
        const ax = centerX + Math.cos(angle) * anchorRadius;
        const ay = centerY + Math.sin(angle) * anchorRadius;
        node.vx += (ax - node.x) * 0.004;
        node.vy += (ay - node.y) * 0.004;

        const g = geoAnchor(node);
        if (g) {
          const geoBlend =
            node.kind === "person" || node.kind === "org" ? 0.08 : 0.03;
          node.vx += (g.x - node.x) * geoBlend;
          node.vy += (g.y - node.y) * geoBlend;
        }

        if (focus && focusSet) {
          const focusBoost = focusSet.has(node.id) ? 0.012 : -0.004;
          node.vx += (centerX - node.x) * focusBoost;
          node.vy += (centerY - node.y) * focusBoost;
        } else {
          node.vx += (centerX - node.x) * 0.0015;
          node.vy += (centerY - node.y) * 0.0015;
        }

        node.vx *= damping;
        node.vy *= damping;
        node.x += node.vx;
        node.y += node.vy;
      }
    }

    for (const node of nodes) {
      node.x = clamp(node.x, node.radius + 6, w - node.radius - 6);
      node.y = clamp(node.y, node.radius + 6, h - node.radius - 6);
      if (focus && node.id === focus.id) {
        node.fx = node.x;
        node.fy = node.y;
      }
    }
  }

  private kindFor(entity: Entity): GraphKind {
    return TYPE_TO_KIND[entity.type] ?? this.fallbackKind(entity.file.path);
  }

  private fallbackKind(path: string): GraphKind {
    if (path.includes("vault")) return "vault";
    if (path.includes("copilot")) return "copilot";
    return "other";
  }

  private labelFor(entity: Entity): string {
    const fm = entity.frontmatter;
    for (const key of ["name", "title", "label"]) {
      if (typeof fm[key] === "string" && String(fm[key]).trim())
        return String(fm[key]);
    }
    return entity.file.basename;
  }

  private asStringList(value: unknown): string[] {
    if (value == null) return [];
    if (Array.isArray(value))
      return value.filter((v): v is string => typeof v === "string");
    return typeof value === "string" ? [value] : [];
  }
}

function relationWeight(
  relation: string,
  symmetric: boolean,
  sourceKind: GraphKind,
  targetKind: GraphKind,
): number {
  const base =
    {
      knows: 2.5,
      worked_with: 2.3,
      intro_via: 1.8,
      family_of: 1.7,
      parent: 3.0,
      contact: 1.9,
      org: 1.8,
      related_contacts: 1.6,
      blocked_by: 1.4,
      addends: 1.2,
      geo: 1.1,
      link: 1.0,
    }[relation] ?? 1;
  const kindBoost = (KIND_WEIGHTS[sourceKind] + KIND_WEIGHTS[targetKind]) / 2;
  return base * kindBoost * (symmetric ? 1.08 : 1);
}

function desiredLength(
  weight: number,
  source: GraphNode,
  target: GraphNode,
): number {
  const mass = (source.mass + target.mass) / 2;
  return clamp(250 - weight * 42 - mass * 5, 58, 260);
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function hash(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function nodeById(nodes: GraphNode[], id: string): GraphNode | null {
  return nodes.find((n) => n.id === id) ?? null;
}
