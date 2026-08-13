import * as p from "@clack/prompts";
import { GitAdapter } from "../adapters/git.js";
import { error, InlayError } from "../diagnostics.js";
import { checkPack } from "./resolve.js";

export async function commitStaged(
  root: string,
  options: { context?: string; interactive: boolean; dryRun?: boolean },
) {
  const git = new GitAdapter(root);
  await checkPack(root);
  const staged = await git.staged();
  if (staged.length === 0)
    throw new InlayError(error("nothing-staged", "No staged files are available to commit."));
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
    p.note(`${subject}\n\n${body}`, "Commit preview");
    const accepted = await p.confirm({ message: "Commit all staged changes now?", initialValue: false });
    if (p.isCancel(accepted) || !accepted) return { committed: false, staged, subject, body };
  }
  if (options.dryRun !== true) await git.run(["commit", "-m", subject, "-m", body]);
  return { committed: options.dryRun !== true, staged, subject, body };
}
