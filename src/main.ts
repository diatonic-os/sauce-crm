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
import { BootTimer } from "./services/BootTimer";
import { WhisperEngine } from "./services/transcribe/WhisperEngine";
import { ChildProcessRegistry } from "./utils/execFileNoThrow";
import {
  candidateBinaryPaths,
  validateBinaryPath,
  type PathProbe,
} from "./services/transcribe/WhisperArgs";
import { MemoryBackendRagAdapter } from "./bridge/MemoryBackendRagAdapter";
import { injectMobileStyles } from "./ui/MobileStyles";
import { installMobileKeyboard } from "./ui/MobileKeyboard";
import { activity } from "./ui/ActivityNotifier";
import {
  EntityService,
  DEFAULT_PATHS,
  VaultPaths,
} from "./services/EntityService";
import {
  SauceBrainMigration,
  type MigrationStamp,
} from "./services/SauceBrainMigration";
import {
  EdgeSyncService,
  DEFAULT_EDGE_RULES,
  EdgeRule,
} from "./services/EdgeSyncService";
import { QueryService } from "./services/QueryService";
import { SearchService } from "./services/SearchService";
import { MirrorSync } from "./services/MirrorSync";
import type { FullResyncProgress } from "./services/MirrorSync";
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
import { CommandReferenceService } from "./services/CommandReferenceService";
import { VaultEventBus } from "./services/VaultEventBus";
import { ContractValidator } from "./contract/ContractValidator";
import { RegistryService } from "./federation/RegistryService";
import { FederationValidator } from "./federation/FederationValidator";
import { ParentVaultBootstrapper } from "./federation/ParentVaultBootstrapper";
import { PersonModal } from "./ui/modals/PersonModal";
import { OrgModal } from "./ui/modals/OrgModal";
import { RelationshipCardModal } from "./ui/modals/RelationshipCardModal";
import { detectClaudeCode } from "./saucebot/ClaudeCodeProvider";
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
import {
  probeDaemon,
  makeDaemonFetch,
  createDaemonBackend,
  createDaemonTranscriber,
  daemonBaseUrl,
  daemonHasWhisper,
  type DaemonHealth,
} from "./services/DaemonClient";
import { compactConnection } from "./backend/lance/maintenance";
import { TABLES } from "./backend/lance/LanceSchema";
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
import { VIEW_MAP_REAL } from "./ui/views/v2/MapViewReal";
import { AtlasView, VIEW_ATLAS } from "./ui/atlas/AtlasView";
import { BrainView, VIEW_BRAIN } from "./ui/views/v2/BrainView";
import { BrainBuilder, type BrainFile } from "./saucebot/BrainBuilder";
import { setSharedCatalogFetch } from "./saucebot/ModelCatalog";
import { newInstallId, isId } from "./saucebot/Ids";
import {
  SauceDbClient,
  canSyncSauceDb,
  type SauceDbConfig,
} from "./saucebot/SauceDb";
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
  VIEW_TASKS,
  VIEW_INBOX,
} from "./ui/views/v2/DashboardViews";
import { EisenhowerView, VIEW_EISENHOWER } from "./ui/views/v2/EisenhowerView";
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
  /** Vault folder the Sauce Brain dashboard reads standalone `*.html` builds
   *  from (BrainView). Defaults to `.sauceBrain/brain` (legacy: `_brain`,
   *  auto-migrated by {@link SauceBrainMigration}). */
  brainFolder?: string;
  /** Stamp recording the last completed .sauceBrain folder consolidation.
   *  Gates re-runs of the one-way migration. */
  sauceBrainMigration?: MigrationStamp;
  /** Brain tier + SauceDB (hosted LanceDB edge) config. Free = local JSON
   *  brain; SauceDB = paid hosted edge sync. See src/saucebot/SauceDb.ts. */
  sauceDb?: SauceDbConfig;
  /** Stable, non-repeatable install id (inst_…). Generated once, persisted, and
   *  stamped onto every chat/audit trace so multi-user deployments are
   *  distinguishable for enterprise audit/replay. */
  installId?: string;
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
   *  load. Cleared by a manual rebuild if a fresh full index is wanted.
   *  Superseded by {@link lancedbIndexState} but kept for back-compat reads. */
  lancedbInitialIndexDone?: boolean;
  /** Persisted full-vault index state — drives resume-after-interruption and the
   *  Settings → Data "last index" stats. `cursor`/`total` track an in-flight or
   *  interrupted resync (cursor < total ⇒ resumable); `completedAt` is the ISO
   *  timestamp of the last COMPLETED full index; `drift` is the last
   *  reconciliation result (vault entities vs mirror rows). */
  lancedbIndexState?: {
    cursor: number;
    total: number;
    synced?: number;
    completedAt?: string;
    drift?: number | null;
    mirrorRows?: number | null;
  };
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
  /** sauce-crm-daemon integration. Disabled by default; when enabled and the
   *  daemon answers /health, the plugin uses the daemon's Lance store remotely
   *  and SKIPS local Lance init (single-writer rule). */
  daemon?: DaemonSettings;
  /** Forward-compat beta opt-in gate. Absent in production releases. */
  beta?: { enabled?: boolean };
  /** Verbose debug mode — when on, every feature logs through the shared
   *  DebugSink (see saucebot/lmstudio/LMStudioCapability.makeDebugSink). Off by
   *  default; user-toggled in Settings. */
  debugMode?: boolean;
  /** Hosted Bifrost gateway endpoint (our VPS worker node). When set, clients
   *  auto-connect to it on load — hybrid cloud+local routing without per-client
   *  config. Empty ⇒ no auto-connect (direct providers). */
  gatewayUrl?: string;
  /** Local Whisper transcription (S8). Default empty/off — the plugin never
   *  downloads or installs whisper; the operator sets an absolute binary path
   *  (or uses Detect), or routes transcription through the daemon. */
  transcription?: TranscriptionSettings;
}

/** Whisper transcription settings (plugin side). The plugin NEVER installs the
 *  binary; `binaryPath` must be an absolute path the operator points at, or
 *  empty (then transcription is unavailable locally and the daemon route, if
 *  enabled, is used instead). */
export interface TranscriptionSettings {
  /** Absolute path to the whisper CLI. Empty = not configured. */
  binaryPath: string;
  /** Default model id (e.g. "large-v3-turbo"). */
  model: string;
  /** Prefer the daemon's /v1/transcribe over a local spawn when the daemon
   *  advertises whisper capability in /health. Default true (zero local spawn). */
  preferDaemon: boolean;
}

/** sauce-crm-daemon settings. The pairing token is a shared secret — redacted
 *  from data.json (SEC-07 pattern) and stored in the credential chain under
 *  "daemon:pairing-token". */
export interface DaemonSettings {
  enabled: boolean;
  /** Loopback port the daemon listens on (default 8788). */
  port: number;
  /** Shared HMAC pairing token (hex). Redacted on save; durable copy in chain. */
  pairingToken: string;
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
  brainFolder: DEFAULT_PATHS.brain,
  sauceDb: { tier: "local" },
  features: DEFAULT_FEATURE_SETTINGS,
  debugMode: false,
  // Bake the hosted gateway URL here (VPS worker node) so installed clients
  // auto-connect on load. Empty by default for OSS / self-host builds.
  gatewayUrl: "",
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
  daemon: {
    enabled: false,
    port: 8788,
    pairingToken: "",
  },
  transcription: {
    binaryPath: "",
    model: "large-v3-turbo",
    preferDaemon: true,
  },
};

/** Minimal Logger implementation that writes to console with a source
 *  prefix. Satisfies the Logger interface (trace/debug/info/warn/error/
 *  event/child) without depending on the full SauceLogger + sink stack. */
function makeConsoleLogger(source: string): import("./telemetry/types").Logger {
  const tag = `[${source}]`;
  const fmt = (msg: string, data?: Record<string, unknown>) =>
    data ? `${tag} ${msg} ${JSON.stringify(data)}` : `${tag} ${msg}`;
  /* eslint-disable no-restricted-syntax -- console IS the sink here: this is the console-backed Logger implementation, not an ad-hoc console call */
  return {
    trace: (m, d) => console.debug(fmt(m, d)),
    debug: (m, d) => console.debug(fmt(m, d)),
    info: (m, d) => console.info(fmt(m, d)),
    warn: (m, d) => console.warn(fmt(m, d)),
    error: (m, d) => console.error(fmt(m, d)),
    event: (name, d) => console.info(fmt(`event:${name}`, d)),
    child: (suffix) => makeConsoleLogger(`${source}.${suffix}`),
  };
  /* eslint-enable no-restricted-syntax */
}

/** PLC-01: minimal promise-based text-input modal replacing window.prompt().
 *  Resolves to the entered string, or null if cancelled / dismissed. */
class InputModal extends Modal {
  private resolved = false;
  constructor(
    app: import("obsidian").App,
    private readonly opts: {
      title: string;
      placeholder?: string;
      password?: boolean;
      cta?: string;
    },
    private readonly resolve: (value: string | null) => void,
  ) {
    super(app);
  }

  override onOpen(): void {
    const { contentEl, titleEl } = this;
    titleEl.setText(this.opts.title);
    contentEl.empty();
    const input = contentEl.createEl("input", { cls: "sg-input-modal-field" });
    input.type = this.opts.password ? "password" : "text";
    if (this.opts.placeholder) input.placeholder = this.opts.placeholder;
    input.setAttribute("aria-label", this.opts.title);

    const finish = (value: string | null) => {
      if (this.resolved) return;
      this.resolved = true;
      this.resolve(value);
      this.close();
    };

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        finish(input.value);
      } else if (e.key === "Escape") {
        e.preventDefault();
        finish(null);
      }
    });

    const actions = contentEl.createDiv({ cls: "sg-confirm-actions" });
    const cancel = actions.createEl("button", { text: "Cancel" });
    cancel.onclick = () => finish(null);
    const ok = actions.createEl("button", {
      text: this.opts.cta ?? "OK",
      cls: "mod-cta",
    });
    ok.onclick = () => finish(input.value);

    window.setTimeout(() => input.focus(), 0);
  }

  override onClose(): void {
    // Dismissed via the close button / backdrop counts as cancel.
    if (!this.resolved) {
      this.resolved = true;
      this.resolve(null);
    }
    this.contentEl.empty();
  }
}

export default class SauceGraphPlugin extends Plugin {
  settings!: SauceGraphSettings;
  entityService!: EntityService;
  edgeSync!: EdgeSyncService;
  query!: QueryService;
  search!: SearchService;
  // ── Phase-A boot optimization: lazy-on-first-use services ──────────────
  // These have NO eager onload wiring (no construct-time side effects, no
  // ordering invariants). They construct on first access via getters below,
  // keeping their public non-null types so external consumers are unchanged.
  private _bootstrap: VaultBootstrapper | null = null;
  get bootstrap(): VaultBootstrapper {
    return (this._bootstrap ??= new VaultBootstrapper(
      this.app,
      this.settings.paths,
    ));
  }
  private _parentBootstrap: ParentVaultBootstrapper | null = null;
  get parentBootstrap(): ParentVaultBootstrapper {
    return (this._parentBootstrap ??= new ParentVaultBootstrapper(this.app));
  }
  private _registry: RegistryService | null = null;
  get registry(): RegistryService {
    return (this._registry ??= new RegistryService(this.app));
  }
  private _fedValidator: FederationValidator | null = null;
  get fedValidator(): FederationValidator {
    return (this._fedValidator ??= new FederationValidator());
  }
  private _contractValidator: ContractValidator | null = null;
  get contractValidator(): ContractValidator {
    return (this._contractValidator ??= new ContractValidator({
      strictness: this.settings.strictness,
      enums: this.enums(),
      vaultLookup: (link) => {
        const t = link.replace(/\[\[|\]\]/g, "").split("|")[0]!; // split always produces ≥1 element
        const f = this.app.metadataCache.getFirstLinkpathDest(t, "");
        if (!f) return null;
        return this.app.metadataCache.getFileCache(f)?.frontmatter ?? {};
      },
    }));
  }
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
  // Deterministic "snowflake matrix" brain: lexicon + taxonomy + path lattice
  // (BrainBuilder) plus the crystal digest matrix (in the runtime). Auto-built
  // in the background once a provider is configured; chat works during the
  // build but warns it is not yet optimized.
  brainBuilder: BrainBuilder | null = null;
  sauceDb: SauceDbClient | null = null;
  brainState: "idle" | "building" | "ready" = "idle";
  private brainBuildPromise: Promise<void> | null = null;
  private brainDirty = new Set<string>();
  private brainFlushTimer: number | null = null;
  mirrorSync: MirrorSync | null = null;
  /** In-flight full-vault resync controller — non-null only while a rebuild is
   *  running. Holds the abort handle (so a second invocation cancels the first)
   *  and the status-bar element. */
  private activeResync: {
    abort: () => void;
    statusEl: HTMLElement | null;
  } | null = null;
  /** Encrypted credential chain (OS keychain → KeyVault). Durable home of
   *  the copilot API key — data.json never stores secrets (SEC-01). */
  credentialChain: ChainedCredentialSource | null = null;
  enrichment: EnrichmentService | null = null;
  documentHarvest: DocumentHarvestService | null = null;
  // pluginConfig + tasks: lazy-on-first-use (codeblock/command consumers only;
  // no eager onload wiring). Getters construct on first access.
  private _pluginConfig: PluginConfigService | null = null;
  get pluginConfig(): PluginConfigService {
    return (this._pluginConfig ??= new PluginConfigService(
      new ObsidianPluginConfigHost(this.app),
      defaultProfiles(),
      this.v2?.provenance ?? null,
    ));
  }
  private _tasks: TasksService | null = null;
  get tasks(): TasksService {
    return (this._tasks ??= new TasksService(this.app));
  }
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
  /** sauce-crm-daemon: when the daemon answers /health at boot, this holds the
   *  remote (HMAC) MemoryBackend and the plugin SKIPS local Lance init
   *  (single-writer rule). Null when the daemon is disabled/absent. */
  daemonBackend: MemoryBackend | null = null;
  /** Last successful daemon /health probe (for the settings status row). Null
   *  when the daemon is disabled or unreachable. */
  daemonHealth: DaemonHealth | null = null;
  v2Registry: V2Registry = new V2Registry();
  // Structured logger satisfying the Logger interface from telemetry/types.
  // Console-backed; v2 components reach for `event()` and `child()`.
  logger: import("./telemetry/types").Logger = makeConsoleLogger("sauce-crm");
  // Phase-A boot timing. Constructed at the top of onload; segments marked at
  // each boot phase boundary. Last report surfaced via "Show boot timing".
  private bootTimer: BootTimer | null = null;
  // Phase-A: deferred heavy boot work (vault walks / scheduler first scan).
  // Registered during onload, drained inside the onLayoutReady callback so the
  // O(vault) work never competes with the awaited boot path.
  private readonly deferredPostLayout: Array<() => unknown> = [];
  // LanceDB capability — populated in onload. Read by VectorSearchService
  // (when wired) and by the RAG semantic path. While `enabled` is false,
  // the RAG falls back to graph + fuzzy.
  lancedbCapability!: LanceDBCapability;
  private viewRefreshTimer: number | null = null;
  // PLC-04: set true first thing in onunload; realtime vault-event handlers
  // bail when it is set so no async work is scheduled against a torn-down plugin.
  private unloaded = false;

  // Approval gate — single chokepoint every risky autonomous action
  // routes through. Wired into the LanceDB install button, the swarm
  // dispatch path, and any future spawn-process / send-network call.
  approvalGate!: ApprovalGate;
  /** Tracks live whisper child processes so onunload terminates them (S8). */
  private readonly childProcs = new ChildProcessRegistry();

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
      const req = (globalThis as unknown as { require: NodeRequire }).require;
      const { IntegrationCredentials } = req(
        "./integrations/IntegrationCredentials",
      );
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
    const boot = (this.bootTimer = new BootTimer());
    await this.loadSettings();
    boot.mark("settings-load");

    // One-way folder consolidation (≤0.5.0 layout → hidden .sauceBrain/). Runs
    // once per vault — a persisted stamp short-circuits every subsequent load.
    // MOVES data link-preserving; never deletes. Must precede EntityService and
    // the brainFolder reads below so they see the migrated paths. Failures are
    // swallowed: a half-migrated vault keeps working on its (also-rewired)
    // settings and retries are safe (idempotent + collision-skipping).
    try {
      const migration = await new SauceBrainMigration(this.app).run(
        this.settings,
      );
      if (!migration.skipped) {
        if (migration.totalFilesMoved > 0 || migration.pathsChanged) {
          await this.saveSettings();
        }
        if (migration.totalFilesMoved > 0) {
          activity.info(
            `SauceBrain: consolidated ${migration.totalFilesMoved} file(s) into .sauceBrain/`,
          );
        }
        if (migration.conflicts.length > 0) {
          console.warn(
            "[SauceBrain migration] left sources in place for existing destinations:",
            migration.conflicts,
          );
        }
      }
      boot.mark("saucebrain-migration");
    } catch (err) {
      console.error("[SauceBrain migration] failed (vault unchanged):", err);
    }

    // Mobile (Apple-native) optimization: inject the .is-mobile stylesheet and
    // surface a one-tap quick-capture ribbon for on-the-go recording.
    if (Platform.isMobile) {
      this.register(injectMobileStyles());
      // Keyboard avoidance: keep the focused composer/field visible above the
      // soft keyboard while typing. Disposed on unload.
      const kb = installMobileKeyboard(window, document);
      this.register(() => kb.dispose());
      this.addRibbonIcon("plus-circle", "SauceOM: Quick capture", () =>
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
          await this.saveSettings().catch((e) =>
            console.error(
              "SauceBot: failed to persist approval record",
              e,
            ),
          );
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
      // Phase-A: run deferred heavy vault walks off the awaited boot path. Each
      // thunk was registered during onload but its O(vault) work waits for the
      // workspace layout (metadataCache is most complete here).
      for (const task of this.deferredPostLayout) {
        try {
          const r = task();
          if (r && typeof (r as Promise<unknown>).catch === "function") {
            void (r as Promise<unknown>).catch((e: unknown) =>
              this.logger.warn("Sauce post-layout task failed", {
                error: String(e),
              }),
            );
          }
        } catch (e) {
          this.logger.warn("Sauce post-layout task threw", {
            error: String(e),
          });
        }
      }
      this.deferredPostLayout.length = 0;
      const r = boot.report("post-layout");
      this.logger.debug("boot.timing", {
        segments: r.segments,
        totalMs: r.totalMs,
      });
    });

    // sauce-crm-daemon single-writer detection (must run BEFORE initV2 so we can
    // skip local Lance init when the daemon owns the store). On success this
    // hydrates this.daemonBackend + this.daemonHealth; on failure the local path
    // is untouched (fallback). Never throws into boot.
    const daemonPresent = await this.probeDaemonForBoot();
    boot.mark("daemon-probe");

    try {
      this.v2 = await initV2(this.app, this, { skipLance: daemonPresent });
    } catch (e) {
      this.logger.warn("Sauce V2 init failed", { error: String(e) });
    }
    boot.mark("v2-init");

    this.entityService = new EntityService(this.app, this.settings.paths);
    this.edgeSync = new EdgeSyncService(
      this.app,
      this.entityService,
      this.settings.edge_rules,
    );
    this.query = new QueryService(this.app, this.entityService);
    this.search = new SearchService(this.app, this.entityService);
    // bootstrap / parentBootstrap / registry / fedValidator / contractValidator
    // are now lazy getters (constructed on first use) — see the field block.

    // CORS fix: the model catalog (all model/embedding dropdowns) must fetch via
    // Obsidian's requestUrl, NOT native fetch — native fetch from app://
    // obsidian.md is blocked against local LM Studio / Ollama endpoints, which
    // left every picker empty. requestUrl is a CORS-bypassing net request.
    setSharedCatalogFetch(async (url, init) => {
      const r = await requestUrl({
        url,
        method: (init?.method as string) ?? "GET",
        ...(init?.headers
          ? { headers: init.headers as Record<string, string> }
          : {}),
        ...(init?.body ? { body: init.body as string } : {}),
        throw: false,
      });
      return {
        ok: r.status >= 200 && r.status < 400,
        status: r.status,
        json: async () => JSON.parse(r.text),
        text: async () => r.text,
      } as Response;
    });

    this.copilot = new SauceBotRuntime(
      this.app,
      this.entityService,
      this.search,
      this.settings.copilot ?? COPILOT_DEFAULTS,
      this.v2?.lance?.vectors ?? null,
    );
    // Persist immediately when the runtime discovers a model to blocklist (a
    // permanent load failure), so the picker reflects it across reloads.
    this.copilot.setOnSettingsChanged(() => {
      this.saveSettings().catch((e) =>
        console.error(
          "SauceBot: failed to persist settings after model state change",
          e,
        ),
      );
    });
    // Point the crystallized-brain digest cache at the configured brain folder.
    this.copilot.setBrainFolder(
      this.settings.brainFolder ?? DEFAULT_PATHS.brain,
    );
    // Auto-connect to the hosted Bifrost gateway (VPS worker node) if configured
    // — installed clients route through the central proxy with no manual setup.
    // Off the awaited boot path; silent best-effort.
    void this.autoConnectGateway();
    // Deterministic brain builder (lexicon/taxonomy/path-lattice). The Obsidian
    // vault adapter satisfies BrainPersistence (read/write/exists/mkdir).
    this.brainBuilder = new BrainBuilder(
      this.app.vault.adapter,
      this.settings.brainFolder ?? DEFAULT_PATHS.brain,
    );
    // SauceDB hosted-edge sync client (paywalled). Uses Obsidian's requestUrl
    // (CORS-bypassing) as the HTTP seam; gated by entitlement + config.
    this.sauceDb = new SauceDbClient(
      this.settings.sauceDb ?? { tier: "local" },
      async (url, init) => {
        const r = await requestUrl({
          url,
          method: init.method,
          headers: init.headers,
          body: init.body,
          throw: false,
        });
        return { status: r.status, text: r.text };
      },
    );
    // Defer the auto-build until the workspace is ready so startup isn't blocked.
    this.app.workspace.onLayoutReady(() => void this.maybeAutoBuildBrain());
    // Secure credential sourcing. OS keychain (safeStorage) primary, encrypted
    // KeyVault fallback; first available source that has the key wins. The
    // cloud API key is NEVER persisted to data.json (SEC-01): saveSettings()
    // strips it, the in-memory copy lives only for this session, and the
    // durable copy lives in this chain.
    {
      const sources: CredentialSource[] = [
        makeSafeStorageCredentialSource(secretsFile(currentPathEnv())),
      ];
      if (this.v2?.keyVault) {
        sources.push(new KeyVaultCredentialSource(this.v2.keyVault));
      }
      this.credentialChain = new ChainedCredentialSource(sources);
      this.copilot.setCredentialSource(this.credentialChain);
      // One-time migration (SEC-01): a pre-0.3.0 data.json may carry a
      // plaintext key. Move it into the encrypted chain, then scrub disk —
      // saveSettings() persists a redacted clone from here on.
      void (async () => {
        const legacyKey = this.settings.copilot.apiKey;
        if (legacyKey) {
          try {
            await this.credentialChain!.put(
              this.copilotKeyService(),
              legacyKey,
            );
          } catch {
            // No writable source (locked vault + no keychain): keep the key
            // in memory for this session; it still never re-persists.
          }
          await this.saveSettings(); // re-write data.json without the key
        } else {
          // Hydrate the session copy (embedding config reads it directly).
          const stored = await this.credentialChain!.get(
            this.copilotKeyService(),
          ).catch(() => null);
          if (stored) {
            this.settings.copilot.apiKey = stored;
            this.syncEmbeddingConfig();
          }
        }
      })();
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
          // Stamp the REAL active embed model on each stored vector so a model
          // change is detectable downstream (was hardcoded "copilot").
          modelIdFn: () => this.copilot?.activeEmbedModel || "",
          // B (S6): whole-vault coverage — mirror untyped notes as type:"note"
          // and honor the operator's exclude-folder list.
          fullVaultIndex: this.settings.features.rag.fullVaultIndex,
          excludeGlobs: this.settings.features.rag.excludeGlobs,
          // Reconciliation count source: total rows in the entity mirror table.
          // Decoupled via callback so MirrorSync stays free of LanceDB internals.
          countMirrorRows: async () => {
            const db = this.v2?.lance?.db;
            if (!db) return null;
            try {
              const tbl = await db.openTable(TABLES.entities);
              return await tbl.countRows();
            } catch {
              return null;
            }
          },
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
    // Plugin auto-config engine (orchestrator) is now a lazy getter — see the
    // field block. Detect/propose runs only when the config UI or command opens.
    boot.mark("services");
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
      // Phase-A: defer the initial O(vault) rebuild to onLayoutReady so it
      // doesn't compete with the awaited boot path (the manual command below
      // stays eager so the palette entry is present immediately).
      this.deferredPostLayout.push(() =>
        vaultIndexer.rebuild().catch(() => {
          /* empty graph on first run / no vault access */
        }),
      );
      this.addCommand({
        id: "rebuild-vault-graph",
        name: "Rebuild Vault Graph Index",
        callback: () => {
          void vaultIndexer
            .rebuild()
            .then(
              (n) =>
                new Notice(`SauceBot: indexed ${n} notes into the vault graph`),
            );
        },
      });
    }
    // Tasks ↔ Tasks-plugin checkbox bridge (W4) is now a lazy getter — see the
    // field block. Constructed when the tasks codeblock/command first runs.
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
      // Phase-A: defer the initial whole-metadataCache link-graph walk to
      // onLayoutReady (metadataCache is most complete then). The "resolved"
      // event registration stays eager so later cache updates still rebuild.
      this.deferredPostLayout.push(() => linkProvider.rebuild());
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
                ? {
                    autonomy: fm.autonomy as NonNullable<SkillTask["autonomy"]>,
                  }
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
      // Phase-A: defer scheduler.start (which arms the 60s interval) to
      // onLayoutReady. The register(stop) teardown stays eager so unload is
      // always safe even if layout never becomes ready.
      this.register(() => scheduler.stop());
      this.deferredPostLayout.push(() => scheduler.start(60_000));
    }

    // D (S8): wire local whisper transcription on desktop (the `transcribe`
    // skill + chat audio uploads route through this). Mobile/sandboxed runtimes
    // lack child_process/fs, so the engine stays unset there and dispatch
    // reports "not configured" rather than failing silently. HARDENED:
    //   - binaryPath comes ONLY from settings (no PATH guessing); validated
    //     (absolute + exists + executable) before every spawn,
    //   - the first spawn per session passes through the ApprovalGate,
    //   - every spawn is audited + the child is tracked for kill-on-unload.
    this.wireWhisperEngine();

    // C (S7): route skill ctx.audit to the durable HMAC-chained audit log so
    // manual + scheduled skill runs are recorded and visible in the Audit Log
    // view (was a console-only stub).
    const auditLog = this.v2?.auditLog;
    // Auto-populate every audit entry's agentId with the acting AI agent
    // (provider:model) so the chain records WHO/WHAT made each change.
    auditLog?.setActor(() => this.currentAgentId());
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
    boot.mark("copilot+skills+integrations");

    // MOB-BRIDGE-001 — build the platform memory backend and, on desktop,
    // (re)start the memory server per settings (default-OFF). Never throws into
    // boot: a bridge failure must not break plugin load.
    try {
      // SEC-07: hydrate/migrate the pairing token into memory BEFORE the bridge
      // starts, so refreshBridge() reads a populated token.
      await this.migrateBridgePairingToken();
      // SEC-07: same for the daemon token. The boot probe used a keychain-only
      // fallback; this completes the legacy-plaintext→chain migration + scrub.
      await this.migrateDaemonPairingToken();
      await this.refreshBridge();
    } catch (e) {
      this.logger.warn("Sauce mobile-bridge init failed (non-fatal)", {
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
        : {
            reason:
              "LanceDB not installed — approve install to enable persistence",
          }),
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
    // Unified Sauce Atlas (geo globe + network) replaces the standalone Map and
    // Typed-Edge Graph. The legacy view-types alias to it so saved workspace
    // layouts and existing launcher/command references keep working.
    this.registerView(VIEW_ATLAS, (l) => new AtlasView(l, this));
    this.registerView(VIEW_MAP_REAL, (l) => new AtlasView(l, this));
    this.registerView(VIEW_BRAIN, (l) => new BrainView(l, this));
    // CON-SAUCEBOT S7 — register the FUNCTIONAL inbox/audit/run-log views in
    // place of the dormant "Real" placeholder stubs. The functional
    // SkillRunLogView reads the same SkillRunRing singleton the SkillRuntime
    // pushes to (the Real stub had a second, never-populated ring).
    this.registerView(VIEW_AI_INBOX, (l) => new AIInboxView(l, this));
    this.registerView(VIEW_AUDIT_LOG, (l) => new AuditLogView(l, this));
    this.registerView(VIEW_SKILL_RUN_LOG, (l) => new SkillRunLogView(l, this));
    this.registerView(VIEW_CALENDAR, (l) => new CalendarView(l, this));
    this.registerView(VIEW_TASKS, (l) => new TasksView(l, this));
    this.registerView(VIEW_INBOX, (l) => new InboxView(l, this));
    this.registerView(VIEW_EISENHOWER, (l) => new EisenhowerView(l, this));

    boot.mark("registry+bridge");
    this.registerViews();
    boot.mark("views");
    this.registerCommands();
    this.addSettingTab(new SauceGraphSettingTab(this.app, this));
    boot.mark("commands+settings-tab");

    // Auto-install/refresh the vault-root command reference + hotkey matrix from
    // the live registry (now that registerCommands has run). Deferred off the
    // boot path; idempotent (replaces only its managed block, keeps user prose).
    this.deferredPostLayout.push(() =>
      new CommandReferenceService(this.app, this.manifest.id)
        .ensure(new Date().toISOString())
        .catch(() => {
          /* non-fatal: reference doc is convenience, not core */
        }),
    );

    // Primary launcher — a single "open any view" dropdown grouped by
    // category (CRM dashboards / Analytics / Logs & Activity / AI & Brain /
    // Sync & Map). This is the canonical navigation surface: every registered
    // view is reachable and labeled here, so nothing is "hidden". Each item
    // routes through the shared `openView` helper (the same path the command
    // palette uses), so a single wiring point keeps launcher + palette in sync.
    this.addRibbonIcon("sauce-hierarchy", "SauceOM", (event) => {
      const m = new Menu();
      const sec = (label: string): void => {
        m.addItem((i) => i.setTitle(label).setDisabled(true));
      };
      const view = (title: string, icon: string, type: string): void => {
        m.addItem((i) =>
          i
            .setTitle(title)
            .setIcon(icon)
            .onClick(() => void this.openView(type)),
        );
      };

      sec("CRM dashboards");
      view("Dashboard", "layout-dashboard", VIEW_DASHBOARD);
      view("Parent Vault Dashboard", "sauce-parent-vault", VIEW_PARENT);
      view("Tasks Board", "sauce-task", VIEW_TASKS);
      view("Inbox", "sauce-ai-inbox", VIEW_INBOX);
      view("Calendar", "sauce-touch", VIEW_CALENDAR);
      view("Eisenhower Matrix", "layout-dashboard", VIEW_EISENHOWER);
      view("Meetings", "sauce-touch", VIEW_MEETINGS);
      view("Lanes", "columns-3", VIEW_LANES);
      view("Weekly Briefings", "calendar-days", VIEW_WEEKLY);

      m.addSeparator();
      sec("Analytics");
      view("Sauce Atlas (geo + network)", "globe", VIEW_ATLAS);
      view("Pipeline Kanban", "columns-3", VIEW_PIPELINE);
      view("Compatibility Matrix", "sauce-compat", VIEW_COMPAT);
      view("Touch Heatmap", "sauce-heatmap", VIEW_HEATMAP);
      view("Hierarchy Tree", "sauce-hierarchy", VIEW_HIERARCHY);
      view("Overdue Queue", "sauce-overdue", VIEW_OVERDUE);

      m.addSeparator();
      sec("AI & Brain");
      // Launcher icons MATCH each view's getIcon() (all Lucide) so the three
      // align identically and the menu icon equals the resulting tab icon.
      view("SauceBot Chat", "message-circle", VIEW_COPILOT_CHAT);
      view("AI Inbox", "inbox", VIEW_AI_INBOX);
      view("Sauce Brain", "brain-circuit", VIEW_BRAIN);

      m.addSeparator();
      sec("Logs & activity");
      view("Audit Log", "sauce-audit", VIEW_AUDIT_LOG);
      view("Skill Run Log", "sauce-skill", VIEW_SKILL_RUN_LOG);

      m.addSeparator();
      sec("Sync");
      view("Sync Status", "sauce-sync", VIEW_SYNC_STATUS_REAL);

      m.addSeparator();
      m.addItem((i) =>
        i
          .setTitle("Run Path Query")
          .setIcon("git-branch")
          .onClick(() => this.runPathPrompt()),
      );

      m.showAtMouseEvent(event);
    });

    // Second (and only other) ribbon — capture + data ops. Consolidates the
    // former "People" and "Setup & Data" ribbons. The previous "Graph & Views"
    // and "AI & Chat" ribbons merely re-listed views already in the "SauceOM"
    // launcher above and have been removed (one ribbon, not five). Everything
    // here is also reachable from the command palette.
    this.addRibbonIcon("plus-circle", "SauceOM — Capture & Data", (event) => {
      const m = new Menu();
      const sec = (label: string): void => {
        m.addItem((i) => i.setTitle(label).setDisabled(true));
      };
      sec("Capture");
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
      m.addItem((i) =>
        i
          .setTitle("Quick Capture")
          .setIcon("plus-circle")
          .onClick(() => {
            try {
              const QCMod = (
                globalThis as unknown as { require: NodeRequire }
              ).require("./ui/modals/QuickCaptureModal");
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
              const AMod = (
                globalThis as unknown as { require: NodeRequire }
              ).require("./ui/modals/AddendumModal");
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
              const RMod = (
                globalThis as unknown as { require: NodeRequire }
              ).require("./ui/modals/RelationModal");
              new RMod.RelationModal(this.app, this, this.activeFile()).open();
            } catch {
              new Notice("Relation modal unavailable");
            }
          }),
      );
      m.addSeparator();
      sec("Data");
      m.addItem((i) =>
        i
          .setTitle("Import (CSV/vCard/ICS/JSON)")
          .setIcon("upload")
          .onClick(() => {
            try {
              const IMod = (
                globalThis as unknown as { require: NodeRequire }
              ).require("./ui/modals/ImportMappingModal");
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
          .onClick(() => void this.exportGraphJson()),
      );
      m.addItem((i) =>
        i
          .setTitle("Run Backup Now")
          .setIcon("hard-drive")
          .onClick(() => void this.runBackupNow()),
      );
      m.addItem((i) =>
        i
          .setTitle("Prune Old Backups")
          .setIcon("trash-2")
          .onClick(() => void this.pruneBackups()),
      );
      m.addSeparator();
      m.addItem((i) =>
        i
          .setTitle("Initialize Vault")
          .setIcon("folder-plus")
          .onClick(
            () =>
              void this.bootstrap
                .ensure()
                .then(
                  (r) => new Notice(`Bootstrap: ${r.created.length} created`),
                ),
          ),
      );
      m.addItem((i) =>
        i
          .setTitle("Initialize Parent Vault")
          .setIcon("folder-tree")
          .onClick(
            () =>
              void this.parentBootstrap
                .ensure()
                .then(() => new Notice("Parent vault initialized")),
          ),
      );
      m.addItem((i) =>
        i
          .setTitle("Onboarding…")
          .setIcon("compass")
          .onClick(() => new OnboardingWizardModal(this.app, this).open()),
      );
      m.addSeparator();
      m.addItem((i) =>
        i
          .setTitle("Sauce CRM Settings")
          .setIcon("settings")
          .onClick(() => this.openPluginSettings()),
      );
      m.showAtMouseEvent(event);
    });

    // ── Event-driven automation layer (VaultEventBus) ──────────────────────
    // One typed bus fans every vault event out to ORDERED subscribers
    // (edges → mirror → enrichment → brain → views), so delete/rename now get
    // the same edge-reciprocity + cache fan-out a change does — closing the gap
    // where delete/rename bypassed EdgeSyncService and left dangling edges
    // (audit EV-01/EV-04). `changed` behavior is preserved exactly.
    const bus = new VaultEventBus();
    const baseName = (p: string): string =>
      (p.split("/").pop() ?? p).replace(/\.md$/i, "");
    const fileAt = (p: string): TFile | null => {
      const f = this.app.vault.getAbstractFileByPath(p);
      return f instanceof TFile ? f : null;
    };
    const ALL = new Set<"changed" | "deleted" | "renamed">([
      "changed",
      "deleted",
      "renamed",
    ]);

    bus.subscribe({
      name: "edges",
      order: 10,
      kinds: ALL,
      handle: (ev) => {
        if (ev.kind === "changed") {
          const f = fileAt(ev.path);
          if (f) this.edgeSync.scheduleReconcile(f);
        } else if (ev.kind === "deleted") {
          void this.edgeSync.purgeNode(baseName(ev.path)).catch(() => {});
        } else if (ev.kind === "renamed" && ev.oldPath) {
          void this.edgeSync
            .renameNode(baseName(ev.oldPath), baseName(ev.path))
            .catch(() => {});
        }
      },
    });
    bus.subscribe({
      name: "mirror",
      order: 20,
      kinds: ALL,
      handle: (ev) => {
        if (ev.kind === "changed") {
          const f = fileAt(ev.path);
          if (f) void this.mirrorSync?.syncFile(f).catch(() => {});
        } else if (ev.kind === "deleted") {
          void this.mirrorSync?.deleteFile(ev.path).catch(() => {});
        } else if (ev.kind === "renamed" && ev.oldPath) {
          void this.mirrorSync?.renameFile(ev.oldPath, ev.path).catch(() => {});
        }
      },
    });
    bus.subscribe({
      name: "enrichment",
      order: 30,
      kinds: new Set(["changed"]),
      handle: (ev) => {
        // Idempotent, so it can't loop on its own frontmatter write.
        if (!this.settings.features.enrichment.autostart) return;
        const f = fileAt(ev.path);
        if (f) void this.runEnrichment(f).catch(() => {});
      },
    });
    bus.subscribe({
      name: "brain",
      order: 40,
      kinds: ALL,
      handle: (ev) => {
        if (ev.kind === "changed") {
          if (!ev.isMarkdown) return;
          const f = fileAt(ev.path);
          if (f) this.scheduleBrainUpdate(f);
        } else if (ev.kind === "deleted") {
          void this.brainBuilder?.removeFile(ev.path);
        } else if (ev.kind === "renamed" && ev.oldPath && ev.isMarkdown) {
          const f = fileAt(ev.path);
          if (f)
            void this.brainBuilder?.renameFile(ev.oldPath, this.brainFileFor(f));
        }
      },
    });
    bus.subscribe({
      name: "views",
      order: 50,
      kinds: ALL,
      handle: () => this.scheduleOpenViewRefresh(),
    });

    this.registerEvent(
      this.app.metadataCache.on("changed", (f) => {
        if (this.unloaded) return; // PLC-04
        if (f instanceof TFile)
          bus.publish({
            kind: "changed",
            path: f.path,
            isMarkdown: f.extension === "md",
          });
      }),
    );
    this.registerEvent(
      this.app.vault.on("delete", (f) => {
        if (this.unloaded) return; // PLC-04
        if (f instanceof TFile)
          bus.publish({
            kind: "deleted",
            path: f.path,
            isMarkdown: f.extension === "md",
          });
      }),
    );
    this.registerEvent(
      this.app.vault.on("rename", (f, oldPath) => {
        if (this.unloaded) return; // PLC-04
        if (f instanceof TFile)
          bus.publish({
            kind: "renamed",
            path: f.path,
            oldPath,
            isMarkdown: f.extension === "md",
          });
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

    boot.mark("event-handlers+codeblocks");
    const onloadReport = boot.report("onload");
    this.logger.debug("boot.timing", {
      segments: onloadReport.segments,
      totalMs: onloadReport.totalMs,
    });
    this.logger?.info?.("Sauce Graph loaded"); // MKT-005: gate info behind logger
  }

  /** Phase-A: human-readable summary of the last boot-timing report, surfaced
   *  via the "Sauce CRM: Show boot timing" command. Returns null if onload has
   *  not produced a report yet. */
  private showBootTiming(): void {
    const r = this.bootTimer?.getLastReport();
    if (!r) {
      new Notice("Boot timing not available yet.");
      return;
    }
    const summary = BootTimer.format(r);
    const m = new Modal(this.app);
    m.titleEl.setText("SauceOM — Boot timing");
    m.contentEl.createEl("p", { text: `Total: ${r.totalMs} ms (${r.phase})` });
    const list = m.contentEl.createEl("ul");
    for (const s of r.segments)
      list.createEl("li", { text: `${s.name}: ${s.ms} ms` });
    m.contentEl.createEl("pre", { text: summary });
    m.open();
  }

  registerViews(): void {
    this.registerView(VIEW_DASHBOARD, (l) => new DashboardView(l, this));
    this.registerView(VIEW_PIPELINE, (l) => new PipelineKanbanView(l, this));
    this.registerView(VIEW_GRAPH, (l) => new AtlasView(l, this));
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
      id: "sauceom-relationship-card",
      name: "SauceOM: Relationship card (people · touches · ideas)",
      callback: async () => {
        // Active note's basename, else ask (mobile-safe modal, not window.prompt).
        const id =
          this.activeFile()?.basename ??
          (await this.promptText({
            title: "Relationship card for (person/org name):",
            cta: "Open",
          })) ??
          "";
        if (!id) return;
        new RelationshipCardModal(this.app, id).open();
      },
    });
    this.addCommand({
      id: "sauceom-connect-gateway",
      name: "SauceOM: Connect to Bifrost gateway",
      callback: async () => {
        if (!this.settings.gatewayUrl?.trim()) {
          const url = await this.promptText({
            title: "Bifrost gateway URL (e.g. https://bifrost.yourvps/v1):",
            cta: "Connect",
          });
          if (!url) return;
          this.settings.gatewayUrl = url.trim();
          await this.saveSettings();
        }
        const notice = new Notice("Connecting to gateway…", 0);
        const ok = await this.autoConnectGateway(true);
        notice.hide();
        if (!ok) return;
        // Prompt for the per-client Bifrost virtual key and store it in the
        // Obsidian-integrated encrypted vault (OS keychain → KeyVault), keyed by
        // the now-active `bifrost` provider — NEVER in data.json. Blank keeps any
        // existing vaulted key.
        if (!(await this.hasCopilotKey())) {
          const vk = await this.promptText({
            title: "Bifrost virtual key (stored encrypted in your vault):",
            password: true,
            cta: "Save key",
          });
          if (vk && vk.trim()) {
            await this.storeCopilotKey(vk.trim());
            new Notice("✓ Gateway key saved to the encrypted vault", 5000);
          }
        }
      },
    });
    this.addCommand({
      id: "sauceom-detect-claude-code",
      name: "SauceOM: Detect Claude Code (use local OAuth as provider)",
      callback: async () => {
        const notice = new Notice("Detecting Claude Code…", 0);
        const d = await detectClaudeCode();
        notice.hide();
        if (!d.found) {
          new Notice(
            d.error ?? "Claude Code not found. Install it, then retry.",
            8000,
          );
          return;
        }
        if (!d.authed) {
          new Notice(
            `Found Claude Code at ${d.binPath} but not logged in. Run \`claude\` in a terminal to log in, then retry.`,
            10000,
          );
          return;
        }
        // Authenticated via local OAuth — adopt as the SauceBot provider.
        this.settings.copilot.provider = "claude-code";
        if (!this.settings.copilot.model)
          this.settings.copilot.model = "claude-sonnet-4-6";
        await this.saveSettings();
        this.copilot?.updateSettings?.({
          provider: "claude-code",
          model: this.settings.copilot.model,
        });
        new Notice(
          `✓ Claude Code connected via local OAuth · ${d.models.length} models available (no API key)`,
          7000,
        );
      },
    });
    this.addCommand({
      id: "sauceom-harness-turn",
      name: "SauceOM: Harness turn (experimental)",
      callback: async () => {
        const seed = this.activeFile()?.basename ?? "";
        // Mobile-safe input (window.prompt is blocked on mobile Obsidian).
        const prompt = await this.promptText({
          title: "SauceOM harness — what do you want?",
          placeholder: seed,
          cta: "Run",
        });
        if (!prompt) return;
        const runtime = this.copilot;
        if (!runtime) {
          new Notice("SauceOM: runtime not ready yet");
          return;
        }
        const notice = new Notice("SauceOM: thinking…", 0);
        void runtime
          .runHarnessTurn(prompt)
          .then((turn) => {
            notice.hide();
            // Grounded answer (or the clarifying question when route=ask) +
            // the top next step — the directive's recap + next_steps surface.
            const next =
              turn.nextSteps[0]?.suggestedNextAction ?? "—";
            new Notice(
              `[${turn.route}] ${turn.output || turn.recap}\n\nNext: ${next}`,
              12000,
            );
          })
          .catch((e: unknown) => {
            notice.hide();
            new Notice(
              `SauceOM harness failed: ${e instanceof Error ? e.message : String(e)}`,
            );
          });
      },
    });
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
      id: "reconnect-daemon",
      name: "Reconnect daemon",
      callback: () => void this.reconnectDaemon(),
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
      id: "open-brain",
      name: "Open Sauce Brain",
      callback: () => this.openView(VIEW_BRAIN),
    });
    this.addCommand({
      id: "build-brain",
      name: "Build Brain (full snowflake matrix: lexicon, taxonomy, lattice, crystal)",
      callback: () => {
        if (!this.copilot || !this.brainBuilder) {
          new Notice("SauceBot runtime is not initialized.");
          return;
        }
        // Force a fresh full build even if one already exists.
        this.brainBuildPromise = null;
        void this.buildBrainBackground();
      },
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
      callback: () => void this.runBackupNow(),
    });
    this.addCommand({
      id: "prune-backups",
      name: "Prune Old Backups",
      callback: () => void this.pruneBackups(),
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
      id: "open-eisenhower",
      name: "Open Eisenhower Matrix",
      callback: () => this.openView(VIEW_EISENHOWER),
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
        // PLC-01: Obsidian modal instead of the forbidden blocking prompt().
        const pass = await this.promptText({
          title: "Passphrase for encrypted backup",
          password: true,
          cta: "Back up",
        });
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
      name: "Sauce CRM: Rebuild vault index (full resync + embed)",
      callback: () => {
        // Cancellable, batched, progress-reporting full resync with a live
        // status-bar item. Re-invoking while one runs cancels the prior run.
        void this.rebuildVaultIndex();
      },
    });
    this.addCommand({
      id: "cancel-vault-index",
      name: "Sauce CRM: Cancel running vault index",
      checkCallback: (checking) => {
        if (!this.activeResync) return false;
        if (!checking) {
          this.activeResync.abort();
          new Notice("Vault index cancellation requested…");
        }
        return true;
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
    this.addCommand({
      id: "show-boot-timing",
      name: "Show boot timing",
      callback: () => this.showBootTiming(),
    });
    this.addCommand({
      id: "tasks-bridge-import",
      name: "Tasks Bridge — Import Tasks-plugin → Sauce",
      callback: () => {
        if (!(this.app as any).plugins?.plugins?.['obsidian-tasks-plugin']) {
          new Notice("Obsidian Tasks plugin not installed/enabled.");
          return;
        }
        void this.tasks.listTasks().then((refs) => {
          new Notice(
            `Found ${refs.length} Tasks-plugin task(s). (Full import/reconcile coming soon.)`,
          );
        }).catch((e: unknown) =>
          new Notice(`Tasks Bridge error: ${String(e)}`),
        );
      },
    });
    this.addCommand({
      id: "tasks-bridge-mirror",
      name: "Tasks Bridge — Mirror Sauce tasks → _TASKS.md",
      callback: () => {
        if (!(this.app as any).plugins?.plugins?.['obsidian-tasks-plugin']) {
          new Notice("Obsidian Tasks plugin not installed/enabled.");
          return;
        }
        const svc = this.tasks;
        const files = this.app.vault.getMarkdownFiles();
        const cache = this.app.metadataCache;
        void svc.listTasks().then((existingRefs) => {
          // Build a dedup set of "title|due" keys already in _TASKS.md
          const existing = new Set(
            existingRefs.map((r) => `${r.task.title}|${r.task.due ?? ""}`)
          );
          const pushes: Promise<void>[] = [];
          for (const f of files) {
            const fm = cache.getFileCache(f)?.frontmatter as
              | Record<string, unknown>
              | undefined;
            if (fm?.["type"] !== "task") continue;
            const title =
              typeof fm["title"] === "string" ? fm["title"] : f.basename;
            const due =
              typeof fm["due"] === "string"
                ? fm["due"].slice(0, 10)
                : undefined;
            // Skip if already mirrored (idempotence)
            if (existing.has(`${title}|${due ?? ""}`)) continue;
            pushes.push(
              svc.addTask(
                due !== undefined
                  ? { title, status: "todo", due }
                  : { title, status: "todo" },
              ),
            );
          }
          return Promise.all(pushes).then(() =>
            new Notice(
              `Tasks Bridge: mirrored ${pushes.length} task(s) → _TASKS.md`,
            ),
          );
        }).catch((e: unknown) =>
          new Notice(`Tasks Bridge error: ${String(e)}`),
        );
      },
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
      onDecision: async (next: LanceDBInstallDecision) => {
        this.settings.lancedb = { installDecision: next };
        await this.saveSettings();
        // Re-detect after a successful install attempt.
        this.lancedbCapability = computeCapability(
          next,
          this.lanceModuleBase(),
        );
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
    const completed =
      this.settings.lancedbInitialIndexDone === true ||
      this.settings.lancedbIndexState?.completedAt != null;
    // Resume an interrupted index (cursor persisted but never completed) from
    // where it left off rather than restarting.
    const st = this.settings.lancedbIndexState;
    const resumeFrom =
      !completed && st != null && st.cursor > 0 && st.cursor < st.total
        ? st.cursor
        : 0;
    if (completed) return;
    const signal = { aborted: false };
    void this.mirrorSync
      .fullResyncDetailed({
        embed: false, // mirror-only on load — embeddings append on change/rebuild
        startIndex: resumeFrom,
        signal,
        onProgress: (p) => {
          if (p.phase !== "indexing") return;
          // Checkpoint the cursor so an interrupted load resumes next time.
          this.settings.lancedbIndexState = {
            ...(this.settings.lancedbIndexState ?? {
              cursor: 0,
              total: p.total,
            }),
            cursor: p.done,
            total: p.total,
          };
        },
      })
      .then(async (r) => {
        this.logger?.info?.("lancedb.index_on_load", {
          indexed: r.synced,
          resumedFrom: resumeFrom,
          drift: r.drift,
        });
        // Collapse the fragments the bulk index just created, then remember
        // we've indexed so we never churn on subsequent loads.
        const db = this.v2?.lance?.db;
        if (db) await compactConnection(db).catch(() => undefined);
        this.settings.lancedbInitialIndexDone = true;
        this.settings.lancedbIndexState = {
          cursor: r.cursor,
          total: r.total,
          synced: r.synced,
          completedAt: new Date().toISOString(),
          drift: r.drift,
          mirrorRows: r.mirrorRows,
        };
        await this.saveData(this.settings).catch(() => undefined);
      })
      .catch((e) =>
        this.logger?.warn?.("lancedb.index_on_load_failed", {
          error: String(e),
        }),
      );
  }

  /** Production-grade FULL VAULT INDEX rebuild. Runs a batched, cancellable,
   *  resumable {@link MirrorSync.fullResyncDetailed} with a live status-bar
   *  item (N/total), persists a resume cursor so an interruption continues
   *  instead of restarting, reconciles vault entities vs mirror rows, and
   *  surfaces a completion Notice. Re-invoking while a rebuild is in flight
   *  cancels the running one first.
   *
   *  @param resume When true, continue from the persisted cursor instead of
   *                restarting from 0 (used by the resume-on-load path). */
  async rebuildVaultIndex(opts: { resume?: boolean } = {}): Promise<void> {
    if (!this.mirrorSync) {
      new Notice("LanceDB not installed — approve install first.");
      return;
    }
    // Cancel any in-flight rebuild so we never run two resyncs concurrently
    // (overlapping resyncs churn the mirror + fight over the path chains).
    if (this.activeResync) {
      this.activeResync.abort();
      this.activeResync = null;
    }

    let aborted = false;
    const signal = {
      get aborted() {
        return aborted;
      },
    };
    const statusEl = this.addStatusBarItem();
    statusEl.addClass("sg-index-status");
    statusEl.setText("Sauce CRM: indexing…");
    this.activeResync = {
      abort: () => {
        aborted = true;
      },
      statusEl,
    };

    const startIndex = opts.resume
      ? (this.settings.lancedbIndexState?.cursor ?? 0)
      : 0;
    new Notice(
      opts.resume && startIndex > 0
        ? `Resuming vault index from ${startIndex}…`
        : "Rebuilding vault index…",
    );

    const onProgress = (p: FullResyncProgress): void => {
      if (p.phase === "reconciling") {
        statusEl.setText("Sauce CRM: reconciling…");
        return;
      }
      if (p.phase === "done") return;
      statusEl.setText(`Sauce CRM: indexing ${p.done}/${p.total}`);
      // Persist the cursor at every batch boundary so a crash/quit mid-index
      // leaves a resumable checkpoint on disk.
      this.settings.lancedbIndexState = {
        ...(this.settings.lancedbIndexState ?? { cursor: 0, total: p.total }),
        cursor: p.done,
        total: p.total,
      };
    };

    try {
      const r = await this.mirrorSync.fullResyncDetailed({
        embed: true,
        signal,
        onProgress,
      });
      // Persist final index state. A completed run stamps completedAt + drift;
      // a cancelled run leaves the resumable cursor in place.
      this.settings.lancedbIndexState = {
        cursor: r.cursor,
        total: r.total,
        synced: r.synced,
        ...(r.cancelled ? {} : { completedAt: new Date().toISOString() }),
        drift: r.drift,
        mirrorRows: r.mirrorRows,
      };
      // Keep the legacy boolean in step so index-on-load doesn't re-fire.
      if (!r.cancelled) this.settings.lancedbInitialIndexDone = true;
      await this.saveData(this.settings).catch(() => undefined);

      if (r.cancelled) {
        new Notice(
          `Vault index cancelled at ${r.cursor}/${r.total} — re-run to resume.`,
        );
      } else {
        // Compact away the per-entity fragments the bulk index created so
        // repeated rebuilds can't balloon the store.
        const db = this.v2?.lance?.db;
        if (db) {
          void compactConnection(db).then(
            (cr) =>
              this.logger?.info?.("lancedb.compacted_after_resync", { r: cr }),
            (e: unknown) =>
              this.logger?.warn?.("LanceDB post-resync compaction failed", {
                error: String(e),
              }),
          );
        }
        const driftNote =
          r.drift != null && r.drift > 0
            ? ` (drift ${r.drift}: ${r.synced} vault vs ${r.mirrorRows} mirror)`
            : "";
        new Notice(
          `Vault index rebuilt: ${r.synced} entit${r.synced === 1 ? "y" : "ies"}${driftNote}.`,
        );
      }
    } catch (e: unknown) {
      new Notice(
        `Vault index failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      statusEl.remove();
      if (this.activeResync?.statusEl === statusEl) this.activeResync = null;
    }
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

  /**
   * Auto-connect to the hosted Bifrost gateway (our VPS worker node) when a
   * gatewayUrl is configured: health-probe `/models`, then adopt `bifrost` as
   * the SauceBot provider (endpoint + a model) so installed clients route
   * through the central gateway with zero manual setup. Best-effort; silent on
   * load (announce=true for the manual command). Uses requestUrl (CORS-bypass).
   */
  async autoConnectGateway(announce = false): Promise<boolean> {
    const url = this.settings.gatewayUrl?.trim().replace(/\/+$/, "");
    if (!url) return false;
    try {
      const r = await requestUrl({
        url: `${url}/models`,
        method: "GET",
        throw: false,
      });
      if (r.status < 200 || r.status >= 300) {
        if (announce)
          new Notice(`Gateway not reachable (HTTP ${r.status}). Check the URL.`);
        return false;
      }
      const data = (r.json?.data ?? []) as Array<{ id?: string }>;
      const firstModel = data[0]?.id ?? this.settings.copilot.model;
      this.settings.copilot.provider = "bifrost";
      this.settings.copilot.baseUrl = url;
      if (firstModel) this.settings.copilot.model = firstModel;
      await this.saveSettings();
      this.copilot?.updateSettings?.({
        provider: "bifrost",
        baseUrl: url,
        ...(firstModel ? { model: firstModel } : {}),
      });
      if (announce)
        new Notice(
          `✓ Connected to Bifrost gateway · ${data.length} models (hybrid cloud + local)`,
          6000,
        );
      return true;
    } catch (e) {
      if (announce)
        new Notice(
          `Gateway connect failed: ${e instanceof Error ? e.message : String(e)}`,
        );
      return false;
    }
  }

  async validateAll(): Promise<number> {
    let n = 0;
    for (const f of this.app.vault.getMarkdownFiles()) {
      const fm = this.app.metadataCache.getFileCache(f)?.frontmatter;
      if (!fm) continue;
      const r = this.contractValidator.validate(fm);
      if (!r.passed && this.settings.strictness !== "log") {
        this.logger.warn("Sauce contract violations", {
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
      this.logger.warn("Federation violations", { fails });
    }
  }

  /** PLC-01: promise-based replacement for window.prompt() — opens an Obsidian
   *  modal and resolves with the entered text (or null on cancel). */
  private promptText(opts: {
    title: string;
    placeholder?: string;
    password?: boolean;
    cta?: string;
  }): Promise<string | null> {
    return new Promise((resolve) => {
      new InputModal(this.app, opts, resolve).open();
    });
  }

  /** PLC-02: open this plugin's settings tab. Obsidian exposes no public API for
   *  this, so the private `app.setting.open/openTabById` calls are isolated here
   *  (optional-chained) as the single sanctioned use site. */
  private openPluginSettings(): void {
    this.app.setting?.open?.();
    this.app.setting?.openTabById?.(this.manifest.id);
  }

  /** PLC-02: shared backup handler — invoked by the command and the ribbon menu
   *  so neither has to round-trip through the private commands API. */
  private async runBackupNow(): Promise<void> {
    const svc = new BackupService(this.app, this.entityService, this.query);
    const r = await svc.run();
    new Notice(
      `Backup → ${r.path} (${r.entities} entities, ${r.edges} edges, ${(r.bytes / 1024).toFixed(1)} KB)`,
    );
  }

  /** PLC-02: shared prune handler (command + ribbon menu). */
  private async pruneBackups(): Promise<void> {
    const svc = new BackupService(this.app, this.entityService, this.query);
    const n = await svc.prune(14);
    new Notice(`Pruned ${n} old backup(s)`);
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
      daemon: { ...DEFAULT_SETTINGS.daemon!, ...(loaded?.daemon ?? {}) },
      transcription: {
        ...DEFAULT_SETTINGS.transcription!,
        ...(loaded?.transcription ?? {}),
      },
      features: mergeFeatureSettings(loaded?.features),
      showAdvanced: {
        ...DEFAULT_SETTINGS.showAdvanced,
        ...(loaded?.showAdvanced ?? {}),
      },
    };
    // Mint a stable, non-repeatable install id ONCE and persist it, so every
    // chat/audit trace can be attributed to this install in a multi-user estate.
    if (!isId(this.settings.installId, "inst")) {
      this.settings.installId = newInstallId();
      await this.saveData(this.settings).catch(() => undefined);
    }
  }
  async saveSettings(): Promise<void> {
    // SEC-01: never persist secrets to data.json. The cloud API key lives in
    // the credential chain (OS keychain / KeyVault); the in-memory settings
    // copy is session-only. Persist a redacted clone.
    // SEC-07: the bridge pairing token is a shared secret — strip it too; the
    // durable copy lives in the credential chain under bridge:pairing-token.
    const redacted: SauceGraphSettings = {
      ...this.settings,
      copilot: { ...this.settings.copilot, apiKey: "" },
      ...(this.settings.bridge
        ? { bridge: { ...this.settings.bridge, pairingToken: "" } }
        : {}),
      // SEC-07: the daemon pairing token is a shared secret — strip it too; the
      // durable copy lives in the chain under daemon:pairing-token.
      ...(this.settings.daemon
        ? { daemon: { ...this.settings.daemon, pairingToken: "" } }
        : {}),
    };
    await this.saveData(redacted);
    // SEC-07: keep the durable bridge-token copy in the chain in sync with the
    // in-memory token (the settings UI sets the token then calls saveSettings;
    // it does not touch the chain). Direct put — must NOT recurse into save.
    const tok = this.settings.bridge?.pairingToken;
    if (tok && this.credentialChain) {
      await this.credentialChain
        .put(this.bridgePairingService(), tok)
        .catch(() => {
          /* no writable source: token survives in memory for this session */
        });
    }
    // SEC-07: same for the daemon token.
    const dtok = this.settings.daemon?.pairingToken;
    if (dtok && this.credentialChain) {
      await this.credentialChain
        .put(this.daemonPairingService(), dtok)
        .catch(() => {
          /* no writable source: token survives in memory for this session */
        });
    }
    this.syncEmbeddingConfig();
  }

  /** Credential-chain service id for the active copilot provider's API key.
   *  Matches the onboarding wizard's vaultServiceFor() convention. */
  copilotKeyService(): string {
    return `copilot:${this.settings.copilot.provider}:api-key`;
  }

  /** SEC-07: credential-chain service id for the mobile-bridge pairing token.
   *  The token is a shared secret — like the copilot key it must never land in
   *  data.json plaintext; saveSettings() redacts it, the durable copy lives in
   *  the encrypted chain. */
  bridgePairingService(): string {
    return "bridge:pairing-token";
  }

  /** SEC-07: credential-chain service id for the sauce-crm-daemon pairing token.
   *  Like the bridge token, redacted from data.json; durable copy in the chain. */
  daemonPairingService(): string {
    return "daemon:pairing-token";
  }

  /** SEC-07: one-time migration + hydration of the daemon pairing token,
   *  mirroring the bridge-token flow. Awaited BEFORE the boot daemon probe so a
   *  paired daemon's token is in memory when the client is built. */
  private async migrateDaemonPairingToken(): Promise<void> {
    if (!this.credentialChain || !this.settings.daemon) return;
    const svc = this.daemonPairingService();
    const legacy = this.settings.daemon.pairingToken;
    if (legacy) {
      try {
        await this.credentialChain.put(svc, legacy);
      } catch {
        return; // No writable source: keep in memory (never re-persisted plain).
      }
      await this.saveSettings();
    } else {
      const stored = await this.credentialChain.get(svc).catch(() => null);
      if (stored) this.settings.daemon.pairingToken = stored;
    }
  }

  /** SEC-07: one-time migration + hydration of the bridge pairing token,
   *  mirroring the copilot-key flow. Awaited BEFORE refreshBridge() so the
   *  bridge starts with the token already in memory. */
  private async migrateBridgePairingToken(): Promise<void> {
    if (!this.credentialChain || !this.settings.bridge) return;
    const svc = this.bridgePairingService();
    const legacy = this.settings.bridge.pairingToken;
    if (legacy) {
      // Pre-SEC-07 data.json carried the token in plaintext: move it into the
      // chain, then scrub disk via saveSettings()'s redaction.
      try {
        await this.credentialChain.put(svc, legacy);
      } catch {
        // No writable source: keep in memory (still never re-persisted plain).
        return;
      }
      await this.saveSettings();
    } else {
      const stored = await this.credentialChain.get(svc).catch(() => null);
      if (stored) this.settings.bridge.pairingToken = stored;
    }
  }

  /** Durably store the copilot API key in the encrypted credential chain
   *  (OS keychain → KeyVault). Keeps the session copy in memory for the
   *  embedding config; data.json never sees it. */
  /** Whether an encrypted credential is actually persisted (vault KeyVault / OS
   *  keychain) for the active copilot provider — distinct from the session-only
   *  in-memory `settings.copilot.apiKey`. Drives the settings key-status line so
   *  the operator can see a key really landed in the vault, not just this run. */
  async hasCopilotKey(): Promise<boolean> {
    try {
      const v = await this.credentialChain?.get(this.copilotKeyService());
      return typeof v === "string" && v.trim().length > 0;
    } catch {
      return false;
    }
  }

  /**
   * Vault status for the Settings indicator: whether an encrypted store is
   * available (OS keychain → KeyVault), the per-source breakdown, and which
   * known secrets are actually stored at rest. Probes are read-only.
   */
  async vaultStatus(): Promise<{
    encryptedAtRest: boolean;
    sources: { label: string; available: boolean; active: boolean }[];
    secrets: { label: string; service: string; present: boolean }[];
  }> {
    const chain = this.credentialChain;
    const sources = chain?.describe?.() ?? [];
    const probe = async (label: string, service: string) => ({
      label,
      service,
      present: !!(await chain?.get(service).catch(() => null))?.trim(),
    });
    // Probe the cloud/gateway providers + the shared pairing tokens.
    const cloud = ["anthropic", "openai", "nim", "bifrost", "openrouter", "groq", "gemini"];
    const secrets = await Promise.all([
      ...cloud.map((p) => probe(`${p} API key`, `copilot:${p}:api-key`)),
      probe("Mobile bridge pairing token", "bridge:pairing-token"),
      probe("Daemon pairing token", "daemon:pairing-token"),
    ]);
    return {
      encryptedAtRest: chain?.available() ?? false,
      sources,
      secrets: secrets.filter((s) => s.present || s.service.startsWith("copilot:")),
    };
  }

  // ── Brain build (snowflake matrix) ────────────────────────────────────────
  /** A provider is "configured" when it can actually answer: local providers
   *  need no key; cloud providers need a stored/session key. */
  async isProviderConfigured(): Promise<boolean> {
    const p = this.settings.copilot?.provider;
    if (!p) return false;
    if (p === "lmstudio" || p === "ollama" || p === "lmstudio-sdk") return true;
    return !!this.settings.copilot?.apiKey || (await this.hasCopilotKey());
  }

  isBrainReady(): boolean {
    return this.brainState === "ready";
  }

  /** Stable id for the acting agent, used to auto-stamp audit entries. Reflects
   *  the active AI model so the audit shows which agent made a change. */
  currentAgentId(): string {
    const c = this.settings.copilot;
    if (c?.provider && c?.model) return `sauceom/${c.provider}:${c.model}`;
    if (c?.provider) return `sauceom/${c.provider}`;
    return "sauceom/user";
  }

  /** Push the brain (manifest + crystal digests) to the hosted SauceDB edge.
   *  Best-effort; failures degrade to local-only and surface a Notice. */
  private async syncBrainToSauceDb(manifest: unknown): Promise<void> {
    if (!this.sauceDb) return;
    const act = activity.start("SauceDB: syncing brain to hosted edge…");
    let digests: Record<string, unknown> | undefined;
    try {
      const p = `${this.settings.brainFolder ?? DEFAULT_PATHS.brain}/brain-crystal.json`;
      if (await this.app.vault.adapter.exists(p)) {
        digests = JSON.parse(await this.app.vault.adapter.read(p)).entries;
      }
    } catch {
      /* digests are optional in the payload */
    }
    const r = await this.sauceDb.syncBrain({
      manifest,
      ...(digests ? { digests } : {}),
    });
    if (r.ok) act.succeed("SauceDB: brain synced to your hosted edge.");
    else act.fail("SauceDB: " + r.detail);
  }

  /** Build a BrainFile view of a note from the metadata cache. */
  private brainFileFor(f: TFile): BrainFile {
    const cache = this.app.metadataCache.getFileCache(f);
    const fm =
      (cache?.frontmatter as Record<string, unknown> | undefined) ?? {};
    const tags = new Set<string>();
    for (const t of cache?.tags ?? []) tags.add(t.tag);
    const fmTags = fm.tags;
    if (Array.isArray(fmTags)) for (const t of fmTags) tags.add(String(t));
    else if (typeof fmTags === "string") tags.add(fmTags);
    return {
      path: f.path,
      mtime: f.stat.mtime,
      read: () => this.app.vault.cachedRead(f),
      frontmatter: fm,
      tags: [...tags],
    };
  }

  /** Load the persisted brain; auto-build once a provider is configured and no
   *  brain exists yet. Already-built vaults skip the full rebuild (incremental
   *  hooks keep them current). Non-blocking. */
  async maybeAutoBuildBrain(): Promise<void> {
    if (!this.brainBuilder) return;
    // Realtime alert: on every launch/reload we check the brain index and tell
    // the user the outcome (up to date / vault changed → updating / building).
    const act = activity.start("Sauce Brain: checking index…");
    await this.brainBuilder.load();
    const intact = await this.brainBuilder.isIntact();
    const manifest = this.brainBuilder.getManifest();
    const vaultCount = this.app.vault.getMarkdownFiles().length;
    // The vault can change while Obsidian is closed; if the indexed file count
    // drifts materially from the live vault, the brain is stale → rebuild.
    const drifted =
      manifest != null &&
      Math.abs(manifest.files - vaultCount) > Math.max(5, vaultCount * 0.1);
    // Already complete and current → ready, skip the rebuild (fast launch).
    if (intact && manifest && !drifted) {
      this.brainState = "ready";
      act.succeed(`Sauce Brain up to date · ${manifest.files} notes indexed`);
      return;
    }
    // Hand off to the background build (which raises its own start/done toast);
    // close the check toast with what we found so the reason is visible.
    act.succeed(
      intact && manifest
        ? `Sauce Brain: vault changed (${manifest.files}→${vaultCount}) — updating…`
        : "Sauce Brain: no index — building…",
      2500,
    );
    // Wiped / partial / never-built / drifted → rebuild on launch. The
    // deterministic build needs no provider (inference is layered at query
    // time), so it runs regardless; chat works during the build.
    void this.buildBrainBackground();
  }

  /** Full deterministic build of the snowflake matrix, in the background. The
   *  path/lexicon/taxonomy lattice and the crystal digest matrix build
   *  concurrently. Chat is usable throughout (with a not-yet-optimized warning).
   *  Idempotent: a second call returns the in-flight build. */
  async buildBrainBackground(): Promise<void> {
    if (this.brainBuildPromise) return this.brainBuildPromise;
    if (!this.brainBuilder || !this.copilot) return;
    this.brainState = "building";
    const run = (async () => {
      try {
        new Notice(
          "Sauce Brain: forming the snowflake matrix… you can chat now; answers sharpen once it's ready.",
        );
        const files = this.app.vault.getMarkdownFiles();
        const [manifest] = await Promise.all([
          this.brainBuilder!.buildAll(files.map((f) => this.brainFileFor(f))),
          this.copilot!.crystallizeAll(files.map((f) => f.path)),
        ]);
        this.brainState = "ready";
        new Notice(
          `Sauce Brain ready: ${manifest.pathCount} nodes · ${manifest.lexiconTerms} terms · ${manifest.taxonomy.types} types crystallized.`,
        );
        // SauceDB (paid): mirror the freshly-built brain to the hosted edge.
        if (canSyncSauceDb(this.settings.sauceDb)) {
          this.sauceDb?.setConfig(this.settings.sauceDb!);
          void this.syncBrainToSauceDb(manifest);
        }
      } catch (e) {
        this.brainState = "idle";
        new Notice(
          "Sauce Brain build failed: " +
            (e instanceof Error ? e.message : String(e)).slice(0, 140),
        );
      } finally {
        this.brainBuildPromise = null;
      }
    })();
    this.brainBuildPromise = run;
    return run;
  }

  /** Debounced incremental update: coalesce a burst of edits into one flush so
   *  realtime updates don't write the path matrix on every keystroke. */
  private scheduleBrainUpdate(f: TFile): void {
    this.brainDirty.add(f.path);
    if (this.brainFlushTimer !== null)
      window.clearTimeout(this.brainFlushTimer);
    this.brainFlushTimer = window.setTimeout(
      () => void this.flushBrainUpdates(),
      1500,
    );
  }

  private async flushBrainUpdates(): Promise<void> {
    this.brainFlushTimer = null;
    if (this.unloaded) return; // PLC-04: do not write after teardown (BUG-004)
    const paths = [...this.brainDirty];
    this.brainDirty.clear();
    if (!paths.length) return;
    // Realtime alert: incremental re-crystallization of edited notes.
    const act = activity.start(
      `Sauce Brain: updating ${paths.length} note${paths.length === 1 ? "" : "s"}…`,
    );
    let n = 0;
    try {
      for (const p of paths) {
        const f = this.app.vault.getAbstractFileByPath(p);
        if (f instanceof TFile) {
          await this.brainBuilder?.updateFile(this.brainFileFor(f));
          n++;
        }
      }
      act.succeed(
        `Sauce Brain: ${n} note${n === 1 ? "" : "s"} re-crystallized`,
        2500,
      );
    } catch (e) {
      act.fail(
        "Sauce Brain update failed: " +
          (e instanceof Error ? e.message : String(e)).slice(0, 100),
      );
    }
  }

  async storeCopilotKey(key: string): Promise<void> {
    this.settings.copilot.apiKey = key; // session-only (stripped on save)
    try {
      await this.credentialChain?.put(this.copilotKeyService(), key);
    } catch {
      new Notice(
        "Sauce CRM: no encrypted store available (vault locked, no OS keychain). " +
          "Key kept for this session only.",
      );
    }
    await this.saveSettings();
  }

  /** Absolute on-disk plugin dir (desktop only; undefined on mobile). Native
   *  LanceDB resolves paths against cwd and is require-installed into the
   *  plugin's own node_modules, so absolute resolution needs this. */
  absPluginDir(): string | undefined {
    const base =
      this.app.vault.adapter.getBasePath?.() ??
      this.app.vault.adapter.basePath ??
      "";
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
    return firstExistingModuleBase([
      this.lanceRuntimeBase(),
      this.absPluginDir(),
    ]);
  }

  /** MOB-BRIDGE-001 — construct the platform-appropriate memory backend.
   *  Desktop: LanceDB-backed (authoritative). Mobile: bridge-when-reachable
   *  composed over a lexical offline fallback. Safe to call repeatedly. */
  buildMemoryBackend(): void {
    const hasher = makeContentHasher(bridgeSha256Hex);
    if (!Platform.isMobile) {
      // Single-writer rule: when the daemon owns the store, the plugin's memory
      // surface is the remote daemon backend (local Lance was never opened).
      if (this.daemonBackend) {
        this.memory = this.daemonBackend;
        return;
      }
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

  /** sauce-crm-daemon: absolute vault base path used as the `x-sauce-vault`
   *  header so the daemon routes to THIS vault's store. Empty on mobile. */
  private vaultBasePath(): string {
    return (
      this.app.vault.adapter.getBasePath?.() ??
      this.app.vault.adapter.basePath ??
      ""
    );
  }

  /** Resolve the daemon pairing token for this session. Prefers the in-memory
   *  settings copy; falls back to the OS-keychain credential source (which needs
   *  no Lance/v2, so this is safe to call during early boot before the full
   *  credentialChain exists). Returns "" when no token is available. */
  private async resolveDaemonToken(): Promise<string> {
    const inMem = this.settings.daemon?.pairingToken;
    if (inMem) return inMem;
    try {
      const src = makeSafeStorageCredentialSource(
        secretsFile(currentPathEnv()),
      );
      const stored = await src.get(this.daemonPairingService());
      return stored ?? "";
    } catch {
      return "";
    }
  }

  /** Build (or rebuild) the daemon MemoryBackend from current settings + token.
   *  Pure wiring — does not probe. Returns null when disabled, unpaired, or off
   *  the desktop. */
  private async buildDaemonBackend(): Promise<MemoryBackend | null> {
    if (Platform.isMobile) return null;
    const d = this.settings.daemon;
    if (!d?.enabled) return null;
    const token = await this.resolveDaemonToken();
    if (!token) return null;
    return createDaemonBackend({
      baseUrl: daemonBaseUrl(d.port),
      pairingToken: token,
      vaultBasePath: this.vaultBasePath(),
      requestUrl: (r) => requestUrl(r),
      sha256Hex: bridgeSha256Hex,
      hmacHex: bridgeHmacHex,
    });
  }

  /** Boot-time daemon detection. Probes GET /health; on success sets
   *  this.daemonHealth + this.daemonBackend and returns true so initV2 skips the
   *  local Lance store (single-writer rule). On any failure clears both and
   *  returns false (local path is used). Never throws. */
  async probeDaemonForBoot(): Promise<boolean> {
    this.daemonHealth = null;
    this.daemonBackend = null;
    const d = this.settings.daemon;
    if (Platform.isMobile || !d?.enabled) return false;
    let health: DaemonHealth | null = null;
    try {
      health = await probeDaemon(makeDaemonFetch(), { port: d.port });
    } catch {
      health = null;
    }
    if (!health) {
      this.logger.debug("sauce-crm-daemon not detected; using local backend", {
        port: d.port,
      });
      return false;
    }
    const backend = await this.buildDaemonBackend();
    if (!backend) {
      // Health OK but no token to authenticate /v1 calls — treat as unavailable
      // so we don't half-wire a backend that 401s. Operator must pair.
      this.logger.warn(
        "sauce-crm-daemon is up but no pairing token is set — pair it in settings",
      );
      return false;
    }
    this.daemonHealth = health;
    this.daemonBackend = backend;
    this.logger.event?.("daemon.connected", {
      version: health.version,
      lance: health.lance,
    });
    return true;
  }

  /** Re-probe the daemon and re-wire the memory backend live (the "Reconnect
   *  daemon" command). When the daemon transitions present→absent or absent→
   *  present we do NOT hot-swap the local Lance store mid-session (that would
   *  violate single-writer ordering already locked at boot); instead we surface
   *  a notice telling the operator to reload so the boot path re-runs cleanly. */
  async reconnectDaemon(): Promise<void> {
    const wasConnected = !!this.daemonBackend;
    const nowConnected = await this.probeDaemonForBoot();
    if (nowConnected && this.daemonHealth) {
      // Re-point the live memory surface at the (possibly fresh) daemon backend.
      this.memory = this.daemonBackend;
      new Notice(
        `sauce-crm-daemon connected (v${this.daemonHealth.version}, lance ` +
          `${this.daemonHealth.lance.available ? `dim ${this.daemonHealth.lance.dim}` : "warming"}).`,
      );
    } else if (wasConnected && !nowConnected) {
      new Notice(
        "sauce-crm-daemon is no longer reachable. Reload Obsidian to fall back " +
          "to the local backend.",
      );
    } else {
      new Notice(
        "sauce-crm-daemon not detected. Reload Obsidian after starting it.",
      );
    }
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
    // Realtime alert: enrichment is a background AI task on the note's content.
    const act = activity.start(`SauceBot: enriching ${file.basename}…`);
    try {
      const raw = await this.app.vault.cachedRead(file);
      const input: EnrichmentInput = {
        path: file.path,
        type,
        frontmatter: fm,
        body: raw.replace(/^---\n[\s\S]*?\n---\n?/, ""),
      };
      await this.enrichment.enrich(input);
      act.succeed(`Enriched ${file.basename}`, 2500);
    } catch (e) {
      act.fail(
        "Enrichment failed: " +
          (e instanceof Error ? e.message : String(e)).slice(0, 100),
      );
    }
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
        VIEW_EISENHOWER,
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
    // PLC-01: Obsidian modal instead of the forbidden blocking window.prompt().
    const pw = await this.promptText({
      title: "Enter master password to unlock vault",
      password: true,
      cta: "Unlock",
    });
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

  /** Build a node:fs-backed PathProbe for whisper binary validation, or null on
   *  a runtime without fs (mobile/sandboxed). */
  private makePathProbe(): PathProbe | null {
    try {
      const nodeRequire =
        typeof require !== "undefined"
          ? (require as (m: string) => unknown)
          : null;
      const fsMod = nodeRequire?.("fs") as
        | {
            statSync(p: string): { isFile(): boolean };
            accessSync(p: string, mode: number): void;
            constants: { X_OK: number };
          }
        | undefined;
      if (!fsMod) return null;
      return {
        isFile: (p) => {
          try {
            return fsMod.statSync(p).isFile();
          } catch {
            return false;
          }
        },
        isExecutable: (p) => {
          try {
            // On Windows X_OK is a no-op; statSync(isFile) above is the real gate.
            fsMod.accessSync(p, fsMod.constants.X_OK);
            return true;
          } catch {
            // Windows fallback: accessSync(X_OK) can throw EINVAL — treat a
            // readable regular file as runnable there.
            if (process.platform === "win32") {
              try {
                return fsMod.statSync(p).isFile();
              } catch {
                return false;
              }
            }
            return false;
          }
        },
      };
    } catch {
      return null;
    }
  }

  /** (Re)build the local Whisper engine from current settings and install it on
   *  the skill runtime. Idempotent — callable on load and after a settings
   *  change to the binary path / model. When fs is unavailable (mobile) or no
   *  binary path is configured, the transcriber is left unset and the daemon
   *  route / a clear Notice covers the absent state. */
  wireWhisperEngine(): void {
    if (!this.skills) return;
    // Part C: prefer the daemon route when it advertises whisper + the operator
    // opted in. Async token resolution runs in the background; until it resolves
    // (or if it fails) the local engine wired below covers the gap.
    void this.maybeWireDaemonTranscriber();
    try {
      const nodeRequire =
        typeof require !== "undefined"
          ? (require as (m: string) => unknown)
          : null;
      const fsMod = nodeRequire?.("fs") as
        | { promises: { readFile(p: string, enc: string): Promise<string> } }
        | undefined;
      const osMod = nodeRequire?.("os") as { tmpdir(): string } | undefined;
      const probe = this.makePathProbe();
      if (!fsMod || !osMod || !probe) {
        this.skills.setTranscriber(null);
        return;
      }
      const t = this.settings.transcription ?? DEFAULT_SETTINGS.transcription!;
      // No PATH guessing: an unset/relative path leaves the local engine
      // unconfigured (dispatch reports "not configured"; daemon route may cover).
      if (!t.binaryPath || !validateBinaryPath(t.binaryPath, probe).ok) {
        this.skills.setTranscriber(null);
        return;
      }
      this.skills.setTranscriber(
        new WhisperEngine({
          binPath: t.binaryPath,
          pathProbe: probe,
          readText: async (p) => {
            try {
              return await fsMod.promises.readFile(p, "utf8");
            } catch {
              return null;
            }
          },
          outputDir: osMod.tmpdir(),
          defaultModel: t.model || "large-v3-turbo",
          registry: this.childProcs,
          consent: {
            ask: async (req) => {
              const r = await this.approvalGate.ask(req);
              return { approved: r.approved };
            },
          },
          audit: async (op, entityId, details) => {
            const al = this.v2?.auditLog;
            if (!al) return;
            await al.append({
              ts: Date.now(),
              op,
              entityId,
              agentId: null,
              integration: null,
              beforeHash: null,
              afterHash: null,
              details,
            });
          },
        }),
      );
    } catch {
      /* desktop-only; mobile uses cloud/bridge STT */
    }
  }

  /** Part C: when the daemon is connected, advertises whisper, and the operator
   *  prefers it, install the daemon-backed transcriber (zero local spawn). On
   *  any miss (not enabled, no token, daemon lacks whisper) this is a no-op and
   *  the local engine wired by wireWhisperEngine stands. */
  private async maybeWireDaemonTranscriber(): Promise<void> {
    if (!this.skills) return;
    const t = this.settings.transcription ?? DEFAULT_SETTINGS.transcription!;
    if (!t.preferDaemon) return;
    const d = this.settings.daemon;
    if (Platform.isMobile || !d?.enabled) return;
    if (!daemonHasWhisper(this.daemonHealth)) return;
    const token = await this.resolveDaemonToken();
    if (!token) return;
    const nodeRequire =
      typeof require !== "undefined"
        ? (require as (m: string) => unknown)
        : null;
    const fsMod = nodeRequire?.("fs") as
      | { promises: { readFile(p: string): Promise<Buffer> } }
      | undefined;
    if (!fsMod) return;
    try {
      this.skills.setTranscriber(
        createDaemonTranscriber({
          baseUrl: daemonBaseUrl(d.port),
          pairingToken: token,
          requestUrl: (r) => requestUrl(r),
          sha256Hex: bridgeSha256Hex,
          hmacHex: bridgeHmacHex,
          readAudioBase64: async (p) =>
            (await fsMod.promises.readFile(p)).toString("base64"),
        }),
      );
      this.logger.event?.("daemon.transcriber.wired", { port: d.port });
    } catch {
      /* leave the local engine in place */
    }
  }

  /** Settings "Detect" action: probe common ABSOLUTE install locations for a
   *  whisper binary and return the ones that exist + are executable. We never
   *  auto-apply — the settings UI surfaces the hits and the operator picks one.
   *  No PATH lookup, no spawning here (validation is fs-only). */
  detectWhisperBinaries(): string[] {
    const probe = this.makePathProbe();
    if (!probe) return [];
    let home = "";
    try {
      const nodeRequire =
        typeof require !== "undefined"
          ? (require as (m: string) => unknown)
          : null;
      const osMod = nodeRequire?.("os") as { homedir(): string } | undefined;
      home = osMod?.homedir() ?? "";
    } catch {
      home = "";
    }
    if (!home) return [];
    return candidateBinaryPaths(process.platform, home).filter(
      (p) => validateBinaryPath(p, probe).ok,
    );
  }

  /** Settings "Test transcription" action: validate the configured binary path
   *  and run a single `--help` (exit-0) probe through the hardened spawn util —
   *  no audio, no model download. Returns a human-readable result string. */
  async testWhisperBinary(): Promise<{ ok: boolean; message: string }> {
    const t = this.settings.transcription ?? DEFAULT_SETTINGS.transcription!;
    const probe = this.makePathProbe();
    if (!probe) {
      return { ok: false, message: "Spawning is unavailable on this runtime." };
    }
    const v = validateBinaryPath(t.binaryPath, probe);
    if (!v.ok) return { ok: false, message: v.reason ?? "invalid binary path" };
    const { execFileNoThrow } = await import("./utils/execFileNoThrow");
    const r = await execFileNoThrow(t.binaryPath, ["--help"], {
      timeoutMs: 10_000,
      registry: this.childProcs,
    });
    if (r.code === 0) {
      return {
        ok: true,
        message: "Whisper binary responded (--help, exit 0).",
      };
    }
    return {
      ok: false,
      message: `Probe failed (exit ${r.code ?? "n/a"}): ${
        r.stderr || r.error || "no output"
      }`,
    };
  }

  override async onunload(): Promise<void> {
    // PLC-04: stop realtime handlers before any teardown begins.
    this.unloaded = true;
    // Release the copilot keep-warm interval so a disabled plugin stops pinging.
    this.copilot?.dispose();
    // S8: terminate any whisper child still running so a disabled plugin never
    // leaves an orphaned transcription process behind.
    try {
      this.childProcs.killAll();
    } catch {
      /* best-effort */
    }
    // Abort any in-flight full-vault rebuild so onunload doesn't leave a
    // detached resync writing to a closing mirror. MirrorSync.close() also
    // halts the resync at its next batch boundary via the `closed` flag.
    this.activeResync?.abort();
    this.activeResync?.statusEl?.remove();
    this.activeResync = null;
    this.mirrorSync?.close();
    if (this.viewRefreshTimer !== null)
      window.clearTimeout(this.viewRefreshTimer);
    // A brain-flush timer armed within ~1.5s of unload must not fire and write
    // the brain matrix after teardown (BUG-004).
    if (this.brainFlushTimer !== null)
      window.clearTimeout(this.brainFlushTimer);
    this.wiredSvc?.dispose();
    // PLC-03: await async teardown instead of dropping the promises on the floor.
    await this.bridgeService?.stop();
    await teardownV2(this.v2);
    this.logger?.info?.("Sauce Graph unloaded");
  }
}
