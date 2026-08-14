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
import { type DetectedInstanceMetadata, detectInstanceMetadata } from "../lib/instance-metadata.js";
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

function consensus<T>(
  candidates: DetectedInstanceMetadata[],
  field: (candidate: DetectedInstanceMetadata) => T | undefined,
): { value: T | undefined; conflict: boolean } {
  const values = candidates.map(field).filter((value): value is T => value !== undefined);
  const value = values[0];
  return {
    value,
    conflict: values.some((candidate) => candidate !== value),
  };
}

function evidenceSources(candidates: DetectedInstanceMetadata[]): string {
  return candidates.map((candidate) => candidate.source).join(" and ");
}

export async function initialize(root: string, options: InitOptions): Promise<LayerManifest> {
  try {
    await access(path.join(root, MANIFEST_FILENAME));
    throw new InlayError(error("already-initialized", `${MANIFEST_FILENAME} already exists.`));
  } catch (cause) {
    if (cause instanceof InlayError) throw cause;
  }
  const imported = await existingModrinth(root);
  const detected = await detectInstanceMetadata(root);
  const detectedSource = evidenceSources(detected);
  const unsupportedLoader = detected.find((candidate) => candidate.unsupportedLoader);
  if (unsupportedLoader?.unsupportedLoader && !(options.loader && options.loaderVersion)) {
    throw new InlayError(
      error(
        "launcher-loader-unsupported",
        `${unsupportedLoader.source} uses unsupported loader type ${unsupportedLoader.unsupportedLoader}. Pass --loader and --loader-version explicitly.`,
      ),
      2,
    );
  }
  const dependencies = imported?.dependencies ?? {};
  const importedMinecraft = dependencies["minecraft"];
  const detectedMinecraft = consensus(detected, (candidate) => candidate.minecraft);
  if (options.minecraft === undefined && detectedMinecraft.conflict) {
    throw new InlayError(
      error(
        "launcher-target-conflict",
        `${detectedSource} declare different Minecraft versions. Pass --minecraft explicitly to choose.`,
      ),
      2,
    );
  }
  if (
    options.minecraft === undefined &&
    importedMinecraft &&
    detectedMinecraft.value &&
    importedMinecraft !== detectedMinecraft.value
  ) {
    throw new InlayError(
      error(
        "runtime-target-conflict",
        `modrinth.index.json declares Minecraft ${importedMinecraft}, but ${detectedSource} declares ${detectedMinecraft.value}. Pass --minecraft explicitly to choose.`,
      ),
      2,
    );
  }
  const minecraft = await requiredValue(
    "Minecraft version",
    options.minecraft ?? importedMinecraft ?? detectedMinecraft.value,
    options.interactive,
  );
  const importedLoader = Object.keys(dependencies).find((key) => key !== "minecraft");
  const detectedLoader = consensus(detected, (candidate) => candidate.loader);
  if (options.loader === undefined && detectedLoader.conflict) {
    throw new InlayError(
      error(
        "launcher-target-conflict",
        `${detectedSource} declare different loaders. Pass --loader and --loader-version explicitly to choose.`,
      ),
      2,
    );
  }
  if (
    options.loader === undefined &&
    imported &&
    detectedLoader.value !== undefined &&
    (importedLoader ?? null) !== detectedLoader.value
  ) {
    throw new InlayError(
      error(
        "runtime-target-conflict",
        `modrinth.index.json and ${detectedSource} declare different loaders. Pass --loader and --loader-version explicitly to choose.`,
      ),
      2,
    );
  }
  const loader =
    options.loader ?? importedLoader ?? (detectedLoader.value === null ? undefined : detectedLoader.value);
  const importedLoaderVersion = loader ? dependencies[loader] : undefined;
  const matchingDetectedLoaders = detected.filter((candidate) => candidate.loader === (loader ?? null));
  const detectedLoaderVersion = consensus(matchingDetectedLoaders, (candidate) => candidate.loaderVersion);
  if (options.loaderVersion === undefined && detectedLoaderVersion.conflict) {
    throw new InlayError(
      error(
        "launcher-target-conflict",
        `${evidenceSources(matchingDetectedLoaders)} declare different versions of ${loader}. Pass --loader-version explicitly to choose.`,
      ),
      2,
    );
  }
  if (
    options.loaderVersion === undefined &&
    importedLoaderVersion &&
    detectedLoaderVersion.value &&
    importedLoaderVersion !== detectedLoaderVersion.value
  ) {
    throw new InlayError(
      error(
        "runtime-target-conflict",
        `modrinth.index.json declares ${loader} ${importedLoaderVersion}, but ${evidenceSources(matchingDetectedLoaders)} declares ${detectedLoaderVersion.value}. Pass --loader-version explicitly to choose.`,
      ),
      2,
    );
  }
  const loaderVersion = options.loaderVersion ?? importedLoaderVersion ?? detectedLoaderVersion.value;
  if (loader && !loaderVersion) {
    throw new InlayError(error("loader-version-required", `A version is required for loader ${loader}.`), 2);
  }
  const detectedName = consensus(detected, (candidate) => candidate.name);
  const manifest: LayerManifest = {
    $schema: MANIFEST_SCHEMA_URL,
    formatVersion: 1,
    game: "minecraft",
    versionId: options.version ?? imported?.versionId ?? "0.1.0",
    name: await requiredValue(
      "Layer name",
      options.name ?? imported?.name ?? (detectedName.conflict ? undefined : detectedName.value),
      options.interactive,
    ),
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
