import { lstat, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import * as p from "@clack/prompts";
import { GitAdapter } from "../adapters/git.js";
import { LAYIGNORE_FILENAME, MANIFEST_FILENAME, MATERIALIZATION_RECORD } from "../constants.js";
import { error, InlayError } from "../diagnostics.js";
import { contentAuthority, remoteContentDeclaration } from "../lib/content-authority.js";
import { hashes } from "../lib/hash.js";
import { detectModrinthContent } from "../lib/instance-metadata.js";
import { preserveWithLayIgnore } from "../lib/lay-ignore.js";
import { resolveInside } from "../lib/path.js";
import { isRepositoryFile, readManifest, writeManifest } from "../manifest/index.js";
import { composeLayers } from "../resolution/compose.js";
import { LineageResolver, readPayload } from "../resolution/parents.js";
import type { Exclusion, FileDeclaration } from "../types.js";
import { type MaterializationRecord, recordMaterializedPath } from "./materialize.js";
import { type StatusEntry, status } from "./status.js";

export type ReconcileAction = "add" | "record" | "remove" | "exclude" | "restore" | "upstream" | "preserve";

export interface ReconcileBatchResult {
  action: ReconcileAction;
  paths: string[];
  staged: string[];
}

interface ReconcileOptions {
  interactive: boolean;
  action?: ReconcileAction;
  dryRun?: boolean;
}

function choices(entry: StatusEntry): Array<{ value: ReconcileAction; label: string; hint?: string }> {
  if (entry.state === "untracked") {
    const authority = contentAuthority(entry.declarationPath ?? entry.path);
    return [
      ...(authority === "modrinth"
        ? [{ value: "add" as const, label: "Track from Modrinth", hint: "declare remotely; keep local" }]
        : authority === "repository-config"
          ? [{ value: "add" as const, label: "Add config to this Layer", hint: "declare, hash, and stage" }]
          : []),
      { value: "preserve", label: "Ignore in this Layer", hint: "keep local and update .layignore" },
    ];
  }
  if (entry.state === "updated") {
    return [
      { value: "record", label: "Record changed bytes" },
      { value: "restore", label: "Restore declared bytes" },
    ];
  }
  if (entry.state === "deleted") {
    return [
      { value: "remove", label: "Remove from this Layer" },
      { value: "restore", label: "Restore declared bytes" },
    ];
  }
  return [
    { value: "add", label: "Adopt as an Override in this Layer" },
    { value: "exclude", label: "Exclude inherited content", hint: "for a missing inherited file" },
    { value: "restore", label: "Restore inherited content" },
    { value: "upstream", label: `Track in ${entry.owner}`, hint: "stop without changes" },
  ];
}

async function selectAction(
  entry: StatusEntry,
  interactive: boolean,
  requested?: ReconcileAction,
): Promise<ReconcileAction> {
  if (requested) return requested;
  if (!interactive)
    throw new InlayError(
      error("reconcile-action-required", `Choose an explicit action for ${entry.path}.`, {
        path: entry.path,
      }),
      2,
    );
  const selected = await p.select({ message: `Reconcile ${entry.path}`, options: choices(entry) });
  if (p.isCancel(selected)) throw new InlayError(error("cancelled", "Reconciliation cancelled."));
  return selected;
}

const batchLabels: Record<ReconcileAction, string> = {
  add: "Add every file to this Layer",
  record: "Record every changed file",
  remove: "Remove every file from this Layer",
  exclude: "Exclude every inherited file",
  restore: "Restore every declared file",
  upstream: "Track every file in its owning Layer",
  preserve: "Ignore every file in this Layer",
};

function sharedChoices(entries: StatusEntry[]): Array<{ value: ReconcileAction; label: string }> {
  const first = entries[0];
  if (!first) return [];
  return choices(first)
    .filter((option) => entries.length === 1 || option.value !== "upstream")
    .filter((option) =>
      entries.every((entry) => choices(entry).some((candidate) => candidate.value === option.value)),
    )
    .map((option) => ({ value: option.value, label: batchLabels[option.value] }));
}

async function selectBatchAction(
  entries: StatusEntry[],
  label: string,
  options: ReconcileOptions,
): Promise<ReconcileAction> {
  const available = sharedChoices(entries);
  if (options.action) {
    if (available.some((option) => option.value === options.action)) return options.action;
    throw new InlayError(
      error(
        "reconcile-action-incompatible",
        `${options.action} cannot be applied to every unresolved file below ${label}.`,
        { detail: entries.map((entry) => `${entry.path}: ${entry.state}`).join("\n") },
      ),
      2,
    );
  }
  const onlyEntry = entries[0];
  if (entries.length === 1 && onlyEntry) return selectAction(onlyEntry, options.interactive);
  if (available.length === 0) {
    throw new InlayError(
      error(
        "reconcile-directory-mixed",
        `${label} contains unresolved files that do not share one reconciliation action.`,
        { detail: entries.map((entry) => `${entry.path}: ${entry.state}`).join("\n") },
      ),
      2,
    );
  }
  if (!options.interactive) {
    throw new InlayError(
      error("reconcile-action-required", `Choose an explicit action for ${label}.`, { path: label }),
      2,
    );
  }
  const selected = await p.select({
    message: `Reconcile ${label} (${entries.length} files)`,
    options: available,
  });
  if (p.isCancel(selected)) throw new InlayError(error("cancelled", "Reconciliation cancelled."));
  return selected;
}

function normalizedTarget(value: string): string {
  const normalized = value.replaceAll("\\", "/").replace(/^\.\//u, "").replace(/\/+$/u, "");
  return normalized === "." ? "" : normalized;
}

function entriesBelow(report: Awaited<ReturnType<typeof status>>, targets: string[]): StatusEntry[] {
  const unresolved = report.entries.filter((entry) => !["unchanged", "reconciled"].includes(entry.state));
  const selected = new Map<string, StatusEntry>();
  for (const value of targets) {
    const target = normalizedTarget(value).toLocaleLowerCase("en-US");
    const exact = unresolved.filter((entry) =>
      [entry.path, entry.declarationPath]
        .filter((candidate): candidate is string => candidate !== undefined)
        .some((candidate) => candidate.toLocaleLowerCase("en-US") === target),
    );
    const matches =
      exact.length > 0
        ? exact
        : unresolved.filter((entry) =>
            [entry.path, entry.declarationPath]
              .filter((candidate): candidate is string => candidate !== undefined)
              .some((candidate) => {
                const normalized = candidate.toLocaleLowerCase("en-US");
                return target === "" || normalized.startsWith(`${target}/`);
              }),
          );
    for (const entry of matches) selected.set(entry.path.toLocaleLowerCase("en-US"), entry);
  }
  return [...selected.values()].sort((left, right) => left.path.localeCompare(right.path));
}

/** Reconcile every unresolved entry selected by exact path or directory prefix with one action. */
export async function reconcileTargets(
  root: string,
  targets: string[],
  options: ReconcileOptions,
): Promise<ReconcileBatchResult> {
  const report = await status(root);
  const entries = entriesBelow(report, targets);
  const label =
    targets.length === 1 ? normalizedTarget(targets[0] ?? "") || "." : `${targets.length} selections`;
  if (entries.length === 0) {
    throw new InlayError(
      error("nothing-to-reconcile", `${label} has no unresolved status.`, { path: label }),
    );
  }
  const action = await selectBatchAction(entries, label, options);
  const staged = new Set<string>();
  for (const entry of entries) {
    const outcome = await reconcilePath(root, entry.path, {
      interactive: false,
      action,
      ...(options.dryRun === undefined ? {} : { dryRun: options.dryRun }),
    });
    for (const candidate of outcome.staged) staged.add(candidate);
  }
  return { action, paths: entries.map((entry) => entry.path), staged: [...staged] };
}

export async function reconcileTarget(
  root: string,
  target: string,
  options: ReconcileOptions,
): Promise<ReconcileBatchResult> {
  return reconcileTargets(root, [target], options);
}

async function readMaterializationRecord(root: string): Promise<MaterializationRecord | undefined> {
  try {
    return JSON.parse(
      await readFile(path.join(root, MATERIALIZATION_RECORD), "utf8"),
    ) as MaterializationRecord;
  } catch {
    return undefined;
  }
}

async function restoreManaged(root: string, target: string): Promise<void> {
  const resolver = new LineageResolver();
  const layers = await resolver.local(root);
  const pack = composeLayers(layers);
  const record = await readMaterializationRecord(root);
  if (!record) {
    throw new InlayError(
      error(
        "materialization-record-missing",
        `Cannot safely restore ${target} without a materialization record.`,
      ),
    );
  }
  const slot = pack.slots.get(`${target.toLowerCase()}\0${record.environment}`);
  if (!slot)
    throw new InlayError(
      error("restore-source-missing", `${target} is not present in the resolved ${record.environment} plan.`),
    );
  const bytes = await readPayload(slot.payload, resolver.http);
  const filename = resolveInside(root, target);
  await mkdir(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.${process.pid}.tmp`;
  await writeFile(temporary, bytes);
  await rename(temporary, filename);
}

export async function reconcilePath(
  root: string,
  target: string,
  options: ReconcileOptions,
): Promise<{ action: ReconcileAction; staged: string[] }> {
  const report = await status(root);
  const entry = report.entries.find(
    (candidate) =>
      candidate.path.toLowerCase() === target.toLowerCase() ||
      candidate.declarationPath?.toLowerCase() === target.toLowerCase(),
  );
  if (!entry || ["unchanged", "reconciled"].includes(entry.state)) {
    throw new InlayError(
      error("nothing-to-reconcile", `${target} has no unresolved status.`, { path: target }),
    );
  }
  const action = await selectAction(entry, options.interactive, options.action);
  if (action === "upstream") {
    throw new InlayError(
      error(
        "upstream-change-required",
        `Apply this change in ${entry.owner}, release it, then update this Layer's immutable parent.`,
        {
          path: entry.path,
          layer: entry.owner,
        },
      ),
    );
  }
  if (action === "preserve") {
    const staged = [LAYIGNORE_FILENAME];
    if (options.dryRun !== true) {
      await preserveWithLayIgnore(root, entry.path);
      await new GitAdapter(root).stage(staged, true);
    }
    return { action, staged };
  }
  if (options.dryRun === true) {
    const declarationPath = entry.declarationPath ?? entry.path;
    const authority = contentAuthority(declarationPath);
    if ((action === "add" || action === "record") && authority === "unsupported") {
      throw new InlayError(
        error(
          "repository-content-forbidden",
          `${declarationPath} cannot be stored in Git. Only configuration content may be repository-backed.`,
          { path: declarationPath },
        ),
        2,
      );
    }
    return {
      action,
      staged:
        action === "restore"
          ? []
          : action === "add" || action === "record" || action === "remove"
            ? [MANIFEST_FILENAME, ...(authority === "repository-config" ? [declarationPath] : [])]
            : [MANIFEST_FILENAME],
    };
  }

  const { manifest } = await readManifest(root);
  const git = new GitAdapter(root);
  const staged: string[] = [];
  const declarationPath = entry.declarationPath ?? entry.path;
  if (action === "restore") {
    if (entry.declarationPath) {
      const bytes = await readFile(resolveInside(root, entry.declarationPath));
      const runtime = resolveInside(root, entry.path);
      await mkdir(path.dirname(runtime), { recursive: true });
      await writeFile(runtime, bytes);
      return { action, staged };
    }
    const declaration = manifest.files.find(
      (file) =>
        isRepositoryFile(file) && file.downloads[0].slice(2).toLowerCase() === declarationPath.toLowerCase(),
    );
    if (declaration) {
      const repositoryRoot = await git.root();
      const repositoryPath = path
        .relative(repositoryRoot, resolveInside(root, declarationPath))
        .replaceAll("\\", "/");
      const bytes = await git.readAtHead(repositoryPath);
      const filename = resolveInside(root, declarationPath);
      await mkdir(path.dirname(filename), { recursive: true });
      await writeFile(filename, bytes);
      return { action, staged };
    }
    await restoreManaged(root, entry.path);
    return { action, staged };
  }

  if (action === "exclude") {
    const exclusion: Exclusion = { path: entry.path };
    manifest.exclusions = [...(manifest.exclusions ?? []), exclusion];
  } else if (action === "remove") {
    manifest.files = manifest.files.filter((file) => {
      if (file.path.toLowerCase() === declarationPath.toLowerCase()) return false;
      return !(
        isRepositoryFile(file) && file.downloads[0].slice(2).toLowerCase() === declarationPath.toLowerCase()
      );
    });
  } else {
    const source = resolveInside(root, entry.path);
    const details = await lstat(source);
    if (!details.isFile() || details.isSymbolicLink()) {
      throw new InlayError(error("repository-source-type", `${entry.path} is not a regular file.`));
    }
    const bytes = await readFile(source);
    const authority = contentAuthority(declarationPath);
    if (authority === "unsupported") {
      throw new InlayError(
        error(
          "repository-content-forbidden",
          `${declarationPath} cannot be stored in Git. Only configuration content may be repository-backed.`,
          { path: declarationPath },
        ),
        2,
      );
    }
    let next: FileDeclaration;
    if (authority === "modrinth") {
      const installed = await detectModrinthContent(root, declarationPath);
      next = await remoteContentDeclaration(declarationPath, bytes, manifest, installed ? { installed } : {});
    } else {
      const destination = resolveInside(root, declarationPath);
      if (entry.declarationPath) {
        await mkdir(path.dirname(destination), { recursive: true });
        await writeFile(destination, bytes);
      }
      const actual = hashes(bytes);
      next = {
        path: declarationPath,
        hashes: { sha1: actual.sha1, sha256: actual.sha256 },
        downloads: [`./${declarationPath}`],
        fileSize: bytes.byteLength,
      };
    }
    const index = manifest.files.findIndex(
      (file) =>
        file.path.toLowerCase() === declarationPath.toLowerCase() ||
        (isRepositoryFile(file) &&
          file.downloads[0].slice(2).toLowerCase() === declarationPath.toLowerCase()),
    );
    if (index >= 0) manifest.files[index] = next;
    else manifest.files.push(next);
  }
  await writeManifest(root, manifest);
  staged.push(MANIFEST_FILENAME);
  if (
    (action === "add" || action === "record" || action === "remove") &&
    contentAuthority(declarationPath) === "repository-config"
  )
    staged.push(declarationPath);
  await git.stage(staged, action === "add");
  if ((action === "add" || action === "record") && contentAuthority(declarationPath) === "modrinth") {
    await recordMaterializedPath(root, declarationPath);
  }
  return { action, staged };
}
