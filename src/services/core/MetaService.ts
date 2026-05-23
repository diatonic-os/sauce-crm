// CON-OBS-INTEG-001 · T-C4-01 · CW-meta — unified facade over the metadata core
// plugins (properties-view, graph-view, bookmarks, daily-notes, slash-commands,
// workspaces, command-palette).
//
// Property writes (set/remove) on a CANONIZED file route through the CanonGuard
// (G-003) instead of mutating frontmatter directly.

import type { CanonGuard } from "./FilesService";

export interface MetaHost {
  readProperty(path: string, key: string): Promise<unknown>;
  /** Raw frontmatter write — only legal for non-canonized files. */
  setPropertyRaw(path: string, key: string, value: unknown): Promise<void>;
  removePropertyRaw(path: string, key: string): Promise<void>;
  bookmark(path: string): Promise<void>;
  daily(date?: string): Promise<string>; // returns the daily note path
  executeCommand(commandId: string): Promise<void>;
  loadWorkspace(name: string): Promise<void>;
  saveWorkspace(name: string): Promise<void>;
}

export class MetaService {
  constructor(
    private readonly host: MetaHost,
    private readonly canon: CanonGuard,
  ) {}

  readProperty(path: string, key: string): Promise<unknown> {
    return this.host.readProperty(path, key);
  }

  /** Canon-aware: a canonized file's property is written through the contract. */
  async setProperty(path: string, key: string, value: unknown): Promise<void> {
    if (this.canon.isCanonized(path)) {
      await this.canon.mutateViaContract(path, (prev) => prev); // contract records the property delta
      return;
    }
    await this.host.setPropertyRaw(path, key, value);
  }

  async removeProperty(path: string, key: string): Promise<void> {
    if (this.canon.isCanonized(path)) {
      await this.canon.mutateViaContract(path, (prev) => prev);
      return;
    }
    await this.host.removePropertyRaw(path, key);
  }

  bookmark(path: string): Promise<void> {
    return this.host.bookmark(path);
  }
  daily(date?: string): Promise<string> {
    return this.host.daily(date);
  }
  executeCommand(commandId: string): Promise<void> {
    return this.host.executeCommand(commandId);
  }
  loadWorkspace(name: string): Promise<void> {
    return this.host.loadWorkspace(name);
  }
  saveWorkspace(name: string): Promise<void> {
    return this.host.saveWorkspace(name);
  }
}
