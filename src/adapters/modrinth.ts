import { error, InlayError } from "../diagnostics.js";

export type ModrinthDependencyType = "required" | "optional" | "incompatible" | "embedded";

export interface ModrinthDependency {
  version_id: string | null;
  project_id: string | null;
  file_name: string | null;
  dependency_type: ModrinthDependencyType;
}

export interface ModrinthVersionFile {
  hashes: Record<string, string>;
  url: string;
  filename: string;
  primary: boolean;
  size: number;
}

export interface ModrinthVersion {
  id: string;
  project_id: string;
  name: string;
  version_number: string;
  game_versions: string[];
  version_type: "release" | "beta" | "alpha";
  loaders: string[];
  dependencies: ModrinthDependency[];
  files: ModrinthVersionFile[];
}

export interface ModrinthProject {
  id: string;
  slug: string;
  title: string;
  project_type: string;
  license: { id: string; name: string; url: string | null };
  categories: string[];
  client_side: "required" | "optional" | "unsupported" | "unknown";
  server_side: "required" | "optional" | "unsupported" | "unknown";
}

export function modrinthIdentityFromUrl(value: string): { projectId: string; versionId: string } | undefined {
  try {
    const url = new URL(value);
    if (url.hostname !== "cdn.modrinth.com") return undefined;
    const match = url.pathname.match(/^\/data\/([^/]+)\/versions\/([^/]+)\//);
    if (!match?.[1] || !match[2]) return undefined;
    return { projectId: match[1], versionId: match[2] };
  } catch {
    return undefined;
  }
}

export class ModrinthAdapter {
  constructor(readonly baseUrl = "https://api.modrinth.com/v2") {}

  private async json<T>(pathname: string): Promise<T> {
    const response = await fetch(`${this.baseUrl}${pathname}`, {
      headers: { "user-agent": "lucent-mc/inlay/0.1.0 (github.com/lucent-mc/inlay)" },
    });
    if (!response.ok) {
      throw new InlayError(error("modrinth-api", `Modrinth ${pathname} returned HTTP ${response.status}.`));
    }
    return (await response.json()) as T;
  }

  version(id: string): Promise<ModrinthVersion> {
    return this.json(`/version/${encodeURIComponent(id)}`);
  }

  project(id: string): Promise<ModrinthProject> {
    return this.json(`/project/${encodeURIComponent(id)}`);
  }

  versions(project: string, minecraft: string, loader?: string): Promise<ModrinthVersion[]> {
    const query = new URLSearchParams({ game_versions: JSON.stringify([minecraft]) });
    if (loader) query.set("loaders", JSON.stringify([loader]));
    return this.json(`/project/${encodeURIComponent(project)}/version?${query}`);
  }
}
