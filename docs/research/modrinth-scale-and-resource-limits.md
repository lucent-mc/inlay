# Modrinth scale and resource limits

Research date: 2026-08-13

## Question

Which scale and resource limits does the current Modrinth `.mrpack` contract, publication service, and first-party App actually impose, and which limits would be inventions of Inlay?

## Conclusion

Modrinth does **not** publish a maximum number of `files[]` entries, ZIP entries, total remote bytes, total expanded override bytes, individual expanded override size, or compression ratio for `.mrpack`. Its current server validator and App likewise do not add explicit numeric ceilings for those properties.

Two numeric boundaries are observable and relevant:

1. `fileSize` is described publicly only as an integer byte count, but both Modrinth's server and App deserialize it as an unsigned 32-bit integer. The interoperable range is therefore `0..4,294,967,295` bytes.
2. The normal Modrinth website and API accept at most **500 MiB (524,288,000 bytes) per uploaded project artifact**, including a `.mrpack`. This is a publication-service limit on the compressed artifact, not a limit in the `.mrpack` format.

The API also accepts at most 256 uploaded artifact parts when creating one project version. That counts files attached to the Modrinth version—normally one `.mrpack` for a modpack release—not entries in the pack's `files[]` array or override directories.

For Inlay, this supports no manifest-level maximum layer depth and no new manifest-level file-count ceiling. Parent cycles must still be rejected. A Modrinth publication adapter must enforce the current 500 MiB artifact boundary, while a pack larger than that can remain a syntactically valid `.mrpack` for local or other distribution. Archive-bomb and resource-exhaustion guards remain an Inlay implementation/security decision because Modrinth provides no numeric policy to inherit.

## Findings by boundary

| Boundary | Current Modrinth behavior | What it means for Inlay |
| --- | --- | --- |
| Parent/layer depth | `.mrpack` has no parent concept, so Modrinth has no corresponding depth limit. | Do not add a schema maximum. Resolve iteratively, reject cycles, and report the chain on failure. |
| `files[]` entry count | No maximum is stated in the format definition. The server model is an unconstrained `Vec<PackFile>` and only applies nested entry validation. | Do not add `maxItems`. |
| `fileSize` | Publicly documented as an integer byte count; current server and App models use `u32`. | Accept only `0..4,294,967,295`, matching first-party Modrinth implementations. |
| Total remote download bytes | No documented or explicit validator maximum. | Do not make total resolved content size a manifest validity rule. |
| `.mrpack` uploaded artifact | Normal website and API limit each project file to 500 MiB. | Enforce when the build target includes Modrinth publication, not as universal `.mrpack` syntax. |
| Files attached to one Modrinth version | API creation metadata permits 1–256 `file_parts`. | This does not constrain pack contents. |
| ZIP entry count | No limit stated in the format or explicitly imposed by the current server/App `.mrpack` paths. | Do not invent a format limit; a defensive runtime budget remains open. |
| Expanded override bytes | No total or per-entry maximum stated or explicitly imposed. | A defensive extraction policy remains open. |
| Compression ratio | No stated or explicit maximum. | A ZIP-bomb policy remains open. |
| Manifest byte size | No stated maximum; server and App read the full manifest entry into a string. | A defensive parsing budget remains open. |

## Format and server validation

The official format definition calls `files` an array of files to download, but gives it no cardinality bound. It calls `fileSize` an integer containing the byte size and says it is chiefly useful for launcher progress reporting. Its ZIP storage section defines the root manifest and override directories without entry-count, compressed-size, expanded-size, or compression-ratio limits.[^format]

The current Labrinth model matches that public shape: `PackFormat.files` is `Vec<PackFile>` with nested validation but no length validator, while `PackFile.file_size` is `u32`.[^server-model] The upload validator:

- reads `modrinth.index.json` from the ZIP;
- validates the parsed model;
- requires at least one remote file or an `overrides/` entry;
- iterates every `files[]` entry to require SHA-1 and SHA-512; and
- scans archive file names for bundled JAR/ZIP dependencies.

It does not impose an explicit maximum entry count, total expanded bytes, per-entry expanded bytes, manifest size, or compression ratio in that path.[^server-validator]

The public prose therefore supports “no specified maximum,” not the stronger claim that arbitrary input is guaranteed to work. Available memory, disk, ZIP-library constraints, HTTP infrastructure, and operating-system limits can still cause a particular pack to fail.

## Publication-service limits

The current website sets `max-size="524288000"` on project-version file inputs.[^web-upload] The backend independently reads each multipart project file with a `500 * 2^20` cap and rejects anything larger with “Project file exceeds the maximum of 500MiB.”[^api-upload] The shared field reader rejects a chunk when adding it would exceed the cap, so exactly 500 MiB is accepted and any larger file is rejected by this code path.[^field-reader]

This limit is per uploaded project artifact. A `.mrpack` is one such artifact, and the official create-version API documentation lists `.mrpack` among accepted uploaded types.[^create-version]

Separately, the create-version server model validates `file_parts` with `min = 1, max = 256`.[^version-file-parts] These are multipart fields attached to the Modrinth version. This is not a limit of 256 remote or bundled files inside one `.mrpack`.

No current official documentation located for this research states a total expanded `.mrpack` limit or a total size limit across all `files[]` downloads. The 500 MiB boundary constrains only the uploaded ZIP bytes.

## Modrinth App behavior

The first-party App also models `files` as a `Vec<PackFile>` and `file_size` as `u32`, without a count constraint.[^app-model]

For local imports, the App now opens the `.mrpack` through a disk-backed ZIP reader; its source explicitly notes that local files may be multi-gigabyte and should not have to fit in memory.[^app-zip-reader] A separate 1 GiB constant only decides whether the App hashes the entire local archive to look it up on Modrinth. Files above that size continue through pack inspection and import; the constant is not an import-size ceiling.[^app-local-hash]

The current override path collects all matching archive entries, sums their declared uncompressed sizes for progress, then extracts them one at a time.[^app-overrides] Extraction streams decompressed bytes to a temporary file and checks CRC before replacing the destination, but it does not compare against an explicit per-entry size, total expanded-size, or compression-ratio ceiling.[^app-extraction]

The App does have operational network defaults, but these are not `.mrpack` validity rules: a 15-second connect timeout, a 30-second read timeout, two retries after the initial attempt, and four concurrent content downloads specifically in the modpack installer.[^app-network][^app-concurrency]

## Representative third-party implementations

This is a sample, not a claim about every launcher.

- Prism Launcher parses `files` as a JSON array, loops it into `std::vector<File>`, and does not apply a count maximum in that parser.[^prism]
- `mrpack-install` models `files` as a Go slice and iterates all ZIP entries without an explicit count cap in those paths.[^mrpack-install-index][^mrpack-install-zip]

Neither sample supplies a de facto ecosystem maximum that Inlay should encode.

## Resulting Inlay policy

The Modrinth-aligned policy can be settled as follows:

1. **Layer depth:** no maximum in the manifest or stable specification. Parent resolution must detect cycles and should avoid recursive call-stack dependence.
2. **Resolved file count:** no maximum in the manifest or stable specification. `files[]` must not gain `maxItems` merely as a performance guard.
3. **Remote `fileSize`:** use the Modrinth-compatible unsigned 32-bit range, maximum `4,294,967,295`.
4. **Modrinth artifact upload:** fail before publication when the generated `.mrpack` exceeds `524,288,000` bytes. Do not describe a larger artifact as format-invalid; describe it as not publishable to Modrinth through the normal service path.
5. **Other resource controls:** keep network concurrency, timeouts, cache bounds, and defensive archive budgets out of `inlay.index.json`. They concern the CLI/runtime, not layer meaning.

## Genuinely open questions

Modrinth does not answer the remaining archive-safety policy:

1. May Inlay reject a syntactically valid `.mrpack` or parent layer when its declared or observed resource use is unsafe, even though Modrinth publishes no equivalent numeric ceiling?
2. If yes, are archive/manifest budgets fixed implementation safety limits, configurable local/CI policy, or adaptive checks based on available disk and memory?
3. Which events are hard failures before extraction: excessive manifest bytes, excessive ZIP entries, excessive total expanded bytes, excessive individual expanded bytes, or excessive compression ratio?

These questions should not produce new fields in the stable layer manifest. They define how an implementation safely consumes untrusted inputs.

## Sources

[^format]: Modrinth, [Modrinth Modpack Format (`.mrpack`)](https://support.modrinth.com/en/articles/8802351-modrinth-modpack-format-mrpack).
[^server-model]: Modrinth `code`, [`PackFormat` and `PackFile` server models at `17f13097`](https://github.com/modrinth/code/blob/17f13097f2e5612396b2d4ec36c23392ba829c5f/apps/labrinth/src/models/v3/pack.rs#L8-L31).
[^server-validator]: Modrinth `code`, [server `.mrpack` validator at `17f13097`](https://github.com/modrinth/code/blob/17f13097f2e5612396b2d4ec36c23392ba829c5f/apps/labrinth/src/validate/modpack.rs#L25-L92).
[^web-upload]: Modrinth `code`, [website version-upload input at `17f13097`](https://github.com/modrinth/code/blob/17f13097f2e5612396b2d4ec36c23392ba829c5f/apps/frontend/src/components/ui/create-project-version/stages/AddFilesStage.vue#L13-L20).
[^api-upload]: Modrinth `code`, [500 MiB project-file cap at `17f13097`](https://github.com/modrinth/code/blob/17f13097f2e5612396b2d4ec36c23392ba829c5f/apps/labrinth/src/routes/v3/version_creation.rs#L936-L948).
[^field-reader]: Modrinth `code`, [bounded multipart field reader at `17f13097`](https://github.com/modrinth/code/blob/17f13097f2e5612396b2d4ec36c23392ba829c5f/apps/labrinth/src/util/routes.rs#L55-L70).
[^create-version]: Modrinth API, [Create a version](https://docs.modrinth.com/api/operations/createversion/).
[^version-file-parts]: Modrinth `code`, [`file_parts` validation at `17f13097`](https://github.com/modrinth/code/blob/17f13097f2e5612396b2d4ec36c23392ba829c5f/apps/labrinth/src/routes/v3/version_creation.rs#L51-L57).
[^app-model]: Modrinth `code`, [App `.mrpack` models at `17f13097`](https://github.com/modrinth/code/blob/17f13097f2e5612396b2d4ec36c23392ba829c5f/packages/app-lib/src/api/pack/install_from.rs#L24-L47).
[^app-zip-reader]: Modrinth `code`, [disk-backed local `.mrpack` reader at `17f13097`](https://github.com/modrinth/code/blob/17f13097f2e5612396b2d4ec36c23392ba829c5f/packages/app-lib/src/api/pack/install_mrpack.rs#L127-L153).
[^app-local-hash]: Modrinth `code`, [1 GiB hash-lookup threshold at `17f13097`](https://github.com/modrinth/code/blob/17f13097f2e5612396b2d4ec36c23392ba829c5f/packages/app-lib/src/api/pack/install_from.rs#L156-L204).
[^app-overrides]: Modrinth `code`, [override collection and extraction loop at `17f13097`](https://github.com/modrinth/code/blob/17f13097f2e5612396b2d4ec36c23392ba829c5f/packages/app-lib/src/api/pack/install_mrpack.rs#L958-L1037).
[^app-extraction]: Modrinth `code`, [streamed entry extraction at `17f13097`](https://github.com/modrinth/code/blob/17f13097f2e5612396b2d4ec36c23392ba829c5f/packages/app-lib/src/api/pack/install_mrpack.rs#L396-L462).
[^app-network]: Modrinth `code`, [App HTTP timeout and retry defaults at `17f13097`](https://github.com/modrinth/code/blob/17f13097f2e5612396b2d4ec36c23392ba829c5f/packages/app-lib/src/util/fetch.rs#L333-L355).
[^app-concurrency]: Modrinth `code`, [modpack content concurrency at `17f13097`](https://github.com/modrinth/code/blob/17f13097f2e5612396b2d4ec36c23392ba829c5f/packages/app-lib/src/api/pack/install_mrpack.rs#L40-L47).
[^prism]: Prism Launcher, [`files` parser at `d909e020`](https://github.com/PrismLauncher/PrismLauncher/blob/d909e0205d940cb2846fdab665aa3c69015303af/launcher/modplatform/modrinth/ModrinthInstanceCreationTask.cpp#L319-L382).
[^mrpack-install-index]: `mrpack-install`, [index model and reader at `480907b4`](https://github.com/nothub/mrpack-install/blob/480907b4ede34b6ecfa4cc1a6e5956083b40e0e6/modrinth/mrpack/index.go#L15-L48).
[^mrpack-install-zip]: `mrpack-install`, [ZIP iterator at `480907b4`](https://github.com/nothub/mrpack-install/blob/480907b4ede34b6ecfa4cc1a6e5956083b40e0e6/modrinth/mrpack/zip.go#L8-L32).
