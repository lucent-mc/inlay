import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import * as p from "@clack/prompts";
import { GitAdapter } from "../adapters/git.js";
import {
  ModrinthAdapter,
  type ModrinthDependency,
  type ModrinthProject,
  type ModrinthVersion,
  modrinthIdentityFromUrl,
} from "../adapters/modrinth.js";
import { MANIFEST_FILENAME } from "../constants.js";
import { error, InlayError } from "../diagnostics.js";
import { resolveInside } from "../lib/path.js";
import { readManifest, writeManifest } from "../manifest/index.js";
import type { FileDeclaration, FileEnvironment, LayerManifest, RemoteFileDeclaration } from "../types.js";
import { materialize } from "./materialize.js";
import { checkPack } from "./resolve.js";

interface SelectedArtifact {
  project: ModrinthProject;
  version: ModrinthVersion;
  declaration: FileDeclaration;
  bytes: Uint8Array;
}

export interface AddOptions {
  version?: string;
  interactive: boolean;
  releaseChannel?: "release" | "beta" | "alpha";
}

export interface RemoveOptions {
  interactive: boolean;
  dependents?: "remove" | "abort";
  orphans?: "remove" | "keep";
}

function runtime(manifest: LayerManifest): { minecraft: string; loader?: string } {
  const minecraft = manifest.dependencies["minecraft"];
  if (!minecraft)
    throw new InlayError(error("runtime-minecraft-missing", "dependencies.minecraft is required."));
  const loader = Object.keys(manifest.dependencies).find((key) => key !== "minecraft");
  return { minecraft, ...(loader === undefined ? {} : { loader: loader.replace(/-loader$/, "") }) };
}

function environment(project: ModrinthProject): FileEnvironment | undefined {
  const normalize = (value: ModrinthProject["client_side"]): FileEnvironment["client"] =>
    value === "unknown" ? "optional" : value;
  const env = { client: normalize(project.client_side), server: normalize(project.server_side) };
  return env.client === "required" && env.server === "required" ? undefined : env;
}

function directory(project: ModrinthProject): string {
  if (project.project_type === "resourcepack") return "resourcepacks";
  if (project.project_type === "shader") return "shaderpacks";
  if (project.project_type === "datapack") return "datapacks";
  return "mods";
}

async function chooseVersion(
  api: ModrinthAdapter,
  projectId: string,
  manifest: LayerManifest,
  requested?: string,
  channel?: "release" | "beta" | "alpha",
): Promise<ModrinthVersion> {
  if (requested) {
    const exact = await api.version(requested);
    if (exact.project_id !== projectId && exact.id !== projectId) {
      throw new InlayError(
        error("artifact-project-mismatch", `${requested} does not belong to ${projectId}.`),
      );
    }
    return exact;
  }
  const target = runtime(manifest);
  const versions = await api.versions(projectId, target.minecraft, target.loader);
  const viable = channel ? versions.filter((candidate) => candidate.version_type === channel) : versions;
  const selected = viable[0];
  if (!selected) {
    throw new InlayError(
      error(
        "artifact-unavailable",
        `No ${target.minecraft}${target.loader ? ` ${target.loader}` : ""} artifact exists for ${projectId}.`,
      ),
    );
  }
  return selected;
}

async function artifact(
  api: ModrinthAdapter,
  projectId: string,
  manifest: LayerManifest,
  requested?: string,
  channel?: "release" | "beta" | "alpha",
): Promise<SelectedArtifact> {
  const project = await api.project(projectId);
  const version = await chooseVersion(api, project.id, manifest, requested, channel);
  const file = version.files.find((candidate) => candidate.primary) ?? version.files[0];
  if (!file?.hashes["sha1"] || !file.hashes["sha512"]) {
    throw new InlayError(
      error("artifact-hashes-missing", `${project.title} has no primary SHA-1/SHA-512 artifact.`),
    );
  }
  const response = await fetch(file.url);
  if (!response.ok)
    throw new InlayError(error("artifact-download", `${file.url} returned HTTP ${response.status}.`));
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength !== file.size)
    throw new InlayError(error("artifact-size", `${file.filename} changed while downloading.`));
  const env = environment(project);
  const declaration: RemoteFileDeclaration = {
    path: `${directory(project)}/${file.filename}`,
    hashes: { sha1: file.hashes["sha1"], sha512: file.hashes["sha512"] },
    downloads: [file.url],
    fileSize: file.size,
    ...(env === undefined ? {} : { env }),
  };
  return {
    project,
    version,
    declaration,
    bytes,
  };
}

function requiredDependencies(version: ModrinthVersion): ModrinthDependency[] {
  return version.dependencies.filter(
    (dependency) => dependency.dependency_type === "required" && dependency.project_id,
  );
}

export async function addContent(root: string, projectInput: string, options: AddOptions) {
  const { manifest } = await readManifest(root);
  const before = await checkPack(root);
  const installed = new Map(
    before.inventory.content.flatMap((item) => (item.projectId ? [[item.projectId, item] as const] : [])),
  );
  const api = new ModrinthAdapter();
  const requestedProject = await api.project(projectInput);
  const queue: Array<{ project: string; version?: string }> = [
    { project: requestedProject.id, ...(options.version ? { version: options.version } : {}) },
  ];
  const selected = new Map<string, SelectedArtifact>();

  while (queue.length > 0) {
    const next = queue.shift();
    if (!next || selected.has(next.project)) continue;
    const picked = await artifact(api, next.project, manifest, next.version, options.releaseChannel);
    if (selected.has(picked.project.id)) continue;
    const inherited = installed.get(picked.project.id);
    if (
      inherited &&
      next.project !== requestedProject.id &&
      (!next.version || inherited.versionId === next.version)
    )
      continue;
    selected.set(picked.project.id, picked);
    for (const dependency of requiredDependencies(picked.version)) {
      if (dependency.project_id) {
        queue.push({
          project: dependency.project_id,
          ...(dependency.version_id ? { version: dependency.version_id } : {}),
        });
      }
    }
  }

  const existing = new Map<string, FileDeclaration>();
  for (const file of manifest.files) {
    const identity = file.downloads.map(modrinthIdentityFromUrl).find(Boolean);
    if (identity) existing.set(identity.projectId, file);
  }
  const additions = [...selected.entries()].filter(([id]) => !existing.has(id));
  const replacements = [...selected.entries()].filter(([id, item]) => {
    const current = existing.get(id);
    return current && !current.downloads.includes(item.declaration.downloads[0] ?? "");
  });
  const planned = [...additions, ...replacements];
  if (planned.length === 0) return { added: [], updated: [], dependencies: [] };

  const staging = path.join(root, ".inlay", "transactions", `${process.pid}-${Date.now()}`);
  await mkdir(staging, { recursive: true });
  try {
    for (const [, item] of planned) {
      const temporary = path.join(staging, item.declaration.path);
      await mkdir(path.dirname(temporary), { recursive: true });
      await writeFile(temporary, item.bytes);
    }
    const replacedPaths = new Set<string>();
    for (const [id] of replacements) {
      const current = existing.get(id);
      if (current) replacedPaths.add(current.path);
    }
    manifest.files = manifest.files.filter((file) => !replacedPaths.has(file.path));
    for (const [, item] of planned) manifest.files.push(item.declaration);
    manifest.files.sort((left, right) => left.path.localeCompare(right.path));
    for (const [, item] of planned) {
      const destination = resolveInside(root, item.declaration.path);
      await mkdir(path.dirname(destination), { recursive: true });
      await rename(path.join(staging, item.declaration.path), destination);
    }
    for (const oldPath of replacedPaths) await rm(resolveInside(root, oldPath), { force: true });
    for (const [projectId] of additions) {
      const inheritedEntry = installed.get(projectId);
      if (inheritedEntry && !existing.has(projectId)) {
        manifest.exclusions = [...(manifest.exclusions ?? []), { path: inheritedEntry.path }];
      }
    }
    await writeManifest(root, manifest);
    await materialize(root, "client");
    await new GitAdapter(root).stage([MANIFEST_FILENAME], false);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
  const directId = requestedProject.id;
  return {
    added: additions.map(([, item]) => item.declaration.path),
    updated: replacements.map(([, item]) => item.declaration.path),
    dependencies: planned.filter(([id]) => id !== directId).map(([, item]) => item.declaration.path),
  };
}

async function policy(
  interactive: boolean,
  requested: "remove" | "abort" | undefined,
  message: string,
): Promise<"remove" | "abort"> {
  if (requested) return requested;
  if (!interactive) throw new InlayError(error("removal-policy-required", message), 2);
  const answer = await p.confirm({ message });
  if (p.isCancel(answer)) throw new InlayError(error("cancelled", "Removal cancelled."));
  return answer ? "remove" : "abort";
}

export async function removeContent(root: string, target: string, options: RemoveOptions) {
  const checked = await checkPack(root);
  const { manifest } = await readManifest(root);
  const inventory = checked.inventory.content;
  const selected = inventory.find(
    (item) =>
      item.path.toLowerCase() === target.toLowerCase() ||
      item.projectId === target ||
      item.name?.toLowerCase() === target.toLowerCase(),
  );
  if (!selected) throw new InlayError(error("content-not-found", `No resolved content matches ${target}.`));
  const byProject = new Map(
    inventory.flatMap((item) => (item.projectId ? [[item.projectId, item] as const] : [])),
  );
  const removal = new Set<string>(selected.projectId ? [selected.projectId] : []);
  if (selected.projectId) {
    let expanded = true;
    while (expanded) {
      expanded = false;
      for (const item of inventory) {
        if (!item.projectId || removal.has(item.projectId)) continue;
        if (
          item.dependencies.some(
            (dependency) =>
              dependency.project_id &&
              removal.has(dependency.project_id) &&
              dependency.dependency_type === "required",
          )
        ) {
          const decision = await policy(
            options.interactive,
            options.dependents,
            `${item.name ?? item.path} depends on removed content. Remove the dependent closure too?`,
          );
          if (decision === "abort")
            throw new InlayError(error("removal-aborted", "No files were changed."), 2);
          removal.add(item.projectId);
          expanded = true;
        }
      }
    }
    let discoverOrphans = true;
    while (discoverOrphans) {
      discoverOrphans = false;
      const candidates = new Set<string>();
      for (const removedId of removal) {
        const removed = byProject.get(removedId);
        for (const dependency of removed?.dependencies ?? []) {
          if (
            dependency.dependency_type === "required" &&
            dependency.project_id &&
            !removal.has(dependency.project_id)
          ) {
            const stillRequired = inventory.some(
              (item) =>
                item.projectId &&
                !removal.has(item.projectId) &&
                item.dependencies.some(
                  (edge) => edge.dependency_type === "required" && edge.project_id === dependency.project_id,
                ),
            );
            if (!stillRequired) candidates.add(dependency.project_id);
          }
        }
      }
      for (const candidate of candidates) {
        let removeOrphan = options.orphans === "remove";
        if (!options.orphans && !options.interactive) {
          throw new InlayError(
            error(
              "orphan-policy-required",
              `${byProject.get(candidate)?.name ?? candidate} becomes orphaned; pass --orphans remove or --orphans keep.`,
            ),
            2,
          );
        }
        if (!options.orphans && options.interactive) {
          const answer = await p.confirm({
            message: `${byProject.get(candidate)?.name ?? candidate} has no remaining dependents. Remove it too?`,
            initialValue: true,
          });
          if (p.isCancel(answer)) throw new InlayError(error("cancelled", "Removal cancelled."));
          removeOrphan = answer;
        }
        if (removeOrphan) {
          removal.add(candidate);
          discoverOrphans = true;
        }
      }
    }
  }
  const paths = new Set(
    inventory
      .filter((item) => item.path === selected.path || (item.projectId && removal.has(item.projectId)))
      .map((item) => item.path),
  );
  const owned = new Set(manifest.files.map((file) => file.path));
  manifest.files = manifest.files.filter((file) => !paths.has(file.path));
  for (const removedPath of paths) {
    if (!owned.has(removedPath))
      manifest.exclusions = [...(manifest.exclusions ?? []), { path: removedPath }];
    await rm(resolveInside(root, removedPath), { force: true });
  }
  await writeManifest(root, manifest);
  await materialize(root, "client");
  await new GitAdapter(root).stage([MANIFEST_FILENAME], false);
  return { removed: [...paths], projects: [...removal].map((id) => byProject.get(id)?.name ?? id) };
}
