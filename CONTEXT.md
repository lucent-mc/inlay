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
An explicit declaration that suppresses an exact path or every descendant of a recursive directory from the resolved, exactly pinned parent without changing it. A recursive Exclusion naturally applies to every matching descendant in that parent version. An Exclusion that matches nothing remains a valid, warning-worthy no-op. The child may subsequently add Tracked Content at excluded locations.
_Avoid_: Deletion, absence

**Override**:
A child-owned declaration whose Content Path already exists in its Layer Lineage. Its presence in the child Layer is the complete and explicit replacement instruction. If a later pinned parent no longer contains the path, the same declaration naturally becomes an addition.
_Avoid_: Inherited Drift, upstream edit

**Inherited Drift**:
A local change to inherited content that has not been adopted as an Override or recorded in its owning Layer. It blocks builds until the parent reference contains the change, the inherited content is restored, or the current Layer adopts it.
_Avoid_: Override, local ownership

**Materialized Instance**:
A playable checkout containing the resolved contents of its complete Layer Lineage while Git tracks only the current Layer's owned contributions.
_Avoid_: Layer source, release archive

**Layer Manifest**:
The authoritative document describing a Layer through a strict extension of the Modrinth Pack Manifest schema with inheritance declarations. Its content entries retain Modrinth's existing shape and semantics.
_Avoid_: Parallel content schema, unrelated pack format

**Pack Manifest**:
A generated, distribution-specific description of a fully resolved Pack. It is release output rather than required state of a Materialized Instance.
_Avoid_: Layer Manifest, instance metadata

**Tracked Content**:
An approved regular file or downloadable artifact that belongs to a Layer through an exact declaration or recursive Directory Inclusion. Repository-owned content must also be tracked by Git, but Git tracking alone never assigns Layer ownership. Filesystem links are never Tracked Content.
_Avoid_: Git-tracked file, arbitrary instance content, runtime files

**Directory Inclusion**:
An explicit declaration that recursively makes Git-tracked regular files beneath a Content Path into Tracked Content of the current Layer. Inclusions form a set, so overlapping declarations select a file only once. Untracked files on disk are never adopted implicitly.
_Avoid_: Git directory, unrestricted wildcard, runtime directory

**Content Path**:
The portable, normalized instance-relative path that identifies Tracked Content within a Content Scope. Declared spelling is preserved, but paths that differ only by separators or case collide.
_Avoid_: Provider project ID, archive-relative override path

**Path-Shape Conflict**:
An invalid resolved state in which a regular-file Content Path is also the directory prefix of another file. Replacing an inherited directory tree with a file requires a recursive Exclusion; replacing an inherited file with a directory requires excluding the file first.
_Avoid_: Exact-path Override, case collision

**Content Scope**:
The Modrinth application phase in which bundled Tracked Content participates: common, client, or server. Identical Content Paths in different scopes are distinct and apply in Modrinth's standard order.
_Avoid_: Loader environment, Layer

**Environment Slot**:
The client or server result for one Content Path during composition. Content without an explicit environment occupies both slots, while side-specific content replaces only its applicable slot.
_Avoid_: Content Scope, launcher profile

**Payload Equality**:
Equality of content bytes established by a matching verified SHA-512 digest. Every additional supplied digest must also validate. Materialized-file drift is determined using this comparison.
_Avoid_: URL equality, modification time, Declaration Equality

**Declaration Equality**:
Equality of every normalized field in two content declarations, including payload hashes, environment policy, download locations, and file size. Parent-update review reports declaration changes even when their payloads are equal.
_Avoid_: Payload Equality, path identity

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
