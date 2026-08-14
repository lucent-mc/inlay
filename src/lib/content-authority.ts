import { ModrinthAdapter, type ModrinthProject } from "../adapters/modrinth.js";
import { DOWNLOADED_CONTENT_DIRECTORIES } from "../constants.js";
import { error, InlayError } from "../diagnostics.js";
import type { FileEnvironment, LayerManifest, RemoteFileDeclaration } from "../types.js";
import { hashes } from "./hash.js";
import type { DetectedModrinthContent } from "./instance-metadata.js";
import { repositoryRelativePath } from "./path.js";

export type ContentAuthority = "repository-config" | "modrinth" | "unsupported";

const REMOTE_ROOTS = new Set<string>(DOWNLOADED_CONTENT_DIRECTORIES);
const CONFIG_ROOTS = new Set(["config", "defaultconfigs", "kubejs", "scripts"]);
const MIRRORED_DEFAULT_ROOTS = [
  "configureddefaults/",
  "config/modpack_defaults/",
  "config/yosbr/",
  "config/defaultoptions/extra/",
] as const;
const ROOT_CONFIGS = new Set([
  "banned-ips.json",
  "banned-players.json",
  "bukkit.yml",
  "ops.json",
  "options.txt",
  "optionsof.txt",
  "optionsshaders.txt",
  "paper.yml",
  "server.properties",
  "spigot.yml",
  "whitelist.json",
]);

function firstSegment(candidate: string): string {
  return repositoryRelativePath(candidate).split("/", 1)[0]?.toLocaleLowerCase("en-US") ?? "";
}

function isConfigurationPath(candidate: string): boolean {
  return (
    !candidate.endsWith(".jar") && (CONFIG_ROOTS.has(firstSegment(candidate)) || ROOT_CONFIGS.has(candidate))
  );
}

/** Select the only portable authority permitted for an instance content path. */
export function contentAuthority(candidate: string): ContentAuthority {
  const normalized = repositoryRelativePath(candidate).toLocaleLowerCase("en-US");
  if (REMOTE_ROOTS.has(firstSegment(normalized))) return "modrinth";
  const mirroredRoot = MIRRORED_DEFAULT_ROOTS.find((root) => normalized.startsWith(root));
  const effectivePath = mirroredRoot ? normalized.slice(mirroredRoot.length) : normalized;
  return isConfigurationPath(effectivePath) ? "repository-config" : "unsupported";
}

function environment(project: ModrinthProject): FileEnvironment | undefined {
  const normalize = (value: ModrinthProject["client_side"]): FileEnvironment["client"] =>
    value === "unknown" ? "optional" : value;
  const env = { client: normalize(project.client_side), server: normalize(project.server_side) };
  return env.client === "required" && env.server === "required" ? undefined : env;
}

function projectDirectories(project: ModrinthProject): readonly string[] {
  if (project.project_type === "mod") return ["mods"];
  if (project.project_type === "plugin") return ["plugins"];
  if (project.project_type === "resourcepack") return ["resourcepacks", "texturepacks"];
  if (project.project_type === "shader") return ["shaderpacks"];
  if (project.project_type === "datapack") return ["datapacks"];
  return [];
}

function projectTypeDirectories(projectType: string): readonly string[] {
  if (projectType === "mod") return ["mods"];
  if (projectType === "plugin") return ["plugins"];
  if (projectType === "resourcepack") return ["resourcepacks", "texturepacks"];
  if (projectType === "shader" || projectType === "shaderpack") return ["shaderpacks"];
  if (projectType === "datapack") return ["datapacks"];
  return [];
}

function installedEnvironment(content: DetectedModrinthContent): FileEnvironment | undefined {
  const env = {
    client: content.clientRequirement as FileEnvironment["client"],
    server: content.serverRequirement as FileEnvironment["server"],
  };
  return env.client === "required" && env.server === "required" ? undefined : env;
}

function runtimeLoader(manifest: LayerManifest): string | undefined {
  return Object.keys(manifest.dependencies)
    .find((dependency) => dependency !== "minecraft")
    ?.replace(/-loader$/u, "");
}

/** Resolve installed artifact bytes to one immutable Modrinth declaration. */
export async function remoteContentDeclaration(
  candidate: string,
  bytes: Uint8Array,
  manifest: LayerManifest,
  options: { modrinth?: ModrinthAdapter; installed?: DetectedModrinthContent } = {},
): Promise<RemoteFileDeclaration> {
  const modrinth = options.modrinth ?? new ModrinthAdapter();
  const identity = hashes(bytes);
  const allowedRequirements = new Set(["required", "optional", "unsupported"]);
  const installed =
    options.installed?.sha1 === identity.sha1 &&
    options.installed.fileSize === bytes.byteLength &&
    projectTypeDirectories(options.installed.projectType).length > 0 &&
    allowedRequirements.has(options.installed.clientRequirement) &&
    allowedRequirements.has(options.installed.serverRequirement)
      ? options.installed
      : undefined;
  const version = installed
    ? await modrinth.version(installed.versionId)
    : await modrinth.versionFromHash(identity.sha512, "sha512");
  const file = version.files.find((item) => item.hashes["sha512"] === identity.sha512);
  if (
    !file ||
    file.hashes["sha1"] !== identity.sha1 ||
    file.size !== bytes.byteLength ||
    !file.url.startsWith("https://")
  ) {
    throw new InlayError(
      error("modrinth-artifact-mismatch", `${candidate} does not match its Modrinth artifact metadata.`, {
        path: candidate,
      }),
    );
  }
  if (installed && version.project_id !== installed.projectId) {
    throw new InlayError(
      error("modrinth-artifact-mismatch", `${candidate} does not match its Modrinth database identity.`, {
        path: candidate,
      }),
    );
  }
  const project = installed ? undefined : await modrinth.project(version.project_id);
  const projectType = installed?.projectType ?? project?.project_type;
  const expectedDirectories = installed
    ? projectTypeDirectories(installed.projectType)
    : project
      ? projectDirectories(project)
      : [];
  if (!expectedDirectories.includes(firstSegment(candidate))) {
    throw new InlayError(
      error(
        "modrinth-content-kind-mismatch",
        `${candidate} is not stored in the ${projectType ?? "unknown"} content directory.`,
        { path: candidate },
      ),
    );
  }
  const minecraft = manifest.dependencies["minecraft"];
  const loader = runtimeLoader(manifest);
  if (!minecraft || !version.game_versions.includes(minecraft)) {
    throw new InlayError(
      error("artifact-incompatible", `${candidate} does not support Minecraft ${minecraft ?? "unknown"}.`, {
        path: candidate,
      }),
    );
  }
  if (projectType === "mod" && (!loader || !version.loaders.includes(loader))) {
    throw new InlayError(
      error("artifact-incompatible", `${candidate} does not support loader ${loader ?? "vanilla"}.`, {
        path: candidate,
      }),
    );
  }
  const env = installed ? installedEnvironment(installed) : project ? environment(project) : undefined;
  return {
    path: repositoryRelativePath(candidate),
    hashes: { sha1: identity.sha1, sha512: identity.sha512 },
    downloads: [file.url],
    fileSize: bytes.byteLength,
    ...(env ? { env } : {}),
  };
}
