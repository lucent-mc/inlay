import { readFileSync } from "node:fs";
import path from "node:path";

function toolkitVersion(): string {
  const candidates = [new URL("../package.json", import.meta.url), path.join(process.cwd(), "package.json")];
  for (const candidate of candidates) {
    try {
      const value = JSON.parse(readFileSync(candidate, "utf8")) as { version?: unknown };
      if (typeof value.version === "string") return value.version;
    } catch {
      // Test output has a different relative root from the published package.
    }
  }
  throw new Error("Cannot read the Inlay package version.");
}

export const TOOLKIT_VERSION = toolkitVersion();
export const MANIFEST_FILENAME = "inlay.index.json";
export const LAYIGNORE_FILENAME = ".layignore";
export const MANIFEST_SCHEMA_VERSION = "1.0.0";
export const MANIFEST_SCHEMA_URL =
  "https://raw.githubusercontent.com/lucent-mc/inlay/schema-v1.0.0/schema/inlay-1.0.0.schema.json";
export const JSON_RESULT_SCHEMA_VERSION = 1 as const;
export const MATERIALIZATION_RECORD = ".inlay/materialization.json";
export const LOCAL_EXCLUDE_MARKER_START = "# inlay:start";
export const LOCAL_EXCLUDE_MARKER_END = "# inlay:end";
export const DOWNLOADED_CONTENT_DIRECTORIES = [
  "datapacks",
  "mods",
  "plugins",
  "resourcepacks",
  "shaderpacks",
  "texturepacks",
] as const;
export const DEFAULT_LOCAL_EXCLUDES = [
  "/.cache/",
  "/.fabric/",
  "/.quilt/",
  "/assets/",
  "/backups/",
  "/cache/",
  "/crash-reports/",
  "/data/fabric_default_resource_packs.json",
  "/downloads/",
  "/libraries/",
  "/logs/",
  "/natives/",
  "/node_modules/",
  "/saves/",
  "/screenshots/",
  "/server-resource-packs/",
  ...DOWNLOADED_CONTENT_DIRECTORIES.map((directory) => `/${directory}/`),
  "/versions/",
  "/webcache/",
  "/instance.json",
  "/launcher_accounts.json",
  "/launcher_profiles.json",
  "/modrinth.index.json",
  "/profile.json",
  "/realms_persistence.json",
  "/servers.dat",
  "/servers.dat_old",
  "/usercache.json",
  "/usernamecache.json",
] as const;
export const DEFAULT_LAYIGNORE = `# Repository paths that are never implicit Layer content.
# Add project-specific patterns below. Syntax matches .gitignore.
/.changeset/
/.cache/
/.devcontainer/
/.fabric/
/.forgejo/
/.gitea/
/.github/
/.gitlab/
/.hg/
/.husky/
/.idea/
/.inlay/
/.quilt/
/.svn/
/.vscode/
/action/
/assets/
/backups/
/build/
/cache/
/ci/
/coverage/
/crash-reports/
/downloads/
/dist/
/docs/
/libraries/
/logs/
/natives/
/node_modules/
/saves/
/schema/
/screenshots/
/server-resource-packs/
/test/
/tests/
/versions/
/webcache/
`;
export const MODRINTH_UPLOAD_LIMIT = 524_288_000;
export const GITHUB_RELEASE_UPLOAD_LIMIT = 2_147_483_647;
