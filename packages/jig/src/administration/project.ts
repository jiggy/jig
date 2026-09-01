import { types as utilTypes } from "node:util";

import { validateJson1 } from "../json.js";
import { isProtectedProjectPath, validateProjectPath } from "../project/paths.js";
import type { RootAdministration } from "./root.js";

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const DIAGNOSTIC_CODE = /^[A-Z][A-Z0-9_]{0,127}$/;
const MAX_MESSAGE_SCALARS = 1_024;
const MAX_POINTER_SCALARS = 1_024;

export type ProjectAdministrationErrorCode =
  | "INVALID_REQUEST"
  | "PROJECT_NOT_FOUND"
  | "PROJECT_UNSAFE"
  | "INVALID_CANDIDATE"
  | "LOCK_MISMATCH"
  | "PLAN_NOT_FOUND"
  | "STALE_PLAN"
  | "PROJECT_BUSY"
  | "PROJECT_CLOSED"
  | "UNAVAILABLE"
  | "INTERNAL";

export interface ProjectAdministrationErrorValue {
  readonly code: ProjectAdministrationErrorCode;
  readonly message: string;
  readonly diagnostic?: ProjectInvalidCandidateDiagnostic;
}

export interface ProjectInvalidCandidateDiagnostic {
  readonly code: string;
  readonly path: string;
  readonly pointer?: string;
}

export interface ProjectPlanRequest {
  readonly lockMode: "update" | "locked";
}

export type ProjectPlanResult =
  | { readonly state: "unchanged" }
  | {
      readonly state: "applicable";
      readonly operation: "admission" | "lock-repair";
      readonly planDigest: string;
      readonly review: {
        readonly mediaType: "text/plain; charset=utf-8";
        readonly text: string;
      };
    };

export interface ProjectApplyRequest {
  readonly planDigest: string;
}

export interface ProjectApplyReceipt {
  readonly operation: "admission" | "lock-repair";
  readonly planDigest: string;
}

export interface ProjectSession {
  plan(request: ProjectPlanRequest): Promise<ProjectPlanResult>;
  apply(request: ProjectApplyRequest): Promise<ProjectApplyReceipt>;
  readonly rootAdministration: RootAdministration;
  close(): Promise<void>;
}

export class ProjectAdministrationError extends Error {
  readonly code: ProjectAdministrationErrorCode;
  readonly diagnostic?: ProjectInvalidCandidateDiagnostic;

  constructor(
    code: ProjectAdministrationErrorCode,
    message: string,
    diagnostic?: ProjectInvalidCandidateDiagnostic,
  ) {
    requireErrorCode(code);
    const messageScalars = typeof message === "string" ? scalarLength(message) : 0;
    try {
      validateJson1(message);
    } catch {
      throw new TypeError("project administration error message is invalid");
    }
    if (messageScalars < 1 || messageScalars > MAX_MESSAGE_SCALARS) {
      throw new TypeError("project administration error message is invalid");
    }
    super(message);
    this.name = "ProjectAdministrationError";
    this.code = code;
    if (diagnostic !== undefined) {
      if (code !== "INVALID_CANDIDATE") {
        throw new TypeError("project diagnostic requires INVALID_CANDIDATE");
      }
      this.diagnostic = normalizeInvalidCandidateDiagnostic(diagnostic);
    }
  }

  toJSON(): ProjectAdministrationErrorValue {
    return Object.freeze({
      code: this.code,
      message: this.message,
      ...(this.diagnostic === undefined ? {} : { diagnostic: this.diagnostic }),
    });
  }
}

/** Package-private request normalization for the trusted project controller. */
export function normalizeProjectPlanRequest(value: unknown): ProjectPlanRequest {
  const input = exactRecord(value, ["lockMode"], "plan request");
  if (input.lockMode !== "update" && input.lockMode !== "locked") {
    invalidRequest("plan lockMode must be update or locked");
  }
  return Object.freeze({ lockMode: input.lockMode });
}

/** Package-private request normalization for the trusted project controller. */
export function normalizeProjectApplyRequest(value: unknown): ProjectApplyRequest {
  const input = exactRecord(value, ["planDigest"], "apply request");
  if (typeof input.planDigest !== "string" || !DIGEST.test(input.planDigest)) {
    invalidRequest("apply planDigest is invalid");
  }
  return Object.freeze({ planDigest: input.planDigest });
}

function exactRecord(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || utilTypes.isProxy(value) || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    invalidRequest(`${label} must be a plain object`);
  }
  const actual = Reflect.ownKeys(value);
  if (actual.some((key) => typeof key !== "string") || actual.length !== keys.length ||
      keys.some((key) => !actual.includes(key))) {
    invalidRequest(`${label} must contain exactly ${keys.join(", ")}`);
  }
  const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
      invalidRequest(`${label} must contain data fields only`);
    }
    output[key] = descriptor.value;
  }
  return output;
}

function requireErrorCode(value: unknown): asserts value is ProjectAdministrationErrorCode {
  if (value !== "INVALID_REQUEST" && value !== "PROJECT_NOT_FOUND" &&
      value !== "PROJECT_UNSAFE" && value !== "INVALID_CANDIDATE" &&
      value !== "LOCK_MISMATCH" && value !== "PLAN_NOT_FOUND" &&
      value !== "STALE_PLAN" && value !== "PROJECT_BUSY" &&
      value !== "PROJECT_CLOSED" && value !== "UNAVAILABLE" && value !== "INTERNAL") {
    throw new TypeError("project administration error code is invalid");
  }
}

function invalidRequest(message: string): never {
  throw new ProjectAdministrationError("INVALID_REQUEST", message);
}

function scalarLength(value: string): number {
  return [...value].length;
}

function normalizeInvalidCandidateDiagnostic(
  value: ProjectInvalidCandidateDiagnostic,
): ProjectInvalidCandidateDiagnostic {
  if (value === null || typeof value !== "object" || Array.isArray(value) ||
      utilTypes.isProxy(value) ||
      Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    throw new TypeError("project diagnostic is invalid");
  }
  const actual = Reflect.ownKeys(value);
  const allowed = ["code", "path", "pointer"];
  if (actual.some((key) => typeof key !== "string" || !allowed.includes(key)) ||
      !actual.includes("code") || !actual.includes("path")) {
    throw new TypeError("project diagnostic is invalid");
  }
  const fields: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of actual as string[]) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
      throw new TypeError("project diagnostic is invalid");
    }
    fields[key] = descriptor.value;
  }

  const code = fields.code;
  if (typeof code !== "string" || !DIAGNOSTIC_CODE.test(code)) {
    throw new TypeError("project diagnostic code is invalid");
  }

  const path = fields.path;
  try { validateProjectPath(path, "project diagnostic path"); } catch {
    throw new TypeError("project diagnostic path is invalid");
  }
  if (isProtectedProjectPath(path)) {
    throw new TypeError("project diagnostic path is invalid");
  }

  let pointer: string | undefined;
  if (actual.includes("pointer")) {
    if (typeof fields.pointer !== "string") {
      throw new TypeError("project diagnostic pointer is invalid");
    }
    try { validateJson1(fields.pointer); } catch {
      throw new TypeError("project diagnostic pointer is invalid");
    }
    if (scalarLength(fields.pointer) > MAX_POINTER_SCALARS ||
        fields.pointer !== "" && (!fields.pointer.startsWith("/") || /~(?:[^01]|$)/.test(fields.pointer))) {
      throw new TypeError("project diagnostic pointer is invalid");
    }
    pointer = fields.pointer;
  }

  return Object.freeze({
    code,
    path,
    ...(pointer === undefined ? {} : { pointer }),
  });
}
