import * as p from "@clack/prompts";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createManifestValidator,
  describeBuild,
  summarizeManifest,
} from "./model.ts";

const prototypeDirectory = dirname(fileURLToPath(import.meta.url));
const examplesDirectory = join(prototypeDirectory, "examples");

async function loadJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8"));
}

async function loadExamples() {
  const names = (await readdir(examplesDirectory))
    .filter((name) => name.endsWith(".json"))
    .sort();

  return Promise.all(names.map(async (name) => ({
    name,
    manifest: await loadJson(join(examplesDirectory, name)),
  })));
}

const schema = await loadJson(join(prototypeDirectory, "inlay.schema.prototype.json"));
if (typeof schema !== "object" || schema === null || Array.isArray(schema)) {
  throw new TypeError("Prototype schema must be a JSON object");
}

const validate = createManifestValidator(schema);
const examples = await loadExamples();

if (process.argv.includes("--check")) {
  let failed = false;
  for (const example of examples) {
    const result = validate(example.manifest);
    const status = result.valid ? "valid" : "INVALID";
    console.log(`${status.padEnd(7)} ${example.name}`);
    for (const error of result.errors) console.log(`        ${error}`);
    failed ||= !result.valid;
  }
  process.exitCode = failed ? 1 : 0;
} else {
  p.intro("Inlay manifest shape prototype");
  p.note(
    "An inlay.index.json is one Modrinth-shaped document. HTTPS and repository-relative entries share files[] and compose by destination path.",
    "Question under test",
  );

  while (true) {
    const selection = await p.select({
      message: "Inspect a representative manifest",
      options: [
        ...examples.map((example) => ({
          value: example.name,
          label: example.name,
        })),
        { value: "quit", label: "Finish" },
      ],
    });

    if (p.isCancel(selection) || selection === "quit") break;
    const example = examples.find((candidate) => candidate.name === selection);
    if (!example) continue;

    const result = validate(example.manifest);
    const summary = summarizeManifest(example.manifest);
    const report = [
      `Schema: ${result.valid ? "valid" : "INVALID"}`,
      `Parent: ${summary.parent}`,
      `Files: ${summary.remoteFiles} HTTPS, ${summary.repositoryFiles} repository-backed`,
      `Repository delivery: ${summary.delivery}`,
      "",
      ...describeBuild(summary),
      ...(result.errors.length > 0 ? ["", ...result.errors] : []),
    ].join("\n");

    p.note(report, "Resolution preview");
    p.note(JSON.stringify(example.manifest, null, 2), "inlay.index.json");
  }

  p.outro("Prototype finished; no files were changed.");
}
