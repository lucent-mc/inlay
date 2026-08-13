export type Resolution = "adopt" | "restore" | "exclude" | "replace" | "track-upstream";

export interface Provenance {
  layer: string;
  version: string;
  commit: string;
  source: string;
  expectedSha512: string;
  actualSha512?: string;
  bytes: number;
}

export interface Drift {
  id: string;
  code: "M" | "D" | "R";
  path: string;
  summary: string;
  provenance: Provenance;
  replacement?: {
    path: string;
    sha512: string;
    bytes: number;
    provider: string;
  };
}

export interface LayerChange {
  code: "A" | "X" | "O";
  path: string;
  detail: string;
}

export interface ReconcileState {
  instance: string;
  environment: "client";
  currentLayer: string;
  currentVersion: string;
  lineage: string[];
  drift: Drift[];
  ownedChanges: Array<{ code: "M" | "A"; path: string; detail: string }>;
  unmanaged: Array<{ path: string; detail: string }>;
  layerChanges: LayerChange[];
  halted: boolean;
  haltReason?: string;
  lastAction: string;
}

export function initialState(): ReconcileState {
  return {
    instance: "Prism / Lucent Optimisations",
    environment: "client",
    currentLayer: "lucent-personal",
    currentVersion: "0.9.0-dev @ 41c8d27",
    lineage: ["Fabulously Optimized 7.1.0 @ 7ab42fe", "Lucent Base 2.4.1 @ d90be13", "lucent-personal"],
    drift: [
      {
        id: "sodium-config",
        code: "M",
        path: "config/sodium-options.json",
        summary: "local bytes differ from the materialized parent payload",
        provenance: {
          layer: "Fabulously Optimized",
          version: "7.1.0",
          commit: "7ab42fe159bf",
          source: "files[config/sodium-options.json] · common · required",
          expectedSha512: "7b5d9a42b56c3f2e…e14dc14b2e9d56fb",
          actualSha512: "9fd1883294b70fb7…8d8ebf8e219ad0d3",
          bytes: 1284,
        },
      },
      {
        id: "sound-config",
        code: "M",
        path: "config/sound_physics_remastered/allowed_sounds.properties",
        summary: "three local lines changed after play",
        provenance: {
          layer: "Lucent Base",
          version: "2.4.1",
          commit: "d90be13d71a4",
          source: "files[config/sound_physics_remastered/allowed_sounds.properties] · client · required",
          expectedSha512: "c3b139935f77a136…51a09d042b8e9611",
          actualSha512: "a90762485f320eef…fdce9324ed868b21",
          bytes: 622,
        },
      },
      {
        id: "iris-properties",
        code: "D",
        path: "config/iris.properties",
        summary: "required inherited file is absent",
        provenance: {
          layer: "Fabulously Optimized",
          version: "7.1.0",
          commit: "7ab42fe159bf",
          source: "files[config/iris.properties] · client · required",
          expectedSha512: "4927c59739f4f455…6d0041a52a23c85c",
          bytes: 91,
        },
      },
      {
        id: "sodium-mod",
        code: "R",
        path: "mods/sodium-fabric-0.6.9+mc1.21.1.jar",
        summary: "inherited JAR is absent; a compatible local successor is present",
        provenance: {
          layer: "Fabulously Optimized",
          version: "7.1.0",
          commit: "7ab42fe159bf",
          source: "files[mods/sodium-fabric-0.6.9+mc1.21.1.jar] · common · required",
          expectedSha512: "a1d6e58c66162513…5ca5dc4ad2a07aa9",
          bytes: 1463518,
        },
        replacement: {
          path: "mods/sodium-fabric-0.6.13+mc1.21.1.jar",
          sha512: "12fe1159c1e60d57…70e672c006d14567",
          bytes: 1489920,
          provider: "Modrinth sodium 0.6.13 · exact runtime target",
        },
      },
    ],
    ownedChanges: [
      { code: "M", path: "config/modernfix-mixins.properties", detail: "owned by lucent-personal · ordinary source edit" },
      { code: "A", path: "resourcepacks/LowOnFire.zip", detail: "owned by lucent-personal · already declared" },
    ],
    unmanaged: [
      { path: "logs/latest.log", detail: "runtime output" },
      { path: "screenshots/2026-08-12_22.14.07.png", detail: "player screenshot" },
      { path: "options.txt", detail: "no managed-path collision" },
    ],
    layerChanges: [],
    halted: false,
    lastAction: "Scan complete. Resolve every inherited route before build.",
  };
}

function withoutDrift(state: ReconcileState, drift: Drift): ReconcileState {
  return { ...state, drift: state.drift.filter((item) => item.id !== drift.id) };
}

export function availableResolutions(drift: Drift): Resolution[] {
  return drift.replacement
    ? ["replace", "restore", "exclude", "track-upstream"]
    : drift.code === "D"
      ? ["restore", "exclude", "track-upstream"]
      : ["adopt", "restore", "exclude", "track-upstream"];
}

export function reconcile(state: ReconcileState, driftId: string, resolution: Resolution): ReconcileState {
  if (state.halted) return state;
  const drift = state.drift.find((item) => item.id === driftId);
  if (!drift) return { ...state, lastAction: `No unresolved drift named ${driftId}.` };

  if (resolution === "track-upstream") {
    return {
      ...state,
      halted: true,
      haltReason: `${drift.path} belongs to ${drift.provenance.layer}. Stop here and propose the change upstream.`,
      lastAction: "Stopped without changing the current Layer, parent Layer, or instance.",
    };
  }

  if (!availableResolutions(drift).includes(resolution)) {
    return { ...state, lastAction: `${resolution} is not valid for ${drift.path}.` };
  }

  const next = withoutDrift(state, drift);
  if (resolution === "restore") {
    return {
      ...next,
      lastAction: `Restored verified inherited bytes at ${drift.path}; no Layer declaration added.`,
    };
  }

  if (resolution === "adopt") {
    return {
      ...next,
      layerChanges: [...state.layerChanges, {
        code: "O",
        path: drift.path,
        detail: `override owned by ${state.currentLayer} · local bytes become source`,
      }],
      lastAction: `Adopted ${drift.path} as an explicit current-Layer override.`,
    };
  }

  if (resolution === "exclude") {
    return {
      ...next,
      layerChanges: [...state.layerChanges, {
        code: "X",
        path: drift.path,
        detail: `exact inherited path suppressed in ${state.currentLayer}`,
      }],
      lastAction: `Excluded ${drift.path}; the parent remains immutable.`,
    };
  }

  const replacement = drift.replacement;
  if (!replacement) return state;
  return {
    ...next,
    layerChanges: [
      ...state.layerChanges,
      { code: "X", path: drift.path, detail: `exclude inherited ${drift.provenance.layer} artifact` },
      { code: "A", path: replacement.path, detail: `current-Layer Modrinth addition · ${replacement.provider}` },
    ],
    unmanaged: state.unmanaged.filter((item) => item.path !== replacement.path),
    lastAction: `Staged one atomic replacement: exclude ${drift.path}, add ${replacement.path}.`,
  };
}
