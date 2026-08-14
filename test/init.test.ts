import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
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
    "/data/fabric_default_resource_packs.json",
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

test("init locally excludes downloaded content roots without a repository gitignore", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "inlay-init-local-content-excludes-"));
  await run("git", ["init", "-q"], { cwd: root });

  await initialize(root, {
    name: "Local Content Excludes",
    minecraft: "1.21.1",
    interactive: false,
  });

  const contentPaths = [
    "datapacks/example.zip",
    "mods/example.jar",
    "plugins/example.jar",
    "resourcepacks/example.zip",
    "shaderpacks/example.zip",
    "texturepacks/example.zip",
  ];
  for (const candidate of contentPaths) {
    await mkdir(path.join(root, path.dirname(candidate)), { recursive: true });
    await writeFile(path.join(root, candidate), "downloaded content");
  }

  const { stdout } = await run("git", ["check-ignore", "--verbose", "--", ...contentPaths], {
    cwd: root,
  });
  for (const candidate of contentPaths) {
    assert.match(stdout, new RegExp(`info/exclude.*${candidate.replaceAll("/", "\\/")}`, "u"));
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

test("init detects the runtime target from ATLauncher instance metadata", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "inlay-init-atlauncher-"));
  await writeFile(
    path.join(root, "instance.json"),
    canonicalJson({
      id: "1.21.1",
      launcher: {
        name: "Detected ATLauncher Instance",
        vanillaInstance: true,
        loaderVersion: {
          type: "Fabric",
          version: "0.16.14",
        },
      },
    }),
  );

  const manifest = await initialize(root, { interactive: false });

  assert.equal(manifest.name, "Detected ATLauncher Instance");
  assert.deepEqual(manifest.dependencies, {
    minecraft: "1.21.1",
    "fabric-loader": "0.16.14",
  });
});

test("init detects legacy Modrinth profile metadata", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "inlay-init-modrinth-profile-"));
  await writeFile(
    path.join(root, "profile.json"),
    canonicalJson({
      path: "detected-profile",
      metadata: {
        name: "Detected Modrinth Instance",
        game_version: "1.20.1",
        loader: "quilt",
        loader_version: { id: "0.28.1" },
      },
    }),
  );

  const manifest = await initialize(root, { interactive: false });

  assert.equal(manifest.name, "Detected Modrinth Instance");
  assert.deepEqual(manifest.dependencies, {
    minecraft: "1.20.1",
    "quilt-loader": "0.28.1",
  });
});

test("init detects root-level legacy Modrinth profile metadata", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "inlay-init-modrinth-root-profile-"));
  await writeFile(
    path.join(root, "profile.json"),
    canonicalJson({
      path: "detected-profile",
      name: "Root-level Modrinth Instance",
      game_version: "1.20.1",
      mod_loader: "forge",
      mod_loader_version: "47.3.0",
    }),
  );

  const manifest = await initialize(root, { interactive: false });

  assert.equal(manifest.name, "Root-level Modrinth Instance");
  assert.deepEqual(manifest.dependencies, {
    minecraft: "1.20.1",
    forge: "47.3.0",
  });
});

test("init detects current Modrinth metadata from its app database", async () => {
  const settings = await mkdtemp(path.join(os.tmpdir(), "inlay-init-modrinth-db-"));
  const root = path.join(settings, "profiles", "detected-instance");
  await mkdir(root, { recursive: true });
  const database = new DatabaseSync(path.join(settings, "app.db"));
  database.exec(`
    CREATE TABLE settings (custom_dir TEXT NULL);
    INSERT INTO settings (custom_dir) VALUES (NULL);
    CREATE TABLE instances (
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL,
      applied_content_set_id TEXT NULL,
      name TEXT NOT NULL
    );
    CREATE TABLE instance_content_sets (
      id TEXT PRIMARY KEY,
      instance_id TEXT NOT NULL,
      game_version TEXT NOT NULL,
      loader TEXT NOT NULL,
      loader_version TEXT NULL
    );
    INSERT INTO instances (id, path, applied_content_set_id, name)
      VALUES ('instance-id', 'detected-instance', 'content-id', 'Database Instance');
    INSERT INTO instance_content_sets (
      id, instance_id, game_version, loader, loader_version
    ) VALUES ('content-id', 'instance-id', '1.21.5', 'neoforge', '21.5.75');
  `);
  database.close();

  const manifest = await initialize(root, { interactive: false });

  assert.equal(manifest.name, "Database Instance");
  assert.deepEqual(manifest.dependencies, {
    minecraft: "1.21.5",
    neoforge: "21.5.75",
  });
});

test("init detects Prism-family metadata beside the playable directory", async () => {
  const instance = await mkdtemp(path.join(os.tmpdir(), "inlay-init-prism-"));
  const root = path.join(instance, ".minecraft");
  await mkdir(root);
  await writeFile(
    path.join(instance, "mmc-pack.json"),
    canonicalJson({
      formatVersion: 1,
      components: [
        { uid: "net.minecraft", version: "1.21.1" },
        { uid: "net.fabricmc.fabric-loader", version: "0.16.14" },
        { uid: "net.minecraftforge", version: "52.0.28", disabled: true },
      ],
    }),
  );
  await writeFile(path.join(instance, "instance.cfg"), "name=Detected Prism Instance\n");

  const manifest = await initialize(root, { interactive: false });

  assert.equal(manifest.name, "Detected Prism Instance");
  assert.deepEqual(manifest.dependencies, {
    minecraft: "1.21.1",
    "fabric-loader": "0.16.14",
  });
});

test("init refuses multiple active Prism-family loaders", async () => {
  const instance = await mkdtemp(path.join(os.tmpdir(), "inlay-init-prism-conflict-"));
  const root = path.join(instance, ".minecraft");
  await mkdir(root);
  await writeFile(
    path.join(instance, "mmc-pack.json"),
    canonicalJson({
      formatVersion: 1,
      components: [
        { uid: "net.minecraft", version: "1.21.1" },
        { uid: "net.fabricmc.fabric-loader", version: "0.16.14" },
        { uid: "net.minecraftforge", version: "52.0.28" },
      ],
    }),
  );

  await assert.rejects(
    initialize(root, { name: "Conflict", interactive: false }),
    /multiple configured loaders/u,
  );
});

test("init detects GDLauncher Carbon metadata beside the playable directory", async () => {
  const instance = await mkdtemp(path.join(os.tmpdir(), "inlay-init-gdlauncher-"));
  const root = path.join(instance, "instance");
  await mkdir(root);
  await writeFile(
    path.join(instance, "instance.json"),
    canonicalJson({
      _version: "1",
      name: "Detected GDLauncher Instance",
      game_configuration: {
        version: {
          release: "1.21.4",
          modloaders: [{ type: "Neoforge", version: "21.4.100" }],
        },
      },
    }),
  );

  const manifest = await initialize(root, { interactive: false });

  assert.equal(manifest.name, "Detected GDLauncher Instance");
  assert.deepEqual(manifest.dependencies, {
    minecraft: "1.21.4",
    neoforge: "21.4.100",
  });
});

test("init rejects conflicting implicit targets and accepts a complete explicit override", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "inlay-init-target-conflict-"));
  await writeFile(
    path.join(root, "instance.json"),
    canonicalJson({
      id: "1.21.1",
      launcher: {
        name: "ATLauncher Instance",
        vanillaInstance: true,
        loaderVersion: { type: "Fabric", version: "0.16.14" },
      },
    }),
  );
  await writeFile(
    path.join(root, "modrinth.index.json"),
    canonicalJson({
      name: "Imported Pack",
      versionId: "1.0.0",
      files: [],
      dependencies: { minecraft: "1.20.1", forge: "47.3.0" },
    }),
  );

  await assert.rejects(
    initialize(root, { interactive: false }),
    /modrinth\.index\.json declares Minecraft 1\.20\.1/u,
  );

  const manifest = await initialize(root, {
    minecraft: "1.21.4",
    loader: "neoforge",
    loaderVersion: "21.4.100",
    interactive: false,
  });
  assert.deepEqual(manifest.dependencies, {
    minecraft: "1.21.4",
    neoforge: "21.4.100",
  });
});

test("init requires an explicit mapping for unknown launcher loader types", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "inlay-init-unknown-loader-"));
  await writeFile(
    path.join(root, "instance.json"),
    canonicalJson({
      id: "1.22",
      launcher: {
        name: "Future Loader Instance",
        loaderVersion: { type: "FutureLoader", version: "3.0.0" },
      },
    }),
  );

  await assert.rejects(initialize(root, { interactive: false }), /unsupported loader type FutureLoader/u);

  const manifest = await initialize(root, {
    loader: "future-loader",
    loaderVersion: "3.0.0",
    interactive: false,
  });
  assert.equal(manifest.name, "Future Loader Instance");
  assert.deepEqual(manifest.dependencies, {
    minecraft: "1.22",
    "future-loader": "3.0.0",
  });
});

test("init lets explicit fields resolve conflicting launcher metadata", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "inlay-init-launcher-conflict-"));
  await writeFile(
    path.join(root, "instance.json"),
    canonicalJson({
      id: "1.21.1",
      launcher: {
        name: "ATLauncher Copy",
        loaderVersion: { type: "Fabric", version: "0.16.14" },
      },
    }),
  );
  await writeFile(
    path.join(root, "profile.json"),
    canonicalJson({
      metadata: {
        name: "Modrinth Copy",
        game_version: "1.20.1",
        loader: "forge",
        loader_version: { id: "47.3.0" },
      },
    }),
  );

  await assert.rejects(
    initialize(root, { name: "Chosen Instance", interactive: false }),
    /declare different Minecraft versions/u,
  );

  const manifest = await initialize(root, {
    name: "Chosen Instance",
    minecraft: "1.21.4",
    loader: "neoforge",
    loaderVersion: "21.4.100",
    interactive: false,
  });
  assert.equal(manifest.name, "Chosen Instance");
  assert.deepEqual(manifest.dependencies, {
    minecraft: "1.21.4",
    neoforge: "21.4.100",
  });
});

test("init lets explicit fields replace incomplete launcher metadata", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "inlay-init-incomplete-launcher-"));
  await writeFile(
    path.join(root, "instance.json"),
    canonicalJson({
      launcher: {
        name: "Incomplete Instance",
        loaderVersion: { type: "Fabric" },
      },
    }),
  );

  const manifest = await initialize(root, {
    minecraft: "1.21.4",
    loader: "fabric-loader",
    loaderVersion: "0.16.14",
    interactive: false,
  });
  assert.equal(manifest.name, "Incomplete Instance");
  assert.deepEqual(manifest.dependencies, {
    minecraft: "1.21.4",
    "fabric-loader": "0.16.14",
  });
});

test("init ignores malformed files whose launcher ownership is ambiguous", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "inlay-init-unrelated-metadata-"));
  await writeFile(path.join(root, "instance.json"), "not launcher json");
  await writeFile(path.join(root, "profile.json"), "also not launcher json");

  const manifest = await initialize(root, {
    name: "Explicit Instance",
    minecraft: "1.21.1",
    loader: "fabric-loader",
    loaderVersion: "0.16.14",
    interactive: false,
  });

  assert.deepEqual(manifest.dependencies, {
    minecraft: "1.21.1",
    "fabric-loader": "0.16.14",
  });
});

test("init combines complementary partial launcher evidence", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "inlay-init-complementary-launchers-"));
  await writeFile(
    path.join(root, "instance.json"),
    canonicalJson({
      launcher: {
        name: "Complementary Instance",
        loaderVersion: { type: "Fabric" },
      },
    }),
  );
  await writeFile(
    path.join(root, "profile.json"),
    canonicalJson({
      metadata: {
        game_version: "1.21.1",
        loader: "fabric",
        loader_version: { id: "0.16.14" },
      },
    }),
  );

  const manifest = await initialize(root, { interactive: false });
  assert.equal(manifest.name, "Complementary Instance");
  assert.deepEqual(manifest.dependencies, {
    minecraft: "1.21.1",
    "fabric-loader": "0.16.14",
  });
});

test("init does not confuse explicit vanilla metadata with missing loader evidence", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "inlay-init-vanilla-conflict-"));
  await writeFile(
    path.join(root, "instance.json"),
    canonicalJson({
      id: "1.21.1",
      launcher: {
        name: "Conflicting Instance",
        vanillaInstance: true,
      },
    }),
  );
  await writeFile(
    path.join(root, "profile.json"),
    canonicalJson({
      metadata: {
        name: "Conflicting Instance",
        game_version: "1.21.1",
        loader: "fabric",
        loader_version: { id: "0.16.14" },
      },
    }),
  );

  await assert.rejects(initialize(root, { interactive: false }), /declare different loaders/u);
});
