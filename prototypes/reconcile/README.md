# Reconciliation flow prototype

> Throwaway prototype. This is not the production `lay` CLI.

## Question under test

Can reconciliation feel like provenance-aware `git status`: show the whole instance briefly, focus blocking inherited drift, and make every ownership-changing action explicit?

The scenario is entirely in memory. It never reads or changes the Minecraft instance, Git index, or Layer Manifest.

## Run

```sh
pnpm prototype:reconcile
```

For a non-interactive rendering of the initial state:

```sh
pnpm prototype:reconcile -- --demo
```

## Interaction rules represented

- Group changes by owning Layer, then by change type.
- Put blocking inherited drift before current-Layer source edits and unmanaged files.
- Say exactly which Layer owns inherited content.
- Adopting a same-path config writes an Override in the current Layer.
- Replacing an inherited mod writes both an Exclusion for the inherited JAR and a new current-Layer declaration.
- Deleting inherited content becomes an Exclusion only after an explicit choice.
- “Track upstream” never edits the parent. It stops with instructions and leaves the build blocked.
- Unmanaged files remain preserved, untracked, and unpackaged unless explicitly added.
- Hashes and declaration details stay behind an inspect action.

