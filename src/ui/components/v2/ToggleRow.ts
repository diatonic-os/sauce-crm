// Reusable left↔right on/off switch row. Wraps Obsidian's native toggle (which
// renders as a sliding switch) so every feature-program setting uses one
// consistent control. Returns the Setting for further chaining.
import { Setting } from "obsidian";

export interface ToggleRowOpts {
  name: string;
  desc?: string;
  value: boolean;
  onChange: (value: boolean) => void | Promise<void>;
  /** Marks the row as advanced (adds the .sg-advanced class for the UI's
   *  show-advanced gating). */
  advanced?: boolean;
}

export function addToggleRow(container: HTMLElement, opts: ToggleRowOpts): Setting {
  const s = new Setting(container).setName(opts.name);
  if (opts.desc) s.setDesc(opts.desc);
  if (opts.advanced) s.settingEl.addClass("sg-advanced");
  s.addToggle((t) => t.setValue(opts.value).onChange((v) => { void opts.onChange(v); }));
  return s;
}
