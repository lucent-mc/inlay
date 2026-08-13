import { error, InlayError, warning } from "../diagnostics.js";
import { contentKey, isDescendant } from "../lib/path.js";
import type {
  Diagnostic,
  Environment,
  Exclusion,
  LayerIdentity,
  ResolvableLayer,
  ResolvedContent,
  ResolvedPack,
} from "../types.js";

function slotKey(path: string, environment: Environment): string {
  return `${contentKey(path)}\0${environment}`;
}

function exclusionMatches(path: string, environment: Environment, exclusion: Exclusion): boolean {
  const environments = exclusion.environments ?? ["client", "server"];
  if (!environments.includes(environment)) return false;
  return (
    contentKey(path) === contentKey(exclusion.path) ||
    (exclusion.recursive === true && isDescendant(path, exclusion.path))
  );
}

function sameDependencies(left: Record<string, string>, right: Record<string, string>): boolean {
  const leftEntries = Object.entries(left).sort(([a], [b]) => a.localeCompare(b));
  const rightEntries = Object.entries(right).sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(leftEntries) === JSON.stringify(rightEntries);
}

function environmentFromSlot(key: string): Environment {
  return key.endsWith("\0client") ? "client" : "server";
}

function checkStructuralConflicts(slots: Map<string, ResolvedContent>): void {
  for (const environment of ["client", "server"] as const) {
    const contents = [...slots.entries()]
      .filter(([key]) => environmentFromSlot(key) === environment)
      .map(([, content]) => content)
      .sort((left, right) => contentKey(left.path).localeCompare(contentKey(right.path)));
    for (let index = 0; index < contents.length - 1; index += 1) {
      const current = contents[index];
      const next = contents[index + 1];
      if (current && next && isDescendant(next.path, current.path)) {
        throw new InlayError(
          error(
            "path-shape-conflict",
            `${current.path} is a file but is also the directory prefix of ${next.path} in the ${environment} environment.`,
            { path: current.path },
          ),
        );
      }
    }
  }
}

export function composeLayers(layers: ResolvableLayer[]): ResolvedPack {
  const current = layers.at(-1);
  if (!current)
    throw new InlayError(error("empty-lineage", "A resolved lineage must contain at least one Layer."));

  const slots = new Map<string, ResolvedContent>();
  const lineage: LayerIdentity[] = [];
  const warnings: Diagnostic[] = [];
  const target = layers[0]?.manifest.dependencies ?? {};

  for (const layer of layers) {
    if (!sameDependencies(target, layer.manifest.dependencies)) {
      throw new InlayError(
        error(
          "runtime-target-mismatch",
          `${layer.identity.name}@${layer.identity.versionId} does not exactly match the lineage Runtime Target.`,
          { layer: `${layer.identity.name}@${layer.identity.versionId}` },
        ),
      );
    }
    lineage.push(layer.identity);
    warnings.push(
      ...(layer.manifest.exclusions ?? []).flatMap((exclusion) => {
        const matched = [...slots.values()].some((content) =>
          (["client", "server"] as const).some((environment) =>
            exclusionMatches(content.path, environment, exclusion),
          ),
        );
        return matched
          ? []
          : [
              warning("exclusion-no-match", `Exclusion ${exclusion.path} matches no parent content.`, {
                path: exclusion.path,
              }),
            ];
      }),
    );

    for (const exclusion of layer.manifest.exclusions ?? []) {
      for (const [key, content] of slots) {
        if (exclusionMatches(content.path, environmentFromSlot(key), exclusion)) slots.delete(key);
      }
    }

    const layerSlots = new Set<string>();
    for (const input of layer.content) {
      for (const environment of ["client", "server"] as const) {
        if (input.env[environment] === "unsupported") continue;
        const key = slotKey(input.path, environment);
        if (layerSlots.has(key)) {
          throw new InlayError(
            error(
              "duplicate-content-slot",
              `${input.path} is declared twice for ${environment} in ${layer.identity.name}.`,
              {
                path: input.path,
              },
            ),
          );
        }
        layerSlots.add(key);
        const inherited = slots.get(key);
        slots.set(key, {
          path: input.path,
          scope: input.scope,
          env: input.env,
          owner: layer.identity,
          declaration: input.declaration,
          payload: input.payload,
          replacementHistory: inherited ? [...inherited.replacementHistory, inherited.owner] : [],
        });
      }
    }
    checkStructuralConflicts(slots);
  }

  return {
    manifest: current.manifest,
    lineage,
    dependencies: { ...target },
    slots,
    warnings,
  };
}

export function resolvedContents(pack: ResolvedPack): ResolvedContent[] {
  const seen = new Set<string>();
  return [...pack.slots.values()]
    .filter((content) => {
      const key = `${contentKey(content.path)}\0${content.owner.source}\0${content.scope}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((left, right) => left.path.localeCompare(right.path));
}
