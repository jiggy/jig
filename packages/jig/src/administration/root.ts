import { JSON_1_LIMITS, validateJson1, type JsonValue } from "../json.js";
import {
  bindingRef,
  flowRef,
  type RunTargetRef,
} from "../project/author.js";

const DIGEST = /^sha256:[0-9a-f]{64}$/;

export type RootAdministrationErrorCode =
  | "INVALID_REQUEST"
  | "SUBMISSION_CONFLICT"
  | "RUN_NOT_FOUND"
  | "PROJECT_BUSY"
  | "PROJECT_CLOSED"
  | "UNAVAILABLE"
  | "INTERNAL";

export interface RootAdministrationErrorValue {
  readonly code: RootAdministrationErrorCode;
  readonly message: string;
  readonly details?: JsonValue;
}

export type RootRunFailureCode =
  | "CANCELLED"
  | "DEADLINE_EXCEEDED"
  | "OWNER_CLOSED"
  | "OPERATION_CONFLICT"
  | "UNAVAILABLE"
  | "PERMISSION_DENIED"
  | "RESOURCE_EXHAUSTED"
  | "INVALID_INPUT"
  | "INVALID_RESULT"
  | "UNCERTAIN"
  | "EXECUTION_FAILED"
  | "PROTOCOL_ERROR"
  | "CHANNEL_LOST";

export interface RootRunDiagnostics {
  readonly stderr: string;
  readonly stderrBytes: number;
  readonly stderrTruncated: boolean;
}

export type RootRunTerminal =
  | {
      readonly status: "succeeded";
      readonly outcome: string;
      readonly output: JsonValue;
      readonly diagnostics: RootRunDiagnostics;
    }
  | {
      readonly status: "failed";
      readonly code: RootRunFailureCode;
      readonly message: string;
      readonly details?: JsonValue;
      readonly diagnostics: RootRunDiagnostics;
    }
  | {
      readonly status: "lost";
      readonly code: "COORDINATOR_LOST";
      readonly message: string;
    };

export interface StartRootRunRequest {
  readonly submissionId: string;
  readonly target: RunTargetRef;
  readonly input: JsonValue;
}

export interface StartRootRunReceipt {
  readonly runId: string;
}

export interface RootRunStatusRequest {
  readonly runId: string;
}

interface RootRunStatusBase {
  readonly runId: string;
  readonly submissionId: string;
  readonly target: RunTargetRef;
}

export type RootRunStatus =
  | (RootRunStatusBase & { readonly state: "pending" })
  | (RootRunStatusBase & {
      readonly state: "terminal";
      readonly terminal: RootRunTerminal;
    });

/**
 * A host-issued authority for one already-open project. It is not a project
 * locator, transport, global singleton, or sandbox configuration surface.
 */
export interface RootAdministration {
  startRun(request: StartRootRunRequest): Promise<StartRootRunReceipt>;
  runStatus(request: RootRunStatusRequest): Promise<RootRunStatus>;
}

export class RootAdministrationError extends Error {
  readonly code: RootAdministrationErrorCode;
  readonly details?: JsonValue;

  constructor(code: RootAdministrationErrorCode, message: string, details?: JsonValue) {
    super(message);
    this.name = "RootAdministrationError";
    this.code = code;
    if (details !== undefined) this.details = snapshotJson(details, "administration error details");
  }

  toJSON(): RootAdministrationErrorValue {
    return Object.freeze({
      code: this.code,
      message: this.message,
      ...(this.details === undefined ? {} : { details: this.details }),
    });
  }
}

/** Package-private runtime normalization used by the trusted controller. */
export function normalizeStartRootRunRequest(value: unknown): StartRootRunRequest {
  const root = exactRecord(snapshotJson(value, "start Run request"), [
    "submissionId",
    "target",
    "input",
  ], "start Run request");
  const submissionLength = typeof root.submissionId === "string"
    ? scalarLength(root.submissionId)
    : 0;
  if (typeof root.submissionId !== "string" || submissionLength < 1 || submissionLength > 1024) {
    invalidRequest("submissionId must contain 1 to 1024 Unicode scalar values");
  }
  return Object.freeze({
    submissionId: root.submissionId,
    target: normalizeTarget(root.target),
    input: root.input as JsonValue,
  });
}

/** Package-private runtime normalization used by the trusted controller. */
export function normalizeRootRunStatusRequest(value: unknown): RootRunStatusRequest {
  const root = exactRecord(snapshotJson(value, "Run status request"), ["runId"], "Run status request");
  if (typeof root.runId !== "string" || !DIGEST.test(root.runId)) invalidRequest("runId is invalid");
  return Object.freeze({ runId: root.runId });
}

function normalizeTarget(value: unknown): RunTargetRef {
  const target = exactRecord(value, value !== null && typeof value === "object" &&
    Object.hasOwn(value, "path") ? ["kind", "path"] : ["kind", "id"], "Run target");
  try {
    if (target.kind === "flow" && typeof target.path === "string") return flowRef(target.path);
    if (target.kind === "binding" && typeof target.id === "string") return bindingRef(target.id);
  } catch (error) {
    invalidRequest(error instanceof Error ? error.message : "Run target is invalid");
  }
  invalidRequest("Run target must be one tagged Flow or Binding reference");
}

function snapshotJson(value: unknown, label: string): JsonValue {
  let snapshot: JsonValue;
  try {
    snapshot = copyJson(value, label, new WeakSet<object>(), { nodes: 0 }, 1);
    validateJson1(snapshot);
  } catch {
    invalidRequest(`${label} must be FLOW JSON/1`);
  }
  return snapshot;
}

/** Package-private immutable JSON/1 projection for trusted controller output. */
export function snapshotRootAdministrationJson(value: unknown, label: string): JsonValue {
  return snapshotJson(value, label);
}

function copyJson(
  value: unknown,
  label: string,
  active: WeakSet<object>,
  work: { nodes: number },
  depth: number,
): JsonValue {
  if (depth > JSON_1_LIMITS.depth) throw new TypeError(`${label} is too deep`);
  work.nodes += 1;
  if (work.nodes > JSON_1_LIMITS.nodes) throw new TypeError(`${label} has too many values`);
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))) {
      throw new TypeError(`${label} contains an invalid number`);
    }
    return value;
  }
  if (typeof value !== "object" || active.has(value)) {
    throw new TypeError(`${label} contains a non-JSON value or cycle`);
  }
  active.add(value);
  try {
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key === "symbol")) {
      throw new TypeError(`${label} contains a symbol property`);
    }
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype || keys.length !== value.length + 1) {
        throw new TypeError(`${label} contains a non-plain or sparse array`);
      }
      if (value.length > JSON_1_LIMITS.containerEntries) throw new TypeError(`${label} has too many items`);
      const output: JsonValue[] = [];
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
          throw new TypeError(`${label} contains an accessor-backed or sparse array`);
        }
        output.push(copyJson(descriptor.value, label, active, work, depth + 1));
      }
      return Object.freeze(output);
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`${label} contains a non-plain object`);
    }
    if (keys.length > JSON_1_LIMITS.containerEntries) throw new TypeError(`${label} has too many members`);
    const output = Object.create(null) as Record<string, JsonValue>;
    for (const key of keys as string[]) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
        throw new TypeError(`${label} contains an accessor or hidden property`);
      }
      Object.defineProperty(output, key, {
        value: copyJson(descriptor.value, label, active, work, depth + 1),
        enumerable: true,
        writable: false,
        configurable: false,
      });
    }
    return Object.freeze(output);
  } finally {
    active.delete(value);
  }
}

function exactRecord(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    invalidRequest(`${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    invalidRequest(`${label} must contain exactly: ${expected.join(", ")}`);
  }
  return value as Record<string, unknown>;
}

function invalidRequest(message: string): never {
  throw new RootAdministrationError("INVALID_REQUEST", message);
}

function scalarLength(value: string): number {
  return [...value].length;
}
