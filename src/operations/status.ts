import { lstat, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { GitAdapter } from "../adapters/git.js";
import { MANIFEST_FILENAME, MATERIALIZATION_RECORD } from "../constants.js";
import { isImplicitContentCandidate } from "../lib/content-candidates.js";
import {
  detectDefaultConfigProviders,
  isDefaultConfigPath,
  isRuntimeConfigPath,
  isUnpackageableDefaultConfigPath,
  projectRuntimeConfig,
  regularFilesUnder,
} from "../lib/default-configs.js";
import { digest } from "../lib/hash.js";
import { readLayIgnore } from "../lib/lay-ignore.js";
import { resolveInside } from "../lib/path.js";
import { isRepositoryFile, readManifest } from "../manifest/index.js";
import type { MaterializationRecord } from "./materialize.js";

export type StatusState = "untracked" | "conflict" | "updated" | "deleted" | "reconciled" | "unchanged";

export interface StatusEntry {
  path: string;
  sourcePath?: string;
  state: StatusState;
  owner: string;
  detail: string;
  staged: boolean;
}

async function exists(filename: string): Promise<boolean> {
  try {
    return (await stat(filename)).isFile();
  } catch {
    return false;
  }
}

export async function status(root: string): Promise<{ entries: StatusEntry[]; unresolved: number }> {
  const { manifest } = await readManifest(root);
  const git = new GitAdapter(root);
  const staged = new Set((await git.staged()).map((item) => item.toLowerCase()));
  const entries: StatusEntry[] = [];
  const known = new Set<string>([MANIFEST_FILENAME.toLowerCase()]);
  const defaultConfigProviders = await detectDefaultConfigProviders(root, manifest.files);
  const layIgnore = await readLayIgnore(root);

  for (const declaration of manifest.files) {
    if (!isRepositoryFile(declaration)) continue;
    const source = declaration.downloads[0].slice(2);
    known.add(source.toLowerCase());
    const filename = resolveInside(root, source);
    if (!(await exists(filename))) {
      entries.push({
        path: source,
        state: "deleted",
        owner: `${manifest.name}@${manifest.versionId}`,
        detail: "Still declared by this Layer but missing on disk.",
        staged: staged.has(source.toLowerCase()),
      });
      continue;
    }
    const bytes = await readFile(filename);
    const changed =
      bytes.byteLength !== declaration.fileSize || digest(bytes, "sha256") !== declaration.hashes.sha256;
    const isStaged = staged.has(source.toLowerCase());
    entries.push({
      path: source,
      state: changed ? "updated" : isStaged ? "reconciled" : "unchanged",
      owner: `${manifest.name}@${manifest.versionId}`,
      detail: changed
        ? "Working bytes differ from the current files[] declaration."
        : "Matches declared hashes and size.",
      staged: isStaged,
    });
  }

  let record: MaterializationRecord | undefined;
  try {
    record = JSON.parse(
      await readFile(path.join(root, MATERIALIZATION_RECORD), "utf8"),
    ) as MaterializationRecord;
  } catch {
    record = undefined;
  }
  for (const managed of record?.entries ?? []) {
    known.add(managed.path.toLowerCase());
    const filename = resolveInside(root, managed.path);
    const actual = (await exists(filename)) ? digest(await readFile(filename), managed.algorithm) : undefined;
    const conflict = actual !== undefined && actual !== managed.digest;
    const missing = actual === undefined && managed.policy !== "optional";
    const currentOwner = managed.owner === `${manifest.name}@${manifest.versionId}`;
    const state: StatusState = currentOwner
      ? missing
        ? "deleted"
        : conflict
          ? "updated"
          : "unchanged"
      : conflict || missing
        ? "conflict"
        : "unchanged";
    entries.push({
      path: managed.path,
      state,
      owner: managed.owner,
      detail: conflict
        ? "Managed bytes differ from the last applied payload."
        : missing
          ? "Required managed file is missing."
          : "Matches materialized payload.",
      staged: false,
    });
  }

  const candidates = new Map<string, string>();
  const downloadedContent = await regularFilesUnder(root, [
    "config",
    "datapacks",
    "mods",
    "resourcepacks",
    "shaderpacks",
    "texturepacks",
  ]);
  for (const candidate of [...(await git.tracked()), ...(await git.untracked()), ...downloadedContent]) {
    candidates.set(candidate.toLowerCase(), candidate);
  }
  for (const [candidateKey, candidate] of candidates) {
    const projection = isRuntimeConfigPath(candidate)
      ? await projectRuntimeConfig(root, candidate, defaultConfigProviders)
      : undefined;
    if (
      known.has(candidateKey) ||
      projection !== undefined ||
      layIgnore.ignores(candidate) ||
      (await isUnpackageableDefaultConfigPath(root, candidate, defaultConfigProviders)) ||
      !isImplicitContentCandidate(candidate, manifest.docs ?? "docs")
    )
      continue;
    try {
      const details = await lstat(resolveInside(root, candidate));
      if (!details.isFile() || details.isSymbolicLink()) continue;
    } catch {
      continue;
    }
    entries.push({
      path: candidate,
      state: "untracked",
      owner: "Local instance",
      detail: "Eligible regular file is not declared by this Layer.",
      staged: false,
    });
  }

  if (defaultConfigProviders.length > 0) {
    const runtimeConfigs = await regularFilesUnder(root, ["config"]);
    for (const runtimePath of runtimeConfigs) {
      if (isDefaultConfigPath(runtimePath, defaultConfigProviders)) continue;
      const projection = await projectRuntimeConfig(root, runtimePath, defaultConfigProviders);
      if (!projection) continue;
      const existing = entries.find((entry) => entry.path.toLowerCase() === projection.path.toLowerCase());
      if (existing) {
        if (!["unchanged", "reconciled"].includes(existing.state)) continue;
        const defaultsBytes = await readFile(resolveInside(root, projection.path));
        const runtimeBytes = await readFile(resolveInside(root, runtimePath));
        if (!defaultsBytes.equals(runtimeBytes)) {
          existing.state = "updated";
          existing.sourcePath = runtimePath;
          existing.detail = `${runtimePath} differs from the ${projection.provider.name} default.`;
        }
        continue;
      }
      if (layIgnore.ignores(runtimePath) || layIgnore.ignores(projection.path)) continue;
      try {
        const projected = await lstat(resolveInside(root, projection.path));
        if (projected.isFile() && !projected.isSymbolicLink()) continue;
      } catch {
        // A missing default is offered at its projected authorable path below.
      }
      entries.push({
        path: projection.path,
        sourcePath: runtimePath,
        state: "untracked",
        owner: "Local instance",
        detail: `${runtimePath} has no ${projection.provider.name} default.`,
        staged: false,
      });
    }
  }

  const order: Record<StatusState, number> = {
    untracked: 0,
    conflict: 1,
    updated: 2,
    deleted: 3,
    reconciled: 4,
    unchanged: 5,
  };
  entries.sort(
    (left, right) => order[left.state] - order[right.state] || left.path.localeCompare(right.path),
  );
  return {
    entries,
    unresolved: entries.filter((entry) =>
      ["untracked", "conflict", "updated", "deleted"].includes(entry.state),
    ).length,
  };
}
