// RAG & Embeddings settings (PLAN T3). Renders the global RAG switch, the
// embedding-provider selector, the realtime-embeddings toggle, and per-provider
// {enabled, endpoint, model} config for LM Studio / Ollama / OpenAI. Saving
// re-pushes the config into the Copilot runtime (plugin.saveSettings →
// syncEmbeddingConfig) so toggles take effect live.
import { Notice, Setting } from "obsidian";
import type SauceGraphPlugin from "../../../main";
import { addToggleRow } from "../../components/v2/ToggleRow";
import { ProviderPicker } from "../../components/v2/ProviderPicker";
import type { ProviderId } from "../../../copilot/ModelCatalog";
import type { EmbedProviderId } from "../../../settings/FeatureSettings";
import { DEFAULT_EMBEDDING_DIM } from "../../../backend/lance";

const PROVIDER_LABELS: Record<EmbedProviderId, string> = {
  lmstudio: "LM Studio",
  ollama: "Ollama",
  openai: "OpenAI",
};

export function renderRagEmbeddings(
  containerEl: HTMLElement,
  plugin: SauceGraphPlugin,
): void {
  const rag = plugin.settings.features.rag;
  const save = () => plugin.saveSettings();

  containerEl.createEl("h3", { text: "RAG & Embeddings" });
  containerEl.createEl("p", {
    cls: "setting-item-description",
    text: "Semantic retrieval over your vault + uploaded documents, backed by LanceDB vectors. When off, search uses lexical (fuzzy/tag) matching only.",
  });

  addToggleRow(containerEl, {
    name: "Enable RAG",
    desc: "Master switch for embeddings + semantic search.",
    value: rag.enabled,
    onChange: async (v) => {
      rag.enabled = v;
      await save();
    },
  });

  new Setting(containerEl)
    .setName("Embedding provider")
    .setDesc(
      "Which provider generates embeddings — independent of your chat model.",
    )
    .addDropdown((d) =>
      d
        .addOption("lmstudio", "LM Studio")
        .addOption("ollama", "Ollama")
        .addOption("openai", "OpenAI")
        .setValue(rag.provider)
        .onChange(async (v) => {
          rag.provider = v as EmbedProviderId;
          await save();
        }),
    );

  addToggleRow(containerEl, {
    name: "Realtime embeddings",
    desc: 'Embed on every vault change. Off ⇒ embed only on manual "Rebuild LanceDB Index".',
    value: rag.realtimeEmbeddings,
    onChange: async (v) => {
      rag.realtimeEmbeddings = v;
      await save();
    },
  });

  addToggleRow(containerEl, {
    name: "Index whole vault",
    desc: 'Mirror ALL markdown notes (not just typed entities) into the vector index. Untyped notes receive a fallback type of "note". Requires a manual index rebuild after enabling.',
    value: rag.fullVaultIndex,
    onChange: async (v) => {
      rag.fullVaultIndex = v;
      await save();
    },
  });

  new Setting(containerEl)
    .setName("Exclude folders (one per line)")
    .setDesc("Vault-relative folder prefixes to skip during whole-vault indexing. E.g. templates, archive.")
    .addTextArea((ta) => {
      ta.setValue((rag.excludeGlobs ?? []).join("\n"));
      ta.inputEl.rows = 3;
      ta.onChange(async (v) => {
        rag.excludeGlobs = v
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean);
        await save();
      });
    });

  new Setting(containerEl)
    .setName("Embedding dimension")
    .setDesc(
      `Override the vector dimension for LanceDB. Leave blank to use the compiled default (${DEFAULT_EMBEDDING_DIM}). ` +
      "Must match your model's output dimension. Changing this requires a full index rebuild — the plugin will warn you.",
    )
    .addText((t) => {
      t.setPlaceholder(String(DEFAULT_EMBEDDING_DIM));
      t.setValue(rag.embeddingDim != null ? String(rag.embeddingDim) : "");
      t.onChange(async (v) => {
        const trimmed = v.trim();
        if (!trimmed) {
          rag.embeddingDim = null;
          await save();
          return;
        }
        const n = parseInt(trimmed, 10);
        if (!Number.isFinite(n) || n < 1) {
          new Notice("Embedding dimension must be a positive integer.");
          return;
        }
        if (n !== (rag.embeddingDim ?? DEFAULT_EMBEDDING_DIM)) {
          new Notice(
            `Embedding dimension changed to ${n}. A full index rebuild is required — ` +
            "use the \"Rebuild LanceDB Index\" command in the command palette.",
          );
        }
        rag.embeddingDim = n;
        await save();
      });
    });

  // Per-provider endpoint + model. The selected provider above is the one
  // actually used; the others are kept configured for quick switching.
  for (const id of ["lmstudio", "ollama", "openai"] as EmbedProviderId[]) {
    const pc = rag.providers[id];
    containerEl.createEl("h4", { text: `${PROVIDER_LABELS[id]} embeddings` });
    addToggleRow(containerEl, {
      name: `Enable ${PROVIDER_LABELS[id]}`,
      value: pc.enabled,
      onChange: async (v) => {
        pc.enabled = v;
        await save();
      },
    });
    new Setting(containerEl)
      .setName("Endpoint")
      .setDesc("Change this then hit Refresh to re-list models.")
      .addText((t) =>
        t.setValue(pc.endpoint).onChange(async (v) => {
          pc.endpoint = v;
          await save();
        }),
      );
    // Live embedding-model dropdown (catalog filtered to embedding models).
    // OpenAI lists live with the copilot API key; local providers list from
    // their endpoint. Must match the LanceDB vector dimension.
    const pickerHost = containerEl.createDiv({ cls: "sg-section-row" });
    new ProviderPicker({
      container: pickerHost,
      plugin,
      lockedProvider: id as ProviderId,
      kind: "embedding",
      modelLabel: "Embedding model",
      initialModel: pc.model,
      endpoint: pc.endpoint,
      apiKey: plugin.settings.copilot.apiKey,
      onChange: async ({ model }) => {
        pc.model = model;
        await save();
      },
    }).render();
  }
}
