import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ModrinthAdapter,
  type ModrinthDependency,
  type ModrinthProject,
  type ModrinthVersion,
} from "../src/adapters/modrinth.js";
import { MANIFEST_SCHEMA_URL } from "../src/constants.js";
import { deriveInventory } from "../src/inventory.js";
import { activeDependencyAdapters, resolveDependencyClaim } from "../src/lib/dependency-adapters.js";
import type { LayerIdentity, ResolvedContent, ResolvedPack } from "../src/types.js";

const ids = {
  languageReload: "uLbm7CG6",
  fabricApi: "P7dR8mSH",
  connector: "u58R1TMW",
  forgifiedFabricApi: "Aqlf1Shp",
  connectorExtras: "FYpiwiBR",
} as const;

const owner: LayerIdentity = {
  name: "Inventory",
  versionId: "1.0.0",
  source: "local",
  imported: false,
};

function project(id: string, title: string): ModrinthProject {
  return {
    id,
    slug: title.toLocaleLowerCase("en-US").replaceAll(" ", "-"),
    title,
    project_type: "mod",
    license: { id: "MIT", name: "MIT", url: null },
    categories: [],
    client_side: "required",
    server_side: "required",
  };
}

function version(projectId: string, dependencies: ModrinthDependency[] = []): ModrinthVersion {
  return {
    id: `${projectId}-version`,
    project_id: projectId,
    name: `${projectId} version`,
    version_number: "1.0.0",
    game_versions: ["26.1.2"],
    version_type: "release",
    loaders: ["fabric"],
    dependencies,
    files: [],
  };
}

class FakeModrinthAdapter extends ModrinthAdapter {
  constructor(
    private readonly projects: Map<string, ModrinthProject>,
    private readonly releases: Map<string, ModrinthVersion>,
  ) {
    super("https://modrinth.invalid");
  }

  override project(id: string): Promise<ModrinthProject> {
    const found = this.projects.get(id);
    if (!found) throw new Error(`Missing fake project ${id}`);
    return Promise.resolve(found);
  }

  override version(id: string): Promise<ModrinthVersion> {
    const found = this.releases.get(id);
    if (!found) throw new Error(`Missing fake version ${id}`);
    return Promise.resolve(found);
  }
}

function content(projectId: string, filename: string): ResolvedContent {
  const versionId = `${projectId}-version`;
  const downloads = [`https://cdn.modrinth.com/data/${projectId}/versions/${versionId}/${filename}`];
  const hashes = { sha1: "0".repeat(40), sha512: "0".repeat(128) };
  return {
    path: `mods/${filename}`,
    scope: "common",
    env: { client: "required", server: "required" },
    owner,
    declaration: { path: `mods/${filename}`, hashes, downloads, fileSize: 1 },
    payload: { kind: "remote", hashes, downloads, fileSize: 1 },
    replacementHistory: [],
  };
}

function pack(contents: ResolvedContent[]): ResolvedPack {
  return {
    manifest: {
      $schema: MANIFEST_SCHEMA_URL,
      formatVersion: 1,
      game: "minecraft",
      versionId: "1.0.0",
      name: "Inventory",
      files: contents.map((item) => item.declaration),
      dependencies: { minecraft: "26.1.2", "neoforge-loader": "21.1.0" },
    },
    lineage: [owner],
    dependencies: { minecraft: "26.1.2", "neoforge-loader": "21.1.0" },
    slots: new Map(contents.map((item) => [`${item.path}\0client`, item])),
    warnings: [],
  };
}

const fabricApiDependency: ModrinthDependency = {
  version_id: null,
  project_id: ids.fabricApi,
  file_name: null,
  dependency_type: "required",
};

const connectorIncompatibility: ModrinthDependency = {
  version_id: null,
  project_id: ids.connector,
  file_name: null,
  dependency_type: "incompatible",
};

function adapterFor(
  projectIds: string[],
  languageDependencies: ModrinthDependency[] = [fabricApiDependency],
): FakeModrinthAdapter {
  const titles = new Map<string, string>([
    [ids.languageReload, "Language Reload"],
    [ids.connector, "Sinytra Connector"],
    [ids.forgifiedFabricApi, "Forgified Fabric API"],
    [ids.connectorExtras, "Connector Extras"],
  ]);
  return new FakeModrinthAdapter(
    new Map(projectIds.map((id) => [id, project(id, titles.get(id) ?? id)])),
    new Map(
      projectIds.map((id) => [
        `${id}-version`,
        version(id, id === ids.languageReload ? languageDependencies : []),
      ]),
    ),
  );
}

test("provider dependency claims are warnings rather than validation failures", async () => {
  const contents = [
    content(ids.languageReload, "language-reload.jar"),
    content(ids.connector, "connector.jar"),
  ];
  const inventory = await deriveInventory(
    pack(contents),
    new Map(),
    adapterFor([ids.languageReload, ids.connector], [fabricApiDependency, connectorIncompatibility]),
  );

  assert.deepEqual(
    inventory.diagnostics.map((item) => [item.code, item.severity]),
    [
      ["dependency-missing", "warning"],
      ["dependency-incompatible", "warning"],
    ],
  );
});

test("Sinytra Connector and FFAPI satisfy Fabric API with Connector Extras present", async () => {
  const projectIds = [ids.languageReload, ids.connector, ids.forgifiedFabricApi, ids.connectorExtras];
  const inventory = await deriveInventory(
    pack([
      content(ids.languageReload, "language-reload.jar"),
      content(ids.connector, "connector.jar"),
      content(ids.forgifiedFabricApi, "forgified-fabric-api.jar"),
      content(ids.connectorExtras, "connector-extras.jar"),
    ]),
    new Map(),
    adapterFor(projectIds),
  );

  assert.equal(
    inventory.diagnostics.some((item) => item.code === "dependency-missing"),
    false,
  );
  assert.equal(resolveDependencyClaim(ids.fabricApi, new Set([ids.forgifiedFabricApi])).kind, "missing");
  assert.deepEqual(
    activeDependencyAdapters(new Set([ids.connector, ids.forgifiedFabricApi, ids.connectorExtras])),
    [
      {
        id: "sinytra-connector",
        name: "Sinytra Connector",
        projects: [ids.connector, ids.forgifiedFabricApi],
        extensions: [ids.connectorExtras],
      },
    ],
  );
});
