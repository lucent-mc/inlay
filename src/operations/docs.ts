import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { GitAdapter } from "../adapters/git.js";
import { readManifest } from "../manifest/index.js";
import { checkPack } from "./resolve.js";

function escapeCell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}

export async function generateDocs(
  root: string,
  options: { content: boolean; licenses: boolean; stubs: boolean },
) {
  const checked = await checkPack(root);
  const { manifest } = await readManifest(root);
  const docsRoot = path.resolve(root, manifest.docs ?? "docs");
  await mkdir(docsRoot, { recursive: true });
  const written: string[] = [];
  if (options.content) {
    const rows = checked.inventory.content.map(
      (item) =>
        `| ${escapeCell(item.name ?? item.path)} | ${escapeCell(item.kind ?? "other")} | \`${escapeCell(item.path)}\` | ${escapeCell(item.owner)} |`,
    );
    const filename = path.join(docsRoot, "content.md");
    await writeFile(
      filename,
      `# Content\n\n| Name | Kind | Path | Layer |\n| --- | --- | --- | --- |\n${rows.join("\n")}\n`,
      "utf8",
    );
    written.push(path.relative(root, filename).replaceAll("\\", "/"));
  }
  if (options.licenses) {
    const rows = checked.inventory.content.map(
      (item) =>
        `| ${escapeCell(item.name ?? item.path)} | ${escapeCell(item.license ?? "Unknown / manual review required")} | \`${escapeCell(item.path)}\` |`,
    );
    const filename = path.join(docsRoot, "licenses.md");
    await writeFile(
      filename,
      `# Licenses and attribution\n\n| Content | License | Path |\n| --- | --- | --- |\n${rows.join("\n")}\n`,
      "utf8",
    );
    written.push(path.relative(root, filename).replaceAll("\\", "/"));
  }
  if (options.stubs) {
    const manualRoot = path.join(docsRoot, "content");
    await mkdir(manualRoot, { recursive: true });
    for (const item of checked.inventory.content.filter((entry) => !entry.name || !entry.license)) {
      const stem = item.path.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
      const filename = path.join(manualRoot, `${stem}.md`);
      await writeFile(
        filename,
        `---\ninlay:\n  path: ${JSON.stringify(item.path)}\n---\n\n# ${item.name ?? "Document this content"}\n\n- Name:\n- Project URL:\n- License:\n- Attribution:\n`,
        { encoding: "utf8", flag: "wx" },
      ).catch((cause: NodeJS.ErrnoException) => {
        if (cause.code !== "EEXIST") throw cause;
      });
      written.push(path.relative(root, filename).replaceAll("\\", "/"));
    }
  }
  if (written.length > 0) await new GitAdapter(root).stage(written, false);
  return {
    docsRoot: path.relative(root, docsRoot).replaceAll("\\", "/") || ".",
    written,
    diagnostics: checked.diagnostics,
  };
}
