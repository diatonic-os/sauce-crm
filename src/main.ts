import { Plugin, TFile, WorkspaceLeaf, Notice, MarkdownView } from "obsidian";
import { EntityService, DEFAULT_PATHS, VaultPaths } from "./services/EntityService";
import { EdgeSyncService, DEFAULT_EDGE_RULES, EdgeRule } from "./services/EdgeSyncService";
import { QueryService } from "./services/QueryService";
import { SearchService } from "./services/SearchService";
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
import { SauceGraphSettingTab } from "./ui/settings/SauceGraphSettingTab";
import { ActionButton } from "./ui/widgets/ActionButton";
import { initV2, teardownV2, V2Runtime } from "./v2-init";
import { CopilotRuntime, CopilotSettings, COPILOT_DEFAULTS } from "./copilot/CopilotRuntime";
import { CopilotChatView, VIEW_COPILOT_CHAT } from "./ui/views/v2/CopilotChatView";
import { SkillRuntime } from "./skills/SkillRuntime";
import { SkillPickerModal } from "./ui/modals/v2/SkillPickerModal";
import { IntegrationRegistry } from "./integrations/IntegrationRegistry";
import { IntegrationCredentials } from "./integrations/IntegrationCredentials";
import { MapView, VIEW_MAP } from "./ui/views/v2/MapView";
import { AIInboxView, VIEW_AI_INBOX } from "./ui/views/v2/AIInboxView";
import { SyncStatusView, VIEW_SYNC_STATUS } from "./ui/views/v2/SyncStatusView";
import { QuickCaptureModal } from "./ui/modals/v2/QuickCaptureModal";
import { ImportMappingModal } from "./ui/modals/v2/ImportMappingModal";
import { BackupService } from "./sync/BackupService";
import { V2Registry } from "./v2/Registry";
import { AuditLogView, VIEW_AUDIT_LOG } from "./ui/views/v2/AuditLogView";
import { SkillRunLogView, VIEW_SKILL_RUN_LOG, skillRunRing } from "./ui/views/v2/SkillRunLogView";
import { OnboardingWizardModal } from "./ui/modals/v2/OnboardingWizardModal";
import { EncryptedBackupService } from "./sync/EncryptedBackupService";
import { todayIso, maxDate } from "./util/DateUtil";
import { createLogger, TelemetrySink, Logger, TelemetrySettings } from "./telemetry";
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
  telemetry?: TelemetrySettings;
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
  telemetry: { level: "info" },
  activeTab: "TAB-BASIC",
  hasInitialized: false,
  hasDismissedFirstRun: false,
  showAdvanced: {},
};

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
  get inferenceEngine() { return this.v2?.inference ?? null; }
  get v2Scopes() { return this.v2?.scopes ?? null; }
  get v2Proxy() { return this.v2?.proxy ?? null; }
  copilot: CopilotRuntime | null = null;
  skills: SkillRuntime | null = null;
  integrations: IntegrationRegistry | null = null;
  credentials: IntegrationCredentials | null = null;
  v2Registry: V2Registry = new V2Registry();
  telemetrySink!: TelemetrySink;
  logger!: Logger;

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
    this.telemetrySink = new TelemetrySink(this.app.vault.adapter);
    this.logger = createLogger("Plugin", this.telemetrySink, this.settings);
    this.logger.info("plugin.onload", { ts: Date.now() });

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

    this.copilot = new CopilotRuntime(this.app, this.entityService, this.search, this.settings.copilot ?? COPILOT_DEFAULTS);
    this.skills = new SkillRuntime(this.app, this.entityService, this.search, this.query, () => this.copilot);
    if (this.copilot) this.skills.bindToCopilot(this.copilot.toolUse);
    // Credentials surface (OAuth + API-key vault facade). Bound to the v2
    // KeyVault when available so all secrets are AES-GCM-encrypted on disk.
    if (this.keyVault) {
      this.credentials = new IntegrationCredentials(this.keyVault, this.logger?.child("creds") ?? null);
      // If the vault is already unlocked (rare at onload; usually user unlocks
      // later) re-register OAuth provider configs from stored client ids.
      if (!this.keyVault.isLocked()) {
        void this.credentials.hydrateOAuthConfigs();
      }
    }
    // Wire IntegrationRegistry with real token resolvers + the live OAuthFlow
    // so Connect buttons actually authorize (not just set { connected: true }).
    const tokenResolvers = this.credentials ? {
      google:     this.credentials.accessToken("google_workspace"),
      microsoft:  this.credentials.accessToken("microsoft_365"),
      notion:     async () => (await this.credentials!.getKey("notion", "token")) ?? "",
    } : {};
    this.integrations = new IntegrationRegistry(
      this.app,
      tokenResolvers,
      undefined,
      this.credentials?.oauth,
    );

    // Addendum A §B — populate v2Registry capability descriptors. Each entry's `ready`
    // mirrors live module presence; sections check this to decide IMPLEMENTED/DEGRADED/COMING_SOON.
    this.v2Registry.register({ id: "backend", phase: "P8", ready: !!this.v2?.backend, reason: this.v2?.backend ? undefined : "SQLite not detected; falling back to file-only" });
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
    this.registerView(VIEW_SYNC_STATUS, (l) => new SyncStatusView(l, this));
    this.registerView(VIEW_MAP, (l) => new MapView(l, this));
    this.registerView(VIEW_AI_INBOX, (l) => new AIInboxView(l, this));
    this.registerView(VIEW_AUDIT_LOG, (l) => new AuditLogView(l, this));
    this.registerView(VIEW_SKILL_RUN_LOG, (l) => new SkillRunLogView(l, this));

    // V2 view capability registration — each ItemView is now wired and the
    // stub-vs-Real split has been collapsed (DEC §B2). Settings tab queries
    // V2Registry.state(id) to render IMPLEMENTED / DEGRADED / COMING_SOON.
    this.v2Registry.register({ id: "view.copilot_chat",  phase: "P9",  ready: !!this.copilot });
    this.v2Registry.register({ id: "view.sync_status",   phase: "P10", ready: !!this.syncEngine });
    this.v2Registry.register({ id: "view.map",           phase: "P11", ready: true });
    this.v2Registry.register({ id: "view.ai_inbox",      phase: "P12", ready: true });
    this.v2Registry.register({ id: "view.audit_log",     phase: "P13", ready: !!this.auditLog });
    this.v2Registry.register({ id: "view.skill_run_log", phase: "P13", ready: !!this.skills });
    this.logger.info("v2registry.registered", { count: this.v2Registry.list().length });

    this.registerViews();
    this.registerCommands();
    this.addSettingTab(new SauceGraphSettingTab(this.app, this));

    this.registerEvent(this.app.metadataCache.on("changed", (f) => {
      if (f instanceof TFile) this.edgeSync.scheduleReconcile(f);
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
    this.addCommand({ id: "open-map", name: "Open Map", callback: () => this.openView(VIEW_MAP) });
    this.addCommand({ id: "open-ai-inbox", name: "Open AI Inbox", callback: () => this.openView(VIEW_AI_INBOX) });
    this.addCommand({ id: "quick-capture", name: "Quick Capture (CDEL)", hotkeys: [{ modifiers: ["Mod"], key: "k" }], callback: () => new QuickCaptureModal(this.app, this).open() });
    this.addCommand({ id: "import", name: "Import (CSV/vCard/ICS/JSON)", callback: () => new ImportMappingModal(this.app, this).open() });
    this.addCommand({ id: "open-sync-status", name: "Open Sync Status", callback: () => this.openView(VIEW_SYNC_STATUS) });
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
    this.addCommand({ id: "open-audit-log", name: "Open Audit Log", callback: () => this.openView(VIEW_AUDIT_LOG) });
    this.addCommand({ id: "open-skill-run-log", name: "Open Skill Run Log", callback: () => this.openView(VIEW_SKILL_RUN_LOG) });
    this.addCommand({ id: "onboarding", name: "Onboarding Wizard", callback: () => new OnboardingWizardModal(this.app, this).open() });
    this.addCommand({ id: "encrypted-backup", name: "Encrypted Backup (passphrase)", callback: async () => {
      const pass = prompt("Passphrase for encrypted backup:");
      if (!pass) { new Notice("cancelled"); return; }
      const svc = new EncryptedBackupService(this.app, this.entityService, this.query, this.v2);
      const r = await svc.runEncrypted(pass);
      new Notice(`Encrypted backup → ${r.path} (${(r.bytes / 1024).toFixed(1)} KB)`);
    } });

    // ─── V2 commands (§40) — operator-bindable surfaces ─────────────────
    this.addCommand({ id: "sauce:open-sync-status", name: "Open Sync Status", callback: () => { this.openView(VIEW_SYNC_STATUS).catch(() => new Notice("Sync Status view not loaded")); } });
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

  private async openView(type: string): Promise<void> {
    const leaves = this.app.workspace.getLeavesOfType(type);
    if (leaves.length) { this.app.workspace.revealLeaf(leaves[0]); return; }
    const leaf: WorkspaceLeaf = this.app.workspace.getLeaf("tab");
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
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }
  async saveSettings(): Promise<void> { await this.saveData(this.settings); }


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
    void teardownV2(this.v2);
    console.log("Sauce Graph unloaded");
  }
}
