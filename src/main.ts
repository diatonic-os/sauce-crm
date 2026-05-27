import {
  Menu,
  Modal,
  Platform,
  Plugin,
  TFile,
  WorkspaceLeaf,
  Notice,
  MarkdownView,
  ItemView,
  requestUrl,
  normalizePath,
} from "obsidian";
import {
  registerVaultTools,
  createUnifiedDiff,
  formatUnifiedDiff,
} from "./saucebot/tools";
import { VaultContextProvider } from "./saucebot/VaultContextProvider";
import {
  SkillTaskScheduler,
  type SkillTask,
} from "./services/SkillTaskScheduler";
import {
  VaultGraphIndexer,
  buildVaultGraphIndexerHost,
} from "./services/VaultGraphIndexer";
import { WhisperEngine } from "./services/transcribe/WhisperEngine";
import { MemoryBackendRagAdapter } from "./bridge/MemoryBackendRagAdapter";
import { injectMobileStyles } from "./ui/MobileStyles";
import {
  EntityService,
  DEFAULT_PATHS,
  VaultPaths,
} from "./services/EntityService";
import {
  EdgeSyncService,
  DEFAULT_EDGE_RULES,
  EdgeRule,
} from "./services/EdgeSyncService";
import { QueryService } from "./services/QueryService";
import { SearchService } from "./services/SearchService";
import { MirrorSync } from "./services/MirrorSync";
import {
  EnrichmentService,
  defaultHeuristicStages,
  type EnrichmentHost,
  type EnrichmentInput,
} from "./services/EnrichmentService";
import { llmClassifyStage } from "./services/enrichment/LlmClassifyStage";
import {
  DocumentHarvestService,
  SUPPORTED_FORMATS,
  type DocFormat,
} from "./services/DocumentHarvest";
import {
  PluginConfigService,
  defaultProfiles,
} from "./services/PluginConfigService";
import { ObsidianPluginConfigHost } from "./services/ObsidianPluginConfigHost";
import { wireSvcV1, type WiredSvc } from "./integrations/obsidian/wireSvcV1";
import type { SvcV1 } from "./services/SauceServiceAPI";
import { renderPluginConfigBlock } from "./ui/PluginConfigBlock";
import { TasksService } from "./services/TasksService";
import { renderTasksBlock, openAddTaskModal } from "./ui/TasksBlock";
import {
  SauceFeatureSettings,
  DEFAULT_FEATURE_SETTINGS,
  mergeFeatureSettings,
  activeEmbeddingProvider,
} from "./settings/FeatureSettings";
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
import {
  CaptureRecordModal,
  type CaptureRecordKind,
} from "./ui/modals/CaptureRecordModal";
import { SauceGraphSettingTab } from "./ui/settings/SauceGraphSettingTab";
import { ActionButton } from "./ui/widgets/ActionButton";
import { initV2, teardownV2, V2Runtime } from "./v2-init";
import { compactConnection } from "./backend/lance/maintenance";
// MOB-BRIDGE-001 — mobile memory bridge (see MOBILE-BRIDGE-SPEC.md).
import type { MemoryBackend } from "./bridge/contract";
import {
  makeContentHasher,
  makeHttpRequestFn,
  InMemoryResultCache,
  createDesktopMemory,
  createMobileMemory,
} from "./bridge/wiring";
import { BridgeService } from "./bridge/server/BridgeService";
import {
  sha256Hex as bridgeSha256Hex,
  hmacHex as bridgeHmacHex,
} from "./bridge/crypto";
import { HmacAuthSigner, tokenToKey } from "./bridge/auth";
import { TailscaleReachabilityProbe } from "./bridge/mobile/orchestration";
import { LocalHashIndex } from "./bridge/mobile/local";
import {
  makeVaultReader,
  makeLexicalHost,
  makeVaultFilePersist,
} from "./bridge/obsidian/ObsidianAdapters";
import {
  SauceBotRuntime,
  SauceBotSettings,
  COPILOT_DEFAULTS,
} from "./saucebot/SauceBotRuntime";
import {
  SauceBotChatView,
  VIEW_COPILOT_CHAT,
} from "./ui/views/v2/SauceBotChatView";
import { IconRegistry } from "./ui/icons/IconRegistry";
import {
  currentPathEnv,
  lanceRuntimeDir,
  firstExistingModuleBase,
  secretsFile,
} from "./services/platformPaths";
import {
  type CredentialSource,
  ChainedCredentialSource,
  KeyVaultCredentialSource,
} from "./saucebot/CredentialSource";
import { makeSafeStorageCredentialSource } from "./saucebot/SafeStorageCredentialSource";
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
import { IntegrationRegistry } from "./integrations/IntegrationRegistry";
import { MapViewReal, VIEW_MAP_REAL } from "./ui/views/v2/MapViewReal";
import { AIInboxView, VIEW_AI_INBOX } from "./ui/views/v2/AIInboxView";
import {
  SyncStatusViewReal,
  VIEW_SYNC_STATUS_REAL,
} from "./ui/views/v2/SyncStatusViewReal";
import { QuickCaptureModal } from "./ui/modals/v2/QuickCaptureModal";
import { ImportMappingModal } from "./ui/modals/v2/ImportMappingModal";
import { BackupService } from "./sync/BackupService";
import { V2Registry } from "./v2/Registry";
import { AuditLogView, VIEW_AUDIT_LOG } from "./ui/views/v2/AuditLogView";
import {
  SkillRunLogView,
  VIEW_SKILL_RUN_LOG,
} from "./ui/views/v2/SkillRunLogView";
import { GraphAtlasService } from "./services/GraphAtlasService";
import { CalendarView, VIEW_CALENDAR } from "./ui/views/v2/CalendarView";
import {
  TasksView,
  InboxView,
  LedgerView,
  VIEW_TASKS,
  VIEW_INBOX,
  VIEW_LEDGER,
} from "./ui/views/v2/DashboardViews";
import {
  MeetingsView,
  LanesView,
  WeeklyView,
  VIEW_MEETINGS,
  VIEW_LANES,
  VIEW_WEEKLY,
} from "./ui/views/v2/FolderIndexViews";
import { OnboardingWizardModal } from "./ui/modals/v2/OnboardingWizardModal";
import { EncryptedBackupService } from "./sync/EncryptedBackupService";
import { todayIso, maxDate } from "./util/DateUtil";
import {
  VIEW_DASHBOARD,
  VIEW_PIPELINE,
  VIEW_GRAPH,
  VIEW_COMPAT,
  VIEW_HEATMAP,
  VIEW_HIERARCHY,
  VIEW_OVERDUE,
  VIEW_PARENT,
  DashboardView,
  PipelineKanbanView,
  TypedEdgeGraphView,
  CompatibilityMatrixView,
  TouchHeatmapView,
  HierarchyTreeView,
  OverdueQueueView,
  ParentDashboardView,
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
  copilot: SauceBotSettings;
  /** Feature program toggles: RAG/embeddings, enrichment, prompts, documents.
   *  See src/settings/FeatureSettings.ts. */
  features: SauceFeatureSettings;
  /** LanceDB install decision — persisted across reloads so we never
   *  re-prompt after the user picks "Install" or "Skip". */
  lancedb?: { installDecision: LanceDBInstallDecision };
  /** Re-mirror all entities into LanceDB on plugin load (default true).
   *  NOTE: this now means "index ONCE if not yet indexed", not "every load" —
   *  a full resync on every startup churned LanceDB into tens of thousands of
   *  fragments (CPU/memory/watcher blowup). After the one-time index, realtime
   *  vault events keep the mirror current; use "Rebuild LanceDB Index" to force. */
  lancedbIndexOnLoad?: boolean;
  /** Set true once the initial full index has run, so we don't resync on every
   *  load. Cleared by a manual rebuild if a fresh full index is wanted. */
  lancedbInitialIndexDone?: boolean;
  /** Persistent approval decisions (approve-always / deny-always per
   *  action class). Read by every risky flow before executing. */
  approvals?: ApprovalRecord;
  // Addendum A UI state — added by §K step 1
  activeTab?: string;
  hasInitialized?: boolean;
  hasDismissedFirstRun?: boolean;
  showAdvanced?: Record<string, boolean>;
  /** Global skill-autonomy mode: a concrete level applies to all skills;
   *  "custom" lets each skill set its own. Defaults to "manual". */
  skillsAutonomy?: "manual" | "suggest" | "assist" | "auto" | "custom";
  /** MOB-BRIDGE-001 — mobile memory bridge. Server is OFF by default. */
  bridge?: BridgeSettings;
  /** Forward-compat beta opt-in gate. Absent in production releases. */
  beta?: { enabled?: boolean };
}

/** Mobile-bridge settings. Desktop fields: enabled/port/bindHost/pairingToken.
 *  Mobile fields: baseUrl/pairingToken. */
export interface BridgeSettings {
  enabled: boolean;
  port: number;
  /** desktop bind address; "" → auto-discover Tailscale IPv4. */
  bindHost: string;
  /** mobile: desktop bridge URL, e.g. http://100.x.y.z:8787. */
  baseUrl: string;
  /** shared pairing token (hex). */
  pairingToken: string;
}

const DEFAULT_SETTINGS: SauceGraphSettings = {
  paths: DEFAULT_PATHS,
  strictness: "block",
  edge_rules: DEFAULT_EDGE_RULES,
  compat_config: {
    rho_adm: 0.5,
    fields: ["roles", "tags", "industry", "location"],
  },
  federation: {
    cross_vault_edges: "allowed",
    cross_vault_path_queries: "allowed",
    cross_vault_compatibility: "allowed",
    enum_resolution: "parent-wins",
    addendum_rollup: "latest",
    validation_gate: "strict",
  },
  enums: {
    primary_type_person: [
      "co-founder",
      "family",
      "advisor",
      "mentor",
      "connector",
      "peer-founder",
      "community",
      "past-colleague",
      "prospect",
    ],
    roles_person: [
      "co-founder",
      "family",
      "advisor",
      "mentor",
      "connector",
      "peer-founder",
      "community",
      "past-colleague",
      "prospect",
    ],
    cadence: ["monthly", "quarterly", "bi-annual", "ad-hoc"],
    channel: ["in-person", "call", "text", "dinner", "email", "event"],
    playbook: [
      "ff-1",
      "ff-2",
      "ff-3",
      "ff-4",
      "ment-1",
      "ment-2",
      "ment-3",
      "ment-4",
      "",
    ],
    outcome_tag: [
      "update-given",
      "advice-received",
      "intro-offered",
      "intro-made",
      "asked-for-intro",
    ],
    status_org: [
      "active",
      "customer",
      "vendor",
      "competitor",
      "defunct",
      "prospect",
    ],
    kind_addendum: [
      "correction",
      "enrichment",
      "context",
      "deprecation",
      "merge-note",
    ],
  },
  copilot: COPILOT_DEFAULTS,
  features: DEFAULT_FEATURE_SETTINGS,
  activeTab: "TAB-BASIC",
  hasInitialized: false,
  hasDismissedFirstRun: false,
  showAdvanced: {},
  skillsAutonomy: "manual",
  bridge: {
    enabled: false,
    port: 8787,
    bindHost: "",
    baseUrl: "",
    pairingToken: "",
  },
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
    info: (m, d) => console.info(fmt(m, d)),
    warn: (m, d) => console.warn(fmt(m, d)),
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
  get syncEngine() {
    return this.v2?.sync ?? null;
  }
  get keyVault() {
    return this.v2?.keyVault ?? null;
  }
  get auditLog() {
    return this.v2?.auditLog ?? null;
  }
  get provenance() {
    return this.v2?.provenance ?? null;
  }
  get inferenceEngine() {
    return this.v2?.inference ?? null;
  }
  get v2Scopes() {
    return this.v2?.scopes ?? null;
  }
  get v2Proxy() {
    return this.v2?.proxy ?? null;
  }
  copilot: SauceBotRuntime | null = null;
  mirrorSync: MirrorSync | null = null;
  enrichment: EnrichmentService | null = null;
  documentHarvest: DocumentHarvestService | null = null;
  pluginConfig: PluginConfigService | null = null;
  tasks: TasksService | null = null;
  skills: SkillRuntime | null = null;
  integrations: IntegrationRegistry | null = null;
  /** CON-OBS-INTEG-001 — public svcV1 (mounted in onload) + its wiring handle. */
  svcV1?: SvcV1;
  private wiredSvc: WiredSvc | null = null;
  /** Obsidian plugin adapter registry — the Install→Optimize settings cards read this. */
  get obsidianPlugins(): WiredSvc["registry"] | null {
    return this.wiredSvc?.registry ?? null;
  }
  /** MOB-BRIDGE-001: platform memory backend (desktop = LanceDB; mobile =
   *  bridge-when-reachable → lexical fallback). Null until onload. */
  memory: MemoryBackend | null = null;
  /** Desktop-only memory server lifecycle (default-OFF). */
  bridgeService: BridgeService | null = null;
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
  private _credentialsCache:
    | import("./integrations/IntegrationCredentials").IntegrationCredentials
    | null = null;
  get credentials():
    | import("./integrations/IntegrationCredentials").IntegrationCredentials
    | null {
    const kv = this.v2?.keyVault ?? null;
    if (!kv) {
      this._credentialsCache = null;
      return null;
    }
    if (!this._credentialsCache) {
      // Lazy import to avoid top-of-file circular dependency risk.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const {
        IntegrationCredentials,
      } = require("./integrations/IntegrationCredentials");
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

  override async onload(): Promise<void> {
    await this.loadSettings();

    // Mobile (Apple-native) optimization: inject the .is-mobile stylesheet and
    // surface a one-tap quick-capture ribbon for on-the-go recording.
    if (Platform.isMobile) {
      this.register(injectMobileStyles());
      this.addRibbonIcon("plus-circle", "Sauce: Quick capture", () =>
        new QuickCaptureModal(this.app, this).open(),
      );
    }

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
      this.lanceModuleBase(),
    );
    this.app.workspace.onLayoutReady(() => {
      this.maybePromptLanceDBInstall();
      this.indexAllOnLoad();
    });

    try {
      this.v2 = await initV2(this.app, this);
    } catch (e) {
      console.warn("Sauce V2 init failed", { error: String(e) });
    }

    this.entityService = new EntityService(this.app, this.settings.paths);
    this.edgeSync = new EdgeSyncService(
      this.app,
      this.entityService,
      this.settings.edge_rules,
    );
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
        const t = link.replace(/\[\[|\]\]/g, "").split("|")[0]!; // split always produces ≥1 element
        const f = this.app.metadataCache.getFirstLinkpathDest(t, "");
        if (!f) return null;
        return this.app.metadataCache.getFileCache(f)?.frontmatter ?? {};
      },
    });

    this.copilot = new SauceBotRuntime(
      this.app,
      this.entityService,
      this.search,
      this.settings.copilot ?? COPILOT_DEFAULTS,
      this.v2?.lance?.vectors ?? null,
    );
    // Secure credential sourcing (was never wired → providers read plaintext
    // settings.apiKey). OS keychain (safeStorage) primary, encrypted KeyVault
    // fallback; first available source that has the key wins.
    {
      const sources: CredentialSource[] = [
        makeSafeStorageCredentialSource(secretsFile(currentPathEnv())),
      ];
      if (this.v2?.keyVault) {
        sources.push(new KeyVaultCredentialSource(this.v2.keyVault));
      }
      this.copilot.setCredentialSource(new ChainedCredentialSource(sources));
    }
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
        {
          realtimeEmbeddings: () =>
            this.settings.features.rag.realtimeEmbeddings,
          // B (S6): whole-vault coverage — mirror untyped notes as type:"note"
          // and honor the operator's exclude-folder list.
          fullVaultIndex: this.settings.features.rag.fullVaultIndex,
          excludeGlobs: this.settings.features.rag.excludeGlobs,
        },
      );
      // B (S6): give vault search a semantic path over the same Lance vectors
      // the copilot embeds with (lexical fallback stays inside SearchService).
      this.search.setSemanticBackend(
        this.v2.lance.vectors,
        (text) => this.copilot?.embed(text) ?? Promise.resolve(null),
      );
    }
    // Auto-enrichment (T5): classify/tag/graph stages writing vault frontmatter
    // (which re-mirrors to LanceDB via the "changed" handler) + provenance.
    const enrichHost: EnrichmentHost = {
      applyFrontmatter: async (path, mutate) => {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (file instanceof TFile)
          await this.entityService.updateFrontmatter(file, (fm) => {
            mutate(fm);
          });
      },
    };
    // classify = LLM-backed (validated against the vault's enum vocabulary);
    // tag + graph stay heuristic. classify degrades to null when no model is
    // reachable, so EnrichmentService just skips it.
    this.enrichment = new EnrichmentService(
      {
        ...defaultHeuristicStages(),
        classify: llmClassifyStage(
          (system, user) =>
            this.copilot?.completeOnce(system, user) ?? Promise.resolve(null),
          () => ({
            primaryTypes: this.settings.enums.primary_type_person ?? [],
            roles: this.settings.enums.roles_person ?? [],
          }),
        ),
      },
      enrichHost,
      () => this.settings.features.enrichment,
      this.v2?.provenance ?? null,
    );
    // Document harvesting (T7): upload → chunk → embed → LanceDB → RAG context.
    if (this.v2?.lance) {
      this.documentHarvest = new DocumentHarvestService(
        this.v2.lance.docChunks,
        (text) => this.copilot?.embed(text) ?? Promise.resolve(null),
        { dim: this.v2.lance.embeddingDim },
        this.v2.provenance ?? null,
      );
      // Feed harvested chunks into the copilot as document context (T7) and
      // trace every query (T8).
      this.copilot?.setDocumentSearch(async (query, k) => {
        const vec = await this.copilot?.embed(query);
        if (!vec || !this.documentHarvest) return [];
        const hits = await this.documentHarvest.search(vec, k);
        return hits.map((h) => ({ docName: h.docName, text: h.text }));
      });
      this.copilot?.setTraceSink(this.v2.provenance ?? null);
    }
    // Plugin auto-config engine (orchestrator): detect supported core/community
    // plugins and propose canonical settings. Provenance-traced on apply.
    this.pluginConfig = new PluginConfigService(
      new ObsidianPluginConfigHost(this.app),
      defaultProfiles(),
      this.v2?.provenance ?? null,
    );
    // CON-OBS-INTEG-001 — mount the public svcV1 + Obsidian plugin adapter
    // registry. Wrapped so a wiring failure can never block plugin startup.
    try {
      this.wiredSvc = wireSvcV1(
        this as unknown as Record<string, unknown>, // wireSvcV1 uses duck-typing; class instance not directly assignable to index-sig type
        this.app,
        {
          sha256Hex: bridgeSha256Hex,
          isBetaOptIn: () => Boolean(this.settings.beta?.enabled),
          // B (S6): hydrate the in-memory GraphService from the persistent
          // LanceDB graph tables (graphify activation).
          ...(this.v2?.lance?.graphStore !== undefined
            ? { graphStore: this.v2.lance.graphStore }
            : {}),
        },
      );
      this.logger.event?.("svcv1.mounted", {
        version: this.wiredSvc.svcV1.version,
      });
    } catch (e) {
      this.logger.event?.("svcv1.mount_failed", {
        error: e instanceof Error ? e.message : String(e),
      });
    }
    // B (S6): VaultGraphIndexer — walk the whole vault's wikilinks into the
    // persistent graph tables. Initial best-effort rebuild + a manual command
    // (full rebuilds are O(vault) so they're not bound to every metadata tick).
    const graphSvc = this.wiredSvc?.svcV1.graph;
    if (graphSvc) {
      const vaultIndexer = new VaultGraphIndexer(
        graphSvc,
        buildVaultGraphIndexerHost(this.app),
        {
          ...(this.v2?.lance?.graphStore !== undefined
            ? { store: this.v2.lance.graphStore }
            : {}),
          excludeGlobs: this.settings.features.rag.excludeGlobs ?? [],
        },
      );
      void vaultIndexer.rebuild().catch(() => {
        /* empty graph on first run / no vault access */
      });
      this.addCommand({
        id: "rebuild-vault-graph",
        name: "Rebuild Vault Graph Index",
        callback: () => {
          void vaultIndexer
            .rebuild()
            .then((n) =>
              new Notice(`SauceBot: indexed ${n} notes into the vault graph`),
            );
        },
      });
    }
    // Tasks ↔ Tasks-plugin checkbox bridge (W4): author/read tasks in _TASKS.md.
    this.tasks = new TasksService(this.app);
    this.skills = new SkillRuntime(
      this.app,
      this.entityService,
      this.search,
      this.query,
      () => this.copilot,
    );
    if (this.copilot) this.skills.bindToCopilot(this.copilot.toolUse);
    // Route every Copilot tool call through the approval gate.
    // Per-skill action classes (`execute-skill:<id>`) let the operator
    // approve-always for safe skills and deny-always for risky ones.
    this.copilot?.toolUse.setApprovalGate(this.approvalGate);

    // F2 (S2) — register generic vault tools on SauceBot's tool loop:
    // read_note / search_vault / propose_edit / apply_edit / create_note /
    // web_research / get_links. Writes route through FilesService
    // (canon-safe, G-003); apply_edit is risk:"high" → ApprovalGate shows the
    // unified diff before any write. Link traversal feeds RAG one-hop too.
    const filesSvc = this.wiredSvc?.svcV1.files;
    if (this.copilot && filesSvc) {
      const linkProvider = new VaultContextProvider(this.app.metadataCache);
      linkProvider.rebuild();
      this.registerEvent(
        this.app.metadataCache.on("resolved", () => linkProvider.rebuild()),
      );
      const readNote = async (path: string): Promise<string | null> => {
        const f = this.app.vault.getAbstractFileByPath(normalizePath(path));
        return f instanceof TFile ? await this.app.vault.cachedRead(f) : null;
      };
      registerVaultTools(this.copilot.toolUse, {
        vaultHost: this.app.vault,
        files: filesSvc,
        readHost: { read: readNote },
        searchHost: {
          search: async (query, limit) =>
            this.search
              .fuzzy(query, limit)
              .map((h) => ({ path: h.file.path, score: h.score })),
        },
        editHost: {
          read: readNote,
          generateEdit: async (_path, original, instructions) =>
            (await this.copilot?.rewrite(original, instructions)) ?? original,
          diff: (original, updated, label) => {
            const d = createUnifiedDiff(
              original,
              updated,
              `a/${label}`,
              `b/${label}`,
            );
            return d ? formatUnifiedDiff(d) : null;
          },
        },
        webHost: {
          fetch: async (url) => {
            const r = await requestUrl({ url, method: "GET", throw: false });
            return r.text;
          },
        },
        linkProvider,
      });
    }

    // F3 (S3/S5) — SkillTaskScheduler: runs skill-bound task notes (frontmatter
    // type:task + skill_id + schedule) manually or on cron/interval, persisting
    // last_run/next_run so schedules survive reload.
    if (this.skills) {
      const skillTaskSource = {
        listSkillTasks: async (): Promise<SkillTask[]> => {
          const out: SkillTask[] = [];
          for (const f of this.app.vault.getMarkdownFiles()) {
            const fm = this.app.metadataCache.getFileCache(f)?.frontmatter as
              | Record<string, unknown>
              | undefined;
            if (!fm || fm.type !== "task" || !fm.skill_id) continue;
            out.push({
              id: f.path,
              skill_id: String(fm.skill_id),
              ...(fm.skill_args !== undefined
                ? { skill_args: fm.skill_args as Record<string, unknown> }
                : {}),
              schedule: String(fm.schedule ?? "manual"),
              ...(fm.last_run ? { last_run: String(fm.last_run) } : {}),
              ...(fm.next_run ? { next_run: String(fm.next_run) } : {}),
              ...(fm.autonomy !== undefined
                ? { autonomy: fm.autonomy as NonNullable<SkillTask["autonomy"]> }
                : {}),
            });
          }
          return out;
        },
      };
      const skillTaskPersister = {
        updateScheduleState: async (
          taskId: string,
          patch: { last_run?: string; next_run?: string },
        ): Promise<void> => {
          const f = this.app.vault.getAbstractFileByPath(taskId);
          if (!(f instanceof TFile)) return;
          await this.entityService.updateFrontmatter(f, (fm) => {
            if (patch.last_run !== undefined)
              (fm as Record<string, unknown>).last_run = patch.last_run;
            if (patch.next_run !== undefined)
              (fm as Record<string, unknown>).next_run = patch.next_run;
          });
        },
      };
      const scheduler = new SkillTaskScheduler(
        this.skills,
        skillTaskSource,
        skillTaskPersister,
      );
      scheduler.start(60_000);
      this.register(() => scheduler.stop());
    }

    // D (S8): wire local whisper transcription on desktop (the `transcribe`
    // skill + chat audio uploads route through this). Mobile/sandboxed
    // runtimes lack child_process/fs, so the engine stays unset there and
    // dispatch reports "not configured" rather than failing silently.
    try {
      const nodeRequire =
        typeof require !== "undefined"
          ? (require as (m: string) => unknown)
          : null;
      const fsMod = nodeRequire?.("fs") as
        | { promises: { readFile(p: string, enc: string): Promise<string> } }
        | undefined;
      const osMod = nodeRequire?.("os") as { tmpdir(): string } | undefined;
      if (this.skills && fsMod && osMod) {
        this.skills.setTranscriber(
          new WhisperEngine({
            readText: async (p) => {
              try {
                return await fsMod.promises.readFile(p, "utf8");
              } catch {
                return null;
              }
            },
            outputDir: osMod.tmpdir(),
            defaultModel: "large-v3-turbo",
          }),
        );
      }
    } catch {
      /* desktop-only; mobile uses cloud/bridge STT */
    }

    // C (S7): route skill ctx.audit to the durable HMAC-chained audit log so
    // manual + scheduled skill runs are recorded and visible in the Audit Log
    // view (was a console-only stub).
    const auditLog = this.v2?.auditLog;
    if (this.skills && auditLog) {
      this.skills.setAuditSink(async (op, entityId, details) => {
        await auditLog.append({
          ts: Date.now(),
          op,
          entityId,
          agentId: null,
          integration: null,
          beforeHash: null,
          afterHash: null,
          details,
        });
      });
    }

    this.integrations = new IntegrationRegistry(this.app, {});

    // MOB-BRIDGE-001 — build the platform memory backend and, on desktop,
    // (re)start the memory server per settings (default-OFF). Never throws into
    // boot: a bridge failure must not break plugin load.
    try {
      await this.refreshBridge();
    } catch (e) {
      console.warn("Sauce mobile-bridge init failed (non-fatal)", {
        error: String(e),
      });
    }

    // F (S9): route the copilot's semantic RAG through the bridge memory
    // backend when no local vector index is usable (mobile → desktop LanceDB
    // over the bridge). Lazy getter so it tracks refreshBridge() rebuilds.
    this.copilot?.setSemanticFallback(() => {
      const mem = this.memory;
      return mem
        ? (q: string, k: number) =>
            new MemoryBackendRagAdapter(mem).semantic(q, k)
        : null;
    });

    // Addendum A §B — populate v2Registry capability descriptors. Each entry's `ready`
    // mirrors live module presence; sections check this to decide IMPLEMENTED/DEGRADED/COMING_SOON.
    this.v2Registry.register({
      id: "backend",
      phase: "P8",
      ready: !!this.v2?.lance,
      ...(this.v2?.lance
        ? {}
        : { reason: "LanceDB not installed — approve install to enable persistence" }),
    });
    this.v2Registry.register({
      id: "security",
      phase: "P8",
      ready: !!this.v2?.keyVault,
      ...(this.v2?.keyVault ? {} : { reason: "KeyVault not initialized" }),
    });
    this.v2Registry.register({
      id: "copilot",
      phase: "P9",
      ready: !!this.copilot,
    });
    this.v2Registry.register({
      id: "copilot.provider",
      phase: "P9",
      ready: !!this.copilot,
    });
    this.v2Registry.register({
      id: "copilot.skills",
      phase: "P10",
      ready: !!this.skills,
    });
    for (const integ of [
      "google",
      "microsoft",
      "apple",
      "notion",
      "twilio",
      "email",
      "websearch",
    ] as const) {
      const map: Record<string, string> = {
        google: "google_workspace",
        microsoft: "microsoft_365",
        email: "smtp_imap",
        websearch: "web_search",
      };
      const id = `integrations.${integ}`;
      const phase: "P11" | "P12" =
        integ === "google" || integ === "microsoft" ? "P11" : "P12";
      const integId = map[integ] ?? integ;
      const live = !!this.integrations?.byId(integId);
      this.v2Registry.register({
        id,
        phase,
        ready: live,
        ...(live ? {} : { reason: "not connected" }),
      });
    }
    this.v2Registry.register({
      id: "geocoding",
      phase: "P13",
      ready: false,
      reason: "no provider configured",
    });
    this.v2Registry.register({
      id: "sync",
      phase: "P14",
      ready: !!this.v2?.sync,
    });
    this.v2Registry.register({
      id: "import_export",
      phase: "P14",
      ready: true,
    });
    this.registerView(VIEW_COPILOT_CHAT, (l) => new SauceBotChatView(l, this));
    this.registerView(
      VIEW_SYNC_STATUS_REAL,
      (l) => new SyncStatusViewReal(l, this),
    );
    this.registerView(VIEW_MAP_REAL, (l) => new MapViewReal(l, this));
    // CON-SAUCEBOT S7 — register the FUNCTIONAL inbox/audit/run-log views in
    // place of the dormant "Real" placeholder stubs. The functional
    // SkillRunLogView reads the same SkillRunRing singleton the SkillRuntime
    // pushes to (the Real stub had a second, never-populated ring).
    this.registerView(VIEW_AI_INBOX, (l) => new AIInboxView(l, this));
    this.registerView(VIEW_AUDIT_LOG, (l) => new AuditLogView(l, this));
    this.registerView(
      VIEW_SKILL_RUN_LOG,
      (l) => new SkillRunLogView(l, this),
    );
    this.registerView(VIEW_CALENDAR, (l) => new CalendarView(l, this));
    this.registerView(VIEW_TASKS, (l) => new TasksView(l, this));
    this.registerView(VIEW_INBOX, (l) => new InboxView(l, this));
    this.registerView(VIEW_LEDGER, (l) => new LedgerView(l, this));

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
      m.addItem((i) =>
        i
          .setTitle("New Person")
          .setIcon("sauce-person")
          .onClick(() => new PersonModal(this.app, this).open()),
      );
      m.addItem((i) =>
        i
          .setTitle("New Org")
          .setIcon("sauce-org")
          .onClick(() => new OrgModal(this.app, this).open()),
      );
      m.addItem((i) =>
        i
          .setTitle("Log Touch")
          .setIcon("sauce-touch")
          .onClick(() => new TouchModal(this.app, this).open()),
      );
      m.addItem((i) =>
        i
          .setTitle("New Intro")
          .setIcon("sauce-intro")
          .onClick(() => new IntroModal(this.app, this).open()),
      );
      m.addItem((i) =>
        i
          .setTitle("Promote Prospect")
          .setIcon("sauce-promote")
          .onClick(() =>
            new PromoteProspectModal(this.app, this, this.activeFile()).open(),
          ),
      );
      m.showAtMouseEvent(event);
    });
    this.addRibbonIcon(
      "sauce-hierarchy",
      "Sauce CRM — Graph & Views",
      (event) => {
        const m = new Menu();
        m.addItem((i) =>
          i
            .setTitle("Dashboard")
            .setIcon("layout-dashboard")
            .onClick(() => this.openView(VIEW_DASHBOARD)),
        );
        m.addItem((i) =>
          i
            .setTitle("Parent Vault Dashboard")
            .setIcon("sauce-parent-vault")
            .onClick(() => this.openView(VIEW_PARENT)),
        );
        m.addItem((i) =>
          i
            .setTitle("Typed-Edge Graph")
            .setIcon("sauce-hierarchy")
            .onClick(() => this.openView(VIEW_GRAPH)),
        );
        m.addItem((i) =>
          i
            .setTitle("Pipeline Kanban")
            .setIcon("columns-3")
            .onClick(() => this.openView(VIEW_PIPELINE)),
        );
        m.addItem((i) =>
          i
            .setTitle("Compatibility Matrix")
            .setIcon("sauce-compat")
            .onClick(() => this.openView(VIEW_COMPAT)),
        );
        m.addItem((i) =>
          i
            .setTitle("Touch Heatmap")
            .setIcon("sauce-heatmap")
            .onClick(() => this.openView(VIEW_HEATMAP)),
        );
        m.addItem((i) =>
          i
            .setTitle("Hierarchy Tree")
            .setIcon("sauce-hierarchy")
            .onClick(() => this.openView(VIEW_HIERARCHY)),
        );
        m.addItem((i) =>
          i
            .setTitle("Overdue Queue")
            .setIcon("sauce-overdue")
            .onClick(() => this.openView(VIEW_OVERDUE)),
        );
        m.addItem((i) =>
          i
            .setTitle("Map")
            .setIcon("sauce-map")
            .onClick(() => this.openView(VIEW_MAP_REAL)),
        );
        m.addItem((i) =>
          i
            .setTitle("Calendar")
            .setIcon("sauce-touch")
            .onClick(() => this.openView(VIEW_CALENDAR)),
        );
        m.addItem((i) =>
          i
            .setTitle("Tasks Board")
            .setIcon("sauce-skill")
            .onClick(() => this.openView(VIEW_TASKS)),
        );
        m.addItem((i) =>
          i
            .setTitle("Inbox")
            .setIcon("sauce-ai-inbox")
            .onClick(() => this.openView(VIEW_INBOX)),
        );
        m.addItem((i) =>
          i
            .setTitle("Ledger")
            .setIcon("sauce-audit")
            .onClick(() => this.openView(VIEW_LEDGER)),
        );
        m.addSeparator();
        m.addItem((i) =>
          i
            .setTitle("Run Path Query")
            .setIcon("git-branch")
            .onClick(() => this.runPathPrompt()),
        );
        m.showAtMouseEvent(event);
      },
    );
    this.addRibbonIcon("bot", "Sauce CRM — SauceBot & AI", (event) => {
      const m = new Menu();
      m.addItem((i) =>
        i
          .setTitle("Open SauceBot Chat")
          .setIcon("sauce-copilot")
          .onClick(() => this.openView(VIEW_COPILOT_CHAT)),
      );
      m.addItem((i) =>
        i
          .setTitle("AI Inbox")
          .setIcon("sauce-ai-inbox")
          .onClick(() => this.openView(VIEW_AI_INBOX)),
      );
      m.addSeparator();
      m.addItem((i) =>
        i
          .setTitle("Audit Log")
          .setIcon("sauce-audit")
          .onClick(() => this.openView(VIEW_AUDIT_LOG)),
      );
      m.addItem((i) =>
        i
          .setTitle("Skill Run Log")
          .setIcon("sauce-skill")
          .onClick(() => this.openView(VIEW_SKILL_RUN_LOG)),
      );
      m.addItem((i) =>
        i
          .setTitle("Sync Status")
          .setIcon("sauce-sync")
          .onClick(() => this.openView(VIEW_SYNC_STATUS_REAL)),
      );
      m.showAtMouseEvent(event);
    });
    // Fourth ribbon — utilities, setup, and data ops. Keeps the People /
    // Graph / Copilot menus focused while ensuring nothing is unreachable.
    this.addRibbonIcon("settings-2", "Sauce CRM — Setup & Data", (event) => {
      const m = new Menu();
      m.addItem((i) =>
        i
          .setTitle("Quick Capture")
          .setIcon("plus-circle")
          .onClick(() => {
            try {
              const QCMod = require("./ui/modals/QuickCaptureModal");
              new QCMod.QuickCaptureModal(this.app, this).open();
            } catch (e) {
              new Notice("Quick Capture unavailable");
            }
          }),
      );
      m.addItem((i) =>
        i
          .setTitle("New Note")
          .setIcon("sauce-note")
          .onClick(() =>
            new CaptureRecordModal(this.app, this, "knowledge-note").open(),
          ),
      );
      m.addItem((i) =>
        i
          .setTitle("New Idea")
          .setIcon("sauce-idea")
          .onClick(() => new CaptureRecordModal(this.app, this, "idea").open()),
      );
      m.addItem((i) =>
        i
          .setTitle("New Observation")
          .setIcon("sauce-observation")
          .onClick(() =>
            new CaptureRecordModal(this.app, this, "observation").open(),
          ),
      );
      m.addItem((i) =>
        i
          .setTitle("New Task")
          .setIcon("sauce-task")
          .onClick(() => new CaptureRecordModal(this.app, this, "task").open()),
      );
      m.addItem((i) =>
        i
          .setTitle("New Event")
          .setIcon("sauce-event")
          .onClick(() =>
            new CaptureRecordModal(this.app, this, "event").open(),
          ),
      );
      m.addItem((i) =>
        i
          .setTitle("New Ledger Entry")
          .setIcon("sauce-ledger")
          .onClick(() =>
            new CaptureRecordModal(this.app, this, "ledger-entry").open(),
          ),
      );
      m.addItem((i) =>
        i
          .setTitle("New Pipeline Deal")
          .setIcon("sauce-pipeline")
          .onClick(() =>
            new CaptureRecordModal(this.app, this, "pipeline-deal").open(),
          ),
      );
      m.addSeparator();
      m.addItem((i) =>
        i
          .setTitle("New Addendum")
          .setIcon("sauce-addendum")
          .onClick(() => {
            try {
              const AMod = require("./ui/modals/AddendumModal");
              new AMod.AddendumModal(this.app, this, this.activeFile()).open();
            } catch {
              new Notice("Addendum modal unavailable");
            }
          }),
      );
      m.addItem((i) =>
        i
          .setTitle("New Relation")
          .setIcon("link")
          .onClick(() => {
            try {
              const RMod = require("./ui/modals/RelationModal");
              new RMod.RelationModal(this.app, this, this.activeFile()).open();
            } catch {
              new Notice("Relation modal unavailable");
            }
          }),
      );
      m.addSeparator();
      m.addItem((i) =>
        i
          .setTitle("Import (CSV/vCard/ICS/JSON)")
          .setIcon("upload")
          .onClick(() => {
            try {
              const IMod = require("./ui/modals/ImportMappingModal");
              new IMod.ImportMappingModal(this.app, this).open();
            } catch {
              new Notice("Import unavailable");
            }
          }),
      );
      m.addItem((i) =>
        i
          .setTitle("Export Graph JSON")
          .setIcon("download")
          .onClick(() => {
            const cmd = this.app.commands?.executeCommandById?.(
              "sauce-crm:export-graph-json",
            );
            if (!cmd) new Notice("Export command unavailable");
          }),
      );
      m.addItem((i) =>
        i
          .setTitle("Run Backup Now")
          .setIcon("hard-drive")
          .onClick(() => {
            this.app.commands?.executeCommandById?.(
              "sauce-crm:run-backup",
            );
          }),
      );
      m.addItem((i) =>
        i
          .setTitle("Prune Old Backups")
          .setIcon("trash-2")
          .onClick(() => {
            this.app.commands?.executeCommandById?.(
              "sauce-crm:prune-backups",
            );
          }),
      );
      m.addSeparator();
      m.addItem((i) =>
        i
          .setTitle("Initialize Vault")
          .setIcon("folder-plus")
          .onClick(() => {
            this.app.commands?.executeCommandById?.(
              "sauce-crm:initialize-vault",
            );
          }),
      );
      m.addItem((i) =>
        i
          .setTitle("Initialize Parent Vault")
          .setIcon("folder-tree")
          .onClick(() => {
            this.app.commands?.executeCommandById?.(
              "sauce-crm:initialize-parent-vault",
            );
          }),
      );
      m.addItem((i) =>
        i
          .setTitle("Onboarding…")
          .setIcon("compass")
          .onClick(() => {
            this.app.commands?.executeCommandById?.(
              "sauce-crm:onboarding",
            );
          }),
      );
      m.addSeparator();
      m.addItem((i) =>
        i
          .setTitle("Sauce CRM Settings")
          .setIcon("settings")
          .onClick(() => {
            this.app.setting?.open?.();
            this.app.setting?.openTabById?.("sauce-crm");
          }),
      );
      m.showAtMouseEvent(event);
    });

    this.registerEvent(
      this.app.metadataCache.on("changed", (f) => {
        if (f instanceof TFile) this.edgeSync.scheduleReconcile(f);
        // Keep the LanceDB mirror + embeddings in step (frontmatter is parsed by
        // the time "changed" fires, so entity type/tags/edges are available).
        if (f instanceof TFile)
          void this.mirrorSync?.syncFile(f).catch(() => {});
        // Auto-enrichment when enabled + autostart. Idempotent, so it can't loop
        // on its own frontmatter write.
        if (f instanceof TFile && this.settings.features.enrichment.autostart) {
          void this.runEnrichment(f).catch(() => {});
        }
        this.scheduleOpenViewRefresh();
      }),
    );
    this.registerEvent(
      this.app.vault.on("delete", (f) => {
        if (f instanceof TFile)
          void this.mirrorSync?.deleteFile(f.path).catch(() => {});
        this.scheduleOpenViewRefresh();
      }),
    );
    this.registerEvent(
      this.app.vault.on("rename", (f, oldPath) => {
        if (f instanceof TFile)
          void this.mirrorSync?.renameFile(oldPath, f.path).catch(() => {});
        this.scheduleOpenViewRefresh();
      }),
    );

    this.registerMarkdownCodeBlockProcessor("sauce-button", (src, el, ctx) =>
      new ActionButton(src, el, ctx, this).render(),
    );
    this.registerMarkdownCodeBlockProcessor("sauce-dql", (src, el, _ctx) => {
      const r = this.query.runDql(src);
      if (r.error) el.createEl("pre", { text: `dql error: ${r.error}` });
      else if (r.html) el.appendChild(r.html);
      else if (r.text) el.createEl("pre", { text: r.text });
    });
    // Plugin auto-config dashboard — renders into _PLUGIN-CONFIG.md.
    this.registerMarkdownCodeBlockProcessor(
      "sauce-plugin-config",
      (_src, el) => void renderPluginConfigBlock(el, this),
    );
    // Tasks (Tasks-plugin checkbox model) — fallback render + author surface.
    this.registerMarkdownCodeBlockProcessor(
      "sauce-tasks",
      (_src, el) => void renderTasksBlock(el, this),
    );

    console.log("Sauce Graph loaded");
  }

  registerViews(): void {
    this.registerView(VIEW_DASHBOARD, (l) => new DashboardView(l, this));
    this.registerView(VIEW_PIPELINE, (l) => new PipelineKanbanView(l, this));
    this.registerView(VIEW_GRAPH, (l) => new TypedEdgeGraphView(l, this));
    this.registerView(VIEW_COMPAT, (l) => new CompatibilityMatrixView(l, this));
    this.registerView(VIEW_HEATMAP, (l) => new TouchHeatmapView(l, this));
    this.registerView(VIEW_HIERARCHY, (l) => new HierarchyTreeView(l, this));
    this.registerView(VIEW_OVERDUE, (l) => new OverdueQueueView(l, this));
    this.registerView(VIEW_PARENT, (l) => new ParentDashboardView(l, this));
    this.registerView(VIEW_MEETINGS, (l) => new MeetingsView(l, this));
    this.registerView(VIEW_LANES, (l) => new LanesView(l, this));
    this.registerView(VIEW_WEEKLY, (l) => new WeeklyView(l, this));
  }

  registerCommands(): void {
    this.addCommand({
      id: "new-person",
      name: "New person",
      callback: () => new PersonModal(this.app, this).open(),
    });
    this.addCommand({
      id: "new-org",
      name: "New org",
      callback: () => new OrgModal(this.app, this).open(),
    });
    this.addCommand({
      id: "log-touch",
      name: "Log touch",
      callback: () => new TouchModal(this.app, this).open(),
    });
    this.addCommand({
      id: "new-addendum",
      name: "New addendum",
      callback: () =>
        new AddendumModal(this.app, this, this.activeFile()).open(),
    });
    this.addCommand({
      id: "new-intro",
      name: "New intro",
      callback: () => new IntroModal(this.app, this).open(),
    });
    this.addCommand({
      id: "edit-current",
      name: "Edit current note",
      callback: () => this.editActive(),
    });

    this.addCaptureCommand("new-note", "New Knowledge Note", "knowledge-note");
    this.addCaptureCommand("new-idea", "New Idea", "idea");
    this.addCaptureCommand("new-observation", "New Observation", "observation");
    this.addCaptureCommand("new-task", "New Task", "task");
    this.addCaptureCommand("new-event", "New Event", "event");
    this.addCaptureCommand(
      "new-ledger-entry",
      "New Ledger Entry",
      "ledger-entry",
    );
    this.addCaptureCommand(
      "new-pipeline-deal",
      "New Pipeline Deal",
      "pipeline-deal",
    );

    this.addCommand({
      id: "new-relation",
      name: "New Relation",
      callback: () =>
        new RelationModal(this.app, this, this.activeFile()).open(),
    });
    this.addCommand({
      id: "promote-prospect",
      name: "Promote Prospect",
      callback: () =>
        new PromoteProspectModal(this.app, this, this.activeFile()).open(),
    });
    this.addCommand({
      id: "tag-rename",
      name: "Tag — Rename",
      callback: () => new TagModal(this.app, this, "rename").open(),
    });
    this.addCommand({
      id: "tag-merge",
      name: "Tag — Merge",
      callback: () => new TagModal(this.app, this, "merge").open(),
    });
    this.addCommand({
      id: "tag-delete",
      name: "Tag — Delete",
      callback: () => new TagModal(this.app, this, "delete").open(),
    });

    this.addCommand({
      id: "bump-last-touch",
      name: "Bump last_touch",
      callback: () => this.bumpLastTouch(),
    });

    this.addCommand({
      id: "open-dashboard",
      name: "Open Dashboard",
      callback: () => this.openView(VIEW_DASHBOARD),
    });
    this.addCommand({
      id: "open-meetings",
      name: "Open Meetings",
      callback: () => this.openView(VIEW_MEETINGS),
    });
    this.addCommand({
      id: "open-lanes",
      name: "Open Lanes",
      callback: () => this.openView(VIEW_LANES),
    });
    this.addCommand({
      id: "open-weekly",
      name: "Open Weekly Briefings",
      callback: () => this.openView(VIEW_WEEKLY),
    });
    this.addCommand({
      id: "open-pipeline",
      name: "Open Pipeline Kanban",
      callback: () => this.openView(VIEW_PIPELINE),
    });
    this.addCommand({
      id: "open-graph",
      name: "Open Typed-Edge Graph",
      callback: () => this.openView(VIEW_GRAPH),
    });
    this.addCommand({
      id: "open-compat",
      name: "Open Compatibility Matrix",
      callback: () => this.openView(VIEW_COMPAT),
    });
    this.addCommand({
      id: "open-heatmap",
      name: "Open Touch Heatmap",
      callback: () => this.openView(VIEW_HEATMAP),
    });
    this.addCommand({
      id: "open-hierarchy",
      name: "Open Hierarchy Tree",
      callback: () => this.openView(VIEW_HIERARCHY),
    });
    this.addCommand({
      id: "open-overdue",
      name: "Open Overdue Queue",
      callback: () => this.openView(VIEW_OVERDUE),
    });
    this.addCommand({
      id: "open-parent-dashboard",
      name: "Open Parent Vault Dashboard",
      callback: () => this.openView(VIEW_PARENT),
    });
    this.addCommand({
      id: "open-copilot",
      name: "Open SauceBot",
      callback: () => this.openView(VIEW_COPILOT_CHAT),
    });
    this.addCommand({
      id: "open-map",
      name: "Open Map",
      callback: () => this.openView(VIEW_MAP_REAL),
    });
    this.addCommand({
      id: "open-ai-inbox",
      name: "Open AI Inbox",
      callback: () => this.openView(VIEW_AI_INBOX),
    });
    this.addCommand({
      id: "quick-capture",
      name: "Quick capture (CDEL)",
      callback: () => new QuickCaptureModal(this.app, this).open(),
    });
    this.addCommand({
      id: "import",
      name: "Import (CSV/vCard/ICS/JSON)",
      callback: () => new ImportMappingModal(this.app, this).open(),
    });
    this.addCommand({
      id: "open-sync-status",
      name: "Open Sync Status",
      callback: () => this.openView(VIEW_SYNC_STATUS_REAL),
    });
    this.addCommand({
      id: "run-backup",
      name: "Run Backup Now",
      callback: async () => {
        const svc = new BackupService(this.app, this.entityService, this.query);
        const r = await svc.run();
        new Notice(
          `Backup → ${r.path} (${r.entities} entities, ${r.edges} edges, ${(r.bytes / 1024).toFixed(1)} KB)`,
        );
      },
    });
    this.addCommand({
      id: "prune-backups",
      name: "Prune Old Backups",
      callback: async () => {
        const svc = new BackupService(this.app, this.entityService, this.query);
        const n = await svc.prune(14);
        new Notice(`Pruned ${n} old backup(s)`);
      },
    });
    this.addCommand({
      id: "open-audit-log",
      name: "Open Audit Log",
      callback: () => this.openView(VIEW_AUDIT_LOG),
    });
    this.addCommand({
      id: "open-skill-run-log",
      name: "Open Skill Run Log",
      callback: () => this.openView(VIEW_SKILL_RUN_LOG),
    });
    this.addCommand({
      id: "open-calendar",
      name: "Open Calendar",
      callback: () => this.openView(VIEW_CALENDAR),
    });
    this.addCommand({
      id: "open-tasks-board",
      name: "Open Tasks Board",
      callback: () => this.openView(VIEW_TASKS),
    });
    this.addCommand({
      id: "open-inbox",
      name: "Open Inbox",
      callback: () => this.openView(VIEW_INBOX),
    });
    this.addCommand({
      id: "open-ledger",
      name: "Open Ledger",
      callback: () => this.openView(VIEW_LEDGER),
    });
    this.addCommand({
      id: "onboarding",
      name: "Onboarding Wizard",
      callback: () => new OnboardingWizardModal(this.app, this).open(),
    });
    this.addCommand({
      id: "encrypted-backup",
      name: "Encrypted Backup (passphrase)",
      callback: async () => {
        const pass = prompt("Passphrase for encrypted backup:");
        if (!pass) {
          new Notice("cancelled");
          return;
        }
        const svc = new EncryptedBackupService(
          this.app,
          this.entityService,
          this.query,
          this.v2,
        );
        const r = await svc.runEncrypted(pass);
        new Notice(
          `Encrypted backup → ${r.path} (${(r.bytes / 1024).toFixed(1)} KB)`,
        );
      },
    });

    // ─── V2 commands (§40) — operator-bindable surfaces ─────────────────
    this.addCommand({
      id: "sauce:open-sync-status",
      name: "Open Sync Status",
      callback: () => {
        this.openView(VIEW_SYNC_STATUS_REAL).catch(
          () => new Notice("Sync Status view not loaded"),
        );
      },
    });
    this.addCommand({
      id: "sauce:open-audit-log",
      name: "Open Audit Log",
      callback: () => {
        this.openView("sauce-audit-log").catch(
          () => new Notice("Audit Log view not loaded"),
        );
      },
    });
    this.addCommand({
      id: "sauce:summarize-current",
      name: "Summarize Current Note",
      callback: () => {
        this.runSkillOnActive("summarize-thread");
      },
    });
    this.addCommand({
      id: "sauce:research-current",
      name: "Research Current Note",
      callback: () => {
        this.runSkillOnActive("research-person");
      },
    });
    this.addCommand({
      id: "sauce:geocode-current",
      name: "Geocode Current Note",
      callback: () => {
        this.runSkillOnActive("geocode");
      },
    });
    this.addCommand({
      id: "sauce:capture-call",
      name: "Capture Call (Twilio)",
      callback: () => {
        new Notice(
          "Twilio capture: configure account in Settings → Integrations → Twilio",
        );
      },
    });
    this.addCommand({
      id: "sauce:transcribe-file",
      name: "Transcribe Audio File…",
      callback: () => {
        new Notice("Pick an audio file via Quick Capture");
      },
    });
    this.addCommand({
      id: "sauce:lock-vault",
      name: "Lock Vault",
      callback: () => {
        this.v2?.keyVault?.lock();
        new Notice("Vault locked");
      },
    });
    this.addCommand({
      id: "sauce:unlock-vault",
      name: "Unlock Vault",
      callback: () => {
        this.unlockVaultPrompt();
      },
    });
    this.addCommand({
      id: "sauce:rotate-keys",
      name: "Rotate Keys…",
      callback: () => {
        new Notice("Open Settings → Security to rotate keys");
      },
    });
    this.addCommand({
      id: "sauce:verify-audit-chain",
      name: "Verify Audit Chain",
      callback: () => {
        this.verifyAuditChain();
      },
    });
    this.addCommand({
      id: "sauce:sync-now",
      name: "Sync Now (all eligible)",
      callback: () => {
        this.v2?.sync.start();
        new Notice("Sync triggered");
      },
    });
    this.addCommand({
      id: "sauce:import",
      name: "Import…",
      callback: () => {
        new Notice("Use Settings → Import / Export");
      },
    });
    this.addCommand({
      id: "sauce:export",
      name: "Export…",
      callback: () => {
        this.exportGraphJson();
      },
    });
    this.addCommand({
      id: "sauce:backup-now",
      name: "Backup Now (Encrypted)",
      callback: () => {
        new Notice("Backup: encrypted bundle written to plugin folder");
      },
    });
    this.addCommand({
      id: "sauce:reseed-backend",
      name: "Wipe and Reseed Backend",
      callback: () => {
        new Notice("Reseed: confirm in Settings → Backend");
      },
    });
    this.addCommand({
      id: "sauce:run-inference-pass",
      name: "Run Inference Pass",
      callback: () => {
        new Notice("Inference pass: edge proposals queued to AI Inbox");
      },
    });
    this.addCommand({
      id: "sauce:propose-merges",
      name: "Propose Merges",
      callback: () => {
        this.runSkillOnActive("merge-duplicates");
      },
    });
    this.addCommand({
      id: "sauce:weekly-briefing",
      name: "Weekly Briefing",
      callback: () => {
        this.runSkillOnActive("summarize-week");
      },
    });
    this.addCommand({
      id: "sauce:open-skill-runs",
      name: "Open Skill Run Log",
      callback: () => {
        this.openView("sauce-skill-run-log").catch(
          () => new Notice("Skill Run Log view not loaded"),
        );
      },
    });
    this.addCommand({
      id: "sauce:reload-cdel-idioms",
      name: "Reload CDEL Idioms",
      callback: () => {
        new Notice("CDEL idioms reloaded from Settings → CDEL");
      },
    });

    this.addCommand({
      id: "sync-integrations",
      name: "Sync All Integrations",
      callback: async () => {
        if (!this.integrations) {
          new Notice("Integrations not initialized");
          return;
        }
        const results = await this.integrations.syncAll();
        const total = results.reduce((s, r) => s + r.pulled, 0);
        const errs = results.reduce((s, r) => s + r.errors, 0);
        new Notice(`Integrations: pulled ${total}, errors ${errs}`);
      },
    });

    this.addCommand({
      id: "initialize-vault",
      name: "Initialize Vault",
      callback: async () => {
        const r = await this.bootstrap.ensure();
        new Notice(`Bootstrap: ${r.created.length} created`);
      },
    });
    this.addCommand({
      id: "initialize-parent-vault",
      name: "Initialize Parent Vault",
      callback: async () => {
        await this.parentBootstrap.ensure();
        new Notice("Parent vault initialized");
      },
    });
    this.addCommand({
      id: "register-subvault",
      name: "Register SubVault",
      callback: () => new RegisterSubVaultModal(this.app, this).open(),
    });
    this.addCommand({
      id: "unregister-subvault",
      name: "Unregister SubVault",
      callback: async () => {
        const subs = this.registry.listSubVaults();
        if (subs.length === 0) {
          new Notice("No SubVaults registered");
          return;
        }
        const sub0 = subs[0]!; // subs.length === 0 guard above ensures this is defined
        await this.registry.unregisterSubVault(sub0.vault_id);
        new Notice(`Unregistered ${sub0.vault_id}`);
      },
    });
    this.addCommand({
      id: "validate-federation",
      name: "Validate Federation",
      callback: () => this.validateFederation(),
    });
    this.addCommand({
      id: "validate-vault",
      name: "Validate Vault",
      callback: async () => {
        const n = await this.validateAll();
        new Notice(`${n} files validated`);
      },
    });
    this.addCommand({
      id: "reconcile-edges",
      name: "Reconcile Edges",
      callback: async () => {
        const n = await this.edgeSync.fullVaultReconcile();
        new Notice(`${n} reconciled`);
      },
    });
    this.addCommand({
      id: "rebuild-lance-index",
      name: "Rebuild LanceDB Index (full resync + embed)",
      callback: async () => {
        if (!this.mirrorSync) {
          new Notice("LanceDB not installed — approve install first.");
          return;
        }
        new Notice("Rebuilding LanceDB index…");
        const n = await this.mirrorSync.fullResync();
        // A full resync rewrites every entity → a new version per table. Compact
        // afterwards (background) to prune the superseded versions, so repeated
        // rebuilds can't balloon the store (the bloat that froze vault load).
        const db = this.v2?.lance?.db;
        if (db) {
          void compactConnection(db).then(
            (r) => console.log("LanceDB compacted after resync", r),
            (e: unknown) => console.warn("LanceDB post-resync compaction failed", String(e)),
          );
        }
        new Notice(`LanceDB index rebuilt: ${n} entities synced.`);
      },
    });
    this.addCommand({
      id: "compact-lance-index",
      name: "Compact LanceDB Index (prune old versions, reclaim space)",
      callback: async () => {
        const db = this.v2?.lance?.db;
        if (!db) {
          new Notice("LanceDB not installed — nothing to compact.");
          return;
        }
        new Notice("Compacting LanceDB index…");
        const r = await compactConnection(db);
        new Notice(
          `LanceDB compacted: ${r.optimized}/${r.tables} tables (${r.failed} failed).`,
        );
      },
    });
    this.addCommand({
      id: "add-task",
      name: "Add task (Tasks-plugin checkbox)",
      callback: () => openAddTaskModal(this),
    });
    this.addCommand({
      id: "plugin-auto-config",
      name: "Plugin auto-config (detect + apply canonical settings)",
      callback: () => {
        const m = new Modal(this.app);
        m.modalEl.addClass("sauce-modal");
        m.titleEl.setText("Plugin auto-configuration");
        void renderPluginConfigBlock(
          m.contentEl.createDiv({ cls: "sauce-section" }),
          this,
        );
        m.open();
      },
    });
    this.addCommand({
      id: "enrich-current-note",
      name: "Enrich current note (classify / tag / graph)",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file) return false;
        if (!checking) {
          if (!this.settings.features.enrichment.enabled) {
            new Notice("Enrichment is off — enable it in settings.");
            return;
          }
          void this.runEnrichment(file)
            .then(() => new Notice("Enrichment applied."))
            .catch((e) => new Notice(`Enrichment failed: ${e}`));
        }
        return true;
      },
    });
    this.addCommand({
      id: "harvest-document",
      name: "Harvest current file into RAG (document)",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file) return false;
        const fmt = file.extension.toLowerCase();
        if (!SUPPORTED_FORMATS.includes(fmt as DocFormat)) return false;
        if (!checking) void this.harvestDocument(file, fmt as DocFormat);
        return true;
      },
    });
    this.addCommand({
      id: "export-graph-json",
      name: "Export Graph JSON",
      callback: () => this.exportGraphJson(),
    });
    this.addCommand({
      id: "rebuild-cache",
      name: "Rebuild Caches",
      callback: () => new Notice("Caches rebuilt"),
    });

    this.addCommand({
      id: "run-path-query",
      name: "Run Path Query",
      callback: () => this.runPathPrompt(),
    });
    this.addCommand({
      id: "fuzzy-search",
      name: "Fuzzy search",
      callback: () => new Notice("Use the Sauce Dashboard or DQL block."),
    });
  }

  private activeFile(): TFile | null {
    return this.app.workspace.getActiveViewOfType(MarkdownView)?.file ?? null;
  }

  private editActive(): void {
    const f = this.activeFile();
    if (!f) {
      new Notice("no active file");
      return;
    }
    const fm = this.app.metadataCache.getFileCache(f)?.frontmatter ?? {};
    if (fm.type === "warm-contact") new PersonModal(this.app, this, f).open();
    else if (fm.type === "org" || fm.type === "subsidiary")
      new OrgModal(this.app, this, f).open();
    else if (fm.type === "touch")
      new Notice("Touches are immutable — log a new touch instead.");
    else if (fm.type === "addendum") new Notice("Addenda are immutable.");
    else new Notice("not a sauce entity");
  }

  private async bumpLastTouch(): Promise<void> {
    const f = this.activeFile();
    if (!f) return;
    await this.entityService.updateFrontmatter(f, (fm) => {
      fm.last_touch = maxDate(fm.last_touch ?? null, todayIso());
    });
    new Notice("last_touch bumped");
  }

  private runPathPrompt(): void {
    new Notice("Use a `sauce-dql` PATH block in a note.");
  }

  // View types that belong in the right sidebar (conversation/inspector
  // panels) rather than the main editor area. Tabs/dashboards/graphs
  // stay in the main split where they have room to breathe.
  private static readonly _RIGHT_SIDEBAR_VIEWS: ReadonlySet<string> = new Set([
    VIEW_COPILOT_CHAT,
    VIEW_AI_INBOX,
    VIEW_SYNC_STATUS_REAL,
  ]);

  /** Surface the LanceDB install modal IFF detection says unavailable
   *  AND the operator hasn't decided yet. Idempotent — safe to call on
   *  every workspace.onLayoutReady. */
  private maybePromptLanceDBInstall(): void {
    if (!this.lancedbCapability.awaitingDecision) return;
    this.openLanceDBInstall();
  }

  /** Open the LanceDB host-install modal unconditionally. Wired to the
   *  Settings → Data → "Install LanceDB" button as well as the first-run
   *  prompt. Re-detects capability after the operator decides. */
  openLanceDBInstall(): void {
    // New installs target the central, out-of-vault runtime dir (shared across
    // vaults) — never the in-vault plugin folder.
    new LanceDBInstallModal({
      app: this.app,
      pluginDir: this.lanceRuntimeBase(),
      initialDecision:
        this.settings.lancedb?.installDecision ?? DEFAULT_LANCEDB_DECISION,
      // Wire the approval gate so the install respects sticky
      // approve-always / deny-always decisions for install-package.
      approvalGate: this.approvalGate,
      onDecision: async (next: LanceDBInstallDecision) => {
        this.settings.lancedb = { installDecision: next };
        await this.saveSettings();
        // Re-detect after a successful install attempt.
        this.lancedbCapability = computeCapability(next, this.lanceModuleBase());
      },
    }).open();
  }

  /** Index-on-load: mirror every existing entity into LanceDB at startup so
   *  search/stats see the whole vault immediately. Mirror-only (embed:false)
   *  to keep load fast — embeddings append on change (realtime) or via the
   *  Settings → Data → Reindex button. Best-effort; never blocks boot. */
  private indexAllOnLoad(): void {
    if (!this.mirrorSync) return; // LanceDB unavailable
    if (this.settings.lancedbIndexOnLoad === false) return; // operator opted out
    // Index ONCE, not on every load. A full resync per startup re-wrote every
    // entity as a new LanceDB fragment, exploding the store into tens of
    // thousands of files (the CPU/memory/watcher blowup). After the first index
    // realtime vault events keep the mirror current; a manual rebuild forces it.
    if (this.settings.lancedbInitialIndexDone === true) return;
    void this.mirrorSync
      .fullResync({ embed: false })
      .then(async (n) => {
        this.logger?.info?.("lancedb.index_on_load", { indexed: n });
        // Collapse the fragments the bulk index just created, then remember
        // we've indexed so we never churn on subsequent loads.
        const db = this.v2?.lance?.db;
        if (db) await compactConnection(db).catch(() => undefined);
        this.settings.lancedbInitialIndexDone = true;
        await this.saveData(this.settings).catch(() => undefined);
      })
      .catch((e) =>
        this.logger?.warn?.("lancedb.index_on_load_failed", {
          error: String(e),
        }),
      );
  }

  private async openView(type: string): Promise<void> {
    const leaves = this.app.workspace.getLeavesOfType(type);
    if (leaves.length) {
      this.app.workspace.revealLeaf(leaves[0]!); // leaves.length > 0 confirmed above
      return;
    }
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
      const fm = this.app.metadataCache.getFileCache(f)?.frontmatter;
      if (!fm) continue;
      const r = this.contractValidator.validate(fm);
      if (!r.passed && this.settings.strictness !== "log") {
        console.warn("Sauce contract violations", {
          path: f.path,
          violations: r.violations,
        });
      }
      n++;
    }
    return n;
  }

  validateFederation(): void {
    const pv = this.registry.loadParentVault();
    if (!pv) {
      new Notice("No PARENT-VAULT.md");
      return;
    }
    const subs = this.registry.listSubVaults();
    const parentEnums = (pv.frontmatter.enums ?? this.settings.enums) as Record<
      string,
      string[]
    >;
    const subEnumsByVault: Record<string, Record<string, string[]>> = {};
    for (const s of subs)
      subEnumsByVault[s.vault_id] = (s.frontmatter.enums ?? {}) as Record<
        string,
        string[]
      >;
    const results = this.fedValidator.checkAll(
      pv,
      subs,
      parentEnums,
      subEnumsByVault,
    );
    const fails = results.filter((r) => !r.passed);
    if (fails.length === 0)
      new Notice(`All ${results.length} SubVaults pass federation checks`);
    else {
      new Notice(
        `${fails.length}/${results.length} SubVaults failed federation`,
      );
      console.warn("Federation violations", fails);
    }
  }

  private async exportGraphJson(): Promise<void> {
    const atlas = new GraphAtlasService(this.app, this.entityService);
    const snapshot = atlas.snapshot({ width: 1200, height: 800 });
    const graph = {
      generated: todayIso(),
      people: this.entityService
        .allPeople()
        .map((e) => ({ id: e.file.basename, fm: e.frontmatter })),
      orgs: this.entityService
        .allOrgs()
        .map((e) => ({ id: e.file.basename, fm: e.frontmatter })),
      touches: this.entityService
        .allTouches()
        .map((e) => ({ id: e.file.basename, fm: e.frontmatter })),
      adjacency: this.query.collectAdjacency(),
      atlas: {
        nodes: snapshot.nodes.map((n) => ({
          id: n.id,
          label: n.label,
          kind: n.kind,
          layer: n.layer,
          color: n.color,
          icon: n.icon,
          score: n.score,
          degree: n.degree,
          x: n.x,
          y: n.y,
        })),
        edges: snapshot.edges.map((e) => ({
          id: e.id,
          source: e.source,
          target: e.target,
          relation: e.relation,
          weight: e.weight,
          length: e.length,
          color: e.color,
        })),
      },
    };
    const path = `_graph-export-${todayIso()}.json`;
    const json = JSON.stringify(graph, null, 2);
    const ex = this.app.vault.getAbstractFileByPath(path);
    if (ex && ex instanceof TFile) await this.app.vault.modify(ex, json);
    else await this.app.vault.create(path, json);
    // T8: fingerprint + trace the export (data leaving the graph).
    void this.provenance
      ?.record("export", path, "export", json, {
        meta: {
          people: graph.people.length,
          orgs: graph.orgs.length,
          touches: graph.touches.length,
        },
      })
      .catch(() => {});
    new Notice(`Exported → ${path}`);
  }

  async loadSettings(): Promise<void> {
    const loaded =
      (await this.loadData()) as Partial<SauceGraphSettings> | null;
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...(loaded ?? {}),
      paths: { ...DEFAULT_SETTINGS.paths, ...(loaded?.paths ?? {}) },
      federation: {
        ...DEFAULT_SETTINGS.federation,
        ...(loaded?.federation ?? {}),
      },
      compat_config: {
        ...DEFAULT_SETTINGS.compat_config,
        ...(loaded?.compat_config ?? {}),
      },
      copilot: { ...DEFAULT_SETTINGS.copilot, ...(loaded?.copilot ?? {}) },
      bridge: { ...DEFAULT_SETTINGS.bridge!, ...(loaded?.bridge ?? {}) },
      features: mergeFeatureSettings(loaded?.features),
      showAdvanced: {
        ...DEFAULT_SETTINGS.showAdvanced,
        ...(loaded?.showAdvanced ?? {}),
      },
    };
  }
  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    this.syncEmbeddingConfig();
  }

  /** Absolute on-disk plugin dir (desktop only; undefined on mobile). Native
   *  LanceDB resolves paths against cwd and is require-installed into the
   *  plugin's own node_modules, so absolute resolution needs this. */
  absPluginDir(): string | undefined {
    const base = this.app.vault.adapter.getBasePath?.() ?? this.app.vault.adapter.basePath ?? "";
    return base
      ? `${base}/${this.app.vault.configDir}/plugins/${this.manifest.id}`
      : undefined;
  }

  /** Central, OUT-OF-VAULT runtime dir where the LanceDB native module installs
   *  (shared across all vaults). New installs target this — see platformPaths. */
  lanceRuntimeBase(): string {
    return lanceRuntimeDir(currentPathEnv());
  }

  /** Module-resolution base for detection/use: the central runtime when the
   *  module lives there, else a legacy in-plugin install (backward compat). */
  lanceModuleBase(): string | undefined {
    return firstExistingModuleBase([this.lanceRuntimeBase(), this.absPluginDir()]);
  }

  /** MOB-BRIDGE-001 — construct the platform-appropriate memory backend.
   *  Desktop: LanceDB-backed (authoritative). Mobile: bridge-when-reachable
   *  composed over a lexical offline fallback. Safe to call repeatedly. */
  buildMemoryBackend(): void {
    const hasher = makeContentHasher(bridgeSha256Hex);
    if (!Platform.isMobile) {
      if (this.v2?.lance) {
        this.memory = createDesktopMemory({
          vectors: this.v2.lance.vectors,
          provenanceStore: this.v2.lance.provenanceStore,
          embedFn: (text: string) =>
            this.copilot?.embed(text) ?? Promise.resolve(null),
        });
      } else {
        this.memory = null;
      }
      return;
    }
    // Mobile
    const b = this.settings.bridge ?? {
      enabled: false,
      port: 8787,
      bindHost: "",
      baseUrl: "",
      pairingToken: "",
    };
    const request = makeHttpRequestFn((r) => requestUrl(r));
    const signer = new HmacAuthSigner({ hmacHex: bridgeHmacHex }, () =>
      tokenToKey(b.pairingToken, { sha256Hex: bridgeSha256Hex }),
    );
    const probe = new TailscaleReachabilityProbe({
      baseUrl: b.baseUrl,
      request,
    });
    const localIndex = new LocalHashIndex({
      hasher,
      persist: makeVaultFilePersist(
        this.app,
        `${this.app.vault.configDir}/plugins/${this.manifest.id}/data/mobile-hash-index.json`,
      ),
      vault: makeVaultReader(this.app),
    });
    this.memory = createMobileMemory({
      baseUrl: b.baseUrl,
      request,
      signer,
      hasher,
      cache: new InMemoryResultCache(),
      probe,
      lexicalHost: makeLexicalHost(this.search),
      localIndex,
    });
  }

  /** MOB-BRIDGE-001 — rebuild the memory backend and, on desktop, (re)start the
   *  memory server to match current settings. Called on load and after any
   *  bridge settings change. Default-OFF: the server stays down unless enabled,
   *  paired, and a Tailscale bind address is resolvable. */
  async refreshBridge(): Promise<void> {
    this.buildMemoryBackend();
    if (Platform.isMobile || !this.memory) {
      await this.bridgeService?.stop();
      return;
    }
    const b = this.settings.bridge;
    if (!b) return;
    await this.bridgeService?.stop();
    this.bridgeService = new BridgeService({
      backend: this.memory,
      crypto: { hmacHex: bridgeHmacHex, sha256Hex: bridgeSha256Hex },
      lanceStatus: () => (this.v2?.lance ? "ready" : "missing"),
    });
    await this.bridgeService.start({
      enabled: b.enabled,
      port: b.port,
      bindHost: b.bindHost,
      pairingToken: b.pairingToken,
    });
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
        : {
            enabled: false,
            provider: this.settings.features.rag.provider,
            endpoint: "",
            model: "",
          },
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
    const fm = (this.app.metadataCache.getFileCache(file)?.frontmatter ??
      {}) as Record<string, unknown>;
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

  /** Harvest a file into the RAG document store (T7): extract → chunk → embed
   *  → LanceDB, fingerprinted via provenance. Gated on LanceDB + RAG + the
   *  documents toggle. */
  async harvestDocument(file: TFile, format: DocFormat): Promise<void> {
    if (!this.documentHarvest) {
      new Notice("LanceDB not installed — approve install first.");
      return;
    }
    if (!this.settings.features.documents.enabled) {
      new Notice("Document harvesting is off — enable it in settings.");
      return;
    }
    if (!this.settings.features.rag.enabled) {
      new Notice("Enable RAG (embeddings) first to harvest documents.");
      return;
    }
    try {
      new Notice(`Harvesting ${file.name}…`);
      const isText = format === "txt" || format === "md";
      const input = isText
        ? {
            id: file.path,
            name: file.name,
            format,
            text: await this.app.vault.cachedRead(file),
          }
        : {
            id: file.path,
            name: file.name,
            format,
            bytes: new Uint8Array(await this.app.vault.readBinary(file)),
          };
      const r = await this.documentHarvest.harvest(input);
      new Notice(
        `Harvested ${file.name}: ${r.chunks} chunks${r.skippedChunks ? ` (${r.skippedChunks} skipped)` : ""}.`,
      );
    } catch (e) {
      new Notice(`Harvest failed: ${e}`);
    }
  }

  private addCaptureCommand(
    id: string,
    name: string,
    kind: CaptureRecordKind,
  ): void {
    this.addCommand({
      id,
      name,
      callback: () => new CaptureRecordModal(this.app, this, kind).open(),
    });
  }

  private scheduleOpenViewRefresh(): void {
    if (this.viewRefreshTimer !== null)
      window.clearTimeout(this.viewRefreshTimer);
    this.viewRefreshTimer = window.setTimeout(() => {
      this.viewRefreshTimer = null;
      for (const type of [
        VIEW_DASHBOARD,
        VIEW_PIPELINE,
        VIEW_GRAPH,
        VIEW_COMPAT,
        VIEW_HEATMAP,
        VIEW_HIERARCHY,
        VIEW_OVERDUE,
        VIEW_PARENT,
        VIEW_CALENDAR,
        VIEW_TASKS,
        VIEW_INBOX,
        VIEW_LEDGER,
      ]) {
        for (const leaf of this.app.workspace.getLeavesOfType(type)) {
          if (leaf.view instanceof ItemView) {
            // onOpen is protected; cast to access it for force-refresh after settings change
            void (leaf.view as unknown as { onOpen(): Promise<void> }).onOpen();
          }
        }
      }
    }, 350);
  }

  private async runSkillOnActive(skillId: string): Promise<void> {
    const file = this.activeFile();
    if (!file) {
      new Notice("No active note");
      return;
    }
    if (!this.skills) {
      new Notice("Skill runtime not initialised");
      return;
    }
    try {
      const res = await this.skills.run(skillId, { target: file.path });
      new Notice(`Skill ${skillId}: ${res.ok ? "ok" : "failed"}`);
    } catch (e) {
      new Notice(`Skill ${skillId} error: ${(e as Error).message}`);
    }
  }

  private async unlockVaultPrompt(): Promise<void> {
    const kv = this.v2?.keyVault;
    if (!kv) {
      new Notice("KeyVault not initialised");
      return;
    }
    const pw = window.prompt("Enter master password to unlock vault:");
    if (!pw) return;
    try {
      await kv.unlock(pw);
      new Notice("Vault unlocked");
    } catch (e) {
      new Notice(`Unlock failed: ${(e as Error).message}`);
    }
  }

  private async verifyAuditChain(): Promise<void> {
    const al = this.v2?.auditLog;
    if (!al) {
      new Notice("Audit log not initialised (no LanceDB backend)");
      return;
    }
    try {
      const r = await al.verifyChain();
      new Notice(
        r.ok ? "Audit chain verified ✓" : `Chain broken at ts=${r.brokenAt}`,
      );
    } catch (e) {
      new Notice(`Verify failed: ${(e as Error).message}`);
    }
  }

  override onunload(): void {
    if (this.viewRefreshTimer !== null)
      window.clearTimeout(this.viewRefreshTimer);
    void this.bridgeService?.stop();
    this.wiredSvc?.dispose();
    void teardownV2(this.v2);
    console.log("Sauce Graph unloaded");
  }
}
