// Minimal PluginSettings type — referenced by EndpointRegistry. The full
// plugin settings live as SauceGraphSettings; this narrow view exists so
// the inference subsystem can import a settings shape without pulling the
// entire settings tree.

export interface PluginSettings {
  /** Discovered LLM endpoint URLs (e.g. http://localhost:11434). */
  endpoints: string[];
  /** Preferred endpoint id when multiple are reachable. */
  preferredEndpointId?: string;
  /** Persist the current shape to disk. The plugin host wires this to
   *  Obsidian's Plugin.saveData(); standalone callers can leave it
   *  unset. */
  save?: () => Promise<void>;
}

export const DEFAULT_PLUGIN_SETTINGS: PluginSettings = {
  endpoints: [],
};
