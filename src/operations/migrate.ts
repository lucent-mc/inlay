import { MANIFEST_SCHEMA_VERSION } from "../constants.js";
import { error, InlayError } from "../diagnostics.js";
import { readManifest, writeManifest } from "../manifest/index.js";

export async function migrateManifest(root: string, target = MANIFEST_SCHEMA_VERSION, dryRun = false) {
  if (target !== MANIFEST_SCHEMA_VERSION) {
    throw new InlayError(
      error("migration-unsupported", `This lay can only write schema ${MANIFEST_SCHEMA_VERSION}.`),
      2,
    );
  }
  const { manifest } = await readManifest(root);
  if (!dryRun) await writeManifest(root, manifest);
  return { schemaVersion: MANIFEST_SCHEMA_VERSION, changed: false };
}
