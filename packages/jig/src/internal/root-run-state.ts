import { invalid } from "../diagnostics.js";
import { canonicalJson, decodeJson1, validateJson1, type JsonValue } from "../json.js";
import type { RunTargetIdentity } from "../project/package-project.js";
import { normalizeProjectPath } from "../project/paths.js";
import type { RunHostTerminal } from "../run/session.js";
import { privateDomainDigest } from "./identity.js";

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const LOCAL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const UNSIGNED_DECIMAL = /^(?:0|[1-9][0-9]*)$/;
const MAX_UNSIGNED_64 = (1n << 64n) - 1n;
const RUN_HOST_FAILURE_CODES = new Set([
  "CANCELLED",
  "DEADLINE_EXCEEDED",
  "OWNER_CLOSED",
  "OPERATION_CONFLICT",
  "UNAVAILABLE",
  "PERMISSION_DENIED",
  "RESOURCE_EXHAUSTED",
  "INVALID_INPUT",
  "INVALID_RESULT",
  "UNCERTAIN",
  "EXECUTION_FAILED",
  "PROTOCOL_ERROR",
  "CHANNEL_LOST",
]);

export interface PrivateRootSubmissionRequest {
  readonly kind: "private-root-submission/1";
  readonly target: RunTargetIdentity;
  readonly input: JsonValue;
  readonly deadlineUnixMs: number;
}

export interface PrivateExternalSubmissionOrigin {
  readonly kind: "private-root-external-submission-origin/1";
  readonly submissionId: string;
}

export interface PrivateHookDerivedOrigin {
  readonly kind: "private-root-hook-derived-origin/1";
  readonly hookRevisionDigest: string;
  readonly eventId: string;
}

/** One closed, inert reason that a root Run exists. */
export type PrivateRootRunOrigin = PrivateExternalSubmissionOrigin | PrivateHookDerivedOrigin;

export interface PrivateRootRunIdentityInput {
  readonly project: {
    readonly device: string;
    readonly inode: string;
  };
  readonly origin: PrivateRootRunOrigin;
  readonly requestDigest: string;
  readonly coordinatorEpoch: number;
}

export type PrivateRootRunTerminal = RunHostTerminal | {
  readonly status: "lost";
  readonly code: "COORDINATOR_LOST";
  readonly message: string;
};

export interface PrivateRootRunSnapshot {
  readonly runId: string;
  readonly origin: PrivateRootRunOrigin;
  readonly admissionDigest: string;
  readonly candidateRevision: number;
  readonly coordinatorEpoch: number;
  readonly target: RunTargetIdentity;
  readonly input: JsonValue;
  readonly deadlineUnixMs: number;
  readonly state: "spawn-intent" | "terminal";
  readonly terminal?: PrivateRootRunTerminal;
}

export interface PrivateRootRunSpawnIntent {
  readonly kind: "private-root-spawn-intent/1";
  readonly runId: string;
  readonly admissionDigest: string;
  readonly candidateRevision: number;
  readonly coordinatorEpoch: number;
  readonly requestDigest: string;
  readonly recipeDigest: string;
  readonly observationDigest: string;
  readonly deadlineUnixMs: number;
}

export function createPrivateRootSubmissionRequest(input: {
  readonly submissionId: string;
  readonly target: RunTargetIdentity;
  readonly input: JsonValue;
  readonly deadlineUnixMs: number;
}): PrivateRootSubmissionRequest {
  requirePrivateRootSubmissionId(input.submissionId);
  if (!Number.isSafeInteger(input.deadlineUnixMs) || input.deadlineUnixMs < 0) {
    invalid("RUN_DEADLINE_INVALID", "root Run deadline must be a non-negative safe Unix millisecond value");
  }
  return Object.freeze({
    kind: "private-root-submission/1" as const,
    target: normalizeTarget(input.target),
    input: decodeJson1(canonicalJson(input.input)),
    deadlineUnixMs: input.deadlineUnixMs,
  });
}

export function createPrivateExternalSubmissionOrigin(
  submissionId: string,
): PrivateExternalSubmissionOrigin {
  return normalizePrivateRootRunOrigin({
    kind: "private-root-external-submission-origin/1",
    submissionId,
  }) as PrivateExternalSubmissionOrigin;
}

export function createPrivateHookDerivedOrigin(input: {
  readonly hookRevisionDigest: string;
  readonly eventId: string;
}): PrivateHookDerivedOrigin {
  return normalizePrivateRootRunOrigin({
    kind: "private-root-hook-derived-origin/1",
    hookRevisionDigest: input.hookRevisionDigest,
    eventId: input.eventId,
  }) as PrivateHookDerivedOrigin;
}

export function normalizePrivateRootRunOrigin(value: unknown): PrivateRootRunOrigin {
  const kind = value !== null && typeof value === "object"
    ? (value as Record<string, unknown>).kind
    : undefined;
  if (kind === "private-root-external-submission-origin/1") {
    const root = exactRecord(value, ["kind", "submissionId"], "external root Run origin");
    requirePrivateRootSubmissionId(root.submissionId);
    return Object.freeze({
      kind: "private-root-external-submission-origin/1",
      submissionId: root.submissionId as string,
    });
  }
  if (kind === "private-root-hook-derived-origin/1") {
    const root = exactRecord(
      value,
      ["kind", "hookRevisionDigest", "eventId"],
      "Hook-derived root Run origin",
    );
    return Object.freeze({
      kind: "private-root-hook-derived-origin/1",
      hookRevisionDigest: digest(root.hookRevisionDigest, "Hook revision"),
      eventId: digest(root.eventId, "Hook Event"),
    });
  }
  throw new TypeError("root Run origin kind is invalid");
}

export function encodePrivateRootRunOrigin(value: PrivateRootRunOrigin): Uint8Array {
  return canonicalJson(normalizePrivateRootRunOrigin(value) as unknown as JsonValue);
}

export function decodePrivateRootRunOrigin(bytes: Uint8Array): PrivateRootRunOrigin {
  const origin = normalizePrivateRootRunOrigin(decodeJson1(bytes));
  if (!sameBytes(bytes, canonicalJson(origin as unknown as JsonValue))) {
    throw new TypeError("root Run origin is not canonical JSON/1");
  }
  return origin;
}

export function privateRootRunOriginDigest(value: PrivateRootRunOrigin): string {
  const origin = normalizePrivateRootRunOrigin(value);
  return origin.kind === "private-root-external-submission-origin/1"
    ? privateDomainDigest(
        "JIG-Private-Root-Origin-External-Submission/1",
        { submissionId: origin.submissionId },
      )
    : privateDomainDigest(
        "JIG-Private-Root-Origin-Hook-Derived/1",
        {
          hookRevisionDigest: origin.hookRevisionDigest,
          eventId: origin.eventId,
        },
      );
}

export function normalizePrivateRootRunIdentityInput(
  value: unknown,
): PrivateRootRunIdentityInput {
  const root = exactRecord(
    value,
    ["project", "origin", "requestDigest", "coordinatorEpoch"],
    "root Run identity input",
  );
  const project = exactRecord(root.project, ["device", "inode"], "root Run identity project");
  return Object.freeze({
    project: Object.freeze({
      device: unsigned64(project.device, "root Run project device"),
      inode: unsigned64(project.inode, "root Run project inode"),
    }),
    origin: normalizePrivateRootRunOrigin(root.origin),
    requestDigest: digest(root.requestDigest, "root Run identity request"),
    coordinatorEpoch: positiveSafeInteger(root.coordinatorEpoch, "root Run identity coordinator epoch"),
  });
}

/** The origin-aware deterministic Run identity selected for the next store schema. */
export function privateRootRunIdentityDigest(value: PrivateRootRunIdentityInput): string {
  const input = normalizePrivateRootRunIdentityInput(value);
  return privateDomainDigest("JIG-Private-Root-Run/2", {
    project: input.project,
    originDigest: privateRootRunOriginDigest(input.origin),
    requestDigest: input.requestDigest,
    coordinatorEpoch: input.coordinatorEpoch,
  });
}

export function requirePrivateRootSubmissionId(value: unknown): asserts value is string {
  if (typeof value !== "string") {
    invalid("SUBMISSION_ID_INVALID", "root submission ID must be a string");
  }
  try {
    validateJson1(value);
  } catch {
    invalid("SUBMISSION_ID_INVALID", "root submission ID must be FLOW JSON/1");
  }
  const length = [...value].length;
  if (length < 1 || length > 1024) {
    invalid("SUBMISSION_ID_INVALID", "root submission ID must contain 1 to 1024 Unicode scalar values");
  }
}

export function decodePrivateRootSubmissionRequest(bytes: Uint8Array): PrivateRootSubmissionRequest {
  const value = exactRecord(decodeJson1(bytes), ["kind", "target", "input", "deadlineUnixMs"], "root Run request");
  if (value.kind !== "private-root-submission/1") throw new TypeError("root Run request kind is invalid");
  const request = createPrivateRootSubmissionRequest({
    submissionId: "stored",
    target: value.target as RunTargetIdentity,
    input: value.input as JsonValue,
    deadlineUnixMs: value.deadlineUnixMs as number,
  });
  if (!sameBytes(bytes, canonicalJson(request as unknown as JsonValue))) {
    throw new TypeError("root Run request is not canonical JSON/1");
  }
  return request;
}

export function privateRootSubmissionDigest(request: PrivateRootSubmissionRequest): string {
  return privateDomainDigest(
    "JIG-Private-Root-Submission/1",
    { target: request.target, input: request.input } as unknown as JsonValue,
  );
}

export function privateRootRequestDigest(request: PrivateRootSubmissionRequest): string {
  return privateDomainDigest(
    "JIG-Private-Root-Request/1",
    request as unknown as JsonValue,
  );
}

export function normalizePrivateRootSpawnIntent(value: unknown): PrivateRootRunSpawnIntent {
  const root = exactRecord(value, [
    "kind",
    "runId",
    "admissionDigest",
    "candidateRevision",
    "coordinatorEpoch",
    "requestDigest",
    "recipeDigest",
    "observationDigest",
    "deadlineUnixMs",
  ], "root Run spawn intent");
  if (root.kind !== "private-root-spawn-intent/1") throw new TypeError("root Run spawn intent kind is invalid");
  const candidateRevision = positiveSafeInteger(root.candidateRevision, "root Run candidate revision");
  const coordinatorEpoch = positiveSafeInteger(root.coordinatorEpoch, "root Run coordinator epoch");
  const deadlineUnixMs = nonnegativeSafeInteger(root.deadlineUnixMs, "root Run spawn intent deadline");
  return Object.freeze({
    kind: "private-root-spawn-intent/1" as const,
    runId: digest(root.runId, "root Run spawn intent run"),
    admissionDigest: digest(root.admissionDigest, "root Run spawn intent admission"),
    candidateRevision,
    coordinatorEpoch,
    requestDigest: digest(root.requestDigest, "root Run spawn intent request"),
    recipeDigest: digest(root.recipeDigest, "root Run spawn intent recipe"),
    observationDigest: digest(root.observationDigest, "root Run spawn intent observation"),
    deadlineUnixMs,
  });
}

export function privateRootSpawnIntentDigest(intent: PrivateRootRunSpawnIntent): string {
  return privateDomainDigest("JIG-Private-Root-Spawn-Intent/1", intent as unknown as JsonValue);
}

export function failedPrivateRootTerminal(
  code: Extract<RunHostTerminal, { readonly status: "failed" }>["code"],
  message: string,
  details?: JsonValue,
): RunHostTerminal {
  return Object.freeze({
    status: "failed" as const,
    code,
    message,
    ...(details === undefined ? {} : { details }),
    diagnostics: Object.freeze({ stderr: "", stderrBytes: 0, stderrTruncated: false }),
  });
}

export function normalizePrivateRootTerminal(value: unknown): PrivateRootRunTerminal {
  const status = value !== null && typeof value === "object"
    ? (value as Record<string, unknown>).status
    : undefined;
  if (status === "lost") {
    const root = exactRecord(value, ["status", "code", "message"], "lost root Run terminal");
    if (root.code !== "COORDINATOR_LOST" || typeof root.message !== "string") {
      throw new TypeError("lost root Run terminal is invalid");
    }
    return Object.freeze({ status: "lost", code: "COORDINATOR_LOST", message: root.message });
  }
  if (status === "succeeded") {
    const root = exactRecord(value, ["status", "result", "diagnostics"], "successful root Run terminal");
    const result = exactRecord(root.result, ["outcome", "output"], "root Run result");
    if (typeof result.outcome !== "string" || result.outcome.length === 0) throw new TypeError("root Run outcome is invalid");
    return Object.freeze({
      status: "succeeded",
      result: Object.freeze({
        outcome: result.outcome,
        output: decodeJson1(canonicalJson(result.output as JsonValue)),
      }),
      diagnostics: normalizeDiagnostics(root.diagnostics),
    });
  }
  if (status === "failed") {
    const hasDetails = value !== null && typeof value === "object" &&
      Object.prototype.hasOwnProperty.call(value, "details");
    const root = exactRecord(
      value,
      hasDetails ? ["status", "code", "message", "details", "diagnostics"] : ["status", "code", "message", "diagnostics"],
      "failed root Run terminal",
    );
    if (typeof root.code !== "string" || !RUN_HOST_FAILURE_CODES.has(root.code) || typeof root.message !== "string") {
      throw new TypeError("failed root Run terminal is invalid");
    }
    const details = hasDetails ? decodeJson1(canonicalJson(root.details as JsonValue)) : undefined;
    return Object.freeze({
      status: "failed",
      code: root.code as Extract<RunHostTerminal, { readonly status: "failed" }>["code"],
      message: root.message,
      ...(details === undefined ? {} : { details }),
      diagnostics: normalizeDiagnostics(root.diagnostics),
    });
  }
  throw new TypeError("root Run terminal status is invalid");
}

export function privateRootTerminalBytes(terminal: PrivateRootRunTerminal): Uint8Array {
  return canonicalJson(terminal as unknown as JsonValue);
}

function normalizeTarget(value: unknown): RunTargetIdentity {
  const target = exactRecord(value, value !== null && typeof value === "object" &&
    Object.prototype.hasOwnProperty.call(value, "path") ? ["kind", "path"] : ["kind", "id"], "root Run target");
  if (target.kind === "flow" && typeof target.path === "string") {
    try {
      return Object.freeze({
        kind: "flow" as const,
        path: normalizeProjectPath(target.path, "root Run Flow target"),
      });
    } catch {
      invalid("RUN_TARGET_INVALID", "root Run Flow target is invalid");
    }
  }
  if (target.kind === "binding" && typeof target.id === "string" && LOCAL_NAME.test(target.id)) {
    return Object.freeze({ kind: "binding" as const, id: target.id });
  }
  invalid("RUN_TARGET_INVALID", "root Run target must be one canonical Flow or Binding identity");
}

function normalizeDiagnostics(value: unknown): Extract<RunHostTerminal, { readonly status: "succeeded" }>["diagnostics"] {
  const diagnostics = exactRecord(value, ["stderr", "stderrBytes", "stderrTruncated"], "root Run diagnostics");
  if (typeof diagnostics.stderr !== "string" ||
      !Number.isSafeInteger(diagnostics.stderrBytes) || (diagnostics.stderrBytes as number) < 0 ||
      typeof diagnostics.stderrTruncated !== "boolean") {
    throw new TypeError("root Run diagnostics are invalid");
  }
  return Object.freeze({
    stderr: diagnostics.stderr,
    stderrBytes: diagnostics.stderrBytes as number,
    stderrTruncated: diagnostics.stderrTruncated,
  });
}

function exactRecord(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new TypeError(`${label} must contain exactly: ${expected.join(", ")}`);
  }
  return value as Record<string, unknown>;
}

function digest(value: unknown, label: string): string {
  if (typeof value !== "string" || !DIGEST.test(value)) {
    throw new TypeError(`${label} digest is invalid`);
  }
  return value;
}

function positiveSafeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) throw new TypeError(`${label} is invalid`);
  return value as number;
}

function nonnegativeSafeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new TypeError(`${label} is invalid`);
  return value as number;
}

function unsigned64(value: unknown, label: string): string {
  if (typeof value !== "string" || !UNSIGNED_DECIMAL.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  let parsed: bigint;
  try { parsed = BigInt(value); }
  catch { throw new TypeError(`${label} is invalid`); }
  if (parsed > MAX_UNSIGNED_64) throw new TypeError(`${label} is invalid`);
  return value;
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && left.every((byte, index) => byte === right[index]);
}
