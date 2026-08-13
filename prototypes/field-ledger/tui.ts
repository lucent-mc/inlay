import * as p from "@clack/prompts";
import {
  blockingFields,
  createLedger,
  plannedOperations,
  reduceLedger,
  type Field,
  type LedgerAction,
  type LedgerState,
} from "./model.ts";

const interactive = process.stdout.isTTY && !process.argv.includes("--demo");
const color = interactive && !process.env.NO_COLOR;
const esc = (code: string, value: string) => color ? `\u001b[${code}m${value}\u001b[0m` : value;
const bold = (value: string) => esc("1", value);
const dim = (value: string) => esc("2", value);
const cyan = (value: string) => esc("36", value);
const yellow = (value: string) => esc("33", value);
const green = (value: string) => esc("32", value);
const red = (value: string) => esc("31", value);

function shortHash(value: string): string {
  return `${value.slice(0, 10)}…${value.slice(-6)}`;
}

function bytes(value: number): string {
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function fieldMark(field: Field): string {
  switch (field.status) {
    case "drift": return red("!!");
    case "adopted": return green("A>");
    case "restored": return green("R<");
    case "excluded": return green("X<");
    case "replaced": return green("X+");
    case "unmanaged": return dim("??");
    case "layer": return cyan("A ");
    default: return dim("= ");
  }
}

function owner(field: Field, state: LedgerState): string {
  if (field.status === "adopted" || field.status === "replaced") {
    return `owner ${state.layer}`;
  }
  if (field.status === "excluded") return `owner ${field.inheritedOwner} · excluded by ${state.layer}`;
  if (field.status === "unmanaged") return "owner —";
  if (field.status === "layer") return `owner ${state.layer}`;
  return `owner ${field.inheritedOwner}`;
}

function row(field: Field, state: LedgerState): string[] {
  const path = field.status === "replaced" && field.replacement
    ? `${field.path}  ->  ${field.replacement.path}`
    : field.path;
  return [
    `${fieldMark(field)} ${bold(path)}`,
    `   ${dim(`${owner(field, state)}  ·  source ${field.source}`)}`,
  ];
}

function section(title: string, fields: Field[], state: LedgerState): string[] {
  if (fields.length === 0) return [];
  return [bold(title), ...fields.flatMap((field) => row(field, state)), ""];
}

function expanded(field: Field | undefined): string[] {
  if (!field) return [];
  const lines = [
    bold(`OPEN FIELD · ${field.path}`),
    `kind       ${field.kind}`,
    `source     ${field.source}`,
    `working    sha256 ${field.working.sha256}  ${field.working.bytes.toLocaleString("en")} bytes`,
  ];
  if (field.inherited) {
    lines.push(`inherited  sha256 ${field.inherited.sha256}  ${field.inherited.bytes.toLocaleString("en")} bytes`);
  }
  if (field.replacement) {
    lines.push(`candidate  ${field.replacement.path}`);
    lines.push(`           sha256 ${field.replacement.digest.sha256}  ${field.replacement.digest.bytes.toLocaleString("en")} bytes`);
  }
  return [...lines, ""];
}

export function renderLedger(state: LedgerState): string {
  const blocking = blockingFields(state);
  const resolved = state.fields.filter((field) => ["adopted", "restored", "excluded", "replaced"].includes(field.status));
  const layer = state.fields.filter((field) => field.status === "layer");
  const unmanaged = state.fields.filter((field) => field.status === "unmanaged");
  const plan = plannedOperations(state);
  const expandedField = state.fields.find((field) => field.id === state.expandedId);
  const phase = state.phase === "stopped"
    ? red("STOPPED · TRACK UPSTREAM")
    : blocking.length > 0
      ? yellow(`BLOCKED · ${blocking.length} INHERITED ${blocking.length === 1 ? "FIELD" : "FIELDS"}`)
      : green("READY · PACKAGING UNLOCKED");

  const lines = [
    `${bold("INLAY // FIELD LEDGER")}  ${dim("dry-run prototype")}`,
    `layer     ${state.layer}`,
    `parent    ${state.parent}`,
    `instance  ${state.instance}`,
    `gate      ${phase}`,
    "",
    ...section("INHERITED DRIFT · DECISION REQUIRED", blocking, state),
    ...section("RESOLVED THIS PASS", resolved, state),
    ...section("CURRENT LAYER", layer, state),
    ...section("UNMANAGED · PRESERVED / UNTRACKED / UNPACKAGED", unmanaged, state),
    dim(`=  ${state.cleanInherited} clean inherited paths hidden`),
    "",
    ...expanded(expandedField),
  ];

  if (state.phase === "stopped") {
    lines.push(
      bold("WRITE PLAN · EMPTY"),
      "   current layer unchanged",
      "   parent unchanged",
      `   next: carry ${state.upstreamPath} to the parent maintainer`,
      "",
    );
  } else if (plan.length > 0) {
    lines.push(bold(`STAGED WRITE PLAN · CURRENT LAYER ONLY (${plan.length})`));
    for (const operation of plan) {
      lines.push(` ${operation.mark} ${operation.scope.padEnd(21)} ${operation.description}`);
    }
    lines.push("");
  }

  lines.push(`${bold("NOTE")} ${state.notice}`);
  return lines.join("\n");
}

function actionsFor(field: Field): Array<{ value: LedgerAction["type"]; label: string; hint: string }> {
  const common = [
    { value: "restore" as const, label: "Restore inherited bytes", hint: "return this instance path to the verified parent digest" },
    { value: "exclude" as const, label: "Exclude inherited content", hint: "record an exclusion in the current Layer" },
    { value: "track-upstream" as const, label: "Track upstream and stop", hint: "abort with an empty write plan; never edit the parent" },
  ];
  if (field.kind === "mod" && field.replacement) {
    return [
      { value: "replace", label: "Replace inherited mod", hint: "atomically stage exclusion + addition" },
      ...common,
    ];
  }
  return [
    { value: "adopt", label: "Adopt working bytes", hint: "make an explicit override in the current Layer" },
    ...common,
  ];
}

async function runInteractive(): Promise<void> {
  let state = createLedger();
  p.intro("Inlay field ledger");

  while (state.phase === "reconciling") {
    console.clear();
    console.log(renderLedger(state));
    const unresolved = blockingFields(state);
    const selection = await p.select({
      message: "Open a blocking field",
      options: [
        ...unresolved.map((field) => ({
          value: field.id,
          label: field.path,
          hint: `${field.kind} · ${shortHash(field.working.sha256)} · ${bytes(field.working.bytes)}`,
        })),
        { value: "quit", label: "Leave unresolved", hint: "no writes; packaging stays locked" },
      ],
    });
    if (p.isCancel(selection) || selection === "quit") break;

    state = reduceLedger(state, { type: "inspect", id: selection });
    console.clear();
    console.log(renderLedger(state));
    const field = state.fields.find((candidate) => candidate.id === selection);
    if (!field) continue;

    const action = await p.select({
      message: `Decide ${field.path}`,
      options: [
        ...actionsFor(field),
        { value: "back", label: "Back to ledger", hint: "keep this field blocking" },
      ],
    });
    if (p.isCancel(action) || action === "back") {
      state = reduceLedger(state, { type: "inspect" });
      continue;
    }
    state = reduceLedger(state, { type: action, id: field.id } as LedgerAction);
  }

  console.clear();
  console.log(renderLedger(state));
  p.outro(
    state.phase === "ready"
      ? "Dry run complete. The current-Layer plan is ready; no files were written."
      : state.phase === "stopped"
        ? "Tracking upstream. The prototype stopped with both layers unchanged."
        : "Left unresolved. No files were written.",
  );
}

function demoFrame(title: string, state: LedgerState): void {
  console.log(`\n${"─".repeat(78)}\n${title}\n${"─".repeat(78)}`);
  console.log(renderLedger(state));
}

function runDemo(): void {
  let state = createLedger();
  demoFrame("DEMO 1/7 · scan materialized instance", state);

  state = reduceLedger(state, { type: "inspect", id: "sodium-config" });
  demoFrame("DEMO 2/7 · open a field to reveal full hashes", state);

  state = reduceLedger(state, { type: "adopt", id: "sodium-config" });
  state = reduceLedger(state, { type: "restore", id: "iris-config" });
  demoFrame("DEMO 3/7 · adopt one override; restore one inherited file", state);

  state = reduceLedger(state, { type: "exclude", id: "base-tweaks" });
  demoFrame("DEMO 4/7 · exclude inherited content in the current Layer", state);

  state = reduceLedger(state, { type: "replace", id: "sodium-mod" });
  demoFrame("DEMO 5/7 · replace a parent mod as exclusion + addition", state);

  let upstream = createLedger();
  upstream = reduceLedger(upstream, { type: "track-upstream", id: "sodium-config" });
  demoFrame("DEMO 6/7 · alternate branch: track upstream and stop", upstream);

  console.log(`\n${"─".repeat(78)}\nDEMO 7/7 · verdict\n${"─".repeat(78)}`);
  console.log("The gate is readable: only unresolved inherited drift blocks packaging.");
  console.log("Every local choice names its current-Layer or instance effect.");
  console.log("Track-upstream terminates with an empty plan and both layers unchanged.");
  console.log("Unmanaged files remain visible but never enter the write plan.");
}

if (process.argv.includes("--demo") || !interactive) {
  runDemo();
} else {
  await runInteractive();
}
