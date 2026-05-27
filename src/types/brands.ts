// R-006 — Branded ID types. The canonical home (DEC-004) for every ID-shaped
// string the plugin passes across boundaries.
//
// A branded type is `string & Brand<"X">`. Key property: a branded value IS
// assignable to `string` (so existing string-typed consumers keep compiling),
// but a raw `string` is NOT assignable to the brand without going through its
// single constructor. That makes "passing a CommandId where a ViewTypeId is
// expected" a compile error, while allowing fully incremental adoption — no big
// bang rewire required.
//
// Per R-006: exactly ONE constructor (`asX`) and ONE guard (`isX`) per brand.
// The `as X` inside each constructor is the sanctioned single cast for that
// brand (the only place a raw string is blessed into the branded type).

declare const __brand: unique symbol;

/** Nominal brand tag. */
export type Brand<B extends string> = { readonly [__brand]: B };

// ── ID brands ────────────────────────────────────────────────────────────────

/** An Obsidian view type id (e.g. "sauce-copilot-chat"). */
export type ViewTypeId = string & Brand<"ViewTypeId">;
/** An Obsidian command id. */
export type CommandId = string & Brand<"CommandId">;
/** A plugin settings key. */
export type SettingKey = string & Brand<"SettingKey">;
/** An Obsidian plugin id (manifest.id). */
export type PluginId = string & Brand<"PluginId">;
/** A vault-relative note path (e.g. "people/Alice.md"). */
export type NotePath = string & Brand<"NotePath">;
/** A workspace leaf id. */
export type LeafId = string & Brand<"LeafId">;

// ── constructors (the sole blessing point per brand) ──────────────────────────

export const asViewTypeId = (s: string): ViewTypeId => s as ViewTypeId;
export const asCommandId = (s: string): CommandId => s as CommandId;
export const asSettingKey = (s: string): SettingKey => s as SettingKey;
export const asPluginId = (s: string): PluginId => s as PluginId;
export const asNotePath = (s: string): NotePath => s as NotePath;
export const asLeafId = (s: string): LeafId => s as LeafId;

// ── guards ────────────────────────────────────────────────────────────────────

/** A view type id is a non-empty string. */
export const isViewTypeId = (s: unknown): s is ViewTypeId =>
  typeof s === "string" && s.length > 0;
/** A command id is a non-empty string. */
export const isCommandId = (s: unknown): s is CommandId =>
  typeof s === "string" && s.length > 0;
/** A setting key is a non-empty string. */
export const isSettingKey = (s: unknown): s is SettingKey =>
  typeof s === "string" && s.length > 0;
/** A plugin id is a non-empty string. */
export const isPluginId = (s: unknown): s is PluginId =>
  typeof s === "string" && s.length > 0;
/** A note path is a non-empty, vault-relative (non-absolute) string. */
export const isNotePath = (s: unknown): s is NotePath =>
  typeof s === "string" && s.length > 0 && !s.startsWith("/");
/** A leaf id is a non-empty string. */
export const isLeafId = (s: unknown): s is LeafId =>
  typeof s === "string" && s.length > 0;
