import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { MANIFEST_SCHEMA_URL, MATERIALIZATION_RECORD } from "../src/constants.js";
import { hashes } from "../src/lib/hash.js";
import { canonicalJson } from "../src/lib/json.js";
import { readManifest } from "../src/manifest/index.js";
import { reconcileTarget } from "../src/operations/reconcile.js";

const run = promisify(execFile);

test("reconcile applies one action to every unresolved file below a directory", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "inlay-reconcile-directory-"));
  await run("git", ["init", "-q"], { cwd: root });
  await writeFile(
    path.join(root, "inlay.index.json"),
    canonicalJson({
      $schema: MANIFEST_SCHEMA_URL,
      formatVersion: 1,
      game: "minecraft",
      versionId: "1.0.0",
      name: "Directory reconciliation",
      files: [],
      dependencies: { minecraft: "1.21.1" },
    }),
  );
  await mkdir(path.join(root, "config", "nested"), { recursive: true });
  await writeFile(path.join(root, "config", "first.json"), '{"first":true}\n');
  await writeFile(path.join(root, "config", "nested", "second.json"), '{"second":true}\n');

  const dryRun = await reconcileTarget(root, "config", {
    interactive: false,
    action: "add",
    dryRun: true,
  });
  assert.deepEqual(dryRun.paths, ["config/first.json", "config/nested/second.json"]);
  assert.deepEqual(dryRun.staged, ["inlay.index.json", "config/first.json", "config/nested/second.json"]);

  const outcome = await reconcileTarget(root, "config", {
    interactive: false,
    action: "add",
  });

  assert.deepEqual(outcome.paths, ["config/first.json", "config/nested/second.json"]);
  assert.deepEqual(
    (await readManifest(root)).manifest.files.map((file) => [file.path, file.downloads[0]]),
    [
      ["config/first.json", "./config/first.json"],
      ["config/nested/second.json", "./config/nested/second.json"],
    ],
  );
  const { stdout: staged } = await run("git", ["diff", "--cached", "--name-only"], { cwd: root });
  assert.deepEqual(staged.trim().split(/\r?\n/gu), [
    "config/first.json",
    "config/nested/second.json",
    "inlay.index.json",
  ]);
});

test("directory reconciliation rejects an action that cannot apply to every file", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "inlay-reconcile-mixed-directory-"));
  await run("git", ["init", "-q"], { cwd: root });
  await writeFile(
    path.join(root, "inlay.index.json"),
    canonicalJson({
      $schema: MANIFEST_SCHEMA_URL,
      formatVersion: 1,
      game: "minecraft",
      versionId: "1.0.0",
      name: "Mixed directory",
      files: [
        {
          path: "config/deleted.json",
          hashes: { sha1: "0".repeat(40), sha256: "0".repeat(64) },
          downloads: ["./config/deleted.json"],
          fileSize: 1,
        },
      ],
      dependencies: { minecraft: "1.21.1" },
    }),
  );
  await mkdir(path.join(root, "config"));
  await writeFile(path.join(root, "config", "new.json"), "{}\n");

  await assert.rejects(
    reconcileTarget(root, "config", { interactive: false, action: "add" }),
    /add cannot be applied to every unresolved file below config/u,
  );
  assert.equal((await readManifest(root)).manifest.files.length, 1);
  const { stdout: staged } = await run("git", ["diff", "--cached", "--name-only"], { cwd: root });
  assert.equal(staged, "");
});

test("directory reconciliation records a mod replacement as one batch", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "inlay-reconcile-mod-replacement-"));
  await run("git", ["init", "-q"], { cwd: root });
  const previousPath = "mods/example-1.0.0.jar";
  const nextPath = "mods/example-1.1.0.jar";
  const bytes = new TextEncoder().encode("updated mod bytes");
  const identity = hashes(bytes);
  const download = "https://cdn.modrinth.com/data/project-id/versions/new-version/example-1.1.0.jar";
  await writeFile(
    path.join(root, "inlay.index.json"),
    canonicalJson({
      $schema: MANIFEST_SCHEMA_URL,
      formatVersion: 1,
      game: "minecraft",
      versionId: "1.0.0",
      name: "Mod replacement",
      files: [
        {
          path: previousPath,
          hashes: { sha1: "0".repeat(40), sha512: "0".repeat(128) },
          downloads: ["https://cdn.modrinth.com/data/project-id/versions/old-version/example-1.0.0.jar"],
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
      fingerprint: "previous-materialization",
      entries: [
        {
          path: previousPath,
          owner: "Mod replacement@1.0.0",
          algorithm: "sha512",
          digest: "0".repeat(128),
          fileSize: 1,
          policy: "required",
        },
      ],
    }),
  );
  await mkdir(path.join(root, "mods"));
  await writeFile(path.join(root, nextPath), bytes);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes(`/version_file/${identity.sha512}`)) {
      return Response.json({
        id: "new-version",
        project_id: "project-id",
        name: "Example 1.1.0",
        version_number: "1.1.0",
        game_versions: ["1.21.1"],
        version_type: "release",
        loaders: ["fabric"],
        dependencies: [],
        files: [
          {
            hashes: { sha1: identity.sha1, sha512: identity.sha512 },
            url: download,
            filename: "example-1.1.0.jar",
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
    if (url === download) return new Response(bytes);
    throw new Error(`Unexpected request: ${url}`);
  };

  try {
    const outcome = await reconcileTarget(root, "mods", {
      interactive: false,
      action: "record",
    });

    assert.equal(outcome.action, "record");
    assert.deepEqual(outcome.paths, [previousPath, nextPath]);
    assert.deepEqual(
      (await readManifest(root)).manifest.files.map((file) => [file.path, file.downloads[0]]),
      [[nextPath, download]],
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("directory selection follows visible paths instead of hidden projection destinations", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "inlay-reconcile-visible-directory-"));
  await run("git", ["init", "-q"], { cwd: root });
  await writeFile(
    path.join(root, "inlay.index.json"),
    canonicalJson({
      $schema: MANIFEST_SCHEMA_URL,
      formatVersion: 1,
      game: "minecraft",
      versionId: "1.0.0",
      name: "Visible directory selection",
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
  await mkdir(path.join(root, "configureddefaults", "config"), { recursive: true });
  for (let index = 1; index <= 4; index += 1) {
    await writeFile(path.join(root, "configureddefaults", "config", `legacy-${index}.json`), "{}\n");
  }
  await mkdir(path.join(root, "config", "runtime"), { recursive: true });
  for (let index = 1; index <= 36; index += 1) {
    await writeFile(path.join(root, "config", "runtime", `${index}.json`), "{}\n");
  }

  const outcome = await reconcileTarget(root, "configureddefaults", {
    interactive: false,
    action: "add",
    dryRun: true,
  });

  assert.deepEqual(
    outcome.paths,
    Array.from({ length: 4 }, (_, index) => `configureddefaults/config/legacy-${index + 1}.json`),
  );
});
