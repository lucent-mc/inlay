export type Environment = "client" | "server";
export type EnvironmentPolicy = "required" | "optional" | "unsupported";
export type ContentScope = "common" | "client" | "server";
export type DeliveryMode = "bundled" | "github";

export interface FileEnvironment {
  client: EnvironmentPolicy;
  server: EnvironmentPolicy;
}

export interface RemoteHashes {
  sha1: string;
  sha512: string;
  [algorithm: string]: string;
}

export interface RepositoryHashes {
  sha1: string;
  sha256: string;
}

export interface FileDeclarationBase {
  path: string;
  env?: FileEnvironment;
  downloads: string[];
  fileSize: number;
}

export interface RemoteFileDeclaration extends FileDeclarationBase {
  hashes: RemoteHashes;
}

export interface RepositoryFileDeclaration extends FileDeclarationBase {
  hashes: RepositoryHashes;
  downloads: [string];
}

export type FileDeclaration = RemoteFileDeclaration | RepositoryFileDeclaration;

export interface ParentReference {
  url: string;
  version?: string;
  filename?: string;
  hashes: RepositoryHashes;
  fileSize: number;
}

export interface Exclusion {
  path: string;
  recursive?: boolean;
  environments?: Environment[];
}

export interface LayerManifest {
  $schema: string;
  extends?: ParentReference;
  exclusions?: Exclusion[];
  delivery?: "github";
  docs?: string;
  formatVersion: 1;
  game: "minecraft";
  versionId: string;
  name: string;
  summary?: string;
  files: FileDeclaration[];
  dependencies: Record<string, string>;
}

export interface LayerIdentity {
  name: string;
  versionId: string;
  source: string;
  revision?: string;
  imported: boolean;
}

export type PayloadSource =
  | { kind: "remote"; downloads: string[]; hashes: RemoteHashes; fileSize: number }
  | {
      kind: "repository";
      source: string;
      repositoryRoot?: string;
      rawUrl?: string;
      hashes: RepositoryHashes;
      fileSize: number;
    }
  | { kind: "archive"; bytes: Uint8Array; hashes: RemoteHashes; fileSize: number };

export interface ResolvedContent {
  path: string;
  scope: ContentScope;
  env: FileEnvironment;
  owner: LayerIdentity;
  declaration: FileDeclaration;
  payload: PayloadSource;
  replacementHistory: LayerIdentity[];
}

export interface ResolvedPack {
  manifest: LayerManifest;
  lineage: LayerIdentity[];
  dependencies: Record<string, string>;
  slots: Map<string, ResolvedContent>;
  warnings: Diagnostic[];
}

export type DiagnosticSeverity = "info" | "warning" | "error";

export interface Diagnostic {
  code: string;
  severity: DiagnosticSeverity;
  message: string;
  path?: string;
  layer?: string;
  detail?: string;
}

export interface CommandResult<T = unknown> {
  schemaVersion: 1;
  command: string;
  ok: boolean;
  changed: boolean;
  diagnostics: Diagnostic[];
  data: T;
}

export interface ManifestSource {
  kind: "local" | "github" | "url" | "modrinth" | "imported";
  label: string;
  repositoryRoot?: string;
  repositoryUrl?: string;
  commit?: string;
  manifestUrl?: string;
}

export interface LoadedLayer {
  manifest: LayerManifest;
  source: ManifestSource;
  identity: LayerIdentity;
}

export interface LayerContentInput {
  path: string;
  scope: ContentScope;
  env: FileEnvironment;
  declaration: FileDeclaration;
  payload: PayloadSource;
}

export interface ResolvableLayer extends LoadedLayer {
  content: LayerContentInput[];
}
