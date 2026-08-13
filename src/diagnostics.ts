import { JSON_RESULT_SCHEMA_VERSION } from "./constants.js";
import type { CommandResult, Diagnostic } from "./types.js";

export class InlayError extends Error {
  readonly diagnostics: Diagnostic[];
  readonly exitCode: 1 | 2 | 3;

  constructor(diagnostic: Diagnostic | Diagnostic[], exitCode: 1 | 2 | 3 = 1) {
    const diagnostics = Array.isArray(diagnostic) ? diagnostic : [diagnostic];
    super(diagnostics.map((item) => item.message).join("\n"));
    this.name = "InlayError";
    this.diagnostics = diagnostics;
    this.exitCode = exitCode;
  }
}

export function error(code: string, message: string, context: Partial<Diagnostic> = {}): Diagnostic {
  return { code, severity: "error", message, ...context };
}

export function warning(code: string, message: string, context: Partial<Diagnostic> = {}): Diagnostic {
  return { code, severity: "warning", message, ...context };
}

export function info(code: string, message: string, context: Partial<Diagnostic> = {}): Diagnostic {
  return { code, severity: "info", message, ...context };
}

export function result<T>(
  command: string,
  data: T,
  diagnostics: Diagnostic[] = [],
  changed = false,
): CommandResult<T> {
  return {
    schemaVersion: JSON_RESULT_SCHEMA_VERSION,
    command,
    ok: !diagnostics.some((item) => item.severity === "error"),
    changed,
    diagnostics,
    data,
  };
}
