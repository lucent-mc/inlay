import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
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

  const { stdout: excludePath } = await run("git", ["rev-parse", "--git-path", "info/exclude"], {
    cwd: root,
  });
  const excludes = await readFile(path.resolve(root, excludePath.trim()), "utf8");
  for (const runtimePath of ["/logs/", "/crash-reports/", "/saves/", "/screenshots/", "/usercache.json"]) {
    assert.match(excludes, new RegExp(`^${runtimePath.replaceAll("/", "\\/")}$`, "m"));
  }
  for (const authorablePath of ["/mods/", "/config/", "/resourcepacks/", "/shaderpacks/"]) {
    assert.doesNotMatch(excludes, new RegExp(`^${authorablePath.replaceAll("/", "\\/")}$`, "m"));
  }
});
