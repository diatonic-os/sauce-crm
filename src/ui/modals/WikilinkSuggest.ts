import { App, FuzzySuggestModal, TFile } from "obsidian";

export class WikilinkSuggest extends FuzzySuggestModal<TFile> {
  constructor(
    app: App,
    private scopeFolders: string[],
    private onChoose: (file: TFile | null, raw: string) => void,
    private allowFreeText = true,
  ) {
    super(app);
    this.setPlaceholder("Type to search…");
  }

  getItems(): TFile[] {
    const out: TFile[] = [];
    for (const f of this.app.vault.getMarkdownFiles()) {
      if (
        this.scopeFolders.length === 0 ||
        this.scopeFolders.some((s) => f.path.startsWith(s))
      )
        out.push(f);
    }
    return out;
  }

  getItemText(item: TFile): string {
    return item.basename;
  }

  onChooseItem(item: TFile): void {
    this.onChoose(item, item.basename);
  }

  override onNoSuggestion(): void {
    if (!this.allowFreeText) return;
    // Allow pressing Enter on raw input to create-new
    const raw = this.inputEl.value.trim();
    if (raw) this.onChoose(null, raw);
  }
}
