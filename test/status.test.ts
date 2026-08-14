import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { MANIFEST_SCHEMA_URL } from "../src/constants.js";
import { hashes } from "../src/lib/hash.js";
import { canonicalJson } from "../src/lib/json.js";
import { reconcilePath } from "../src/operations/reconcile.js";
import { status } from "../src/operations/status.js";

const run = promisify(execFile);

test("status orders eligible untracked files before changed current-layer files", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "inlay-status-"));
  const initial = new TextEncoder().encode("initial\n");
  const identity = hashes(initial);
  await writeFile(path.join(root, "owned.txt"), initial);
  await writeFile(
    path.join(root, "inlay.index.json"),
    canonicalJson({
      $schema: MANIFEST_SCHEMA_URL,
      formatVersion: 1,
      game: "minecraft",
      versionId: "1.0.0",
      name: "Status",
      files: [
        {
          path: "config/owned.txt",
          hashes: { sha1: identity.sha1, sha256: identity.sha256 },
          downloads: ["./owned.txt"],
          fileSize: initial.byteLength,
        },
      ],
      dependencies: { minecraft: "1.21.1" },
    }),
  );
  await run("git", ["init", "-q"], { cwd: root });
  await run("git", ["add", "."], { cwd: root });
  await writeFile(path.join(root, "owned.txt"), "changed\n");
  await writeFile(path.join(root, "new.txt"), "new\n");
  const report = await status(root);
  assert.deepEqual(
    report.entries.map((entry) => [entry.path, entry.state]),
    [
      ["new.txt", "untracked"],
      ["owned.txt", "updated"],
    ],
  );
  assert.equal(report.unresolved, 2);
});

test("status excludes repository infrastructure from implicit Layer candidates", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "inlay-status-internal-"));
  await run("git", ["init", "-q"], { cwd: root });
  await writeFile(
    path.join(root, "inlay.index.json"),
    canonicalJson({
      $schema: MANIFEST_SCHEMA_URL,
      formatVersion: 1,
      game: "minecraft",
      versionId: "1.0.0",
      name: "Status",
      files: [],
      dependencies: { minecraft: "1.21.1" },
    }),
  );
  const files = [
    ".github/workflows/release.yml",
    ".inlay/changes/intent.md",
    ".vscode/settings.json",
    "docs/content.md",
    "tests/check.ts",
    "node_modules/example/index.js",
    "logs/latest.log",
    "saves/World/level.dat",
    "README.md",
    "LICENSE",
    "instance.json",
    "package.json",
    "pnpm-lock.yaml",
    "config/old-value.toml.bak",
    "config/eligible.json",
    "scripts/crafttweaker.zs",
  ];
  for (const relative of files) {
    await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
    await writeFile(path.join(root, relative), `${relative}\n`);
  }
  await run("git", ["add", "--", "logs/latest.log", "saves/World/level.dat", "instance.json"], {
    cwd: root,
  });

  const report = await status(root);

  assert.deepEqual(
    report.entries.map((entry) => entry.path),
    ["config/eligible.json", "scripts/crafttweaker.zs"],
  );
});

test("status includes Git-tracked files that are not declared by the Layer", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "inlay-status-git-tracked-"));
  await run("git", ["init", "-q"], { cwd: root });
  await writeFile(
    path.join(root, "inlay.index.json"),
    canonicalJson({
      $schema: MANIFEST_SCHEMA_URL,
      formatVersion: 1,
      game: "minecraft",
      versionId: "1.0.0",
      name: "Status",
      files: [],
      dependencies: { minecraft: "1.21.1" },
    }),
  );
  await mkdir(path.join(root, "config"));
  await writeFile(path.join(root, "config", "tracked.json"), "{}\n");
  await run("git", ["add", "--", "config/tracked.json"], { cwd: root });

  const report = await status(root);

  assert.deepEqual(
    report.entries.map((entry) => [entry.path, entry.state]),
    [["config/tracked.json", "untracked"]],
  );
});

test("status discovers Minecraft downloads even when Git ignores their directory", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "inlay-status-ignored-mods-"));
  await run("git", ["init", "-q"], { cwd: root });
  await writeFile(
    path.join(root, "inlay.index.json"),
    canonicalJson({
      $schema: MANIFEST_SCHEMA_URL,
      formatVersion: 1,
      game: "minecraft",
      versionId: "1.0.0",
      name: "Status",
      files: [],
      dependencies: { minecraft: "1.21.1" },
    }),
  );
  await writeFile(path.join(root, ".gitignore"), "/mods/\n");
  await mkdir(path.join(root, "mods"));
  await writeFile(path.join(root, "mods", "example.jar"), "jar");

  const report = await status(root);

  assert.deepEqual(
    report.entries.map((entry) => [entry.path, entry.state]),
    [["mods/example.jar", "untracked"]],
  );
});

test("status discovers runtime config even when Git ignores it", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "inlay-status-ignored-config-"));
  await run("git", ["init", "-q"], { cwd: root });
  await writeFile(
    path.join(root, "inlay.index.json"),
    canonicalJson({
      $schema: MANIFEST_SCHEMA_URL,
      formatVersion: 1,
      game: "minecraft",
      versionId: "1.0.0",
      name: "Status",
      files: [],
      dependencies: { minecraft: "1.21.1" },
    }),
  );
  await writeFile(path.join(root, ".gitignore"), "/config/\n");
  await mkdir(path.join(root, "config"));
  await writeFile(path.join(root, "config", "example.json"), "{}\n");

  const report = await status(root);

  assert.deepEqual(
    report.entries.map((entry) => [entry.path, entry.state]),
    [["config/example.json", "untracked"]],
  );
});

test("status applies repository-owned .layignore patterns only to implicit candidates", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "inlay-status-layignore-"));
  await run("git", ["init", "-q"], { cwd: root });
  await writeFile(
    path.join(root, "inlay.index.json"),
    canonicalJson({
      $schema: MANIFEST_SCHEMA_URL,
      formatVersion: 1,
      game: "minecraft",
      versionId: "1.0.0",
      name: "Status",
      files: [],
      dependencies: { minecraft: "1.21.1" },
    }),
  );
  await writeFile(path.join(root, ".layignore"), "/scripts/\n");
  await mkdir(path.join(root, "scripts"));
  await writeFile(path.join(root, "scripts", "ignored.zs"), "ignored\n");
  await mkdir(path.join(root, "config"));
  await writeFile(path.join(root, "config", "eligible.json"), "{}\n");

  const report = await status(root);

  assert.deepEqual(
    report.entries.map((entry) => entry.path),
    ["config/eligible.json"],
  );
});

test("preserving an implicit file records it in .layignore and removes it from status", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "inlay-status-preserve-"));
  await run("git", ["init", "-q"], { cwd: root });
  await writeFile(
    path.join(root, "inlay.index.json"),
    canonicalJson({
      $schema: MANIFEST_SCHEMA_URL,
      formatVersion: 1,
      game: "minecraft",
      versionId: "1.0.0",
      name: "Status",
      files: [],
      dependencies: { minecraft: "1.21.1" },
    }),
  );
  await writeFile(path.join(root, "options.txt"), "fullscreen:true\n");

  assert.deepEqual(
    (await status(root)).entries.map((entry) => entry.path),
    ["options.txt"],
  );

  const outcome = await reconcilePath(root, "options.txt", {
    interactive: false,
    action: "preserve",
  });

  assert.deepEqual(outcome.staged, [".layignore"]);
  assert.match(await readFile(path.join(root, ".layignore"), "utf8"), /^\/options\.txt$/mu);
  assert.deepEqual((await status(root)).entries, []);
  assert.equal(await readFile(path.join(root, "options.txt"), "utf8"), "fullscreen:true\n");
  const { stdout: staged } = await run("git", ["diff", "--cached", "--name-only"], { cwd: root });
  assert.equal(staged.trim(), ".layignore");
});

test("status projects runtime configs into a detected Configured Defaults tree", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "inlay-status-configured-defaults-"));
  await run("git", ["init", "-q"], { cwd: root });
  await writeFile(
    path.join(root, "inlay.index.json"),
    canonicalJson({
      $schema: MANIFEST_SCHEMA_URL,
      formatVersion: 1,
      game: "minecraft",
      versionId: "1.0.0",
      name: "Status",
      files: [
        {
          path: "mods/configured-defaults.jar",
          hashes: { sha1: "0".repeat(40), sha512: "0".repeat(128) },
          downloads: [
            "https://cdn.modrinth.com/data/SISoSFPP/versions/immutable-version/configured-defaults.jar",
          ],
          fileSize: 1,
        },
      ],
      dependencies: { minecraft: "1.21.1" },
    }),
  );
  await mkdir(path.join(root, "configureddefaults"));
  await mkdir(path.join(root, "config", "example"), { recursive: true });
  await writeFile(path.join(root, "config", "example", "settings.json"), '{"enabled":true}\n');

  const report = await status(root);

  assert.deepEqual(
    report.entries.map((entry) => [entry.path, entry.declarationPath, entry.state]),
    [["config/example/settings.json", "configureddefaults/config/example/settings.json", "untracked"]],
  );
});

test("status reports runtime drift against a declared default at the authorable path", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "inlay-status-default-drift-"));
  await run("git", ["init", "-q"], { cwd: root });
  const defaults = new TextEncoder().encode('{"enabled":true}\n');
  const identity = hashes(defaults);
  const defaultPath = "configureddefaults/config/example/settings.json";
  await mkdir(path.dirname(path.join(root, defaultPath)), { recursive: true });
  await writeFile(path.join(root, defaultPath), defaults);
  await mkdir(path.join(root, "config", "example"), { recursive: true });
  await writeFile(path.join(root, "config", "example", "settings.json"), '{"enabled":false}\n');
  await writeFile(
    path.join(root, "inlay.index.json"),
    canonicalJson({
      $schema: MANIFEST_SCHEMA_URL,
      formatVersion: 1,
      game: "minecraft",
      versionId: "1.0.0",
      name: "Status",
      files: [
        {
          path: defaultPath,
          hashes: { sha1: identity.sha1, sha256: identity.sha256 },
          downloads: [`./${defaultPath}`],
          fileSize: defaults.byteLength,
        },
      ],
      dependencies: { minecraft: "1.21.1" },
    }),
  );

  const report = await status(root);

  assert.deepEqual(
    report.entries.map((entry) => [entry.path, entry.declarationPath, entry.state]),
    [["config/example/settings.json", defaultPath, "updated"]],
  );
});

test("status does not activate projection from a generated empty YOSBR skeleton", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "inlay-status-yosbr-skeleton-"));
  await run("git", ["init", "-q"], { cwd: root });
  await writeFile(
    path.join(root, "inlay.index.json"),
    canonicalJson({
      $schema: MANIFEST_SCHEMA_URL,
      formatVersion: 1,
      game: "minecraft",
      versionId: "1.0.0",
      name: "Status",
      files: [],
      dependencies: { minecraft: "1.21.1" },
    }),
  );
  await mkdir(path.join(root, "config", "yosbr", "config"), { recursive: true });
  await writeFile(path.join(root, "config", "yosbr", "options.txt"), "");
  await writeFile(path.join(root, "config", "example.json"), "{}\n");

  const report = await status(root);

  assert.deepEqual(
    report.entries.map((entry) => [entry.path, entry.declarationPath]),
    [["config/example.json", undefined]],
  );
});

test("status keeps Config Manager control flags direct while projecting ordinary configs", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "inlay-status-config-manager-"));
  await run("git", ["init", "-q"], { cwd: root });
  await writeFile(
    path.join(root, "inlay.index.json"),
    canonicalJson({
      $schema: MANIFEST_SCHEMA_URL,
      formatVersion: 1,
      game: "minecraft",
      versionId: "1.0.0",
      name: "Status",
      files: [
        {
          path: "mods/config-manager.jar",
          hashes: { sha1: "0".repeat(40), sha512: "0".repeat(128) },
          downloads: ["https://cdn.modrinth.com/data/jlNms3Jp/versions/immutable-version/config-manager.jar"],
          fileSize: 1,
        },
      ],
      dependencies: { minecraft: "1.21.1" },
    }),
  );
  await mkdir(path.join(root, "config"));
  await writeFile(path.join(root, "config", "CONFIG_MANAGER_RESET_FLAG"), "");
  await writeFile(path.join(root, "config", "example.json"), "{}\n");

  const report = await status(root);

  assert.deepEqual(
    report.entries.map((entry) => [entry.path, entry.declarationPath]),
    [
      ["config/CONFIG_MANAGER_RESET_FLAG", undefined],
      ["config/example.json", "config/modpack_defaults/config/example.json"],
    ],
  );
});

test("status never offers the Default Options journal for packaging", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "inlay-status-default-options-journal-"));
  await run("git", ["init", "-q"], { cwd: root });
  await writeFile(
    path.join(root, "inlay.index.json"),
    canonicalJson({
      $schema: MANIFEST_SCHEMA_URL,
      formatVersion: 1,
      game: "minecraft",
      versionId: "1.0.0",
      name: "Status",
      files: [
        {
          path: "mods/default-options.jar",
          hashes: { sha1: "0".repeat(40), sha512: "0".repeat(128) },
          downloads: [
            "https://cdn.modrinth.com/data/WEg59z5b/versions/immutable-version/default-options.jar",
          ],
          fileSize: 1,
        },
      ],
      dependencies: { minecraft: "1.21.1" },
    }),
  );
  await writeFile(path.join(root, "defaultoptions.journal.json"), "{}\n");

  assert.deepEqual((await status(root)).entries, []);
});

test(".layignore cannot hide runtime drift for an explicit defaults declaration", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "inlay-status-explicit-default-"));
  await run("git", ["init", "-q"], { cwd: root });
  const defaults = new TextEncoder().encode('{"enabled":true}\n');
  const identity = hashes(defaults);
  const defaultPath = "configureddefaults/config/example.json";
  await mkdir(path.dirname(path.join(root, defaultPath)), { recursive: true });
  await writeFile(path.join(root, defaultPath), defaults);
  await writeFile(path.join(root, ".layignore"), "/config/\n/configureddefaults/\n");
  await mkdir(path.join(root, "config"));
  await writeFile(path.join(root, "config", "example.json"), '{"enabled":false}\n');
  await writeFile(
    path.join(root, "inlay.index.json"),
    canonicalJson({
      $schema: MANIFEST_SCHEMA_URL,
      formatVersion: 1,
      game: "minecraft",
      versionId: "1.0.0",
      name: "Status",
      files: [
        {
          path: defaultPath,
          hashes: { sha1: identity.sha1, sha256: identity.sha256 },
          downloads: [`./${defaultPath}`],
          fileSize: defaults.byteLength,
        },
      ],
      dependencies: { minecraft: "1.21.1" },
    }),
  );

  const report = await status(root);

  assert.deepEqual(
    report.entries.map((entry) => [entry.path, entry.declarationPath, entry.state]),
    [["config/example.json", defaultPath, "updated"]],
  );
});

test("status detects newer runtime drift after a matching default was staged", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "inlay-status-staged-default-"));
  await run("git", ["init", "-q"], { cwd: root });
  const defaults = new TextEncoder().encode('{"enabled":true}\n');
  const identity = hashes(defaults);
  const defaultPath = "configureddefaults/config/example.json";
  await mkdir(path.dirname(path.join(root, defaultPath)), { recursive: true });
  await writeFile(path.join(root, defaultPath), defaults);
  await mkdir(path.join(root, "config"));
  await writeFile(path.join(root, "config", "example.json"), '{"enabled":false}\n');
  await writeFile(
    path.join(root, "inlay.index.json"),
    canonicalJson({
      $schema: MANIFEST_SCHEMA_URL,
      formatVersion: 1,
      game: "minecraft",
      versionId: "1.0.0",
      name: "Status",
      files: [
        {
          path: defaultPath,
          hashes: { sha1: identity.sha1, sha256: identity.sha256 },
          downloads: [`./${defaultPath}`],
          fileSize: defaults.byteLength,
        },
      ],
      dependencies: { minecraft: "1.21.1" },
    }),
  );
  await run("git", ["add", "--", defaultPath], { cwd: root });

  const report = await status(root);

  assert.deepEqual(
    report.entries.map((entry) => [entry.path, entry.declarationPath, entry.state]),
    [["config/example.json", defaultPath, "updated"]],
  );
});

test("status discovers authored Configured Defaults files even when Git ignores them", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "inlay-status-existing-defaults-"));
  await run("git", ["init", "-q"], { cwd: root });
  await writeFile(
    path.join(root, "inlay.index.json"),
    canonicalJson({
      $schema: MANIFEST_SCHEMA_URL,
      formatVersion: 1,
      game: "minecraft",
      versionId: "1.0.0",
      name: "Status",
      files: [],
      dependencies: { minecraft: "1.21.1" },
    }),
  );
  const defaultPath = "configureddefaults/config/example.json";
  await mkdir(path.dirname(path.join(root, defaultPath)), { recursive: true });
  await writeFile(path.join(root, defaultPath), "{}\n");
  await mkdir(path.join(root, "config"));
  await writeFile(path.join(root, "config", "example.json"), "{}\n");
  await writeFile(path.join(root, ".git", "info", "exclude"), "/configureddefaults/\n");

  const report = await status(root);

  assert.deepEqual(
    report.entries.map((entry) => [entry.path, entry.declarationPath, entry.state]),
    [[defaultPath, undefined, "untracked"]],
  );
});
