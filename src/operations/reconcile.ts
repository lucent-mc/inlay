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

function choices(entry: StatusEntry): Array<{ value: ReconcileAction; label: string; hint?: string }> {
  if (entry.state === "untracked") {
    const authority = contentAuthority(entry.path);
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
  options: { interactive: boolean; action?: ReconcileAction; dryRun?: boolean },
): Promise<{ action: ReconcileAction; staged: string[] }> {
  const report = await status(root);
  const entry = report.entries.find(
    (candidate) =>
      candidate.path.toLowerCase() === target.toLowerCase() ||
      candidate.sourcePath?.toLowerCase() === target.toLowerCase(),
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
      await preserveWithLayIgnore(root, entry.sourcePath ?? entry.path);
      await new GitAdapter(root).stage(staged, true);
    }
    return { action, staged };
  }
  if (options.dryRun === true) {
    const authority = contentAuthority(entry.path);
    if ((action === "add" || action === "record") && authority === "unsupported") {
      throw new InlayError(
        error(
          "repository-content-forbidden",
          `${entry.path} cannot be stored in Git. Only configuration content may be repository-backed.`,
          { path: entry.path },
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
            ? [MANIFEST_FILENAME, ...(authority === "repository-config" ? [entry.path] : [])]
            : [MANIFEST_FILENAME],
    };
  }

  const { manifest } = await readManifest(root);
  const git = new GitAdapter(root);
  const staged: string[] = [];
  if (action === "restore") {
    if (entry.sourcePath) {
      const bytes = await readFile(resolveInside(root, entry.path));
      const runtime = resolveInside(root, entry.sourcePath);
      await mkdir(path.dirname(runtime), { recursive: true });
      await writeFile(runtime, bytes);
      return { action, staged };
    }
    const declaration = manifest.files.find(
      (file) =>
        isRepositoryFile(file) && file.downloads[0].slice(2).toLowerCase() === entry.path.toLowerCase(),
    );
    if (declaration) {
      const repositoryRoot = await git.root();
      const repositoryPath = path
        .relative(repositoryRoot, resolveInside(root, entry.path))
        .replaceAll("\\", "/");
      const bytes = await git.readAtHead(repositoryPath);
      const filename = resolveInside(root, entry.path);
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
      if (file.path.toLowerCase() === entry.path.toLowerCase()) return false;
      return !(
        isRepositoryFile(file) && file.downloads[0].slice(2).toLowerCase() === entry.path.toLowerCase()
      );
    });
  } else {
    const source = resolveInside(root, entry.sourcePath ?? entry.path);
    const details = await lstat(source);
    if (!details.isFile() || details.isSymbolicLink()) {
      throw new InlayError(error("repository-source-type", `${entry.path} is not a regular file.`));
    }
    const bytes = await readFile(source);
    const authority = contentAuthority(entry.path);
    if (authority === "unsupported") {
      throw new InlayError(
        error(
          "repository-content-forbidden",
          `${entry.path} cannot be stored in Git. Only configuration content may be repository-backed.`,
          { path: entry.path },
        ),
        2,
      );
    }
    let next: FileDeclaration;
    if (authority === "modrinth") {
      const installed = await detectModrinthContent(root, entry.path);
      next = await remoteContentDeclaration(entry.path, bytes, manifest, installed ? { installed } : {});
    } else {
      const destination = resolveInside(root, entry.path);
      if (entry.sourcePath) {
        await mkdir(path.dirname(destination), { recursive: true });
        await writeFile(destination, bytes);
      }
      const actual = hashes(bytes);
      next = {
        path: entry.path,
        hashes: { sha1: actual.sha1, sha256: actual.sha256 },
        downloads: [`./${entry.path}`],
        fileSize: bytes.byteLength,
      };
    }
    const index = manifest.files.findIndex(
      (file) =>
        file.path.toLowerCase() === entry.path.toLowerCase() ||
        (isRepositoryFile(file) && file.downloads[0].slice(2).toLowerCase() === entry.path.toLowerCase()),
    );
    if (index >= 0) manifest.files[index] = next;
    else manifest.files.push(next);
  }
  await writeManifest(root, manifest);
  staged.push(MANIFEST_FILENAME);
  if (
    (action === "add" || action === "record" || action === "remove") &&
    contentAuthority(entry.path) === "repository-config"
  )
    staged.push(entry.path);
  await git.stage(staged, action === "add");
  if ((action === "add" || action === "record") && contentAuthority(entry.path) === "modrinth") {
    await recordMaterializedPath(root, entry.path);
  }
  return { action, staged };
}
