import { describe, expect, it, vi } from "vitest";
import { TFile, Vault, WorkspaceLeaf } from "obsidian";

// The Svelte SFC cannot be parsed by vitest (no svelte plugin in vitest.config);
// CalendarView only mounts it, so a default-export stub lets the module load.
vi.mock("../../../../src/ui/svelte/Calendar.svelte", () => ({ default: {} }));

import { CalendarView } from "../../../../src/ui/views/v2/CalendarView";
import type SauceGraphPlugin from "../../../../src/main";

/** Build a CalendarView wired to an in-memory vault + an instrumented
 *  workspace so we can assert openFile is called only for resolvable paths. */
async function makeView(seedPaths: string[]): Promise<{
  view: CalendarView;
  openFile: ReturnType<typeof vi.fn>;
}> {
  const vault = new Vault();
  for (const p of seedPaths) await vault.create(p, "---\ntype: touch\n---\n");
  const openFile = vi.fn();
  const plugin = {
    app: {
      vault,
      workspace: {
        getLeaf: () => ({ openFile }),
      },
    },
  } as unknown as SauceGraphPlugin;
  const view = new CalendarView(new WorkspaceLeaf() as never, plugin);
  return { view, openFile };
}

describe("CalendarView.openPath (TFile resolve-and-guard)", () => {
  it("opens the file when the path resolves to a TFile", async () => {
    const { view, openFile } = await makeView(["touches/2026/06/t.md"]);
    view.openPath("touches/2026/06/t.md");
    expect(openFile).toHaveBeenCalledTimes(1);
    expect(openFile.mock.calls[0]![0]).toBeInstanceOf(TFile);
  });

  it("does nothing when the path does not resolve (no phantom tab)", async () => {
    const { view, openFile } = await makeView(["touches/2026/06/t.md"]);
    view.openPath("touches/2026/06/deleted.md");
    expect(openFile).not.toHaveBeenCalled();
  });
});
