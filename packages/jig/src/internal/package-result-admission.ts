import type { InspectedPackage } from "../package/inspect.js";
import { SchemaDiagnostic } from "../schema/index.js";
import type { RunHostTerminal } from "../run/session.js";

/**
 * Turn one clean protocol/process terminal into an admitted package result.
 *
 * Process hosting owns framing, owner quiescence, fencing, and cleanup. This
 * gate owns only Package/1 outcome and result-schema meaning, and therefore
 * belongs after a RunHostSession settles but before durable success commits.
 */
export function admitPrivatePackageResult(
  inspected: InspectedPackage,
  terminal: RunHostTerminal,
): RunHostTerminal {
  if (inspected.mode !== "run") {
    throw new TypeError("only a Run package can admit a Run result");
  }
  if (terminal.status !== "succeeded") return terminal;

  const { outcome } = terminal.result;
  if (outcome !== "done" && !Object.hasOwn(inspected.metadata.outcomes ?? {}, outcome)) {
    return invalidResult(
      terminal,
      `component returned undeclared outcome ${JSON.stringify(outcome)}`,
      Object.freeze({ outcome }),
    );
  }

  try {
    inspected.schemas.result?.validate(terminal.result, "INVALID_RESULT");
  } catch (error) {
    if (!(error instanceof SchemaDiagnostic)) throw error;
    return invalidResult(
      terminal,
      error.message,
      Object.freeze({
        code: error.code,
        instancePointer: error.instancePointer,
        schemaPointer: error.schemaPointer,
        path: error.path,
        ...(error.keyword === undefined ? {} : { keyword: error.keyword }),
      }),
    );
  }

  return terminal;
}

function invalidResult(
  terminal: Extract<RunHostTerminal, { readonly status: "succeeded" }>,
  message: string,
  details: NonNullable<Extract<RunHostTerminal, { readonly status: "failed" }>["details"]>,
): RunHostTerminal {
  return Object.freeze({
    status: "failed" as const,
    code: "INVALID_RESULT" as const,
    message,
    details,
    diagnostics: terminal.diagnostics,
  });
}
