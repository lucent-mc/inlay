import Ajv2020, { type ErrorObject } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { createHash } from "node:crypto";

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

export interface IntegrityResult {
  valid: boolean;
  errors: string[];
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function repositorySource(file: unknown): string | null {
  if (!isObject(file) || !Array.isArray(file.downloads)) return null;
  const [source] = file.downloads;
  return file.downloads.length === 1 &&
      typeof source === "string" &&
      source.startsWith("./")
    ? source
    : null;
}

export function verifyRepositoryFile(
  file: unknown,
  content: Uint8Array,
): IntegrityResult {
  if (!isObject(file) || !isObject(file.hashes)) {
    return { valid: false, errors: ["repository file has no hashes object"] };
  }

  const expectedSize = file.fileSize;
  const expectedSha1 = file.hashes.sha1;
  const expectedSha256 = file.hashes.sha256;
  const actualSha1 = createHash("sha1").update(content).digest("hex");
  const actualSha256 = createHash("sha256").update(content).digest("hex");
  const errors: string[] = [];

  if (expectedSize !== content.byteLength) {
    errors.push(`fileSize is ${String(expectedSize)} but source is ${content.byteLength} bytes`);
  }
  if (expectedSha1 !== actualSha1) {
    errors.push(`sha1 is ${String(expectedSha1)} but source hashes to ${actualSha1}`);
  }
  if (expectedSha256 !== actualSha256) {
    errors.push(`sha256 is ${String(expectedSha256)} but source hashes to ${actualSha256}`);
  }

  return { valid: errors.length === 0, errors };
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
    : typeof parentValue.url === "string" && /\\.mrpack(?:[?#]|$)/i.test(parentValue.url)
      ? "modrinth"
      : "git";

  const files = Array.isArray(manifest.files) ? manifest.files : [];
  const repositoryFiles = files.filter((file) => repositorySource(file) !== null).length;

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
