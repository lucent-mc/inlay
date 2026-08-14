import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import * as p from "@clack/prompts";
import { GitAdapter } from "../adapters/git.js";
import {
  DEFAULT_LAYIGNORE,
  LAYIGNORE_FILENAME,
  MANIFEST_FILENAME,
  MANIFEST_SCHEMA_URL,
} from "../constants.js";
import { error, InlayError } from "../diagnostics.js";
import { isRepositoryFile, writeManifest } from "../manifest/index.js";
import type { LayerManifest } from "../types.js";
import { updateGeneratedExcludes } from "./git-excludes.js";

interface InitOptions {
  name?: string;
  version?: string;
  minecraft?: string;
  loader?: string;
  loaderVersion?: string;
  interactive: boolean;
  dryRun?: boolean;
}

async function existingModrinth(root: string): Promise<Partial<LayerManifest> | undefined> {
  try {
    return JSON.parse(
      await readFile(path.join(root, "modrinth.index.json"), "utf8"),
    ) as Partial<LayerManifest>;
  } catch {
    return undefined;
  }
}

async function requiredValue(
  label: string,
  value: string | undefined,
  interactive: boolean,
): Promise<string> {
  if (value) return value;
  if (!interactive)
    throw new InlayError(error("input-required", `${label} is required in non-interactive mode.`), 2);
  const answer = await p.text({
    message: label,
    validate: (input) => (input?.trim() ? undefined : `${label} is required.`),
  });
  if (p.isCancel(answer)) throw new InlayError(error("cancelled", "Initialization cancelled."));
  return String(answer).trim();
}

export async function initialize(root: string, options: InitOptions): Promise<LayerManifest> {
  try {
    await access(path.join(root, MANIFEST_FILENAME));
    throw new InlayError(error("already-initialized", `${MANIFEST_FILENAME} already exists.`));
  } catch (cause) {
    if (cause instanceof InlayError) throw cause;
  }
  const imported = await existingModrinth(root);
  const dependencies = imported?.dependencies ?? {};
  const minecraft = await requiredValue(
    "Minecraft version",
    options.minecraft ?? dependencies["minecraft"],
    options.interactive,
  );
  const loader = options.loader ?? Object.keys(dependencies).find((key) => key !== "minecraft");
  const loaderVersion = options.loaderVersion ?? (loader ? dependencies[loader] : undefined);
  if (loader && !loaderVersion) {
    throw new InlayError(error("loader-version-required", `A version is required for loader ${loader}.`), 2);
  }
  const manifest: LayerManifest = {
    $schema: MANIFEST_SCHEMA_URL,
    formatVersion: 1,
    game: "minecraft",
    versionId: options.version ?? imported?.versionId ?? "0.1.0",
    name: await requiredValue("Layer name", options.name ?? imported?.name, options.interactive),
    files: imported?.files ?? [],
    dependencies: {
      minecraft,
      ...(loader && loaderVersion ? { [loader]: loaderVersion } : {}),
    },
  };
  if (options.dryRun !== true) {
    try {
      await access(path.join(root, LAYIGNORE_FILENAME));
    } catch {
      await writeFile(path.join(root, LAYIGNORE_FILENAME), DEFAULT_LAYIGNORE, "utf8");
    }
    await writeManifest(root, manifest);
    await updateGeneratedExcludes(
      root,
      manifest.files.filter((file) => !isRepositoryFile(file)).map((file) => file.path),
    );
    const git = new GitAdapter(root);
    if (await git.isRepository()) await git.stage([MANIFEST_FILENAME, LAYIGNORE_FILENAME], true);
  }
  return manifest;
}
