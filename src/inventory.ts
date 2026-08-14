import { unzipSync } from "fflate";
import { ModrinthAdapter, type ModrinthDependency, modrinthIdentityFromUrl } from "./adapters/modrinth.js";
import { warning } from "./diagnostics.js";
import { resolveDependencyClaim } from "./lib/dependency-adapters.js";
import type { Diagnostic, ResolvedContent, ResolvedPack } from "./types.js";

export interface ContentMetadata {
  path: string;
  owner: string;
  projectId?: string;
  versionId?: string;
  version?: string;
  name?: string;
  kind?: string;
  license?: string;
  dependencies: ModrinthDependency[];
}

export interface InventoryResult {
  content: ContentMetadata[];
  diagnostics: Diagnostic[];
}

function uniqueContent(pack: ResolvedPack): ResolvedContent[] {
  const found = new Map<string, ResolvedContent>();
  for (const content of pack.slots.values()) {
    const hash =
      "sha512" in content.declaration.hashes
        ? content.declaration.hashes.sha512
        : content.declaration.hashes.sha256;
    found.set(`${content.path.toLowerCase()}\0${hash}`, content);
  }
  return [...found.values()].sort((left, right) => left.path.localeCompare(right.path));
}

function embeddedFabricMetadata(
  bytes: Uint8Array,
): { name?: string; depends?: Record<string, unknown> } | undefined {
  try {
    const entries = unzipSync(bytes, { filter: (file) => file.name === "fabric.mod.json" });
    const metadata = entries["fabric.mod.json"];
    return metadata
      ? (JSON.parse(new TextDecoder().decode(metadata)) as {
          name?: string;
          depends?: Record<string, unknown>;
        })
      : undefined;
  } catch {
    return undefined;
  }
}

export async function deriveInventory(
  pack: ResolvedPack,
  payloads: Map<string, Uint8Array>,
  modrinth = new ModrinthAdapter(),
): Promise<InventoryResult> {
  const diagnostics: Diagnostic[] = [];
  const content: ContentMetadata[] = [];

  for (const item of uniqueContent(pack)) {
    const identity = item.declaration.downloads.map(modrinthIdentityFromUrl).find(Boolean);
    if (identity) {
      try {
        const [version, project] = await Promise.all([
          modrinth.version(identity.versionId),
          modrinth.project(identity.projectId),
        ]);
        content.push({
          path: item.path,
          owner: `${item.owner.name}@${item.owner.versionId}`,
          projectId: project.id,
          versionId: version.id,
          version: version.version_number,
          name: project.title,
          kind: project.project_type,
          license: project.license.id,
          dependencies: version.dependencies,
        });
        if (!project.license.id || project.license.id === "LicenseRef-Unknown") {
          diagnostics.push(
            warning("license-unknown", `${item.path} has an unknown or custom license.`, { path: item.path }),
          );
        }
        continue;
      } catch (cause) {
        diagnostics.push(
          warning("metadata-unavailable", `Could not resolve Modrinth metadata for ${item.path}.`, {
            path: item.path,
            detail: (cause as Error).message,
          }),
        );
      }
    }

    const embedded = item.path.toLowerCase().endsWith(".jar")
      ? embeddedFabricMetadata(payloads.get(item.path.toLowerCase()) ?? new Uint8Array())
      : undefined;
    content.push({
      path: item.path,
      owner: `${item.owner.name}@${item.owner.versionId}`,
      ...(embedded?.name === undefined ? {} : { name: embedded.name }),
      dependencies: [],
    });
    if (item.path.toLowerCase().endsWith(".jar")) {
      diagnostics.push(
        warning("license-unknown", `${item.path} has no provider-resolved license.`, { path: item.path }),
      );
    }
  }

  const installedProjects = new Set(content.flatMap((item) => (item.projectId ? [item.projectId] : [])));
  for (const item of content) {
    for (const dependency of item.dependencies) {
      if (!dependency.project_id) continue;
      const resolution = resolveDependencyClaim(dependency.project_id, installedProjects);
      if (dependency.dependency_type === "required" && resolution.kind === "missing") {
        diagnostics.push(
          warning(
            "dependency-missing",
            `${item.name ?? item.path} requires missing Modrinth project ${dependency.project_id}.`,
            {
              path: item.path,
            },
          ),
        );
      }
      if (dependency.dependency_type === "incompatible" && resolution.kind !== "missing") {
        diagnostics.push(
          warning(
            "dependency-incompatible",
            `${item.name ?? item.path} is incompatible with installed project ${dependency.project_id}.`,
            {
              path: item.path,
            },
          ),
        );
      }
    }
  }

  return { content, diagnostics };
}
