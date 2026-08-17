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
  selectedPaths: Set<string>;
  selectionAnchor?: number;
}

interface TerminalWritable extends Writable {
  rows?: number;
}

export type StatusTreeWindowItem =
  | { kind: "row"; index: number }
  | { kind: "overflow"; direction: "above" | "below"; count: number };

export interface StatusTreeRenderOptions {
  selected?: number;
  expanded?: ReadonlySet<string>;
  selectedPaths?: ReadonlySet<string>;
  terminalRows?: number;
}

export interface StatusIntent {
  kind: "reconcile" | "inspect" | "finish";
  paths: string[];
  target?: string;
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

function selectable(node: Node): node is Node & { entry: StatusEntry } {
  return (
    node.kind === "file" &&
    node.entry !== undefined &&
    ["untracked", "conflict", "updated", "deleted"].includes(node.entry.state)
  );
}

function selectableEntries(node: Node): StatusEntry[] {
  return descendants(node).filter((entry) =>
    ["untracked", "conflict", "updated", "deleted"].includes(entry.state),
  );
}

function selectionState(node: Node, selectedPaths: ReadonlySet<string>): "all" | "some" | "none" {
  const entries = selectableEntries(node);
  const selected = entries.filter((entry) => selectedPaths.has(entry.path)).length;
  if (selected === 0) return "none";
  return selected === entries.length ? "all" : "some";
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function statusTreeWindow(
  totalRows: number,
  selectedRow: number,
  capacity: number,
): StatusTreeWindowItem[] {
  const total = Math.max(0, Math.floor(totalRows));
  const available = Math.max(0, Math.floor(capacity));
  if (total === 0 || available === 0) return [];
  const selected = clamp(Math.floor(selectedRow), 0, total - 1);
  if (total <= available) {
    return Array.from({ length: total }, (_, index) => ({ kind: "row" as const, index }));
  }
  if (available === 1) return [{ kind: "row", index: selected }];
  if (available === 2) {
    const hiddenAbove = selected;
    const hiddenBelow = total - selected - 1;
    return hiddenAbove > hiddenBelow
      ? [
          { kind: "overflow", direction: "above", count: hiddenAbove },
          { kind: "row", index: selected },
        ]
      : [
          { kind: "row", index: selected },
          { kind: "overflow", direction: "below", count: hiddenBelow },
        ];
  }

  const middleRows = available - 2;
  const centeredStart = selected - Math.floor(middleRows / 2);
  const centeredEnd = centeredStart + middleRows;
  const edgeRows = available - 1;
  if (centeredStart <= 0) {
    return [
      ...Array.from({ length: edgeRows }, (_, index) => ({ kind: "row" as const, index })),
      { kind: "overflow", direction: "below", count: total - edgeRows },
    ];
  }
  if (centeredEnd >= total) {
    const start = total - edgeRows;
    return [
      { kind: "overflow", direction: "above", count: start },
      ...Array.from({ length: edgeRows }, (_, offset) => ({
        kind: "row" as const,
        index: start + offset,
      })),
    ];
  }

  const start = centeredStart;
  const end = start + middleRows;
  return [
    { kind: "overflow", direction: "above", count: start },
    ...Array.from({ length: middleRows }, (_, offset) => ({
      kind: "row" as const,
      index: start + offset,
    })),
    { kind: "overflow", direction: "below", count: total - end },
  ];
}

function measuredTerminalRows(output: Writable): number {
  const rows = (output as TerminalWritable).rows;
  return typeof rows === "number" && Number.isFinite(rows) && rows > 0 ? Math.floor(rows) : 24;
}

function render(entries: StatusEntry[], view: View, requestedTerminalRows: number): string {
  const root = tree(entries);
  const rows = visible(root, view.expanded);
  const terminalRows = Math.max(1, Math.floor(requestedTerminalRows));
  const selected = rows.length === 0 ? 0 : clamp(view.selected, 0, rows.length - 1);
  const focused = rows[selected]?.node;
  const counts = Object.fromEntries(
    Object.keys(order).map((state) => [state, entries.filter((entry) => entry.state === state).length]),
  );
  const title = `${pc.cyan("◆")}  ${pc.bold("lay status")}`;
  const totals = `${pc.dim("│")}  ${paint("untracked", `? ${counts["untracked"]}`)}  ${paint("conflict", `! ${counts["conflict"]}`)}  ${paint("updated", `~ ${counts["updated"]}`)}  ${paint("deleted", `− ${counts["deleted"]}`)}  ${paint("reconciled", `✓ ${counts["reconciled"]}`)}  ${paint("unchanged", `· ${counts["unchanged"]}`)}`;
  const help = `${pc.cyan("└")}  ${pc.dim("↑↓ navigate  shift+↑↓ range  space select  ←→ expand/collapse  i inspect  enter reconcile  q finish")}`;
  const header = terminalRows <= 1 ? [] : terminalRows < 4 ? [title] : [title, totals];
  if (terminalRows >= 6) header.push(pc.dim("│"));
  const footer = terminalRows < 3 ? [] : [help];
  if (terminalRows >= 6) footer.unshift(pc.dim("│"));

  const detail: string[] = [];
  if (focused && terminalRows >= 12) {
    const affected = descendants(focused);
    const unresolved = affected.filter((entry) =>
      ["untracked", "conflict", "updated", "deleted"].includes(entry.state),
    ).length;
    detail.push(
      pc.dim("│"),
      `${pc.dim("│")}  ${pc.bold("DETAIL")}`,
      `${pc.dim("│")}  ${pc.cyan(focused.path)}${focused.kind === "directory" ? pc.dim(` · ${affected.length} files`) : ""}${view.selectedPaths.size > 0 ? pc.cyan(` · ${view.selectedPaths.size} selected`) : ""}`,
      focused.entry
        ? `${pc.dim("│")}  ${focused.entry.detail} ${pc.dim(`· ${focused.entry.owner}`)}`
        : `${pc.dim("│")}  ${pc.dim(`${unresolved} unresolved · ${affected.length} files`)}`,
    );
  }

  const treeCapacity = Math.max(0, terminalRows - header.length - detail.length - footer.length);
  const lines = [...header];
  for (const item of statusTreeWindow(rows.length, selected, treeCapacity)) {
    if (item.kind === "overflow") {
      const direction = item.direction === "above" ? "↑" : "↓";
      lines.push(`${pc.dim("│")}    ${pc.dim(`${direction} ${item.count} hidden`)}`);
      continue;
    }
    const row = rows[item.index];
    if (!row) continue;
    const active = item.index === selected;
    const marked = selectionState(row.node, view.selectedPaths);
    const selectionMark = marked === "all" ? "●" : marked === "some" ? "◐" : " ";
    const branch = row.node.kind === "directory" ? (view.expanded.has(row.node.path) ? "▾" : "▸") : " ";
    const raw = `${"  ".repeat(row.depth)}${branch} ${row.node.name}`;
    lines.push(
      `${active ? pc.cyan("◆") : pc.dim("│")} ${marked === "none" ? " " : pc.cyan(selectionMark)} ${paint(row.node.state, symbols[row.node.state])} ${
        active ? pc.bgCyan(pc.black(pc.bold(` ${raw} `))) : row.node.state === "unchanged" ? pc.dim(raw) : raw
      }`,
    );
  }
  lines.push(...detail, ...footer);
  return lines.join("\n");
}

export function renderStatusTree(entries: StatusEntry[], options: StatusTreeRenderOptions = {}): string {
  return render(
    entries,
    {
      selected: options.selected ?? 0,
      expanded: new Set(options.expanded ?? []),
      selectedPaths: new Set(options.selectedPaths ?? []),
    },
    options.terminalRows ?? 24,
  );
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
      selectedPaths: new Set(),
    };
    super({ ...io, render: () => render(entries, view, measuredTerminalRows(io.output)) }, false);
    this.view = view;
    this.entries = entries;
    this.on("cursor", (action) => {
      const rows = visible(tree(this.entries), this.view.expanded);
      const focused = rows[this.view.selected]?.node;
      if (!focused) return;
      if (action === "up" || action === "down") return;
      if (action === "left" || action === "right") delete this.view.selectionAnchor;
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
        this.toggleSelection(focused);
      }
    });
    this.on("key", (character, key) => {
      const alias = character?.toLowerCase();
      const direction =
        key.name === "up" || alias === "k" ? "up" : key.name === "down" || alias === "j" ? "down" : undefined;
      if (direction) {
        this.moveVertical(direction, key.shift === true && (key.name === "up" || key.name === "down"));
        return;
      }
      if (alias === "i") {
        const focused = visible(tree(this.entries), this.view.expanded)[this.view.selected]?.node;
        if (!focused) return;
        this._setValue({
          kind: "inspect",
          paths:
            this.view.selectedPaths.size > 0
              ? [...this.view.selectedPaths]
              : descendants(focused).map((entry) => entry.path),
        });
        this.state = "submit";
        return;
      }
      if (character?.toLowerCase() !== "q") return;
      this._setValue({ kind: "finish", paths: [] });
      this.state = "submit";
    });
  }

  private toggleSelection(node: Node): void {
    const entries = selectableEntries(node);
    const remove = entries.length > 0 && entries.every((entry) => this.view.selectedPaths.has(entry.path));
    for (const entry of entries) {
      if (remove) this.view.selectedPaths.delete(entry.path);
      else this.view.selectedPaths.add(entry.path);
    }
    delete this.view.selectionAnchor;
  }

  private moveVertical(direction: "up" | "down", extend: boolean): void {
    const rows = visible(tree(this.entries), this.view.expanded);
    if (rows.length === 0) return;
    const previous = clamp(this.view.selected, 0, rows.length - 1);
    const next = clamp(previous + (direction === "up" ? -1 : 1), 0, rows.length - 1);
    this.view.selected = next;
    if (!extend) {
      delete this.view.selectionAnchor;
      return;
    }
    const anchor = this.view.selectionAnchor ?? previous;
    this.view.selectionAnchor = anchor;
    this.view.selectedPaths.clear();
    const start = Math.min(anchor, next);
    const end = Math.max(anchor, next);
    for (const row of rows.slice(start, end + 1)) {
      if (selectable(row.node)) this.view.selectedPaths.add(row.node.entry.path);
    }
  }

  protected override _shouldSubmit(): boolean {
    const focused = visible(tree(this.entries), this.view.expanded)[this.view.selected]?.node;
    if (!focused) return false;
    if (this.view.selectedPaths.size > 0) {
      this._setValue({ kind: "reconcile", paths: [...this.view.selectedPaths] });
      return true;
    }
    this._setValue({
      kind: "reconcile",
      paths: descendants(focused).map((entry) => entry.path),
      target: focused.path,
    });
    return true;
  }
}
