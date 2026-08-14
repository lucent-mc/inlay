import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { TOOLKIT_VERSION } from "../src/constants.js";

test("toolkit version matches the published package version", async () => {
  const packageJson = JSON.parse(await readFile(path.join(process.cwd(), "package.json"), "utf8")) as {
    version: string;
  };

  assert.equal(TOOLKIT_VERSION, packageJson.version);
});
