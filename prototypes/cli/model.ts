export type FileState = "untracked" | "conflict" | "updated" | "deleted" | "reconciled" | "unchanged";
export type Ownership = "local" | "current" | "inherited";

export interface FileEntry {
  path: string;
  state: FileState;
  ownership: Ownership;
  owner: string;
  detail: string;
  staged?: boolean;
}

export interface TreeNode {
  name: string;
  path: string;
  kind: "directory" | "file";
  state: FileState;
  children: TreeNode[];
  entry?: FileEntry;
}

export const stateOrder: Record<FileState, number> = {
  untracked: 0,
  conflict: 1,
  updated: 2,
  deleted: 3,
  reconciled: 4,
  unchanged: 5,
};

export const stateSymbol: Record<FileState, string> = {
  untracked: "?",
  conflict: "!",
  updated: "~",
  deleted: "−",
  reconciled: "✓",
  unchanged: "·",
};

export const stateLabel: Record<FileState, string> = {
  untracked: "Untracked eligible file",
  conflict: "Unrecorded parent conflict",
  updated: "Current Layer content changed",
  deleted: "Current Layer content missing",
  reconciled: "Reconciled and staged",
  unchanged: "Unchanged",
};

export const entries: FileEntry[] = [
  {
    path: "config/continuity.json",
    state: "untracked",
    ownership: "local",
    owner: "Local instance",
    detail: "Eligible regular file · not Git-ignored · not declared",
  },
  {
    path: "resourcepacks/Lucent Sounds/pack.mcmeta",
    state: "untracked",
    ownership: "local",
    owner: "Local instance",
    detail: "Eligible regular file · not Git-ignored · not declared",
  },
  {
    path: "config/sodium-options.json",
    state: "conflict",
    ownership: "inherited",
    owner: "Lucent Optimisations@2.3.1",
    detail: "Working bytes differ from inherited SHA-512 · blocks non-interactive build",
  },
  {
    path: "mods/sodium-fabric-0.6.13+mc1.21.1.jar",
    state: "conflict",
    ownership: "inherited",
    owner: "Lucent Optimisations@2.3.1",
    detail: "Inherited file deleted while an undeclared replacement is present",
  },
  {
    path: "mods/sodium-fabric-0.6.14+mc1.21.1.jar",
    state: "conflict",
    ownership: "local",
    owner: "Conflicts with inherited Sodium declaration",
    detail: "Candidate atomic replacement · exclude old path and declare this path",
  },
  {
    path: "config/emi.css",
    state: "updated",
    ownership: "current",
    owner: "Lucent Vanilla@1.4.0",
    detail: "Working bytes differ from current files[] hashes and size",
  },
  {
    path: "config/iris.properties",
    state: "deleted",
    ownership: "current",
    owner: "Lucent Vanilla@1.4.0",
    detail: "Still declared by current Layer but missing on disk",
  },
  {
    path: "config/modernfix-mixins.properties",
    state: "reconciled",
    ownership: "current",
    owner: "Lucent Vanilla@1.4.0",
    detail: "Exclusion recorded · complete inlay.index.json snapshot staged",
    staged: true,
  },
  {
    path: "mods/emi-1.1.22+1.21.1+fabric.jar",
    state: "unchanged",
    ownership: "current",
    owner: "Lucent Vanilla@1.4.0",
    detail: "Matches declared hashes and size",
  },
  {
    path: "mods/lithium-fabric-0.14.8+mc1.21.1.jar",
    state: "unchanged",
    ownership: "inherited",
    owner: "Lucent Optimisations@2.3.1",
    detail: "Managed inherited file · visible even though generated Git exclusions ignore it",
  },
];

function compareNodes(left: TreeNode, right: TreeNode): number {
  return stateOrder[left.state] - stateOrder[right.state] || left.name.localeCompare(right.name);
}

function recalculate(node: TreeNode): FileState {
  if (node.kind === "file") return node.state;
  node.state = node.children.map(recalculate).sort((a, b) => stateOrder[a] - stateOrder[b])[0] ?? "unchanged";
  node.children.sort(compareNodes);
  return node.state;
}

export function buildTree(files: FileEntry[]): TreeNode {
  const root: TreeNode = { name: ".", path: "", kind: "directory", state: "unchanged", children: [] };

  for (const entry of files) {
    const parts = entry.path.split("/");
    let parent = root;
    for (const [index, part] of parts.entries()) {
      const path = parts.slice(0, index + 1).join("/");
      const isFile = index === parts.length - 1;
      let node = parent.children.find((candidate) => candidate.name === part);
      if (!node) {
        node = {
          name: part,
          path,
          kind: isFile ? "file" : "directory",
          state: isFile ? entry.state : "unchanged",
          children: [],
          entry: isFile ? entry : undefined,
        };
        parent.children.push(node);
      }
      parent = node;
    }
  }

  recalculate(root);
  return root;
}

export function flattenVisible(root: TreeNode, expanded: Set<string>): Array<{ node: TreeNode; depth: number }> {
  const visible: Array<{ node: TreeNode; depth: number }> = [];
  const visit = (node: TreeNode, depth: number) => {
    if (node !== root) visible.push({ node, depth });
    if (node.kind === "directory" && (node === root || expanded.has(node.path))) {
      for (const child of node.children) visit(child, node === root ? 0 : depth + 1);
    }
  };
  visit(root, 0);
  return visible;
}

export function descendants(node: TreeNode): FileEntry[] {
  if (node.entry) return [node.entry];
  return node.children.flatMap(descendants);
}
