import assert from "node:assert/strict";
import { test } from "node:test";
import { MANIFEST_SCHEMA_URL } from "../src/constants.js";
import { InlayError } from "../src/diagnostics.js";
import { composeLayers } from "../src/resolution/compose.js";
import type { FileDeclaration, LayerManifest, ResolvableLayer } from "../src/types.js";

const runtime = { minecraft: "1.21.1", "fabric-loader": "0.16.14" };

function layer(
  name: string,
  files: FileDeclaration[],
  exclusions: LayerManifest["exclusions"] = [],
): ResolvableLayer {
  const manifest: LayerManifest = {
    $schema: MANIFEST_SCHEMA_URL,
    formatVersion: 1,
    game: "minecraft",
    versionId: "1.0.0",
    name,
    files,
    dependencies: { ...runtime },
    ...(exclusions.length > 0 ? { exclusions } : {}),
  };
  return {
    manifest,
    source: { kind: "local", label: name },
    identity: { name, versionId: "1.0.0", source: name, imported: false },
    content: files.map((declaration) => ({
      path: declaration.path,
      scope: "common",
      env: declaration.env ?? { client: "required", server: "required" },
      declaration,
      payload: {
        kind: "remote",
        downloads: declaration.downloads,
        hashes: declaration.hashes as { sha1: string; sha512: string },
        fileSize: declaration.fileSize,
      },
    })),
  };
}

function remote(path: string, identity: string): FileDeclaration {
  return {
    path,
    hashes: { sha1: identity.repeat(40).slice(0, 40), sha512: identity.repeat(128).slice(0, 128) },
    downloads: [`https://cdn.modrinth.com/${identity}`],
    fileSize: 1,
  };
}

test("child files implicitly override one path without replacing the inventory", () => {
  const resolved = composeLayers([
    layer("base", [remote("mods/a.jar", "a"), remote("mods/b.jar", "b")]),
    layer("child", [remote("mods/a.jar", "c")]),
  ]);
  assert.equal(resolved.slots.size, 4);
  assert.equal(resolved.slots.get("mods/a.jar\0client")?.owner.name, "child");
  assert.equal(resolved.slots.get("mods/b.jar\0server")?.owner.name, "base");
});

test("directory exclusions apply to the pinned parent before child additions", () => {
  const resolved = composeLayers([
    layer("base", [remote("config/a.json", "a"), remote("config/nested/b.json", "b")]),
    layer("child", [remote("config/a.json", "c")], [{ path: "config", recursive: true }]),
  ]);
  assert.equal(resolved.slots.size, 2);
  assert.equal(resolved.slots.get("config/a.json\0client")?.owner.name, "child");
  assert.equal(resolved.slots.has("config/nested/b.json\0client"), false);
});

test("client and server slots compose independently", () => {
  const base = remote("config/a.json", "a");
  base.env = { client: "required", server: "unsupported" };
  const server = remote("config/a.json", "b");
  server.env = { client: "unsupported", server: "required" };
  const resolved = composeLayers([layer("base", [base]), layer("child", [server])]);
  assert.equal(resolved.slots.get("config/a.json\0client")?.owner.name, "base");
  assert.equal(resolved.slots.get("config/a.json\0server")?.owner.name, "child");
});

test("runtime target mismatch blocks composition", () => {
  const child = layer("child", []);
  child.manifest.dependencies["minecraft"] = "1.20.1";
  assert.throws(() => composeLayers([layer("base", []), child]), InlayError);
});

test("file/directory structural collisions block composition", () => {
  assert.throws(
    () =>
      composeLayers([layer("base", [remote("config/a", "a")]), layer("child", [remote("config/a/b", "b")])]),
    InlayError,
  );
});
