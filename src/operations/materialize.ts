import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { MATERIALIZATION_RECORD } from "../constants.js";
import { error, InlayError } from "../diagnostics.js";
import { digest } from "../lib/hash.js";
import { canonicalJson } from "../lib/json.js";
import { resolveInside } from "../lib/path.js";
import { composeLayers } from "../resolution/compose.js";
import { LineageResolver, readPayload } from "../resolution/parents.js";
import type { Environment, EnvironmentPolicy, ResolvedContent } from "../types.js";
import { updateGeneratedExcludes } from "./git-excludes.js";
import { packFingerprint } from "./resolve.js";

export interface MaterializationEntry {
  path: string;
  owner: string;
  algorithm: "sha256" | "sha512";
  digest: string;
  fileSize: number;
  policy: EnvironmentPolicy;
}

export interface MaterializationRecord {
  formatVersion: 1;
  environment: Environment;
  fingerprint: string;
  entries: MaterializationEntry[];
}

async function existingRecord(root: string): Promise<MaterializationRecord | undefined> {
  try {
    return JSON.parse(
      await readFile(path.join(root, MATERIALIZATION_RECORD), "utf8"),
    ) as MaterializationRecord;
  } catch {
    return undefined;
  }
}

async function writeRecord(root: string, record: MaterializationRecord): Promise<void> {
  const recordPath = path.join(root, MATERIALIZATION_RECORD);
  await mkdir(path.dirname(recordPath), { recursive: true });
  const temporaryRecord = `${recordPath}.${process.pid}.tmp`;
  await writeFile(temporaryRecord, canonicalJson(record), "utf8");
  await rename(temporaryRecord, recordPath);
}

async function fileDigest(filename: string, algorithm: "sha256" | "sha512"): Promise<string | undefined> {
  try {
    const details = await stat(filename);
    if (!details.isFile()) return undefined;
    return digest(await readFile(filename), algorithm);
  } catch {
    return undefined;
  }
}

function contentIntegrity(
  content: ResolvedContent,
): Pick<MaterializationEntry, "algorithm" | "digest" | "fileSize"> {
  if (content.payload.kind === "repository") {
    return { algorithm: "sha256", digest: content.payload.hashes.sha256, fileSize: content.payload.fileSize };
  }
  return {
    algorithm: "sha512",
    digest: content.payload.hashes.sha512,
    fileSize: content.payload.fileSize,
  };
}

/** Record one already-present resolved payload without materializing any other content. */
export async function recordMaterializedPath(root: string, target: string): Promise<MaterializationRecord> {
  const resolver = new LineageResolver();
  const pack = composeLayers(await resolver.local(root));
  const previous = await existingRecord(root);
  const environments: Environment[] = previous ? [previous.environment] : ["client", "server"];
  const selected = environments
    .map((environment) => ({
      environment,
      content: pack.slots.get(`${target.toLowerCase()}\0${environment}`),
    }))
    .find((candidate) => candidate.content !== undefined);
  if (!selected?.content) {
    throw new InlayError(
      error("materialization-source-missing", `${target} is not present in the resolved content plan.`, {
        path: target,
      }),
    );
  }
  const integrity = contentIntegrity(selected.content);
  const filename = resolveInside(root, selected.content.path);
  const actual = await fileDigest(filename, integrity.algorithm);
  const details = await stat(filename).catch(() => undefined);
  if (actual !== integrity.digest || details?.size !== integrity.fileSize) {
    throw new InlayError(
      error("materialization-drift", `${target} does not match its reconciled declaration.`, {
        path: target,
      }),
    );
  }
  const entry: MaterializationEntry = {
    path: selected.content.path,
    owner: `${selected.content.owner.name}@${selected.content.owner.versionId}`,
    ...integrity,
    policy: selected.content.env[selected.environment],
  };
  const record: MaterializationRecord = {
    formatVersion: 1,
    environment: selected.environment,
    fingerprint: packFingerprint(pack),
    entries: [
      ...(previous?.entries ?? []).filter((item) => item.path.toLowerCase() !== target.toLowerCase()),
      entry,
    ],
  };
  await writeRecord(root, record);
  await updateGeneratedExcludes(
    root,
    record.entries.map((item) => item.path),
  );
  return record;
}

export async function materialize(root: string, environment: Environment): Promise<MaterializationRecord> {
  const resolver = new LineageResolver();
  const layers = await resolver.local(root);
  const pack = composeLayers(layers);
  const previous = await existingRecord(root);
  const previousByPath = new Map((previous?.entries ?? []).map((entry) => [entry.path.toLowerCase(), entry]));
  const currentOwner = pack.lineage.at(-1);
  const selected = new Map<string, ResolvedContent>();
  for (const [slot, content] of pack.slots) {
    if (slot.endsWith(`\0${environment}`)) selected.set(content.path.toLowerCase(), content);
  }

  const entries: MaterializationEntry[] = [];
  const ignored: string[] = [];
  for (const content of [...selected.values()].sort((left, right) => left.path.localeCompare(right.path))) {
    const integrity = contentIntegrity(content);
    const entry: MaterializationEntry = {
      path: content.path,
      owner: `${content.owner.name}@${content.owner.versionId}`,
      ...integrity,
      policy: content.env[environment],
    };
    const currentRepositorySource =
      content.owner.source === currentOwner?.source &&
      content.payload.kind === "repository" &&
      content.payload.repositoryRoot;
    if (currentRepositorySource) continue;
    entries.push(entry);
    ignored.push(content.path);
    const filename = resolveInside(root, content.path);
    const actual = await fileDigest(filename, integrity.algorithm);
    if (actual === integrity.digest) continue;
    if (actual === undefined && entry.policy === "optional") continue;
    const old = previousByPath.get(content.path.toLowerCase());
    if (actual !== undefined && (!old || (await fileDigest(filename, old.algorithm)) !== old.digest)) {
      throw new InlayError(
        error("materialization-drift", `${content.path} has local changes and cannot be overwritten.`, {
          path: content.path,
          layer: entry.owner,
        }),
      );
    }
    const bytes = await readPayload(content.payload, resolver.http);
    await mkdir(path.dirname(filename), { recursive: true });
    const temporary = `${filename}.${process.pid}.inlay-tmp`;
    await writeFile(temporary, bytes);
    await rename(temporary, filename);
  }

  for (const old of previous?.entries ?? []) {
    if (selected.has(old.path.toLowerCase())) continue;
    const filename = resolveInside(root, old.path);
    const actual = await fileDigest(filename, old.algorithm);
    if (actual === undefined) continue;
    if (actual !== old.digest) {
      throw new InlayError(
        error("materialization-drift", `${old.path} was locally changed and cannot be removed.`, {
          path: old.path,
        }),
      );
    }
    await rm(filename);
  }

  const record: MaterializationRecord = {
    formatVersion: 1,
    environment,
    fingerprint: packFingerprint(pack),
    entries,
  };
  await writeRecord(root, record);
  await updateGeneratedExcludes(root, ignored);
  return record;
}
