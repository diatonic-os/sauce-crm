# Sauce Graph — Install

## Prerequisites

- Obsidian ≥ 1.5.0 (desktop)
- Node.js ≥ 18 (only needed to build from source)

## Option A — build from source

```bash
cd plugin
npm install
npm run build
```

This produces `main.js`. Copy these four files into your vault:

```
<vault>/.obsidian/plugins/sauce-graph/
├── main.js          # built bundle
├── manifest.json
├── versions.json
└── styles.css
```

Then **Settings → Community Plugins → enable Sauce Graph**.

## Option B — dev symlink (recommended while iterating)

```bash
cd plugin
npm install
npm run dev        # esbuild watch mode

# in another shell, symlink the plugin directory into your vault
ln -s "$PWD" "<vault>/.obsidian/plugins/sauce-graph"
```

Restart Obsidian or run `Reload app without saving` (`Cmd+R`) after the symlink. The watch process rebuilds `main.js` on every save; toggle the plugin off/on in Settings to reload.

## First run

1. Open the vault in Obsidian and enable the plugin.
2. Run command: **`Sauce: Initialize Vault`**. This is idempotent — running on an existing vault diffs `CLAUDE.md` and offers an addendum rather than overwriting.
3. For multi-vault federation: run **`Sauce: Initialize Parent Vault`** at the parent-folder level, then **`Sauce: Register SubVault`** for each child vault.

## Verifying the build

```bash
npm run typecheck           # tsc -noEmit
npm run build               # esbuild production bundle
ls -lh main.js              # should be ~ a few hundred KB
```

## Updating

Bump `version` in `package.json`, run `npm version <new>`, and `npm run build`. The community-plugin pipeline picks up the new release from a GitHub tag matching the manifest version.

## Uninstall

Delete `<vault>/.obsidian/plugins/sauce-graph/`. The vault's `.md` files remain — every entity is a plain Obsidian note.
