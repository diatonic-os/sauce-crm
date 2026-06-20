import { describe, it, expect, vi } from "vitest";

// Force Platform.isMobile = true BEFORE importing the view module.
vi.mock("obsidian", async (orig) => {
  const real = await orig<typeof import("obsidian")>();
  return { ...real, Platform: { ...(real as any).Platform, isMobile: true } };
});

import { CompatibilityMatrixView } from "@/ui/views/Views";
import { App, WorkspaceLeaf } from "obsidian";

/** Patch an HTMLElement with the Obsidian extension methods that jsdom lacks. */
function patchEl(el: HTMLElement): HTMLElement {
  (el as any).empty = function () {
    while (this.firstChild) this.removeChild(this.firstChild);
  };
  (el as any).addClass = function (...cls: string[]) {
    this.classList.add(...cls);
  };
  (el as any).createDiv = function (opts: { cls?: string; attr?: Record<string, string> } = {}) {
    const d = document.createElement("div");
    if (opts.cls) d.className = opts.cls;
    if (opts.attr) Object.entries(opts.attr).forEach(([k, v]) => d.setAttribute(k, v));
    patchEl(d);
    this.appendChild(d);
    return d;
  };
  (el as any).createEl = function <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    opts: { cls?: string; text?: string; attr?: Record<string, string> } = {},
  ): HTMLElementTagNameMap[K] {
    const e = document.createElement(tag) as HTMLElementTagNameMap[K];
    if (opts.cls) (e as HTMLElement).className = opts.cls;
    if (opts.text) e.textContent = opts.text;
    if (opts.attr) Object.entries(opts.attr).forEach(([k, v]) => (e as HTMLElement).setAttribute(k, v));
    patchEl(e as unknown as HTMLElement);
    this.appendChild(e);
    return e;
  };
  (el as any).createSpan = function (opts: { cls?: string; text?: string } = {}) {
    const s = document.createElement("span");
    if (opts.cls) s.className = opts.cls;
    if (opts.text) s.textContent = opts.text;
    patchEl(s);
    this.appendChild(s);
    return s;
  };
  (el as any).setText = function (t: string) {
    this.textContent = t;
  };
  (el as any).querySelectorAll = el.querySelectorAll.bind(el);
  (el as any).querySelector = el.querySelector.bind(el);
  return el;
}

function makeStubPlugin() {
  const app = new App();
  return {
    app,
    settings: {
      compat_config: {
        rho_adm: 0.7,
        fields: ["roles", "industry"],
      },
    },
    entityService: {
      allPeople: () => [
        {
          file: { path: "people/Alice.md", basename: "Alice" },
          frontmatter: { type: "warm-contact", roles: ["engineer"], industry: "tech" },
        },
        {
          file: { path: "people/Bob.md", basename: "Bob" },
          frontmatter: { type: "warm-contact", roles: ["engineer"], industry: "tech" },
        },
      ],
    },
  };
}

describe("CompatibilityMatrixView — mobile layout", () => {
  it("renders a pair LIST (not a grid) on mobile", async () => {
    const stub = makeStubPlugin();
    const view = new (CompatibilityMatrixView as any)(
      new WorkspaceLeaf(),
      stub,
    );
    // Patch the contentEl so Obsidian DOM extensions work in jsdom.
    patchEl(view.contentEl);

    await view.onOpen();

    // On mobile: no NxN grid rendered, yes pair list.
    expect(view.contentEl.querySelector(".sauce-matrix")).toBeNull();
    expect(view.contentEl.querySelector(".sauce-compat-pairlist")).not.toBeNull();
  });
});
