// In-memory Obsidian API stub for unit tests. Implements just enough of
// App / Vault / DataAdapter / TFile / TFolder for EntityService and the
// other services under test to round-trip frontmatter + body strings.

// eslint-disable-next-line @typescript-eslint/no-var-requires
const _yaml = require("js-yaml");
export function parseYaml(s: string): unknown {
  return _yaml.load(s);
}
export function stringifyYaml(o: unknown): string {
  return _yaml.dump(o);
}

export function arrayBufferToBase64(buf: ArrayBuffer): string {
  return Buffer.from(buf).toString("base64");
}
export function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const b = Buffer.from(b64, "base64");
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}

export function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/+|\/+$/g, "");
}

export class TAbstractFile {
  constructor(public path: string, public parent: TFolder | null) {}
  get name(): string {
    const ix = this.path.lastIndexOf("/");
    return ix < 0 ? this.path : this.path.slice(ix + 1);
  }
  get basename(): string {
    return this.name.replace(/\.md$/, "");
  }
}

export class TFile extends TAbstractFile {
  contents = "";
  extension: string;
  constructor(path: string, parent: TFolder | null = null) {
    super(path, parent);
    const m = path.match(/\.([^.]+)$/);
    this.extension = m ? m[1] : "";
  }
}

export class TFolder extends TAbstractFile {
  children: TAbstractFile[] = [];
}

export class Vault {
  private files = new Map<string, TFile>();
  private folders = new Map<string, TFolder>();
  adapter = {
    getBasePath: () => "/test/vault",
    exists: async (p: string) => this.files.has(p) || this.folders.has(p),
    read:   async (p: string) => this.files.get(p)?.contents ?? "",
    write:  async (p: string, c: string) => {
      const f = this.files.get(p);
      if (f) f.contents = c;
    },
  };
  constructor() {
    this.folders.set("", new TFolder("", null));
  }
  getAbstractFileByPath(path: string): TAbstractFile | null {
    const np = normalizePath(path);
    return this.files.get(np) ?? this.folders.get(np) ?? null;
  }
  async createFolder(path: string): Promise<TFolder> {
    const np = normalizePath(path);
    const existing = this.folders.get(np);
    if (existing) return existing;
    const f = new TFolder(np, null);
    this.folders.set(np, f);
    return f;
  }
  async create(path: string, contents: string): Promise<TFile> {
    const np = normalizePath(path);
    const file = new TFile(np, null);
    file.contents = contents;
    this.files.set(np, file);
    return file;
  }
  async modify(file: TFile, contents: string): Promise<void> {
    file.contents = contents;
  }
  async delete(file: TFile): Promise<void> {
    this.files.delete(file.path);
  }
  async cachedRead(file: TFile): Promise<string> {
    return file.contents;
  }
  async read(file: TFile): Promise<string> {
    return file.contents;
  }
  getMarkdownFiles(): TFile[] {
    return [...this.files.values()].filter((f) => f.extension === "md");
  }
}

export class MetadataCache {
  private fmStore = new Map<string, Record<string, unknown>>();
  setFrontmatter(path: string, fm: Record<string, unknown>): void {
    this.fmStore.set(normalizePath(path), fm);
  }
  getFileCache(file: TFile): { frontmatter?: Record<string, unknown> } | null {
    const fm = this.fmStore.get(file.path);
    return fm ? { frontmatter: fm } : null;
  }
  getFirstLinkpathDest(_link: string, _from: string): TFile | null {
    return null;
  }
}

export class App {
  vault = new Vault();
  metadataCache = new MetadataCache();
  workspace = {
    getActiveFile: () => null as TFile | null,
    getActiveViewOfType: () => null,
    getLeavesOfType: () => [] as unknown[],
    getLeaf: () => null,
    getRightLeaf: () => null,
    getLeftLeaf: () => null,
    revealLeaf: () => {},
  };
  // FileManager — only processFrontMatter is exercised by the services
  // under test. We round-trip a YAML-ish frontmatter block by parsing the
  // file body, calling the mutator, and re-serializing.
  fileManager = {
    processFrontMatter: async (file: TFile, mutator: (fm: Record<string, unknown>) => void) => {
      const text = file.contents;
      const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
      const fm: Record<string, unknown> = {};
      let body = text;
      if (m) {
        body = m[2];
        for (const line of m[1].split("\n")) {
          const kv = line.match(/^([\w-]+):\s*(.*)$/);
          if (!kv) continue;
          const raw = kv[2].trim();
          // Naive JSON-ish parse for arrays/numbers/booleans; fall back to string.
          let value: unknown = raw;
          if (raw.startsWith("[")) {
            try { value = JSON.parse(raw); } catch { /* keep string */ }
          } else if (raw === "true" || raw === "false") {
            value = raw === "true";
          } else if (!Number.isNaN(Number(raw)) && raw !== "") {
            value = Number(raw);
          }
          fm[kv[1]] = value;
        }
      }
      mutator(fm);
      const fmLines = Object.entries(fm).map(
        ([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`,
      );
      file.contents = `---\n${fmLines.join("\n")}\n---\n${body}`;
    },
  };
}

export class Plugin {
  app: App;
  manifest = { id: "sauce-crm", version: "0.0.0" };
  constructor(app: App = new App(), _manifest?: unknown) {
    this.app = app;
  }
  addCommand(_cmd: unknown): void {}
  addRibbonIcon(_n: string, _t: string, _cb: (e: MouseEvent) => void): HTMLElement {
    return document.createElement("div");
  }
  registerView(_t: string, _f: unknown): void {}
  registerInterval(id: number): number {
    return id;
  }
  addSettingTab(_t: unknown): void {}
  async loadData(): Promise<unknown> { return {}; }
  async saveData(_d: unknown): Promise<void> {}
}

export class Setting {
  constructor(public containerEl: HTMLElement) {}
  setName(_s: string): this { return this; }
  setDesc(_s: string): this { return this; }
  setHeading(): this { return this; }
  addText(_cb: (t: unknown) => void): this { return this; }
  addToggle(_cb: (t: unknown) => void): this { return this; }
  addDropdown(_cb: (d: unknown) => void): this { return this; }
  addButton(_cb: (b: unknown) => void): this { return this; }
  addSlider(_cb: (s: unknown) => void): this { return this; }
}

export class Modal {
  app: App;
  containerEl: HTMLElement = document.createElement("div");
  contentEl: HTMLElement = document.createElement("div");
  titleEl: HTMLElement = document.createElement("h2");
  constructor(app: App) { this.app = app; }
  open(): void {}
  close(): void {}
}

export class ItemView {
  app: App;
  contentEl: HTMLElement = document.createElement("div");
  constructor(public leaf: unknown) {
    this.app = new App();
  }
  getViewType(): string { return "stub"; }
  getDisplayText(): string { return "stub"; }
  getIcon(): string { return ""; }
}

export class WorkspaceLeaf {
  view: ItemView | null = null;
  async setViewState(_s: unknown): Promise<void> {}
}

export class Notice {
  constructor(message: string) {
    console.log("[Notice]", message);
  }
}

export class MarkdownView extends ItemView {
  file: TFile | null = null;
}

export class Menu {
  items: Array<{ title: string; cb: () => void }> = [];
  addItem(cb: (i: unknown) => unknown): this {
    const captured: { title: string; cb: () => void } = { title: "", cb: () => {} };
    const item = {
      setTitle: (s: string) => { captured.title = s; return item; },
      setIcon:  (_s: string) => item,
      onClick:  (cb: () => void) => { captured.cb = cb; return item; },
    };
    cb(item);
    this.items.push(captured);
    return this;
  }
  addSeparator(): this { return this; }
  showAtMouseEvent(_e: MouseEvent): void {}
  showAtPosition(_p: { x: number; y: number }): void {}
}

export function addIcon(_name: string, _svg: string): void {}
export function setIcon(_el: HTMLElement, _name: string): void {}

export const Platform = {
  isDesktop: true,
  isMobile: false,
  isDesktopApp: true,
  isMobileApp: false,
  isIosApp: false,
  isAndroidApp: false,
  isPhone: false,
  isTablet: false,
  isMacOS: false,
  isWin: false,
  isLinux: true,
  isSafari: false,
  resourcePathPrefix: "",
};
export async function requestUrl(
  init: unknown,
): Promise<{ status: number; text: string; json: unknown; headers: Record<string, string> }> {
  const url = typeof init === "string" ? init : ((init as { url?: string })?.url ?? "");
  const method = typeof init === "object" && init ? ((init as { method?: string }).method ?? "GET") : "GET";
  // Echo into headers (back-compat: status/text/json unchanged) so wrappers can
  // assert request pass-through in tests.
  return { status: 200, text: "", json: {}, headers: { "x-echo-url": url, "x-echo-method": method } };
}
