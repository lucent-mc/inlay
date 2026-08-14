import assert from "node:assert/strict";
import { test } from "node:test";
import { MANIFEST_SCHEMA_URL } from "../src/constants.js";
import { InlayError } from "../src/diagnostics.js";
import { validateManifest } from "../src/manifest/index.js";

function rootManifest() {
  return {
    $schema: MANIFEST_SCHEMA_URL,
    formatVersion: 1,
    game: "minecraft",
    versionId: "1.2.3",
    name: "Test Layer",
    files: [],
    dependencies: { minecraft: "1.21.1", "fabric-loader": "0.16.14" },
  };
}

test("the strict Modrinth superset accepts a native root", async () => {
  const validated = await validateManifest(rootManifest());
  assert.equal(validated.manifest.versionId, "1.2.3");
});

test("unknown top-level authority is rejected", async () => {
  await assert.rejects(() => validateManifest({ ...rootManifest(), includes: [] }), InlayError);
});

test("repository-backed files require sha1, sha256, size, and a safe relative source", async () => {
  const manifest = rootManifest();
  await assert.rejects(
    () =>
      validateManifest({
        ...manifest,
        files: [
          {
            path: "config/example.json",
            hashes: { sha1: "0".repeat(40) },
            downloads: ["./config/example.json"],
            fileSize: 1,
          },
        ],
      }),
    InlayError,
  );
});

test("repository-backed declarations are limited to configuration content", async () => {
  await assert.rejects(
    () =>
      validateManifest({
        ...rootManifest(),
        files: [
          {
            path: "mods/example.jar",
            hashes: { sha1: "0".repeat(40), sha256: "0".repeat(64) },
            downloads: ["./mods/example.jar"],
            fileSize: 1,
          },
        ],
      }),
    /Only configuration content may be repository-backed/u,
  );
});

test("mirrored defaults stores cannot disguise packaged content as configuration", async () => {
  await assert.rejects(
    () =>
      validateManifest({
        ...rootManifest(),
        files: [
          {
            path: "configureddefaults/resourcepacks/example.zip",
            hashes: { sha1: "0".repeat(40), sha256: "0".repeat(64) },
            downloads: ["./configureddefaults/resourcepacks/example.zip"],
            fileSize: 1,
          },
        ],
      }),
    /Only configuration content may be repository-backed/u,
  );
});

test("parent locks contain immutable integrity metadata", async () => {
  await assert.rejects(
    () => validateManifest({ ...rootManifest(), extends: { url: "https://github.com/lucent-mc/base" } }),
    InlayError,
  );
});
