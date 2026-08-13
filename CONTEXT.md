# Layered Modpacks

This context describes how independently maintained modpack content composes into playable releases without losing ownership of each contribution.

## Language

**Layer**:
A versioned delta that can extend at most one parent Layer with mod and file changes. A Layer may exist without being released directly.
_Avoid_: Modpack, pack

**Layer Lineage**:
The ordered chain formed by recursively following a Layer's parent. A Lineage can branch into multiple child Layers but never merges through multiple parents.
_Avoid_: Dependency tree, multiple inheritance

**Parent Reference**:
An immutable identifier for the exact parent Layer version from which a child inherits.
_Avoid_: Latest version, branch, version range

**Imported Root**:
A root Layer synthesized from a Pack that contains no native Layer Lineage. Its contents share a single provenance because their earlier ownership cannot be reconstructed.
_Avoid_: Parent Layer, inferred lineage

**Exclusion**:
An explicit declaration that suppresses an inherited mod, file, or directory in a child Layer without changing its parent.
_Avoid_: Deletion, absence

**Override**:
A child-owned file or directory that intentionally replaces inherited content at the same path.
_Avoid_: Inherited Drift, upstream edit

**Inherited Drift**:
A local change to inherited content that has not been adopted as an Override or recorded in its owning Layer.
_Avoid_: Override, local ownership

**Materialized Instance**:
A playable checkout containing the resolved contents of its complete Layer Lineage while Git tracks only the current Layer's owned contributions.
_Avoid_: Layer source, release archive

**Layer Manifest**:
The authoritative document describing a Layer, its immutable Parent Reference, and its owned changes. It uses a Layer-specific schema and resolves into distribution-specific manifests.
_Avoid_: `modrinth.index.json`, Pack manifest

**Pack Manifest**:
A generated, distribution-specific description of a fully resolved Pack. It is release output rather than required state of a Materialized Instance.
_Avoid_: Layer Manifest, instance metadata

**Tracked Content**:
An individually approved file or downloadable artifact that belongs to a Layer and may be included in a resolved Pack. Location alone never makes instance content tracked.
_Avoid_: Directory contents, wildcard inclusion, runtime files

**Delivery Mode**:
The Distribution Target's single choice for how all repository-owned Tracked Content reaches an installed Pack: bundled inside the Pack archive or downloaded from immutable, hash-verified locations.
_Avoid_: Ownership, Distribution Target

**Pack**:
The fully resolved, playable result of composing a Layer with its ancestors. A Pack may be published through one or more Distribution Targets.
_Avoid_: Layer, delta

**Distribution Target**:
An optional destination and format through which a Pack is released for consumption.
_Avoid_: Layer, source

**Publication Destination**:
An independently selectable service, such as GitHub Releases or Modrinth, to which an already built Pack artifact is uploaded.
_Avoid_: Delivery Mode, Pack format
