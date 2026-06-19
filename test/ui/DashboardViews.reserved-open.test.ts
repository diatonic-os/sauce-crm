// Regression guard for the dashboard-render bug (Tasks/Inbox/Ledger).
//
// Root cause: SvelteDashboardView defined a click handler named `open(path)`,
// which SHADOWS Obsidian's internal `View.open(eState)` lifecycle method. During
// leaf activation Obsidian calls `view.open(<state object>)`; our override fed
// that object into `openLinkText`, which crashed in `getLinkpathDest`
// (`e.toLowerCase is not a function`), aborting activation so `onOpen` never
// rendered. Calendar worked only because it named its handler `openPath`.
//
// Invariant: none of the v2 ItemView subclasses may define a method named
// `open` — it is reserved by Obsidian's View base class. The link-opening
// handler must be `openPath`.

import { describe, it, expect, vi } from "vitest";
import { ItemView } from "obsidian";

// Vitest has no Svelte plugin, so stub the .svelte component modules that
// DashboardViews imports — we only exercise the TypeScript view classes here.
vi.mock("@/ui/svelte/TasksDashboard.svelte", () => ({ default: function () {} }));
vi.mock("@/ui/svelte/InboxDashboard.svelte", () => ({ default: function () {} }));
vi.mock("@/ui/svelte/LedgerDashboard.svelte", () => ({ default: function () {} }));

import {
  TasksView,
  InboxView,
  LedgerView,
} from "@/ui/views/v2/DashboardViews";

/** Own method names declared between `cls` and ItemView (exclusive). */
function ownMethodsAboveItemView(cls: new (...a: never[]) => unknown): Set<string> {
  const names = new Set<string>();
  let proto: object | null = cls.prototype;
  while (proto && proto !== ItemView.prototype && proto !== Object.prototype) {
    for (const n of Object.getOwnPropertyNames(proto)) {
      if (n !== "constructor") names.add(n);
    }
    proto = Object.getPrototypeOf(proto) as object | null;
  }
  return names;
}

describe("DashboardViews do not shadow Obsidian View.open", () => {
  for (const View of [TasksView, InboxView, LedgerView]) {
    it(`${View.name} must not define a method named 'open'`, () => {
      const methods = ownMethodsAboveItemView(View);
      expect(methods.has("open")).toBe(false);
    });

    it(`${View.name} opens notes via 'openPath'`, () => {
      const methods = ownMethodsAboveItemView(View);
      expect(methods.has("openPath")).toBe(true);
    });
  }
});
