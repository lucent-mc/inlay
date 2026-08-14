import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { MANIFEST_SCHEMA_URL } from "../src/constants.js";
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
