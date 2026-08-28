import { types as utilTypes } from "node:util";

import { validateJson1 } from "../json.js";
import type { RootAdministration } from "./root.js";

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const MAX_MESSAGE_SCALARS = 1_024;

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

  constructor(code: ProjectAdministrationErrorCode, message: string) {
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
  }

  toJSON(): ProjectAdministrationErrorValue {
    return Object.freeze({ code: this.code, message: this.message });
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
