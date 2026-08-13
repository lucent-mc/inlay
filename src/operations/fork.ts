import { access } from "node:fs/promises";
import path from "node:path";
import { GitAdapter } from "../adapters/git.js";
import { MANIFEST_FILENAME, MANIFEST_SCHEMA_URL } from "../constants.js";
import { error, InlayError } from "../diagnostics.js";
import { writeManifest } from "../manifest/index.js";
import { LineageResolver, lockParentReference } from "../resolution/parents.js";
import type { Environment, LayerManifest } from "../types.js";
import { materialize } from "./materialize.js";

export async function forkLayer(
  root: string,
  source: string,
  options: {
    version?: string;
    filename?: string;
    name: string;
    layerVersion?: string;
    environment?: Environment;
    dryRun?: boolean;
  },
) {
  try {
    await access(path.join(root, MANIFEST_FILENAME));
    throw new InlayError(error("already-initialized", `${MANIFEST_FILENAME} already exists.`));
  } catch (cause) {
    if (cause instanceof InlayError) throw cause;
  }
  const parent = await lockParentReference(source, options);
  const lineage = await new LineageResolver().parent(parent, new Set());
  const parentLayer = lineage.at(-1);
  if (!parentLayer) throw new InlayError(error("parent-empty", "The parent resolved to no Layer."));
  const manifest: LayerManifest = {
    $schema: MANIFEST_SCHEMA_URL,
    extends: parent,
    exclusions: [],
    formatVersion: 1,
    game: "minecraft",
    versionId: options.layerVersion ?? "0.1.0",
    name: options.name,
    files: [],
    dependencies: { ...parentLayer.manifest.dependencies },
  };
  if (options.dryRun === true) {
    return { manifest, record: null, wouldMaterialize: options.environment ?? "client" };
  }
  await writeManifest(root, manifest);
  const record = await materialize(root, options.environment ?? "client");
  const git = new GitAdapter(root);
  if (await git.isRepository()) await git.stage([MANIFEST_FILENAME], true);
  return { manifest, record };
}
