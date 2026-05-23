#!/usr/bin/env python3
"""Harvest the Obsidian TypeScript API surface from node_modules/obsidian/
into a structured registry the plugin can consume at build time.

Run via the temporary venv:
    ./scripts/harvest_obsidian_api.py

Outputs:
    schemas/obsidian-api.json   — structured registry (machine-readable)
    src/contract/ObsidianApiSchema.ts — TS const + types (compile-time)

The parser is intentionally pragmatic: it reads obsidian.d.ts line-by-line
and extracts class declarations, interface declarations, methods, and
properties. It does NOT do full TS AST parsing (which would require the
typescript compiler API or tree-sitter) — but it captures enough to
power the layered registry the plugin needs for deterministic dispatch.

The output schema:
    {
      "version": "<from package.json>",
      "harvested_at": "<iso>",
      "classes":     { name: { kind: "class", extends?, members: [...] } },
      "interfaces":  { name: { kind: "interface", extends?, members: [...] } },
      "functions":   { name: { signature, jsdoc? } },
      "enums":       { name: { values: [...] } },
      "totals":      { classes, interfaces, methods, properties, functions }
    }
"""
from __future__ import annotations

import json
import re
import sys
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent.parent
DTS_PATH = ROOT / "node_modules" / "obsidian" / "obsidian.d.ts"
PKG_PATH = ROOT / "node_modules" / "obsidian" / "package.json"
OUT_JSON = ROOT / "schemas" / "obsidian-api.json"
OUT_TS = ROOT / "src" / "contract" / "ObsidianApiSchema.ts"


# ---------- pragmatic regexes ----------

# `export class Foo extends Bar implements Baz {`
RE_CLASS = re.compile(
    r"^\s*(?:export\s+)?(?:abstract\s+)?class\s+(\w+)(?:\s*<[^>]*>)?"
    r"(?:\s+extends\s+([\w.<>, ]+?))?"
    r"(?:\s+implements\s+([\w.<>, ]+?))?\s*\{"
)
# `export interface Foo extends Bar {`
RE_IFACE = re.compile(
    r"^\s*(?:export\s+)?interface\s+(\w+)(?:\s*<[^>]*>)?"
    r"(?:\s+extends\s+([\w.<>, ]+?))?\s*\{"
)
# `export enum Foo {`
RE_ENUM = re.compile(r"^\s*(?:export\s+)?enum\s+(\w+)\s*\{")
# `export function foo(...): X;`
RE_FN = re.compile(r"^\s*(?:export\s+)?(?:declare\s+)?function\s+(\w+)\s*\(([^)]*)\)\s*:\s*([^;]+);")
# member line — method or property, with optional access modifiers.
RE_MEMBER = re.compile(
    r"^\s*(?:public\s+|private\s+|protected\s+|readonly\s+|static\s+|abstract\s+)*"
    r"(\w+)\s*(?:<[^>]*>)?\s*(\()?"
)


@dataclass
class MemberSpec:
    name: str
    kind: str  # "method" | "property"
    signature: str
    jsdoc: str = ""


@dataclass
class DeclSpec:
    kind: str  # "class" | "interface" | "enum"
    name: str
    extends_: list[str] = field(default_factory=list)
    implements_: list[str] = field(default_factory=list)
    members: list[MemberSpec] = field(default_factory=list)
    jsdoc: str = ""


def split_csv(s: str | None) -> list[str]:
    if not s:
        return []
    return [p.strip() for p in s.split(",") if p.strip()]


def harvest(dts: str) -> dict[str, Any]:
    lines = dts.splitlines()
    out_classes: dict[str, DeclSpec] = {}
    out_interfaces: dict[str, DeclSpec] = {}
    out_enums: dict[str, DeclSpec] = {}
    out_functions: dict[str, dict[str, str]] = {}

    i = 0
    current: DeclSpec | None = None
    current_jsdoc = ""
    brace_depth = 0

    while i < len(lines):
        line = lines[i]
        stripped = line.strip()

        # Capture JSDoc comments preceding declarations.
        if stripped.startswith("/**"):
            doc_lines = []
            while i < len(lines) and "*/" not in lines[i]:
                doc_lines.append(lines[i].strip().lstrip("/* "))
                i += 1
            if i < len(lines):
                doc_lines.append(lines[i].strip().rstrip("*/").lstrip("/* "))
                i += 1
            current_jsdoc = "\n".join(d for d in doc_lines if d).strip()
            continue

        # Inside a declaration body?
        if current is not None:
            brace_depth += line.count("{") - line.count("}")
            if brace_depth <= 0:
                current = None
                brace_depth = 0
            else:
                # Try to match a member line.
                m = RE_MEMBER.match(line)
                if m and not stripped.startswith(("//", "/*", "*", "}")):
                    name = m.group(1)
                    is_method = m.group(2) is not None
                    if name not in ("constructor",) and not name.startswith("private"):
                        sig = stripped.rstrip(";").rstrip(",")
                        current.members.append(MemberSpec(
                            name=name,
                            kind="method" if is_method else "property",
                            signature=sig[:200],
                        ))
            i += 1
            continue

        # New class?
        m = RE_CLASS.match(line)
        if m:
            name = m.group(1)
            current = DeclSpec(
                kind="class",
                name=name,
                extends_=split_csv(m.group(2)),
                implements_=split_csv(m.group(3)),
                jsdoc=current_jsdoc,
            )
            current_jsdoc = ""
            out_classes[name] = current
            brace_depth = line.count("{") - line.count("}")
            i += 1
            continue

        # New interface?
        m = RE_IFACE.match(line)
        if m:
            name = m.group(1)
            current = DeclSpec(
                kind="interface",
                name=name,
                extends_=split_csv(m.group(2)),
                jsdoc=current_jsdoc,
            )
            current_jsdoc = ""
            out_interfaces[name] = current
            brace_depth = line.count("{") - line.count("}")
            i += 1
            continue

        # New enum?
        m = RE_ENUM.match(line)
        if m:
            name = m.group(1)
            current = DeclSpec(kind="enum", name=name, jsdoc=current_jsdoc)
            current_jsdoc = ""
            out_enums[name] = current
            brace_depth = line.count("{") - line.count("}")
            i += 1
            continue

        # Top-level function?
        m = RE_FN.match(line)
        if m:
            fn_name = m.group(1)
            out_functions[fn_name] = {
                "params": m.group(2).strip(),
                "returns": m.group(3).strip(),
                "jsdoc": current_jsdoc,
            }
            current_jsdoc = ""
            i += 1
            continue

        # Anything else: clear floating jsdoc.
        if stripped and not stripped.startswith(("//", "*")):
            current_jsdoc = ""
        i += 1

    classes_d = {n: _spec_to_dict(s) for n, s in out_classes.items()}
    ifaces_d = {n: _spec_to_dict(s) for n, s in out_interfaces.items()}
    enums_d = {n: _spec_to_dict(s) for n, s in out_enums.items()}

    return {
        "classes": classes_d,
        "interfaces": ifaces_d,
        "enums": enums_d,
        "functions": out_functions,
        "totals": {
            "classes": len(classes_d),
            "interfaces": len(ifaces_d),
            "enums": len(enums_d),
            "functions": len(out_functions),
            "methods": sum(1 for c in {**classes_d, **ifaces_d}.values()
                           for m in c["members"] if m["kind"] == "method"),
            "properties": sum(1 for c in {**classes_d, **ifaces_d}.values()
                              for m in c["members"] if m["kind"] == "property"),
        },
    }


def _spec_to_dict(s: DeclSpec) -> dict[str, Any]:
    d = asdict(s)
    d["extends"] = d.pop("extends_")
    if "implements_" in d:
        d["implements"] = d.pop("implements_")
    return d


def emit_ts(registry: dict[str, Any], version: str) -> str:
    """Emit a TypeScript const + types from the registry. Kept narrow:
    just the names + member names + signatures so a downstream caller
    can introspect API shape without re-parsing the .d.ts."""
    lines: list[str] = [
        "// AUTO-GENERATED by scripts/harvest_obsidian_api.py — do not edit by hand.",
        "// Re-run after every `obsidian` package upgrade.",
        "//",
        f"// Source: node_modules/obsidian/obsidian.d.ts (version {version})",
        f"// Harvested: {datetime.now(timezone.utc).isoformat()}",
        "",
        "export interface ObsidianApiMember {",
        "  readonly name: string;",
        "  readonly kind: 'method' | 'property';",
        "  readonly signature: string;",
        "}",
        "",
        "export interface ObsidianApiDecl {",
        "  readonly kind: 'class' | 'interface' | 'enum';",
        "  readonly name: string;",
        "  readonly extends: readonly string[];",
        "  readonly implements?: readonly string[];",
        "  readonly members: readonly ObsidianApiMember[];",
        "}",
        "",
        "export interface ObsidianApiRegistry {",
        "  readonly version: string;",
        "  readonly harvestedAt: string;",
        "  readonly totals: Readonly<Record<string, number>>;",
        "  readonly classes: Readonly<Record<string, ObsidianApiDecl>>;",
        "  readonly interfaces: Readonly<Record<string, ObsidianApiDecl>>;",
        "  readonly enums: Readonly<Record<string, ObsidianApiDecl>>;",
        "  readonly functions: Readonly<Record<string, { params: string; returns: string }>>;",
        "}",
        "",
    ]

    # Strip jsdoc and trim member signatures to keep the bundle small.
    def slim(decl: dict[str, Any]) -> dict[str, Any]:
        return {
            "kind": decl["kind"],
            "name": decl["name"],
            "extends": decl.get("extends", []),
            "implements": decl.get("implements", []),
            "members": [
                {"name": m["name"], "kind": m["kind"], "signature": m["signature"][:160]}
                for m in decl.get("members", [])
            ],
        }

    slim_registry = {
        "version": version,
        "harvestedAt": datetime.now(timezone.utc).isoformat(),
        "totals": registry["totals"],
        "classes": {n: slim(d) for n, d in registry["classes"].items()},
        "interfaces": {n: slim(d) for n, d in registry["interfaces"].items()},
        "enums": {n: {"kind": "enum", "name": d["name"], "members": [], "extends": []}
                  for n, d in registry["enums"].items()},
        "functions": {n: {"params": d["params"], "returns": d["returns"]}
                      for n, d in registry["functions"].items()},
    }

    lines.append("export const OBSIDIAN_API_REGISTRY: ObsidianApiRegistry = " + json.dumps(slim_registry, indent=2) + ";")
    lines.append("")
    return "\n".join(lines)


def main() -> int:
    if not DTS_PATH.is_file():
        print(f"missing {DTS_PATH}", file=sys.stderr)
        return 1
    pkg = json.loads(PKG_PATH.read_text()) if PKG_PATH.is_file() else {}
    version = pkg.get("version", "unknown")
    dts = DTS_PATH.read_text(encoding="utf-8")
    print(f"harvesting {DTS_PATH} ({len(dts):,} bytes, obsidian@{version})...")
    registry = harvest(dts)
    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(
        json.dumps({"version": version, **registry}, indent=2),
        encoding="utf-8",
    )
    OUT_TS.parent.mkdir(parents=True, exist_ok=True)
    OUT_TS.write_text(emit_ts(registry, version), encoding="utf-8")
    t = registry["totals"]
    print(
        f"  classes={t['classes']} interfaces={t['interfaces']} "
        f"enums={t['enums']} fns={t['functions']} "
        f"methods={t['methods']} properties={t['properties']}"
    )
    print(f"  → {OUT_JSON}")
    print(f"  → {OUT_TS}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
