import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { MANIFEST_SCHEMA_URL } from "../src/constants.js";
import { canonicalJson } from "../src/lib/json.js";
import { readManifest } from "../src/manifest/index.js";
import { reconcilePath } from "../src/operations/reconcile.js";

const run = promisify(execFile);

test("reconcile adopts runtime config bytes through the defaults tree", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "inlay-reconcile-defaults-"));
  await run("git", ["init", "-q"], { cwd: root });
  await writeFile(
    path.join(root, "inlay.index.json"),
    canonicalJson({
      $schema: MANIFEST_SCHEMA_URL,
      formatVersion: 1,
      game: "minecraft",
      versionId: "1.0.0",
      name: "Defaults",
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
  const runtime = '{"enabled":true}\n';
  await writeFile(path.join(root, "config", "example", "settings.json"), runtime);
  const target = "configureddefaults/config/example/settings.json";

  const outcome = await reconcilePath(root, "config/example/settings.json", {
    interactive: false,
    action: "add",
  });

  assert.deepEqual(outcome.staged, ["inlay.index.json", target]);
  assert.equal(await readFile(path.join(root, target), "utf8"), runtime);
  const { manifest } = await readManifest(root);
  assert.deepEqual(manifest.files.at(-1), {
    path: target,
    hashes: manifest.files.at(-1)?.hashes,
    downloads: [`./${target}`],
    fileSize: runtime.length,
  });
  const { stdout: staged } = await run("git", ["diff", "--cached", "--name-only"], { cwd: root });
  assert.deepEqual(staged.trim().split(/\r?\n/u), [target, "inlay.index.json"]);
});
