import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { promisify } from "node:util";
import { MANIFEST_SCHEMA_URL, MATERIALIZATION_RECORD } from "../src/constants.js";
import { hashes } from "../src/lib/hash.js";
import { canonicalJson } from "../src/lib/json.js";
import { readManifest } from "../src/manifest/index.js";
import { commitStaged } from "../src/operations/commit.js";
import { updateGeneratedExcludes } from "../src/operations/git-excludes.js";
import { reconcilePath } from "../src/operations/reconcile.js";
import { status } from "../src/operations/status.js";

const run = promisify(execFile);

test("reconcile records Modrinth content remotely and never stages materialized bytes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "inlay-reconcile-content-"));
  await run("git", ["init", "-q"], { cwd: root });
  await writeFile(
    path.join(root, "inlay.index.json"),
    canonicalJson({
      $schema: MANIFEST_SCHEMA_URL,
      formatVersion: 1,
      game: "minecraft",
      versionId: "1.0.0",
      name: "Remote content",
      files: [
        {
          path: "mods/other.jar",
          hashes: {
            sha1: "0000000000000000000000000000000000000000",
            sha512:
              "00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
          },
          downloads: ["https://cdn.modrinth.com/data/other/versions/other/other.jar"],
          fileSize: 1,
        },
      ],
      dependencies: { minecraft: "1.21.1", "fabric-loader": "0.16.14" },
    }),
  );
  await mkdir(path.join(root, ".inlay"));
  await writeFile(
    path.join(root, MATERIALIZATION_RECORD),
    canonicalJson({
      formatVersion: 1,
      environment: "client",
      fingerprint: "existing-materialization",
      entries: [
        {
          path: "config/inherited.json",
          owner: "Parent@1.0.0",
          algorithm: "sha256",
          digest: "0".repeat(64),
          fileSize: 1,
          policy: "optional",
        },
      ],
    }),
  );
  await updateGeneratedExcludes(root, ["config/inherited.json"]);
  const bytes = new TextEncoder().encode("mod jar bytes");
  const identity = hashes(bytes);
  await mkdir(path.join(root, "mods"));
  await writeFile(path.join(root, "mods", "example.jar"), bytes);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes(`/version_file/${identity.sha512}`)) {
      return Response.json({
        id: "version-id",
        project_id: "project-id",
        name: "Example 1.0.0",
        version_number: "1.0.0",
        game_versions: ["1.21.1"],
        version_type: "release",
        loaders: ["fabric"],
        dependencies: [],
        files: [
          {
            hashes: { sha1: identity.sha1, sha512: identity.sha512 },
            url: "https://cdn.modrinth.com/data/project-id/versions/version-id/example.jar",
            filename: "example.jar",
            primary: true,
            size: bytes.byteLength,
          },
        ],
      });
    }
    if (url.endsWith("/project/project-id")) {
      return Response.json({
        id: "project-id",
        slug: "example",
        title: "Example",
        project_type: "mod",
        license: { id: "MIT", name: "MIT", url: null },
        categories: ["fabric"],
        client_side: "required",
        server_side: "required",
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  try {
    const dryRun = await reconcilePath(root, "mods/example.jar", {
      interactive: false,
      action: "add",
      dryRun: true,
    });
    assert.deepEqual(dryRun.staged, ["inlay.index.json"]);

    const outcome = await reconcilePath(root, "mods/example.jar", {
      interactive: false,
      action: "add",
    });

    assert.deepEqual(outcome.staged, ["inlay.index.json"]);
    assert.deepEqual((await readManifest(root)).manifest.files, [
      {
        path: "mods/other.jar",
        hashes: {
          sha1: "0000000000000000000000000000000000000000",
          sha512:
            "00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
        },
        downloads: ["https://cdn.modrinth.com/data/other/versions/other/other.jar"],
        fileSize: 1,
      },
      {
        path: "mods/example.jar",
        hashes: { sha1: identity.sha1, sha512: identity.sha512 },
        downloads: ["https://cdn.modrinth.com/data/project-id/versions/version-id/example.jar"],
        fileSize: bytes.byteLength,
      },
    ]);
    const { stdout: staged } = await run("git", ["diff", "--cached", "--name-only"], { cwd: root });
    assert.equal(staged.trim(), "inlay.index.json");
    const { stdout: trackedContent } = await run("git", ["ls-files", "--", "mods/example.jar"], {
      cwd: root,
    });
    assert.equal(trackedContent, "");
    const { stdout: ignoredContent } = await run(
      "git",
      ["check-ignore", "--verbose", "--", "mods/example.jar"],
      { cwd: root },
    );
    assert.match(ignoredContent, /info\/exclude.*mods\/example\.jar/u);
    const { stdout: inheritedIgnore } = await run(
      "git",
      ["check-ignore", "--verbose", "--", "config/inherited.json"],
      { cwd: root },
    );
    assert.match(inheritedIgnore, /info\/exclude.*config\/inherited\.json/u);
    assert.equal(
      (await status(root)).entries.find((entry) => entry.path === "mods/example.jar")?.state,
      "reconciled",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("reconcile prefers read-only Modrinth instance identity over a hash lookup", async () => {
  const settings = await mkdtemp(path.join(os.tmpdir(), "inlay-reconcile-modrinth-db-"));
  const root = path.join(settings, "profiles", "instance");
  await mkdir(path.join(root, "mods"), { recursive: true });
  await run("git", ["init", "-q"], { cwd: root });
  const bytes = new TextEncoder().encode("database mod bytes");
  const identity = hashes(bytes);
  await writeFile(path.join(root, "mods", "database.jar"), bytes);
  await writeFile(
    path.join(root, "inlay.index.json"),
    canonicalJson({
      $schema: MANIFEST_SCHEMA_URL,
      formatVersion: 1,
      game: "minecraft",
      versionId: "1.0.0",
      name: "Modrinth database content",
      files: [],
      dependencies: { minecraft: "1.21.1", "fabric-loader": "0.16.14" },
    }),
  );
  const database = new DatabaseSync(path.join(settings, "app.db"));
  database.exec(`
    CREATE TABLE settings (custom_dir TEXT NULL);
    INSERT INTO settings (custom_dir) VALUES (NULL);
    CREATE TABLE instances (
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL,
      applied_content_set_id TEXT NULL,
      name TEXT NOT NULL
    );
    CREATE TABLE instance_content_sets (
      id TEXT PRIMARY KEY,
      instance_id TEXT NOT NULL,
      game_version TEXT NOT NULL,
      loader TEXT NOT NULL,
      loader_version TEXT NULL
    );
    CREATE TABLE instance_files (
      id TEXT PRIMARY KEY,
      instance_id TEXT NOT NULL,
      relative_path TEXT NOT NULL,
      file_name TEXT NOT NULL,
      enabled INTEGER NOT NULL,
      sha1 TEXT NOT NULL,
      size INTEGER NOT NULL,
      missing INTEGER NOT NULL
    );
    CREATE TABLE instance_content_entries (
      id TEXT PRIMARY KEY,
      instance_id TEXT NOT NULL,
      content_set_id TEXT NOT NULL,
      file_id TEXT NULL,
      project_type TEXT NOT NULL,
      project_id TEXT NULL,
      version_id TEXT NULL,
      source_kind TEXT NOT NULL,
      server_requirement TEXT NOT NULL,
      client_requirement TEXT NOT NULL,
      enabled INTEGER NOT NULL
    );
    INSERT INTO instances (id, path, applied_content_set_id, name)
      VALUES ('instance-id', 'instance', 'content-id', 'Database Instance');
    INSERT INTO instance_content_sets (id, instance_id, game_version, loader, loader_version)
      VALUES ('content-id', 'instance-id', '1.21.1', 'fabric', '0.16.14');
  `);
  database
    .prepare(`
      INSERT INTO instance_files (
        id, instance_id, relative_path, file_name, enabled, sha1, size, missing
      ) VALUES (?, ?, ?, ?, 1, ?, ?, 0)
    `)
    .run("file-id", "instance-id", "mods/database.jar", "database.jar", identity.sha1, bytes.byteLength);
  database.exec(`
    INSERT INTO instance_content_entries (
      id, instance_id, content_set_id, file_id, project_type, project_id, version_id,
      source_kind, server_requirement, client_requirement, enabled
    ) VALUES (
      'entry-id', 'instance-id', 'content-id', 'file-id', 'mod', 'project-id', 'version-id',
      'modrinth', 'required', 'required', 1
    );
  `);
  database.close();

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/version/version-id")) {
      return Response.json({
        id: "version-id",
        project_id: "project-id",
        name: "Database Mod 1.0.0",
        version_number: "1.0.0",
        game_versions: ["1.21.1"],
        version_type: "release",
        loaders: ["fabric"],
        dependencies: [],
        files: [
          {
            hashes: { sha1: identity.sha1, sha512: identity.sha512 },
            url: "https://cdn.modrinth.com/data/project-id/versions/version-id/database.jar",
            filename: "database.jar",
            primary: true,
            size: bytes.byteLength,
          },
        ],
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  try {
    await reconcilePath(root, "mods/database.jar", {
      interactive: false,
      action: "add",
    });
    assert.equal(
      (await readManifest(root)).manifest.files[0]?.downloads[0],
      "https://cdn.modrinth.com/data/project-id/versions/version-id/database.jar",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("lay commit refuses manually staged instance content", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "inlay-commit-content-"));
  await run("git", ["init", "-q"], { cwd: root });
  await writeFile(
    path.join(root, "inlay.index.json"),
    canonicalJson({
      $schema: MANIFEST_SCHEMA_URL,
      formatVersion: 1,
      game: "minecraft",
      versionId: "1.0.0",
      name: "Remote content",
      files: [],
      dependencies: { minecraft: "1.21.1" },
    }),
  );
  await mkdir(path.join(root, "resourcepacks"));
  await writeFile(path.join(root, "resourcepacks", "local.zip"), "resource pack bytes");
  await run("git", ["add", "--force", "--", "resourcepacks/local.zip"], { cwd: root });

  await assert.rejects(
    commitStaged(root, { interactive: false, dryRun: true }),
    /resourcepacks\/local\.zip cannot be committed/u,
  );
});
