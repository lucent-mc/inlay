import assert from "node:assert/strict";
import { test } from "node:test";
import { zipSync } from "fflate";
import { hashes } from "../src/lib/hash.js";
import { importMrpack } from "../src/resolution/import-mrpack.js";

test("mrpack overrides become common/client/server environment slots", () => {
  const index = new TextEncoder().encode(
    JSON.stringify({
      formatVersion: 1,
      game: "minecraft",
      versionId: "1.0.0",
      name: "Imported",
      files: [],
      dependencies: { minecraft: "1.21.1" },
    }),
  );
  const archive = zipSync({
    "modrinth.index.json": index,
    "overrides/config/common.json": new Uint8Array([1]),
    "client-overrides/config/client.json": new Uint8Array([2]),
    "server-overrides/config/server.json": new Uint8Array([3]),
  });
  const imported = importMrpack(archive, "https://example.com/base.mrpack", hashes(archive).sha256);
  assert.deepEqual(
    imported.content.map((item) => [item.path, item.scope]),
    [
      ["config/client.json", "client"],
      ["config/common.json", "common"],
      ["config/server.json", "server"],
    ],
  );
});
