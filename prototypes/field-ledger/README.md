# Field ledger reconciliation prototype

> Throwaway prototype. This is not the Inlay reconciliation implementation.

## Question under test

Can a dense, Git-status-like ledger make inherited drift feel like a deliberate packaging gate while keeping ownership and provenance legible, hashes progressive, and every resolution scoped to either the current Layer or the materialized instance? In particular, this tests whether maintainers can distinguish adopting an override, restoring inherited bytes, excluding content, replacing an inherited mod as one exclusion-plus-addition intent, and stopping to track the change upstream without implying that Inlay edits a parent.

The materialized instance is launcher-agnostic. The prototype holds all state in memory and never reads or writes a Minecraft instance, manifest, or parent Layer.

## Run it

Install the existing workspace dependencies if needed, then start the interactive ledger:

```shell
pnpm install
pnpm prototype:field-ledger
```

Run the deterministic non-interactive walkthrough:

```shell
pnpm prototype:field-ledger -- --demo
```

## Ledger language

| Mark | Meaning |
| --- | --- |
| `!!` | Inherited bytes drifted; a decision is required and packaging is blocked. |
| `A>` | Working bytes are adopted as an explicit override in the current Layer. |
| `R<` | The materialized path is restored to its verified inherited bytes. |
| `X<` | The parent-owned path is excluded by the current Layer. |
| `X+` | An inherited mod is replaced by one intent that stages both exclusion and addition. |
| `A ` | Content already owned by the current Layer. |
| `??` | Unmanaged filesystem content; preserved, untracked, and unpackaged. |

The main ledger shows paths, ownership, and source provenance. Opening one field reveals its full working, inherited, and replacement SHA-256 digests. Clean inherited content is summarized rather than allowed to compete with blocking drift.

## State-model verdict to probe

Resolution decisions are in-memory staged intents. They never modify a parent. `track-upstream` is terminal: it discards the local write plan, records the path to carry upstream, and stops. The packaging gate opens only when no inherited field remains in `drift`; unmanaged files never participate in that gate or the plan.
