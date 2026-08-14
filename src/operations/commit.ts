import * as p from "@clack/prompts";
import { GitAdapter } from "../adapters/git.js";
import { error, InlayError } from "../diagnostics.js";
import type { ContentMetadata } from "../inventory.js";
import { contentAuthority } from "../lib/content-authority.js";
import { isImplicitContentCandidate } from "../lib/content-candidates.js";
import { isRepositoryFile } from "../manifest/index.js";
import { type ChangeEntry, stagedEntries } from "./changes.js";
import { checkPack } from "./resolve.js";

function displayName(change: ChangeEntry, inventory: ContentMetadata[]): string {
  const metadata = inventory.find(
    (item) => item.path.toLocaleLowerCase("en-US") === change.path.toLocaleLowerCase("en-US"),
  );
  return metadata?.name ?? change.path.split("/").at(-1) ?? change.path;
}

function pluralKind(kind: string): string {
  if (kind === "resource-pack") return "resource packs";
  if (kind === "shader-pack") return "shader packs";
  if (kind === "data-pack") return "data packs";
  return `${kind}s`;
}

function semanticSubject(changes: ChangeEntry[], inventory: ContentMetadata[]): string {
  const first = changes[0];
  if (!first) return "chore(layer): reconcile staged changes";
  const allSameAction = changes.every((change) => change.action === first.action);
  const allSameKind = changes.every((change) => change.kind === first.kind);
  const type = first.action === "add" ? "feat" : "chore";
  if (changes.length === 1) {
    return `${type}(${first.kind}): ${first.action} ${displayName(first, inventory)}`;
  }
  if (allSameAction && allSameKind) {
    return `${type}(${first.kind}): ${first.action} ${changes.length} ${pluralKind(first.kind)}`;
  }
  return `chore(layer): reconcile ${changes.length} content changes`;
}

function semanticBody(
  changes: ChangeEntry[],
  inventory: ContentMetadata[],
  staged: string[],
  context?: string,
): string {
  const represented = new Set(["inlay.index.json", ...changes.map((change) => change.path)]);
  const otherPaths = staged.filter((item) => !represented.has(item));
  const pastTense: Record<ChangeEntry["action"], string> = {
    add: "Added",
    update: "Updated",
    remove: "Removed",
  };
  return [
    "Layer changes:",
    ...changes.map(
      (change) =>
        `- ${pastTense[change.action]} ${change.kind}: ${displayName(change, inventory)} (${change.path})`,
    ),
    ...(otherPaths.length > 0 ? ["", "Other staged paths:", ...otherPaths.map((item) => `- ${item}`)] : []),
    ...(context ? ["", context] : []),
  ].join("\n");
}

export async function commitStaged(
  root: string,
  options: { context?: string; interactive: boolean; dryRun?: boolean },
) {
  const git = new GitAdapter(root);
  const checked = await checkPack(root);
  const diagnostics = checked.diagnostics.filter((item) => item.severity !== "info");
  const staged = await git.staged();
  if (staged.length === 0)
    throw new InlayError(error("nothing-staged", "No staged files are available to commit."));
  const stagedWritesOutput = await git.run(["diff", "--cached", "--name-only", "--diff-filter=ACMRTUXB"]);
  const repositoryConfigSources = new Set(
    checked.pack.manifest.files.flatMap((file) =>
      isRepositoryFile(file) && contentAuthority(file.path) === "repository-config"
        ? [file.downloads[0].slice(2).toLocaleLowerCase("en-US")]
        : [],
    ),
  );
  const forbidden = stagedWritesOutput
    .split(/\r?\n/gu)
    .filter(Boolean)
    .filter(
      (candidate) =>
        isImplicitContentCandidate(candidate, checked.pack.manifest.docs ?? "docs") &&
        !repositoryConfigSources.has(candidate.toLocaleLowerCase("en-US")),
    );
  if (forbidden.length > 0) {
    throw new InlayError(
      forbidden.map((candidate) =>
        error(
          "repository-content-staged",
          `${candidate} cannot be committed. Only configuration content may be repository-backed.`,
          { path: candidate },
        ),
      ),
      2,
    );
  }
  const manifestChanged = staged.includes("inlay.index.json");
  const changes = manifestChanged ? await stagedEntries(git) : [];
  const subject =
    changes.length > 0
      ? semanticSubject(changes, checked.inventory.content)
      : manifestChanged
        ? `chore(layer): reconcile ${staged.length} staged path${staged.length === 1 ? "" : "s"}`
        : `chore: commit ${staged.length} staged path${staged.length === 1 ? "" : "s"}`;
  const body =
    changes.length > 0
      ? semanticBody(changes, checked.inventory.content, staged, options.context)
      : ["Staged paths:", ...staged.map((item) => `- ${item}`), options.context ? `\n${options.context}` : ""]
          .filter(Boolean)
          .join("\n");
  if (options.interactive && options.dryRun !== true) {
    if (diagnostics.length > 0) {
      p.note(diagnostics.map((item) => `[${item.code}] ${item.message}`).join("\n"), "Validation warnings");
    }
    p.note(`${subject}\n\n${body}`, "Commit preview");
    const accepted = await p.confirm({ message: "Commit all staged changes now?", initialValue: false });
    if (p.isCancel(accepted) || !accepted) {
      return { committed: false, staged, subject, body, diagnostics };
    }
  }
  if (options.dryRun !== true) await git.run(["commit", "-m", subject, "-m", body]);
  return { committed: options.dryRun !== true, staged, subject, body, diagnostics };
}
