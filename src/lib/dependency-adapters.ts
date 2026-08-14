export const SINYTRA_PROJECTS = {
  connector: "u58R1TMW",
  fabricApi: "P7dR8mSH",
  forgifiedFabricApi: "Aqlf1Shp",
  connectorExtras: "FYpiwiBR",
} as const;

export interface ActiveDependencyAdapter {
  id: "sinytra-connector";
  name: "Sinytra Connector";
  projects: string[];
  extensions: string[];
}

export type DependencyResolution =
  | { kind: "exact"; projectId: string }
  | {
      kind: "adapted";
      projectId: string;
      providerProjectId: string;
      adapter: ActiveDependencyAdapter;
    }
  | { kind: "missing"; projectId: string };

/** Compatibility profiles proven by an installed set of immutable Modrinth projects. */
export function activeDependencyAdapters(installedProjects: ReadonlySet<string>): ActiveDependencyAdapter[] {
  if (
    !installedProjects.has(SINYTRA_PROJECTS.connector) ||
    !installedProjects.has(SINYTRA_PROJECTS.forgifiedFabricApi)
  ) {
    return [];
  }
  return [
    {
      id: "sinytra-connector",
      name: "Sinytra Connector",
      projects: [SINYTRA_PROJECTS.connector, SINYTRA_PROJECTS.forgifiedFabricApi],
      extensions: installedProjects.has(SINYTRA_PROJECTS.connectorExtras)
        ? [SINYTRA_PROJECTS.connectorExtras]
        : [],
    },
  ];
}

/** Resolve an exact dependency or one substitution supplied by an active compatibility profile. */
export function resolveDependencyClaim(
  projectId: string,
  installedProjects: ReadonlySet<string>,
): DependencyResolution {
  if (installedProjects.has(projectId)) return { kind: "exact", projectId };
  for (const adapter of activeDependencyAdapters(installedProjects)) {
    if (projectId === SINYTRA_PROJECTS.fabricApi) {
      return {
        kind: "adapted",
        projectId,
        providerProjectId: SINYTRA_PROJECTS.forgifiedFabricApi,
        adapter,
      };
    }
  }
  return { kind: "missing", projectId };
}
