// Canonical home for the renderer-safe lazy-`require` convention.
//
// Obsidian's Electron renderer exposes a CommonJS `require` (on the desktop)
// that lets us reach Node builtins (`fs`, `path`, `os`, …) and optional native
// modules WITHOUT bundling them — on mobile / headless runtimes `require` is
// absent and these helpers degrade instead of crashing.
//
// The only cast to `NodeRequire` in the whole plugin lives HERE (in
// `resolveNodeRequire`). Every node-builtin consumer routes through one of the
// three helpers below rather than re-hand-rolling
// `(globalThis as unknown as { require?: NodeRequire }).require ?? …`.

/** Resolve the ambient CommonJS `require`, or `undefined` when none exists
 *  (mobile / sandboxed renderer). The single sanctioned `NodeRequire` cast. */
export function resolveNodeRequire(): NodeRequire | undefined {
  const fromGlobal = (globalThis as unknown as { require?: NodeRequire })
    .require;
  if (typeof fromGlobal === "function") return fromGlobal;
  return typeof require !== "undefined" ? require : undefined;
}

/** Soft lazy-require: returns the module typed as `T`, or `undefined` when
 *  `require` is unavailable or the module fails to load. For OPTIONAL node
 *  builtins where the caller has a graceful fallback (renderer-safe). */
export function tryRequire<T = unknown>(mod: string): T | undefined {
  const req = resolveNodeRequire();
  if (typeof req !== "function") return undefined;
  try {
    return req(mod) as T;
  } catch {
    return undefined;
  }
}

/** Hard lazy-require: returns the module typed as `T`, or throws a clear,
 *  install-actionable error when `require` is unavailable or the module is not
 *  installed. For MANDATORY optional parsers/native modules. */
export function lazyRequire<T = unknown>(mod: string): T {
  const req = resolveNodeRequire();
  if (typeof req !== "function")
    throw new Error(`require() unavailable — cannot load ${mod}`);
  try {
    return req(mod) as T;
  } catch {
    throw new Error(
      `Module "${mod}" is not installed. Run: npm install ${mod} --prefix <pluginDir>`,
    );
  }
}
