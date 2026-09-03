import {
  canonicalJson,
  decodeJson1,
  JSON_1_LIMITS,
  type JsonObject,
  type JsonValue,
  validateJson1,
} from "../json.js";

export const PRIVATE_OPENROUTER_RESPONSES_PROTOCOL =
  "jig-private-openrouter-responses/1" as const;
export const PRIVATE_OPENROUTER_RESPONSES_BASE_URL =
  "https://openrouter.ai/api/v1" as const;
export const PRIVATE_OPENROUTER_RESPONSES_MODEL =
  "google/gemini-3.5-flash-lite" as const;
export const PRIVATE_OPENROUTER_RESPONSES_REQUEST_BYTES = JSON_1_LIMITS.bytes;
export const PRIVATE_OPENROUTER_RESPONSES_RESPONSE_BYTES = JSON_1_LIMITS.bytes;

const MAX_INSTRUCTION_CHARACTERS = 1_048_576;
const MAX_RESPONSE_SCHEMA_BYTES = 256 * 1024;
const MAX_FAILURE_MESSAGE_BYTES = 4_096;

export const PRIVATE_OPENROUTER_RESPONSES_ERROR_CODES = Object.freeze([
  "AGENT_PROVIDER_CONFIGURATION",
  "AGENT_PROVIDER_OUTPUT_LIMIT",
  "AGENT_PROVIDER_PROTOCOL",
  "AGENT_PROVIDER_RESPONSE_INVALID",
  "AGENT_PROVIDER_UNAVAILABLE",
] as const);

export type PrivateOpenRouterResponsesErrorCode =
  typeof PRIVATE_OPENROUTER_RESPONSES_ERROR_CODES[number];

const ERROR_CODES = new Set<string>(PRIVATE_OPENROUTER_RESPONSES_ERROR_CODES);

export interface PrivateOpenRouterResponsesRequest {
  readonly protocol: typeof PRIVATE_OPENROUTER_RESPONSES_PROTOCOL;
  readonly apiKey: string;
  readonly baseURL: typeof PRIVATE_OPENROUTER_RESPONSES_BASE_URL;
  readonly model: typeof PRIVATE_OPENROUTER_RESPONSES_MODEL;
  readonly instructions: string;
  readonly responseSchema?: JsonObject;
}

export interface PrivateOpenRouterResponsesResult {
  readonly outcome: "completed" | "blocked" | "limit";
  readonly text: string;
  readonly structured?: JsonValue;
}

export type PrivateOpenRouterResponsesWorkerResponse =
  | {
    readonly protocol: typeof PRIVATE_OPENROUTER_RESPONSES_PROTOCOL;
    readonly status: "ok";
    readonly value: PrivateOpenRouterResponsesResult;
  }
  | {
    readonly protocol: typeof PRIVATE_OPENROUTER_RESPONSES_PROTOCOL;
    readonly status: "error";
    readonly code: PrivateOpenRouterResponsesErrorCode;
    readonly message: string;
  };

export class PrivateOpenRouterResponsesError extends Error {
  constructor(
    readonly code: PrivateOpenRouterResponsesErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PrivateOpenRouterResponsesError";
  }
}

export function encodePrivateOpenRouterResponsesRequest(
  value: unknown,
): Uint8Array {
  return encodeBounded(
    requirePrivateOpenRouterResponsesRequest(value) as unknown as JsonValue,
    PRIVATE_OPENROUTER_RESPONSES_REQUEST_BYTES,
    "AGENT_PROVIDER_PROTOCOL",
    "OpenRouter Responses worker request exceeds its byte bound",
  );
}

export function decodePrivateOpenRouterResponsesRequest(
  bytes: Uint8Array,
): PrivateOpenRouterResponsesRequest {
  if (bytes.byteLength === 0 ||
      bytes.byteLength > PRIVATE_OPENROUTER_RESPONSES_REQUEST_BYTES) {
    throw new PrivateOpenRouterResponsesError(
      "AGENT_PROVIDER_PROTOCOL",
      "OpenRouter Responses worker request exceeds its byte bound",
    );
  }
  let value: JsonValue;
  try {
    value = decodeJson1(bytes);
  } catch {
    throw new PrivateOpenRouterResponsesError(
      "AGENT_PROVIDER_PROTOCOL",
      "OpenRouter Responses worker request is not valid JSON/1",
    );
  }
  return requirePrivateOpenRouterResponsesRequest(value);
}

export function encodePrivateOpenRouterResponsesSuccess(
  value: unknown,
): Uint8Array {
  const result = requirePrivateOpenRouterResponsesResult(value);
  return encodeBounded(
    {
      protocol: PRIVATE_OPENROUTER_RESPONSES_PROTOCOL,
      status: "ok",
      value: result,
    } as unknown as JsonValue,
    PRIVATE_OPENROUTER_RESPONSES_RESPONSE_BYTES,
    "AGENT_PROVIDER_OUTPUT_LIMIT",
    "OpenRouter Responses worker result exceeds its byte bound",
  );
}

export function encodePrivateOpenRouterResponsesFailure(
  code: PrivateOpenRouterResponsesErrorCode,
  message: string,
): Uint8Array {
  if (!ERROR_CODES.has(code)) {
    throw new TypeError("unknown OpenRouter Responses worker error code");
  }
  const bounded = boundUtf8(message, MAX_FAILURE_MESSAGE_BYTES);
  return encodeBounded(
    {
      protocol: PRIVATE_OPENROUTER_RESPONSES_PROTOCOL,
      status: "error",
      code,
      message: bounded,
    },
    PRIVATE_OPENROUTER_RESPONSES_RESPONSE_BYTES,
    "AGENT_PROVIDER_OUTPUT_LIMIT",
    "OpenRouter Responses worker failure exceeds its byte bound",
  );
}

export function decodePrivateOpenRouterResponsesResponse(
  bytes: Uint8Array,
): PrivateOpenRouterResponsesWorkerResponse {
  if (bytes.byteLength === 0 ||
      bytes.byteLength > PRIVATE_OPENROUTER_RESPONSES_RESPONSE_BYTES) {
    throw protocolFailure("OpenRouter Responses worker response exceeds its byte bound");
  }
  let value: JsonValue;
  try {
    value = decodeJson1(bytes);
  } catch {
    throw protocolFailure("OpenRouter Responses worker response is not valid JSON/1");
  }
  const record = ordinaryRecord(value);
  if (record === undefined ||
      record.protocol !== PRIVATE_OPENROUTER_RESPONSES_PROTOCOL ||
      (record.status !== "ok" && record.status !== "error")) {
    throw protocolFailure("OpenRouter Responses worker returned an invalid envelope");
  }
  if (record.status === "ok") {
    if (!exactKeys(record, ["protocol", "status", "value"])) {
      throw protocolFailure("OpenRouter Responses worker success has an invalid shape");
    }
    return Object.freeze({
      protocol: PRIVATE_OPENROUTER_RESPONSES_PROTOCOL,
      status: "ok" as const,
      value: requirePrivateOpenRouterResponsesResult(record.value),
    });
  }
  if (!exactKeys(record, ["code", "message", "protocol", "status"]) ||
      typeof record.code !== "string" || !ERROR_CODES.has(record.code) ||
      typeof record.message !== "string" ||
      new TextEncoder().encode(record.message).byteLength > MAX_FAILURE_MESSAGE_BYTES) {
    throw protocolFailure("OpenRouter Responses worker failure has an invalid shape");
  }
  return Object.freeze({
    protocol: PRIVATE_OPENROUTER_RESPONSES_PROTOCOL,
    status: "error" as const,
    code: record.code as PrivateOpenRouterResponsesErrorCode,
    message: record.message,
  });
}

function requirePrivateOpenRouterResponsesRequest(
  value: unknown,
): PrivateOpenRouterResponsesRequest {
  const record = ordinaryRecord(value);
  const hasSchema = record !== undefined && Object.hasOwn(record, "responseSchema");
  if (record === undefined ||
      !exactKeys(record, hasSchema
        ? ["apiKey", "baseURL", "instructions", "model", "protocol", "responseSchema"]
        : ["apiKey", "baseURL", "instructions", "model", "protocol"]) ||
      record.protocol !== PRIVATE_OPENROUTER_RESPONSES_PROTOCOL ||
      typeof record.apiKey !== "string" || record.apiKey.trim().length === 0 ||
      record.apiKey.includes("\0") ||
      new TextEncoder().encode(record.apiKey).byteLength > 16_384 ||
      record.baseURL !== PRIVATE_OPENROUTER_RESPONSES_BASE_URL ||
      record.model !== PRIVATE_OPENROUTER_RESPONSES_MODEL ||
      typeof record.instructions !== "string" ||
      !boundedCharacters(record.instructions, MAX_INSTRUCTION_CHARACTERS) ||
      (hasSchema && ordinaryRecord(record.responseSchema) === undefined)) {
    throw protocolFailure("OpenRouter Responses worker request has an invalid shape");
  }
  if (hasSchema) {
    const responseSchema = record.responseSchema as JsonObject;
    let schemaBytes: Uint8Array;
    try {
      schemaBytes = canonicalJson(responseSchema);
    } catch {
      throw protocolFailure("OpenRouter Responses response schema is not valid JSON/1");
    }
    if (schemaBytes.byteLength > MAX_RESPONSE_SCHEMA_BYTES) {
      throw protocolFailure("OpenRouter Responses response schema exceeds its byte bound");
    }
    return Object.freeze({
      protocol: PRIVATE_OPENROUTER_RESPONSES_PROTOCOL,
      apiKey: record.apiKey,
      baseURL: PRIVATE_OPENROUTER_RESPONSES_BASE_URL,
      model: PRIVATE_OPENROUTER_RESPONSES_MODEL,
      instructions: record.instructions,
      responseSchema,
    });
  }
  return Object.freeze({
    protocol: PRIVATE_OPENROUTER_RESPONSES_PROTOCOL,
    apiKey: record.apiKey,
    baseURL: PRIVATE_OPENROUTER_RESPONSES_BASE_URL,
    model: PRIVATE_OPENROUTER_RESPONSES_MODEL,
    instructions: record.instructions,
  });
}

function requirePrivateOpenRouterResponsesResult(
  value: unknown,
): PrivateOpenRouterResponsesResult {
  const record = ordinaryRecord(value);
  const hasStructured = record !== undefined && Object.hasOwn(record, "structured");
  if (record === undefined ||
      !exactKeys(record, hasStructured
        ? ["outcome", "structured", "text"]
        : ["outcome", "text"]) ||
      (record.outcome !== "completed" && record.outcome !== "blocked" &&
        record.outcome !== "limit") ||
      typeof record.text !== "string" ||
      new TextEncoder().encode(record.text).byteLength > JSON_1_LIMITS.stringBytes) {
    throw protocolFailure("OpenRouter Responses worker result has an invalid shape");
  }
  if (hasStructured) {
    try {
      validateJson1(record.structured);
    } catch {
      throw protocolFailure("OpenRouter Responses worker structured result is not JSON/1");
    }
    return Object.freeze({
      outcome: record.outcome,
      text: record.text,
      structured: record.structured as JsonValue,
    });
  }
  return Object.freeze({ outcome: record.outcome, text: record.text });
}

function encodeBounded(
  value: JsonValue,
  maximum: number,
  code: PrivateOpenRouterResponsesErrorCode,
  message: string,
): Uint8Array {
  let bytes: Uint8Array;
  try {
    bytes = canonicalJson(value);
  } catch {
    throw new PrivateOpenRouterResponsesError(code, message);
  }
  if (bytes.byteLength > maximum) {
    throw new PrivateOpenRouterResponsesError(code, message);
  }
  return bytes;
}

function ordinaryRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return undefined;
  return value as Record<string, unknown>;
}

function exactKeys(value: object, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  return keys.length === expected.length &&
    keys.every((key, index) => key === expected[index]);
}

function boundedCharacters(value: string, maximum: number): boolean {
  if (value.length === 0) return false;
  let count = 0;
  for (const _character of value) {
    count += 1;
    if (count > maximum) return false;
  }
  return true;
}

function boundUtf8(value: string, maximum: number): string {
  if (new TextEncoder().encode(value).byteLength <= maximum) return value;
  let result = "";
  let bytes = 0;
  for (const character of value) {
    const next = new TextEncoder().encode(character).byteLength;
    if (bytes + next > maximum) break;
    result += character;
    bytes += next;
  }
  return result;
}

function protocolFailure(message: string): PrivateOpenRouterResponsesError {
  return new PrivateOpenRouterResponsesError("AGENT_PROVIDER_PROTOCOL", message);
}
