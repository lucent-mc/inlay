# Distribution and execution trust constraints

Research date: 2026-08-13

## Question

Which current constraints imposed by the Modrinth `.mrpack` format and review process, Git/GitHub immutable content addressing, archive extraction, and GitHub Actions security must the layered-modpack specification honor, and which remaining trust policies are choices for this toolkit?

## Conclusion

Four independent properties must not be collapsed into one idea of “trusted”:

1. **Identity:** the bytes selected for a build are fixed and verifiable.
2. **Availability:** those bytes can still be fetched when a pack is installed.
3. **Authorization:** the pack author has permission to redistribute those bytes.
4. **Execution safety:** untrusted archives, repository content, mods, and workflow inputs cannot escape their intended filesystem or CI privilege boundary.

A Git commit ID plus the `.mrpack` SHA-1 and SHA-512 fields gives strong byte identity. It does not guarantee that the repository remains public or the object remains available, prove that the publisher had redistribution permission, establish who authored the commit, or make the downloaded code safe to execute. The toolkit must model or enforce these concerns separately.

## Externally imposed constraints

### Modrinth `.mrpack` format

For an artifact intended for Modrinth, the following are format or upload-validation requirements rather than toolkit preferences:

- `.mrpack` is the only modpack format accepted by Modrinth. It is a ZIP whose UTF-8 `modrinth.index.json` is at the archive root; the current format version is `1`, and `game` is `minecraft`.[^mrpack]
- Every remote `files[]` entry names an instance-relative destination path. Modrinth warns importers not to permit `..`, absolute paths, drive-prefixed paths, or paths beginning with either slash, and says uploaded packs are validated for this.[^mrpack]
- Every remote file entry must include both SHA-1 and SHA-512. `fileSize` is also part of the file entry, although Modrinth describes it chiefly as progress-reporting utility.[^mrpack]
- Download URLs must be HTTPS and valid RFC 3986 URIs. Modrinth upload validation currently accepts only `cdn.modrinth.com`, `github.com`, `raw.githubusercontent.com`, and `gitlab.com`. Importers must follow a reasonable number of HTTP redirects; Modrinth recommends at least three.[^mrpack]
- `env.client` and `env.server`, when present, are each `required`, `optional`, or `unsupported`. Consumers must distinguish a dedicated server from the logical server inside a client.[^mrpack]
- The currently named dependency keys are `minecraft`, `forge`, `neoforge`, `fabric-loader`, and `quilt-loader`; implementers are explicitly told to tolerate future keys.[^mrpack]
- Bundled content is installed from `overrides/`; `server-overrides/` and `client-overrides/` are optional and apply after the common overrides, replacing collisions for their respective environment.[^mrpack]

The format permits all four approved download domains. It does **not** require GitHub URLs to use commits instead of branches or tags, require a particular order for `files[]`, prescribe deterministic ZIP metadata, define layered-pack provenance, or define a trust policy for imported packs. Those are toolkit decisions.

### Modrinth publication and review

Publishing a valid ZIP is not sufficient for approval:

- Modrinth’s content rules require uploaders to own or hold the necessary rights and permissions to store, share, and distribute uploaded content, prohibit direct reuploads without explicit permission, and require accurate project metadata and dependencies.[^modrinth-rules]
- Modrinth’s modpack-permissions guidance says each third-party file must be evaluated. A file actually hosted on Modrinth is permitted for use in Modrinth modpacks; a merely related project page is not enough. Otherwise, redistribution needs an applicable license, an author statement permitting it, or direct permission. The author remains responsible even though moderators make a preliminary blacklist check.[^modrinth-permissions]
- Consequently, using an allowed `raw.githubusercontent.com` URL does not create redistribution permission. “Hosted” versus “bundled” changes transport, not the authorization requirement.
- The Modrinth API’s create-version operation requires `VERSION_CREATE`, a multipart metadata body, and at least one uploaded file for a non-draft version; `.mrpack` is accepted.[^modrinth-create-version] Modrinth recommends its own personal access tokens or OAuth for authenticated API operations and warns that legacy GitHub-token authentication will cease with API v3.[^modrinth-api]

Evidence about permission should therefore be attached to tracked content or release policy rather than inferred from a successful build. Whether the manifest records that evidence per entry, a separate allowlist records it, or CI only requires a human attestation remains a toolkit decision.

### Git and GitHub addressing

Git objects are content-addressed and never change after creation. A commit identifies its complete top-level tree, and Git can recover the exact contents while the object remains stored.[^git-data-model] GitHub likewise documents that substituting a commit ID for a branch in a file URL produces a permanent link to that exact file version.[^github-permalinks]

This supports the following inference for repository-owned remote content:

```text
https://raw.githubusercontent.com/OWNER/REPOSITORY/FULL_COMMIT_SHA/PATH
```

is stable with respect to repository ref movement, provided the commit remains available and `PATH` is a regular file at that commit. GitHub documents `raw.githubusercontent.com` as its raw-content host,[^github-limits] and its repository Contents API accepts a commit as `ref` and exposes raw content.[^github-contents]

Important limits remain:

- Git itself says exact recovery is conditional on the object not having been deleted. Reachable objects are retained, but unreachable objects may be pruned.[^git-data-model] Repository deletion, access changes, or account/platform availability can still break an otherwise immutable URL.
- GitHub blocks regular Git blobs larger than 100 MiB and warns at 50 MiB.[^github-limits] This constrains repository-backed hosting even though a `.mrpack` entry itself has no equivalent limit stated in the format article.
- Git trees distinguish regular files, executable files, symbolic links, directories, and gitlinks/submodules.[^git-data-model] Git can check symlinks out as small regular files on filesystems where `core.symlinks=false`, so working-tree appearance is not a portable statement of file type.[^git-symlinks]
- GitHub’s Contents API may dereference a symlink whose target is another regular file in the same repository.[^github-contents] A tool that intends “these exact repository path bytes” must inspect the Git tree entry type, not silently rely on working-tree or API dereference behavior.

Full commit pinning is therefore a sound toolkit rule for immutable selection, but availability guarantees, mirrors, repository visibility checks, accepted Git object types, signed-commit requirements, and trusted-repository allowlists are policy choices. The `.mrpack` SHA-1 and SHA-512 must always be verified after download even when the URL contains a commit ID.

### GitHub Actions execution model

Reusable workflows inherit authority from the caller rather than from the toolkit repository:

- The `GITHUB_TOKEN` is a short-lived GitHub App installation token limited to the repository containing the caller workflow.[^github-token]
- A called or nested reusable workflow can only maintain or reduce the caller’s `GITHUB_TOKEN` permissions; it cannot elevate them. The called workflow’s `github` context and token are associated with the caller.[^github-reuse-reference]
- Secrets must be passed to reusable workflows explicitly or through `secrets: inherit`; environment secrets cannot be passed through `on.workflow_call`. A job-level environment in the called workflow uses that environment’s secret instead.[^github-reuse]
- GitHub recommends least privilege and notes that an action can access `github.token` even when it was not explicitly passed as an input.[^github-token-auth]
- Creating update-candidate issues needs `issues: write`; GitHub’s own example also grants `contents: read`.[^github-token-auth] Creating a GitHub Release needs `contents: write`.[^github-releases]
- A Modrinth publishing job needs a separately supplied Modrinth credential with `VERSION_CREATE`; `GITHUB_TOKEN` does not provide that authority.[^modrinth-create-version]

GitHub permits reusable workflows to be referenced by branch, tag, or SHA, but calls a commit SHA the safest choice.[^github-reuse] For third-party actions, GitHub is stronger: it says a full-length commit SHA is currently the only immutable release reference and warns that tags can be moved or deleted.[^github-secure-use] Organization or repository policy can require full-SHA pinning for actions, but GitHub notes that reusable workflows may still be referenced by tag under that enforcement setting.[^github-actions-policy]

Untrusted-code boundaries matter directly to this project:

- GitHub warns that privileged `pull_request_target` and `workflow_run` flows which check out untrusted pull-request content can expose write access, secrets, and privileged caches.[^github-secure-use]
- GitHub also warns that a compromised action or job can affect other jobs and access available secrets or token authority.[^github-secure-use]
- Fork pull-request workflows normally receive a read-only token and no secrets unless repository or organization policy deliberately relaxes those safeguards.[^github-actions-settings]
- Environment protection can require approval before a job starts or receives environment secrets.[^github-environments]

Thus build/validation can safely default to unprivileged pull-request execution, while publication and issue mutation require explicit caller permissions and trusted triggers. Exactly how to split jobs and workflows is a toolkit architecture decision.

## Recommended toolkit trust policies

These are not all demanded verbatim by Modrinth or GitHub, but they are the safest specification defaults implied by the constraints above.

### 1. Pin and verify every external input

- Require full commit IDs for Git parents and GitHub-hosted repository content. A tag or release may be authoring input only if resolution immediately records the resulting full commit ID.
- Verify the expected repository identity and that the selected Git tree entry is a regular file. Reject symlinks and gitlinks for distributed content by default.
- Verify downloaded bytes against the declared SHA-512 and SHA-1 before they enter an instance or build. Treat a hash mismatch as a hard failure, never as a prompt to update the manifest.
- Keep source identity separate from byte identity. A full commit ID says which bytes; a repository allowlist or explicit parent approval says whose bytes are trusted. Commit signing could strengthen author identity, but requiring signatures is a separate decision.
- Consider multiple download URLs or an explicit cache policy only if availability requirements justify them. Do not claim that a commit-addressed GitHub URL is permanently available.

### 2. Treat imported packs and repository trees as untrusted archives

Apply one path-containment policy to `files[].path`, every ZIP entry under each override directory, every layer-owned path, and every materialization destination:

- normalize separators in a platform-neutral representation before validation;
- reject absolute, drive-prefixed, UNC/device, NUL-containing, empty-segment, `.`/`..`, and root-escaping paths;
- reject duplicate normalized paths, file/directory prefix conflicts, Unicode/case-fold collisions that would alias on supported filesystems, and platform-reserved names;
- calculate the final destination under a freshly created staging root and prove it remains contained before writing;
- reject symlinks, hard links, devices, sockets, and other non-regular entries; inspect each existing destination ancestor with `lstat` rather than following a link. Node exposes `lstat` to inspect the link itself and `realpath` to resolve the actual destination.[^node-fs]
- impose configurable but safe default limits on entry count, total uncompressed bytes, individual file size, compression ratio, redirect count, and download time. These are defenses against resource exhaustion, not requirements specified by the `.mrpack` article;
- extract to a staging directory, validate hashes and the complete write plan, then materialize. Do not partially update the playable instance from a failed or ambiguous import.

Modrinth explicitly describes the containment requirement for `files[].path`; extending it to override ZIP entries and local materialization is toolkit policy necessary to close the same class of escape.

### 3. Separate analysis from mutation in Actions

Use distinct permission profiles:

| Job class | Default authority |
| --- | --- |
| PR build/validate | `contents: read`; no publication secrets |
| Compatibility probe / game or mod execution | no secrets; read-only token or `permissions: {}`; ephemeral GitHub-hosted runner |
| Scheduled update discovery | `contents: read`; no issue mutation while candidate code executes |
| Update issue publisher | `contents: read`, `issues: write`; consume only a narrow, validated result |
| GitHub release publisher | `contents: write`; protected environment recommended |
| Modrinth publisher | only the named Modrinth secret with `VERSION_CREATE`; protected environment recommended |

Sinytra Probe and any launched Minecraft/mod code must be treated as arbitrary third-party code. It should not share a job, writable cache, credential, or privileged runner with issue or release publication. GitHub-hosted runners are the safer default; GitHub cautions that self-hosted runners are not isolated merely because environments are used.[^github-environments]

Reusable workflow callers should:

- pin the toolkit workflow by full commit SHA;
- grant each called job only the permissions it needs;
- pass named secrets instead of `secrets: inherit`;
- reserve release triggers for trusted tags, protected branches, or manual dispatches, with environment approval where desired;
- pin all third-party actions by verified full commit SHA and review their source.

### 4. Make deterministic output observable

Modrinth does not prescribe deterministic ZIP timestamps, ordering, or compression settings. The toolkit should do so anyway, then publish SHA-256 (in addition to the `.mrpack`-internal SHA-1/SHA-512 file hashes) for the final artifact. GitHub artifact attestations are an optional future policy; GitHub supports build provenance attestations using `id-token: write` and `contents: read`.[^github-attestations]

## Decisions still left to the specification

The external contracts narrow the design but do not answer these questions:

1. Is repository availability “best effort,” or must hosted delivery support mirrors/cache fallback and preflight availability checks?
2. Where and at what granularity is redistribution permission evidence recorded and reviewed?
3. Are symbolic links and gitlinks always prohibited, or can a future manifest entry opt into a precisely defined dereferenced-file behavior?
4. Does trusting a Git parent require only repository URL plus commit ID, or also an allowlist, signed commit/tag verification, or an expected manifest hash?
5. What exact staging, collision, Unicode, filesystem-reserved-name, and archive resource limits define the supported cross-platform materialization contract?
6. How are unprivileged compatibility results transferred to the privileged issue-publishing workflow without trusting executable-produced Markdown, labels, commands, paths, or URLs?
7. Which release environments, required reviewers, and secret names form the reusable publication contract?

## Sources

[^mrpack]: Modrinth, [Modrinth Modpack Format (`.mrpack`)](https://support.modrinth.com/en/articles/8802351-modrinth-modpack-format-mrpack).
[^modrinth-rules]: Modrinth, [Content Rules](https://modrinth.com/legal/rules).
[^modrinth-permissions]: Modrinth, [Obtaining modpack permissions](https://support.modrinth.com/en/articles/8797527-obtaining-modpack-permissions).
[^modrinth-create-version]: Modrinth API, [Create a version](https://docs.modrinth.com/api/operations/createversion/).
[^modrinth-api]: Modrinth API, [Overview and authentication](https://docs.modrinth.com/api/).
[^git-data-model]: Git, [Git’s core data model](https://git-scm.com/docs/gitdatamodel.html).
[^github-permalinks]: GitHub Docs, [Getting permanent links to files](https://docs.github.com/en/repositories/working-with-files/using-files/getting-permanent-links-to-files).
[^github-limits]: GitHub Docs, [About large files on GitHub](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github).
[^github-contents]: GitHub Docs, [REST API endpoints for repository contents](https://docs.github.com/en/rest/repos/contents#get-repository-content).
[^git-symlinks]: Git, [`core.symlinks` in `git-config`](https://git-scm.com/docs/git-config#Documentation/git-config.txt-coresymlinks).
[^github-token]: GitHub Docs, [`GITHUB_TOKEN`](https://docs.github.com/en/actions/concepts/security/github_token).
[^github-reuse-reference]: GitHub Docs, [Reusing workflow configurations](https://docs.github.com/en/actions/reference/workflows-and-actions/reusing-workflow-configurations).
[^github-reuse]: GitHub Docs, [Reuse workflows](https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows).
[^github-token-auth]: GitHub Docs, [Use `GITHUB_TOKEN` for authentication in workflows](https://docs.github.com/en/actions/tutorials/authenticate-with-github_token).
[^github-releases]: GitHub Docs, [REST API endpoints for releases](https://docs.github.com/en/rest/releases/releases#create-a-release).
[^github-secure-use]: GitHub Docs, [Secure use reference](https://docs.github.com/en/actions/reference/security/secure-use).
[^github-actions-policy]: GitHub Docs, [Managing GitHub Actions settings for a repository](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository).
[^github-actions-settings]: GitHub Docs, [Managing GitHub Actions settings for a repository](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository#enabling-workflows-for-private-repository-forks).
[^github-environments]: GitHub Docs, [Deployments and environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments).
[^node-fs]: Node.js, [File system API: `lstat` and `realpath`](https://nodejs.org/api/fs.html).
[^github-attestations]: GitHub Docs, [Using artifact attestations to establish provenance for builds](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations).
