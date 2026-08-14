import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import createIgnore from "ignore";
import { DEFAULT_LAYIGNORE, LAYIGNORE_FILENAME } from "../constants.js";
import { repositoryRelativePath } from "./path.js";

export interface LayIgnore {
  ignores(candidate: string): boolean;
}

/** Load the repository-owned Layer-discovery policy. Missing files mean no additional exclusions. */
export async function readLayIgnore(root: string): Promise<LayIgnore> {
  const matcher = createIgnore();
  try {
    matcher.add(await readFile(path.join(root, LAYIGNORE_FILENAME), "utf8"));
  } catch {
    // The built-in candidate policy remains active without a repository policy file.
  }
  return {
    ignores(candidate: string): boolean {
      return matcher.ignores(repositoryRelativePath(candidate));
    },
  };
}

function literalPattern(candidate: string): string {
  const escaped = repositoryRelativePath(candidate).replaceAll(/[\\*?[\] ]/gu, "\\$&");
  return `/${escaped}`;
}

/** Persist one exact path as repository-owned implicit-discovery policy. */
export async function preserveWithLayIgnore(root: string, candidate: string): Promise<void> {
  const filename = path.join(root, LAYIGNORE_FILENAME);
  let contents = DEFAULT_LAYIGNORE;
  try {
    contents = await readFile(filename, "utf8");
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
  }
  const separator = contents.length > 0 && !contents.endsWith("\n") ? "\n" : "";
  await writeFile(filename, `${contents}${separator}${literalPattern(candidate)}\n`);
}
