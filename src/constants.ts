export const TOOLKIT_VERSION = "0.1.0";
export const MANIFEST_FILENAME = "inlay.index.json";
export const MANIFEST_SCHEMA_VERSION = "1.0.0";
export const MANIFEST_SCHEMA_URL =
  "https://raw.githubusercontent.com/lucent-mc/inlay/schema-v1.0.0/schema/inlay-1.0.0.schema.json";
export const JSON_RESULT_SCHEMA_VERSION = 1 as const;
export const MATERIALIZATION_RECORD = ".inlay/materialization.json";
export const LOCAL_EXCLUDE_MARKER_START = "# inlay:start";
export const LOCAL_EXCLUDE_MARKER_END = "# inlay:end";
export const DEFAULT_LOCAL_EXCLUDES = [
  "/.cache/",
  "/.fabric/",
  "/.quilt/",
  "/assets/",
  "/backups/",
  "/cache/",
  "/crash-reports/",
  "/downloads/",
  "/libraries/",
  "/logs/",
  "/natives/",
  "/saves/",
  "/screenshots/",
  "/server-resource-packs/",
  "/versions/",
  "/webcache/",
  "/instance.json",
  "/launcher_accounts.json",
  "/launcher_profiles.json",
  "/realms_persistence.json",
  "/servers.dat",
  "/servers.dat_old",
  "/usercache.json",
  "/usernamecache.json",
] as const;
export const MODRINTH_UPLOAD_LIMIT = 524_288_000;
export const GITHUB_RELEASE_UPLOAD_LIMIT = 2_147_483_647;
