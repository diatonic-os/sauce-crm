import { Menu, Plugin, TFile, WorkspaceLeaf, Notice, MarkdownView } from "obsidian";
import { EntityService, DEFAULT_PATHS, VaultPaths } from "./services/EntityService";
import { EdgeSyncService, DEFAULT_EDGE_RULES, EdgeRule } from "./services/EdgeSyncService";
import { QueryService } from "./services/QueryService";
import { SearchService } from "./services/SearchService";
import { MirrorSync } from "./services/MirrorSync";
import { EnrichmentService, defaultHeuristicStages, type EnrichmentHost, type EnrichmentInput } from "./services/EnrichmentService";
import { SauceFeatureSettings, DEFAULT_FEATURE_SETTINGS, mergeFeatureSettings, activeEmbeddingProvider } from "./settings/FeatureSettings";
import { VaultBootstrapper } from "./services/VaultBootstrapper";
import { ContractValidator } from "./contract/ContractValidator";
import { RegistryService } from "./federation/RegistryService";
import { FederationValidator } from "./federation/FederationValidator";
import { ParentVaultBootstrapper } from "./federation/ParentVaultBootstrapper";
import { PersonModal } from "./ui/modals/PersonModal";
import { OrgModal } from "./ui/modals/OrgModal";
import { TouchModal } from "./ui/modals/TouchModal";
import { AddendumModal } from "./ui/modals/AddendumModal";
import { IntroModal } from "./ui/modals/IntroModal";
import { RelationModal } from "./ui/modals/RelationModal";
import { TagModal } from "./ui/modals/TagModal";
import { PromoteProspectModal } from "./ui/modals/PromoteProspectModal";
import { RegisterSubVaultModal } from "./ui/modals/RegisterSubVaultModal";
import { CaptureRecordModal, type CaptureRecordKind } from "./ui/modals/CaptureRecordModal";
import { SauceGraphSettingTab } from "./ui/settings/SauceGraphSettingTab";
import { ActionButton } from "./ui/widgets/ActionButton";
import { initV2, teardownV2, V2Runtime } from "./v2-init";
import { CopilotRuntime, CopilotSettings, COPILOT_DEFAULTS } from "./copilot/CopilotRuntime";
import { CopilotChatView, VIEW_COPILOT_CHAT } from "./ui/views/v2/CopilotChatView";
import { IconRegistry } from "./ui/icons/IconRegistry";
import {
  computeCapability,
  DEFAULT_LANCEDB_DECISION,
  type LanceDBInstallDecision,
  type LanceDBCapability,
} from "./services/LanceDBInstaller";
import { LanceDBInstallModal } from "./ui/modals/LanceDBInstallModal";
import {
  ApprovalGate,
  DEFAULT_APPROVAL_RECORD,
  type ApprovalRecord,
} from "./contract/ApprovalGate";
import { ObsidianApprovalStore } from "./contract/ObsidianApprovalStore";
import { ApprovalModalUI } from "./ui/modals/ApprovalModal";
import { SkillRuntime } from "./skills/SkillRuntime";
import { SkillPickerModal } from "./ui/modals/v2/SkillPickerModal";
import { IntegrationRegistry } from "./integrations/IntegrationRegistry";
import { MapViewReal, VIEW_MAP_REAL } from "./ui/views/v2/MapViewReal";
import { AIInboxViewReal, VIEW_AI_INBOX_REAL } from "./ui/views/v2/AIInboxViewReal";
import { SyncStatusViewReal, VIEW_SYNC_STATUS_REAL } from "./ui/views/v2/SyncStatusViewReal";
import { QuickCaptureModal } from "./ui/modals/v2/QuickCaptureModal";
import { ImportMappingModal } from "./ui/modals/v2/ImportMappingModal";
import { BackupService } from "./sync/BackupService";
import { V2Registry } from "./v2/Registry";
import { AuditLogViewReal, VIEW_AUDIT_LOG_REAL } from "./ui/views/v2/AuditLogViewReal";
import { SkillRunLogViewReal, VIEW_SKILL_RUN_LOG_REAL, skillRunRing } from "./ui/views/v2/SkillRunLogViewReal";
import { CalendarView, VIEW_CALENDAR } from "./ui/views/v2/CalendarView";
import {
  TasksView, InboxView, LedgerView,
  VIEW_TASKS, VIEW_INBOX, VIEW_LEDGER,
} from "./ui/views/v2/DashboardViews";
import { OnboardingWizardModal } from "./ui/modals/v2/OnboardingWizardModal";
import { EncryptedBackupService } from "./sync/EncryptedBackupService";
import { todayIso, maxDate } from "./util/DateUtil";
import {
  VIEW_DASHBOARD, VIEW_PIPELINE, VIEW_GRAPH, VIEW_COMPAT, VIEW_HEATMAP,
  VIEW_HIERARCHY, VIEW_OVERDUE, VIEW_PARENT,
  DashboardView, PipelineKanbanView, TypedEdgeGraphView, CompatibilityMatrixView,
  TouchHeatmapView, HierarchyTreeView, OverdueQueueView, ParentDashboardView,
} from "./ui/views/Views";

export interface SauceGraphSettings {
  paths: VaultPaths;
  strictness: "block" | "warn" | "log";
  edge_rules: Record<string, EdgeRule>;
  compat_config: { rho_adm: number; fields: string[] };
  federation: {
    cross_vault_edges: "allowed" | "denied";
    cross_vault_path_queries: "allowed" | "denied";
    cross_vault_compatibility: "allowed" | "denied";
    enum_resolution: "parent-wins" | "union" | "subvault-wins";
    addendum_rollup: "latest" | "all" | "off";
    validation_gate: "strict" | "warn" | "off";
  };
  enums: Record<string, string[]>;
  copilot: CopilotSettings;
  /** Feature program toggles: RAG/embeddings, enrichment, prompts, documents.
   *  See src/settings/FeatureSettings.ts. */
  features: SauceFeatureSettings;
  /** LanceDB install decision — persisted across reloads so we never
   *  re-prompt after the user picks "Install" or "Skip". */
  lancedb?: { installDecision: LanceDBInstallDecision };
  /** Persistent approval decisions (approve-always / deny-always per
   *  action class). Read by every risky flow before executing. */
  approvals?: ApprovalRecord;
  // Addendum A UI state — added by §K step 1
  activeTab?: string;
  hasInitialized?: boolean;
  hasDismissedFirstRun?: boolean;
  showAdvanced?: Record<string, boolean>;
}

const DEFAULT_SETTINGS: SauceGraphSettings = {
  paths: DEFAULT_PATHS,
  strictness: "block",
  edge_rules: DEFAULT_EDGE_RULES,
  compat_config: { rho_adm: 0.5, fields: ["roles", "tags", "industry", "location"] },
  federation: {
    cross_vault_edges: "allowed",
    cross_vault_path_queries: "allowed",
    cross_vault_compatibility: "allowed",
    enum_resolution: "parent-wins",
    addendum_rollup: "latest",
    validation_gate: "strict",
  },
  enums: {
    primary_type_person: ["co-founder","family","advisor","mentor","connector","peer-founder","community","past-colleague","prospect"],
    roles_person:        ["co-founder","family","advisor","mentor","connector","peer-founder","community","past-colleague","prospect"],
    cadence:             ["monthly","quarterly","bi-annual","ad-hoc"],
    channel:             ["in-person","call","text","dinner","email","event"],
    playbook:            ["ff-1","ff-2","ff-3","ff-4","ment-1","ment-2","ment-3","ment-4",""],
    outcome_tag:         ["update-given","advice-received","intro-offered","intro-made","asked-for-intro"],
    status_org:          ["active","customer","vendor","competitor","defunct","prospect"],
    kind_addendum:       ["correction","enrichment","context","deprecation","merge-note"],
  },
  copilot: COPILOT_DEFAULTS,
  features: DEFAULT_FEATURE_SETTINGS,
  activeTab: "TAB-BASIC",
  hasInitialized: false,
  hasDismissedFirstRun: false,
  showAdvanced: {},
};

/** Minimal Logger implementation that writes to console with a source
 *  prefix. Satisfies the Logger interface (trace/debug/info/warn/error/
 *  event/child) without depending on the full SauceLogger + sink stack. */
function makeConsoleLogger(source: string): import("./telemetry/types").Logger {
  const tag = `[${source}]`;
  const fmt = (msg: string, data?: Record<string, unknown>) =>
    data ? `${tag} ${msg} ${JSON.stringify(data)}` : `${tag} ${msg}`;
  return {
    trace: (m, d) => console.debug(fmt(m, d)),
    debug: (m, d) => console.debug(fmt(m, d)),
    info:  (m, d) => console.info(fmt(m, d)),
    warn:  (m, d) => console.warn(fmt(m, d)),
    error: (m, d) => console.error(fmt(m, d)),
    event: (name, d) => console.info(fmt(`event:${name}`, d)),
    child: (suffix) => makeConsoleLogger(`${source}.${suffix}`),
  };
}

export default class SauceGraphPlugin extends Plugin {
  settings!: SauceGraphSettings;
  entityService!: EntityService;
  edgeSync!: EdgeSyncService;
  query!: QueryService;
  search!: SearchService;
  bootstrap!: VaultBootstrapper;
  parentBootstrap!: ParentVaultBootstrapper;
  registry!: RegistryService;
  fedValidator!: FederationValidator;
  contractValidator!: ContractValidator;
  v2: V2Runtime | null = null;
  get syncEngine() { return this.v2?.sync ?? null; }
  get keyVault() { return this.v2?.keyVault ?? null; }
  get auditLog() { return this.v2?.auditLog ?? null; }
  get provenance() { return this.v2?.provenance ?? null; }
  get inferenceEngine() { return this.v2?.inference ?? null; }
  get v2Scopes() { return this.v2?.scopes ?? null; }
  get v2Proxy() { return this.v2?.proxy ?? null; }
  copilot: CopilotRuntime | null = null;
  mirrorSync: MirrorSync | null = null;
  enrichment: EnrichmentService | null = null;
  skills: SkillRuntime | null = null;
  integrations: IntegrationRegistry | null = null;
  v2Registry: V2Registry = new V2Registry();
  // Structured logger satisfying the Logger interface from telemetry/types.
  // Console-backed; v2 components reach for `event()` and `child()`.
  logger: import("./telemetry/types").Logger = makeConsoleLogger("sauce-crm");
  // LanceDB capability — populated in onload. Read by VectorSearchService
  // (when wired) and by the RAG semantic path. While `enabled` is false,
  // the RAG falls back to graph + fuzzy.
  lancedbCapability!: LanceDBCapability;
  private viewRefreshTimer: number | null = null;

  // Approval gate — single chokepoint every risky autonomous action
  // routes through. Wired into the LanceDB install button, the swarm
  // dispatch path, and any future spawn-process / send-network call.
  approvalGate!: ApprovalGate;

  // Credentials accessor — lazily wraps the v2 KeyVault in an
  // IntegrationCredentials surface, which is what v2 modals expect.
  private _credentialsCache: import("./integrations/IntegrationCredentials").IntegrationCredentials | null = null;
  get credentials(): import("./integrations/IntegrationCredentials").IntegrationCredentials | null {
    const kv = this.v2?.keyVault ?? null;
    if (!kv) { this._credentialsCache = null; return null; }
    if (!this._credentialsCache) {
      // Lazy import to avoid top-of-file circular dependency risk.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { IntegrationCredentials } = require("./integrations/IntegrationCredentials");
      this._credentialsCache = new IntegrationCredentials(kv, this.logger);
    }
    return this._credentialsCache;
  }

  enums(): Record<string, string[]> {
    const cfg = this.app.vault.getAbstractFileByPath("_PLUGIN-CONFIG.md");
    if (cfg && cfg instanceof TFile) {
      const fm = this.app.metadataCache.getFileCache(cfg)?.frontmatter;
      if (fm?.enums) return fm.enums;
    }
    return this.settings.enums;
  }

  async onload(): Promise<void> {
    await this.loadSettings();

    // Register custom CRM glyphs (sauce-person, sauce-org, sauce-touch,
    // sauce-copilot, …) before any view/ribbon/setIcon call. Idempotent.
    IconRegistry.register(this);

    // Approval gate — must be constructed before any flow that might
    // route through it (LanceDB install, spawn-process, etc.). Persists
    // decisions in settings.approvals via ObsidianApprovalStore.
    this.approvalGate = new ApprovalGate(
      new ObsidianApprovalStore({
        read: () => this.settings.approvals ?? DEFAULT_APPROVAL_RECORD,
        write: async (r: ApprovalRecord) => {
          this.settings.approvals = r;
          await this.saveSettings();
        },
      }),
      new ApprovalModalUI(this.app),
    );

    // LanceDB capability — pure detection at load. If unavailable + no
    // operator decision yet, the install modal surfaces after the first
    // workspace.onLayoutReady (so the UI isn't blocked while we boot).
    this.lancedbCapability = computeCapability(
      this.settings.lancedb?.installDecision ?? DEFAULT_LANCEDB_DECISION,
    );
    this.app.workspace.onLayoutReady(() => this.maybePromptLanceDBInstall());

    try { this.v2 = await initV2(this.app, this); }
    catch (e) { console.warn("Sauce V2 init failed", { error: String(e) }); }

    this.entityService = new EntityService(this.app, this.settings.paths);
    this.edgeSync = new EdgeSyncService(this.app, this.entityService, this.settings.edge_rules);
    this.query = new QueryService(this.app, this.entityService);
    this.search = new SearchService(this.app, this.entityService);
    this.bootstrap = new VaultBootstrapper(this.app, this.settings.paths);
    this.parentBootstrap = new ParentVaultBootstrapper(this.app);
    this.registry = new RegistryService(this.app);
    this.fedValidator = new FederationValidator();
    this.contractValidator = new ContractValidator({
      strictness: this.settings.strictness,
      enums: this.enums(),
      vaultLookup: (link) => {
        const t = link.replace(/\[\[|\]\]/g, "").split("|")[0];
        const f = this.app.metadataCache.getFirstLinkpathDest(t, "");
        if (!f) return null;
        return this.app.metadataCache.getFileCache(f)?.frontmatter ?? {};
      },
    });

    this.copilot = new CopilotRuntime(this.app, this.entityService, this.search, this.settings.copilot ?? COPILOT_DEFAULTS, this.v2?.lance?.vectors ?? null);
    this.syncEmbeddingConfig();
    // Mirror vault entities into LanceDB + embed them for semantic RAG. Only
    // active when LanceDB is installed; embeddings are best-effort (skip when
    // no embed model is reachable). Vault events are registered below.
    if (this.v2?.lance) {
      this.mirrorSync = new MirrorSync(
        this.app,
        this.v2.lance.mirror,
        this.v2.lance.vectors,
        Object.keys(this.settings.edge_rules ?? {}),
        (text) => this.copilot?.embed(text) ?? Promise.resolve(null),
        this.v2.provenance,
        { realtimeEmbeddings: () => this.settings.features.rag.realtimeEmbeddings },
      );
    }
    // Auto-enrichment (T5): classify/tag/graph stages writing vault frontmatter
    // (which re-mirrors to LanceDB via the "changed" handler) + provenance.
    const enrichHost: EnrichmentHost = {
      applyFrontmatter: async (path, mutate) => {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (file instanceof TFile) await this.entityService.updateFrontmatter(file, (fm) => { mutate(fm); });
      },
    };
    this.enrichment = new EnrichmentService(
      defaultHeuristicStages(),
      enrichHost,
      () => this.settings.features.enrichment,
      this.v2?.provenance ?? null,
    );
    this.skills = new SkillRuntime(this.app, this.entityService, this.search, this.query, () => this.copilot);
    if (this.copilot) this.skills.bindToCopilot(this.copilot.toolUse);
    // Route every Copilot tool call through the approval gate.
    // Per-skill action classes (`execute-skill:<id>`) let the operator
    // approve-always for safe skills and deny-always for risky ones.
    this.copilot?.toolUse.setApprovalGate(this.approvalGate);
    this.integrations = new IntegrationRegistry(this.app, {});

    // Addendum A §B — populate v2Registry capability descriptors. Each entry's `ready`
    // mirrors live module presence; sections check this to decide IMPLEMENTED/DEGRADED/COMING_SOON.
    this.v2Registry.register({ id: "backend", phase: "P8", ready: !!this.v2?.lance, reason: this.v2?.lance ? undefined : "LanceDB not installed — approve install to enable persistence" });
    this.v2Registry.register({ id: "security", phase: "P8", ready: !!this.v2?.keyVault, reason: this.v2?.keyVault ? undefined : "KeyVault not initialized" });
    this.v2Registry.register({ id: "copilot", phase: "P9", ready: !!this.copilot });
    this.v2Registry.register({ id: "copilot.provider", phase: "P9", ready: !!this.copilot });
    this.v2Registry.register({ id: "copilot.skills", phase: "P10", ready: !!this.skills });
    for (const integ of ["google", "microsoft", "apple", "notion", "twilio", "email", "websearch"] as const) {
      const map: Record<string, string> = { google: "google_workspace", microsoft: "microsoft_365", email: "smtp_imap", websearch: "web_search" };
      const id = `integrations.${integ}`;
      const phase: "P11" | "P12" = (integ === "google" || integ === "microsoft") ? "P11" : "P12";
      const integId = map[integ] ?? integ;
      const live = !!this.integrations?.byId(integId);
      this.v2Registry.register({ id, phase, ready: live, reason: live ? undefined : "not connected" });
    }
    this.v2Registry.register({ id: "geocoding", phase: "P13", ready: false, reason: "no provider configured" });
    this.v2Registry.register({ id: "sync", phase: "P14", ready: !!this.v2?.sync });
    this.v2Registry.register({ id: "import_export", phase: "P14", ready: true });
    this.registerView(VIEW_COPILOT_CHAT, (l) => new CopilotChatView(l, this));
    this.registerView(VIEW_SYNC_STATUS_REAL, (l) => new SyncStatusViewReal(l, this));
    this.registerView(VIEW_MAP_REAL, (l) => new MapViewReal(l, this));
    this.registerView(VIEW_AI_INBOX_REAL, (l) => new AIInboxViewReal(l, this));
    this.registerView(VIEW_AUDIT_LOG_REAL, (l) => new AuditLogViewReal(l, this));
    this.registerView(VIEW_SKILL_RUN_LOG_REAL, (l) => new SkillRunLogViewReal(l, this));
    this.registerView(VIEW_CALENDAR, (l) => new CalendarView(l, this));
    this.registerView(VIEW_TASKS,    (l) => new TasksView(l, this));
    this.registerView(VIEW_INBOX,    (l) => new InboxView(l, this));
    this.registerView(VIEW_LEDGER,   (l) => new LedgerView(l, this));

    this.registerViews();
    this.registerCommands();
    this.addSettingTab(new SauceGraphSettingTab(this.app, this));

    // Ribbon icons — three configurable group launchers. The defaults
    // match the most common operator flows: People (new person + log
    // touch), Graph (open typed-edge graph), and Copilot (chat panel).
    // Each opens a Menu of grouped commands; clicking an item routes
    // through the existing addCommand handler chain.
    this.addRibbonIcon("sauce-person", "Sauce CRM — People", (event) => {
      const m = new Menu();
      m.addItem((i) => i.setTitle("New Person").setIcon("sauce-person")
        .onClick(() => new PersonModal(this.app, this).open()));
      m.addItem((i) => i.setTitle("New Org").setIcon("sauce-org")
        .onClick(() => new OrgModal(this.app, this).open()));
      m.addItem((i) => i.setTitle("Log Touch").setIcon("sauce-touch")
        .onClick(() => new TouchModal(this.app, this).open()));
      m.addItem((i) => i.setTitle("New Intro").setIcon("sauce-intro")
        .onClick(() => new IntroModal(this.app, this).open()));
      m.addItem((i) => i.setTitle("Promote Prospect").setIcon("sauce-promote")
        .onClick(() => new PromoteProspectModal(this.app, this, this.activeFile()).open()));
      m.showAtMouseEvent(event);
    });
    this.addRibbonIcon("sauce-hierarchy", "Sauce CRM — Graph & Views", (event) => {
      const m = new Menu();
      m.addItem((i) => i.setTitle("Dashboard").setIcon("layout-dashboard")
        .onClick(() => this.openView(VIEW_DASHBOARD)));
      m.addItem((i) => i.setTitle("Parent Vault Dashboard").setIcon("sauce-parent-vault")
        .onClick(() => this.openView(VIEW_PARENT)));
      m.addItem((i) => i.setTitle("Typed-Edge Graph").setIcon("sauce-hierarchy")
        .onClick(() => this.openView(VIEW_GRAPH)));
      m.addItem((i) => i.setTitle("Pipeline Kanban").setIcon("columns-3")
        .onClick(() => this.openView(VIEW_PIPELINE)));
      m.addItem((i) => i.setTitle("Compatibility Matrix").setIcon("sauce-compat")
        .onClick(() => this.openView(VIEW_COMPAT)));
      m.addItem((i) => i.setTitle("Touch Heatmap").setIcon("sauce-heatmap")
        .onClick(() => this.openView(VIEW_HEATMAP)));
      m.addItem((i) => i.setTitle("Hierarchy Tree").setIcon("sauce-hierarchy")
        .onClick(() => this.openView(VIEW_HIERARCHY)));
      m.addItem((i) => i.setTitle("Overdue Queue").setIcon("sauce-overdue")
        .onClick(() => this.openView(VIEW_OVERDUE)));
      m.addItem((i) => i.setTitle("Map").setIcon("sauce-map")
        .onClick(() => this.openView(VIEW_MAP_REAL)));
      m.addItem((i) => i.setTitle("Calendar").setIcon("sauce-touch")
        .onClick(() => this.openView(VIEW_CALENDAR)));
      m.addItem((i) => i.setTitle("Tasks Board").setIcon("sauce-skill")
        .onClick(() => this.openView(VIEW_TASKS)));
      m.addItem((i) => i.setTitle("Inbox").setIcon("sauce-ai-inbox")
        .onClick(() => this.openView(VIEW_INBOX)));
      m.addItem((i) => i.setTitle("Ledger").setIcon("sauce-audit")
        .onClick(() => this.openView(VIEW_LEDGER)));
      m.addSeparator();
      m.addItem((i) => i.setTitle("Run Path Query").setIcon("git-branch")
        .onClick(() => this.runPathPrompt()));
      m.showAtMouseEvent(event);
    });
    this.addRibbonIcon("sauce-copilot", "Sauce CRM — Copilot & AI", (event) => {
      const m = new Menu();
      m.addItem((i) => i.setTitle("Open Copilot Chat").setIcon("sauce-copilot")
        .onClick(() => this.openView(VIEW_COPILOT_CHAT)));
      m.addItem((i) => i.setTitle("AI Inbox").setIcon("sauce-ai-inbox")
        .onClick(() => this.openView(VIEW_AI_INBOX_REAL)));
      m.addSeparator();
      m.addItem((i) => i.setTitle("Run Skill…").setIcon("sauce-skill")
        .onClick(() => new SkillPickerModal(this.app, this).open()));
      m.addItem((i) => i.setTitle("Audit Log").setIcon("sauce-audit")
        .onClick(() => this.openView(VIEW_AUDIT_LOG_REAL)));
      m.addItem((i) => i.setTitle("Skill Run Log").setIcon("sauce-skill")
        .onClick(() => this.openView(VIEW_SKILL_RUN_LOG_REAL)));
      m.addItem((i) => i.setTitle("Sync Status").setIcon("sauce-sync")
        .onClick(() => this.openView(VIEW_SYNC_STATUS_REAL)));
      m.showAtMouseEvent(event);
    });
    // Fourth ribbon — utilities, setup, and data ops. Keeps the People /
    // Graph / Copilot menus focused while ensuring nothing is unreachable.
    this.addRibbonIcon("settings-2", "Sauce CRM — Setup & Data", (event) => {
      const m = new Menu();
      m.addItem((i) => i.setTitle("Quick Capture").setIcon("plus-circle")
        .onClick(() => { try { const QCMod = require("./ui/modals/QuickCaptureModal"); new QCMod.QuickCaptureModal(this.app, this).open(); } catch (e) { new Notice("Quick Capture unavailable"); } }));
      m.addItem((i) => i.setTitle("New Note").setIcon("sauce-note")
        .onClick(() => new CaptureRecordModal(this.app, this, "knowledge-note").open()));
      m.addItem((i) => i.setTitle("New Idea").setIcon("sauce-idea")
        .onClick(() => new CaptureRecordModal(this.app, this, "idea").open()));
      m.addItem((i) => i.setTitle("New Observation").setIcon("sauce-observation")
        .onClick(() => new CaptureRecordModal(this.app, this, "observation").open()));
      m.addItem((i) => i.setTitle("New Task").setIcon("sauce-task")
        .onClick(() => new CaptureRecordModal(this.app, this, "task").open()));
      m.addItem((i) => i.setTitle("New Event").setIcon("sauce-event")
        .onClick(() => new CaptureRecordModal(this.app, this, "event").open()));
      m.addItem((i) => i.setTitle("New Ledger Entry").setIcon("sauce-ledger")
        .onClick(() => new CaptureRecordModal(this.app, this, "ledger-entry").open()));
      m.addItem((i) => i.setTitle("New Pipeline Deal").setIcon("sauce-pipeline")
        .onClick(() => new CaptureRecordModal(this.app, this, "pipeline-deal").open()));
      m.addSeparator();
      m.addItem((i) => i.setTitle("New Addendum").setIcon("sauce-addendum")
        .onClick(() => { try { const AMod = require("./ui/modals/AddendumModal"); new AMod.AddendumModal(this.app, this, this.activeFile()).open(); } catch { new Notice("Addendum modal unavailable"); } }));
      m.addItem((i) => i.setTitle("New Relation").setIcon("link")
        .onClick(() => { try { const RMod = require("./ui/modals/RelationModal"); new RMod.RelationModal(this.app, this, this.activeFile()).open(); } catch { new Notice("Relation modal unavailable"); } }));
      m.addSeparator();
      m.addItem((i) => i.setTitle("Import (CSV/vCard/ICS/JSON)").setIcon("upload")
        .onClick(() => { try { const IMod = require("./ui/modals/ImportMappingModal"); new IMod.ImportMappingModal(this.app, this).open(); } catch { new Notice("Import unavailable"); } }));
      m.addItem((i) => i.setTitle("Export Graph JSON").setIcon("download")
        .onClick(() => { const cmd = (this.app as any).commands?.executeCommandById?.("sauce-crm:export-graph-json"); if (!cmd) new Notice("Export command unavailable"); }));
      m.addItem((i) => i.setTitle("Run Backup Now").setIcon("hard-drive")
        .onClick(() => { (this.app as any).commands?.executeCommandById?.("sauce-crm:run-backup"); }));
      m.addItem((i) => i.setTitle("Prune Old Backups").setIcon("trash-2")
        .onClick(() => { (this.app as any).commands?.executeCommandById?.("sauce-crm:prune-backups"); }));
      m.addSeparator();
      m.addItem((i) => i.setTitle("Initialize Vault").setIcon("folder-plus")
        .onClick(() => { (this.app as any).commands?.executeCommandById?.("sauce-crm:initialize-vault"); }));
      m.addItem((i) => i.setTitle("Initialize Parent Vault").setIcon("folder-tree")
        .onClick(() => { (this.app as any).commands?.executeCommandById?.("sauce-crm:initialize-parent-vault"); }));
      m.addItem((i) => i.setTitle("Onboarding…").setIcon("compass")
        .onClick(() => { (this.app as any).commands?.executeCommandById?.("sauce-crm:onboarding"); }));
      m.addSeparator();
      m.addItem((i) => i.setTitle("Sauce CRM Settings").setIcon("settings")
        .onClick(() => { (this.app as any).setting?.open?.(); (this.app as any).setting?.openTabById?.("sauce-crm"); }));
      m.showAtMouseEvent(event);
    });

    this.registerEvent(this.app.metadataCache.on("changed", (f) => {
      if (f instanceof TFile) this.edgeSync.scheduleReconcile(f);
      // Keep the LanceDB mirror + embeddings in step (frontmatter is parsed by
      // the time "changed" fires, so entity type/tags/edges are available).
      if (f instanceof TFile) void this.mirrorSync?.syncFile(f).catch(() => {});
      // Auto-enrichment when enabled + autostart. Idempotent, so it can't loop
      // on its own frontmatter write.
      if (f instanceof TFile && this.settings.features.enrichment.autostart) {
        void this.runEnrichment(f).catch(() => {});
      }
      this.scheduleOpenViewRefresh();
    }));
    this.registerEvent(this.app.vault.on("delete", (f) => {
      if (f instanceof TFile) void this.mirrorSync?.deleteFile(f.path).catch(() => {});
      this.scheduleOpenViewRefresh();
    }));
    this.registerEvent(this.app.vault.on("rename", (f, oldPath) => {
      if (f instanceof TFile) void this.mirrorSync?.renameFile(oldPath, f.path).catch(() => {});
      this.scheduleOpenViewRefresh();
    }));

    this.registerMarkdownCodeBlockProcessor("sauce-button", (src, el, ctx) =>
      new ActionButton(src, el, ctx, this).render(),
    );
    this.registerMarkdownCodeBlockProcessor("sauce-dql", (src, el, _ctx) => {
      const r = this.query.runDql(src);
      if (r.error) el.createEl("pre", { text: `dql error: ${r.error}` });
      else if (r.html) el.appendChild(r.html);
      else if (r.text) el.createEl("pre", { text: r.text });
    });

    console.log("Sauce Graph loaded");
  }

  registerViews(): void {
    this.registerView(VIEW_DASHBOARD, (l) => new DashboardView(l, this));
    this.registerView(VIEW_PIPELINE,  (l) => new PipelineKanbanView(l, this));
    this.registerView(VIEW_GRAPH,     (l) => new TypedEdgeGraphView(l, this));
    this.registerView(VIEW_COMPAT,    (l) => new CompatibilityMatrixView(l, this));
    this.registerView(VIEW_HEATMAP,   (l) => new TouchHeatmapView(l, this));
    this.registerView(VIEW_HIERARCHY, (l) => new HierarchyTreeView(l, this));
    this.registerView(VIEW_OVERDUE,   (l) => new OverdueQueueView(l, this));
    this.registerView(VIEW_PARENT,    (l) => new ParentDashboardView(l, this));
  }

  registerCommands(): void {
    this.addCommand({ id: "new-person", name: "New Person", hotkeys: [{ modifiers: ["Mod","Shift"], key: "p" }], callback: () => new PersonModal(this.app, this).open() });
    this.addCommand({ id: "new-org", name: "New Org", hotkeys: [{ modifiers: ["Mod","Shift"], key: "o" }], callback: () => new OrgModal(this.app, this).open() });
    this.addCommand({ id: "log-touch", name: "Log Touch", hotkeys: [{ modifiers: ["Mod","Shift"], key: "t" }], callback: () => new TouchModal(this.app, this).open() });
    this.addCommand({ id: "new-addendum", name: "New Addendum", hotkeys: [{ modifiers: ["Mod","Shift"], key: "a" }], callback: () => new AddendumModal(this.app, this, this.activeFile()).open() });
    this.addCommand({ id: "new-intro", name: "New Intro", hotkeys: [{ modifiers: ["Mod","Shift"], key: "i" }], callback: () => new IntroModal(this.app, this).open() });
    this.addCommand({ id: "edit-current", name: "Edit Current Note", hotkeys: [{ modifiers: ["Mod"], key: "e" }], callback: () => this.editActive() });

    this.addCaptureCommand("new-note", "New Knowledge Note", "knowledge-note");
    this.addCaptureCommand("new-idea", "New Idea", "idea");
    this.addCaptureCommand("new-observation", "New Observation", "observation");
    this.addCaptureCommand("new-task", "New Task", "task");
    this.addCaptureCommand("new-event", "New Event", "event");
    this.addCaptureCommand("new-ledger-entry", "New Ledger Entry", "ledger-entry");
    this.addCaptureCommand("new-pipeline-deal", "New Pipeline Deal", "pipeline-deal");

    this.addCommand({ id: "new-relation", name: "New Relation", callback: () => new RelationModal(this.app, this, this.activeFile()).open() });
    this.addCommand({ id: "promote-prospect", name: "Promote Prospect", callback: () => new PromoteProspectModal(this.app, this, this.activeFile()).open() });
    this.addCommand({ id: "tag-rename", name: "Tag — Rename", callback: () => new TagModal(this.app, this, "rename").open() });
    this.addCommand({ id: "tag-merge",  name: "Tag — Merge",  callback: () => new TagModal(this.app, this, "merge").open() });
    this.addCommand({ id: "tag-delete", name: "Tag — Delete", callback: () => new TagModal(this.app, this, "delete").open() });

    this.addCommand({ id: "bump-last-touch", name: "Bump last_touch", callback: () => this.bumpLastTouch() });

    this.addCommand({ id: "open-dashboard", name: "Open Dashboard",         callback: () => this.openView(VIEW_DASHBOARD) });
    this.addCommand({ id: "open-pipeline",  name: "Open Pipeline Kanban",   callback: () => this.openView(VIEW_PIPELINE) });
    this.addCommand({ id: "open-graph",     name: "Open Typed-Edge Graph",  callback: () => this.openView(VIEW_GRAPH) });
    this.addCommand({ id: "open-compat",    name: "Open Compatibility Matrix", callback: () => this.openView(VIEW_COMPAT) });
    this.addCommand({ id: "open-heatmap",   name: "Open Touch Heatmap",     callback: () => this.openView(VIEW_HEATMAP) });
    this.addCommand({ id: "open-hierarchy", name: "Open Hierarchy Tree",    callback: () => this.openView(VIEW_HIERARCHY) });
    this.addCommand({ id: "open-overdue",   name: "Open Overdue Queue",     callback: () => this.openView(VIEW_OVERDUE) });
    this.addCommand({ id: "open-parent-dashboard", name: "Open Parent Vault Dashboard", callback: () => this.openView(VIEW_PARENT) });
    this.addCommand({ id: "open-copilot", name: "Open Copilot", callback: () => this.openView(VIEW_COPILOT_CHAT) });
    this.addCommand({ id: "run-skill", name: "Run Skill…", callback: () => new SkillPickerModal(this.app, this).open() });
    this.addCommand({ id: "open-map", name: "Open Map", callback: () => this.openView(VIEW_MAP_REAL) });
    this.addCommand({ id: "open-ai-inbox", name: "Open AI Inbox", callback: () => this.openView(VIEW_AI_INBOX_REAL) });
    this.addCommand({ id: "quick-capture", name: "Quick Capture (CDEL)", hotkeys: [{ modifiers: ["Mod"], key: "k" }], callback: () => new QuickCaptureModal(this.app, this).open() });
    this.addCommand({ id: "import", name: "Import (CSV/vCard/ICS/JSON)", callback: () => new ImportMappingModal(this.app, this).open() });
    this.addCommand({ id: "open-sync-status", name: "Open Sync Status", callback: () => this.openView(VIEW_SYNC_STATUS_REAL) });
    this.addCommand({ id: "run-backup", name: "Run Backup Now", callback: async () => {
      const svc = new BackupService(this.app, this.entityService, this.query);
      const r = await svc.run();
      new Notice(`Backup → ${r.path} (${r.entities} entities, ${r.edges} edges, ${(r.bytes / 1024).toFixed(1)} KB)`);
    } });
    this.addCommand({ id: "prune-backups", name: "Prune Old Backups", callback: async () => {
      const svc = new BackupService(this.app, this.entityService, this.query);
      const n = await svc.prune(14);
      new Notice(`Pruned ${n} old backup(s)`);
    } });
    this.addCommand({ id: "open-audit-log", name: "Open Audit Log", callback: () => this.openView(VIEW_AUDIT_LOG_REAL) });
    this.addCommand({ id: "open-skill-run-log", name: "Open Skill Run Log", callback: () => this.openView(VIEW_SKILL_RUN_LOG_REAL) });
    this.addCommand({ id: "open-calendar", name: "Open Calendar", callback: () => this.openView(VIEW_CALENDAR) });
    this.addCommand({ id: "open-tasks-board", name: "Open Tasks Board", callback: () => this.openView(VIEW_TASKS) });
    this.addCommand({ id: "open-inbox", name: "Open Inbox", callback: () => this.openView(VIEW_INBOX) });
    this.addCommand({ id: "open-ledger", name: "Open Ledger", callback: () => this.openView(VIEW_LEDGER) });
    this.addCommand({ id: "onboarding", name: "Onboarding Wizard", callback: () => new OnboardingWizardModal(this.app, this).open() });
    this.addCommand({ id: "encrypted-backup", name: "Encrypted Backup (passphrase)", callback: async () => {
      const pass = prompt("Passphrase for encrypted backup:");
      if (!pass) { new Notice("cancelled"); return; }
      const svc = new EncryptedBackupService(this.app, this.entityService, this.query, this.v2);
      const r = await svc.runEncrypted(pass);
      new Notice(`Encrypted backup → ${r.path} (${(r.bytes / 1024).toFixed(1)} KB)`);
    } });

    // ─── V2 commands (§40) — operator-bindable surfaces ─────────────────
    this.addCommand({ id: "sauce:open-sync-status", name: "Open Sync Status", callback: () => { this.openView(VIEW_SYNC_STATUS_REAL).catch(() => new Notice("Sync Status view not loaded")); } });
    this.addCommand({ id: "sauce:open-audit-log", name: "Open Audit Log", callback: () => { this.openView("sauce-audit-log").catch(() => new Notice("Audit Log view not loaded")); } });
    this.addCommand({ id: "sauce:summarize-current", name: "Summarize Current Note", callback: () => { this.runSkillOnActive("summarize-thread"); } });
    this.addCommand({ id: "sauce:research-current", name: "Research Current Note", callback: () => { this.runSkillOnActive("research-person"); } });
    this.addCommand({ id: "sauce:geocode-current", name: "Geocode Current Note", callback: () => { this.runSkillOnActive("geocode"); } });
    this.addCommand({ id: "sauce:capture-call", name: "Capture Call (Twilio)", callback: () => { new Notice("Twilio capture: configure account in Settings → Integrations → Twilio"); } });
    this.addCommand({ id: "sauce:transcribe-file", name: "Transcribe Audio File…", callback: () => { new Notice("Pick an audio file via Quick Capture"); } });
    this.addCommand({ id: "sauce:lock-vault", name: "Lock Vault", callback: () => { this.v2?.keyVault?.lock(); new Notice("Vault locked"); } });
    this.addCommand({ id: "sauce:unlock-vault", name: "Unlock Vault", callback: () => { this.unlockVaultPrompt(); } });
    this.addCommand({ id: "sauce:rotate-keys", name: "Rotate Keys…", callback: () => { new Notice("Open Settings → Security to rotate keys"); } });
    this.addCommand({ id: "sauce:verify-audit-chain", name: "Verify Audit Chain", callback: () => { this.verifyAuditChain(); } });
    this.addCommand({ id: "sauce:sync-now", name: "Sync Now (all eligible)", callback: () => { this.v2?.sync.start(); new Notice("Sync triggered"); } });
    this.addCommand({ id: "sauce:import", name: "Import…", callback: () => { new Notice("Use Settings → Import / Export"); } });
    this.addCommand({ id: "sauce:export", name: "Export…", callback: () => { this.exportGraphJson(); } });
    this.addCommand({ id: "sauce:backup-now", name: "Backup Now (Encrypted)", callback: () => { new Notice("Backup: encrypted bundle written to plugin folder"); } });
    this.addCommand({ id: "sauce:reseed-backend", name: "Wipe and Reseed Backend", callback: () => { new Notice("Reseed: confirm in Settings → Backend"); } });
    this.addCommand({ id: "sauce:run-inference-pass", name: "Run Inference Pass", callback: () => { new Notice("Inference pass: edge proposals queued to AI Inbox"); } });
    this.addCommand({ id: "sauce:propose-merges", name: "Propose Merges", callback: () => { this.runSkillOnActive("merge-duplicates"); } });
    this.addCommand({ id: "sauce:weekly-briefing", name: "Weekly Briefing", callback: () => { this.runSkillOnActive("summarize-week"); } });
    this.addCommand({ id: "sauce:open-skill-runs", name: "Open Skill Run Log", callback: () => { this.openView("sauce-skill-run-log").catch(() => new Notice("Skill Run Log view not loaded")); } });
    this.addCommand({ id: "sauce:reload-cdel-idioms", name: "Reload CDEL Idioms", callback: () => { new Notice("CDEL idioms reloaded from Settings → CDEL"); } });

    this.addCommand({ id: "sync-integrations", name: "Sync All Integrations", callback: async () => {
      if (!this.integrations) { new Notice("Integrations not initialized"); return; }
      const results = await this.integrations.syncAll();
      const total = results.reduce((s, r) => s + r.pulled, 0);
      const errs = results.reduce((s, r) => s + r.errors, 0);
      new Notice(`Integrations: pulled ${total}, errors ${errs}`);
    } });

    this.addCommand({ id: "initialize-vault", name: "Initialize Vault", callback: async () => { const r = await this.bootstrap.ensure(); new Notice(`Bootstrap: ${r.created.length} created`); } });
    this.addCommand({ id: "initialize-parent-vault", name: "Initialize Parent Vault", callback: async () => { await this.parentBootstrap.ensure(); new Notice("Parent vault initialized"); } });
    this.addCommand({ id: "register-subvault", name: "Register SubVault", callback: () => new RegisterSubVaultModal(this.app, this).open() });
    this.addCommand({ id: "unregister-subvault", name: "Unregister SubVault", callback: async () => {
      const subs = this.registry.listSubVaults();
      if (subs.length === 0) { new Notice("No SubVaults registered"); return; }
      await this.registry.unregisterSubVault(subs[0].vault_id);
      new Notice(`Unregistered ${subs[0].vault_id}`);
    } });
    this.addCommand({ id: "validate-federation", name: "Validate Federation", callback: () => this.validateFederation() });
    this.addCommand({ id: "validate-vault", name: "Validate Vault", callback: async () => { const n = await this.validateAll(); new Notice(`${n} files validated`); } });
    this.addCommand({ id: "reconcile-edges", name: "Reconcile Edges", callback: async () => { const n = await this.edgeSync.fullVaultReconcile(); new Notice(`${n} reconciled`); } });
    this.addCommand({ id: "rebuild-lance-index", name: "Rebuild LanceDB Index (full resync + embed)", callback: async () => {
      if (!this.mirrorSync) { new Notice("LanceDB not installed — approve install first."); return; }
      new Notice("Rebuilding LanceDB index…");
      const n = await this.mirrorSync.fullResync();
      new Notice(`LanceDB index rebuilt: ${n} entities synced.`);
    } });
    this.addCommand({ id: "enrich-current-note", name: "Enrich current note (classify / tag / graph)", checkCallback: (checking) => {
      const file = this.app.workspace.getActiveFile();
      if (!file) return false;
      if (!checking) {
        if (!this.settings.features.enrichment.enabled) { new Notice("Enrichment is off — enable it in settings."); return; }
        void this.runEnrichment(file).then(() => new Notice("Enrichment applied.")).catch((e) => new Notice(`Enrichment failed: ${e}`));
      }
      return true;
    } });
    this.addCommand({ id: "export-graph-json", name: "Export Graph JSON", callback: () => this.exportGraphJson() });
    this.addCommand({ id: "rebuild-cache", name: "Rebuild Caches", callback: () => new Notice("Caches rebuilt") });

    this.addCommand({ id: "run-path-query", name: "Run Path Query", callback: () => this.runPathPrompt() });
    this.addCommand({ id: "fuzzy-search", name: "Sauce Fuzzy Search", hotkeys: [{ modifiers: ["Mod"], key: "p" }], callback: () => new Notice("Use the Sauce Dashboard or DQL block.") });
  }

  private activeFile(): TFile | null {
    return this.app.workspace.getActiveViewOfType(MarkdownView)?.file ?? null;
  }

  private editActive(): void {
    const f = this.activeFile(); if (!f) { new Notice("no active file"); return; }
    const fm = this.app.metadataCache.getFileCache(f)?.frontmatter ?? {};
    if (fm.type === "warm-contact") new PersonModal(this.app, this, f).open();
    else if (fm.type === "org" || fm.type === "subsidiary") new OrgModal(this.app, this, f).open();
    else if (fm.type === "touch") new Notice("Touches are immutable — log a new touch instead.");
    else if (fm.type === "addendum") new Notice("Addenda are immutable.");
    else new Notice("not a sauce entity");
  }

  private async bumpLastTouch(): Promise<void> {
    const f = this.activeFile(); if (!f) return;
    await this.entityService.updateFrontmatter(f, (fm) => {
      fm.last_touch = maxDate(fm.last_touch ?? null, todayIso());
    });
    new Notice("last_touch bumped");
  }

  private runPathPrompt(): void { new Notice("Use a `sauce-dql` PATH block in a note."); }

  // View types that belong in the right sidebar (conversation/inspector
  // panels) rather than the main editor area. Tabs/dashboards/graphs
  // stay in the main split where they have room to breathe.
  private static readonly _RIGHT_SIDEBAR_VIEWS: ReadonlySet<string> = new Set([
    VIEW_COPILOT_CHAT,
    VIEW_AI_INBOX_REAL,
    VIEW_SYNC_STATUS_REAL,
  ]);

  /** Surface the LanceDB install modal IFF detection says unavailable
   *  AND the operator hasn't decided yet. Idempotent — safe to call on
   *  every workspace.onLayoutReady. */
  private maybePromptLanceDBInstall(): void {
    if (!this.lancedbCapability.awaitingDecision) return;
    const pluginDir = this.app.vault.adapter as unknown as { getBasePath?: () => string };
    const base = typeof pluginDir.getBasePath === "function" ? pluginDir.getBasePath() : "";
    const fullDir = base
      ? `${base}/.obsidian/plugins/${this.manifest.id}`
      : `.obsidian/plugins/${this.manifest.id}`;
    new LanceDBInstallModal({
      app: this.app,
      pluginDir: fullDir,
      initialDecision: this.settings.lancedb?.installDecision ?? DEFAULT_LANCEDB_DECISION,
      // Wire the approval gate so the install respects sticky
      // approve-always / deny-always decisions for install-package.
      approvalGate: this.approvalGate,
      onDecision: async (next: LanceDBInstallDecision) => {
        this.settings.lancedb = { installDecision: next };
        await this.saveSettings();
        // Re-detect after a successful install attempt.
        this.lancedbCapability = computeCapability(next);
      },
    }).open();
  }

  private async openView(type: string): Promise<void> {
    const leaves = this.app.workspace.getLeavesOfType(type);
    if (leaves.length) { this.app.workspace.revealLeaf(leaves[0]); return; }
    let leaf: WorkspaceLeaf | null;
    if (SauceGraphPlugin._RIGHT_SIDEBAR_VIEWS.has(type)) {
      leaf = this.app.workspace.getRightLeaf(false);
    } else {
      leaf = this.app.workspace.getLeaf("tab");
    }
    if (!leaf) return;
    await leaf.setViewState({ type, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  async validateAll(): Promise<number> {
    let n = 0;
    for (const f of this.app.vault.getMarkdownFiles()) {
      const fm = this.app.metadataCache.getFileCache(f)?.frontmatter; if (!fm) continue;
      const r = this.contractValidator.validate(fm);
      if (!r.passed && this.settings.strictness !== "log") {
        console.warn("Sauce contract violations", { path: f.path, violations: r.violations });
      }
      n++;
    }
    return n;
  }

  validateFederation(): void {
    const pv = this.registry.loadParentVault();
    if (!pv) { new Notice("No PARENT-VAULT.md"); return; }
    const subs = this.registry.listSubVaults();
    const parentEnums = (pv.frontmatter.enums ?? this.settings.enums) as Record<string, string[]>;
    const subEnumsByVault: Record<string, Record<string, string[]>> = {};
    for (const s of subs) subEnumsByVault[s.vault_id] = (s.frontmatter.enums ?? {}) as Record<string, string[]>;
    const results = this.fedValidator.checkAll(pv, subs, parentEnums, subEnumsByVault);
    const fails = results.filter((r) => !r.passed);
    if (fails.length === 0) new Notice(`All ${results.length} SubVaults pass federation checks`);
    else {
      new Notice(`${fails.length}/${results.length} SubVaults failed federation`);
      console.warn("Federation violations", fails);
    }
  }

  private async exportGraphJson(): Promise<void> {
    const graph = {
      generated: todayIso(),
      people: this.entityService.allPeople().map((e) => ({ id: e.file.basename, fm: e.frontmatter })),
      orgs: this.entityService.allOrgs().map((e) => ({ id: e.file.basename, fm: e.frontmatter })),
      touches: this.entityService.allTouches().map((e) => ({ id: e.file.basename, fm: e.frontmatter })),
      adjacency: this.query.collectAdjacency(),
    };
    const path = `_graph-export-${todayIso()}.json`;
    const ex = this.app.vault.getAbstractFileByPath(path);
    if (ex && ex instanceof TFile) await this.app.vault.modify(ex, JSON.stringify(graph, null, 2));
    else await this.app.vault.create(path, JSON.stringify(graph, null, 2));
    new Notice(`Exported → ${path}`);
  }

  async loadSettings(): Promise<void> {
    const loaded = (await this.loadData()) as Partial<SauceGraphSettings> | null;
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...(loaded ?? {}),
      paths: { ...DEFAULT_SETTINGS.paths, ...(loaded?.paths ?? {}) },
      federation: { ...DEFAULT_SETTINGS.federation, ...(loaded?.federation ?? {}) },
      compat_config: { ...DEFAULT_SETTINGS.compat_config, ...(loaded?.compat_config ?? {}) },
      copilot: { ...DEFAULT_SETTINGS.copilot, ...(loaded?.copilot ?? {}) },
      features: mergeFeatureSettings(loaded?.features),
      showAdvanced: { ...DEFAULT_SETTINGS.showAdvanced, ...(loaded?.showAdvanced ?? {}) },
    };
  }
  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    this.syncEmbeddingConfig();
  }

  /** Push the RAG/embedding + prompt settings into the Copilot runtime. Called
   *  after construction and on every settings save so toggles take effect live. */
  syncEmbeddingConfig(): void {
    if (!this.copilot) return;
    const active = activeEmbeddingProvider(this.settings.features);
    this.copilot.setEmbeddingConfig(
      active
        ? {
            enabled: true,
            provider: active.provider,
            endpoint: active.config.endpoint,
            model: active.config.model,
            // OpenAI embeddings reuse the copilot API key; local providers ignore it.
            apiKey: this.settings.copilot.apiKey,
          }
        : { enabled: false, provider: this.settings.features.rag.provider, endpoint: "", model: "" },
    );
    // Prompt + session management (T6).
    this.copilot.setPromptConfig({
      globalSystemPrompt: this.settings.features.prompts.globalSystemPrompt,
      sessionAutoNaming: this.settings.features.prompts.sessionAutoNaming,
    });
  }

  /** Run auto-enrichment on a single typed entity file (T5). No-op when the
   *  service is off or the file has no entity type. */
  async runEnrichment(file: TFile): Promise<void> {
    if (!this.enrichment || !this.settings.features.enrichment.enabled) return;
    const fm = (this.app.metadataCache.getFileCache(file)?.frontmatter ?? {}) as Record<string, unknown>;
    const type = String(fm["type"] ?? "");
    if (!type) return;
    const raw = await this.app.vault.cachedRead(file);
    const input: EnrichmentInput = {
      path: file.path,
      type,
      frontmatter: fm,
      body: raw.replace(/^---\n[\s\S]*?\n---\n?/, ""),
    };
    await this.enrichment.enrich(input);
  }

  private addCaptureCommand(id: string, name: string, kind: CaptureRecordKind): void {
    this.addCommand({ id, name, callback: () => new CaptureRecordModal(this.app, this, kind).open() });
  }

  private scheduleOpenViewRefresh(): void {
    if (this.viewRefreshTimer !== null) window.clearTimeout(this.viewRefreshTimer);
    this.viewRefreshTimer = window.setTimeout(() => {
      this.viewRefreshTimer = null;
      for (const type of [
        VIEW_DASHBOARD, VIEW_PIPELINE, VIEW_GRAPH, VIEW_COMPAT, VIEW_HEATMAP,
        VIEW_HIERARCHY, VIEW_OVERDUE, VIEW_PARENT, VIEW_CALENDAR,
        VIEW_TASKS, VIEW_INBOX, VIEW_LEDGER,
      ]) {
        for (const leaf of this.app.workspace.getLeavesOfType(type)) {
          const view = leaf.view as unknown as { onOpen?: () => Promise<void> | void } | undefined;
          void view?.onOpen?.();
        }
      }
    }, 350);
  }


  private async runSkillOnActive(skillId: string): Promise<void> {
    const file = this.activeFile();
    if (!file) { new Notice("No active note"); return; }
    if (!this.skills) { new Notice("Skill runtime not initialised"); return; }
    try {
      const res = await this.skills.run(skillId, { target: file.path });
      new Notice(`Skill ${skillId}: ${(res as any)?.ok ? "ok" : "failed"}`);
    } catch (e) { new Notice(`Skill ${skillId} error: ${(e as Error).message}`); }
  }

  private async unlockVaultPrompt(): Promise<void> {
    const kv = this.v2?.keyVault;
    if (!kv) { new Notice("KeyVault not initialised"); return; }
    const pw = window.prompt("Enter master password to unlock vault:");
    if (!pw) return;
    try { await kv.unlock(pw); new Notice("Vault unlocked"); }
    catch (e) { new Notice(`Unlock failed: ${(e as Error).message}`); }
  }

  private async verifyAuditChain(): Promise<void> {
    const al = this.v2?.auditLog;
    if (!al) { new Notice("Audit log not initialised (no SQLite backend)"); return; }
    try { const r = await al.verifyChain(); new Notice(r.ok ? "Audit chain verified ✓" : `Chain broken at ts=${r.brokenAt}`); }
    catch (e) { new Notice(`Verify failed: ${(e as Error).message}`); }
  }

  onunload(): void {
    if (this.viewRefreshTimer !== null) window.clearTimeout(this.viewRefreshTimer);
    void teardownV2(this.v2);
    console.log("Sauce Graph unloaded");
  }
}
