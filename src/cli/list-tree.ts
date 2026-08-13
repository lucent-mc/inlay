import type { Readable, Writable } from "node:stream";
import { Prompt } from "@clack/core";
import pc from "picocolors";
import type { ContentMetadata } from "../inventory.js";

interface ListNode {
  path: string;
  label: string;
  children: ListNode[];
  metadata?: ContentMetadata;
}

interface ListData {
  lineage: Array<{
    name: string;
    versionId: string;
    source: string;
    content?: Partial<Record<string, ContentMetadata[]>>;
  }>;
  content?: Partial<Record<string, ContentMetadata[]>>;
}

function categoryNodes(prefix: string, groups: Partial<Record<string, ContentMetadata[]>>): ListNode[] {
  return Object.entries(groups)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([category, items]) => ({
      path: `${prefix}/${category}`,
      label: `${category} ${pc.dim(`(${items?.length ?? 0})`)}`,
      children: (items ?? []).map((item) => ({
        path: `${prefix}/${category}/${item.path}`,
        label: item.name ?? item.path,
        children: [],
        metadata: item,
      })),
    }));
}

function nodes(data: ListData): ListNode[] {
  if (data.content) {
    return [{ path: "resolved", label: "Resolved Pack", children: categoryNodes("resolved", data.content) }];
  }
  return data.lineage.map((layer, index) => ({
    path: `layer-${index}`,
    label: `${layer.name}@${layer.versionId} ${pc.dim(layer.source)}`,
    children: categoryNodes(`layer-${index}`, layer.content ?? {}),
  }));
}

function rows(tree: ListNode[], expanded: Set<string>): Array<{ node: ListNode; depth: number }> {
  const result: Array<{ node: ListNode; depth: number }> = [];
  const visit = (node: ListNode, depth: number) => {
    result.push({ node, depth });
    if (expanded.has(node.path)) for (const child of node.children) visit(child, depth + 1);
  };
  for (const node of tree) visit(node, 0);
  return result;
}

function render(tree: ListNode[], expanded: Set<string>, selected: number): string {
  const visible = rows(tree, expanded);
  const lines = [`${pc.cyan("◆")}  ${pc.bold("lay list")}`, pc.dim("│")];
  for (const [index, row] of visible.entries()) {
    const active = index === selected;
    const branch = row.node.children.length > 0 ? (expanded.has(row.node.path) ? "▾" : "▸") : " ";
    const label = `${"  ".repeat(row.depth)}${branch} ${row.node.label}`;
    lines.push(`${active ? pc.cyan("◆") : pc.dim("│")}  ${active ? pc.inverse(` ${label} `) : label}`);
  }
  const metadata = visible[selected]?.node.metadata;
  if (metadata) {
    lines.push(
      pc.dim("│"),
      `${pc.dim("│")}  ${pc.bold("DETAIL")}`,
      `${pc.dim("│")}  ${metadata.path}`,
      `${pc.dim("│")}  ${metadata.owner}${metadata.versionId ? ` · ${metadata.versionId}` : ""}${metadata.license ? ` · ${metadata.license}` : ""}`,
      `${pc.dim("│")}  dependencies: ${metadata.dependencies.length}`,
    );
  }
  lines.push(pc.dim("│"), `${pc.cyan("└")}  ${pc.dim("↑↓ navigate  ←→ collapse/expand  enter/q finish")}`);
  return lines.join("\n");
}

export class ListTreePrompt extends Prompt<void> {
  constructor(
    data: ListData,
    io: { input: Readable; output: Writable } = { input: process.stdin, output: process.stdout },
  ) {
    const tree = nodes(data);
    const expanded = new Set(tree.map((node) => node.path));
    let selected = 0;
    super({ ...io, render: () => render(tree, expanded, selected) }, false);
    this.on("cursor", (action) => {
      const visible = rows(tree, expanded);
      const focused = visible[selected]?.node;
      if (!focused) return;
      if (action === "up") selected = Math.max(0, selected - 1);
      if (action === "down") selected = Math.min(visible.length - 1, selected + 1);
      if (action === "right" && focused.children.length > 0) expanded.add(focused.path);
      if (action === "left" && expanded.has(focused.path)) expanded.delete(focused.path);
      else if (action === "left" && focused.path.includes("/")) {
        const parent = focused.path.split("/").slice(0, -1).join("/");
        const index = visible.findIndex((row) => row.node.path === parent);
        if (index >= 0) selected = index;
      }
    });
    this.on("key", (character) => {
      if (character?.toLowerCase() === "q") this.state = "submit";
    });
  }
}
