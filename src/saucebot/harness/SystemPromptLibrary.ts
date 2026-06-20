// ─────────────────────────────────────────────────────────────────────────────
//  SYSTEM PROMPT LIBRARY — named, switchable system prompts over an injected
//  persistence host (PURE module).
//
//  This module is PURE: no Obsidian imports, no lancedb imports.
//  All state flows through the PromptHost interface.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A named system prompt with optional default flag and update timestamp.
 */
export interface SystemPrompt {
  /** Stable identifier for this prompt. */
  id: string;

  /** Human-readable name for this prompt. */
  title: string;

  /** The full prompt body (system message content). */
  body: string;

  /** If true, this prompt is the default when no explicit id is provided. */
  isDefault?: boolean;

  /** UNIX timestamp of last update (milliseconds). */
  updatedTs: number;
}

/**
 * Persistence interface for reading and writing prompt collections.
 *
 * Implementers must provide atomic read/write operations; the library
 * assumes these are durable.
 */
export interface PromptHost {
  /** Read all prompts from persistent storage. */
  read(): Promise<SystemPrompt[]>;

  /** Write all prompts to persistent storage (replaces previous state). */
  write(prompts: SystemPrompt[]): Promise<void>;
}

/**
 * Manages a library of named system prompts with optional default selection.
 *
 * ## Features
 *
 * - Create, read, update, delete prompts
 * - Automatic slug generation from titles (when id is omitted)
 * - Exclusive default selection (only one default at a time)
 * - Timestamp tracking on every update
 * - Full injection of persistence layer (PromptHost)
 * - Testable time function (for deterministic ts generation)
 *
 * ## Usage
 *
 * ```typescript
 * const lib = new SystemPromptLibrary(persistenceHost, () => Date.now());
 *
 * // Create
 * const prompt = await lib.upsert({
 *   title: "My Prompt",
 *   body: "You are a helpful assistant."
 * });
 *
 * // List
 * const all = await lib.list();
 *
 * // Set as default
 * await lib.setDefault(prompt.id);
 *
 * // Resolve (by id, falls back to default, then empty string)
 * const body = await lib.resolve(prompt.id);
 * ```
 */
export class SystemPromptLibrary {
  private host: PromptHost;
  private now: () => number;

  /**
   * @param host Persistence layer for reading/writing prompts
   * @param now Clock function returning current timestamp in ms (default: () => Date.now())
   */
  constructor(host: PromptHost, now?: () => number) {
    this.host = host;
    this.now = now ?? (() => Date.now());
  }

  /**
   * List all prompts currently in storage.
   */
  async list(): Promise<SystemPrompt[]> {
    return await this.host.read();
  }

  /**
   * Create or replace a prompt.
   *
   * If `id` is omitted, a slug is generated from `title`. If a prompt
   * with the same id already exists, it is replaced.
   *
   * `updatedTs` is set to the current time.
   *
   * @param input Object with title, body, and optional id
   * @returns The created or updated prompt
   */
  async upsert(input: {
    id?: string;
    title: string;
    body: string;
  }): Promise<SystemPrompt> {
    const prompts = await this.host.read();
    const id = input.id ?? this.slugify(input.title);
    const updatedTs = this.now();

    const newPrompt: SystemPrompt = {
      id,
      title: input.title,
      body: input.body,
      updatedTs,
    };

    // Remove existing prompt with same id (if any)
    const filtered = prompts.filter((p) => p.id !== id);

    // Add the new/updated prompt
    filtered.push(newPrompt);

    await this.host.write(filtered);
    return newPrompt;
  }

  /**
   * Remove a prompt by id.
   *
   * If the removed prompt was marked as default, the default flag is cleared.
   *
   * @param id Prompt id to remove
   * @returns true if a prompt was removed, false if id not found
   */
  async remove(id: string): Promise<boolean> {
    const prompts = await this.host.read();
    const beforeLen = prompts.length;
    const filtered = prompts.filter((p) => p.id !== id);

    if (filtered.length === beforeLen) {
      return false; // nothing removed
    }

    await this.host.write(filtered);
    return true;
  }

  /**
   * Set a prompt as the default.
   *
   * Clears the default flag from any previously-default prompt.
   * Only one prompt can be marked as default at a time.
   *
   * @param id Prompt id to set as default
   * @returns true if the prompt exists and was set, false if id not found
   */
  async setDefault(id: string): Promise<boolean> {
    const prompts = await this.host.read();
    const target = prompts.find((p) => p.id === id);

    if (!target) {
      return false; // prompt not found
    }

    // Clear default flag from all prompts, then set it on target
    const updated = prompts.map((p) => ({
      ...p,
      ...(p.id === id ? { isDefault: true } : {}),
      // Remove isDefault from others (undefined if not present)
      ...(p.id !== id && p.isDefault ? {} : {}),
    }));

    // Clean up: remove undefined isDefault flags from non-default prompts
    const cleaned = updated.map((p) => {
      const copy = { ...p };
      if (p.id !== id && copy.isDefault) {
        delete copy.isDefault;
      }
      return copy;
    });

    await this.host.write(cleaned);
    return true;
  }

  /**
   * Get the prompt marked as default, if any.
   *
   * @returns The default prompt, or null if none is set
   */
  async getDefault(): Promise<SystemPrompt | null> {
    const prompts = await this.host.read();
    const defaultPrompt = prompts.find((p) => p.isDefault);
    return defaultPrompt ?? null;
  }

  /**
   * Resolve a prompt body by id, with fallback chain.
   *
   * Resolution priority:
   * 1. If id is provided and found, return its body
   * 2. If no id provided (or id not found), return default body if set
   * 3. Otherwise, return empty string
   *
   * @param id Optional prompt id to resolve
   * @returns The prompt body, or empty string if not found
   */
  async resolve(id?: string): Promise<string> {
    const prompts = await this.host.read();

    // If explicit id provided, try to find it
    if (id) {
      const prompt = prompts.find((p) => p.id === id);
      if (prompt) {
        return prompt.body;
      }
    }

    // Fall back to default
    const defaultPrompt = prompts.find((p) => p.isDefault);
    if (defaultPrompt) {
      return defaultPrompt.body;
    }

    // Final fallback: empty string
    return "";
  }

  /**
   * Convert a title string into a stable slug for use as id.
   *
   * - Converts to lowercase
   * - Removes/replaces special characters
   * - Collapses multiple spaces to single hyphens
   * - Handles unicode gracefully (strips diacritics where possible)
   *
   * @param title The title to slugify
   * @returns A stable, lowercase id
   */
  private slugify(title: string): string {
    return (
      title
        // Normalize unicode (decompose accents)
        .normalize("NFKD")
        // Remove non-ASCII characters that remain after normalization
        .replace(/[̀-ͯ]/g, "")
        // Convert to lowercase
        .toLowerCase()
        // Replace non-alphanumeric and non-hyphen with spaces
        .replace(/[^\w\s-]/g, " ")
        // Collapse multiple spaces to single space
        .replace(/\s+/g, " ")
        // Trim whitespace
        .trim()
        // Replace spaces with hyphens
        .replace(/\s/g, "-")
        // Remove leading/trailing hyphens
        .replace(/^-+|-+$/g, "")
    );
  }
}
