import { types as utilTypes } from "node:util";

import {
  parseCapabilityContract,
  type ParsedCapabilityContract,
} from "../capability/index.js";
import { canonicalJson, type JsonValue } from "../json.js";
import { comparePathBytes, validateLogicalPath } from "../package/paths.js";
import { compileSchemaFile, type CompiledSchema } from "../schema/index.js";
import {
  captureStoredPackage,
  type PackageArtifactRef,
} from "./package-artifact-store.js";
import { snapshotPrivateOrdinaryJson } from "./private-ordinary-json.js";

const AGENT_RUN_ID = "https://jig.dev/contracts/agent-run";
const AGENT_RUN_VERSION = "1.0.0";
const AGENT_RUN_DIGEST =
  "sha256:ea66148b0ad15d5c060cb94b35fc7ce6ef8acbd5a764b70b92e89c8f11fc3715";
const LOCAL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface PrivateAgentRunRequest {
  readonly instructions: string;
  readonly skills?: readonly string[];
  readonly responseSchema?: JsonValue;
}

export interface PrivateAgentRunResult {
  readonly outcome: "completed" | "blocked" | "limit";
  readonly text: string;
  readonly structured?: JsonValue;
}

/** An operation-scoped logical view. It intentionally exposes no host path. */
export interface PrivateAgentSkillView {
  readonly names: readonly string[];
  files(skill: string): readonly string[];
  read(skill: string, relativePath: string): Promise<Uint8Array>;
}

export interface PrivateAgentRunContext {
  readonly instructions: string;
  readonly skills: PrivateAgentSkillView;
  readonly responseSchema?: JsonValue;
  readonly signal: AbortSignal;
}

export type PrivateAgentRunIntegration = (
  context: PrivateAgentRunContext,
) => unknown | Promise<unknown>;

export class PrivateAgentRunError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "PrivateAgentRunError";
  }
}

/**
 * First private Agent Run checkpoint: validate one canonical request, project
 * only selected package-local skill trees, invoke trusted test machinery, and
 * revoke the view before returning.
 */
export async function runPrivateAgentProjection(input: {
  readonly packageStoreRoot: string;
  readonly package: PackageArtifactRef;
  readonly contract: ParsedCapabilityContract;
  readonly request: unknown;
  readonly integration: PrivateAgentRunIntegration;
  readonly signal?: AbortSignal;
}): Promise<PrivateAgentRunResult> {
  const schemas = requireCanonicalContract(input.contract);
  const requestValue = snapshotJson(input.request, "Agent Run request");
  schemas.request.validate(requestValue, "AGENT_RUN_INPUT_INVALID");
  const request = requestValue as unknown as PrivateAgentRunRequest;
  const selected = validateSkillSelection(request.skills ?? []);
  const responseSchema = request.responseSchema === undefined
    ? undefined
    : compileSchemaFile(canonicalJson(request.responseSchema), "Agent Run responseSchema");

  if (input.signal?.aborted === true) {
    throw new PrivateAgentRunError("AGENT_RUN_CANCELLED", "Agent Run was cancelled before projection");
  }

  const captured = await captureStoredPackage(input.packageStoreRoot, input.package);
  const signal = input.signal ?? new AbortController().signal;
  let projection: ReturnType<typeof createProjection> | undefined;
  let provider: Promise<unknown> | undefined;
  let revokeOnAbort: (() => void) | undefined;

  try {
    projection = createProjection(captured, selected);
    revokeOnAbort = (): void => projection!.revoke();
    signal.addEventListener("abort", revokeOnAbort, { once: true });
    if (signal.aborted) {
      throw new PrivateAgentRunError("AGENT_RUN_CANCELLED", "Agent Run was cancelled during projection");
    }
    const context = Object.freeze({
      instructions: request.instructions,
      skills: projection.view,
      ...(request.responseSchema === undefined ? {} : { responseSchema: request.responseSchema }),
      signal,
    });
    provider = Promise.resolve().then(() => input.integration(context));
    const raw = await raceCancellation(provider, signal);
    const resultValue = snapshotJson(raw, "Agent Run result");
    schemas.result.validate(resultValue, "AGENT_RUN_OUTPUT_INVALID");
    const result = resultValue as unknown as PrivateAgentRunResult;
    validateStructuredResult(result, responseSchema);
    return result;
  } finally {
    if (revokeOnAbort !== undefined) signal.removeEventListener("abort", revokeOnAbort);
    projection?.revoke();
    // A trusted integration which ignores cancellation may settle after this
    // operation. It has already lost access to package resources.
    void provider?.catch(() => undefined);
    await captured.dispose();
  }
}

function requireCanonicalContract(contract: ParsedCapabilityContract): {
  readonly request: CompiledSchema;
  readonly result: CompiledSchema;
} {
  if (contract === null || typeof contract !== "object" || utilTypes.isProxy(contract) ||
      (Object.getPrototypeOf(contract) !== Object.prototype && Object.getPrototypeOf(contract) !== null)) {
    throw new PrivateAgentRunError("AGENT_RUN_CONTRACT_MISMATCH", "Agent Run contract must be an ordinary parsed descriptor");
  }
  const descriptorField = Object.getOwnPropertyDescriptor(contract, "descriptor");
  const digestField = Object.getOwnPropertyDescriptor(contract, "digest");
  if (descriptorField === undefined || !("value" in descriptorField) || !descriptorField.enumerable ||
      digestField === undefined || !("value" in digestField) || !digestField.enumerable) {
    throw new PrivateAgentRunError("AGENT_RUN_CONTRACT_MISMATCH", "Agent Run contract fields must be ordinary data");
  }
  const descriptor = snapshotJson(descriptorField.value, "Agent Run contract descriptor");
  const parsed = parseCapabilityContract(canonicalJson(descriptor), "canonical Agent Run contract");
  if (
    parsed.descriptor.id !== AGENT_RUN_ID ||
    parsed.descriptor.version !== AGENT_RUN_VERSION ||
    parsed.digest !== AGENT_RUN_DIGEST ||
    digestField.value !== parsed.digest ||
    !Object.hasOwn(parsed.descriptor.methods, "run")
  ) {
    throw new PrivateAgentRunError(
      "AGENT_RUN_CONTRACT_MISMATCH",
      "Agent Run requires the canonical 1.0.0 contract descriptor",
    );
  }
  // Never trust the caller-supplied mutable schema Map. These validators were
  // compiled again from the descriptor bytes just verified above.
  const request = parsed.schemas.get("/methods/run/input");
  const result = parsed.schemas.get("/methods/run/output");
  if (request === undefined || result === undefined) {
    throw new PrivateAgentRunError(
      "AGENT_RUN_CONTRACT_MISMATCH",
      "Agent Run contract is missing its compiled run schemas",
    );
  }
  return { request, result };
}

function validateSkillSelection(value: readonly string[]): readonly string[] {
  let prior: string | undefined;
  for (const name of value) {
    if (typeof name !== "string" || name.length < 1 || name.length > 64 || !LOCAL_NAME.test(name)) {
      throw new PrivateAgentRunError(
        "AGENT_RUN_SKILL_SELECTION_INVALID",
        "Agent Run skills must contain only LocalNames",
      );
    }
    if (prior !== undefined && comparePathBytes(prior, name) >= 0) {
      throw new PrivateAgentRunError(
        "AGENT_RUN_SKILL_SELECTION_INVALID",
        "Agent Run skills must be unique and strictly ordered by unsigned UTF-8 bytes",
      );
    }
    prior = name;
  }
  return Object.freeze([...value]);
}

function createProjection(
  captured: Awaited<ReturnType<typeof captureStoredPackage>>,
  selected: readonly string[],
): { readonly view: PrivateAgentSkillView; revoke(): void } {
  const files = new Map<string, readonly string[]>();
  for (const name of selected) {
    const prefix = `skills/${name}/`;
    if (!captured.files.some((file) => file.path === `${prefix}SKILL.md`)) {
      throw new PrivateAgentRunError(
        "AGENT_RUN_SKILL_UNKNOWN",
        `Agent Run selected unavailable Flow-local skill ${name}`,
      );
    }
    files.set(name, Object.freeze(captured.files
      .filter((file) => file.path.startsWith(prefix))
      .map((file) => file.path.slice(prefix.length))));
  }

  let active = true;
  const requireActive = (): void => {
    if (!active) {
      throw new PrivateAgentRunError(
        "AGENT_RUN_PROJECTION_REVOKED",
        "Agent Run skill projection is no longer active",
      );
    }
  };
  const requireSelected = (name: string): readonly string[] => {
    const selectedFiles = files.get(name);
    if (selectedFiles === undefined) {
      throw new PrivateAgentRunError(
        "AGENT_RUN_SKILL_UNAVAILABLE",
        `skill ${name} is not selected for this Agent Run`,
      );
    }
    return selectedFiles;
  };
  const view: PrivateAgentSkillView = Object.freeze({
    names: selected,
    files(name: string): readonly string[] {
      requireActive();
      return requireSelected(name);
    },
    async read(name: string, relativePath: string): Promise<Uint8Array> {
      requireActive();
      const selectedFiles = requireSelected(name);
      validateLogicalPath(relativePath);
      if (!selectedFiles.includes(relativePath)) {
        throw new PrivateAgentRunError(
          "AGENT_RUN_SKILL_FILE_UNAVAILABLE",
          `skill ${name} has no projected file ${relativePath}`,
        );
      }
      const bytes = await captured.read(`skills/${name}/${relativePath}`);
      requireActive();
      return bytes;
    },
  });
  return Object.freeze({
    view,
    revoke(): void {
      active = false;
    },
  });
}

async function raceCancellation<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    throw new PrivateAgentRunError("AGENT_RUN_CANCELLED", "Agent Run was cancelled");
  }
  let remove: (() => void) | undefined;
  const cancellation = new Promise<never>((_resolve, reject) => {
    const abort = (): void => reject(
      new PrivateAgentRunError("AGENT_RUN_CANCELLED", "Agent Run was cancelled"),
    );
    signal.addEventListener("abort", abort, { once: true });
    remove = () => signal.removeEventListener("abort", abort);
  });
  try {
    return await Promise.race([promise, cancellation]);
  } finally {
    remove?.();
  }
}

function validateStructuredResult(
  result: PrivateAgentRunResult,
  responseSchema: CompiledSchema | undefined,
): void {
  if (responseSchema === undefined) return;
  if (!Object.hasOwn(result, "structured")) {
    throw new PrivateAgentRunError(
      "AGENT_RUN_STRUCTURED_REQUIRED",
      "Agent Run responseSchema requires a structured result",
    );
  }
  responseSchema.validate(result.structured, "AGENT_RUN_STRUCTURED_INVALID");
}

function snapshotJson(value: unknown, label: string): JsonValue {
  return snapshotPrivateOrdinaryJson(
    value,
    label,
    (message) => new PrivateAgentRunError("AGENT_RUN_JSON_INVALID", message),
  );
}
