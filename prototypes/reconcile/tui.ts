import * as p from "@clack/prompts";

type ChangeKind = "modified" | "deleted" | "replaced" | "added";
type Provenance = "inherited" | "current" | "unmanaged";
type Decision = "unresolved" | "adopted" | "restored" | "excluded" | "recorded" | "preserved" | "upstream";

interface Change {
  id: string;
  kind: ChangeKind;
  provenance: Provenance;
  path: string;
  replacement?: string;
  owner: string;
  ownerVersion: string;
  relation: "current" | "parent" | "root" | "local";
  before?: string;
  after?: string;
  decision: Decision;
}

const currentLayer = "Lucent Vanilla";
const currentVersion = "1.4.0";
const instanceEnvironment = "client";

const changes: Change[] = [
  {
    id: "sodium-config",
    kind: "modified",
    provenance: "inherited",
    path: "config/sodium-options.json",
    owner: "Lucent Optimisations",
    ownerVersion: "2.3.1",
    relation: "parent",
    before: "sha512 10b31a…f99a · 1,284 bytes",
    after: "sha512 8a71de…4c20 · 1,301 bytes",
    decision: "unresolved",
  },
  {
    id: "modernfix-config",
    kind: "deleted",
    provenance: "inherited",
    path: "config/modernfix-mixins.properties",
    owner: "Lucent Optimisations",
    ownerVersion: "2.3.1",
    relation: "parent",
    before: "sha512 7c11d9…5e81 · 642 bytes",
    after: "missing from instance",
    decision: "unresolved",
  },
  {
    id: "sodium-version",
    kind: "replaced",
    provenance: "inherited",
    path: "mods/sodium-fabric-0.6.13+mc1.21.1.jar",
    replacement: "mods/sodium-fabric-0.6.14+mc1.21.1.jar",
    owner: "Lucent Optimisations",
    ownerVersion: "2.3.1",
    relation: "parent",
    before: "Modrinth v0.6.13 · sha512 139d02…80ef",
    after: "Modrinth v0.6.14 · sha512 cc18c1…02b1",
    decision: "unresolved",
  },
  {
    id: "emi-config",
    kind: "modified",
    provenance: "current",
    path: "config/emi.css",
    owner: currentLayer,
    ownerVersion: currentVersion,
    relation: "current",
    before: "manifest sha1 42b811…b03f · 812 bytes",
    after: "working tree sha1 d51c90…81c2 · 844 bytes",
    decision: "unresolved",
  },
  {
    id: "options",
    kind: "added",
    provenance: "unmanaged",
    path: "options.txt",
    owner: "Local instance",
    ownerVersion: instanceEnvironment,
    relation: "local",
    after: "untracked · 3,114 bytes",
    decision: "unresolved",
  },
  {
    id: "latest-log",
    kind: "added",
    provenance: "unmanaged",
    path: "logs/latest.log",
    owner: "Local instance",
    ownerVersion: instanceEnvironment,
    relation: "local",
    after: "Git-ignored runtime file · 86 KiB",
    decision: "preserved",
  },
];

const kindSymbol: Record<ChangeKind, string> = {
  modified: "M",
  deleted: "D",
  replaced: "R",
  added: "?",
};

function isBlocking(change: Change): boolean {
  if (change.decision === "upstream") return true;
  return change.provenance === "inherited" && change.decision === "unresolved";
}

function needsAction(change: Change): boolean {
  return change.decision === "unresolved" || change.decision === "upstream";
}

function decisionLabel(change: Change): string {
  if (isBlocking(change)) return change.decision === "upstream" ? "UPSTREAM REQUIRED" : "BLOCKS BUILD";
  if (change.provenance === "unmanaged" && change.decision === "unresolved") return "LOCAL ONLY · OPTIONAL ACTION";
  if (change.decision === "unresolved") return "NEEDS RECORDING";
  return change.decision.toUpperCase();
}

function displayPath(change: Change): string {
  return change.replacement ? `${change.path} → ${change.replacement}` : change.path;
}

function renderStatus(): string {
  const blocking = changes.filter(isBlocking).length;
  const current = changes.filter((change) => change.provenance === "current" && needsAction(change)).length;
  const unmanaged = changes.filter((change) => change.provenance === "unmanaged").length;
  const groups = [
    {
      heading: "INHERITED · Lucent Optimisations@2.3.1 · parent",
      items: changes.filter((change) => change.provenance === "inherited"),
    },
    {
      heading: `OWNED HERE · ${currentLayer}@${currentVersion}`,
      items: changes.filter((change) => change.provenance === "current"),
    },
    {
      heading: `LOCAL ONLY · ${instanceEnvironment} instance`,
      items: changes.filter((change) => change.provenance === "unmanaged"),
    },
  ];

  const lines = [
    `${currentLayer}@${currentVersion} · ${instanceEnvironment}`,
    `${blocking} blocking inherited · ${current} current source · ${unmanaged} unmanaged`,
    "",
    `lineage  ${currentLayer}@${currentVersion}`,
    "         └─ Lucent Optimisations@2.3.1",
    "            └─ Fabulously Optimized@7.1.0",
  ];

  for (const group of groups) {
    lines.push("", group.heading);
    for (const change of group.items) {
      const marker = isBlocking(change) ? "!" : " ";
      lines.push(`${marker} ${kindSymbol[change.kind]}  ${displayPath(change)}`);
      lines.push(`     ${decisionLabel(change)}`);
    }
  }

  return lines.join("\n");
}

function renderDetails(change: Change): string {
  return [
    displayPath(change),
    `change       ${change.kind}`,
    `owned by     ${change.owner}@${change.ownerVersion} (${change.relation})`,
    `declared     ${change.before ?? "not declared"}`,
    `on disk      ${change.after ?? "missing"}`,
    `state        ${decisionLabel(change)}`,
  ].join("\n");
}

type Action = "adopt" | "restore" | "upstream" | "exclude" | "replace" | "record" | "discard" | "add" | "preserve";

function actionsFor(change: Change): Array<{ value: Action; label: string; hint?: string }> {
  if (change.provenance === "inherited" && change.kind === "modified") {
    return [
      { value: "adopt", label: `Adopt as Override in ${currentLayer}`, hint: "keep these bytes here" },
      { value: "restore", label: `Restore ${change.owner} bytes` },
      { value: "upstream", label: `Track in ${change.owner}`, hint: "stop; do not edit parent" },
    ];
  }
  if (change.provenance === "inherited" && change.kind === "deleted") {
    return [
      { value: "exclude", label: `Exclude in ${currentLayer}`, hint: "keep it absent here" },
      { value: "restore", label: `Restore ${change.owner} file` },
      { value: "upstream", label: `Remove in ${change.owner}`, hint: "stop; do not edit parent" },
    ];
  }
  if (change.provenance === "inherited" && change.kind === "replaced") {
    return [
      { value: "replace", label: `Replace in ${currentLayer}`, hint: "exclude old JAR + add new JAR" },
      { value: "restore", label: `Restore ${change.owner} version` },
      { value: "upstream", label: `Update in ${change.owner}`, hint: "stop; do not edit parent" },
    ];
  }
  if (change.provenance === "current") {
    return [
      { value: "record", label: "Record new hashes in inlay.index.json" },
      { value: "discard", label: "Restore declared source bytes" },
    ];
  }
  return [
    { value: "add", label: `Add to ${currentLayer}`, hint: "track in Git and files[]" },
    { value: "preserve", label: "Leave local and untracked", hint: "never package it" },
  ];
}

function planFor(change: Change, action: Action): string[] {
  switch (action) {
    case "adopt":
      return [
        `copy current bytes into ${currentLayer} source`,
        `add files[] declaration for ${change.path}`,
        "compute SHA-1, SHA-256, SHA-512, and fileSize",
        "refresh generated Git exclusions",
      ];
    case "exclude":
      return [`add exact exclusion for ${change.path}`, "record expected absence in materialization state"];
    case "replace":
      return [
        `exclude inherited ${change.path}`,
        `add ${change.replacement} to files[]`,
        "reconcile the mod dependency closure",
        "write both declarations atomically",
      ];
    case "restore":
    case "discard":
      return [`restore declared bytes at ${change.path}`, "refresh materialization state"];
    case "record":
      return [`compute hashes and size for ${change.path}`, "update its existing files[] declaration"];
    case "add":
      return [`Git-track ${change.path}`, `add it to ${currentLayer} files[]`, "compute hashes and size"];
    case "preserve":
      return [`leave ${change.path} untracked`, "exclude it from packaging"];
    case "upstream":
      return [];
  }
}

function applyDecision(change: Change, action: Action): "continue" | "stop" {
  if (action === "upstream") {
    change.decision = "upstream";
    p.note(
      [
        `This change belongs in ${change.owner}.`,
        "No repository or manifest was changed.",
        "",
        `1. Open the ${change.owner} repository.`,
        `2. Apply and release the change there.`,
        `3. Return here and update the immutable Parent Reference.`,
        "",
        `${displayPath(change)} still blocks this build.`,
      ].join("\n"),
      "Upstream work required",
    );
    return "stop";
  }

  const decisions: Record<Exclude<Action, "upstream">, Decision> = {
    adopt: "adopted",
    restore: "restored",
    exclude: "excluded",
    replace: "adopted",
    record: "recorded",
    discard: "restored",
    add: "adopted",
    preserve: "preserved",
  };
  change.decision = decisions[action];
  return "continue";
}

async function runInteractive() {
  p.intro("lay reconcile · prototype");
  p.note(renderStatus(), "Instance status");

  while (changes.some(needsAction)) {
    const ordered = [...changes]
      .filter(needsAction)
      .sort((left, right) => Number(isBlocking(right)) - Number(isBlocking(left)));
    const selected = await p.select({
      message: "Review a change",
      options: [
        ...ordered.map((change) => ({
          value: change.id,
          label: displayPath(change),
          hint: `${change.owner} · ${decisionLabel(change)}`,
        })),
        { value: "finish", label: "Finish for now" },
      ],
    });
    if (p.isCancel(selected) || selected === "finish") break;

    const change = changes.find((candidate) => candidate.id === selected);
    if (!change) continue;
    p.note(renderDetails(change), "Provenance");

    const action = await p.select({ message: "What should happen?", options: actionsFor(change) });
    if (p.isCancel(action)) continue;

    if (action !== "upstream") {
      const accepted = await p.confirm({
        message: `Apply this in-memory plan?\n${planFor(change, action).map((step) => `  • ${step}`).join("\n")}`,
      });
      if (p.isCancel(accepted) || !accepted) continue;
    }

    if (applyDecision(change, action) === "stop") break;
    p.note(renderStatus(), "Updated status");
  }

  const blocking = changes.filter(isBlocking).length;
  p.outro(blocking === 0 ? "Build can proceed. Prototype changed no files." : `${blocking} inherited change(s) still block the build. Prototype changed no files.`);
}

if (process.argv.includes("--demo")) {
  console.log(renderStatus());
  console.log("\nFOCAL ACTION · config/sodium-options.json");
  for (const action of actionsFor(changes[0])) console.log(`  ${action.label}${action.hint ? ` — ${action.hint}` : ""}`);
} else {
  await runInteractive();
}
