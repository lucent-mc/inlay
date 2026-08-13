import Ajv2020, { type ErrorObject } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

type JsonObject = Record<string, unknown>;

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export interface ManifestSummary {
  parent: "none" | "git" | "modrinth";
  remoteFiles: number;
  repositoryFiles: number;
  exclusions: number;
  delivery: "bundled" | "github";
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatError(error: ErrorObject): string {
  const location = error.instancePath || "/";
  return `${location} ${error.message ?? error.keyword}`;
}

export function createManifestValidator(schema: object) {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);

  return (manifest: unknown): ValidationResult => {
    const valid = validate(manifest);
    return {
      valid,
      errors: valid ? [] : (validate.errors ?? []).map(formatError),
    };
  };
}

export function summarizeManifest(manifest: unknown): ManifestSummary {
  if (!isObject(manifest)) {
    throw new TypeError("Manifest must be a JSON object");
  }

  const parentValue = manifest.extends;
  const parent = !isObject(parentValue)
    ? "none"
    : "project" in parentValue
      ? "modrinth"
      : "git";

  const files = Array.isArray(manifest.files) ? manifest.files : [];
  const repositoryFiles = files.filter((file) => {
    if (!isObject(file) || !Array.isArray(file.downloads)) return false;
    return file.downloads.length === 1 &&
      typeof file.downloads[0] === "string" &&
      file.downloads[0].startsWith("./");
  }).length;

  const delivery = manifest.delivery === "github" ? "github" : "bundled";

  return {
    parent,
    remoteFiles: files.length - repositoryFiles,
    repositoryFiles,
    exclusions: Array.isArray(manifest.exclusions) ? manifest.exclusions.length : 0,
    delivery,
  };
}

export function describeBuild(summary: ManifestSummary): string[] {
  const repositoryOutcome = summary.delivery === "bundled"
    ? `${summary.repositoryFiles} repository source(s) become override ZIP entries and are omitted from modrinth.index.json.`
    : `${summary.repositoryFiles} repository source(s) become commit-addressed HTTPS entries with computed hashes and sizes.`;

  return [
    `${summary.remoteFiles} HTTPS file entry or entries pass through with Modrinth semantics.`,
    repositoryOutcome,
    `${summary.exclusions} exclusion rule(s) apply to the resolved parent before current files are overlaid by path.`,
  ];
}
