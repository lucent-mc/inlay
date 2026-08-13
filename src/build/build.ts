import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { type ZipOptions, zipSync } from "fflate";
import { GitAdapter } from "../adapters/git.js";
import { GITHUB_RELEASE_UPLOAD_LIMIT, MODRINTH_UPLOAD_LIMIT, TOOLKIT_VERSION } from "../constants.js";
import { error, InlayError } from "../diagnostics.js";
import { hashes } from "../lib/hash.js";
import { canonicalJson } from "../lib/json.js";
import { checkPack } from "../operations/resolve.js";
import type { Environment, FileEnvironment, RemoteFileDeclaration, ResolvedContent } from "../types.js";

export type PublicationTarget = "github" | "modrinth";

export interface BuildOptions {
  outputDirectory?: string;
  publicationTargets?: PublicationTarget[];
}

export interface BuildRecord {
  formatVersion: 1;
  toolkitVersion: string;
  sourceCommit: string | null;
  publishable: boolean;
  preview: boolean;
  lineage: unknown[];
  delivery: "bundled" | "github";
  artifact: { filename: string; fileSize: number; sha256: string; sha512: string };
  archive: { timestamp: string; compression: "deflate-9"; pathSeparator: "/" };
  publicationTargets: PublicationTarget[];
}

interface ContentGroup {
  content: ResolvedContent;
  environments: Set<Environment>;
}

function groupSlots(slots: Map<string, ResolvedContent>): ContentGroup[] {
  const groups = new Map<string, ContentGroup>();
  for (const [slot, content] of slots) {
    const environment: Environment = slot.endsWith("\0client") ? "client" : "server";
    const payloadIdentity =
      content.payload.kind === "remote"
        ? content.payload.hashes.sha512
        : content.payload.kind === "repository"
          ? content.payload.hashes.sha256
          : content.payload.hashes.sha512;
    const key = `${content.path.toLowerCase()}\0${content.owner.source}\0${payloadIdentity}`;
    const group = groups.get(key) ?? { content, environments: new Set<Environment>() };
    group.environments.add(environment);
    groups.set(key, group);
  }
  return [...groups.values()].sort((left, right) => left.content.path.localeCompare(right.content.path));
}

function builtEnvironment(
  content: ResolvedContent,
  environments: Set<Environment>,
): FileEnvironment | undefined {
  if (environments.has("client") && environments.has("server")) return content.declaration.env;
  return {
    client: environments.has("client") ? content.env.client : "unsupported",
    server: environments.has("server") ? content.env.server : "unsupported",
  };
}

function safeStem(name: string): string {
  const stem = name
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!stem) throw new InlayError(error("artifact-name", "Pack name cannot produce an artifact filename."));
  return stem;
}

function githubRemote(value: string): { owner: string; repo: string } | undefined {
  const match = value.match(/github\.com[/:]([^/]+)\/(.+)$/i);
  const repo = match?.[2]?.replace(/\.git$/i, "");
  return match?.[1] && repo ? { owner: match[1], repo } : undefined;
}

function zipOptions(): ZipOptions {
  return { mtime: new Date("1980-01-01T00:00:00.000Z"), attrs: 0o100644 << 16 };
}

export async function buildPack(root: string, options: BuildOptions = {}) {
  const checked = await checkPack(root);
  const git = new GitAdapter(root);
  const sourceCommit = await git.head();
  const status = await git.run(["status", "--porcelain"]);
  const clean = status.length === 0;
  const delivery = checked.pack.manifest.delivery === "github" ? "github" : "bundled";
  if (delivery === "github" && !clean) {
    throw new InlayError(
      error("hosted-build-dirty", "GitHub delivery requires a clean immutable source commit."),
    );
  }
  if (delivery === "github" && !sourceCommit) {
    throw new InlayError(error("hosted-build-uncommitted", "GitHub delivery requires a source commit."));
  }

  const remote = (await git.remoteUrl()) ?? "";
  const github = githubRemote(remote);
  const modrinthFiles: RemoteFileDeclaration[] = [];
  const zipEntries: Record<string, [Uint8Array, ZipOptions]> = {};

  for (const group of groupSlots(checked.pack.slots)) {
    const { content, environments } = group;
    const env = builtEnvironment(content, environments);
    const bytes = checked.payloads.get(content.path.toLowerCase());
    if (!bytes)
      throw new InlayError(error("build-payload-missing", `No verified payload exists for ${content.path}.`));

    if (content.payload.kind === "remote") {
      modrinthFiles.push({
        path: content.path,
        hashes: content.payload.hashes,
        downloads: content.payload.downloads,
        fileSize: content.payload.fileSize,
        ...(env === undefined ? {} : { env }),
      });
      continue;
    }

    if (content.payload.kind === "repository" && delivery === "github") {
      const actual = hashes(bytes);
      let download: string | undefined = content.payload.rawUrl;
      if (!download && github && sourceCommit) {
        download = `https://raw.githubusercontent.com/${github.owner}/${github.repo}/${sourceCommit}/${content.payload.source
          .split("/")
          .map(encodeURIComponent)
          .join("/")}`;
      }
      if (!download)
        throw new InlayError(
          error("github-delivery-source", `Cannot create a commit-addressed GitHub URL for ${content.path}.`),
        );
      modrinthFiles.push({
        path: content.path,
        hashes: { sha1: actual.sha1, sha512: actual.sha512 },
        downloads: [download],
        fileSize: bytes.byteLength,
        ...(env === undefined ? {} : { env }),
      });
      continue;
    }

    const prefix =
      environments.size === 2
        ? "overrides"
        : environments.has("client")
          ? "client-overrides"
          : "server-overrides";
    zipEntries[`${prefix}/${content.path}`] = [bytes, zipOptions()];
  }

  const generatedIndex = {
    formatVersion: 1,
    game: "minecraft",
    versionId: checked.pack.manifest.versionId,
    name: checked.pack.manifest.name,
    ...(checked.pack.manifest.summary === undefined ? {} : { summary: checked.pack.manifest.summary }),
    files: modrinthFiles.sort((left, right) => left.path.localeCompare(right.path)),
    dependencies: checked.pack.dependencies,
  };
  zipEntries["modrinth.index.json"] = [new TextEncoder().encode(canonicalJson(generatedIndex)), zipOptions()];
  const orderedEntries = Object.fromEntries(
    Object.entries(zipEntries).sort(([left], [right]) => left.localeCompare(right)),
  );
  const artifact = zipSync(orderedEntries, { level: 9 });
  const artifactHashes = hashes(artifact);
  const preview = !clean;
  const filename = `${safeStem(checked.pack.manifest.name)}-${checked.pack.manifest.versionId}${preview ? "-preview" : ""}.mrpack`;
  const targets = [...new Set(options.publicationTargets ?? [])];
  for (const target of targets) {
    const limit = target === "modrinth" ? MODRINTH_UPLOAD_LIMIT : GITHUB_RELEASE_UPLOAD_LIMIT;
    if (artifact.byteLength > limit) {
      throw new InlayError(
        error(
          "publication-limit",
          `${filename} is ${artifact.byteLength} bytes; ${target} permits at most ${limit}.`,
        ),
      );
    }
  }
  const outputDirectory = path.resolve(root, options.outputDirectory ?? "dist");
  await mkdir(outputDirectory, { recursive: true });
  const artifactPath = path.join(outputDirectory, filename);
  const record: BuildRecord = {
    formatVersion: 1,
    toolkitVersion: TOOLKIT_VERSION,
    sourceCommit: sourceCommit ?? null,
    publishable: clean,
    preview,
    lineage: checked.pack.lineage,
    delivery,
    artifact: {
      filename,
      fileSize: artifact.byteLength,
      sha256: artifactHashes.sha256,
      sha512: artifactHashes.sha512,
    },
    archive: { timestamp: "1980-01-01T00:00:00.000Z", compression: "deflate-9", pathSeparator: "/" },
    publicationTargets: targets,
  };
  await Promise.all([
    writeFile(artifactPath, artifact),
    writeFile(`${artifactPath}.sha256`, `${artifactHashes.sha256}  ${filename}\n`, "utf8"),
    writeFile(`${artifactPath}.sha512`, `${artifactHashes.sha512}  ${filename}\n`, "utf8"),
    writeFile(`${artifactPath}.build.json`, canonicalJson(record), "utf8"),
  ]);
  return { artifactPath, record, diagnostics: checked.diagnostics };
}
