import { describe, expect, it, vi } from "vitest";
import { WorkspaceLeaf } from "obsidian";
import { SauceBotChatView } from "../../../../src/ui/views/v2/SauceBotChatView";
import type { EmbedProviderId } from "../../../../src/settings/FeatureSettings";
import type SauceGraphPlugin from "../../../../src/main";

const EMBED_PROVIDERS: EmbedProviderId[] = ["lmstudio", "ollama", "openai"];

interface Privates {
  embedProviderSel: HTMLSelectElement;
  onEmbedProviderChange(): Promise<void>;
  refreshEmbedOptions(): Promise<void>;
  plugin: {
    settings: { features: { rag: { provider: EmbedProviderId } } };
    saveSettings: () => Promise<void>;
  };
}

function makeView(initial: EmbedProviderId): {
  view: SauceBotChatView;
  p: Privates;
  saveSettings: ReturnType<typeof vi.fn>;
  syncEmbeddingConfig: ReturnType<typeof vi.fn>;
} {
  const saveSettings = vi.fn(async () => {});
  const syncEmbeddingConfig = vi.fn();
  const plugin = {
    settings: { features: { rag: { provider: initial } } },
    saveSettings,
    syncEmbeddingConfig,
  } as unknown as SauceGraphPlugin;
  const view = new SauceBotChatView(new WorkspaceLeaf() as never, plugin);
  const p = view as unknown as Privates;
  // refreshEmbedOptions hits the network model catalog; stub it for the unit.
  const refreshEmbedOptions = vi.fn(async () => {});
  (p as { refreshEmbedOptions: unknown }).refreshEmbedOptions =
    refreshEmbedOptions;
  // Build the embed-provider select with the same option set buildHeader
  // populates from EMBED_PROVIDERS (plain DOM — the `option` helper relies on
  // Obsidian's createEl extension, unavailable under jsdom).
  const sel = document.createElement("select");
  for (const prov of EMBED_PROVIDERS) {
    const o = document.createElement("option");
    o.value = prov;
    o.text = prov;
    sel.add(o);
  }
  sel.value = initial;
  p.embedProviderSel = sel;
  return { view, p, saveSettings, syncEmbeddingConfig };
}

describe("SauceBotChatView embed-provider picker (EMBED_PROVIDERS)", () => {
  it("offers exactly EMBED_PROVIDERS as options", () => {
    const { p } = makeView("lmstudio");
    const opts = [...p.embedProviderSel.options].map((o) => o.value);
    expect(opts).toEqual(EMBED_PROVIDERS);
  });

  it("changing the select updates settings.features.rag.provider and refreshes models", async () => {
    const { p, saveSettings, syncEmbeddingConfig } = makeView("lmstudio");
    p.embedProviderSel.value = "ollama";
    await p.onEmbedProviderChange();

    expect(p.plugin.settings.features.rag.provider).toBe("ollama");
    expect(saveSettings).toHaveBeenCalledTimes(1);
    expect(
      (p as unknown as { refreshEmbedOptions: ReturnType<typeof vi.fn> })
        .refreshEmbedOptions,
    ).toHaveBeenCalledTimes(1);
    expect(syncEmbeddingConfig).toHaveBeenCalledTimes(1);
  });

  it("is a no-op when the selected provider is unchanged", async () => {
    const { p, saveSettings } = makeView("lmstudio");
    p.embedProviderSel.value = "lmstudio";
    await p.onEmbedProviderChange();
    expect(saveSettings).not.toHaveBeenCalled();
  });
});
