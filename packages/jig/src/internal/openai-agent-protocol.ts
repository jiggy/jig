import {
  canonicalJson,
  decodeJson1,
  JSON_1_LIMITS,
  type JsonObject,
  type JsonValue,
  validateJson1,
} from "../json.js";

export const PRIVATE_OPENAI_AGENT_PROTOCOL =
  "jig-private-openai-agent/1" as const;
export const PRIVATE_OPENAI_AGENT_REQUEST_BYTES = JSON_1_LIMITS.bytes;
export const PRIVATE_OPENAI_AGENT_RESPONSE_BYTES = JSON_1_LIMITS.bytes;
export const PRIVATE_OPENAI_APIS = Object.freeze([
  "responses",
  "chat-completions",
] as const);

export type PrivateOpenAIApi =
  typeof PRIVATE_OPENAI_APIS[number];

const MAX_INSTRUCTION_CHARACTERS = 1_048_576;
const MAX_RESPONSE_SCHEMA_BYTES = 256 * 1024;
const MAX_FAILURE_MESSAGE_BYTES = 4_096;

export const PRIVATE_OPENAI_AGENT_ERROR_CODES = Object.freeze([
  "AGENT_PROVIDER_CONFIGURATION",
  "AGENT_PROVIDER_OUTPUT_LIMIT",
  "AGENT_PROVIDER_PROTOCOL",
  "AGENT_PROVIDER_RESPONSE_INVALID",
  "AGENT_PROVIDER_UNAVAILABLE",
] as const);

export type PrivateOpenAIAgentErrorCode =
  typeof PRIVATE_OPENAI_AGENT_ERROR_CODES[number];

const ERROR_CODES = new Set<string>(PRIVATE_OPENAI_AGENT_ERROR_CODES);

export interface PrivateOpenAIAgentRequest {
  readonly protocol: typeof PRIVATE_OPENAI_AGENT_PROTOCOL;
  readonly apiKey: string;
  readonly api: PrivateOpenAIApi;
  readonly baseURL: string;
  readonly model: string;
  readonly instructions: string;
  readonly responseSchema?: JsonObject;
}

export interface PrivateOpenAIAgentResult {
  readonly outcome: "completed" | "blocked" | "limit";
  readonly text: string;
  readonly structured?: JsonValue;
}

export type PrivateOpenAIAgentWorkerResponse =
  | {
    readonly protocol: typeof PRIVATE_OPENAI_AGENT_PROTOCOL;
    readonly status: "ok";
    readonly value: PrivateOpenAIAgentResult;
  }
  | {
    readonly protocol: typeof PRIVATE_OPENAI_AGENT_PROTOCOL;
    readonly status: "error";
    readonly code: PrivateOpenAIAgentErrorCode;
    readonly message: string;
  };

export class PrivateOpenAIAgentError extends Error {
  constructor(
    readonly code: PrivateOpenAIAgentErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PrivateOpenAIAgentError";
  }
}

export function encodePrivateOpenAIAgentRequest(
  value: unknown,
): Uint8Array {
  return encodeBounded(
    requirePrivateOpenAIAgentRequest(value) as unknown as JsonValue,
    PRIVATE_OPENAI_AGENT_REQUEST_BYTES,
    "AGENT_PROVIDER_PROTOCOL",
    "OpenAI Agent worker request exceeds its byte bound",
  );
}

export function decodePrivateOpenAIAgentRequest(
  bytes: Uint8Array,
): PrivateOpenAIAgentRequest {
  if (bytes.byteLength === 0 ||
      bytes.byteLength > PRIVATE_OPENAI_AGENT_REQUEST_BYTES) {
    throw new PrivateOpenAIAgentError(
      "AGENT_PROVIDER_PROTOCOL",
      "OpenAI Agent worker request exceeds its byte bound",
    );
  }
  let value: JsonValue;
  try {
    value = decodeJson1(bytes);
  } catch {
    throw new PrivateOpenAIAgentError(
      "AGENT_PROVIDER_PROTOCOL",
      "OpenAI Agent worker request is not valid JSON/1",
    );
  }
  return requirePrivateOpenAIAgentRequest(value);
}

export function encodePrivateOpenAIAgentSuccess(
  value: unknown,
): Uint8Array {
  const result = requirePrivateOpenAIAgentResult(value);
  return encodeBounded(
    {
      protocol: PRIVATE_OPENAI_AGENT_PROTOCOL,
      status: "ok",
      value: result,
    } as unknown as JsonValue,
    PRIVATE_OPENAI_AGENT_RESPONSE_BYTES,
    "AGENT_PROVIDER_OUTPUT_LIMIT",
    "OpenAI Agent worker result exceeds its byte bound",
  );
}

export function encodePrivateOpenAIAgentFailure(
  code: PrivateOpenAIAgentErrorCode,
  message: string,
): Uint8Array {
  if (!ERROR_CODES.has(code)) {
    throw new TypeError("unknown OpenAI Agent worker error code");
  }
  const bounded = boundUtf8(message, MAX_FAILURE_MESSAGE_BYTES);
  return encodeBounded(
    {
      protocol: PRIVATE_OPENAI_AGENT_PROTOCOL,
      status: "error",
      code,
      message: bounded,
    },
    PRIVATE_OPENAI_AGENT_RESPONSE_BYTES,
    "AGENT_PROVIDER_OUTPUT_LIMIT",
    "OpenAI Agent worker failure exceeds its byte bound",
  );
}

export function decodePrivateOpenAIAgentResponse(
  bytes: Uint8Array,
): PrivateOpenAIAgentWorkerResponse {
  if (bytes.byteLength === 0 ||
      bytes.byteLength > PRIVATE_OPENAI_AGENT_RESPONSE_BYTES) {
    throw protocolFailure("OpenAI Agent worker response exceeds its byte bound");
  }
  let value: JsonValue;
  try {
    value = decodeJson1(bytes);
  } catch {
    throw protocolFailure("OpenAI Agent worker response is not valid JSON/1");
  }
  const record = ordinaryRecord(value);
  if (record === undefined ||
      record.protocol !== PRIVATE_OPENAI_AGENT_PROTOCOL ||
      (record.status !== "ok" && record.status !== "error")) {
    throw protocolFailure("OpenAI Agent worker returned an invalid envelope");
  }
  if (record.status === "ok") {
    if (!exactKeys(record, ["protocol", "status", "value"])) {
      throw protocolFailure("OpenAI Agent worker success has an invalid shape");
    }
    return Object.freeze({
      protocol: PRIVATE_OPENAI_AGENT_PROTOCOL,
      status: "ok" as const,
      value: requirePrivateOpenAIAgentResult(record.value),
    });
  }
  if (!exactKeys(record, ["code", "message", "protocol", "status"]) ||
      typeof record.code !== "string" || !ERROR_CODES.has(record.code) ||
      typeof record.message !== "string" ||
      new TextEncoder().encode(record.message).byteLength > MAX_FAILURE_MESSAGE_BYTES) {
    throw protocolFailure("OpenAI Agent worker failure has an invalid shape");
  }
  return Object.freeze({
    protocol: PRIVATE_OPENAI_AGENT_PROTOCOL,
    status: "error" as const,
    code: record.code as PrivateOpenAIAgentErrorCode,
    message: record.message,
  });
}

function requirePrivateOpenAIAgentRequest(
  value: unknown,
): PrivateOpenAIAgentRequest {
  const record = ordinaryRecord(value);
  const hasSchema = record !== undefined && Object.hasOwn(record, "responseSchema");
  if (record === undefined ||
      !exactKeys(record, hasSchema
        ? ["api", "apiKey", "baseURL", "instructions", "model", "protocol", "responseSchema"]
        : ["api", "apiKey", "baseURL", "instructions", "model", "protocol"]) ||
      record.protocol !== PRIVATE_OPENAI_AGENT_PROTOCOL ||
      typeof record.apiKey !== "string" || record.apiKey.trim().length === 0 ||
      record.apiKey.includes("\0") ||
      new TextEncoder().encode(record.apiKey).byteLength > 16_384 ||
      !validApi(record.api) ||
      !validBaseURL(record.baseURL) || !validModel(record.model) ||
      typeof record.instructions !== "string" ||
      !boundedCharacters(record.instructions, MAX_INSTRUCTION_CHARACTERS) ||
      (hasSchema && ordinaryRecord(record.responseSchema) === undefined)) {
    throw protocolFailure("OpenAI Agent worker request has an invalid shape");
  }
  if (hasSchema) {
    const responseSchema = record.responseSchema as JsonObject;
    let schemaBytes: Uint8Array;
    try {
      schemaBytes = canonicalJson(responseSchema);
    } catch {
      throw protocolFailure("OpenAI Agent response schema is not valid JSON/1");
    }
    if (schemaBytes.byteLength > MAX_RESPONSE_SCHEMA_BYTES) {
      throw protocolFailure("OpenAI Agent response schema exceeds its byte bound");
    }
    return Object.freeze({
      protocol: PRIVATE_OPENAI_AGENT_PROTOCOL,
      apiKey: record.apiKey,
      api: record.api,
      baseURL: record.baseURL,
      model: record.model,
      instructions: record.instructions,
      responseSchema,
    });
  }
  return Object.freeze({
    protocol: PRIVATE_OPENAI_AGENT_PROTOCOL,
    apiKey: record.apiKey,
    api: record.api,
    baseURL: record.baseURL,
    model: record.model,
    instructions: record.instructions,
  });
}

function requirePrivateOpenAIAgentResult(
  value: unknown,
): PrivateOpenAIAgentResult {
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
    throw protocolFailure("OpenAI Agent worker result has an invalid shape");
  }
  if (hasStructured) {
    try {
      validateJson1(record.structured);
    } catch {
      throw protocolFailure("OpenAI Agent worker structured result is not JSON/1");
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
  code: PrivateOpenAIAgentErrorCode,
  message: string,
): Uint8Array {
  let bytes: Uint8Array;
  try {
    bytes = canonicalJson(value);
  } catch {
    throw new PrivateOpenAIAgentError(code, message);
  }
  if (bytes.byteLength > maximum) {
    throw new PrivateOpenAIAgentError(code, message);
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

function validBaseURL(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 4_096) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" &&
      parsed.username === "" && parsed.password === "" && parsed.search === "" &&
      parsed.hash === "";
  } catch {
    return false;
  }
}

function validApi(value: unknown): value is PrivateOpenAIApi {
  return typeof value === "string" &&
    (PRIVATE_OPENAI_APIS as readonly string[]).includes(value);
}

function validModel(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/.test(value);
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

function protocolFailure(message: string): PrivateOpenAIAgentError {
  return new PrivateOpenAIAgentError("AGENT_PROVIDER_PROTOCOL", message);
}
