# Inlay

This context describes how independently maintained modpack content composes into playable releases without losing ownership of each contribution.

## Language

**Layer**:
A versioned delta that can extend at most one parent Layer with mod and file changes. Every valid Layer is buildable; publication is external state, so a Layer may remain Undistributed without declaring that status.
_Avoid_: Modpack, pack

**Layer Version**:
One immutable revision of a Layer. A native Git Layer Version is identified by its Git object format and full commit ID, independent of the repository mirror used to retrieve it. Different commits in the same repository are different Layer Versions.
_Avoid_: Layer, Parent Resolution Hint, release name

**Layer Lineage**:
The ordered chain formed by recursively following a Layer's parent. A Lineage can branch into multiple child Layers but never merges through multiple parents.
_Avoid_: Dependency tree, multiple inheritance

**Runtime Target**:
The complete Modrinth dependency map shared exactly by every Layer Version in one Layer Lineage. A loaderless target represents vanilla Minecraft and has no synthetic loader entry. Known Minecraft and loader keys support richer diagnostics, while unknown future keys remain authoritative and round-trip unchanged. Any key or value mismatch is invalid; target upgrades begin in the parent and propagate through new immutable Parent References.
_Avoid_: Environment Slot, compatible version range

**Parent Reference**:
An immutable reference to one exact parent `inlay.index.json` or Pack artifact. It always records a URL, SHA-1, SHA-256, and exact byte size. Optional `version` and `filename` values supply resolution information not already embedded in the URL. Resolution must identify exactly one file before its bytes are verified; zero or multiple candidates are failures.
_Avoid_: Provider-specific parent schema, mutable selector, project metadata

**Parent Resolution Hint**:
An optional `version` or `filename` used only when the Parent Reference URL does not completely identify the parent file. A URL without an embedded immutable version requires `version`. Without `filename`, GitHub resolves root `inlay.index.json` and Modrinth resolves exactly one `.mrpack`.
_Avoid_: Parent identity, branch, version range

**Parent Update**:
An atomic operation that explicitly resolves a new parent candidate, validates its complete Layer Lineage, presents its changes, and replaces the Parent Reference and reconciled instance only after acceptance. Failure leaves the existing reference and instance unchanged.
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
A Materialization Drift affecting content owned by an ancestor Layer Version. It blocks builds until the Parent Reference contains the change, the inherited content is restored, or the current Layer adopts it as an Override.
_Avoid_: Override, local ownership

**Materialized Instance**:
A launcher-agnostic Minecraft directory that is both a playable installation and the current Layer's authoring working copy. Maintainers edit and test content here, then reconcile intentional changes into the Layer Manifest and, only for configuration content, repository-owned source. Git tracks Layer metadata and configuration sources; generated exclusions keep inherited and downloaded content payloads out of its index.
_Avoid_: Layer source, release archive

**Instance Hydration**:
The guarded reverse projection used after a successful Git pull or branch switch, or while creating a fresh child Layer, to make manifest-managed files that Git does not carry match the checked-out resolved Layer Lineage. It never overwrites unresolved Managed Instance File drift and preserves Unmanaged Instance Files; ordinary authoring flows from the Materialized Instance into the Layer rather than through hydration.
_Avoid_: Primary authoring flow, Git checkout, arbitrary instance synchronization

**Reconciled Change**:
An intentional instance change whose complete portable current-Layer representation is internally consistent and staged in Git. Remote content stages its immutable Layer Manifest declaration without staging materialized bytes; configuration content stages both its declaration and repository source. Restoring inherited content and preserving an unmanaged local file do not create a Reconciled Change because neither produces portable Layer state.
_Avoid_: Any resolved drift, unstaged edit, partial manifest hunk

**Materialization Record**:
A local, ignored, regenerable account of an instance's selected environment, resolved lineage fingerprint, and each managed path's expected presence, payload, and owning Layer Version. It detects drift but never establishes Layer ownership or portable build inputs.
_Avoid_: Layer Manifest, lockfile, committed provenance

**Instance Environment**:
The local choice of client or server used to project both resolved Environment Slots into one Materialized Instance. It does not alter the Pack or Layer Manifest.
_Avoid_: Runtime Target, Content Scope, Environment Slot

**Materialization Plan**:
The derived projection of a resolved Pack into one Instance Environment, including each applicable path's owner, payload, and required-or-optional presence policy. It is applied transactionally and is never a portable source of truth.
_Avoid_: Pack, Layer Manifest, Materialization Record

**Optional Content**:
Tracked Content whose Modrinth environment policy permits absence during installation. A child may inherit it unchanged, include it by overriding its policy to required, or exclude it; local presence never chooses among these.
_Avoid_: Untracked content, local selection, implicit Exclusion

**Managed Instance File**:
A file whose expected payload and presence policy were established by the last successful materialization. Required content must be present, Optional Content may be absent, and existing managed bytes may be changed or removed automatically only while they remain unchanged.
_Avoid_: Tracked Content, current Layer source file, arbitrary instance file

**Unmanaged Instance File**:
An untracked local file that is neither current Layer source nor part of the last successful materialization. Reconciliation preserves it, never packages it, and ignores it unless it collides with a resolved managed path.
_Avoid_: Managed Instance File, inherited content, implicit inclusion

**Provenance Entry**:
The part of a Materialization Record that associates one managed Content Path with its owning Layer Version, source declaration and scope, environment policy, hashes, size, and last applied state. It reports derived ownership but never creates it.
_Avoid_: Content declaration, Parent Reference, file history

**Materialization Drift**:
A mismatch between a Managed Instance File's recorded state and its on-disk presence, type, or payload. It blocks builds until restored or represented by the current Layer; source edits and Unmanaged Instance Files are not Materialization Drift.
_Avoid_: Git working change, untracked runtime file, stale Materialization Record

**Stale Materialization**:
A Materialization Record whose lineage fingerprint, Instance Environment, or selected current-Layer source membership no longer matches the derived Materialization Plan. It requires reconciliation but does not imply that any managed payload drifted.
_Avoid_: Materialization Drift, Parent Update, cache miss

**Layer Manifest**:
The authoritative `inlay.index.json` document describing a Layer through a strict extension of the Modrinth Pack Manifest schema with inheritance declarations. Every inherited field retains Modrinth's validation and semantics; only Layer fields and composition add behavior. It exists at the root of a Layer repository, and parent resolution never searches for it or accepts a custom path.
_Avoid_: Parallel content schema, stricter reinterpretation, unrelated pack format

**Manifest Schema Version**:
The exact independent SemVer contract named by a Layer Manifest's `$schema`. Patch releases do not change accepted documents, minor releases add backward-compatible capabilities, and major releases may break the document model. A `lay` release declares the schema version it writes and the range it reads; the toolkit version, Pack `versionId`, and Modrinth `formatVersion` remain separate identities.
_Avoid_: Toolkit version, Release Identity, Modrinth format version

**Manifest Migration**:
An explicit `lay migrate` rewrite of the current Layer Manifest across exactly one Manifest Schema major. Migration proceeds ancestor-first through separately maintained Layers and never rewrites an immutable parent. Larger gaps require sequential compatible toolkit versions and intermediate migrations.
_Avoid_: Normal validation, parent normalization, automatic build rewrite

**Pack Manifest**:
A generated, distribution-specific description of a fully resolved Pack. It is release output rather than required state of a Materialized Instance.
_Avoid_: Layer Manifest, instance metadata

**Build Record**:
A generated account of the exact toolkit version, source revision, resolved Layer Lineage, Delivery Mode, canonical archive parameters, and resulting Pack artifact identity. It explains reproducibility but is not an input to composition or publication.
_Avoid_: Materialization Record, Layer Manifest, release notes

**Tracked Content**:
An approved regular file or downloadable artifact that belongs to a Layer through an exact per-file declaration. Downloadable mods, plugins, resource packs, shader packs, datapacks, and other content payloads use immutable remote declarations and are never tracked by Git. Only configuration content may use a repository-backed declaration, in which case its source must also be tracked by Git. Git tracking alone never assigns Layer ownership. Filesystem links are never Tracked Content.
_Avoid_: Git-tracked file, arbitrary instance content, runtime files

**Repository-backed Configuration**:
Configuration Tracked Content whose exact source bytes live in the Layer repository and whose declaration uses a safe `./` source. It is the only instance content payload Git may track. Mirrored defaults stores do not change this classification: packaged mods, resource packs, shaders, datapacks, or other downloads remain remote even when a provider could copy them from a defaults tree.
_Avoid_: Repository-backed content, bundled downloaded artifact, arbitrary override

**Directory Selection**:
An authoring convenience in the CLI that expands a selected directory into exact per-file Tracked Content declarations before writing the Layer Manifest. It is not a manifest declaration or wildcard; untracked files and filesystem links are never selected.
_Avoid_: Directory Inclusion, Git directory, runtime wildcard

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

**Resolved Inventory**:
The provenance-aware view of every effective content declaration after composing a Layer Lineage. It records content kind, owning Layer, dependency relationships, provider metadata, license metadata, and replacement history when known. Validation, `lay list`, dependency reconciliation, documentation, licensing, and changelog generation consume this one derived model rather than scanning independently.
_Avoid_: Layer Manifest, duplicated metadata store, launcher file list

**Dependency Closure**:
The complete set of required content reachable from the resolved Pack's selected mods under its exact Runtime Target and compatibility adapters. `lay add`, update, and remove reconcile this closure transactionally; ordinary validation and builds report an incomplete closure but never mutate the Layer Manifest to repair it.
_Avoid_: Modrinth loader dependencies, optional recommendation, implicit launcher install

**Orphan Dependency**:
A dependency that was reachable before a removal or update operation but has no remaining dependents afterward. It is a cleanup candidate, not automatically disposable: library-like projects may default to removal, while useful standalone mods require confirmation.
_Avoid_: Unused local file, excluded ancestor content, incompatible dependency

**Update Candidate**:
The newest known artifact in the installed release channel that matches a current Layer-owned declaration's exact Runtime Target and passes every required compatibility adapter, including a successful Sinytra Probe where applicable. Merely needing manual testing does not disqualify it because all updates require testing; failed or inconclusive compatibility evidence does. Candidate discovery reports but never changes the Layer.
_Avoid_: Available version, inherited update, automated pull request

**Dismissed Candidate**:
An exact provider and candidate-version identity whose update issue was closed without adoption. Discovery never reports that same candidate again or reopens its issue; a later candidate version remains independently eligible. In combined reporting, closing an issue dismisses each exact candidate recorded in it.
_Avoid_: Ignored mod, release-channel pin, incompatible version

**Content Documentation**:
Markdown beneath the Layer Manifest's `docs` root, which defaults to repository-root `docs`. Namespaced frontmatter associates a document with one resolved Content Path and may supply human-maintained names, licenses, dependency notes, and attribution when supported providers or embedded metadata cannot. It supplements derived metadata and never replaces file identity or provenance.
_Avoid_: Layer Manifest, generated Pack content, provider metadata cache

**Change Fragment**:
A Markdown file under `.inlay/changes` that records one release-worthy intent through YAML frontmatter: SemVer bump, structured pack-domain changes, affected paths, replacements, and content associations, followed by human context. `lay version` consumes fragments transactionally to update Release Identity and the changelog.
_Avoid_: Git commit message, changelog entry, Materialization Drift

**Content Cache**:
A shared store of validated immutable Git objects, Pack artifacts, and payloads addressed by their native commit identity or verified SHA-512 digest. Cached objects may satisfy resolution offline; missing objects fail explicitly and never cause fallback to another version.
_Avoid_: Parent Reference, mutable download cache, availability guarantee

**Resolution Failure**:
The non-waivable inability to produce the exact validated Layer Lineage named by its Parent References. Missing objects, invalid manifests, identity or integrity mismatches, unsafe content, Runtime Target mismatches, and cycles are failures in every interaction mode.
_Avoid_: Warning, Parent Update choice, best-effort import

**Delivery Mode**:
The Distribution Target's single choice for how all Repository-backed Configuration reaches an installed Pack: bundled inside the Pack archive or downloaded from immutable, hash-verified locations.
_Avoid_: Ownership, Distribution Target

**Preview Build**:
A local, non-publishable Pack artifact that may snapshot uncommitted current-Layer configuration source when using bundled Delivery Mode. It is visibly distinguished from a Release Build and never establishes a release identity.
_Avoid_: Release Build, dirty release, publication candidate

**Release Build**:
A publishable Pack artifact produced from one exact clean Git commit. Git-ignored local state does not affect cleanliness, while tracked changes, staged changes, and non-ignored untracked files make the checkout ineligible.
_Avoid_: Preview Build, rebuilt publication, working-tree snapshot

**Release Identity**:
The Layer Manifest's SemVer `versionId`, used unchanged as the generated Pack version, Git version tag, and Modrinth version number. One Release Identity names immutable artifact bytes and publication metadata; any conflict requires a new version.
_Avoid_: Layer Version, destination-specific version, mutable release

**Release Channel**:
The explicit Modrinth classification of a Release Build as `release`, `beta`, or `alpha`. A stable Release Identity must use `release`; prerelease identities choose `beta` or `alpha` without inference from their SemVer label.
_Avoid_: SemVer prerelease label, Publication Destination, update channel

**Pack**:
The fully resolved client-and-server content model produced by composing a Layer with its ancestors. It preserves both Environment Slots and may be published through one or more Distribution Targets or projected into a playable Materialized Instance.
_Avoid_: Layer, delta, single-environment installation

**Distribution Target**:
External workflow configuration that asks Inlay to build or publish a Layer as a standard `.mrpack`. Its absence says nothing about Layer capability; it only means no distribution was requested in that workflow.
_Avoid_: Layer capability, manifest field, Publication Destination

**Undistributed Layer**:
A valid buildable Layer for which no Pack release currently exists on GitHub or Modrinth. This is observed publication state, never a declaration in the Layer Manifest.
_Avoid_: Nondistributable Layer, private Layer, invalid Layer

**Publication Destination**:
An independently selectable service, such as GitHub Releases or Modrinth, to which an already built Pack artifact is uploaded.
_Avoid_: Delivery Mode, Pack format

**Publication Limit**:
A non-configurable byte ceiling imposed by a configured Publication Destination on the final deterministic Pack artifact. Inlay checks the completed `.mrpack` before any upload and a multi-destination release must satisfy every selected destination. Exceeding a Publication Limit blocks that targeted build or release without making the Layer, resolved content, or `.mrpack` format invalid; local builds with no publication destination have no such ceiling. Limits live in destination adapters and change only with an Inlay release when the external service changes.
_Avoid_: Manifest field, resolved-content limit, archive-complexity budget
