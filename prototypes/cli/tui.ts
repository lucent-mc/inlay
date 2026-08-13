import { Prompt } from "@clack/core";
import * as p from "@clack/prompts";
import type { Readable, Writable } from "node:stream";
import { pathToFileURL } from "node:url";
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

  lines.push(pc.dim("│"), `${pc.cyan("└")}  ${pc.dim("↑↓ navigate  ←→ collapse/expand  enter reconcile  space inspect  q finish")}`);
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

interface PromptIo {
  input: Readable;
  output: Writable;
}

interface TreeIntent {
  kind: "reconcile" | "inspect" | "finish";
  path?: string;
}

interface TreeViewState {
  selected: number;
  expanded: Set<string>;
}

class TreePrompt extends Prompt<TreeIntent> {
  private readonly view: TreeViewState;

  constructor(view: TreeViewState, io: PromptIo) {
    super(
      {
        ...io,
        render() {
          return renderTree(view.selected, view.expanded);
        },
      },
      false,
    );
    this.view = view;

    this.on("cursor", (action) => {
      const visible = flattenVisible(buildTree(entries), this.view.expanded);
      const node = visible[this.view.selected]?.node;
      if (!node) return;

      if (action === "up") this.view.selected = Math.max(0, this.view.selected - 1);
      if (action === "down") this.view.selected = Math.min(visible.length - 1, this.view.selected + 1);
      if (action === "right" && node.kind === "directory" && !this.view.expanded.has(node.path)) {
        this.view.expanded.add(node.path);
      } else if (action === "right" && node.kind === "directory") {
        const firstChild = visible.findIndex((item) => item.node.path.startsWith(`${node.path}/`));
        if (firstChild >= 0) this.view.selected = firstChild;
      }
      if (action === "left" && node.kind === "directory" && this.view.expanded.has(node.path)) {
        this.view.expanded.delete(node.path);
      } else if (action === "left" && node.path.includes("/")) {
        const parentPath = node.path.split("/").slice(0, -1).join("/");
        const parent = visible.findIndex((item) => item.node.path === parentPath);
        if (parent >= 0) this.view.selected = parent;
      }
      if (action === "space") {
        this._setValue({ kind: "inspect", path: node.path });
        this.state = "submit";
      }
    });

    this.on("key", (character) => {
      if (character?.toLowerCase() !== "q") return;
      this._setValue({ kind: "finish" });
      this.state = "submit";
    });
  }

  protected override _shouldSubmit(): boolean {
    const visible = flattenVisible(buildTree(entries), this.view.expanded);
    const node = visible[this.view.selected]?.node;
    if (!node) return false;
    this._setValue({ kind: "reconcile", path: node.path });
    return true;
  }
}

function findNode(path: string, expanded: Set<string>): TreeNode | undefined {
  return flattenVisible(buildTree(entries), expanded).find((item) => item.node.path === path)?.node;
}

async function reconcile(node: TreeNode, io: PromptIo) {
  const unresolved = descendants(node).filter((entry) => !["reconciled", "unchanged"].includes(entry.state));
  if (unresolved.length === 0) {
    p.note("Every selected file is already internally consistent.", node.path);
    return;
  }
  const action = await p.select({
    ...io,
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

export async function runInteractive(io: PromptIo = { input: process.stdin, output: process.stdout }) {
  const view: TreeViewState = {
    selected: 0,
    expanded: new Set(["config", "mods", "resourcepacks"]),
  };
  p.intro("lay status · prototype");

  while (true) {
    const intent = await new TreePrompt(view, io).prompt();
    if (p.isCancel(intent) || intent?.kind === "finish") break;
    if (!intent?.path) continue;
    const node = findNode(intent.path, view.expanded);
    if (!node) continue;
    if (intent.kind === "reconcile") await reconcile(node, io);
    if (intent.kind === "inspect") {
      p.note(descendants(node).map((entry) => `${stateSymbol[entry.state]} ${entry.path}\n  ${entry.owner}\n  ${entry.detail}`).join("\n"), node.path);
    }
  }

  const staged = entries.filter((entry) => entry.staged);
  if (staged.length > 0) {
    const commit = await p.confirm({ ...io, message: "Commit all staged changes now?", initialValue: false });
    if (commit === true) {
      p.note(`${staged.map((entry) => `  ${entry.path}`).join("\n")}\n\nchore(layer): reconcile ${staged.length} managed file${staged.length === 1 ? "" : "s"}`, "lay commit preview");
    } else {
      p.note(`${staged.length} staged path${staged.length === 1 ? "" : "s"} left intact.`, "Not committed");
    }
  }
  p.outro("Prototype changed no files or Git state.");
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  if (args.has("--help") || args.has("-h")) console.log(help);
  else if (args.has("--demo")) console.log(`${renderTree()}\n\n${help}`);
  else await runInteractive();
}
