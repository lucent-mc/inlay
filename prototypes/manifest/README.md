# Author-facing manifest prototype

> Throwaway prototype. This is not the published Inlay schema or implementation.

This prototype tests one question:

> Can `inlay.index.json` remain a flat Modrinth index document, with only inheritance, exclusion, and distribution behavior added, while one `files[]` inventory describes both remote and repository-backed content?

Run the interactive comparison:

```shell
pnpm prototype:manifest
```

Validate every representative document non-interactively:

```shell
pnpm prototype:manifest -- --check
```

## Proposed shape

Every ordinary Modrinth file entry remains unchanged:

```json
{
  "path": "mods/sodium.jar",
  "hashes": { "sha1": "…", "sha512": "…" },
  "downloads": ["https://cdn.modrinth.com/…/sodium.jar"],
  "fileSize": 123456
}
```

Inlay adds a repository-backed authoring form to the same array:

```json
{
  "path": "config",
  "downloads": ["./config"]
}
```

The destination `path` participates in the same per-path composition as every other file. If the resolved parent already owns that path, the current entry is an implicit override. Otherwise it is an addition.

The relative source may resolve to a Git-tracked regular file or directory. A directory expands recursively into real files. Symlinks are never included.

For `distribution.delivery: "bundled"`, repository-backed entries are copied into `overrides`, `client-overrides`, or `server-overrides` and omitted from the generated `modrinth.index.json`. For `"github"`, they become commit-addressed HTTPS downloads with computed SHA-1, SHA-512, and size. Existing HTTPS entries always retain normal Modrinth behavior.

The authored document therefore needs only these top-level Inlay additions:

- `$schema`
- `extends`
- `exclusions`
- `distribution`

There is no separate include list and no explicit override declaration.
