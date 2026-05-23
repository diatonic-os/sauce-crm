---
group: tools
id: platform-detect
summary: Wrap Obsidian Platform flags — the gates the mobile fork depends on.
platform: universal
obsidian_api: Platform
api_version: "1.8.0"
inputs:
  isDesktopApp: "() => boolean"
  isMobileApp: "() => boolean"
  isIos: "() => boolean"
  isAndroid: "() => boolean"
  isPhone: "() => boolean"
outputs: "boolean platform predicates"
side_effects: none
deterministic: false
depends_on: []
---

# tools/platform-detect

Wraps Obsidian's `Platform`. Every native-gated path (`MOBILE-FORK.md`) branches
on these predicates — `data/IVectorStore` selects native vs WASM via
`isDesktopApp()`. `deterministic: false` because the value depends on the host
device (documented exception per CONTRACT.md §2 frontmatter).

## Contract
- Predicates read `Platform.*` live at call time.
- `obsidian_api: Platform` MUST exist in the generated `apiCatalog` (catalog
  validation gate — asserted in the test via `hasApiSymbol`).
- No side effects; universal (the detector itself runs everywhere).
