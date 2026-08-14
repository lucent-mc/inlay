import { LAYIGNORE_FILENAME, MANIFEST_FILENAME } from "../constants.js";
import { repositoryRelativePath } from "./path.js";

const REPOSITORY_DIRECTORIES = new Set([
  ".cache",
  ".changeset",
  ".devcontainer",
  ".fabric",
  ".forgejo",
  ".gitea",
  ".git",
  ".github",
  ".gitlab",
  ".hg",
  ".husky",
  ".idea",
  ".inlay",
  ".quilt",
  ".svn",
  ".vscode",
  "action",
  "assets",
  "backups",
  "build",
  "cache",
  "ci",
  "coverage",
  "crash-reports",
  "downloads",
  "dist",
  "docs",
  "libraries",
  "logs",
  "natives",
  "node_modules",
  "saves",
  "schema",
  "screenshots",
  "server-resource-packs",
  "test",
  "tests",
  "versions",
  "webcache",
]);

const REPOSITORY_FILES = new Set([
  MANIFEST_FILENAME,
  LAYIGNORE_FILENAME,
  ".editorconfig",
  ".gitattributes",
  ".gitignore",
  ".gitmodules",
  ".mailmap",
  ".node-version",
  ".npmrc",
  ".nvmrc",
  ".prettierignore",
  ".prettierrc",
  ".tool-versions",
  "biome.json",
  "biome.jsonc",
  "bun.lock",
  "bun.lockb",
  "deno.json",
  "deno.jsonc",
  "dockerfile",
  "instance.json",
  "justfile",
  "launcher_accounts.json",
  "launcher_profiles.json",
  "makefile",
  "modrinth.index.json",
  "package-lock.json",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "profile.json",
  "realms_persistence.json",
  "servers.dat",
  "servers.dat_old",
  "usercache.json",
  "usernamecache.json",
  "yarn.lock",
]);

const TRANSIENT_FILENAMES = new Set([".ds_store", "desktop.ini", "thumbs.db"]);
const TRANSIENT_SUFFIXES = [".bak", ".orig", ".rej", ".swp", ".swo", ".temp", ".tmp", "~"];

function isRootRepositoryFile(candidate: string): boolean {
  if (candidate.includes("/")) return false;
  return (
    REPOSITORY_FILES.has(candidate) ||
    candidate.endsWith(".md") ||
    /^(?:copying|license|notice)(?:\..+)?$/u.test(candidate) ||
    /^(?:eslint|prettier|vite|vitest)\.config\..+$/u.test(candidate) ||
    /^tsconfig(?:\..+)?\.json$/u.test(candidate)
  );
}

function isAtOrWithin(candidate: string, directory: string): boolean {
  return candidate === directory || candidate.startsWith(`${directory}/`);
}

/**
 * Whether an untracked regular file should be offered for implicit adoption into files[].
 * Explicit declarations remain authoritative and are not filtered through this policy.
 */
export function isImplicitContentCandidate(value: string, docsRoot = "docs"): boolean {
  const candidate = repositoryRelativePath(value).toLocaleLowerCase("en-US");
  const firstSegment = candidate.split("/", 1)[0] ?? candidate;
  if (REPOSITORY_DIRECTORIES.has(firstSegment) || isRootRepositoryFile(candidate)) return false;
  const basename = candidate.slice(candidate.lastIndexOf("/") + 1);
  if (TRANSIENT_FILENAMES.has(basename) || TRANSIENT_SUFFIXES.some((suffix) => basename.endsWith(suffix)))
    return false;
  const docs = repositoryRelativePath(docsRoot).toLocaleLowerCase("en-US");
  return !isAtOrWithin(candidate, docs);
}
