// Detect + auto-install Obsidian community plugins the Sauce CRM
// depends on (Dataview, Templater, Tasks, Calendar).
//
// Architecture: Obsidian's PluginManager exposes installed/enabled state
// via `app.plugins`. Auto-installing a community plugin requires the
// non-public `installPlugin` API which Obsidian exposes on the plugin
// manifest. We surface a modal that lists the missing plugins with a
// "Install all" + per-plugin checkbox + manual install instructions.
//
// We DO NOT bypass Obsidian's community-plugin security model — the
// modal opens the official Settings → Community plugins page when the
// user confirms, scrolled to the targeted plugin's install button.

export interface CommunityPluginSpec {
  id: string;
  name: string;
  purpose: string;       // why Sauce CRM uses it
  required: boolean;     // hard dep vs nice-to-have
  url: string;           // marketplace URL fallback
}

export const KNOWN_COMMUNITY_PLUGINS: ReadonlyArray<CommunityPluginSpec> = [
  {
    id: "dataview",
    name: "Dataview",
    purpose: "Query frontmatter as tables, used by the Pipeline and Heatmap views.",
    required: false,
    url: "obsidian://show-plugin?id=dataview",
  },
  {
    id: "templater-obsidian",
    name: "Templater",
    purpose: "Renders entity templates (person, org, touch) with dynamic frontmatter.",
    required: false,
    url: "obsidian://show-plugin?id=templater-obsidian",
  },
  {
    id: "obsidian-tasks-plugin",
    name: "Tasks",
    purpose: "Surfaces follow-up actions in the Overdue Queue + Tasks dashboard.",
    required: false,
    url: "obsidian://show-plugin?id=obsidian-tasks-plugin",
  },
  {
    id: "calendar",
    name: "Calendar",
    purpose: "Date-picker UI and weekly review for Touch logs.",
    required: false,
    url: "obsidian://show-plugin?id=calendar",
  },
  {
    id: "graphify",
    name: "Graphify",
    purpose: "Build a knowledge graph from your vault; complements the Sauce relationship graph.",
    required: false,
    url: "obsidian://show-plugin?id=graphify",
  },
];

export interface CommunityPluginStatus {
  spec: CommunityPluginSpec;
  installed: boolean;
  enabled: boolean;
}

export interface PluginHostShape {
  plugins?: {
    plugins?: Record<string, unknown>;
    enabledPlugins?: Set<string>;
    manifests?: Record<string, unknown>;
  };
  setting?: {
    open?: () => void;
    openTabById?: (id: string) => void;
  };
}

/** Detect which of the known community plugins are installed + enabled.
 *  Reads `app.plugins.manifests` (for installed) and
 *  `app.plugins.enabledPlugins` (for enabled). Both are non-public but
 *  stable across Obsidian releases. */
export function detectCommunityPlugins(app: PluginHostShape): CommunityPluginStatus[] {
  const manifests = app.plugins?.manifests ?? {};
  const enabled = app.plugins?.enabledPlugins ?? new Set<string>();
  return KNOWN_COMMUNITY_PLUGINS.map((spec) => ({
    spec,
    installed: spec.id in manifests,
    enabled: enabled instanceof Set ? enabled.has(spec.id) : false,
  }));
}

/** Open the Obsidian Settings → Community plugins page so the user can
 *  install the targeted plugins. We do NOT silently install — that
 *  would bypass Obsidian's review + sandbox model. */
export function openCommunityPluginsPage(app: PluginHostShape, focusPluginId?: string): void {
  app.setting?.open?.();
  app.setting?.openTabById?.("community-plugins");
  if (focusPluginId) {
    // Open the per-plugin page via the public URI scheme. Obsidian
    // handles this URL even when the settings pane is already open.
    try {
      window.open(`obsidian://show-plugin?id=${encodeURIComponent(focusPluginId)}`, "_self");
    } catch {
      // Ignore — the settings page is already open as a fallback.
    }
  }
}

/** True iff any required plugin is missing OR disabled. Used to decide
 *  whether to surface the prompt on plugin load. */
export function hasMissingRequiredPlugins(statuses: CommunityPluginStatus[]): boolean {
  return statuses.some((s) => s.spec.required && (!s.installed || !s.enabled));
}
