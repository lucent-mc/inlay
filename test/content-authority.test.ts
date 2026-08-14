import assert from "node:assert/strict";
import { test } from "node:test";
import { MANIFEST_SCHEMA_URL } from "../src/constants.js";
import { remoteContentDeclaration } from "../src/lib/content-authority.js";
import { hashes } from "../src/lib/hash.js";
import type { LayerManifest } from "../src/types.js";

test("artifact loader and Minecraft metadata are advisory during reconciliation", async () => {
  const bytes = new TextEncoder().encode("cross-loader mod bytes");
  const identity = hashes(bytes);
  const manifest: LayerManifest = {
    $schema: MANIFEST_SCHEMA_URL,
    formatVersion: 1,
    game: "minecraft",
    versionId: "1.0.0",
    name: "Advisory compatibility",
    files: [],
    dependencies: { minecraft: "26.1.2", "neoforge-loader": "21.1.0" },
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes(`/version_file/${identity.sha512}`)) {
      return Response.json({
        id: "fabric-version",
        project_id: "fabric-project",
        name: "Fabric Mod",
        version_number: "1.0.0",
        game_versions: ["26.1.1"],
        version_type: "release",
        loaders: ["fabric"],
        dependencies: [],
        files: [
          {
            hashes: { sha1: identity.sha1, sha512: identity.sha512 },
            url: "https://cdn.modrinth.com/data/fabric-project/versions/fabric-version/fabric-mod.jar",
            filename: "fabric-mod.jar",
            primary: true,
            size: bytes.byteLength,
          },
        ],
      });
    }
    if (url.endsWith("/project/fabric-project")) {
      return Response.json({
        id: "fabric-project",
        slug: "fabric-mod",
        title: "Fabric Mod",
        project_type: "mod",
        license: { id: "MIT", name: "MIT", url: null },
        categories: ["fabric"],
        client_side: "required",
        server_side: "required",
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  try {
    const declaration = await remoteContentDeclaration("mods/fabric-mod.jar", bytes, manifest);
    assert.equal(
      declaration.downloads[0],
      "https://cdn.modrinth.com/data/fabric-project/versions/fabric-version/fabric-mod.jar",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
