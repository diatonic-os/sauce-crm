// Plugin auto-configuration engine (VAULT-WORKSPACE-SPEC W3).
//
// Sauce CRM orchestrates the vault: when a supported core/community plugin is
// installed, Sauce can point it at the Sauce folder structure by writing a
// canonical settings profile into that plugin's data.json. Per operator
// decision the model is PROPOSE-DIFF → APPLY-ON-APPROVAL (never silent), with a
// backup + provenance trace before every write.
//
// Host access (Obsidian app.plugins / internalPlugins / data.json IO) is
// injected so the state-machine + diff logic is pure and unit-testable.

export type PluginKind = "core" | "community";

/** Lifecycle state of a supported plugin relative to its canonical profile. */
export type PluginState =
  | "not-installed" // no manifest present
  | "installed" // present but none of the canonical keys match yet
  | "configured" // every canonical key matches
  | "drift"; // installed + previously configured, but a canonical key changed

export interface CanonicalProfile {
  id: string;
  kind: PluginKind;
  label: string;
  /** Canonical settings Sauce wants merged into the plugin's data.json. Only
   *  these keys are compared/written; everything else in the plugin's config is
   *  left untouched. */
  settings: Record<string, unknown>;
}

export interface ConfigChange {
  key: string;
  from: unknown;
  to: unknown;
}
export interface PluginConfigStatus {
  profile: CanonicalProfile;
  state: PluginState;
  /** Canonical keys whose current value differs (drives the proposed diff). */
  changes: ConfigChange[];
}

/** Obsidian-side glue (injected). */
export interface PluginConfigHost {
  isInstalled(id: string, kind: PluginKind): boolean;
  readConfig(
    id: string,
    kind: PluginKind,
  ): Promise<Record<string, unknown> | null>;
  writeConfig(
    id: string,
    kind: PluginKind,
    data: Record<string, unknown>,
  ): Promise<void>;
  /** Persist a backup of the pre-write config (e.g. to the host backup target). */
  backupConfig(
    id: string,
    kind: PluginKind,
    data: Record<string, unknown> | null,
  ): Promise<void>;
}

export interface PluginConfigTrace {
  record(
    op: string,
    subject: string,
    kind: string,
    content: string,
    opts?: { meta?: Record<string, unknown> | null },
  ): Promise<unknown>;
}

/** Default canonical profiles for the supported set (operator-confirmed).
 *  Folder-based plugins are pointed at the Sauce workspace folders. Values are
 *  conservative; refine per vault as needed. */
export function defaultProfiles(): CanonicalProfile[] {
  return [
    {
      id: "daily-notes",
      kind: "core",
      label: "Daily Notes",
      settings: {
        folder: "_events/daily",
        format: "YYYY-MM-DD",
        template: "_templates/daily.md",
      },
    },
    {
      id: "templates",
      kind: "core",
      label: "Templates",
      settings: { folder: "_templates" },
    },
    {
      id: "obsidian-tasks-plugin",
      kind: "community",
      label: "Tasks",
      settings: {
        globalFilter: "",
        setDoneDate: true,
        autoSuggestInEditor: true,
      },
    },
    {
      id: "dataview",
      kind: "community",
      label: "Dataview",
      settings: { enableDataviewJs: false, refreshEnabled: true },
    },
    {
      id: "templater-obsidian",
      kind: "community",
      label: "Templater",
      settings: {
        templates_folder: "_templates",
        trigger_on_file_creation: false,
      },
    },
    {
      id: "calendar",
      kind: "community",
      label: "Calendar",
      settings: { weekStart: "locale", showWeeklyNote: false },
    },
  ];
}

function shallowEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export class PluginConfigService {
  constructor(
    private readonly host: PluginConfigHost,
    private readonly profiles: CanonicalProfile[] = defaultProfiles(),
    private readonly trace: PluginConfigTrace | null = null,
  ) {}

  list(): CanonicalProfile[] {
    return this.profiles;
  }

  /** Compute the state + canonical diff for one profile. */
  async status(profile: CanonicalProfile): Promise<PluginConfigStatus> {
    if (!this.host.isInstalled(profile.id, profile.kind)) {
      return { profile, state: "not-installed", changes: [] };
    }
    const current =
      (await this.host.readConfig(profile.id, profile.kind)) ?? {};
    const changes: ConfigChange[] = [];
    for (const [key, want] of Object.entries(profile.settings)) {
      if (!shallowEqual(current[key], want))
        changes.push({ key, from: current[key], to: want });
    }
    if (changes.length === 0) return { profile, state: "configured", changes };
    // "drift" iff at least one canonical key is present but differs (it was set
    // before and changed); otherwise it's freshly "installed" / unconfigured.
    const anyPresent = Object.keys(profile.settings).some((k) => k in current);
    return { profile, state: anyPresent ? "drift" : "installed", changes };
  }

  async statusAll(): Promise<PluginConfigStatus[]> {
    return Promise.all(this.profiles.map((p) => this.status(p)));
  }

  /** Apply the canonical profile: backup current config, merge canonical keys
   *  over it (leaving other keys intact), write, and trace. Returns the changes
   *  applied (empty when already configured / not installed). */
  async apply(profile: CanonicalProfile): Promise<ConfigChange[]> {
    const st = await this.status(profile);
    if (st.state === "not-installed" || st.changes.length === 0) return [];
    const current =
      (await this.host.readConfig(profile.id, profile.kind)) ?? {};
    await this.host.backupConfig(profile.id, profile.kind, current);
    const merged = { ...current, ...profile.settings };
    await this.host.writeConfig(profile.id, profile.kind, merged);
    await this.trace
      ?.record(
        "plugin-config",
        `plugin:${profile.id}`,
        "config",
        JSON.stringify({ applied: st.changes }),
        { meta: { kind: profile.kind, keys: st.changes.map((c) => c.key) } },
      )
      .catch?.(() => {});
    return st.changes;
  }

  /** Apply every profile that needs it (installed/drift). Returns a per-plugin
   *  summary. Caller gates this behind operator approval. */
  async applyAll(): Promise<{ id: string; applied: ConfigChange[] }[]> {
    const out: { id: string; applied: ConfigChange[] }[] = [];
    for (const p of this.profiles) {
      const applied = await this.apply(p);
      if (applied.length) out.push({ id: p.id, applied });
    }
    return out;
  }
}
