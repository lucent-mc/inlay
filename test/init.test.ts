import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { canonicalJson } from "../src/lib/json.js";
import { initialize } from "../src/operations/init.js";

const run = promisify(execFile);

test("init force-stages the manifest when the instance ignores all files", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "inlay-init-ignored-"));
  await run("git", ["init", "-q"], { cwd: root });
  await writeFile(path.join(root, ".gitignore"), "**/*\n");

  await initialize(root, {
    name: "Ignored Instance",
    minecraft: "1.21.1",
    interactive: false,
  });

  const { stdout } = await run("git", ["ls-files", "--", "inlay.index.json"], { cwd: root });
  assert.equal(stdout.trim(), "inlay.index.json");
  const { stdout: layIgnore } = await run("git", ["ls-files", "--", ".layignore"], { cwd: root });
  assert.equal(layIgnore.trim(), ".layignore");

  const { stdout: excludePath } = await run("git", ["rev-parse", "--git-path", "info/exclude"], {
    cwd: root,
  });
  const excludes = await readFile(path.resolve(root, excludePath.trim()), "utf8");
  for (const runtimePath of [
    "/datapacks/",
    "/logs/",
    "/crash-reports/",
    "/mods/",
    "/resourcepacks/",
    "/saves/",
    "/screenshots/",
    "/shaderpacks/",
    "/usercache.json",
  ]) {
    assert.match(excludes, new RegExp(`^${runtimePath.replaceAll("/", "\\/")}$`, "m"));
  }
  for (const authorablePath of ["/config/", "/configureddefaults/", "/defaultconfigs/"]) {
    assert.doesNotMatch(excludes, new RegExp(`^${authorablePath.replaceAll("/", "\\/")}$`, "m"));
  }
});

test("init imports and locally excludes managed downloads from an existing Modrinth instance", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "inlay-init-modrinth-"));
  await run("git", ["init", "-q"], { cwd: root });
  await writeFile(
    path.join(root, "modrinth.index.json"),
    canonicalJson({
      formatVersion: 1,
      game: "minecraft",
      versionId: "1.0.0",
      name: "Imported Instance",
      files: [
        {
          path: "mods/example.jar",
          hashes: {
            sha1: "0000000000000000000000000000000000000000",
            sha512:
              "00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
          },
          downloads: ["https://cdn.modrinth.com/data/example/versions/1/example.jar"],
          fileSize: 3,
        },
      ],
      dependencies: { minecraft: "1.21.1", "fabric-loader": "0.16.14" },
    }),
  );
  await mkdir(path.join(root, "mods"));
  await writeFile(path.join(root, "mods", "example.jar"), "jar");

  const manifest = await initialize(root, { interactive: false });

  assert.equal(manifest.files.length, 1);
  assert.equal(manifest.files[0]?.path, "mods/example.jar");
  const { stdout } = await run("git", ["check-ignore", "--verbose", "--", "mods/example.jar"], {
    cwd: root,
  });
  assert.match(stdout, /info\/exclude.*mods\/example\.jar/u);
});
