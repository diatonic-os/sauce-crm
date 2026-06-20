// Relationship card — open a person/org and see related people, touches, ideas.
// The visualization "card" the user described: people ARE the touches, touches
// roll up under orgs, ideas relate across both. Clicking a related person pivots
// the card to them (the "connected matrix" you navigate by relationship).

import { App, Modal, TFile } from "obsidian";
import {
  buildEntityCard,
  type MapData,
  type EntityCard,
} from "../../saucebot/harness/EntityCard";
import { buildMapDataFromVault } from "../RelationshipMapData";

export class RelationshipCardModal extends Modal {
  constructor(
    app: App,
    private entityId: string,
    private data?: MapData,
  ) {
    super(app);
  }

  override onOpen(): void {
    const data = this.data ?? buildMapDataFromVault(this.app);
    this.data = data;
    const card = buildEntityCard(this.entityId, data);
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("sauceom-card");

    if (!card) {
      contentEl.createEl("h3", { text: this.entityId });
      contentEl.createEl("p", { text: "No person or org note found for this name." });
      return;
    }

    contentEl.createEl("h2", {
      text: `${card.name}  ·  ${card.kind === "org" ? "Organization" : "Person"}`,
    });
    if (card.org) contentEl.createEl("div", { text: `Org: ${card.org}` });

    this.section(contentEl, "Related people", card.relatedPeople, (name) => {
      const link = contentEl.createEl("a", { text: name, href: "#" });
      link.onClickEvent((e) => {
        e.preventDefault();
        this.entityId = name;
        this.onOpen(); // pivot the card
      });
      return link;
    });

    if (card.kind === "org" && card.members?.length) {
      this.section(contentEl, "Members", card.members);
    }

    // Touches — people are the touches; for an org these are the rolled-up
    // member touches. Show date + summary (the context block's headline).
    const touchWrap = contentEl.createDiv();
    touchWrap.createEl("h4", { text: `Touches (${card.touches.length})` });
    const tl = touchWrap.createEl("ul");
    for (const t of card.touches.slice(0, 25)) {
      tl.createEl("li", {
        text: `${t.date || "—"} · ${t.person}${t.summary ? ` — ${t.summary}` : ""}`,
      });
    }
    if (card.touches.length === 0) tl.createEl("li", { text: "No touches yet." });

    this.section(
      contentEl,
      `Ideas (${card.ideas.length})`,
      card.ideas.map((i) => i.title),
    );

    const open = contentEl.createEl("button", { text: "Open note" });
    open.onClickEvent(() => {
      const file = this.app.vault
        .getMarkdownFiles()
        .find((f) => f.basename === card.id);
      if (file instanceof TFile) {
        void this.app.workspace.getLeaf(false).openFile(file);
        this.close();
      }
    });
  }

  private section(
    parent: HTMLElement,
    title: string,
    items: string[],
    render?: (item: string) => HTMLElement,
  ): void {
    const wrap = parent.createDiv();
    wrap.createEl("h4", { text: title });
    if (items.length === 0) {
      wrap.createEl("div", { text: "—" });
      return;
    }
    const ul = wrap.createEl("ul");
    for (const item of items) {
      const li = ul.createEl("li");
      if (render) li.appendChild(render(item));
      else li.setText(item);
    }
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}
