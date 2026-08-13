import { verifyBytes } from "../adapters/cache.js";
import { GitAdapter } from "../adapters/git.js";
import { error, InlayError } from "../diagnostics.js";
import { deriveInventory, type InventoryResult } from "../inventory.js";
import { digest } from "../lib/hash.js";
import { isRepositoryFile } from "../manifest/index.js";
import { composeLayers, resolvedContents } from "../resolution/compose.js";
import { LineageResolver, readPayload } from "../resolution/parents.js";
import type { Diagnostic, ResolvedPack } from "../types.js";

export interface CheckedPack {
  pack: ResolvedPack;
  payloads: Map<string, Uint8Array>;
  inventory: InventoryResult;
  diagnostics: Diagnostic[];
}

export async function checkPack(root: string): Promise<CheckedPack> {
  const resolver = new LineageResolver();
  const layers = await resolver.local(root);
  const pack = composeLayers(layers);
  const payloads = new Map<string, Uint8Array>();
  const diagnostics = [...pack.warnings];
  const git = new GitAdapter(root);

  for (const content of resolvedContents(pack)) {
    const bytes = await readPayload(content.payload, resolver.http);
    const key = content.path.toLowerCase();
    payloads.set(key, bytes);
    if (content.payload.kind === "repository") {
      verifyBytes(
        bytes,
        {
          fileSize: content.payload.fileSize,
          sha1: content.payload.hashes.sha1,
          sha256: content.payload.hashes.sha256,
        },
        content.path,
      );
      if (content.payload.repositoryRoot && isRepositoryFile(content.declaration)) {
        const source = content.declaration.downloads[0].slice(2);
        if (!(await git.isTracked(source))) {
          throw new InlayError(
            error("repository-source-untracked", `${source} must be tracked by Git.`, { path: source }),
          );
        }
      }
    } else if (content.payload.kind === "archive") {
      verifyBytes(
        bytes,
        {
          fileSize: content.payload.fileSize,
          sha1: content.payload.hashes.sha1,
          sha512: content.payload.hashes.sha512,
        },
        content.path,
      );
    }
  }

  const inventory = await deriveInventory(pack, payloads);
  diagnostics.push(...inventory.diagnostics);
  if (diagnostics.some((item) => item.severity === "error")) {
    throw new InlayError(diagnostics.filter((item) => item.severity === "error"));
  }
  return { pack, payloads, inventory, diagnostics };
}

export function packFingerprint(pack: ResolvedPack): string {
  const identity = pack.lineage
    .map((layer) => `${layer.source}@${layer.revision ?? layer.versionId}`)
    .join("\n");
  return digest(new TextEncoder().encode(identity), "sha256");
}
