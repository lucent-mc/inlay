import { unzipSync } from "fflate";
import { MANIFEST_SCHEMA_URL } from "../constants.js";
import { error, InlayError } from "../diagnostics.js";
import { hashes } from "../lib/hash.js";
import { normalizeContentPath } from "../lib/path.js";
import type {
  ContentScope,
  FileDeclaration,
  FileEnvironment,
  LayerContentInput,
  LayerManifest,
  ResolvableLayer,
} from "../types.js";

interface ModrinthIndex {
  formatVersion: 1;
  game: "minecraft";
  versionId: string;
  name: string;
  summary?: string;
  files: FileDeclaration[];
  dependencies: Record<string, string>;
}

function archiveEnvironment(scope: ContentScope): FileEnvironment {
  if (scope === "client") return { client: "required", server: "unsupported" };
  if (scope === "server") return { client: "unsupported", server: "required" };
  return { client: "required", server: "required" };
}

function parseArchivePath(value: string): { path: string; scope: ContentScope } | undefined {
  const normalized = value.replaceAll("\\", "/");
  for (const [prefix, scope] of [
    ["overrides/", "common"],
    ["client-overrides/", "client"],
    ["server-overrides/", "server"],
  ] as const) {
    if (normalized.startsWith(prefix) && normalized.length > prefix.length) {
      return { path: normalizeContentPath(normalized.slice(prefix.length)), scope };
    }
  }
  return undefined;
}

export function importMrpack(bytes: Uint8Array, source: string, artifactSha256: string): ResolvableLayer {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch (cause) {
    throw new InlayError(error("mrpack-archive", `Cannot read parent mrpack: ${(cause as Error).message}`));
  }
  const indexBytes = entries["modrinth.index.json"];
  if (!indexBytes)
    throw new InlayError(error("mrpack-index-missing", "Parent mrpack has no root modrinth.index.json."));
  let index: ModrinthIndex;
  try {
    index = JSON.parse(new TextDecoder().decode(indexBytes)) as ModrinthIndex;
  } catch (cause) {
    throw new InlayError(
      error("mrpack-index-json", `Invalid modrinth.index.json: ${(cause as Error).message}`),
    );
  }
  if (index.formatVersion !== 1 || index.game !== "minecraft" || !Array.isArray(index.files)) {
    throw new InlayError(
      error("mrpack-index-invalid", "Imported Modrinth index does not satisfy formatVersion 1."),
    );
  }

  const manifest: LayerManifest = {
    $schema: MANIFEST_SCHEMA_URL,
    formatVersion: 1,
    game: "minecraft",
    versionId: index.versionId,
    name: index.name,
    ...(index.summary === undefined ? {} : { summary: index.summary }),
    files: index.files,
    dependencies: index.dependencies,
  };
  const identity = {
    name: index.name,
    versionId: index.versionId,
    source,
    revision: artifactSha256,
    imported: true,
  };
  const content: LayerContentInput[] = index.files.map((declaration) => ({
    path: declaration.path,
    scope: "common" as const,
    env: declaration.env ?? { client: "required" as const, server: "required" as const },
    declaration,
    payload: {
      kind: "remote" as const,
      downloads: declaration.downloads,
      hashes: declaration.hashes as { sha1: string; sha512: string },
      fileSize: declaration.fileSize,
    },
  }));

  for (const [archiveName, payload] of Object.entries(entries).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const parsed = parseArchivePath(archiveName);
    if (!parsed) continue;
    const actual = hashes(payload);
    const env = archiveEnvironment(parsed.scope);
    const declaration: FileDeclaration = {
      path: parsed.path,
      hashes: { sha1: actual.sha1, sha512: actual.sha512 },
      downloads: [`archive:${archiveName}`],
      fileSize: payload.byteLength,
      env,
    };
    content.push({
      path: parsed.path,
      scope: parsed.scope,
      env,
      declaration,
      payload: {
        kind: "archive",
        bytes: payload,
        hashes: { sha1: actual.sha1, sha512: actual.sha512 },
        fileSize: payload.byteLength,
      },
    });
  }

  return {
    manifest,
    source: { kind: "imported", label: source },
    identity,
    content,
  };
}
