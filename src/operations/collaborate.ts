import { GitAdapter } from "../adapters/git.js";
import { error, InlayError } from "../diagnostics.js";
import type { Environment } from "../types.js";
import { materialize } from "./materialize.js";
import { checkPack } from "./resolve.js";
import { status } from "./status.js";

async function preflight(root: string): Promise<void> {
  const report = await status(root);
  const managed = report.entries.filter((entry) => entry.state === "conflict");
  if (managed.length > 0) {
    throw new InlayError(
      managed.map((entry) =>
        error("managed-drift", `${entry.path} has unresolved managed drift.`, {
          path: entry.path,
          layer: entry.owner,
        }),
      ),
    );
  }
}

export async function fetchLayer(root: string) {
  const git = new GitAdapter(root);
  await git.run(["fetch"]);
  const checked = await checkPack(root);
  return { lineage: checked.pack.lineage, cachedContent: checked.payloads.size };
}

export async function pullLayer(root: string, environment: Environment) {
  await preflight(root);
  const git = new GitAdapter(root);
  await git.run(["pull"]);
  return materialize(root, environment);
}

export async function switchLayer(root: string, branch: string, environment: Environment) {
  await preflight(root);
  const git = new GitAdapter(root);
  await git.run(["switch", branch]);
  return materialize(root, environment);
}
