import * as p from "@clack/prompts";
import readline from "node:readline";
import pc from "picocolors";
import {
  buildTree,
  descendants,
  entries,
  flattenVisible,
  stateLabel,
  stateSymbol,
  type FileEntry,
  type TreeNode,
} from "./model.ts";

const args = new Set(process.argv.slice(2));

const help = `lay · author layered Minecraft packs from a playable instance

START
  lay init                         create a root Layer
  lay fork <source> [selector]     create and hydrate a child Layer

AUTHOR
  lay status                       inspect and reconcile the instance tree
  lay reconcile <path>             reconcile one exact unresolved file
  lay add|install|i <content>       add content and required dependencies
  lay remove|rm|uninstall <content> remove content and reconcile dependencies
  lay list [--resolved]             inspect lineage or effective Pack inventory

VERIFY & BUILD
  lay check|validate               validate manifest, lineage, bytes, and dependencies
  lay build                        preflight status, check, then package an .mrpack

COLLABORATE
  lay fetch                        Git fetch plus verified external-content prefetch
  lay pull                         Git pull, then hydrate non-Git managed content
  lay switch|checkout <branch>     Git switch, then hydrate non-Git managed content
  lay parent show|set|update|remove

RELEASE PREPARATION
  lay changes                      write a structured change fragment
  lay version                      apply fragments, version, changelog, and docs
  lay commit [-m <context>]        validate and commit every staged path
  lay migrate                      migrate one manifest-schema major

AUTOMATION
  --no-interactive                 never prompt; unresolved choices fail
  --json                           emit stable machine-readable results
  --dry-run                        show the complete write plan without applying it

Builds require Inlay consistency, not a clean Git worktree.`;

function renderTree(selected = 0, expanded = new Set(["config", "mods", "resourcepacks"])): string {
  const root = buildTree(entries);
  const visible = flattenVisible(root, expanded);
  const counts = Object.fromEntries(
    Object.keys(stateLabel).map((state) => [state, entries.filter((entry) => entry.state === state).length]),
  );
  const lines = [
    `${pc.cyan("◆")}  ${pc.bold("lay status")} ${pc.dim("· Lucent Vanilla@1.4.0 · client instance")}`,
    `${pc.dim("│")}  ${paintState("untracked", `? ${counts.untracked}`)}  ${paintState("conflict", `! ${counts.conflict}`)}  ${paintState("updated", `~ ${counts.updated}`)}  ${paintState("deleted", `− ${counts.deleted}`)}  ${paintState("reconciled", `✓ ${counts.reconciled}`)}  ${paintState("unchanged", `· ${counts.unchanged}`)}`,
    pc.dim("│"),
  ];

  for (const [index, item] of visible.entries()) {
    const { node, depth } = item;
    const active = index === selected;
    const cursor = active ? pc.cyan("◆") : pc.dim("│");
    const branch = node.kind === "directory" ? (expanded.has(node.path) ? "▾" : "▸") : " ";
    const rawLabel = `${"  ".repeat(depth)}${branch} ${node.name}`;
    const label = `${"  ".repeat(depth)}${pc.dim(branch)} ${node.name}`;
    const paintedLabel = active
      ? pc.bgCyan(pc.black(pc.bold(` ${rawLabel} `)))
      : node.state === "unchanged"
        ? pc.dim(label)
        : label;
    lines.push(`${cursor}  ${paintState(node.state, stateSymbol[node.state])} ${paintedLabel}`);
  }

  const focus = visible[selected]?.node;
  if (focus) {
    const affected = descendants(focus);
    lines.push(pc.dim("│"), `${pc.dim("│")}  ${pc.bold("DETAIL")}`);
    lines.push(`${pc.dim("│")}  ${pc.cyan(focus.path)}${focus.kind === "directory" ? pc.dim(` · ${affected.length} files`) : ""}`);
    if (focus.entry) {
      lines.push(`${pc.dim("│")}  ${stateLabel[focus.entry.state]} ${pc.dim(`· ${focus.entry.owner}`)}`);
      lines.push(`${pc.dim("│")}  ${pc.dim(focus.entry.detail)}`);
    } else {
      const summary = [...new Set(affected.map((entry) => stateLabel[entry.state]))].join(" · ");
      lines.push(`${pc.dim("│")}  ${pc.dim(summary)}`);
    }
  }

  lines.push(pc.dim("│"), `${pc.cyan("└")}  ${pc.dim("↑↓ navigate  ←→ collapse/expand  space reconcile  enter inspect  q finish")}`);
  return lines.join("\n");
}

function paintState(state: FileEntry["state"], value: string): string {
  switch (state) {
    case "conflict":
    case "deleted":
      return pc.red(value);
    case "untracked":
    case "updated":
      return pc.yellow(value);
    case "reconciled":
      return pc.green(value);
    case "unchanged":
      return pc.dim(value);
  }
}

function actionsFor(entry: FileEntry): Array<{ value: string; label: string; hint?: string }> {
  switch (entry.state) {
    case "untracked":
      return [
        { value: "add", label: "Add to this Layer", hint: "declare, hash, and stage" },
        { value: "preserve", label: "Preserve locally", hint: "untracked and unpackaged" },
      ];
    case "conflict":
      return [
        { value: "adopt", label: "Adopt in this Layer", hint: "override, or atomic exclusion + addition" },
        { value: "restore", label: "Restore inherited content", hint: "stages nothing" },
        { value: "upstream", label: `Track in ${entry.owner}`, hint: "stop and update the owning Layer" },
      ];
    case "updated":
      return [
        { value: "record", label: "Record changed bytes", hint: "update hashes and size" },
        { value: "restore", label: "Restore declared bytes" },
      ];
    case "deleted":
      return [
        { value: "remove", label: "Remove from this Layer", hint: "stage declaration and source deletion" },
        { value: "restore", label: "Restore declared bytes" },
      ];
    default:
      return [{ value: "inspect", label: "No reconciliation needed" }];
  }
}

function readKey(): Promise<{ sequence?: string; name?: string; ctrl?: boolean }> {
  readline.emitKeypressEvents(process.stdin);
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  return new Promise((resolve) => process.stdin.once("keypress", (_sequence, key) => resolve(key)));
}

function leaveRawMode() {
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
}

async function reconcile(node: TreeNode) {
  leaveRawMode();
  const unresolved = descendants(node).filter((entry) => !["reconciled", "unchanged"].includes(entry.state));
  if (unresolved.length === 0) {
    p.note("Every selected file is already internally consistent.", node.path);
    return;
  }
  const action = await p.select({
    message: unresolved.length === 1 ? `Reconcile ${unresolved[0].path}` : `Reconcile ${unresolved.length} files recursively`,
    options: actionsFor(unresolved[0]),
  });
  if (p.isCancel(action) || action === "inspect") return;
  if (action === "upstream") {
    p.note("No Layer or Git state changed. Apply and release this change in the named owning Layer, then update this Layer's immutable Parent Reference.", "Upstream work required");
    return;
  }
  for (const entry of unresolved) {
    if (action === "restore" || action === "preserve") {
      entry.state = "unchanged";
      entry.staged = false;
    } else {
      entry.state = "reconciled";
      entry.staged = true;
      entry.detail = "Portable current-Layer representation is internally consistent and staged";
    }
  }
}

async function runInteractive() {
  let selected = 0;
  const expanded = new Set(["config", "mods", "resourcepacks"]);
  p.intro("lay status · prototype");

  while (true) {
    console.clear();
    console.log(renderTree(selected, expanded));
    const root = buildTree(entries);
    const visible = flattenVisible(root, expanded);
    const key = await readKey();
    if (key.name === "up") selected = Math.max(0, selected - 1);
    if (key.name === "down") selected = Math.min(visible.length - 1, selected + 1);
    if (key.name === "right") {
      const node = visible[selected]?.node;
      if (node?.kind === "directory" && !expanded.has(node.path)) expanded.add(node.path);
      else if (node?.kind === "directory") {
        const firstChild = visible.findIndex((item) => item.node.path.startsWith(`${node.path}/`));
        if (firstChild >= 0) selected = firstChild;
      }
    }
    if (key.name === "left") {
      const node = visible[selected]?.node;
      if (node?.kind === "directory" && expanded.has(node.path)) expanded.delete(node.path);
      else if (node?.path.includes("/")) {
        const parentPath = node.path.split("/").slice(0, -1).join("/");
        const parent = visible.findIndex((item) => item.node.path === parentPath);
        if (parent >= 0) selected = parent;
      }
    }
    if (key.name === "space") await reconcile(visible[selected].node);
    if (key.name === "return") {
      leaveRawMode();
      const node = visible[selected].node;
      p.note(descendants(node).map((entry) => `${stateSymbol[entry.state]} ${entry.path}\n  ${entry.owner}\n  ${entry.detail}`).join("\n"), node.path);
    }
    if (key.name === "q" || (key.ctrl && key.name === "c")) break;
  }

  leaveRawMode();
  const staged = entries.filter((entry) => entry.staged);
  if (staged.length > 0) {
    const commit = await p.confirm({ message: "Commit all staged changes now?", initialValue: false });
    if (commit === true) {
      p.note(`${staged.map((entry) => `  ${entry.path}`).join("\n")}\n\nchore(layer): reconcile ${staged.length} managed file${staged.length === 1 ? "" : "s"}`, "lay commit preview");
    } else {
      p.note(`${staged.length} staged path${staged.length === 1 ? "" : "s"} left intact.`, "Not committed");
    }
  }
  p.outro("Prototype changed no files or Git state.");
}

if (args.has("--help") || args.has("-h")) console.log(help);
else if (args.has("--demo")) console.log(`${renderTree()}\n\n${help}`);
else await runInteractive();
