import type { Readable, Writable } from "node:stream";
import { Prompt } from "@clack/core";
import pc from "picocolors";
import type { StatusEntry, StatusState } from "../operations/status.js";

interface Node {
  name: string;
  path: string;
  kind: "directory" | "file";
  state: StatusState;
  children: Node[];
  entry?: StatusEntry;
}

interface View {
  selected: number;
  expanded: Set<string>;
}

export interface StatusIntent {
  kind: "reconcile" | "inspect" | "finish";
  paths: string[];
}

const order: Record<StatusState, number> = {
  untracked: 0,
  conflict: 1,
  updated: 2,
  deleted: 3,
  reconciled: 4,
  unchanged: 5,
};

const symbols: Record<StatusState, string> = {
  untracked: "?",
  conflict: "!",
  updated: "~",
  deleted: "−",
  reconciled: "✓",
  unchanged: "·",
};

function paint(state: StatusState, value: string): string {
  if (state === "conflict" || state === "deleted") return pc.red(value);
  if (state === "untracked" || state === "updated") return pc.yellow(value);
  if (state === "reconciled") return pc.green(value);
  return pc.dim(value);
}

function tree(entries: StatusEntry[]): Node {
  const root: Node = { name: ".", path: "", kind: "directory", state: "unchanged", children: [] };
  for (const entry of entries) {
    const parts = entry.path.split("/");
    let parent = root;
    for (const [index, part] of parts.entries()) {
      const nodePath = parts.slice(0, index + 1).join("/");
      const file = index === parts.length - 1;
      let child = parent.children.find((item) => item.name === part);
      if (!child) {
        child = {
          name: part,
          path: nodePath,
          kind: file ? "file" : "directory",
          state: file ? entry.state : "unchanged",
          children: [],
          ...(file ? { entry } : {}),
        };
        parent.children.push(child);
      }
      parent = child;
    }
  }
  const calculate = (node: Node): StatusState => {
    if (node.kind === "file") return node.state;
    const states = node.children.map(calculate);
    node.state = states.sort((left, right) => order[left] - order[right])[0] ?? "unchanged";
    node.children.sort(
      (left, right) => order[left.state] - order[right.state] || left.name.localeCompare(right.name),
    );
    return node.state;
  };
  calculate(root);
  return root;
}

function visible(root: Node, expanded: Set<string>): Array<{ node: Node; depth: number }> {
  const rows: Array<{ node: Node; depth: number }> = [];
  const visit = (node: Node, depth: number) => {
    if (node !== root) rows.push({ node, depth });
    if (node.kind === "directory" && (node === root || expanded.has(node.path))) {
      for (const child of node.children) visit(child, node === root ? 0 : depth + 1);
    }
  };
  visit(root, 0);
  return rows;
}

function descendants(node: Node): StatusEntry[] {
  if (node.entry) return [node.entry];
  return node.children.flatMap(descendants);
}

function render(entries: StatusEntry[], view: View): string {
  const root = tree(entries);
  const rows = visible(root, view.expanded);
  const counts = Object.fromEntries(
    Object.keys(order).map((state) => [state, entries.filter((entry) => entry.state === state).length]),
  );
  const lines = [
    `${pc.cyan("◆")}  ${pc.bold("lay status")}`,
    `${pc.dim("│")}  ${paint("untracked", `? ${counts["untracked"]}`)}  ${paint("conflict", `! ${counts["conflict"]}`)}  ${paint("updated", `~ ${counts["updated"]}`)}  ${paint("deleted", `− ${counts["deleted"]}`)}  ${paint("reconciled", `✓ ${counts["reconciled"]}`)}  ${paint("unchanged", `· ${counts["unchanged"]}`)}`,
    pc.dim("│"),
  ];
  for (const [index, row] of rows.entries()) {
    const active = index === view.selected;
    const branch = row.node.kind === "directory" ? (view.expanded.has(row.node.path) ? "▾" : "▸") : " ";
    const raw = `${"  ".repeat(row.depth)}${branch} ${row.node.name}`;
    lines.push(
      `${active ? pc.cyan("◆") : pc.dim("│")}  ${paint(row.node.state, symbols[row.node.state])} ${
        active ? pc.bgCyan(pc.black(pc.bold(` ${raw} `))) : row.node.state === "unchanged" ? pc.dim(raw) : raw
      }`,
    );
  }
  const focused = rows[view.selected]?.node;
  if (focused) {
    const affected = descendants(focused);
    lines.push(
      pc.dim("│"),
      `${pc.dim("│")}  ${pc.bold("DETAIL")}`,
      `${pc.dim("│")}  ${pc.cyan(focused.path)}${focused.kind === "directory" ? pc.dim(` · ${affected.length} files`) : ""}`,
    );
    if (focused.entry)
      lines.push(`${pc.dim("│")}  ${focused.entry.detail} ${pc.dim(`· ${focused.entry.owner}`)}`);
  }
  lines.push(
    pc.dim("│"),
    `${pc.cyan("└")}  ${pc.dim("↑↓ navigate  ←→ collapse/expand  enter reconcile  space inspect  q finish")}`,
  );
  return lines.join("\n");
}

export class StatusTreePrompt extends Prompt<StatusIntent> {
  private readonly view: View;
  private readonly entries: StatusEntry[];

  constructor(
    entries: StatusEntry[],
    io: { input: Readable; output: Writable } = { input: process.stdin, output: process.stdout },
  ) {
    const view: View = {
      selected: 0,
      expanded: new Set(),
    };
    super({ ...io, render: () => render(entries, view) }, false);
    this.view = view;
    this.entries = entries;
    this.on("cursor", (action) => {
      const rows = visible(tree(this.entries), this.view.expanded);
      const focused = rows[this.view.selected]?.node;
      if (!focused) return;
      if (action === "up") this.view.selected = Math.max(0, this.view.selected - 1);
      if (action === "down") this.view.selected = Math.min(rows.length - 1, this.view.selected + 1);
      if (action === "right" && focused.kind === "directory" && !this.view.expanded.has(focused.path)) {
        this.view.expanded.add(focused.path);
      } else if (action === "right" && focused.kind === "directory") {
        const child = rows.findIndex((row) => row.node.path.startsWith(`${focused.path}/`));
        if (child >= 0) this.view.selected = child;
      }
      if (action === "left" && focused.kind === "directory" && this.view.expanded.has(focused.path)) {
        this.view.expanded.delete(focused.path);
      } else if (action === "left" && focused.path.includes("/")) {
        const parentPath = focused.path.split("/").slice(0, -1).join("/");
        const parent = rows.findIndex((row) => row.node.path === parentPath);
        if (parent >= 0) this.view.selected = parent;
      }
      if (action === "space") {
        this._setValue({ kind: "inspect", paths: descendants(focused).map((entry) => entry.path) });
        this.state = "submit";
      }
    });
    this.on("key", (character) => {
      if (character?.toLowerCase() !== "q") return;
      this._setValue({ kind: "finish", paths: [] });
      this.state = "submit";
    });
  }

  protected override _shouldSubmit(): boolean {
    const focused = visible(tree(this.entries), this.view.expanded)[this.view.selected]?.node;
    if (!focused) return false;
    this._setValue({ kind: "reconcile", paths: descendants(focused).map((entry) => entry.path) });
    return true;
  }
}
