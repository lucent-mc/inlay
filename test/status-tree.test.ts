import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { renderStatusTree, StatusTreePrompt, statusTreeWindow } from "../src/cli/status-tree.js";
import type { StatusEntry } from "../src/operations/status.js";

test("status tree starts with every directory collapsed", () => {
  const entries: StatusEntry[] = [
    {
      path: "config/sodium/options.json",
      state: "updated",
      owner: "Example@1.0.0",
      detail: "Changed",
      staged: false,
    },
    {
      path: "mods/sodium.jar",
      state: "unchanged",
      owner: "Example@1.0.0",
      detail: "Unchanged",
      staged: false,
    },
  ];

  const prompt = new StatusTreePrompt(entries);
  const view = prompt as unknown as { view: { expanded: Set<string> } };

  assert.deepEqual([...view.view.expanded], []);
});

test("space toggles every file highlighted with shift and arrow keys", async () => {
  const entries: StatusEntry[] = [
    {
      path: "config/first.json",
      state: "untracked",
      owner: "Local instance",
      detail: "Untracked",
      staged: false,
    },
    {
      path: "config/second.json",
      state: "untracked",
      owner: "Local instance",
      detail: "Untracked",
      staged: false,
    },
    {
      path: "config/tracked.json",
      state: "unchanged",
      owner: "Example@1.0.0",
      detail: "Unchanged",
      staged: false,
    },
  ];
  const input = new PassThrough();
  const output = new PassThrough() as PassThrough & { rows?: number };
  output.rows = 24;
  const prompt = new StatusTreePrompt(entries, { input, output });
  const completion = prompt.prompt();
  setTimeout(() => input.write("\u001b[C"), 10);
  setTimeout(() => input.write("\u001b[B"), 30);
  setTimeout(() => input.write("\u001b[1;2B"), 50);
  setTimeout(() => input.write(" "), 70);
  setTimeout(() => input.write("\r"), 90);

  const intent = await Promise.race([
    completion,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Status tree did not submit the selected range.")), 1_000),
    ),
  ]);

  assert.deepEqual(intent, {
    kind: "reconcile",
    paths: ["config/first.json", "config/second.json"],
  });
});

test("space selects a directory and toggles individual files out of the selection", async () => {
  const entries: StatusEntry[] = [
    {
      path: "config/first.json",
      state: "untracked",
      owner: "Local instance",
      detail: "Untracked",
      staged: false,
    },
    {
      path: "config/second.json",
      state: "updated",
      owner: "Example@1.0.0",
      detail: "Updated",
      staged: false,
    },
    {
      path: "config/unchanged.json",
      state: "unchanged",
      owner: "Example@1.0.0",
      detail: "Unchanged",
      staged: false,
    },
  ];
  const input = new PassThrough();
  const output = new PassThrough() as PassThrough & { rows?: number };
  output.rows = 24;
  const prompt = new StatusTreePrompt(entries, { input, output });
  const completion = prompt.prompt();
  setTimeout(() => input.write("\u001b[C"), 10);
  setTimeout(() => input.write(" "), 30);
  setTimeout(() => input.write("\u001b[B"), 50);
  setTimeout(() => input.write(" "), 70);
  setTimeout(() => input.write("\r"), 90);

  const intent = await Promise.race([
    completion,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Status tree did not submit the toggled selection.")), 1_000),
    ),
  ]);

  assert.deepEqual(intent, {
    kind: "reconcile",
    paths: ["config/second.json"],
  });
});

test("status tree window keeps every selected row inside its capacity", () => {
  for (let total = 1; total <= 80; total += 1) {
    for (let capacity = 1; capacity <= 16; capacity += 1) {
      for (let selected = 0; selected < total; selected += 1) {
        const window = statusTreeWindow(total, selected, capacity);
        assert.ok(window.length <= capacity);
        assert.ok(window.some((item) => item.kind === "row" && item.index === selected));
        const indices = window.flatMap((item) => (item.kind === "row" ? [item.index] : []));
        assert.deepEqual(
          indices,
          [...indices].sort((left, right) => left - right),
        );
      }
    }
  }
});

test("status tree renders a bounded frame with overflow at both edges", () => {
  const entries: StatusEntry[] = Array.from({ length: 40 }, (_, index) => ({
    path: `file-${String(index).padStart(2, "0")}.json`,
    state: "untracked",
    owner: "Local instance",
    detail: "Eligible regular file is not declared by this Layer.",
    staged: false,
  }));

  for (const terminalRows of [6, 12, 18, 30]) {
    const frame = renderStatusTree(entries, { selected: 20, terminalRows });
    const lines = frame.split("\n");
    assert.ok(lines.length <= terminalRows);
    assert.match(frame, /file-20\.json/u);
    if (terminalRows >= 12) {
      assert.match(frame, /↑ \d+ hidden/u);
      assert.match(frame, /↓ \d+ hidden/u);
    }
  }
});
