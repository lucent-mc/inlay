export type Digest = {
  sha256: string;
  bytes: number;
};

export type FieldKind = "config" | "mod" | "content" | "unmanaged" | "layer";
export type FieldStatus =
  | "drift"
  | "inherited"
  | "layer"
  | "unmanaged"
  | "adopted"
  | "restored"
  | "excluded"
  | "replaced";

export type Replacement = {
  path: string;
  digest: Digest;
  source: string;
};

export type Field = {
  id: string;
  path: string;
  kind: FieldKind;
  status: FieldStatus;
  inheritedOwner?: string;
  source: string;
  inherited?: Digest;
  working: Digest;
  replacement?: Replacement;
};

export type LedgerState = {
  layer: string;
  parent: string;
  instance: string;
  cleanInherited: number;
  phase: "reconciling" | "ready" | "stopped";
  fields: Field[];
  expandedId?: string;
  notice: string;
  upstreamPath?: string;
};

export type LedgerAction =
  | { type: "inspect"; id?: string }
  | { type: "adopt"; id: string }
  | { type: "restore"; id: string }
  | { type: "exclude"; id: string }
  | { type: "replace"; id: string }
  | { type: "track-upstream"; id: string };

export type PlannedOperation = {
  scope: "current manifest" | "materialized instance";
  mark: "+" | "-" | "~";
  description: string;
};

const initialFields: Field[] = [
  {
    id: "sodium-config",
    path: "config/sodium-options.json",
    kind: "config",
    status: "drift",
    inheritedOwner: "Fabulously Optimized",
    source: "parent@14.0.0-beta.4 / overrides",
    inherited: {
      sha256: "43d9c0379c3afec72014900cb6d77de78429ad53f21b68e3165332dd086cf18e",
      bytes: 1_842,
    },
    working: {
      sha256: "bc25ab4037ff320aae0cf3f455912088bca552f895116efdba494143477637ef",
      bytes: 1_901,
    },
  },
  {
    id: "iris-config",
    path: "config/iris.properties",
    kind: "config",
    status: "drift",
    inheritedOwner: "Fabulously Optimized",
    source: "parent@14.0.0-beta.4 / overrides",
    inherited: {
      sha256: "9bd6656f0d9441548977465485cbf99457eeaf70ea2141f954c984b11016393f",
      bytes: 326,
    },
    working: {
      sha256: "13e24cc035f9e12780f85b5c6fa4abf8a3f398c121a5c3d2eb386911477e758c",
      bytes: 331,
    },
  },
  {
    id: "base-tweaks",
    path: "resourcepacks/base-tweaks.zip",
    kind: "content",
    status: "drift",
    inheritedOwner: "Fabulously Optimized",
    source: "parent@14.0.0-beta.4 / modrinth",
    inherited: {
      sha256: "7073c69fd2e50cf2a886819c011b9708e7db78d107c5e6b85ea95b5ad69bf0aa",
      bytes: 84_221,
    },
    working: {
      sha256: "4f3beeb8756e6002693ce82f43b46a0a52fdc14f416580297275d301f82a521b",
      bytes: 84_112,
    },
  },
  {
    id: "sodium-mod",
    path: "mods/sodium-fabric-0.8.12+mc1.21.1.jar",
    kind: "mod",
    status: "drift",
    inheritedOwner: "Fabulously Optimized",
    source: "parent@14.0.0-beta.4 / modrinth",
    inherited: {
      sha256: "7588df6e4afb521255fe640fd4faa48318a82153bf6ae52f3a4a9326e0228364",
      bytes: 1_568_030,
    },
    working: {
      sha256: "7588df6e4afb521255fe640fd4faa48318a82153bf6ae52f3a4a9326e0228364",
      bytes: 1_568_030,
    },
    replacement: {
      path: "mods/sodium-fabric-0.8.13-beta.2+mc1.21.1.jar",
      digest: {
        sha256: "34265bb2636b0c4dd1fdac78c5bbbe3c85e4fdf4d30a9f215b42a0bdc104610c",
        bytes: 1_574_596,
      },
      source: "materialized instance / added file",
    },
  },
  {
    id: "child-settings",
    path: "config/lucent-client.toml",
    kind: "layer",
    status: "layer",
    source: "current layer / repository",
    working: {
      sha256: "60d84f13156112e144ed451bde7d7cbff32a9c5aa236bdf5e66b75025f45cefc",
      bytes: 684,
    },
  },
  {
    id: "screenshot",
    path: "screenshots/2026-08-12_22.48.31.png",
    kind: "unmanaged",
    status: "unmanaged",
    source: "filesystem only",
    working: {
      sha256: "6c4fbd03f6284ad7f04e6c4372088d401ccb1fed262a135ef699bb4c139927b9",
      bytes: 2_318_920,
    },
  },
  {
    id: "latest-log",
    path: "logs/latest.log",
    kind: "unmanaged",
    status: "unmanaged",
    source: "filesystem only",
    working: {
      sha256: "9b10d649a209a36d3bdd1e394c9d73e455002501113c51107ed145d669174e71",
      bytes: 93_445,
    },
  },
];

export function createLedger(): LedgerState {
  return {
    layer: "Lucent Optimisations",
    parent: "Fabulously Optimized @ 14.0.0-beta.4",
    instance: ". (launcher-agnostic materialization)",
    cleanInherited: 148,
    phase: "reconciling",
    fields: structuredClone(initialFields),
    notice: "Four inherited fields differ. Packaging is locked until each has a decision.",
  };
}

function updateField(
  state: LedgerState,
  id: string,
  update: (field: Field) => Field,
): LedgerState {
  return {
    ...state,
    fields: state.fields.map((field) => field.id === id ? update(field) : field),
  };
}

function requireDrift(state: LedgerState, id: string): Field {
  const field = state.fields.find((candidate) => candidate.id === id);
  if (!field || field.status !== "drift") {
    throw new Error(`Field ${id} is not unresolved inherited drift`);
  }
  return field;
}

function settle(state: LedgerState, notice: string): LedgerState {
  const blocked = state.fields.some((field) => field.status === "drift");
  return {
    ...state,
    phase: blocked ? "reconciling" : "ready",
    notice: blocked
      ? notice
      : `${notice} All inherited drift has a decision; packaging is unlocked.`,
  };
}

export function reduceLedger(state: LedgerState, action: LedgerAction): LedgerState {
  if (state.phase === "stopped") return state;

  if (action.type === "inspect") {
    return {
      ...state,
      expandedId: state.expandedId === action.id ? undefined : action.id,
      notice: action.id ? "Digest detail opened. No reconciliation choice was made." : state.notice,
    };
  }

  const field = requireDrift(state, action.id);

  if (action.type === "track-upstream") {
    return {
      ...state,
      phase: "stopped",
      fields: state.fields.map((candidate) =>
        ["adopted", "restored", "excluded", "replaced"].includes(candidate.status)
          ? { ...candidate, status: "drift" }
          : candidate
      ),
      expandedId: action.id,
      upstreamPath: field.path,
      notice: `Stopped at ${field.path}. Staged choices were discarded; no parent or current-layer edits exist.`,
    };
  }

  if (action.type === "adopt") {
    return settle(
      updateField(state, action.id, (candidate) => ({ ...candidate, status: "adopted" })),
      `Adopted ${field.path} as an explicit override owned by ${state.layer}.`,
    );
  }

  if (action.type === "restore") {
    if (!field.inherited) throw new Error(`Field ${field.path} has no inherited digest`);
    return settle(
      updateField(state, action.id, (candidate) => ({ ...candidate, status: "restored" })),
      `Restored ${field.path} from its verified inherited bytes.`,
    );
  }

  if (action.type === "exclude") {
    return settle(
      updateField(state, action.id, (candidate) => ({ ...candidate, status: "excluded" })),
      `Excluded inherited ${field.path} in ${state.layer}.`,
    );
  }

  if (!field.replacement) throw new Error(`Field ${field.path} has no replacement candidate`);
  return settle(
    updateField(state, action.id, (candidate) => ({ ...candidate, status: "replaced" })),
    `Replaced ${field.path} with ${field.replacement.path} as one atomic intent.`,
  );
}

export function blockingFields(state: LedgerState): Field[] {
  return state.fields.filter((field) => field.status === "drift");
}

export function plannedOperations(state: LedgerState): PlannedOperation[] {
  if (state.phase === "stopped") return [];

  return state.fields.flatMap((field): PlannedOperation[] => {
    if (field.status === "adopted") {
      return [{
        scope: "current manifest",
        mark: "+",
        description: `files[] override ${field.path} from working bytes`,
      }];
    }
    if (field.status === "restored") {
      return [{
        scope: "materialized instance",
        mark: "~",
        description: `restore ${field.path} from ${field.inheritedOwner}`,
      }];
    }
    if (field.status === "excluded") {
      return [{
        scope: "current manifest",
        mark: "-",
        description: `exclusions[] ${field.path}`,
      }];
    }
    if (field.status === "replaced" && field.replacement) {
      return [
        {
          scope: "current manifest",
          mark: "-",
          description: `exclusions[] ${field.path}`,
        },
        {
          scope: "current manifest",
          mark: "+",
          description: `files[] ${field.replacement.path} from added bytes`,
        },
      ];
    }
    return [];
  });
}
