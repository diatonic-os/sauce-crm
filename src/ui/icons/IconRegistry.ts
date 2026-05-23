import { addIcon, type Plugin } from "obsidian";

// Custom SVG icons are inlined here so the bundle stays self-contained —
// the Obsidian renderer cannot read from the filesystem at plugin-load
// time. SVG bodies must fit a 0 0 100 100 viewBox; the surrounding
// <svg> tag is added by addIcon().
//
// Each glyph is the minimal recognizable mark for the CRM concept.
// Refine in a follow-up turn — these are functional, not artful.

const CUSTOM_ICONS: ReadonlyArray<{ name: string; svg: string }> = [
  { name: "sauce-person",       svg: '<circle cx="50" cy="35" r="18" fill="none" stroke="currentColor" stroke-width="6"/><path d="M20 88 Q50 60 80 88" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round"/>' },
  { name: "sauce-org",          svg: '<rect x="20" y="30" width="60" height="55" fill="none" stroke="currentColor" stroke-width="6"/><rect x="34" y="46" width="8" height="8" fill="currentColor"/><rect x="58" y="46" width="8" height="8" fill="currentColor"/><rect x="34" y="66" width="8" height="8" fill="currentColor"/><rect x="58" y="66" width="8" height="8" fill="currentColor"/>' },
  { name: "sauce-touch",        svg: '<path d="M18 50 Q50 18 82 50" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round"/><circle cx="18" cy="50" r="6" fill="currentColor"/><circle cx="82" cy="50" r="6" fill="currentColor"/>' },
  { name: "sauce-addendum",     svg: '<rect x="22" y="18" width="50" height="64" fill="none" stroke="currentColor" stroke-width="6"/><path d="M34 36 L60 36 M34 50 L60 50 M34 64 L52 64" stroke="currentColor" stroke-width="5" stroke-linecap="round"/><circle cx="78" cy="78" r="10" fill="currentColor"/>' },
  { name: "sauce-intro",        svg: '<circle cx="28" cy="50" r="14" fill="none" stroke="currentColor" stroke-width="6"/><circle cx="72" cy="50" r="14" fill="none" stroke="currentColor" stroke-width="6"/><path d="M42 50 L58 50" stroke="currentColor" stroke-width="6" stroke-linecap="round"/>' },
  { name: "sauce-promote",      svg: '<path d="M50 18 L80 50 L62 50 L62 84 L38 84 L38 50 L20 50 Z" fill="none" stroke="currentColor" stroke-width="6" stroke-linejoin="round"/>' },
  { name: "sauce-compat",       svg: '<rect x="18" y="18" width="30" height="30" fill="none" stroke="currentColor" stroke-width="6"/><rect x="52" y="18" width="30" height="30" fill="none" stroke="currentColor" stroke-width="6"/><rect x="18" y="52" width="30" height="30" fill="none" stroke="currentColor" stroke-width="6"/><rect x="52" y="52" width="30" height="30" fill="currentColor"/>' },
  { name: "sauce-heatmap",      svg: '<rect x="18" y="18" width="20" height="20" fill="currentColor" opacity=".3"/><rect x="40" y="18" width="20" height="20" fill="currentColor" opacity=".6"/><rect x="62" y="18" width="20" height="20" fill="currentColor"/><rect x="18" y="40" width="20" height="20" fill="currentColor" opacity=".8"/><rect x="40" y="40" width="20" height="20" fill="currentColor" opacity=".4"/><rect x="62" y="40" width="20" height="20" fill="currentColor" opacity=".2"/><rect x="18" y="62" width="20" height="20" fill="currentColor" opacity=".5"/><rect x="40" y="62" width="20" height="20" fill="currentColor"/><rect x="62" y="62" width="20" height="20" fill="currentColor" opacity=".3"/>' },
  { name: "sauce-hierarchy",    svg: '<circle cx="50" cy="20" r="8" fill="currentColor"/><circle cx="24" cy="60" r="8" fill="currentColor"/><circle cx="50" cy="60" r="8" fill="currentColor"/><circle cx="76" cy="60" r="8" fill="currentColor"/><path d="M50 28 L24 52 M50 28 L50 52 M50 28 L76 52" stroke="currentColor" stroke-width="4" stroke-linecap="round"/>' },
  { name: "sauce-overdue",      svg: '<circle cx="50" cy="50" r="32" fill="none" stroke="currentColor" stroke-width="6"/><path d="M50 28 L50 52 L66 60" stroke="currentColor" stroke-width="6" stroke-linecap="round" fill="none"/>' },
  { name: "sauce-parent-vault", svg: '<path d="M50 14 L82 32 L82 72 L50 90 L18 72 L18 32 Z" fill="none" stroke="currentColor" stroke-width="6" stroke-linejoin="round"/><circle cx="50" cy="50" r="10" fill="currentColor"/>' },
  { name: "sauce-copilot",      svg: '<circle cx="50" cy="46" r="24" fill="none" stroke="currentColor" stroke-width="6"/><circle cx="40" cy="44" r="4" fill="currentColor"/><circle cx="60" cy="44" r="4" fill="currentColor"/><path d="M40 56 Q50 64 60 56" stroke="currentColor" stroke-width="4" fill="none" stroke-linecap="round"/><path d="M50 22 L50 14" stroke="currentColor" stroke-width="5" stroke-linecap="round"/>' },
  { name: "sauce-skill",        svg: '<path d="M50 14 L62 38 L88 38 L66 54 L74 80 L50 64 L26 80 L34 54 L12 38 L38 38 Z" fill="none" stroke="currentColor" stroke-width="5" stroke-linejoin="round"/>' },
  { name: "sauce-audit",        svg: '<rect x="22" y="14" width="50" height="66" fill="none" stroke="currentColor" stroke-width="6"/><path d="M32 30 L62 30 M32 44 L62 44 M32 58 L50 58" stroke="currentColor" stroke-width="4" stroke-linecap="round"/><circle cx="74" cy="74" r="12" fill="none" stroke="currentColor" stroke-width="5"/><path d="M82 82 L92 92" stroke="currentColor" stroke-width="5" stroke-linecap="round"/>' },
  { name: "sauce-ai-inbox",     svg: '<path d="M14 50 L30 30 L70 30 L86 50 L86 78 L14 78 Z" fill="none" stroke="currentColor" stroke-width="6" stroke-linejoin="round"/><path d="M14 50 L40 50 L46 58 L54 58 L60 50 L86 50" stroke="currentColor" stroke-width="6" fill="none"/><circle cx="50" cy="20" r="6" fill="currentColor"/>' },
  { name: "sauce-map",          svg: '<path d="M14 26 L36 18 L64 30 L86 22 L86 80 L64 88 L36 76 L14 84 Z" fill="none" stroke="currentColor" stroke-width="6" stroke-linejoin="round"/><path d="M36 18 L36 76 M64 30 L64 88" stroke="currentColor" stroke-width="4"/>' },
  { name: "sauce-sync",         svg: '<path d="M22 40 Q40 18 64 24 L72 16 L72 38 L52 38" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/><path d="M78 60 Q60 82 36 76 L28 84 L28 62 L48 62" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>' },
];

export class IconRegistry {
  private static registered = false;

  static register(_plugin: Plugin): void {
    // Idempotent — addIcon() registers globally for the Obsidian app
    // instance, so re-registering on plugin reload is a cheap no-op.
    if (IconRegistry.registered) return;
    for (const { name, svg } of CUSTOM_ICONS) {
      addIcon(name, svg);
    }
    IconRegistry.registered = true;
  }

  static getIconNames(): ReadonlySet<string> {
    return new Set(CUSTOM_ICONS.map((i) => i.name));
  }
}
