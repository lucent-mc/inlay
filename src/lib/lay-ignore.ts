import { readFile } from "node:fs/promises";
import path from "node:path";
import createIgnore from "ignore";
import { LAYIGNORE_FILENAME } from "../constants.js";
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
