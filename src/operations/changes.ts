import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import * as p from "@clack/prompts";
import semver from "semver";
import YAML from "yaml";
import { GitAdapter } from "../adapters/git.js";
import { modrinthIdentityFromUrl } from "../adapters/modrinth.js";
import { MANIFEST_FILENAME } from "../constants.js";
import { error, InlayError } from "../diagnostics.js";
import { readManifest, writeManifest } from "../manifest/index.js";
import type { FileDeclaration, LayerManifest } from "../types.js";

type Bump = "patch" | "minor" | "major";
type ChangeAction = "add" | "update" | "remove";

interface ChangeEntry {
  action: ChangeAction;
  kind: string;
  path: string;
  previousPath?: string;
  related?: string;
}

interface Fragment {
  bump: Bump;
  changes: ChangeEntry[];
  body: string;
}

function kind(value: string): string {
  if (value.startsWith("mods/")) return "mod";
  if (value.startsWith("resourcepacks/")) return "resource-pack";
  if (value.startsWith("shaderpacks/")) return "shader-pack";
  if (value.startsWith("datapacks/")) return "data-pack";
  if (value.startsWith("config/")) return "config";
  if (value === MANIFEST_FILENAME) return "parent";
  return "other";
}

function fileIdentity(file: FileDeclaration): string {
  const provider = file.downloads.map(modrinthIdentityFromUrl).find(Boolean);
  return provider ? `modrinth:${provider.projectId}` : `path:${file.path.toLowerCase()}`;
}

function manifestEntries(previous: LayerManifest, current: LayerManifest): ChangeEntry[] {
  const before = new Map(previous.files.map((file) => [fileIdentity(file), file]));
  const after = new Map(current.files.map((file) => [fileIdentity(file), file]));
  const entries: ChangeEntry[] = [];
  for (const [identity, file] of after) {
    const old = before.get(identity);
    if (!old) {
      entries.push({ action: "add", kind: kind(file.path), path: file.path });
    } else if (JSON.stringify(old) !== JSON.stringify(file)) {
      entries.push({
        action: "update",
        kind: kind(file.path),
        path: file.path,
        ...(old.path === file.path ? {} : { previousPath: old.path }),
      });
    }
  }
  for (const [identity, file] of before) {
    if (!after.has(identity)) entries.push({ action: "remove", kind: kind(file.path), path: file.path });
  }
  const beforeExclusions = new Set((previous.exclusions ?? []).map((entry) => JSON.stringify(entry)));
  const afterExclusions = new Set((current.exclusions ?? []).map((entry) => JSON.stringify(entry)));
  for (const encoded of afterExclusions) {
    if (beforeExclusions.has(encoded)) continue;
    const exclusion = JSON.parse(encoded) as { path: string };
    entries.push({ action: "remove", kind: kind(exclusion.path), path: exclusion.path });
  }
  for (const encoded of beforeExclusions) {
    if (afterExclusions.has(encoded)) continue;
    const exclusion = JSON.parse(encoded) as { path: string };
    entries.push({ action: "add", kind: kind(exclusion.path), path: exclusion.path });
  }
  if (JSON.stringify(previous.extends) !== JSON.stringify(current.extends)) {
    entries.push({ action: "update", kind: "parent", path: "extends" });
  }
  return entries;
}

async function stagedEntries(root: string, git: GitAdapter): Promise<ChangeEntry[]> {
  const staged = await git.staged();
  if (staged.includes(MANIFEST_FILENAME)) {
    const current = (await readManifest(root)).manifest;
    let previous: LayerManifest;
    try {
      previous = JSON.parse(
        new TextDecoder().decode(await git.readAtHead(MANIFEST_FILENAME)),
      ) as LayerManifest;
    } catch {
      previous = { ...current, files: [], exclusions: [] };
      delete previous.extends;
    }
    const derived = manifestEntries(previous, current);
    if (derived.length > 0) return derived;
  }
  const output = await git.run(["diff", "--cached", "--name-status", "--", ".", `:!${MANIFEST_FILENAME}`]);
  return output
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [status = "M", ...parts] = line.split("\t");
      const current = parts.at(-1) ?? "unknown";
      return {
        action: status.startsWith("A") ? "add" : status.startsWith("D") ? "remove" : "update",
        kind: kind(current),
        path: current,
        ...(status.startsWith("R") && parts[0] ? { previousPath: parts[0] } : {}),
      } as ChangeEntry;
    });
}

export async function createChange(
  root: string,
  options: { bump?: Bump; message?: string; interactive: boolean; dryRun?: boolean },
) {
  const git = new GitAdapter(root);
  const changes = await stagedEntries(root, git);
  if (changes.length === 0)
    throw new InlayError(error("changes-empty", "No staged content changes were found."), 2);
  let bump = options.bump;
  if (!bump && options.interactive) {
    const answer = await p.select({
      message: "Version impact",
      options: ["patch", "minor", "major"].map((value) => ({ value, label: value })),
    });
    if (p.isCancel(answer)) throw new InlayError(error("cancelled", "Change creation cancelled."));
    bump = answer as Bump;
  }
  if (!bump)
    throw new InlayError(error("changes-bump-required", "--bump is required in non-interactive mode."), 2);
  let body = options.message;
  if (!body && options.interactive) {
    const answer = await p.text({ message: "Describe this pack change" });
    if (p.isCancel(answer)) throw new InlayError(error("cancelled", "Change creation cancelled."));
    body = String(answer).trim();
  }
  const identifier = `${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}-${Math.random().toString(36).slice(2, 8)}`;
  const relative = `.inlay/changes/${identifier}.md`;
  if (options.dryRun === true) return { path: relative, bump, changes };
  await mkdir(path.join(root, ".inlay", "changes"), { recursive: true });
  const frontmatter = YAML.stringify({ bump, changes }).trimEnd();
  await writeFile(path.join(root, relative), `---\n${frontmatter}\n---\n\n${body ?? ""}\n`, "utf8");
  await git.stage([relative], false);
  return { path: relative, bump, changes };
}

function parseFragment(source: string): Fragment {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match?.[1])
    throw new InlayError(error("change-fragment-invalid", "Change fragment requires YAML frontmatter."));
  const data = YAML.parse(match[1]) as { bump?: Bump; changes?: ChangeEntry[] };
  if (!data.bump || !["patch", "minor", "major"].includes(data.bump) || !Array.isArray(data.changes)) {
    throw new InlayError(error("change-fragment-invalid", "Change fragment bump/changes are invalid."));
  }
  return { bump: data.bump, changes: data.changes, body: (match[2] ?? "").trim() };
}

export async function versionLayer(root: string, options: { dryRun: boolean }) {
  const directory = path.join(root, ".inlay", "changes");
  const names = await readdir(directory).catch(() => [] as string[]);
  const filenames = names.filter((name) => name.endsWith(".md")).sort();
  if (filenames.length === 0)
    throw new InlayError(error("change-fragments-missing", "No .inlay/changes fragments exist."), 2);
  const fragments = await Promise.all(
    filenames.map(async (name) => parseFragment(await readFile(path.join(directory, name), "utf8"))),
  );
  const rank: Record<Bump, number> = { patch: 0, minor: 1, major: 2 };
  const bump = fragments.map((fragment) => fragment.bump).sort((a, b) => rank[b] - rank[a])[0] ?? "patch";
  const { manifest } = await readManifest(root);
  const previousVersion = manifest.versionId;
  const next = semver.inc(manifest.versionId, bump);
  if (!next) throw new InlayError(error("version-invalid", `${manifest.versionId} is not valid SemVer.`));
  const sections = fragments.map(
    (fragment) =>
      fragment.body ||
      fragment.changes.map((change) => `- ${change.action} ${change.kind} ${change.path}`).join("\n"),
  );
  const changelog = path.join(root, "CHANGELOG.md");
  let previous = "# Changelog\n";
  try {
    previous = await readFile(changelog, "utf8");
  } catch {
    /* first release */
  }
  const updated = `${previous.trimEnd()}\n\n## ${next}\n\n${sections.join("\n\n")}\n`;
  if (options.dryRun)
    return {
      previousVersion: manifest.versionId,
      version: next,
      bump,
      fragments: filenames,
      wouldWrite: [MANIFEST_FILENAME, "CHANGELOG.md"],
    };
  manifest.versionId = next;
  await writeManifest(root, manifest);
  await writeFile(changelog, updated, "utf8");
  await Promise.all(filenames.map((name) => rm(path.join(directory, name))));
  const git = new GitAdapter(root);
  await git.stage(
    [MANIFEST_FILENAME, "CHANGELOG.md", ...filenames.map((name) => `.inlay/changes/${name}`)],
    false,
  );
  return { previousVersion, version: next, bump, fragments: filenames };
}
