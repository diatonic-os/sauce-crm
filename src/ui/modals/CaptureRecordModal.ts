import { App, Modal, Notice, Setting } from "obsidian";
import type SauceGraphPlugin from "../../main";
import { TemplateService } from "../../services/TemplateService";
import { todayIso, parseIsoSafe } from "../../util/DateUtil";
import { slugify } from "../../util/Yaml";
import { wrapWikilink } from "../../util/Wikilink";
import { WikilinkSuggest } from "./WikilinkSuggest";

export type CaptureRecordKind =
  | "knowledge-note"
  | "idea"
  | "observation"
  | "task"
  | "event"
  | "ledger-entry"
  | "pipeline-deal";

interface CaptureDef {
  title: string;
  folder: (plugin: SauceGraphPlugin) => string;
  icon: string;
  template: (
    input: Partial<Record<string, unknown>>,
  ) => Record<string, unknown>;
  bodyHeading: string;
}

const CAPTURE_DEFS: Record<CaptureRecordKind, CaptureDef> = {
  "knowledge-note": {
    title: "Knowledge Note",
    folder: (p) => p.settings.paths.notes,
    icon: "sauce-note",
    template: (input) => TemplateService.knowledgeNoteFrontmatter(input),
    bodyHeading: "Notes",
  },
  idea: {
    title: "Idea",
    folder: (p) => p.settings.paths.ideas,
    icon: "sauce-idea",
    template: (input) => TemplateService.ideaFrontmatter(input),
    bodyHeading: "Idea",
  },
  observation: {
    title: "Observation",
    folder: (p) => p.settings.paths.observations,
    icon: "sauce-observation",
    template: (input) => TemplateService.observationFrontmatter(input),
    bodyHeading: "Observation",
  },
  task: {
    title: "Task",
    folder: (p) => p.settings.paths.tasks,
    icon: "sauce-task",
    template: (input) => TemplateService.taskFrontmatter(input),
    bodyHeading: "Task Details",
  },
  event: {
    title: "Event",
    folder: (p) => p.settings.paths.events,
    icon: "sauce-event",
    template: (input) => TemplateService.eventFrontmatter(input),
    bodyHeading: "Agenda",
  },
  "ledger-entry": {
    title: "Ledger Entry",
    folder: (p) => p.settings.paths.ledger,
    icon: "sauce-ledger",
    template: (input) => TemplateService.ledgerEntryFrontmatter(input),
    bodyHeading: "Ledger Notes",
  },
  "pipeline-deal": {
    title: "Pipeline Deal",
    folder: (p) => p.settings.paths.pipeline,
    icon: "sauce-pipeline",
    template: (input) => TemplateService.pipelineDealFrontmatter(input),
    bodyHeading: "Account Plan",
  },
};

export class CaptureRecordModal extends Modal {
  private fm: Partial<Record<string, unknown>> = {
    date: todayIso(),
    status: "todo",
    priority: "medium",
    stage: "seed",
    direction: "out",
    currency: "USD",
    amount: 0,
    probability: 0.25,
  };
  private body = "";

  constructor(
    public override app: App,
    public plugin: SauceGraphPlugin,
    private kind: CaptureRecordKind,
  ) {
    super(app);
  }

  override onOpen(): void {
    const def = CAPTURE_DEFS[this.kind];
    const { contentEl } = this;
    this.modalEl.addClass("sauce-modal");
    contentEl.addClass("sauce-capture-modal");
    contentEl.createEl("h2", { text: `New ${def.title}` });

    new Setting(contentEl)
      .setName("Title")
      .setDesc("Used as the note name and frontmatter title.")
      .addText((t) =>
        t
          .setPlaceholder(`${def.title} title`)
          .onChange((v) => (this.fm.title = v)),
      );

    new Setting(contentEl)
      .setName("Date")
      .setDesc("YYYY-MM-DD")
      .addText((t) =>
        t
          .setValue(String(this.fm.date ?? todayIso()))
          .onChange((v) => (this.fm.date = v)),
      );

    this.renderRelationshipPickers(contentEl);
    this.renderKindFields(contentEl);

    new Setting(contentEl)
      .setName("Tags")
      .setDesc("Comma-separated tags without #.")
      .addText((t) => t.onChange((v) => (this.fm.tags = splitCsv(v))));

    new Setting(contentEl)
      .setName(def.bodyHeading)
      .addTextArea((t) =>
        t
          .setPlaceholder(
            "Write the human-readable body here. Frontmatter stays structured.",
          )
          .onChange((v) => (this.body = v)),
      );

    const btns = contentEl.createDiv({ cls: "sauce-buttons" });
    btns.createEl("button", { text: "Create", cls: "sauce-button" }).onclick =
      () => void this.save();
    btns.createEl("button", {
      text: "Cancel",
      cls: "sauce-button sauce-button-secondary",
    }).onclick = () => this.close();
  }

  private renderRelationshipPickers(contentEl: HTMLElement): void {
    new Setting(contentEl).setName("Contact").addButton((b) =>
      b.setButtonText(String(this.fm.contact ?? "Pick person")).onClick(() =>
        new WikilinkSuggest(
          this.app,
          [this.plugin.settings.paths.people],
          (_f, raw) => {
            this.fm.contact = wrapWikilink(raw);
            b.setButtonText(String(this.fm.contact));
          },
          false,
        ).open(),
      ),
    );

    new Setting(contentEl).setName("Org").addButton((b) =>
      b.setButtonText(String(this.fm.org ?? "Pick org")).onClick(() =>
        new WikilinkSuggest(
          this.app,
          [this.plugin.settings.paths.orgs],
          (_f, raw) => {
            this.fm.org = wrapWikilink(raw);
            b.setButtonText(String(this.fm.org));
          },
          false,
        ).open(),
      ),
    );
  }

  private renderKindFields(contentEl: HTMLElement): void {
    if (this.kind === "task") {
      new Setting(contentEl).setName("Status").addDropdown((d) => {
        for (const v of ["todo", "in_progress", "blocked", "done", "cancelled"])
          d.addOption(v, v);
        d.setValue("todo").onChange((v) => (this.fm.status = v));
      });
      new Setting(contentEl).setName("Priority").addDropdown((d) => {
        for (const v of ["low", "medium", "high", "urgent"]) d.addOption(v, v);
        d.setValue("medium").onChange((v) => (this.fm.priority = v));
      });
      new Setting(contentEl)
        .setName("Due")
        .setDesc("YYYY-MM-DD, optional.")
        .addText((t) => t.onChange((v) => (this.fm.due = v || null)));
      new Setting(contentEl)
        .setName("Approval required")
        .addToggle((t) => t.onChange((v) => (this.fm.approval_required = v)));
    } else if (this.kind === "idea") {
      new Setting(contentEl).setName("Stage").addDropdown((d) => {
        for (const v of [
          "seed",
          "shaping",
          "planned",
          "active",
          "shipped",
          "archived",
        ])
          d.addOption(v, v);
        d.setValue("seed").onChange((v) => (this.fm.stage = v));
      });
      new Setting(contentEl).setName("Impact").addDropdown((d) => {
        for (const v of ["low", "medium", "high"]) d.addOption(v, v);
        d.setValue("medium").onChange((v) => (this.fm.impact = v));
      });
      new Setting(contentEl)
        .setName("Next action")
        .addText((t) => t.onChange((v) => (this.fm.next_action = v || null)));
    } else if (this.kind === "observation") {
      new Setting(contentEl).setName("Signal").addDropdown((d) => {
        for (const v of [
          "relationship",
          "opportunity",
          "risk",
          "timing",
          "access",
          "pattern",
        ])
          d.addOption(v, v);
        d.setValue("relationship").onChange((v) => (this.fm.signal = v));
      });
      new Setting(contentEl)
        .setName("Evidence")
        .addTextArea((t) => t.onChange((v) => (this.fm.evidence = v || null)));
    } else if (this.kind === "event") {
      new Setting(contentEl)
        .setName("Start")
        .setDesc("Local time, optional.")
        .addText((t) =>
          t
            .setPlaceholder("09:30")
            .onChange((v) => (this.fm.start = v || null)),
        );
      new Setting(contentEl)
        .setName("End")
        .setDesc("Local time, optional.")
        .addText((t) =>
          t.setPlaceholder("10:00").onChange((v) => (this.fm.end = v || null)),
        );
      new Setting(contentEl)
        .setName("Attendees")
        .setDesc("Comma-separated wikilinks or names.")
        .addText((t) => t.onChange((v) => (this.fm.attendees = splitCsv(v))));
    } else if (this.kind === "ledger-entry") {
      new Setting(contentEl)
        .setName("Category")
        .addText((t) =>
          t
            .setValue("relationship")
            .onChange((v) => (this.fm.category = v || "relationship")),
        );
      new Setting(contentEl).setName("Direction").addDropdown((d) => {
        d.addOption("out", "out").addOption("in", "in");
        d.setValue("out").onChange((v) => (this.fm.direction = v));
      });
      new Setting(contentEl)
        .setName("Amount")
        .addText((t) =>
          t.setValue("0").onChange((v) => (this.fm.amount = Number(v) || 0)),
        );
      new Setting(contentEl)
        .setName("Currency")
        .addText((t) =>
          t.setValue("USD").onChange((v) => (this.fm.currency = v || "USD")),
        );
    } else if (this.kind === "pipeline-deal") {
      new Setting(contentEl).setName("Stage").addDropdown((d) => {
        for (const v of [
          "prospect",
          "first-touch",
          "discovery",
          "proposal",
          "closed-won",
          "closed-lost",
        ])
          d.addOption(v, v);
        d.setValue("prospect").onChange((v) => (this.fm.stage = v));
      });
      new Setting(contentEl)
        .setName("Value")
        .addText((t) =>
          t.onChange((v) => (this.fm.value = v ? Number(v) : null)),
        );
      new Setting(contentEl).setName("Probability").addSlider((s) =>
        s
          .setLimits(0, 1, 0.05)
          .setValue(0.25)
          .setDynamicTooltip()
          .onChange((v) => (this.fm.probability = v)),
      );
      new Setting(contentEl)
        .setName("Next action")
        .addText((t) => t.onChange((v) => (this.fm.next_action = v || null)));
    } else {
      new Setting(contentEl)
        .setName("Topic")
        .addText((t) => t.onChange((v) => (this.fm.topic = v || null)));
      new Setting(contentEl).setName("Confidence").addDropdown((d) => {
        for (const v of ["low", "medium", "high"]) d.addOption(v, v);
        d.setValue("medium").onChange((v) => (this.fm.confidence = v));
      });
    }
  }

  private async save(): Promise<void> {
    const title = String(this.fm.title ?? "").trim();
    if (!title) {
      new Notice("Title is required");
      return;
    }
    const date = String(this.fm.date ?? "");
    if (date && !parseIsoSafe(date)) {
      new Notice("Invalid date. Use YYYY-MM-DD.");
      return;
    }

    const def = CAPTURE_DEFS[this.kind];
    const fm = def.template(this.fm);
    const slug = slugify(`${date || todayIso()} ${title}`);
    const body = bodyFor(def.bodyHeading, this.body);
    await this.plugin.entityService.createEntity(
      def.folder(this.plugin),
      slug,
      fm,
      body,
    );
    new Notice(`Created ${def.title}: ${title}`);
    this.close();
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}

function splitCsv(value: string): string[] {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function bodyFor(heading: string, body: string): string {
  const safe = body.trim();
  return `\n## ${heading}\n\n${safe || "_Captured from Sauce CRM modal._"}\n\n## SauceBot Feed\n\n- [ ] Review and enrich this record.\n\n## Links\n\n- Contact:\n- Org:\n`;
}
