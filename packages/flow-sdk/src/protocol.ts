import type {
  Attachment,
  EffectCall,
  FlowCall,
  JsonObject,
  JsonValue,
  OperationErrorCode,
  RunResult,
} from "./types.js";
import { OPERATION_ERROR_CODES } from "./types.js";

export const WIRE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/;
export const LOCAL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

type StructuredParams = JsonObject | readonly JsonValue[];

export interface RunParams {
  readonly protocol: "run/1";
  readonly input: JsonValue;
  readonly settings: JsonObject;
  readonly attachments: Readonly<Record<string, Attachment>>;
  readonly scratch: string;
  readonly deadlineUnixMs: number;
}

export interface RequestMessage {
  readonly jsonrpc: "2.0";
  readonly id: string;
  readonly method: string;
  readonly params?: StructuredParams;
}

export interface NotificationMessage {
  readonly jsonrpc: "2.0";
  readonly method: string;
  readonly params?: StructuredParams;
}

export interface SuccessMessage {
  readonly jsonrpc: "2.0";
  readonly id: string;
  readonly result: JsonValue;
}

export interface ErrorPayload {
  readonly code: number;
  readonly message: string;
  readonly data?: JsonValue;
}

export interface ErrorMessage {
  readonly jsonrpc: "2.0";
  readonly id: string | null;
  readonly error: ErrorPayload;
}

export type ParsedMessage =
  | { readonly kind: "request"; readonly value: RequestMessage }
  | { readonly kind: "notification"; readonly value: NotificationMessage }
  | { readonly kind: "success"; readonly value: SuccessMessage }
  | { readonly kind: "error"; readonly value: ErrorMessage };

const operationCodes = new Set<string>(
  OPERATION_ERROR_CODES.filter(
    (code) => code !== "PROTOCOL_ERROR" && code !== "CHANNEL_LOST",
  ),
);
const standardErrorCodes = new Set([-32700, -32600, -32601, -32602, -32603]);

export function parseEnvelope(value: JsonValue): ParsedMessage {
  const object = requireObject(value, "JSON-RPC envelope");
  if (object.jsonrpc !== "2.0") throw new Error("invalid JSON-RPC version");

  const hasMethod = Object.hasOwn(object, "method");
  const hasId = Object.hasOwn(object, "id");
  const hasResult = Object.hasOwn(object, "result");
  const hasError = Object.hasOwn(object, "error");

  if (hasMethod) {
    const hasParams = Object.hasOwn(object, "params");
    if (
      hasParams &&
      (object.params === null || typeof object.params !== "object")
    ) {
      throw new Error("JSON-RPC params must be a structured value");
    }
    requireExactKeys(
      object,
      hasId
        ? hasParams
          ? ["jsonrpc", "id", "method", "params"]
          : ["jsonrpc", "id", "method"]
        : hasParams
          ? ["jsonrpc", "method", "params"]
          : ["jsonrpc", "method"],
    );
    if (typeof object.method !== "string") throw new Error("invalid method");
    if (hasId) {
      const id = requireWireId(object.id as JsonValue);
      return {
        kind: "request",
        value: {
          jsonrpc: "2.0",
          id,
          method: object.method,
          ...(hasParams ? { params: object.params as StructuredParams } : {}),
        },
      };
    }
    return {
      kind: "notification",
      value: {
        jsonrpc: "2.0",
        method: object.method,
        ...(Object.hasOwn(object, "params")
          ? { params: object.params as StructuredParams }
          : {}),
      },
    };
  }

  if (!hasId || hasResult === hasError) throw new Error("invalid response envelope");
  requireExactKeys(object, hasResult ? ["jsonrpc", "id", "result"] : ["jsonrpc", "id", "error"]);
  const id = object.id === null ? null : requireWireId(object.id as JsonValue);
  if (hasResult) {
    if (id === null) throw new Error("success response has null ID");
    return {
      kind: "success",
      value: { jsonrpc: "2.0", id, result: object.result as JsonValue },
    };
  }
  const error = parseErrorPayload(object.error as JsonValue);
  return { kind: "error", value: { jsonrpc: "2.0", id, error } };
}

export function parseRunParams(value: JsonValue): RunParams {
  const object = requireObject(value, "flow/run params");
  requireExactKeys(object, [
    "protocol",
    "input",
    "settings",
    "attachments",
    "scratch",
    "deadlineUnixMs",
  ]);
  if (object.protocol !== "run/1") throw new Error("unsupported Run protocol");
  const settings = requireObject(object.settings as JsonValue, "settings");
  const attachmentsObject = requireObject(object.attachments as JsonValue, "attachments");
  if (Object.keys(attachmentsObject).length > 256) throw new Error("too many attachments");
  const attachments: Record<string, Attachment> = Object.create(null) as Record<
    string,
    Attachment
  >;
  for (const [name, raw] of Object.entries(attachmentsObject)) {
    requireLocalName(name);
    const attachment = requireObject(raw, "attachment");
    requireExactKeys(attachment, ["path", "access"]);
    if (typeof attachment.path !== "string" || attachment.path.length === 0) {
      throw new Error("attachment path must be nonempty");
    }
    if (attachment.access !== "read" && attachment.access !== "read-write") {
      throw new Error("invalid attachment access");
    }
    attachments[name] = { path: attachment.path, access: attachment.access };
  }
  if (typeof object.scratch !== "string" || object.scratch.length === 0) {
    throw new Error("scratch must be nonempty");
  }
  if (
    typeof object.deadlineUnixMs !== "number" ||
    !Number.isSafeInteger(object.deadlineUnixMs) ||
    object.deadlineUnixMs < 0
  ) {
    throw new Error("invalid deadlineUnixMs");
  }
  return {
    protocol: "run/1",
    input: object.input as JsonValue,
    settings,
    attachments,
    scratch: object.scratch,
    deadlineUnixMs: object.deadlineUnixMs,
  };
}

export function validateFlowCall(call: FlowCall): JsonObject {
  requireWireId(call.operationId);
  requireLocalName(call.slot);
  if (call.intent !== undefined) {
    if (typeof call.intent !== "string") {
      throw new TypeError("intent must be a string");
    }
    const scalarLength = Array.from(call.intent).length;
    if (scalarLength === 0 || scalarLength > 16_384) {
      throw new TypeError("intent must contain 1-16384 Unicode scalars");
    }
  }
  return {
    operationId: call.operationId,
    slot: call.slot,
    ...(call.intent === undefined ? {} : { intent: call.intent }),
    input: call.input,
  };
}

export function validateEffectCall(call: EffectCall): JsonObject {
  requireWireId(call.operationId);
  requireLocalName(call.slot);
  requireLocalName(call.method);
  return {
    operationId: call.operationId,
    slot: call.slot,
    method: call.method,
    input: call.input,
  };
}

export function parseRunResult(value: JsonValue): RunResult {
  const object = requireObject(value, "Run result");
  requireExactKeys(object, ["outcome", "output"]);
  const outcome = requireLocalName(object.outcome as JsonValue);
  return { outcome, output: object.output as JsonValue };
}

export type EffectResult =
  | { readonly kind: "value"; readonly value: JsonValue }
  | {
      readonly kind: "error";
      readonly name: string;
      readonly data: JsonValue;
    };

export function parseEffectResult(value: JsonValue): EffectResult {
  const object = requireObject(value, "effect result");
  if (Object.hasOwn(object, "value")) {
    requireExactKeys(object, ["value"]);
    return { kind: "value", value: object.value as JsonValue };
  }
  requireExactKeys(object, ["error"]);
  const error = requireObject(object.error as JsonValue, "declared effect error");
  requireExactKeys(error, ["name", "data"]);
  return {
    kind: "error",
    name: requireLocalName(error.name as JsonValue),
    data: error.data as JsonValue,
  };
}

export function parseOperationError(error: ErrorPayload): {
  readonly code: OperationErrorCode;
  readonly details?: JsonValue;
} | null {
  if (error.code !== -32000) return null;
  if (error.data === undefined) throw new Error("operation error data is required");
  const data = requireObject(error.data, "operation error data");
  const keys = Object.hasOwn(data, "details") ? ["code", "details"] : ["code"];
  requireExactKeys(data, keys);
  if (typeof data.code !== "string" || !operationCodes.has(data.code)) {
    throw new Error("unknown operation error code");
  }
  return {
    code: data.code as OperationErrorCode,
    ...(Object.hasOwn(data, "details") ? { details: data.details as JsonValue } : {}),
  };
}

export function requestMessage(id: string, method: string, params: JsonObject): JsonObject {
  return { jsonrpc: "2.0", id, method, params };
}

export function cancelMessage(id: string): JsonObject {
  return { jsonrpc: "2.0", method: "request/cancel", params: { requestId: id } };
}

export function resultMessage(id: string, result: RunResult): JsonObject {
  return { jsonrpc: "2.0", id, result: result as unknown as JsonValue };
}

export function errorMessage(
  id: string | null,
  rpcCode: number,
  message: string,
  data?: JsonValue,
): JsonObject {
  return {
    jsonrpc: "2.0",
    id,
    error: {
      code: rpcCode,
      message: Array.from(message).slice(0, 1_024).join("") || "Run/1 error",
      ...(data === undefined ? {} : { data }),
    },
  };
}

export function operationErrorMessage(
  id: string,
  code: Exclude<OperationErrorCode, "PROTOCOL_ERROR" | "CHANNEL_LOST">,
  message: string,
  details?: JsonValue,
): JsonObject {
  return errorMessage(id, -32000, message, {
    code,
    ...(details === undefined ? {} : { details }),
  });
}

function parseErrorPayload(value: JsonValue): ErrorPayload {
  const object = requireObject(value, "JSON-RPC error");
  const keys = Object.hasOwn(object, "data")
    ? ["code", "message", "data"]
    : ["code", "message"];
  requireExactKeys(object, keys);
  if (typeof object.code !== "number" || !Number.isSafeInteger(object.code)) {
    throw new Error("invalid JSON-RPC error code");
  }
  if (object.code !== -32000 && !standardErrorCodes.has(object.code)) {
    throw new Error("unknown JSON-RPC error code");
  }
  if (
    typeof object.message !== "string" ||
    Array.from(object.message).length === 0 ||
    Array.from(object.message).length > 1_024
  ) {
    throw new Error("invalid JSON-RPC error message");
  }
  return {
    code: object.code,
    message: object.message,
    ...(Object.hasOwn(object, "data") ? { data: object.data as JsonValue } : {}),
  };
}

function requireObject(value: JsonValue, description: string): Record<string, JsonValue> {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    throw new Error(`${description} must be an object`);
  }
  return value as Record<string, JsonValue>;
}

function requireExactKeys(object: Record<string, JsonValue>, expected: readonly string[]): void {
  const keys = Object.keys(object).sort();
  const wanted = [...expected].sort();
  if (keys.length !== wanted.length || keys.some((key, index) => key !== wanted[index])) {
    throw new Error(`unexpected object members: ${keys.join(", ")}`);
  }
}

export function requireWireId(value: JsonValue): string {
  if (
    typeof value !== "string" ||
    value.length > 128 ||
    !WIRE_ID.test(value) ||
    new TextEncoder().encode(value).byteLength > 128
  ) {
    throw new Error("invalid Run/1 ID");
  }
  return value;
}

export function requireLocalName(value: JsonValue): string {
  if (typeof value !== "string" || value.length > 64 || !LOCAL_NAME.test(value)) {
    throw new Error("invalid LocalName");
  }
  return value;
}
