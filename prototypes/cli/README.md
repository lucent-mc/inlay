# Consolidated CLI interface prototype

> Throwaway prototype. This is not the production `lay` CLI and changes no files or Git state.

This is the validation artifact for the complete CLI and Git-safety contract. It supersedes the three earlier reconciliation metaphors with the agreed `lay status` model: a sortable, provenance-aware trie over the playable authoring instance.

## Run

```sh
pnpm prototype:cli
```

Use the arrow keys to navigate and expand or collapse branches. Press Space to open the reconciliation form for a file or directory, Enter to inspect provenance, and `q` to finish. A non-interactive snapshot of both the tree and command hierarchy is available with:

```sh
pnpm prototype:cli -- --demo
```

Show only the proposed command hierarchy with:

```sh
pnpm prototype:cli -- --help
```

## State hierarchy

The complete tree is sorted first by state and then alphabetically within each consecutive state group. A directory inherits the highest-priority state among its descendants.

| Symbol | Meaning |
| --- | --- |
| `?` | Eligible file not yet declared and not Git-ignored |
| `!` | New, changed, or deleted file conflicting with inherited content |
| `~` | Current-Layer content differs from its declaration |
| `−` | Current-Layer declaration whose file is missing |
| `✓` | Reconciled portable representation is staged |
| `·` | Unchanged managed content |

Generated Git exclusions do not hide known inherited files from this tree. They only prevent Git from accidentally tracking them and hide unknown ignored candidates.

The active row follows Clack's visual language: a cyan `◆` and compact cyan label highlight establish keyboard focus, while inactive rows retain a dim vertical rail. The highlight covers only the node label; the state symbol remains outside it and keeps its semantic color. Unchanged rows recede in gray. Selection never erases file status, and color is never the only signal.

## Boundaries represented

- The playable instance is the authoring working copy.
- Reconciliation stages complete portable current-Layer snapshots; restoring inherited bytes stages nothing.
- Buildability means Inlay consistency, not a clean or committed Git worktree.
- `lay fetch` never changes the working copy; `lay pull` and `lay switch` hydrate non-Git managed content only after Git succeeds.
- `lay check` validates the resolved manifest, payload metadata, compatibility, and required dependency closure without mutating anything.
- `lay init` creates a root; `lay fork` creates a child.

## Non-interactive contract

`--no-interactive` disables prompts but retains the normal human-readable report. `--json` also disables prompts and emits exactly one JSON document with this versioned envelope:

```json
{
  "schemaVersion": 1,
  "command": "status",
  "ok": false,
  "changed": false,
  "diagnostics": [
    {
      "code": "inherited-drift",
      "severity": "error",
      "message": "Inherited content differs from its materialized payload.",
      "path": "config/sodium-options.json",
      "layer": "Lucent Optimisations@2.3.1"
    }
  ],
  "data": {}
}
```

Fields may be added within `data` and diagnostic objects in compatible releases; the envelope fields and diagnostic `code` values are stable machine interfaces. JSON mode emits no ANSI sequences, progress animation, or incidental logs on stdout. Fatal runtime context may go to stderr.

Exit codes are deliberately coarse; automation branches on diagnostic codes for detail:

| Code | Meaning |
| --- | --- |
| `0` | The command completed and its requested invariant holds. |
| `1` | Expected project state blocked completion: unresolved status, invalid manifest, failed resolution, dependency error, Git conflict, or a safety refusal. |
| `2` | The invocation is invalid or this `lay` cannot read the manifest schema. |
| `3` | An unexpected internal failure occurred. |

`--dry-run` performs every read, resolution, and validation needed to produce the complete plan but makes no filesystem, Git, cache, or network-side write. A plan containing unresolved required choices exits `1`.
