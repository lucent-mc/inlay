import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { zipSync } from "fflate";
import {
  classifyDefaultConfigPath,
  detectDefaultConfigProviders,
  projectRuntimeConfig,
} from "../src/lib/default-configs.js";
import type { FileDeclaration } from "../src/types.js";

const identities = {
  "configured-defaults": ["SISoSFPP", "configureddefaults"],
  "config-manager": ["jlNms3Jp", "config_manager"],
  yosbr: ["WwbubTsV", "yosbr"],
  "default-options": ["WEg59z5b", "defaultoptions"],
} as const;

function modrinthFile(projectId: string, versionId = "immutable-version"): FileDeclaration {
  return {
    path: `mods/${projectId}.jar`,
    hashes: { sha1: "0".repeat(40), sha512: "0".repeat(128) },
    downloads: [`https://cdn.modrinth.com/data/${projectId}/versions/${versionId}/${projectId}.jar`],
    fileSize: 1,
  };
}

const projections = {
  "configured-defaults": "configureddefaults/config/example.json",
  "config-manager": "config/modpack_defaults/config/example.json",
  yosbr: "config/yosbr/config/example.json",
  "default-options": "config/defaultoptions/extra/config/example.json",
} as const;

const providerRoots = {
  "configured-defaults": "configureddefaults",
  "config-manager": "config/modpack_defaults",
  yosbr: "config/yosbr",
  "default-options": "config/defaultoptions",
} as const;

for (const [id, [projectId]] of Object.entries(identities)) {
  test(`detects ${id} from its resolved Modrinth identity and retains the version`, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), `inlay-${id}-`));
    await mkdir(path.join(root, providerRoots[id as keyof typeof providerRoots]), { recursive: true });

    const providers = await detectDefaultConfigProviders(root, [modrinthFile(projectId)]);
    const projection = await projectRuntimeConfig(root, "config/example.json", providers);

    assert.deepEqual(
      providers.map((provider) => [provider.id, provider.evidence]),
      [[id, { kind: "modrinth", projectId, versionId: "immutable-version" }]],
    );
    assert.equal(projection?.path, projections[id as keyof typeof projections]);
  });
}

test("requires both the provider directory and matching mod before projecting runtime config", async () => {
  const projectId = identities["configured-defaults"][0];

  const modOnlyRoot = await mkdtemp(path.join(os.tmpdir(), "inlay-defaults-mod-only-"));
  const modOnly = await detectDefaultConfigProviders(modOnlyRoot, [modrinthFile(projectId)]);
  assert.equal(await projectRuntimeConfig(modOnlyRoot, "config/example.json", modOnly), undefined);

  const directoryOnlyRoot = await mkdtemp(path.join(os.tmpdir(), "inlay-defaults-directory-only-"));
  await mkdir(path.join(directoryOnlyRoot, "configureddefaults"));
  const directoryOnly = await detectDefaultConfigProviders(directoryOnlyRoot, []);
  assert.equal(
    await projectRuntimeConfig(directoryOnlyRoot, "config/example.json", directoryOnly),
    undefined,
  );

  const pairedRoot = await mkdtemp(path.join(os.tmpdir(), "inlay-defaults-paired-"));
  await mkdir(path.join(pairedRoot, "configureddefaults"));
  const paired = await detectDefaultConfigProviders(pairedRoot, [modrinthFile(projectId)]);
  assert.equal(
    (await projectRuntimeConfig(pairedRoot, "config/example.json", paired))?.path,
    "configureddefaults/config/example.json",
  );
});

test("detects a provider from JAR mod metadata when no project identity is available", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "inlay-defaults-jar-"));
  await mkdir(path.join(root, "mods"));
  await mkdir(path.join(root, "config", "yosbr"), { recursive: true });
  await writeFile(
    path.join(root, "mods", "yosbr.jar"),
    zipSync({
      "fabric.mod.json": new TextEncoder().encode(
        JSON.stringify({ schemaVersion: 1, id: "yosbr", version: "0.1.2" }),
      ),
    }),
  );

  const providers = await detectDefaultConfigProviders(root, []);

  assert.deepEqual(
    providers.map((provider) => [provider.id, provider.evidence]),
    [["yosbr", { kind: "jar", modId: "yosbr", version: "0.1.2", path: "mods/yosbr.jar" }]],
  );
  assert.equal(
    (await projectRuntimeConfig(root, "config/example.json", providers))?.path,
    "config/yosbr/config/example.json",
  );
});

test("distinguishes a generated empty YOSBR skeleton from authored defaults", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "inlay-yosbr-skeleton-"));
  await mkdir(path.join(root, "config", "yosbr", "config"), { recursive: true });
  await writeFile(path.join(root, "config", "yosbr", "options.txt"), "");

  const providers = await detectDefaultConfigProviders(root, []);
  const projection = await projectRuntimeConfig(root, "config/example.json", providers);

  assert.deepEqual(
    providers.map((provider) => [provider.id, provider.evidence.kind, provider.authored]),
    [["yosbr", "convention", false]],
  );
  assert.equal(projection, undefined);
});

test("does not silently choose between multiple providers", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "inlay-defaults-ambiguous-"));
  await mkdir(path.join(root, "configureddefaults"));
  await mkdir(path.join(root, "config", "yosbr"), { recursive: true });
  const providers = await detectDefaultConfigProviders(root, [
    modrinthFile(identities["configured-defaults"][0]),
    modrinthFile(identities.yosbr[0]),
  ]);

  assert.equal(await projectRuntimeConfig(root, "config/example.json", providers), undefined);

  const selected = "config/yosbr/config/example.json";
  await mkdir(path.dirname(path.join(root, selected)), { recursive: true });
  await writeFile(path.join(root, selected), "{}\n");
  assert.equal((await projectRuntimeConfig(root, "config/example.json", providers))?.path, selected);
});

test("classifies provider control, generated, runtime-state, and specialized paths", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "inlay-defaults-paths-"));
  const providers = await detectDefaultConfigProviders(root, [
    modrinthFile(identities["configured-defaults"][0]),
    modrinthFile(identities["config-manager"][0]),
    modrinthFile(identities["default-options"][0]),
  ]);

  assert.equal(classifyDefaultConfigPath("configureddefaults/README.md", providers)?.kind, "generated");
  assert.deepEqual(classifyDefaultConfigPath("configureddefaults/options.txt", providers)?.application, {
    mode: "configured-options",
    versionDependent: true,
    merge: "missing-keys",
  });
  assert.deepEqual(classifyDefaultConfigPath("config/CONFIG_MANAGER_UPDATE_FLAG", providers)?.application, {
    mode: "config-manager-control",
    action: "update",
    overwritesExisting: true,
    deletesRuntimeConfig: false,
  });
  assert.deepEqual(classifyDefaultConfigPath("config/CONFIG_MANAGER_RESET_FLAG", providers)?.application, {
    mode: "config-manager-control",
    action: "reset",
    overwritesExisting: true,
    deletesRuntimeConfig: true,
  });
  assert.equal(classifyDefaultConfigPath("defaultoptions.journal.json", providers)?.kind, "runtime-state");
  assert.equal(
    classifyDefaultConfigPath("config/defaultoptions/options.txt", providers)?.kind,
    "specialized",
  );
  assert.deepEqual(
    classifyDefaultConfigPath("config/defaultoptions/keybindings.txt", providers)?.application,
    { mode: "default-options-handler", handler: "keybindings" },
  );
  assert.deepEqual(classifyDefaultConfigPath("config/defaultoptions-common.toml", providers)?.application, {
    mode: "default-options-handler",
    handler: "provider-config",
  });
  assert.equal(
    classifyDefaultConfigPath("config/defaultoptions/extra/config/example.json", providers)?.kind,
    "mirror",
  );
});

test("Config Manager flags remain direct config files instead of defaults projections", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "inlay-config-manager-flags-"));
  const providers = await detectDefaultConfigProviders(root, [modrinthFile(identities["config-manager"][0])]);

  assert.equal(await projectRuntimeConfig(root, "config/CONFIG_MANAGER_UPDATE_FLAG", providers), undefined);
  assert.equal(await projectRuntimeConfig(root, "config/CONFIG_MANAGER_RESET_FLAG", providers), undefined);
});
