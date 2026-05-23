// Auto-enrichment settings (PLAN T5). Master switch + autostart + per-stage
// toggles (classify / tag / graph). Stages write to vault frontmatter and
// re-mirror to LanceDB; runs are fingerprinted via the provenance layer.
import type SauceGraphPlugin from "../../../main";
import { addToggleRow } from "../../components/v2/ToggleRow";

export function renderEnrichment(
  containerEl: HTMLElement,
  plugin: SauceGraphPlugin,
): void {
  const e = plugin.settings.features.enrichment;
  const save = () => plugin.saveSettings();

  containerEl.createEl("h3", { text: "Auto-enrichment" });
  containerEl.createEl("p", {
    cls: "setting-item-description",
    text: "Automatically classify, tag, and build graph edges from note content. Writes additively to frontmatter (never overwrites) and mirrors to LanceDB. Each stage toggles independently.",
  });

  addToggleRow(containerEl, {
    name: "Enable auto-enrichment",
    desc: "Master switch. Off ⇒ no enrichment runs.",
    value: e.enabled,
    onChange: async (v) => {
      e.enabled = v;
      await save();
    },
  });

  addToggleRow(containerEl, {
    name: "Autostart on edit",
    desc: 'Run enrichment automatically when a note changes. Off ⇒ run only via the "Enrich current note" command.',
    value: e.autostart,
    onChange: async (v) => {
      e.autostart = v;
      await save();
    },
  });

  addToggleRow(containerEl, {
    name: "Stage: classify",
    desc: "Infer primary_type / roles (sets primary_type only when absent).",
    value: e.classify,
    onChange: async (v) => {
      e.classify = v;
      await save();
    },
  });
  addToggleRow(containerEl, {
    name: "Stage: tag",
    desc: "Extract topics / #hashtags into the tags list.",
    value: e.tag,
    onChange: async (v) => {
      e.tag = v;
      await save();
    },
  });
  addToggleRow(containerEl, {
    name: "Stage: graph",
    desc: "Derive edges from [[wikilinks]] / mentions in the body.",
    value: e.graph,
    onChange: async (v) => {
      e.graph = v;
      await save();
    },
  });
}
