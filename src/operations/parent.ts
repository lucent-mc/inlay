import { GitAdapter } from "../adapters/git.js";
import { MANIFEST_FILENAME } from "../constants.js";
import { error, InlayError } from "../diagnostics.js";
import { readManifest, writeManifest } from "../manifest/index.js";
import { composeLayers } from "../resolution/compose.js";
import { LineageResolver, lockParentReference } from "../resolution/parents.js";
import { materialize } from "./materialize.js";

export async function setParent(
  root: string,
  source: string,
  options: { version?: string; filename?: string; dryRun?: boolean },
) {
  const { manifest } = await readManifest(root);
  const parent = await lockParentReference(source, options);
  const ancestors = await new LineageResolver().parent(parent, new Set());
  const parentLayer = ancestors.at(-1);
  if (!parentLayer) throw new InlayError(error("parent-empty", "The parent resolved to no Layer."));
  const parentDependencies = JSON.stringify(Object.entries(parentLayer.manifest.dependencies).sort());
  const childDependencies = JSON.stringify(Object.entries(manifest.dependencies).sort());
  if (parentDependencies !== childDependencies) {
    throw new InlayError(
      error(
        "runtime-target-mismatch",
        "The new parent's Minecraft and loader versions do not exactly match this Layer.",
      ),
    );
  }
  if (options.dryRun === true) return { parent, record: null };
  manifest.extends = parent;
  await writeManifest(root, manifest);
  composeLayers([
    ...ancestors,
    {
      manifest,
      source: { kind: "local", label: root, repositoryRoot: root },
      identity: { name: manifest.name, versionId: manifest.versionId, source: root, imported: false },
      content: [],
    },
  ]);
  const record = await materialize(root, "client");
  await new GitAdapter(root).stage([MANIFEST_FILENAME], false);
  return { parent, record };
}

export async function removeParent(root: string, dryRun = false) {
  const { manifest } = await readManifest(root);
  const previous = manifest.extends;
  if (dryRun) return { previous, record: null };
  delete manifest.extends;
  await writeManifest(root, manifest);
  const record = await materialize(root, "client");
  await new GitAdapter(root).stage([MANIFEST_FILENAME], false);
  return { previous, record };
}
