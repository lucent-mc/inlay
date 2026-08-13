import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { MANIFEST_SCHEMA_URL } from "../src/constants.js";
import { hashes } from "../src/lib/hash.js";
import { canonicalJson } from "../src/lib/json.js";
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
