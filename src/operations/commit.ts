import * as p from "@clack/prompts";
import { GitAdapter } from "../adapters/git.js";
import { error, InlayError } from "../diagnostics.js";
import { contentAuthority } from "../lib/content-authority.js";
import { isImplicitContentCandidate } from "../lib/content-candidates.js";
import { isRepositoryFile } from "../manifest/index.js";
import { checkPack } from "./resolve.js";

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
  const subject = manifestChanged
    ? `chore(layer): reconcile ${staged.length} staged path${staged.length === 1 ? "" : "s"}`
    : `chore: commit ${staged.length} staged path${staged.length === 1 ? "" : "s"}`;
  const body = [
    "Staged paths:",
    ...staged.map((item) => `- ${item}`),
    options.context ? `\n${options.context}` : "",
  ]
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
