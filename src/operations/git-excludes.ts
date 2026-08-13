import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { GitAdapter } from "../adapters/git.js";
import { LOCAL_EXCLUDE_MARKER_END, LOCAL_EXCLUDE_MARKER_START } from "../constants.js";

export async function updateGeneratedExcludes(root: string, paths: string[]): Promise<void> {
  const git = new GitAdapter(root);
  if (!(await git.isRepository())) return;
  const gitPath = await git.run(["rev-parse", "--git-path", "info/exclude"]);
  const filename = path.resolve(root, gitPath);
  let existing = "";
  try {
    existing = await readFile(filename, "utf8");
  } catch {
    // Git creates this file lazily.
  }
  const expression = new RegExp(
    `${LOCAL_EXCLUDE_MARKER_START.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*?${LOCAL_EXCLUDE_MARKER_END.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\r?\\n?`,
    "g",
  );
  const unmanaged = existing.replace(expression, "").trimEnd();
  const generated = [
    LOCAL_EXCLUDE_MARKER_START,
    "/.inlay/materialization.json",
    "/.inlay/transactions/",
    "/dist/",
    ...[...new Set(paths)].sort().map((item) => `/${item}`),
    LOCAL_EXCLUDE_MARKER_END,
  ].join("\n");
  await writeFile(filename, `${unmanaged ? `${unmanaged}\n` : ""}${generated}\n`, "utf8");
}
