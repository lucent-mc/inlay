# Layered Modpacks

This context describes how independently maintained modpack content composes into playable releases without losing ownership of each contribution.

## Language

**Layer**:
A versioned delta that can extend at most one parent Layer with mod and file changes. A Layer may exist without being released directly.
_Avoid_: Modpack, pack

**Layer Version**:
One immutable revision of a Layer. A native Git Layer Version is identified by its Git object format and full commit ID, independent of the repository mirror used to retrieve it. Different commits in the same repository are different Layer Versions.
_Avoid_: Layer, Parent Selector, release name

**Layer Lineage**:
The ordered chain formed by recursively following a Layer's parent. A Lineage can branch into multiple child Layers but never merges through multiple parents.
_Avoid_: Dependency tree, multiple inheritance

**Runtime Target**:
The complete Modrinth dependency map shared exactly by every Layer Version in one Layer Lineage. A loaderless target represents vanilla Minecraft and has no synthetic loader entry. Known Minecraft and loader keys support richer diagnostics, while unknown future keys remain authoritative and round-trip unchanged. Any key or value mismatch is invalid; target upgrades begin in the parent and propagate through new immutable Parent References.
_Avoid_: Environment Slot, compatible version range

**Parent Reference**:
An immutable identifier for the exact parent Layer version from which a child inherits. A Git Parent Reference consists of the explicitly trusted repository and full commit SHA. A Modrinth Parent Reference locks the canonical project and API version IDs plus one selected Pack artifact's filename, exact download URL, complete hashes, and exact size; all must match during resolution. Builds never resolve a mutable selector.
_Avoid_: Latest version, branch, version range

**Parent Selector**:
Optional, explicitly typed provenance retained alongside a Parent Reference: either a Git tag or a release exposed by a supported host, initially GitHub. A selector must peel to a commit before locking. Update tooling may resolve it again when explicitly requested, but branches and version ranges are not Parent Selectors and no selector determines an ordinary build.
_Avoid_: Parent Reference, build input, version range

**Parent Update**:
An atomic operation that explicitly re-resolves a Parent Selector, validates the candidate's complete Layer Lineage, presents its changes, and replaces the Parent Reference and reconciled instance only after acceptance. Failure leaves the existing reference and instance unchanged.
_Avoid_: Ordinary build, silent relock, partial reconciliation

**Imported Root**:
A terminal root Layer synthesized from an explicitly referenced Pack artifact that contains no native Layer Lineage. Its contents share a single provenance because their earlier ownership cannot be reconstructed. A Git repository without the well-known root Layer Manifest is invalid rather than inferred into an Imported Root.
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
The authoritative document describing a Layer through a strict extension of the Modrinth Pack Manifest schema with inheritance declarations. Every inherited field retains Modrinth's validation and semantics; only Layer fields and composition add behavior. It has one well-known filename at the root of a Layer repository, and parent resolution never searches for it or accepts a custom path.
_Avoid_: Parallel content schema, stricter reinterpretation, unrelated pack format

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
The client or server result for one Content Path during composition. Content without an explicit environment occupies both slots, while side-specific content replaces only its applicable slot. Lineage resolution always preserves both slots rather than selecting a runtime environment.
_Avoid_: Content Scope, launcher profile

**Payload Equality**:
Equality of content bytes established by a matching verified SHA-512 digest. Every additional supplied digest must also validate. Materialized-file drift is determined using this comparison.
_Avoid_: URL equality, modification time, Declaration Equality

**Declaration Equality**:
Equality of every normalized field in two content declarations, including payload hashes, environment policy, download locations, and file size. Parent-update review reports declaration changes even when their payloads are equal.
_Avoid_: Payload Equality, path identity

**Content Cache**:
A shared store of validated immutable Git objects, Pack artifacts, and payloads addressed by their native commit identity or verified SHA-512 digest. Cached objects may satisfy resolution offline; missing objects fail explicitly and never cause fallback to another version.
_Avoid_: Parent Reference, mutable download cache, availability guarantee

**Resolution Failure**:
The non-waivable inability to produce the exact validated Layer Lineage named by its Parent References. Missing objects, invalid manifests, identity or integrity mismatches, unsafe content, Runtime Target mismatches, and cycles are failures in every interaction mode.
_Avoid_: Warning, Parent Update choice, best-effort import

**Delivery Mode**:
The Distribution Target's single choice for how all repository-owned Tracked Content reaches an installed Pack: bundled inside the Pack archive or downloaded from immutable, hash-verified locations.
_Avoid_: Ownership, Distribution Target

**Pack**:
The fully resolved client-and-server content model produced by composing a Layer with its ancestors. It preserves both Environment Slots and may be published through one or more Distribution Targets or projected into a playable Materialized Instance.
_Avoid_: Layer, delta, single-environment installation

**Distribution Target**:
An optional destination and format through which a Pack is released for consumption.
_Avoid_: Layer, source

**Publication Destination**:
An independently selectable service, such as GitHub Releases or Modrinth, to which an already built Pack artifact is uploaded.
_Avoid_: Delivery Mode, Pack format
