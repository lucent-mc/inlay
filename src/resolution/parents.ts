import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { ContentCache } from "../adapters/cache.js";
import { GitAdapter } from "../adapters/git.js";
import { HttpAdapter } from "../adapters/http.js";
import { MANIFEST_FILENAME } from "../constants.js";
import { error, InlayError } from "../diagnostics.js";
import { hashes } from "../lib/hash.js";
import { resolveInside } from "../lib/path.js";
import { effectiveEnvironment, isRepositoryFile, parseManifest, readManifest } from "../manifest/index.js";
import type {
  LayerContentInput,
  LayerManifest,
  LoadedLayer,
  ParentReference,
  ResolvableLayer,
} from "../types.js";
import { importMrpack } from "./import-mrpack.js";

interface ResolvedParentFile {
  url: string;
  bytes: Uint8Array;
  filename: string;
  commit?: string;
  repositoryUrl?: string;
  rawBase?: string;
}

const githubTreeCache = new Map<string, Promise<Map<string, { mode: string; type: string }>>>();

async function assertGithubRegularFile(
  owner: string,
  repo: string,
  commit: string,
  filename: string,
): Promise<void> {
  const key = `${owner}/${repo}@${commit}`;
  let pending = githubTreeCache.get(key);
  if (!pending) {
    pending = (async () => {
      const response = await fetch(
        `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees/${encodeURIComponent(commit)}?recursive=1`,
        { headers: { accept: "application/vnd.github+json", "user-agent": "lucent-mc/inlay" } },
      );
      if (!response.ok) {
        throw new InlayError(error("github-tree", `GitHub tree lookup returned HTTP ${response.status}.`));
      }
      const data = (await response.json()) as {
        truncated?: boolean;
        tree?: Array<{ path?: string; mode?: string; type?: string }>;
      };
      if (data.truncated) {
        throw new InlayError(error("github-tree-truncated", "GitHub truncated the immutable parent tree."));
      }
      return new Map(
        (data.tree ?? []).flatMap((entry) =>
          entry.path && entry.mode && entry.type
            ? [[entry.path, { mode: entry.mode, type: entry.type }] as const]
            : [],
        ),
      );
    })();
    githubTreeCache.set(key, pending);
  }
  const entry = (await pending).get(filename);
  if (entry?.type !== "blob" || entry.mode === "120000") {
    throw new InlayError(
      error("github-source-type", `${filename} is not a regular file in ${owner}/${repo}@${commit}.`, {
        path: filename,
      }),
    );
  }
}

export async function lockParentReference(
  source: string,
  options: { version?: string; filename?: string } = {},
): Promise<ParentReference> {
  const sourceUrl = new URL(source);
  let resolvedUrl = source;
  let resolvedFilename = options.filename ?? decodeURIComponent(sourceUrl.pathname.split("/").at(-1) ?? "");
  const github = githubParts(sourceUrl);
  let githubCommit: string | undefined;
  let lockedSource = source;
  if (github) {
    const selector = github.commit ?? options.version;
    if (!selector) {
      throw new InlayError(
        error(
          "parent-version-required",
          "A GitHub parent requires a full commit ID or release/tag selector in the URL or --version.",
        ),
      );
    }
    githubCommit = /^[0-9a-f]{40,64}$/i.test(selector)
      ? selector
      : await resolveGithubCommit(github.owner, github.repo, selector);
    resolvedFilename = options.filename ?? github.filename ?? MANIFEST_FILENAME;
    await assertGithubRegularFile(github.owner, github.repo, githubCommit, resolvedFilename);
    resolvedUrl = `https://raw.githubusercontent.com/${github.owner}/${github.repo}/${githubCommit}/${resolvedFilename}`;
    if (github.commit && github.commit !== githubCommit) {
      lockedSource = `https://github.com/${github.owner}/${github.repo}`;
    }
  } else if (sourceUrl.hostname.includes("modrinth.com")) {
    const provisional: ParentReference = {
      url: source,
      ...(options.version === undefined ? {} : { version: options.version }),
      ...(options.filename === undefined ? {} : { filename: options.filename }),
      hashes: { sha1: "0".repeat(40), sha256: "0".repeat(64) },
      fileSize: 0,
    };
    const artifact = await modrinthArtifact(provisional);
    resolvedUrl = artifact.url;
    resolvedFilename = artifact.filename;
  }
  if (!resolvedFilename)
    throw new InlayError(error("parent-filename-missing", "The parent source does not resolve a filename."));
  const response = await fetch(resolvedUrl, { redirect: "follow" });
  if (!response.ok)
    throw new InlayError(error("parent-download", `${resolvedUrl} returned HTTP ${response.status}.`));
  const bytes = new Uint8Array(await response.arrayBuffer());
  const actual = hashes(bytes);
  const lockedVersion = github
    ? githubCommit && (!github.commit || github.commit !== githubCommit)
      ? githubCommit
      : undefined
    : options.version;
  const reference: ParentReference = {
    url: lockedSource,
    ...(lockedVersion === undefined ? {} : { version: lockedVersion }),
    ...(options.filename === undefined && !github?.filename ? {} : { filename: resolvedFilename }),
    hashes: { sha1: actual.sha1, sha256: actual.sha256 },
    fileSize: bytes.byteLength,
  };
  await new LineageResolver().parent(reference, new Set());
  return reference;
}

async function resolveGithubCommit(owner: string, repo: string, selector: string): Promise<string> {
  const response = await fetch(
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits/${encodeURIComponent(selector)}`,
    { headers: { accept: "application/vnd.github+json", "user-agent": "lucent-mc/inlay" } },
  );
  if (!response.ok) {
    throw new InlayError(
      error("parent-selector", `GitHub selector ${selector} returned HTTP ${response.status}.`),
    );
  }
  const data = (await response.json()) as { sha?: string };
  if (!data.sha || !/^[0-9a-f]{40,64}$/i.test(data.sha)) {
    throw new InlayError(
      error("parent-selector", `GitHub selector ${selector} did not resolve to a full commit ID.`),
    );
  }
  return data.sha;
}

function githubParts(
  url: URL,
): { owner: string; repo: string; commit?: string; filename?: string } | undefined {
  if (url.hostname === "raw.githubusercontent.com") {
    const [owner, repo, commit, ...rest] = url.pathname.split("/").filter(Boolean);
    if (owner && repo && commit) return { owner, repo, commit, filename: rest.join("/") };
  }
  if (url.hostname === "github.com") {
    const parts = url.pathname.split("/").filter(Boolean);
    const [owner, repo] = parts;
    if (!owner || !repo) return undefined;
    if (parts[2] === "blob" && parts[3])
      return {
        owner,
        repo: repo.replace(/\.git$/, ""),
        commit: parts[3],
        filename: parts.slice(4).join("/"),
      };
    return { owner, repo: repo.replace(/\.git$/, "") };
  }
  return undefined;
}

async function modrinthArtifact(reference: ParentReference): Promise<{ url: string; filename: string }> {
  const parsed = new URL(reference.url);
  if (parsed.hostname === "cdn.modrinth.com") {
    return {
      url: reference.url,
      filename:
        reference.filename ?? decodeURIComponent(parsed.pathname.split("/").at(-1) ?? "parent.mrpack"),
    };
  }
  const match = parsed.pathname.match(/\/(?:modpack|project)\/([^/]+)/);
  const embeddedVersion = parsed.pathname.match(/\/(?:modpack|project)\/[^/]+\/version\/([^/]+)/)?.[1];
  const version = embeddedVersion ?? reference.version;
  if (!match?.[1] || !version) {
    throw new InlayError(error("parent-resolution", "A Modrinth project URL requires an exact version ID."));
  }
  const response = await fetch(`https://api.modrinth.com/v2/version/${encodeURIComponent(version)}`);
  if (!response.ok)
    throw new InlayError(
      error("parent-resolution", `Modrinth version ${version} returned HTTP ${response.status}.`),
    );
  const metadata = (await response.json()) as {
    project_id?: string;
    files?: Array<{ filename: string; url: string }>;
  };
  const candidates = (metadata.files ?? []).filter((file) =>
    reference.filename
      ? file.filename === reference.filename
      : file.filename.toLowerCase().endsWith(".mrpack"),
  );
  if (candidates.length !== 1) {
    throw new InlayError(
      error(
        "parent-artifact-ambiguous",
        `Expected exactly one Modrinth parent artifact, found ${candidates.length}.`,
      ),
    );
  }
  const candidate = candidates[0];
  if (!candidate)
    throw new InlayError(error("parent-artifact-missing", "No Modrinth parent artifact matched."));
  return candidate;
}

async function resolveParentFile(reference: ParentReference, http: HttpAdapter): Promise<ResolvedParentFile> {
  const url = new URL(reference.url);
  let resolvedUrl = reference.url;
  let filename = reference.filename ?? decodeURIComponent(url.pathname.split("/").at(-1) ?? "");
  let commit: string | undefined;
  let repositoryUrl: string | undefined;
  let rawBase: string | undefined;

  const github = githubParts(url);
  if (github) {
    commit = github.commit ?? reference.version;
    if (!commit || !/^[0-9a-f]{40,64}$/i.test(commit)) {
      throw new InlayError(
        error("parent-version-mutable", "A GitHub parent must resolve to a full commit ID."),
      );
    }
    filename = reference.filename ?? github.filename ?? MANIFEST_FILENAME;
    await assertGithubRegularFile(github.owner, github.repo, commit, filename);
    resolvedUrl = `https://raw.githubusercontent.com/${github.owner}/${github.repo}/${commit}/${filename}`;
    repositoryUrl = `https://github.com/${github.owner}/${github.repo}`;
    rawBase = `https://raw.githubusercontent.com/${github.owner}/${github.repo}/${commit}`;
  } else if (url.hostname.includes("modrinth.com")) {
    const artifact = await modrinthArtifact(reference);
    resolvedUrl = artifact.url;
    filename = artifact.filename;
  } else if (!filename) {
    throw new InlayError(error("parent-filename-missing", "A direct parent URL must identify a filename."));
  }

  const bytes = await http.download([resolvedUrl], {
    fileSize: reference.fileSize,
    sha1: reference.hashes.sha1,
    sha256: reference.hashes.sha256,
  });
  return {
    url: resolvedUrl,
    bytes,
    filename,
    ...(commit === undefined ? {} : { commit }),
    ...(repositoryUrl === undefined ? {} : { repositoryUrl }),
    ...(rawBase === undefined ? {} : { rawBase }),
  };
}

async function nativeContent(
  manifest: LayerManifest,
  source: LoadedLayer["source"],
): Promise<LayerContentInput[]> {
  return Promise.all(
    manifest.files.map(async (declaration): Promise<LayerContentInput> => {
      const env = effectiveEnvironment(declaration);
      const applicable = (["client", "server"] as const).filter((slot) => env[slot] !== "unsupported");
      const scope = applicable.length === 1 ? (applicable[0] ?? "common") : "common";
      if (!isRepositoryFile(declaration)) {
        return {
          path: declaration.path,
          scope,
          env,
          declaration,
          payload: {
            kind: "remote",
            downloads: declaration.downloads,
            hashes: declaration.hashes,
            fileSize: declaration.fileSize,
          },
        };
      }

      const relativeSource = declaration.downloads[0].slice(2);
      if (source.kind === "local" && source.repositoryRoot) {
        const filename = resolveInside(source.repositoryRoot, relativeSource);
        const stats = await lstat(filename);
        if (!stats.isFile() || stats.isSymbolicLink()) {
          throw new InlayError(error("repository-source-type", `${relativeSource} is not a regular file.`));
        }
        return {
          path: declaration.path,
          scope,
          env,
          declaration,
          payload: {
            kind: "repository",
            source: relativeSource,
            repositoryRoot: source.repositoryRoot,
            hashes: declaration.hashes,
            fileSize: declaration.fileSize,
          },
        };
      }
      if (source.kind === "github" && source.manifestUrl) {
        const repository = source.repositoryUrl ? githubParts(new URL(source.repositoryUrl)) : undefined;
        if (!repository || !source.commit) {
          throw new InlayError(
            error("github-source", `Cannot identify the repository for ${relativeSource}.`),
          );
        }
        await assertGithubRegularFile(repository.owner, repository.repo, source.commit, relativeSource);
        const rawBase = source.manifestUrl.slice(0, source.manifestUrl.lastIndexOf("/"));
        return {
          path: declaration.path,
          scope,
          env,
          declaration,
          payload: {
            kind: "repository",
            source: relativeSource,
            rawUrl: `${rawBase}/${relativeSource.split("/").map(encodeURIComponent).join("/")}`,
            hashes: declaration.hashes,
            fileSize: declaration.fileSize,
          },
        };
      }
      throw new InlayError(
        error(
          "repository-source-unresolvable",
          `Cannot resolve repository-backed ${declaration.path} from ${source.label}.`,
        ),
      );
    }),
  );
}

export class LineageResolver {
  readonly http: HttpAdapter;

  constructor(cache = new ContentCache()) {
    this.http = new HttpAdapter(cache);
  }

  async local(root: string): Promise<ResolvableLayer[]> {
    const { manifest } = await readManifest(root);
    const git = new GitAdapter(root);
    const repositoryRoot = (await git.isRepository()) ? await git.root() : path.resolve(root);
    const commit = await git.head();
    const remote = await git.remoteUrl();
    const source = {
      kind: "local" as const,
      label: repositoryRoot,
      repositoryRoot,
      ...(remote === undefined ? {} : { repositoryUrl: remote }),
      ...(commit === undefined ? {} : { commit }),
    };
    const current: ResolvableLayer = {
      manifest,
      source,
      identity: {
        name: manifest.name,
        versionId: manifest.versionId,
        source: remote ?? repositoryRoot,
        ...(commit === undefined ? {} : { revision: commit }),
        imported: false,
      },
      content: await nativeContent(manifest, source),
    };
    const ancestors = manifest.extends ? await this.parent(manifest.extends, new Set()) : [];
    return [...ancestors, current];
  }

  async parent(reference: ParentReference, seen: Set<string>): Promise<ResolvableLayer[]> {
    const file = await resolveParentFile(reference, this.http);
    const identityHash = hashes(file.bytes).sha256;
    if (seen.has(identityHash))
      throw new InlayError(error("lineage-cycle", `Layer lineage repeats ${file.url}.`));
    seen.add(identityHash);
    const looksLikeArchive = file.filename.toLowerCase().endsWith(".mrpack") || file.bytes[0] === 0x50;
    if (looksLikeArchive) return [importMrpack(file.bytes, file.url, identityHash)];

    const { manifest } = await parseManifest(file.bytes);
    if (!file.commit || !file.repositoryUrl || !file.rawBase) {
      throw new InlayError(
        error("native-parent-not-git", "A native parent manifest must be addressed by a full GitHub commit."),
      );
    }
    const source = {
      kind: "github" as const,
      label: file.repositoryUrl,
      repositoryUrl: file.repositoryUrl,
      commit: file.commit,
      manifestUrl: file.url,
    };
    const layer: ResolvableLayer = {
      manifest,
      source,
      identity: {
        name: manifest.name,
        versionId: manifest.versionId,
        source: file.repositoryUrl,
        revision: file.commit,
        imported: false,
      },
      content: await nativeContent(manifest, source),
    };
    const ancestors = manifest.extends ? await this.parent(manifest.extends, seen) : [];
    return [...ancestors, layer];
  }
}

export async function readPayload(
  content: LayerContentInput["payload"],
  http: HttpAdapter,
): Promise<Uint8Array> {
  if (content.kind === "archive") return content.bytes;
  if (content.kind === "remote") {
    return http.download(
      content.downloads,
      { fileSize: content.fileSize, sha1: content.hashes.sha1, sha512: content.hashes.sha512 },
      {
        allowedHosts: new Set(["cdn.modrinth.com", "github.com", "raw.githubusercontent.com", "gitlab.com"]),
      },
    );
  }
  if (content.repositoryRoot) return readFile(resolveInside(content.repositoryRoot, content.source));
  if (content.rawUrl) {
    return http.download([content.rawUrl], {
      fileSize: content.fileSize,
      sha1: content.hashes.sha1,
      sha256: content.hashes.sha256,
    });
  }
  throw new InlayError(
    error("payload-source-missing", `No readable payload source exists for ${content.source}.`),
  );
}
