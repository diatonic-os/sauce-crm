// Document harvesting settings (PLAN T7). Master toggle; harvesting itself runs
// via the "Harvest current file into RAG" command. Uploaded docs become RAG
// context (LanceDB chunks), never vault notes. PDF/DOCX need their parser
// installed; txt/md work out of the box.
import type SauceGraphPlugin from "../../../main";
import { addToggleRow } from "../../components/v2/ToggleRow";

export function renderDocuments(
  containerEl: HTMLElement,
  plugin: SauceGraphPlugin,
): void {
  const docs = plugin.settings.features.documents;
  const save = () => plugin.saveSettings();

  containerEl.createEl("h3", { text: "Document harvesting" });
  containerEl.createEl("p", {
    cls: "setting-item-description",
    text: 'Upload documents (txt / md / pdf / docx) as RAG context: extracted, chunked, embedded into LanceDB, and fingerprinted. They never become vault notes. Requires RAG enabled. Run via the "Harvest current file into RAG" command.',
  });

  addToggleRow(containerEl, {
    name: "Enable document harvesting",
    desc: "Master switch. PDF/DOCX additionally need their parser installed (pdf-parse / mammoth).",
    value: docs.enabled,
    onChange: async (v) => {
      docs.enabled = v;
      await save();
    },
  });
}
