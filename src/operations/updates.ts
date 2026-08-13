import { ModrinthAdapter, type ModrinthVersion, modrinthIdentityFromUrl } from "../adapters/modrinth.js";
import { error, InlayError } from "../diagnostics.js";
import { readManifest } from "../manifest/index.js";
import { addContent } from "./packages.js";

export interface UpdateCandidate {
  path: string;
  projectId: string;
  projectName: string;
  installedVersionId: string;
  installedVersion: string;
  candidateVersionId: string;
  candidateVersion: string;
  releaseChannel: ModrinthVersion["version_type"];
}

function loader(dependencies: Record<string, string>): string | undefined {
  return Object.keys(dependencies)
    .find((key) => key !== "minecraft")
    ?.replace(/-loader$/, "");
}

export async function discoverUpdates(root: string): Promise<UpdateCandidate[]> {
  const { manifest } = await readManifest(root);
  const minecraft = manifest.dependencies["minecraft"];
  if (!minecraft)
    throw new InlayError(error("runtime-minecraft-missing", "dependencies.minecraft is required."));
  const api = new ModrinthAdapter();
  const candidates: UpdateCandidate[] = [];
  for (const file of manifest.files) {
    const identity = file.downloads.map(modrinthIdentityFromUrl).find(Boolean);
    if (!identity || !file.path.toLowerCase().endsWith(".jar")) continue;
    const [installed, project] = await Promise.all([
      api.version(identity.versionId),
      api.project(identity.projectId),
    ]);
    const versions = await api.versions(project.id, minecraft, loader(manifest.dependencies));
    const candidate = versions.find((version) => version.version_type === installed.version_type);
    if (!candidate || candidate.id === installed.id) continue;
    candidates.push({
      path: file.path,
      projectId: project.id,
      projectName: project.title,
      installedVersionId: installed.id,
      installedVersion: installed.version_number,
      candidateVersionId: candidate.id,
      candidateVersion: candidate.version_number,
      releaseChannel: installed.version_type,
    });
  }
  return candidates.sort((left, right) => left.projectName.localeCompare(right.projectName));
}

export async function updateContent(root: string, target: string, interactive: boolean, dryRun = false) {
  const candidates = await discoverUpdates(root);
  const selected = candidates.find(
    (candidate) =>
      candidate.path.toLowerCase() === target.toLowerCase() ||
      candidate.projectId === target ||
      candidate.projectName.toLowerCase() === target.toLowerCase(),
  );
  if (!selected)
    throw new InlayError(error("update-candidate-missing", `No viable owned update matches ${target}.`));
  return addContent(root, selected.projectId, {
    version: selected.candidateVersionId,
    interactive,
    releaseChannel: selected.releaseChannel,
    dryRun,
  });
}
