import path from "node:path";
import { error, InlayError } from "../diagnostics.js";

export function normalizeContentPath(value: string): string {
  if (
    value.length === 0 ||
    value.includes("\\") ||
    value.includes("\0") ||
    value.startsWith("/") ||
    /^[A-Za-z]:/.test(value) ||
    value.endsWith("/") ||
    value.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw new InlayError(error("unsafe-content-path", `Unsafe content path: ${value}`, { path: value }));
  }
  return value;
}

export function contentKey(value: string): string {
  return normalizeContentPath(value).toLocaleLowerCase("en-US");
}

export function repositoryRelativePath(value: string): string {
  const normalized = normalizeContentPath(value.replace(/^\.\//, ""));
  if (normalized.split("/").some((segment) => segment.toLocaleLowerCase("en-US") === ".git")) {
    throw new InlayError(error("unsafe-repository-path", `Repository source cannot enter .git: ${value}`));
  }
  return normalized;
}

export function resolveInside(root: string, relative: string): string {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, repositoryRelativePath(relative));
  const relation = path.relative(resolvedRoot, resolved);
  if (relation.startsWith("..") || path.isAbsolute(relation)) {
    throw new InlayError(error("path-escape", `Path escapes repository root: ${relative}`));
  }
  return resolved;
}

export function isDescendant(candidate: string, directory: string): boolean {
  const candidateKey = contentKey(candidate);
  const directoryKey = contentKey(directory);
  return candidateKey.startsWith(`${directoryKey}/`);
}
