# Inherited-drift switchyard prototype

> Throwaway logic prototype. It never reads or writes a Minecraft instance, a Layer manifest, or a parent Layer.

This prototype asks one question:

> Does reconciliation feel trustworthy when inherited drift is a blocking queue, every path names its owner, and each choice visibly routes bytes either back to the parent payload, into the current Layer, or out of the resolved pack?

It starts after a launcher-agnostic Materialized Instance has been played and locally changed. The state is deliberately dense and Git-status-like, but inherited ownership—not generic filesystem change—is the main axis.

Run the interactive prototype:

```shell
pnpm prototype:reconcile-switchyard
```

Run a deterministic walkthrough:

```shell
pnpm prototype:reconcile-switchyard -- --demo
```

## What to probe

- **Adopt local bytes** turns modified inherited content into an explicit Override owned by the current Layer.
- **Restore inherited bytes** clears drift without adding a current-Layer declaration.
- **Exclude inherited content** writes an exact suppression rule; it does not mutate the parent.
- **Replace inherited mod** is one user action that stages two atomic declarations: exclude the inherited JAR and add its local successor.
- **Track upstream** stops reconciliation immediately. It edits neither the current Layer nor the parent Layer.
- **Show provenance + hashes** progressively reveals payload identity without making the status view noisy.

Unmanaged files remain visible as context, but they are always preserved, untracked, and unpackaged. All interactions only transform an in-memory state object.

## Reading the route marks

| Mark | Meaning |
| --- | --- |
| `M` / `D` / `R` under RED SIGNAL | Modified, absent, or replacement-shaped inherited drift; build is blocked. |
| `◆` | Current-Layer Override. |
| `╳` | Exclusion of inherited content. |
| `+` | Current-Layer addition. |
| `??` | Unmanaged instance file; preserved and never packaged. |
