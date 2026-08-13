import * as p from "@clack/prompts";
import {
  availableResolutions,
  initialState,
  reconcile,
  type Drift,
  type ReconcileState,
  type Resolution,
} from "./model.ts";

const color = process.env.NO_COLOR === undefined;
const ansi = (code: number, text: string) => color ? `\u001b[${code}m${text}\u001b[0m` : text;
const bold = (text: string) => ansi(1, text);
const dim = (text: string) => ansi(2, text);
const red = (text: string) => ansi(31, text);
const green = (text: string) => ansi(32, text);
const amber = (text: string) => ansi(33, text);
const blue = (text: string) => ansi(36, text);

const resolutionCopy: Record<Resolution, { label: string; hint: string }> = {
  adopt: { label: "Adopt local bytes", hint: "write an override into the current Layer" },
  restore: { label: "Restore inherited bytes", hint: "discard local drift; add no declaration" },
  exclude: { label: "Exclude inherited content", hint: "suppress this exact parent path" },
  replace: { label: "Replace inherited mod", hint: "atomically write exclusion + addition" },
  "track-upstream": { label: "Track upstream", hint: "stop; edit neither Layer" },
};

function route(code: string): string {
  if (code === "X") return amber("╳");
  if (code === "O") return blue("◆");
  if (code === "A") return green("+");
  return red(code);
}

function renderState(state: ReconcileState): string {
  const lines: string[] = [];
  lines.push(`${bold("INLAY / RECONCILE")}  ${dim("switchyard prototype")}`);
  lines.push(`${dim("instance")} ${state.instance}  ${dim("environment")} ${state.environment}`);
  lines.push(`${dim("current")}  ${state.currentLayer} ${state.currentVersion}`);
  lines.push(`${dim("lineage")}  ${state.lineage.join(dim("  →  "))}`);
  lines.push("");

  if (state.halted) {
    lines.push(`${amber("■ STOPPED — TRACK UPSTREAM")}`);
    lines.push(`  ${state.haltReason}`);
    lines.push(`  ${bold("No files, manifests, or parent bytes were edited.")}`);
  } else if (state.drift.length > 0) {
    lines.push(`${red("■ RED SIGNAL")}  ${bold(`${state.drift.length} inherited route${state.drift.length === 1 ? "" : "s"} unresolved`)}  ${red("BUILD BLOCKED")}`);
    lines.push(dim("  local bytes cannot silently change ancestor-owned content"));
    for (const item of state.drift) {
      lines.push(`  ${red(item.code.padEnd(2))} ${bold(item.path)}`);
      lines.push(`     ${item.summary}`);
      lines.push(dim(`     inherited · ${item.provenance.layer} ${item.provenance.version} @ ${item.provenance.commit.slice(0, 7)}`));
      if (item.replacement) lines.push(dim(`     candidate → ${item.replacement.path}`));
    }
  } else {
    lines.push(`${green("■ CLEAR ROUTE")}  ${bold("all inherited drift is represented or restored")}`);
    lines.push(dim("  reconciliation plan is ready to apply transactionally"));
  }

  lines.push("");
  lines.push(bold("CURRENT LAYER SOURCE") + dim("  ordinary author changes; not inherited drift"));
  for (const item of state.ownedChanges) {
    lines.push(`  ${blue(item.code.padEnd(2))} ${item.path}`);
    lines.push(dim(`     ${item.detail}`));
  }

  lines.push("");
  lines.push(bold("LAYER DELTA") + dim("  proposed by this reconciliation; memory only"));
  if (state.layerChanges.length === 0) lines.push(dim("  (none)"));
  for (const item of state.layerChanges) {
    lines.push(`  ${route(item.code)}  ${item.path}`);
    lines.push(dim(`     ${item.detail}`));
  }

  lines.push("");
  lines.push(bold("UNMANAGED") + dim("  preserved · untracked · never packaged"));
  for (const item of state.unmanaged) {
    lines.push(`  ${dim("??")} ${item.path}  ${dim(`(${item.detail})`)}`);
  }

  lines.push("");
  lines.push(`${bold("LAST")} ${state.lastAction}`);
  return lines.join("\n");
}

function renderDetails(drift: Drift): string {
  const p = drift.provenance;
  return [
    `path        ${drift.path}`,
    `owner       ${p.layer} ${p.version}`,
    `Layer ver.  ${p.commit}`,
    `declaration ${p.source}`,
    `expected    sha512:${p.expectedSha512}`,
    `on disk     ${p.actualSha512 ? `sha512:${p.actualSha512}` : "absent"}`,
    `size        ${p.bytes.toLocaleString("en-US")} expected bytes`,
    ...(drift.replacement ? [
      "",
      `candidate   ${drift.replacement.path}`,
      `candidate   sha512:${drift.replacement.sha512}`,
      `candidate   ${drift.replacement.bytes.toLocaleString("en-US")} bytes · ${drift.replacement.provider}`,
    ] : []),
  ].join("\n");
}

function printFrame(state: ReconcileState, clear = true): void {
  if (clear && process.stdout.isTTY) console.clear();
  process.stdout.write(`${renderState(state)}\n`);
}

function runDemo(): void {
  process.stdout.write(`${bold("DEMO A — represent every inherited change locally")}\n\n`);
  let state = initialState();
  printFrame(state, false);

  const script: Array<[string, Resolution]> = [
    ["sodium-config", "adopt"],
    ["sound-config", "restore"],
    ["iris-properties", "exclude"],
    ["sodium-mod", "replace"],
  ];
  for (const [id, action] of script) {
    process.stdout.write(`\n${dim("────────────────────────────────────────────────────────")}\n`);
    process.stdout.write(`${bold(`ACTION  ${resolutionCopy[action].label}`)}\n\n`);
    state = reconcile(state, id, action);
    printFrame(state, false);
  }

  process.stdout.write(`\n${dim("════════════════════════════════════════════════════════")}\n`);
  process.stdout.write(`${bold("DEMO B — defer ownership to the parent maintainer")}\n\n`);
  const stopped = reconcile(initialState(), "sodium-config", "track-upstream");
  printFrame(stopped, false);
}

async function runInteractive(): Promise<void> {
  let state = initialState();
  p.intro("Inlay inherited-drift switchyard · throwaway prototype");

  while (!state.halted && state.drift.length > 0) {
    printFrame(state);
    const driftId = await p.select({
      message: "Route one blocked inherited path",
      options: [
        ...state.drift.map((item) => ({
          value: item.id,
          label: `${item.code}  ${item.path}`,
          hint: `${item.provenance.layer} ${item.provenance.version}`,
        })),
        { value: "quit", label: "Leave unresolved", hint: "no state is persisted" },
      ],
    });
    if (p.isCancel(driftId) || driftId === "quit") break;

    const drift = state.drift.find((item) => item.id === driftId);
    if (!drift) continue;
    const choice = await p.select({
      message: drift.path,
      options: [
        ...availableResolutions(drift).map((value) => ({
          value,
          label: resolutionCopy[value].label,
          hint: resolutionCopy[value].hint,
        })),
        { value: "details", label: "Show provenance + hashes", hint: "read-only" },
        { value: "back", label: "Back to blocked paths" },
      ],
    });
    if (p.isCancel(choice) || choice === "back") continue;
    if (choice === "details") {
      p.note(renderDetails(drift), "PROVENANCE / PAYLOAD");
      await p.confirm({ message: "Return to the switchyard", initialValue: true });
      continue;
    }
    state = reconcile(state, drift.id, choice as Resolution);
  }

  printFrame(state);
  p.outro(state.halted
    ? "Stopped for upstream work. This prototype changed nothing."
    : state.drift.length === 0
      ? "Route clear. Proposed delta is shown above; this prototype changed nothing."
      : "Left with inherited drift unresolved; build remains blocked.");
}

if (process.argv.includes("--demo")) runDemo();
else await runInteractive();
