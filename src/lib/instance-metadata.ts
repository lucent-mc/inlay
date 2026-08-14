import { access, readFile, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { error, InlayError } from "../diagnostics.js";

export type DetectedLauncher = "atlauncher" | "gdlauncher" | "modrinth" | "prism-family";

export interface DetectedInstanceMetadata {
  launcher: DetectedLauncher;
  source: string;
  name?: string;
  minecraft?: string;
  loader?: string | null;
  loaderVersion?: string;
  unsupportedLoader?: string;
}

export interface DetectedModrinthContent {
  source: string;
  relativePath: string;
  fileName: string;
  sha1: string;
  fileSize: number;
  projectId: string;
  versionId: string;
  projectType: string;
  clientRequirement: string;
  serverRequirement: string;
}

type JsonObject = Record<string, unknown>;

interface DatabaseInstanceRow {
  id?: string;
  contentSetId?: string | null;
  path: string;
  name: string;
  gameVersion: string | null;
  loader: string | null;
  loaderVersion: string | null;
}

const LOADER_DEPENDENCIES: Readonly<Record<string, string>> = {
  fabric: "fabric-loader",
  legacyfabric: "fabric-loader",
  "net.fabricmc.fabricloader": "fabric-loader",
  forge: "forge",
  "net.minecraftforge": "forge",
  neoforge: "neoforge",
  "net.neoforged": "neoforge",
  quilt: "quilt-loader",
  "org.quiltmc.quiltloader": "quilt-loader",
};

function object(value: unknown): JsonObject | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}

function nonemptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

async function jsonObject(file: string, invalidIsError = false): Promise<JsonObject | undefined> {
  try {
    return object(JSON.parse(await readFile(file, "utf8")));
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT" || !invalidIsError) return undefined;
    throw new InlayError(
      error("launcher-metadata-invalid", `Could not read launcher metadata from ${file}.`),
      2,
    );
  }
}

function loaderDependency(loaderType: string | undefined): {
  loader?: string | null;
  unsupportedLoader?: string;
} {
  if (!loaderType) return {};
  if (loaderType.toLocaleLowerCase("en-US") === "vanilla") return { loader: null };
  const normalized = loaderType.toLocaleLowerCase("en-US").replaceAll(/[-_ ]/gu, "");
  const dependency = LOADER_DEPENDENCIES[normalized];
  return dependency ? { loader: dependency } : { unsupportedLoader: loaderType };
}

function detectedMetadata(input: {
  launcher: DetectedLauncher;
  source: string;
  name?: string | undefined;
  minecraft?: string | undefined;
  loaderType?: string | undefined;
  loaderVersion?: string | undefined;
}): DetectedInstanceMetadata {
  const loader = loaderDependency(input.loaderType);
  return {
    launcher: input.launcher,
    source: input.source,
    ...(input.name ? { name: input.name } : {}),
    ...(input.minecraft ? { minecraft: input.minecraft } : {}),
    ...loader,
    ...(input.loaderVersion ? { loaderVersion: input.loaderVersion } : {}),
  };
}

async function detectATLauncher(root: string): Promise<DetectedInstanceMetadata | undefined> {
  const source = path.join(root, "instance.json");
  const document = await jsonObject(source);
  if (!document) return undefined;
  const launcher = object(document["launcher"]);
  if (!launcher) return undefined;
  const rawLoaderVersion = launcher["loaderVersion"];
  const loaderVersion = object(rawLoaderVersion);
  const isATLauncher =
    "vanillaInstance" in launcher ||
    "packId" in launcher ||
    "externalPackId" in launcher ||
    "loaderVersion" in launcher;
  if (!isATLauncher) return undefined;
  return detectedMetadata({
    launcher: "atlauncher",
    source,
    ...(nonemptyString(launcher["name"]) ? { name: nonemptyString(launcher["name"]) } : {}),
    ...(nonemptyString(document["id"]) ? { minecraft: nonemptyString(document["id"]) } : {}),
    ...(loaderVersion && nonemptyString(loaderVersion["type"])
      ? { loaderType: nonemptyString(loaderVersion["type"]) }
      : rawLoaderVersion === null || (rawLoaderVersion === undefined && launcher["vanillaInstance"] === true)
        ? { loaderType: "vanilla" }
        : {}),
    ...(loaderVersion && nonemptyString(loaderVersion["version"])
      ? { loaderVersion: nonemptyString(loaderVersion["version"]) }
      : {}),
  });
}

async function detectLegacyModrinth(root: string): Promise<DetectedInstanceMetadata | undefined> {
  const source = path.join(root, "profile.json");
  const document = await jsonObject(source);
  if (!document) return undefined;
  const nestedMetadata = object(document["metadata"]);
  const metadata = nestedMetadata && "game_version" in nestedMetadata ? nestedMetadata : document;
  if (!("game_version" in metadata)) return undefined;
  const loaderVersionValue = metadata["loader_version"] ?? metadata["mod_loader_version"];
  const loaderVersion =
    nonemptyString(loaderVersionValue) ?? nonemptyString(object(loaderVersionValue)?.["id"]);
  const name = nonemptyString(metadata["name"]);
  const minecraft = nonemptyString(metadata["game_version"]);
  return detectedMetadata({
    launcher: "modrinth",
    source,
    ...(name ? { name } : {}),
    ...(minecraft ? { minecraft } : {}),
    loaderType: nonemptyString(metadata["loader"] ?? metadata["mod_loader"]) ?? "vanilla",
    ...(loaderVersion ? { loaderVersion } : {}),
  });
}

async function detectPrismFamily(root: string): Promise<DetectedInstanceMetadata | undefined> {
  const directoryName = path.basename(root).toLocaleLowerCase("en-US");
  if (directoryName !== ".minecraft" && directoryName !== "minecraft") return undefined;
  const instanceRoot = path.dirname(root);
  const source = path.join(instanceRoot, "mmc-pack.json");
  const document = await jsonObject(source, true);
  if (!document || !Array.isArray(document["components"])) return undefined;
  const components = document["components"]
    .map(object)
    .filter((value): value is JsonObject => value !== undefined && value["disabled"] !== true);
  const minecraftComponent = components.find((component) => component["uid"] === "net.minecraft");
  const minecraft = nonemptyString(minecraftComponent?.["version"]);
  const loaders = components.filter((component) =>
    [
      "net.fabricmc.fabric-loader",
      "net.minecraftforge",
      "net.neoforged",
      "org.quiltmc.quilt-loader",
      "com.mumfrey.liteloader",
    ].includes(nonemptyString(component["uid"]) ?? ""),
  );
  let name: string | undefined;
  try {
    const config = await readFile(path.join(instanceRoot, "instance.cfg"), "utf8");
    name = config
      .split(/\r?\n/gu)
      .find((line) => line.startsWith("name="))
      ?.slice("name=".length)
      .trim();
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
  }
  if (loaders.length > 1) {
    return {
      launcher: "prism-family",
      source,
      ...(name ? { name } : {}),
      ...(minecraft ? { minecraft } : {}),
      unsupportedLoader: "multiple configured loaders",
    };
  }
  const loader = loaders[0];
  return detectedMetadata({
    launcher: "prism-family",
    source,
    ...(name ? { name } : {}),
    ...(minecraft ? { minecraft } : {}),
    ...(loader
      ? {
          loaderType: nonemptyString(loader["uid"]),
          ...(nonemptyString(loader["version"]) ? { loaderVersion: nonemptyString(loader["version"]) } : {}),
        }
      : { loaderType: "vanilla" }),
  });
}

async function detectGDLauncher(root: string): Promise<DetectedInstanceMetadata | undefined> {
  if (path.basename(root).toLocaleLowerCase("en-US") !== "instance") return undefined;
  const source = path.join(path.dirname(root), "instance.json");
  const document = await jsonObject(source);
  const gameConfiguration = object(document?.["game_configuration"]);
  if (document?.["_version"] !== "1" || !gameConfiguration) return undefined;
  const name = nonemptyString(document["name"]);
  const version = object(gameConfiguration["version"]);
  if (!version) {
    return detectedMetadata({
      launcher: "gdlauncher",
      source,
      ...(name ? { name } : {}),
    });
  }
  const minecraft = nonemptyString(version["release"]);
  const modloaders = Array.isArray(version["modloaders"])
    ? version["modloaders"].map(object).filter((value) => value !== undefined)
    : [];
  if (modloaders.length > 1) {
    return {
      launcher: "gdlauncher",
      source,
      ...(name ? { name } : {}),
      ...(minecraft ? { minecraft } : {}),
      unsupportedLoader: "multiple configured loaders",
    };
  }
  const loader = modloaders[0];
  return detectedMetadata({
    launcher: "gdlauncher",
    source,
    ...(name ? { name } : {}),
    ...(minecraft ? { minecraft } : {}),
    ...(loader
      ? {
          loaderType: nonemptyString(loader["type"]),
          ...(nonemptyString(loader["version"]) ? { loaderVersion: nonemptyString(loader["version"]) } : {}),
        }
      : { loaderType: "vanilla" }),
  });
}

function comparablePath(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLocaleLowerCase("en-US") : resolved;
}

async function samePath(left: string, right: string): Promise<boolean> {
  if (comparablePath(left) === comparablePath(right)) return true;
  try {
    return comparablePath(await realpath(left)) === comparablePath(await realpath(right));
  } catch {
    return false;
  }
}

function modrinthSettingsDirectories(root: string): string[] {
  const candidates: string[] = [];
  const parent = path.dirname(root);
  if (path.basename(parent).toLocaleLowerCase("en-US") === "profiles") {
    candidates.push(path.dirname(parent));
  }
  if (process.env["THESEUS_CONFIG_DIR"]) candidates.push(process.env["THESEUS_CONFIG_DIR"]);
  if (process.platform === "win32" && process.env["APPDATA"]) {
    candidates.push(path.join(process.env["APPDATA"], "ModrinthApp"));
  } else if (process.platform === "darwin") {
    candidates.push(path.join(os.homedir(), "Library", "Application Support", "ModrinthApp"));
  } else {
    candidates.push(
      path.join(process.env["XDG_DATA_HOME"] ?? path.join(os.homedir(), ".local", "share"), "ModrinthApp"),
    );
  }
  return [...new Set(candidates.map((candidate) => path.resolve(candidate)))];
}

function tableExists(database: DatabaseSync, table: string): boolean {
  return Boolean(
    database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1").get(table),
  );
}

function modrinthConfigDirectory(database: DatabaseSync, settingsDirectory: string): string {
  if (!tableExists(database, "settings")) return settingsDirectory;
  const row = database.prepare("SELECT custom_dir AS customDir FROM settings LIMIT 1").get() as
    | { customDir?: unknown }
    | undefined;
  return nonemptyString(row?.customDir) ?? settingsDirectory;
}

function currentModrinthRows(database: DatabaseSync): DatabaseInstanceRow[] {
  if (!tableExists(database, "instances") || !tableExists(database, "instance_content_sets")) {
    return [];
  }
  return database
    .prepare(`
      SELECT
        instance.id AS id,
        instance.applied_content_set_id AS contentSetId,
        instance.path AS path,
        instance.name AS name,
        content.game_version AS gameVersion,
        content.loader AS loader,
        content.loader_version AS loaderVersion
      FROM instances instance
      LEFT JOIN instance_content_sets content
        ON content.id = instance.applied_content_set_id
        AND content.instance_id = instance.id
    `)
    .all() as unknown as DatabaseInstanceRow[];
}

interface DatabaseContentRow {
  relativePath: string;
  fileName: string;
  sha1: string;
  fileSize: number;
  projectId: string;
  versionId: string;
  projectType: string;
  clientRequirement: string;
  serverRequirement: string;
}

function currentModrinthContentRows(
  database: DatabaseSync,
  instanceId: string,
  contentSetId: string,
): DatabaseContentRow[] {
  if (!tableExists(database, "instance_files") || !tableExists(database, "instance_content_entries")) {
    return [];
  }
  return database
    .prepare(`
      SELECT
        file.relative_path AS relativePath,
        file.file_name AS fileName,
        file.sha1 AS sha1,
        file.size AS fileSize,
        entry.project_id AS projectId,
        entry.version_id AS versionId,
        entry.project_type AS projectType,
        entry.client_requirement AS clientRequirement,
        entry.server_requirement AS serverRequirement
      FROM instance_content_entries entry
      INNER JOIN instance_files file
        ON file.id = entry.file_id
        AND file.instance_id = entry.instance_id
      WHERE entry.instance_id = ?
        AND entry.content_set_id = ?
        AND entry.project_id IS NOT NULL
        AND entry.version_id IS NOT NULL
        AND entry.enabled = 1
        AND file.enabled = 1
        AND file.missing = 0
    `)
    .all(instanceId, contentSetId) as unknown as DatabaseContentRow[];
}

function legacyModrinthRows(database: DatabaseSync): DatabaseInstanceRow[] {
  if (!tableExists(database, "profiles")) return [];
  return database
    .prepare(`
      SELECT
        path,
        name,
        game_version AS gameVersion,
        mod_loader AS loader,
        mod_loader_version AS loaderVersion
      FROM profiles
    `)
    .all() as unknown as DatabaseInstanceRow[];
}

async function detectModrinthDatabaseAt(
  root: string,
  settingsDirectory: string,
): Promise<DetectedInstanceMetadata | undefined> {
  const source = path.join(settingsDirectory, "app.db");
  try {
    await access(source);
  } catch {
    return undefined;
  }
  let database: DatabaseSync | undefined;
  try {
    database = new DatabaseSync(source, { readOnly: true });
    const configDirectory = modrinthConfigDirectory(database, settingsDirectory);
    const rows = currentModrinthRows(database);
    if (rows.length === 0) rows.push(...legacyModrinthRows(database));
    for (const row of rows) {
      if (!(await samePath(root, path.join(configDirectory, "profiles", row.path)))) continue;
      return detectedMetadata({
        launcher: "modrinth",
        source,
        ...(nonemptyString(row.name) ? { name: nonemptyString(row.name) } : {}),
        ...(nonemptyString(row.gameVersion) ? { minecraft: nonemptyString(row.gameVersion) } : {}),
        ...(nonemptyString(row.loader) ? { loaderType: nonemptyString(row.loader) } : {}),
        ...(nonemptyString(row.loaderVersion) ? { loaderVersion: nonemptyString(row.loaderVersion) } : {}),
      });
    }
  } catch (cause) {
    if (cause instanceof InlayError) throw cause;
    return undefined;
  } finally {
    database?.close();
  }
  return undefined;
}

async function detectModrinthDatabase(root: string): Promise<DetectedInstanceMetadata | undefined> {
  for (const settingsDirectory of modrinthSettingsDirectories(root)) {
    const detected = await detectModrinthDatabaseAt(root, settingsDirectory);
    if (detected) return detected;
  }
  return undefined;
}

/** Read Modrinth's installed-content identity without mutating launcher state. */
export async function detectModrinthContent(
  root: string,
  candidate: string,
): Promise<DetectedModrinthContent | undefined> {
  const normalizedCandidate = candidate.replaceAll("\\", "/").toLocaleLowerCase("en-US");
  for (const settingsDirectory of modrinthSettingsDirectories(root)) {
    const source = path.join(settingsDirectory, "app.db");
    try {
      await access(source);
    } catch {
      continue;
    }
    let database: DatabaseSync | undefined;
    try {
      database = new DatabaseSync(source, { readOnly: true });
      const configDirectory = modrinthConfigDirectory(database, settingsDirectory);
      const matches: DetectedModrinthContent[] = [];
      for (const instance of currentModrinthRows(database)) {
        if (
          !instance.id ||
          !instance.contentSetId ||
          !(await samePath(root, path.join(configDirectory, "profiles", instance.path)))
        )
          continue;
        for (const row of currentModrinthContentRows(database, instance.id, instance.contentSetId)) {
          if (row.relativePath.replaceAll("\\", "/").toLocaleLowerCase("en-US") !== normalizedCandidate)
            continue;
          matches.push({ source, ...row });
        }
      }
      if (matches.length === 1) return matches[0];
    } catch {
      // Launcher databases are optional evidence and may use an unknown future schema.
    } finally {
      database?.close();
    }
  }
  return undefined;
}

/** Detect launcher-owned metadata and expose only normalized runtime-target evidence. */
export async function detectInstanceMetadata(root: string): Promise<DetectedInstanceMetadata[]> {
  const resolvedRoot = path.resolve(root);
  const atlauncher = await detectATLauncher(resolvedRoot);
  const prismFamily = await detectPrismFamily(resolvedRoot);
  const gdlauncher = await detectGDLauncher(resolvedRoot);
  const modrinthDatabase = await detectModrinthDatabase(resolvedRoot);
  const modrinth = modrinthDatabase ?? (await detectLegacyModrinth(resolvedRoot));
  return [atlauncher, prismFamily, gdlauncher, modrinth].filter(
    (candidate): candidate is DetectedInstanceMetadata => candidate !== undefined,
  );
}
