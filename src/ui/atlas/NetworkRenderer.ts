// Network renderer: a force-directed graph of ALL entities (geocoded or not),
// drawn on a single 2D canvas. The force simulation is TIME-BOXED — it never
// runs as an open-ended animation loop (a physical-limit rule): it ticks under
// alpha decay for a bounded number of frames, then freezes. Interaction (hover/
// focus/filter) re-draws from the frozen layout; it never re-runs the sim.
import type { Simulation } from "d3-force";
import type { AtlasSnapshot, AtlasFilterState } from "./AtlasTypes";
import type { GraphNode, GraphEdge } from "../../services/GraphAtlasService";
import { nodeVisible, edgeVisible, egoNetwork } from "./AtlasFilters";

export type D3ForceModule = typeof import("d3-force");

interface LinkDatum {
  source: string;
  target: string;
}

export interface NetworkRendererOpts {
  onSelect: (id: string) => void;
  maxNodes: number;
  /** Hard cap on simulation frames so the main thread is never pinned. */
  maxTicks?: number;
}

interface SimNode extends GraphNode {
  index?: number;
}

export class NetworkRenderer {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private sim: Simulation<SimNode, LinkDatum> | null = null;
  private raf = 0;
  private ticks = 0;
  private nodes: SimNode[] = [];
  private edges: GraphEdge[] = [];
  private focusId: string | null = null;
  private disposed = false;

  constructor(
    private readonly d3: D3ForceModule,
    private readonly container: HTMLElement,
    private readonly opts: NetworkRendererOpts,
  ) {}

  mount(): void {
    if (this.canvas) return;
    const canvas = this.container.createEl("canvas", { cls: "sauce-atlas-network" });
    canvas.width = Math.max(640, this.container.clientWidth || 640);
    canvas.height = Math.max(480, this.container.clientHeight || 480);
    canvas.onclick = (ev) => this.handleClick(ev);
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
  }

  render(snapshot: AtlasSnapshot, filter: AtlasFilterState, focusId: string | null): void {
    if (!this.canvas) return;
    this.focusId = focusId;
    const visibleNode = (id: string): boolean => {
      const n = snapshot.nodeById.get(id);
      return !!n && nodeVisible(n, filter);
    };
    // Cap to the most-connected nodes so the sim stays cheap and the canvas
    // legible; surface nothing silently beyond the cap (degree-ranked).
    const all = snapshot.nodes.filter((n) => visibleNode(n.id));
    all.sort((a, b) => b.degree - a.degree);
    this.nodes = all.slice(0, this.opts.maxNodes);
    const kept = new Set(this.nodes.map((n) => n.id));
    this.edges = snapshot.edges.filter(
      (e) => kept.has(e.source) && kept.has(e.target) && edgeVisible(e, filter, (id) => kept.has(id)),
    );
    this.runSim();
  }

  /** Re-style (focus/hover) without re-running the sim. */
  refocus(focusId: string | null): void {
    this.focusId = focusId;
    this.draw();
  }

  private runSim(): void {
    if (this.disposed || !this.canvas) return;
    cancelAnimationFrame(this.raf);
    this.sim?.stop();
    const w = this.canvas.width;
    const h = this.canvas.height;
    const links: LinkDatum[] = this.edges.map((e) => ({
      source: e.source,
      target: e.target,
    }));
    this.sim = this.d3
      .forceSimulation<SimNode, LinkDatum>(this.nodes)
      .force("charge", this.d3.forceManyBody<SimNode>().strength(-120))
      .force(
        "link",
        this.d3
          .forceLink<SimNode, LinkDatum>(links)
          .id((d) => d.id)
          .distance(60),
      )
      .force("center", this.d3.forceCenter<SimNode>(w / 2, h / 2))
      .force("collide", this.d3.forceCollide<SimNode>(14))
      .stop();
    this.ticks = 0;
    const budget = this.opts.maxTicks ?? 300;
    const step = (): void => {
      if (this.disposed || !this.sim) return;
      this.sim.tick();
      this.draw();
      this.ticks++;
      if (this.ticks < budget && this.sim.alpha() > this.sim.alphaMin()) {
        this.raf = requestAnimationFrame(step);
      } else {
        this.sim.stop(); // freeze — no open-ended loop
      }
    };
    step();
  }

  private draw(): void {
    const ctx = this.ctx;
    const canvas = this.canvas;
    if (!ctx || !canvas) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const ego = this.focusId ? egoNetwork(this.focusId, this.edges) : null;
    const pos = new Map(this.nodes.map((n) => [n.id, n]));
    ctx.lineCap = "round";
    for (const e of this.edges) {
      const s = pos.get(e.source);
      const t = pos.get(e.target);
      if (!s || !t) continue;
      const lit = !ego || (ego.has(e.source) && ego.has(e.target));
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(t.x, t.y);
      ctx.strokeStyle = e.color;
      ctx.globalAlpha = lit ? 0.5 : 0.06;
      ctx.lineWidth = Math.min(4, 0.6 + e.weight * 0.5);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    for (const n of this.nodes) {
      const lit = !ego || ego.has(n.id);
      ctx.beginPath();
      ctx.arc(n.x, n.y, Math.min(12, 4 + n.score), 0, Math.PI * 2);
      ctx.fillStyle = n.color;
      ctx.globalAlpha = lit ? 1 : 0.25;
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = "#0b1220";
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  private handleClick(ev: MouseEvent): void {
    const canvas = this.canvas;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const y = ev.clientY - rect.top;
    let best: { id: string; d: number } | null = null;
    for (const n of this.nodes) {
      const d = Math.hypot(n.x - x, n.y - y);
      if (d < 14 && (!best || d < best.d)) best = { id: n.id, d };
    }
    if (best) this.opts.onSelect(best.id);
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.sim?.stop();
    this.sim = null;
    this.canvas?.remove();
    this.canvas = null;
    this.ctx = null;
  }
}
