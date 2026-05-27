// R-004 / AX-002 — Ambient augmentation of Obsidian's public types with the
// handful of UNDOCUMENTED-but-real internal APIs this plugin depends on.
//
// Why this exists: Obsidian ships partial type definitions. Accessing real
// runtime APIs like `app.commands.executeCommandById` or the desktop adapter's
// `getBasePath()` previously required `(app as any).commands` casts scattered
// across the codebase. Centralizing the shapes here as a `declare module`
// augmentation lets call sites use the APIs with full type-checking and ZERO
// casts — one canonical narrow shape instead of N untyped `as any` holes.
//
// This file is ambient: being part of the tsconfig `include` (src/**/*.ts) is
// enough for the augmentation to apply project-wide. The `import "obsidian"`
// below makes it a module so the augmentation merges rather than replaces.

import "obsidian";

declare module "obsidian" {
  /** Obsidian's internal command registry (not in the public .d.ts). */
  interface App {
    commands?: {
      executeCommandById?(id: string): boolean;
      commands?: Record<string, unknown>;
    };
    setting?: {
      open?(): void;
      openTabById?(id: string): void;
    };
  }

  /** Desktop `FileSystemAdapter` exposes the absolute vault base path; the base
   *  `DataAdapter` type does not. Both are optional so mobile code stays honest
   *  (it must null-check before relying on a filesystem path). */
  interface DataAdapter {
    basePath?: string;
    getBasePath?(): string;
  }
}
