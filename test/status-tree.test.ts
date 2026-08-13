import assert from "node:assert/strict";
import { test } from "node:test";
import { StatusTreePrompt } from "../src/cli/status-tree.js";
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
