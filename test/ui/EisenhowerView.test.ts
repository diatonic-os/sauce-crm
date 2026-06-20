// Regression guard: EisenhowerView must not define a method named `open`
// (it shadows Obsidian's View.open lifecycle hook — see DashboardViews.reserved-open.test.ts).

import { describe, it, expect } from "vitest";
import { ItemView } from "obsidian";
import { EisenhowerView } from "@/ui/views/v2/EisenhowerView";

function ownMethodsAboveItemView(cls: new (...a: never[]) => unknown): Set<string> {
  const names = new Set<string>();
  let proto: object | null = cls.prototype as object;
  while (proto && proto !== ItemView.prototype && proto !== Object.prototype) {
    for (const n of Object.getOwnPropertyNames(proto)) {
      if (n !== "constructor") names.add(n);
    }
    proto = Object.getPrototypeOf(proto) as object | null;
  }
  return names;
}

describe("EisenhowerView reserved-open guard", () => {
  it("must not define a method named 'open'", () => {
    const methods = ownMethodsAboveItemView(EisenhowerView);
    expect(methods.has("open")).toBe(false);
  });

  it("opens notes via 'openPath'", () => {
    const methods = ownMethodsAboveItemView(EisenhowerView);
    expect(methods.has("openPath")).toBe(true);
  });
});
