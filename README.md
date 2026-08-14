# Inlay

Inlay builds maintainable Minecraft modpacks from immutable, single-parent Layers. Every Layer is an ordinary playable launcher instance and Git repository; it declares only the content it owns, while `lay` resolves its ancestors, detects inherited drift, and compiles a normal `.mrpack`.

The npm package is `@lucent-mc/inlay`, the executable is `lay`, and the well-known authoring manifest is `inlay.index.json`.

> This repository currently contains the first v1 implementation. Treat `0.x` releases as preview software while the 1.0 contract is exercised against real packs.

## Install

Inlay requires Node.js 24 or newer.

```sh
pnpm add --global @lucent-mc/inlay
lay --help
```

Run it from the root of an ordinary Minecraft instance. Inlay is launcher-agnostic: the playable
instance is the authoring working copy, and its output is a standard `.mrpack`.

## Start a Layer

Create a root Layer inside an existing instance:

```sh
lay init --layer-version 1.0.0
lay status
```

`lay init` detects the instance name, Minecraft version, and loader target from launcher-owned
metadata for ATLauncher, GDLauncher Carbon, Modrinth App, Prism Launcher, and PolyMC. These are
launchers that can manage authoring instances and consume Modrinth packs; Inlay does not promise
launcher metadata integration outside that `.mrpack` ecosystem. Detection accounts for launchers
that keep metadata beside the playable `.minecraft` or `instance` directory. A root
`modrinth.index.json` is also imported when present. Explicit `--name`, `--minecraft`, `--loader`,
and `--loader-version` values override detected metadata; conflicting or multiple implicit targets
fail instead of being guessed.

Create a child from an immutable GitHub Layer or an existing Modrinth pack:

```sh
lay fork https://github.com/lucent-mc/optimisations <full-commit-sha> \
  --name "Lucent Vanilla" --layer-version 1.0.0

lay fork https://modrinth.com/modpack/fabulously-optimized <version-id> \
  --name "My Child Pack" --layer-version 1.0.0
```

`lay fork` verifies and locks the parent, copies its exact Minecraft/loader target, hydrates inherited content, and records that content in local Git excludes. A Layer can have one parent; that parent may have its own parent without a depth limit.

## Authoring loop

Make changes by launching and editing the instance normally, then run:

```sh
lay status
```

The Clack tree orders eligible untracked content, unresolved inherited conflicts, changed current-Layer files, deleted declarations, reconciled files, and unchanged files. Use arrows to navigate, Enter to reconcile, Space to inspect provenance, and `q` to finish. Reconciliation stages its portable Git representation and offers to commit when you leave.

Downloaded content never enters Git. Reconciliation identifies installed mods, plugins, resource packs,
shaders, and datapacks from verified launcher metadata when available, with Modrinth hash lookup as the
fallback, then records their immutable HTTPS declaration in
`inlay.index.json`, and stages only that manifest. Configuration is the sole repository-backed
instance content: reconciling it stages both its manifest declaration and source bytes. `lay commit`
refuses any manually staged instance payload that is not a declared configuration source.

For automation, reconcile one file or apply one action to every unresolved file below a directory:

```sh
lay status --no-interactive --json
lay reconcile config/sodium-options.json --action add --no-interactive
lay reconcile config --action add --no-interactive
lay commit -m "Tune defaults after playtesting"
```

`lay init` writes a committed `.layignore` for repository-owned Layer-discovery rules and manages
local Git visibility separately in `.git/info/exclude`. Known downloaded-content roots are always added
to that generated local block when the repository does not already ignore them. Git-ignored Minecraft downloads remain visible
to `lay status`; `.layignore` is the policy that suppresses an otherwise eligible implicit candidate.
Choose **Ignore in this Layer** while reconciling an untracked file to keep it locally, append its
exact path to `.layignore`, and stage that policy change. Explicit `files[]` declarations are always
checked.

When a supported defaults provider's store directory exists and its matching mod is identified under
`mods/` from a resolved Modrinth project or JAR metadata, `lay status` treats ordinary generated
`config/` files as runtime copies. It compares and reconciles them through Configured Defaults (`configureddefaults`), Config Manager
(`config/modpack_defaults`), YOSBR (`config/yosbr`), or Default Options' mirrored `extra/` tree
(`config/defaultoptions/extra`). Status keeps the live `config/` path as the authoring surface; tracking
copies those bytes to the selected provider store and declares and stages that stored path. Existing
authored files in a provider store remain directly discoverable until adopted, even when Git ignores
the store. The directory or mod alone never activates projection, and ambiguous providers leave
runtime files visible for explicit handling. Provider controls and specialized options, keybinding,
resource-pack, and plugin behavior are not treated as generic config-file copies.

Choosing “track upstream” never edits another repository. It stops and names the Layer that must receive the change; release that Layer, then update the child’s immutable parent reference.

## Content management

```sh
lay add sodium
lay install iris --version <modrinth-version-id>
lay remove sodium
lay update --check
lay update sodium
```

`lay add` selects content for the exact Minecraft/loader target, installs it into the instance, and recursively adds required Modrinth dependencies. `lay remove` protects reverse dependencies and reconciles orphaned libraries. Non-interactive ambiguity always blocks until explicit policies are supplied.

## Collaboration

`lay fetch` performs Git fetch and verifies/caches external payloads. `lay pull` and `lay switch` also synchronize manifest-managed content that is deliberately absent from Git:

```sh
lay fetch
lay pull
lay switch feature/pack-update
```

## Validate, document, and build

```sh
lay check
lay list
lay list --resolved
lay docs --content --licenses --stubs
lay build --target github modrinth
```

`lay check` validates schema, hashes, sizes, immutable lineage, runtime equality, repository tracking, required dependency closure, and incompatibilities. `lay build` permits a manifest-consistent dirty worktree and labels it as a preview; GitHub-hosted delivery requires a clean commit so every generated URL is commit-addressed.

Build output includes:

- a deterministic `.mrpack`;
- SHA-256 and SHA-512 checksum files;
- a build record containing lineage, source commit, delivery mode, target limits, and artifact identity.

Remote Modrinth content stays remote and its materialized files never enter Git. Repository-backed
configuration is either bundled (the default) or represented by commit-addressed GitHub downloads
when top-level `delivery` is `"github"`. Publication checks enforce the configured target’s fixed
upload limit.

## Version packs

```sh
lay changes --bump minor -m "Add ambient audio and its required library"
lay version
```

Fragments live under `.inlay/changes/`, describe pack-domain additions, updates, removals, and relationships, and are consumed into `CHANGELOG.md`. `lay version` applies the largest requested SemVer bump to `versionId` and can refresh content/license documentation.

## Manifest

`inlay.index.json` is a strict superset of Modrinth’s pack index. It keeps Modrinth’s `formatVersion`, `game`, `versionId`, `name`, `summary`, `files`, and `dependencies`, and adds only Layer authoring behavior:

```json
{
  "$schema": "https://raw.githubusercontent.com/lucent-mc/inlay/schema-v1.0.0/schema/inlay-1.0.0.schema.json",
  "extends": {
    "url": "https://github.com/lucent-mc/optimisations",
    "version": "0123456789abcdef0123456789abcdef01234567",
    "hashes": {
      "sha1": "0000000000000000000000000000000000000000",
      "sha256": "0000000000000000000000000000000000000000000000000000000000000000"
    },
    "fileSize": 1234
  },
  "exclusions": [{ "path": "mods/old-version.jar" }],
  "formatVersion": 1,
  "game": "minecraft",
  "versionId": "1.0.0",
  "name": "Lucent Vanilla",
  "files": [],
  "dependencies": {
    "minecraft": "1.21.1",
    "fabric-loader": "0.16.14"
  }
}
```

An entry in a child’s `files[]` implicitly overrides the same path/environment slot from its parent. Replacing a mod whose filename/path changes uses an exact exclusion plus the new `files[]` entry. Directory exclusions are recursive only when `recursive: true`; children may add content at excluded paths afterward.

Repository-backed configuration declarations use `downloads: ["./relative/source"]` with SHA-1,
SHA-256, and `fileSize`. All other content uses immutable remote declarations retaining the Modrinth
contract: HTTPS downloads with SHA-1, SHA-512, size, and optional client/server environment policies.

The schema is versioned independently from `lay`. One toolkit major reads all schema versions it supports; migrations cross at most one schema major per invocation.

## Automation

Reusable automation under `.github/workflows/` calls the exact same non-interactive CLI and JSON contract. `action/action.yml` is a small generic adapter for invoking one pinned toolkit release. Workflows never install `latest` and keep schedules, permissions, issue grouping, release assets, and credentials outside the manifest.

## Development

```sh
pnpm install
pnpm check
pnpm build
node dist/cli.js --help
```

The supported v1 interfaces are the CLI, versioned JSON envelope and diagnostic codes, independently versioned manifest schema, and documented artifacts. Internal TypeScript modules are intentionally not a public API.
