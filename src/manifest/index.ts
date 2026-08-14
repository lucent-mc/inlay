import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Ajv2020, type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import addFormatsImport from "ajv-formats";
import { MANIFEST_FILENAME, MANIFEST_SCHEMA_VERSION } from "../constants.js";
import { error, InlayError, warning } from "../diagnostics.js";
import { contentAuthority } from "../lib/content-authority.js";
import { canonicalJson } from "../lib/json.js";
import { contentKey, normalizeContentPath, repositoryRelativePath } from "../lib/path.js";
import type {
  Diagnostic,
  Environment,
  FileDeclaration,
  FileEnvironment,
  LayerManifest,
  RepositoryFileDeclaration,
} from "../types.js";

let validatorPromise: Promise<ValidateFunction> | undefined;

async function readBundledSchema(): Promise<object> {
  const candidates = [
    new URL("../../schema/inlay-1.0.0.schema.json", import.meta.url),
    new URL("../../../schema/inlay-1.0.0.schema.json", import.meta.url),
    path.join(process.cwd(), "schema", "inlay-1.0.0.schema.json"),
  ];
  for (const candidate of candidates) {
    try {
      return JSON.parse(await readFile(candidate, "utf8")) as object;
    } catch {
      // Try the next package/test layout.
    }
  }
  throw new InlayError(error("schema-asset-missing", "The bundled Inlay 1.0.0 schema cannot be found."));
}

function schemaVersion(schemaUrl: string): string | undefined {
  const match = schemaUrl.match(/(?:inlay[-.]|schema[/@-])v?(\d+\.\d+\.\d+)/i);
  return match?.[1];
}

function formatAjvError(item: ErrorObject): string {
  const location = item.instancePath || "/";
  return `${location} ${item.message ?? item.keyword}`;
}

async function validator() {
  validatorPromise ??= (async () => {
    const schema = await readBundledSchema();
    const ajv = new Ajv2020({ allErrors: true, strict: true, discriminator: true });
    const addFormats = addFormatsImport as unknown as (instance: Ajv2020) => void;
    addFormats(ajv);
    return ajv.compile(schema);
  })();
  return validatorPromise;
}

export function isRepositoryFile(file: FileDeclaration): file is RepositoryFileDeclaration {
  return file.downloads.length === 1 && file.downloads[0]?.startsWith("./") === true;
}

export function effectiveEnvironment(file: FileDeclaration): FileEnvironment {
  return file.env ?? { client: "required", server: "required" };
}

export function environmentsFor(file: FileDeclaration): Environment[] {
  const env = effectiveEnvironment(file);
  return (["client", "server"] as const).filter((slot) => env[slot] !== "unsupported");
}

export async function validateManifest(
  value: unknown,
): Promise<{ manifest: LayerManifest; warnings: Diagnostic[] }> {
  const validate = await validator();
  if (!validate(value)) {
    throw new InlayError(
      (validate.errors ?? []).map((item) => error("manifest-schema", formatAjvError(item))),
      1,
    );
  }

  const manifest = value as LayerManifest;
  const declaredVersion = schemaVersion(manifest.$schema);
  if (declaredVersion !== MANIFEST_SCHEMA_VERSION) {
    throw new InlayError(
      error(
        "schema-version-incompatible",
        declaredVersion
          ? `This lay writes schema ${MANIFEST_SCHEMA_VERSION} and cannot read schema ${declaredVersion}. Upgrade lay or run a supported one-major lay migrate.`
          : `Cannot determine an exact Manifest Schema Version from $schema: ${manifest.$schema}`,
      ),
      2,
    );
  }

  const warnings: Diagnostic[] = [];
  const occupied = new Map<string, string>();
  for (const file of manifest.files) {
    normalizeContentPath(file.path);
    if (isRepositoryFile(file)) {
      repositoryRelativePath(file.downloads[0]);
      if (contentAuthority(file.path) !== "repository-config") {
        throw new InlayError(
          error(
            "repository-content-forbidden",
            `Only configuration content may be repository-backed; ${file.path} requires immutable remote downloads.`,
            { path: file.path },
          ),
        );
      }
    }
    for (const environment of environmentsFor(file)) {
      const key = `${contentKey(file.path)}\0${environment}`;
      const previous = occupied.get(key);
      if (previous) {
        throw new InlayError(
          error(
            "duplicate-content-slot",
            `${file.path} and ${previous} occupy the same ${environment} slot.`,
            {
              path: file.path,
            },
          ),
        );
      }
      occupied.set(key, file.path);
    }
  }

  const exclusionKeys = new Set<string>();
  for (const exclusion of manifest.exclusions ?? []) {
    normalizeContentPath(exclusion.path);
    const key = `${contentKey(exclusion.path)}\0${exclusion.recursive === true}\0${[
      ...(exclusion.environments ?? ["client", "server"]),
    ]
      .sort()
      .join(",")}`;
    if (exclusionKeys.has(key)) {
      warnings.push(
        warning("redundant-exclusion", `Duplicate exclusion for ${exclusion.path}.`, {
          path: exclusion.path,
        }),
      );
    }
    exclusionKeys.add(key);
  }

  return { manifest, warnings };
}

export async function parseManifest(
  bytes: Uint8Array,
): Promise<{ manifest: LayerManifest; warnings: Diagnostic[] }> {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(bytes));
  } catch (cause) {
    throw new InlayError(error("manifest-json", `Invalid JSON: ${(cause as Error).message}`));
  }
  return validateManifest(value);
}

export async function readManifest(
  root: string,
): Promise<{ manifest: LayerManifest; warnings: Diagnostic[] }> {
  const filename = path.join(root, MANIFEST_FILENAME);
  let bytes: Uint8Array;
  try {
    bytes = await readFile(filename);
  } catch (cause) {
    throw new InlayError(
      error("manifest-missing", `No ${MANIFEST_FILENAME} exists at ${root}. Run lay init or lay fork.`, {
        detail: (cause as Error).message,
      }),
    );
  }
  return parseManifest(bytes);
}

export async function writeManifest(root: string, manifest: LayerManifest): Promise<void> {
  await validateManifest(manifest);
  await writeFile(path.join(root, MANIFEST_FILENAME), canonicalJson(manifest), "utf8");
}
