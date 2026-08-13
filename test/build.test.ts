import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { unzipSync } from "fflate";
import { buildPack } from "../src/build/build.js";
import { MANIFEST_SCHEMA_URL } from "../src/constants.js";
import { hashes } from "../src/lib/hash.js";
import { canonicalJson } from "../src/lib/json.js";

const run = promisify(execFile);

async function git(root: string, ...args: string[]) {
  await run("git", args, { cwd: root });
}

test("clean builds are byte-for-byte deterministic and contain only Modrinth output authority", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "inlay-build-"));
  const output = await mkdtemp(path.join(os.tmpdir(), "inlay-output-"));
  const payload = new TextEncoder().encode('{"quality":"lucent"}\n');
  await writeFile(path.join(root, "sodium-options.json"), payload);
  const identity = hashes(payload);
  await writeFile(
    path.join(root, "inlay.index.json"),
    canonicalJson({
      $schema: MANIFEST_SCHEMA_URL,
      formatVersion: 1,
      game: "minecraft",
      versionId: "1.0.0",
      name: "Deterministic Pack",
      files: [
        {
          path: "config/sodium-options.json",
          hashes: { sha1: identity.sha1, sha256: identity.sha256 },
          downloads: ["./sodium-options.json"],
          fileSize: payload.byteLength,
        },
      ],
      dependencies: { minecraft: "1.21.1", "fabric-loader": "0.16.14" },
    }),
  );
  await git(root, "init", "-q");
  await git(root, "config", "user.email", "test@inlay.invalid");
  await git(root, "config", "user.name", "Inlay Test");
  await git(root, "add", ".");
  await git(root, "commit", "-qm", "fixture");

  const first = await buildPack(root, { outputDirectory: output });
  const firstBytes = await readFile(first.artifactPath);
  const second = await buildPack(root, { outputDirectory: output });
  const secondBytes = await readFile(second.artifactPath);
  assert.deepEqual(firstBytes, secondBytes);
  assert.equal(first.record.preview, false);
  assert.equal(first.record.artifact.sha256, second.record.artifact.sha256);

  const archive = unzipSync(firstBytes);
  assert.deepEqual(Object.keys(archive).sort(), [
    "modrinth.index.json",
    "overrides/config/sodium-options.json",
  ]);
  const index = JSON.parse(new TextDecoder().decode(archive["modrinth.index.json"])) as Record<
    string,
    unknown
  >;
  assert.equal("extends" in index, false);
  assert.equal("delivery" in index, false);
  assert.deepEqual(index["files"], []);
});
