// ─────────────────────────────────────────────────────────────────────────────
//  BLOCK ORCHESTRATOR — deterministic, dependency-aware inference DAG executor
// ─────────────────────────────────────────────────────────────────────────────
//
//  WHY this exists
//  ───────────────
//  SauceBot's harness pipelines (verify, critique-revise, structured output)
//  need a lightweight DAG runtime that:
//    • enforces a well-defined execution order (topological sort)
//    • propagates outputs across blocks so later blocks see earlier results
//    • retries individual blocks in-place without re-running settled blocks
//    • skips dependents of a failed block while letting independent branches
//      complete — a single bad provider call must not collapse the whole graph
//    • gives callers a single, typed result bundle (vars + per-block records)
//
//  Design constraints
//  ──────────────────
//  • Pure TypeScript — zero imports from obsidian, lancedb, or any I/O layer.
//  • Strict TS: noUncheckedIndexedAccess + exactOptionalPropertyTypes.
//    – Index access yields T | undefined; always guarded before use.
//    – Optional props are OMITTED (not set to undefined) via conditional spread.
//  • Cycle and missing-dep errors are thrown synchronously during graph
//    validation, before any block runs.

// ─────────────────────────────────────────────────────────────────────────────
//  Types
// ─────────────────────────────────────────────────────────────────────────────

/** Shared variable bag threaded through every block. */
export type Vars = Record<string, unknown>;

/**
 * A single unit of work in the DAG.
 *
 * @property id      - Unique identifier. Used to declare `deps` relationships.
 * @property deps    - Block ids that must complete successfully before this one runs.
 * @property run     - Async function; receives accumulated vars, returns output vars
 *                     to merge into the shared bag.
 * @property retries - Total number of attempts allowed (default 1, meaning no retry).
 */
export interface Block {
  id: string;
  deps?: string[];
  run: (vars: Vars) => Promise<Vars>;
  retries?: number;
}

/**
 * Per-block execution record.
 *
 * @property id       - Corresponds to Block.id.
 * @property ok       - True if the block succeeded (any attempt).
 * @property outputs  - Merged outputs on success (omitted on failure).
 * @property error    - Error message on failure (omitted on success).
 * @property attempts - Number of attempts actually made (0 for skipped blocks).
 */
export interface BlockResult {
  id: string;
  ok: boolean;
  outputs?: Vars;
  error?: string;
  attempts: number;
}

/**
 * Overall result of a `runBlocks()` call.
 *
 * @property vars    - Final accumulated variable bag (initial + all successful outputs).
 * @property results - Ordered list of per-block records.
 * @property ok      - True only when every block succeeded.
 */
export interface OrchestrationResult {
  vars: Vars;
  results: BlockResult[];
  ok: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Graph utilities
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validates the dep graph and returns a topological order using Kahn's algorithm.
 * Throws a descriptive Error on missing deps or cycles.
 */
function topoSort(blocks: readonly Block[]): Block[] {
  const byId = new Map<string, Block>();
  for (const b of blocks) {
    byId.set(b.id, b);
  }

  // Validate: every declared dep must exist
  for (const b of blocks) {
    for (const dep of b.deps ?? []) {
      if (!byId.has(dep)) {
        throw new Error(
          `BlockOrchestrator: block "${b.id}" depends on unknown id "${dep}"`
        );
      }
    }
  }

  // Kahn's algorithm
  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>(); // dep → [blocks that depend on dep]

  for (const b of blocks) {
    if (!inDegree.has(b.id)) inDegree.set(b.id, 0);
    for (const dep of b.deps ?? []) {
      inDegree.set(b.id, (inDegree.get(b.id) ?? 0) + 1);
      const list = dependents.get(dep);
      if (list) {
        list.push(b.id);
      } else {
        dependents.set(dep, [b.id]);
      }
    }
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  const sorted: Block[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    const block = byId.get(id);
    if (!block) continue; // unreachable after validation
    sorted.push(block);

    for (const childId of dependents.get(id) ?? []) {
      const newDeg = (inDegree.get(childId) ?? 1) - 1;
      inDegree.set(childId, newDeg);
      if (newDeg === 0) queue.push(childId);
    }
  }

  if (sorted.length !== blocks.length) {
    throw new Error(
      "BlockOrchestrator: dependency cycle detected in block graph"
    );
  }

  return sorted;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Core executor
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Execute a set of blocks in dependency order, threading accumulated vars
 * through each one.
 *
 * Blocks are topologically sorted; each block receives the full accumulated
 * variable bag (initialVars + all prior successful outputs). Retry logic is
 * per-block. A block's dependents are skipped if the block ultimately fails;
 * independent branches run to completion regardless.
 *
 * @param blocks      - Unordered array of Block descriptors. Order does not
 *                      affect the execution sequence — deps determine that.
 * @param initialVars - Seed variables injected before the first block runs.
 * @returns           A single OrchestrationResult with final vars, per-block
 *                    records, and an overall `ok` flag.
 * @throws            If the dep graph contains a cycle or references an unknown id.
 */
export async function runBlocks(
  blocks: readonly Block[],
  initialVars: Vars = {}
): Promise<OrchestrationResult> {
  const sorted = topoSort(blocks); // throws on cycle / missing dep

  const vars: Vars = { ...initialVars };
  const results: BlockResult[] = [];
  /** Set of block ids that have failed (for transitive skip propagation). */
  const failed = new Set<string>();

  for (const block of sorted) {
    // Check if any upstream dep failed — if so, skip this block.
    const failedDep = (block.deps ?? []).find((d) => failed.has(d));
    if (failedDep !== undefined) {
      results.push({
        id: block.id,
        ok: false,
        error: `skipped: upstream ${failedDep} failed`,
        attempts: 0,
      });
      failed.add(block.id);
      continue;
    }

    const maxAttempts = block.retries ?? 1;
    let attempts = 0;
    let lastError: unknown;
    let succeeded = false;
    let outputs: Vars | undefined;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      attempts += 1;
      try {
        outputs = await block.run({ ...vars });
        succeeded = true;
        break;
      } catch (err) {
        lastError = err;
      }
    }

    if (succeeded && outputs !== undefined) {
      // Merge outputs into accumulated vars
      Object.assign(vars, outputs);
      results.push({
        id: block.id,
        ok: true,
        outputs,
        attempts,
      });
    } else {
      const errMsg =
        lastError instanceof Error
          ? lastError.message
          : String(lastError ?? "unknown error");
      results.push({
        id: block.id,
        ok: false,
        error: errMsg,
        attempts,
      });
      failed.add(block.id);
    }
  }

  return {
    vars,
    results,
    ok: failed.size === 0,
  };
}
