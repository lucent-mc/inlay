import type { Dirent } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { unzipSync } from "fflate";
import { modrinthIdentityFromUrl } from "../adapters/modrinth.js";
import { isRepositoryFile } from "../manifest/index.js";
import type { FileDeclaration } from "../types.js";
import { repositoryRelativePath, resolveInside } from "./path.js";

export type DefaultConfigProviderId = "configured-defaults" | "config-manager" | "yosbr" | "default-options";

export type DefaultConfigEvidence =
  | { kind: "modrinth"; projectId: string; versionId: string }
  | { kind: "jar"; modId: string; version?: string; path: string }
  | { kind: "convention"; path: string };

export interface DefaultConfigProvider {
  id: DefaultConfigProviderId;
  name: string;
  evidence: DefaultConfigEvidence;
  /** Whether this provider's defaults-store directory exists in the instance. */
  directoryPresent: boolean;
  /** Whether the convention contains author-supplied state rather than only a generated skeleton. */
  authored: boolean;
}

export interface DefaultConfigPathClassification {
  kind: "mirror" | "specialized" | "generated" | "control" | "runtime-state" | "invalid";
  provider: DefaultConfigProvider;
  runtimePath?: string;
  application:
    | { mode: "copy-missing" }
    | {
        mode: "configured-options";
        versionDependent: true;
        merge: "missing-keys";
      }
    | {
        mode: "config-manager-copy";
        normal: "missing-only";
        update: "overwrite";
        reset: "delete-runtime-config-then-overwrite";
      }
    | {
        mode: "config-manager-control";
        action: "update" | "reset";
        overwritesExisting: true;
        deletesRuntimeConfig: boolean;
      }
    | {
        mode: "default-options-handler";
        handler: "keybindings" | "named-or-plugin" | "provider-config";
      }
    | { mode: "none"; reason: "generated" | "runtime-state" | "invalid" };
}

interface JarIdentity {
  modId: string;
  version?: string;
  path: string;
}

interface DefaultConfigAdapter {
  id: DefaultConfigProviderId;
  name: string;
  projectId: string;
  modId: string;
  conventionRoot: string;
  authored(root: string): Promise<boolean>;
  classify(candidate: string): Omit<DefaultConfigPathClassification, "provider"> | undefined;
  projectOrdinaryConfig(relative: string): string;
}

const lower = (value: string) => repositoryRelativePath(value).toLocaleLowerCase("en-US");

function within(candidate: string, root: string): string | undefined {
  const key = lower(candidate);
  const rootKey = lower(root);
  return key.startsWith(`${rootKey}/`) ? repositoryRelativePath(candidate).slice(root.length + 1) : undefined;
}

async function isDirectory(filename: string): Promise<boolean> {
  try {
    return (await stat(filename)).isDirectory();
  } catch {
    return false;
  }
}

async function isFile(filename: string): Promise<boolean> {
  try {
    return (await stat(filename)).isFile();
  } catch {
    return false;
  }
}

async function hasAuthoredFile(
  root: string,
  directory: string,
  generated: (relative: string, size: number) => boolean,
): Promise<boolean> {
  for (const candidate of await regularFilesUnder(root, [directory])) {
    const details = await stat(resolveInside(root, candidate));
    const relative = candidate.slice(directory.length + 1);
    if (!generated(relative.toLocaleLowerCase("en-US"), details.size)) return true;
  }
  return false;
}

const ADAPTERS: readonly DefaultConfigAdapter[] = [
  {
    id: "configured-defaults",
    name: "Configured Defaults",
    projectId: "SISoSFPP",
    modId: "configureddefaults",
    conventionRoot: "configureddefaults",
    authored: (root) =>
      hasAuthoredFile(
        root,
        "configureddefaults",
        (relative) => relative === "readme.md" || relative.endsWith("/.ds_store") || relative === ".ds_store",
      ),
    classify(candidate) {
      const relative = within(candidate, "configureddefaults");
      if (relative === undefined) return undefined;
      const key = relative.toLocaleLowerCase("en-US");
      if (key === "readme.md" || key === ".ds_store") {
        return { kind: "generated", application: { mode: "none", reason: "generated" } };
      }
      if (key === "options.txt") {
        return {
          kind: "specialized",
          runtimePath: "options.txt",
          application: {
            mode: "configured-options",
            versionDependent: true,
            merge: "missing-keys",
          },
        };
      }
      return {
        kind: "mirror",
        runtimePath: relative,
        application: { mode: "copy-missing" },
      };
    },
    projectOrdinaryConfig: (relative) => `configureddefaults/config/${relative}`,
  },
  {
    id: "config-manager",
    name: "Config Manager",
    projectId: "jlNms3Jp",
    modId: "config_manager",
    conventionRoot: "config/modpack_defaults",
    // Config Manager does not generate its store, so its presence is an authored convention signal.
    authored: (root) => isDirectory(resolveInside(root, "config/modpack_defaults")),
    classify(candidate) {
      const key = lower(candidate);
      if (key === "config/config_manager_update_flag" || key === "config/config_manager_reset_flag") {
        return {
          kind: "control",
          runtimePath: repositoryRelativePath(candidate),
          application: {
            mode: "config-manager-control",
            action: key.endsWith("update_flag") ? "update" : "reset",
            overwritesExisting: true,
            deletesRuntimeConfig: key.endsWith("reset_flag"),
          },
        };
      }
      const relative = within(candidate, "config/modpack_defaults");
      if (relative === undefined) return undefined;
      return {
        kind: "mirror",
        runtimePath: relative,
        application: {
          mode: "config-manager-copy",
          normal: "missing-only",
          update: "overwrite",
          reset: "delete-runtime-config-then-overwrite",
        },
      };
    },
    projectOrdinaryConfig: (relative) => `config/modpack_defaults/config/${relative}`,
  },
  {
    id: "yosbr",
    name: "Your Options Shall Be Respected",
    projectId: "WwbubTsV",
    modId: "yosbr",
    conventionRoot: "config/yosbr",
    authored: (root) =>
      hasAuthoredFile(root, "config/yosbr", (relative, size) => relative === "options.txt" && size === 0),
    classify(candidate) {
      const relative = within(candidate, "config/yosbr");
      if (relative === undefined) return undefined;
      const key = relative.toLocaleLowerCase("en-US");
      if (key.startsWith("config/yosbr/")) {
        return { kind: "invalid", application: { mode: "none", reason: "invalid" } };
      }
      return {
        kind: "mirror",
        runtimePath: relative,
        application: { mode: "copy-missing" },
      };
    },
    projectOrdinaryConfig: (relative) => `config/yosbr/config/${relative}`,
  },
  {
    id: "default-options",
    name: "Default Options",
    projectId: "WEg59z5b",
    modId: "defaultoptions",
    conventionRoot: "config/defaultoptions",
    authored: async (root) => {
      const files = await regularFilesUnder(root, ["config/defaultoptions"]);
      return files.some((candidate) => {
        const relative = candidate.slice("config/defaultoptions/".length).toLocaleLowerCase("en-US");
        return relative.startsWith("extra/") || !relative.includes("/");
      });
    },
    classify(candidate) {
      const key = lower(candidate);
      if (key === "defaultoptions.journal.json") {
        return {
          kind: "runtime-state",
          runtimePath: repositoryRelativePath(candidate),
          application: { mode: "none", reason: "runtime-state" },
        };
      }
      if (/^config\/defaultoptions(?:[-.].+)$/u.test(key)) {
        return {
          kind: "specialized",
          runtimePath: repositoryRelativePath(candidate),
          application: { mode: "default-options-handler", handler: "provider-config" },
        };
      }
      const relative = within(candidate, "config/defaultoptions");
      if (relative === undefined) return undefined;
      const relativeKey = relative.toLocaleLowerCase("en-US");
      if (relativeKey.startsWith("extra/")) {
        return {
          kind: "mirror",
          runtimePath: relative.slice("extra/".length),
          application: { mode: "copy-missing" },
        };
      }
      return {
        kind: "specialized",
        application: {
          mode: "default-options-handler",
          handler: relativeKey === "keybindings.txt" ? "keybindings" : "named-or-plugin",
        },
      };
    },
    projectOrdinaryConfig: (relative) => `config/defaultoptions/extra/config/${relative}`,
  },
] as const;

const adapterById = new Map(ADAPTERS.map((adapter) => [adapter.id, adapter]));

function jsonJarIdentity(bytes: Uint8Array, jarPath: string): JarIdentity[] {
  try {
    const archive = unzipSync(bytes, {
      filter: (entry) => entry.name === "fabric.mod.json" || entry.name === "quilt.mod.json",
    });
    const fabric = archive["fabric.mod.json"];
    if (fabric) {
      const metadata = JSON.parse(new TextDecoder().decode(fabric)) as { id?: string; version?: string };
      return metadata.id
        ? [
            {
              modId: metadata.id,
              ...(metadata.version === undefined ? {} : { version: metadata.version }),
              path: jarPath,
            },
          ]
        : [];
    }
    const quilt = archive["quilt.mod.json"];
    if (quilt) {
      const metadata = JSON.parse(new TextDecoder().decode(quilt)) as {
        quilt_loader?: { id?: string; version?: string };
      };
      const loader = metadata.quilt_loader;
      return loader?.id
        ? [
            {
              modId: loader.id,
              ...(loader.version === undefined ? {} : { version: loader.version }),
              path: jarPath,
            },
          ]
        : [];
    }
  } catch {
    // Invalid or unsupported metadata is not positive provider evidence.
  }
  return [];
}

function tomlJarIdentity(bytes: Uint8Array, jarPath: string): JarIdentity[] {
  try {
    const archive = unzipSync(bytes, {
      filter: (entry) =>
        entry.name.toLocaleLowerCase("en-US") === "meta-inf/mods.toml" ||
        entry.name.toLocaleLowerCase("en-US") === "meta-inf/neoforge.mods.toml",
    });
    const metadata = archive["META-INF/neoforge.mods.toml"] ?? archive["META-INF/mods.toml"];
    if (!metadata) return [];
    const source = new TextDecoder().decode(metadata);
    const version = source.match(/^\s*version\s*=\s*["']([^"']+)["']/mu)?.[1];
    return [...source.matchAll(/^\s*modId\s*=\s*["']([^"']+)["']/gmu)].flatMap((match) => {
      const modId = match[1];
      return modId ? [{ modId, ...(version === undefined ? {} : { version }), path: jarPath }] : [];
    });
  } catch {
    return [];
  }
}

async function jarIdentities(root: string, files: readonly FileDeclaration[]): Promise<JarIdentity[]> {
  const candidates = new Set(await regularFilesUnder(root, ["mods"]));
  for (const file of files) {
    const key = lower(file.path);
    if (!key.startsWith("mods/") || !key.endsWith(".jar") || !isRepositoryFile(file)) continue;
    candidates.add(file.downloads[0].slice(2));
  }
  const identities: JarIdentity[] = [];
  for (const candidate of candidates) {
    if (!candidate.toLocaleLowerCase("en-US").endsWith(".jar")) continue;
    try {
      const bytes = await readFile(resolveInside(root, candidate));
      identities.push(...jsonJarIdentity(bytes, candidate), ...tomlJarIdentity(bytes, candidate));
    } catch {
      // A missing or unreadable JAR supplies no embedded identity.
    }
  }
  return identities;
}

/** Detect providers by immutable project identity, then JAR mod identity, then convention hints. */
export async function detectDefaultConfigProviders(
  root: string,
  files: readonly FileDeclaration[],
): Promise<DefaultConfigProvider[]> {
  const modrinth = files.flatMap((file) =>
    lower(file.path).startsWith("mods/")
      ? file.downloads.flatMap((download) => {
          const identity = modrinthIdentityFromUrl(download);
          return identity ? [identity] : [];
        })
      : [],
  );
  const jars = await jarIdentities(root, files);
  const providers: DefaultConfigProvider[] = [];
  for (const adapter of ADAPTERS) {
    const authored = await adapter.authored(root);
    const project = modrinth.find((identity) => identity.projectId === adapter.projectId);
    const jar = jars.find((identity) => identity.modId === adapter.modId);
    const convention = await isDirectory(resolveInside(root, adapter.conventionRoot));
    const evidence: DefaultConfigEvidence | undefined = project
      ? { kind: "modrinth", projectId: project.projectId, versionId: project.versionId }
      : jar
        ? {
            kind: "jar",
            modId: jar.modId,
            ...(jar.version === undefined ? {} : { version: jar.version }),
            path: jar.path,
          }
        : convention
          ? { kind: "convention", path: adapter.conventionRoot }
          : undefined;
    if (evidence) {
      providers.push({
        id: adapter.id,
        name: adapter.name,
        evidence,
        directoryPresent: convention,
        authored,
      });
    }
  }
  return providers;
}

export function classifyDefaultConfigPath(
  candidate: string,
  providers: readonly DefaultConfigProvider[],
): DefaultConfigPathClassification | undefined {
  for (const provider of providers) {
    const classification = adapterById.get(provider.id)?.classify(candidate);
    if (classification) return { ...classification, provider };
  }
  return undefined;
}

export function isDefaultConfigPath(candidate: string, providers: readonly DefaultConfigProvider[]): boolean {
  return classifyDefaultConfigPath(candidate, providers) !== undefined;
}

/** Provider-owned roots that must be discovered independently of Git ignore rules. */
export function defaultConfigStoreRoots(providers: readonly DefaultConfigProvider[]): string[] {
  return [
    ...new Set(
      providers.flatMap((provider) => {
        const adapter = adapterById.get(provider.id);
        return adapter ? [adapter.conventionRoot] : [];
      }),
    ),
  ];
}

export async function isUnpackageableDefaultConfigPath(
  root: string,
  candidate: string,
  providers: readonly DefaultConfigProvider[],
): Promise<boolean> {
  const classification = classifyDefaultConfigPath(candidate, providers);
  if (!classification) return false;
  if (["generated", "runtime-state", "invalid"].includes(classification.kind)) return true;
  return (
    classification.provider.id === "yosbr" &&
    lower(candidate) === "config/yosbr/options.txt" &&
    (await isFile(resolveInside(root, candidate))) &&
    (await stat(resolveInside(root, candidate))).size === 0
  );
}

export function isRuntimeConfigPath(candidate: string): boolean {
  return lower(candidate).startsWith("config/");
}

/**
 * Map only ordinary runtime config files. Specialized options, keybinding, plugin, and control
 * semantics never cross this seam. Projection requires both the provider mod and its store directory.
 * An existing target may disambiguate multiple otherwise eligible providers.
 */
export async function projectRuntimeConfig(
  root: string,
  runtimePath: string,
  providers: readonly DefaultConfigProvider[],
): Promise<{ path: string; provider: DefaultConfigProvider } | undefined> {
  const normalized = repositoryRelativePath(runtimePath);
  if (!isRuntimeConfigPath(normalized) || isDefaultConfigPath(normalized, providers)) return undefined;
  const key = lower(normalized);
  if (key === "config/config_manager_update_flag" || key === "config/config_manager_reset_flag") {
    return undefined;
  }
  const relative = normalized.slice("config/".length);
  const eligible = providers.filter(
    (provider) => provider.directoryPresent && provider.evidence.kind !== "convention",
  );
  const projections = eligible.flatMap((provider) => {
    const adapter = adapterById.get(provider.id);
    return adapter ? [{ path: adapter.projectOrdinaryConfig(relative), provider }] : [];
  });
  const existing: typeof projections = [];
  for (const projection of projections) {
    if (await isFile(resolveInside(root, projection.path))) existing.push(projection);
  }
  if (existing.length === 1) return existing[0];
  if (existing.length > 1) return undefined;
  return projections.length === 1 ? projections[0] : undefined;
}

export async function regularFilesUnder(root: string, directories: readonly string[]): Promise<string[]> {
  const files: string[] = [];
  const queue = directories.map((directory) => repositoryRelativePath(directory));
  while (queue.length > 0) {
    const relative = queue.shift();
    if (!relative) continue;
    let children: Dirent[];
    try {
      children = await readdir(resolveInside(root, relative), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const child of children) {
      const candidate = path.posix.join(relative, child.name);
      if (child.isSymbolicLink()) continue;
      if (child.isDirectory()) queue.push(candidate);
      else if (child.isFile()) files.push(candidate);
    }
  }
  return files;
}
