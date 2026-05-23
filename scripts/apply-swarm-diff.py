#!/usr/bin/env python3
"""apply-swarm-diff — apply ```lang path=... ``` blocks from a swarm diff to a target tree.

Usage:
    apply-swarm-diff.py <diff.md> [--repo-root PATH] [--dry-run] [--strict]

The diff format is the one the Maverick swarm emits: each file is a fenced
code block opened with a language tag followed by a `path=` line:

    ```ts
    path=plugin/src/foo/Bar.ts
    <file body>
    ```

The applier extracts every such block and writes each body to the declared
path under `repo-root`. With `--strict`, paths outside the repo-root or
unknown languages cause a hard error rather than a warning.
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path


# Three accepted path-annotation shapes (forms A/B/C — see swarm.py for
# canonical comments). State machine handles all of them.

_PATH_LIKE_RE = re.compile(r"^([\w./_-]+\.[a-zA-Z]{1,6})$")


class _Match:
    __slots__ = ("lang", "path", "body")

    def __init__(self, lang: str, path: str, body: str):
        self.lang, self.path, self.body = lang, path, body

    def group(self, n: int) -> str:
        return ("", self.lang, self.path, self.body)[n]


def _iter_blocks(text: str):
    lines = text.splitlines()
    i = 0
    while i < len(lines):
        line = lines[i]
        if not line.startswith("```"):
            i += 1
            continue
        header = line[3:].strip()
        lang = ""
        inline_path = ""
        if header:
            parts = header.split()
            lang = parts[0] if parts else ""
            for p in parts[1:]:
                if p.startswith("path="):
                    inline_path = p[5:].strip()
        body_start = i + 1
        j = body_start
        while j < len(lines) and not lines[j].startswith("```"):
            j += 1
        body_lines = lines[body_start:j]
        path = inline_path
        if not path and body_lines:
            first = body_lines[0].strip()
            if first.startswith("path="):
                cand = first[5:].strip()
                if _PATH_LIKE_RE.match(cand):
                    path = cand
                    body_lines = body_lines[1:]
            elif _PATH_LIKE_RE.match(first):
                path = first
                body_lines = body_lines[1:]
        if path:
            yield _Match(lang, path, "\n".join(body_lines))
        i = j + 1


class _BlockRe:
    @staticmethod
    def finditer(text: str):
        return _iter_blocks(text)


_BLOCK_RE = _BlockRe()


def _safe_resolve(target: str, repo_root: Path) -> Path:
    """Resolve `target` under `repo_root` and refuse path-traversal."""
    p = (repo_root / target).resolve()
    root = repo_root.resolve()
    if root not in p.parents and p != root:
        raise ValueError(f"refusing path outside repo-root: {target!r}")
    return p


def _load_touches(diff_path: Path) -> set[str] | None:
    """If a sibling .prompt.md exists in the staging dir, extract the
    `**Touches:**` line and return it as a set of allowed paths (or the
    declared directory prefixes). Returns None if no prompt is found —
    in which case the caller must decide whether to fail or proceed."""
    prompt_path = diff_path.with_suffix("").with_suffix(".prompt.md")
    if not prompt_path.is_file():
        # Try the orc-emitted prompt format: same dir, *.prompt.md
        candidate = diff_path.parent / (diff_path.stem.replace(".diff", "") + ".prompt.md")
        if not candidate.is_file():
            return None
        prompt_path = candidate
    text = prompt_path.read_text(encoding="utf-8")
    m = re.search(r"^\*\*Touches:?\*\*\s*(.+?)\s*$", text, re.MULTILINE | re.IGNORECASE)
    if not m:
        return None
    raw = m.group(1)
    return {p.strip().strip("`") for p in re.split(r"[,;]", raw) if p.strip()}


def _path_in_touches(target: str, touches: set[str]) -> bool:
    """A target is allowed if it equals a declared path OR is under a
    declared directory (one ending with `/` or with no extension)."""
    if target in touches:
        return True
    for allowed in touches:
        # Treat any allowed entry that ends with `/` OR has no file extension
        # as a directory prefix.
        if allowed.endswith("/") or "." not in allowed.rsplit("/", 1)[-1]:
            prefix = allowed if allowed.endswith("/") else allowed + "/"
            if target.startswith(prefix):
                return True
    return False


def apply_diff(
    diff_path: Path,
    repo_root: Path,
    *,
    dry_run: bool,
    strict: bool,
    touches: set[str] | None = None,
) -> tuple[int, int]:
    """Returns (applied, skipped). If `touches` is provided, every block
    whose `path=` is not in `touches` is REJECTED — this is the
    defense-in-depth gate that catches Contract-voter approval failures."""
    text = diff_path.read_text(encoding="utf-8")
    applied = 0
    skipped = 0
    seen_paths: set[Path] = set()
    for m in _BLOCK_RE.finditer(text):
        lang = (m.group(1) or "").strip().lower()
        target = m.group(2).strip()
        body = m.group(3)
        # Defense in depth: even if the swarm sealed a diff that writes
        # outside the declared Touches list, the applier refuses it.
        if touches is not None and not _path_in_touches(target, touches):
            print(
                f"  REJECT (out-of-scope): {target} not in declared Touches "
                f"({sorted(touches)})",
                file=sys.stderr,
            )
            skipped += 1
            if strict:
                raise ValueError(f"out-of-scope write rejected: {target}")
            continue
        try:
            full_path = _safe_resolve(target, repo_root)
        except ValueError as exc:
            print(f"  SKIP (unsafe): {target} — {exc}", file=sys.stderr)
            skipped += 1
            if strict:
                raise
            continue
        # De-dup: if the swarm emitted two blocks for the same file (it
        # has happened), the last one wins. We warn so it's auditable.
        if full_path in seen_paths:
            print(f"  WARN: duplicate block for {target} — last write wins")
        seen_paths.add(full_path)
        if dry_run:
            print(f"  DRY (lang={lang or '?'}): would write {target} ({len(body)} chars)")
        else:
            full_path.parent.mkdir(parents=True, exist_ok=True)
            # Ensure trailing newline — the swarm sometimes omits it and
            # editors prefer files end with one.
            payload = body if body.endswith("\n") else body + "\n"
            full_path.write_text(payload, encoding="utf-8")
            print(f"  WROTE: {target} ({len(payload)} chars)")
        applied += 1
    return applied, skipped


def main() -> int:
    ap = argparse.ArgumentParser(description="Apply a swarm-emitted diff to the source tree.")
    ap.add_argument("diff", type=Path, help="Path to <session>.diff.md")
    ap.add_argument(
        "--repo-root", type=Path, default=Path.cwd(),
        help="Repo root the path= entries are relative to (default: cwd)",
    )
    ap.add_argument("--dry-run", action="store_true", help="Do not write — only report.")
    ap.add_argument(
        "--strict", action="store_true",
        help="Hard-fail on any unsafe path or parse anomaly (default: warn and continue).",
    )
    ap.add_argument(
        "--touches", default=None,
        help="Comma-separated allow-list of paths. If omitted, the applier "
             "auto-loads it from the sibling <session>.prompt.md if present. "
             "Pass `--touches ANY` to disable the check (NOT recommended).",
    )
    ap.add_argument(
        "--plan", default=None,
        help="Path to a plan markdown/TOML. When --task-id is also passed, "
             "the applier auto-loads Touches from that task. Takes precedence "
             "over auto-loading from the prompt sidecar.",
    )
    ap.add_argument(
        "--task-id", default=None,
        help="Task id to look up in --plan for the Touches allow-list.",
    )
    args = ap.parse_args()
    if not args.diff.is_file():
        ap.error(f"not a file: {args.diff}")
    touches: set[str] | None
    if args.plan and args.task_id:
        # Pull Touches from the plan via the orc-py parser. This is the
        # canonical source of truth and avoids drift between staging
        # sidecars and the plan itself.
        try:
            from sauce_framework.orc.plan_parser import load_plan
            plan = load_plan(Path(args.plan))
            task = plan.by_id(args.task_id)
            if task is None:
                ap.error(f"task {args.task_id!r} not in plan {args.plan}")
            touches = set(task.touches)
            print(f"  touches loaded from plan task {args.task_id}: {sorted(touches)}")
        except ImportError:
            ap.error("sauce_framework not importable — install orc-py or omit --plan")
    elif args.touches is None:
        touches = _load_touches(args.diff)
        if touches is not None:
            print(f"  touches loaded from prompt: {sorted(touches)}")
        else:
            print("  WARN: no Touches list found — applier will accept any path.")
    elif args.touches.strip().upper() == "ANY":
        touches = None
    else:
        touches = {p.strip() for p in args.touches.split(",") if p.strip()}
    print(f"applying {args.diff} → {args.repo_root.resolve()}{' (DRY RUN)' if args.dry_run else ''}")
    applied, skipped = apply_diff(
        args.diff, args.repo_root,
        dry_run=args.dry_run, strict=args.strict, touches=touches,
    )
    print(f"\n  applied: {applied}  skipped: {skipped}")
    return 0 if (applied > 0 and skipped == 0) else (0 if applied > 0 else 1)


if __name__ == "__main__":
    sys.exit(main())
