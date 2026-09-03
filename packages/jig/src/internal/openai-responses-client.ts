import OpenAI from "openai";
import type { ResponseCreateParamsNonStreaming } from "openai/resources/responses/responses";

import {
  canonicalJson,
  decodeJson1,
  JSON_1_LIMITS,
  type JsonObject,
  type JsonValue,
  validateJson1,
} from "../json.js";
import {
  PrivateOpenAIResponsesError,
  type PrivateOpenAIResponsesResult,
} from "./openai-responses-protocol.js";

const MAX_INSTRUCTION_CHARACTERS = 1_048_576;
const MAX_RESPONSE_SCHEMA_BYTES = 256 * 1024;
const RESPONSE_FORMAT_NAME = "jig_agent_run_result";
const MAX_OUTPUT_TOKENS = 4_096;
const MAX_RESPONSE_SCHEMA_DEPTH = 8;
const MAX_PROPERTIES_PER_OBJECT = 32;
const MAX_RESPONSE_SCHEMA_PROPERTIES = 128;
const MAX_ARRAY_ITEMS = 256;
const MAX_RESPONSE_SCHEMA_ENUM_VALUES = 256;
const MAX_RESPONSE_SCHEMA_SYMBOL_CHARACTERS = 120_000;
const MAX_LARGE_ENUM_CHARACTERS = 15_000;

export type PrivateOpenAIFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface PrivateOpenAIResponsesCreateClient {
  create(body: ResponseCreateParamsNonStreaming): Promise<unknown>;
}

export interface PrivateOpenAIResponsesClientRequest {
  readonly baseURL: string;
  readonly model: string;
  readonly instructions: string;
  readonly responseSchema?: JsonObject;
}

export interface PrivateOpenAIResponsesClientDependencies {
  readonly apiKey: string;
  /** Test seam: production uses the bundled OpenAI SDK with the global fetch. */
  readonly fetch?: PrivateOpenAIFetch;
  /** Test seam: production creates exactly one bundled OpenAI Responses client. */
  readonly client?: PrivateOpenAIResponsesCreateClient;
}

interface ResponseSchemaProfileState {
  properties: number;
  enumValues: number;
  symbolCharacters: number;
}

/** Validate Jig's deliberately bounded recursive Agent structured-output profile. */
export function assertPrivateAgentResponseSchema(schema: JsonObject): void {
  if (schema.$schema !== "https://flow.jig.md/schemas/schema-1.json") invalidSchemaProfile();
  const state: ResponseSchemaProfileState = {
    properties: 0,
    enumValues: 0,
    symbolCharacters: 0,
  };
  assertResponseSchemaNode(schema, 1, true, state);
}

function assertResponseSchemaNode(
  value: unknown,
  depth: number,
  root: boolean,
  state: ResponseSchemaProfileState,
): void {
  const schema = ordinaryRecord(value);
  if (schema === undefined || depth > MAX_RESPONSE_SCHEMA_DEPTH) invalidSchemaProfile();

  if (schema.type === "object") {
    assertClosedResponseObject(schema, depth, root, state);
    return;
  }
  if (root || Object.hasOwn(schema, "$schema")) invalidSchemaProfile();

  if (schema.type === "array") {
    const baseExpected = Object.hasOwn(schema, "minItems")
      ? ["items", "maxItems", "minItems", "type"]
      : ["items", "maxItems", "type"];
    if (!exactProfileKeys(schema, baseExpected) ||
        !boundedNonnegativeInteger(schema.maxItems, MAX_ARRAY_ITEMS) ||
        (Object.hasOwn(schema, "minItems") &&
          (!boundedNonnegativeInteger(schema.minItems, MAX_ARRAY_ITEMS) ||
            (schema.minItems as number) > (schema.maxItems as number)))) {
      invalidSchemaProfile();
    }
    assertResponseSchemaNode(schema.items, depth + 1, false, state);
    return;
  }

  if (schema.type === "integer" || isNullableType(schema.type, "integer")) {
    if (!exactProfileKeys(schema, ["type"])) invalidSchemaProfile();
    return;
  }
  if (schema.type === "string" || isNullableType(schema.type, "string")) {
    assertResponseString(schema, isNullableType(schema.type, "string"), state);
    return;
  }
  invalidSchemaProfile();
}

function assertClosedResponseObject(
  schema: Record<string, unknown>,
  depth: number,
  root: boolean,
  state: ResponseSchemaProfileState,
): void {
  const expected = root
    ? ["$schema", "additionalProperties", "properties", "required", "type"]
    : ["additionalProperties", "properties", "required", "type"];
  const properties = ordinaryRecord(schema.properties);
  if (!exactProfileKeys(schema, expected) || schema.additionalProperties !== false ||
      properties === undefined || !Array.isArray(schema.required)) {
    invalidSchemaProfile();
  }
  const names = Object.keys(properties);
  if (names.length === 0 || names.length > MAX_PROPERTIES_PER_OBJECT ||
      schema.required.length !== names.length ||
      new Set(schema.required).size !== names.length ||
      schema.required.some((name) => typeof name !== "string" || !Object.hasOwn(properties, name))) {
    invalidSchemaProfile();
  }
  state.properties += names.length;
  if (state.properties > MAX_RESPONSE_SCHEMA_PROPERTIES) invalidSchemaProfile();
  for (const name of names) {
    state.symbolCharacters += unicodeScalarLength(name);
    if (state.symbolCharacters > MAX_RESPONSE_SCHEMA_SYMBOL_CHARACTERS) invalidSchemaProfile();
    assertResponseSchemaNode(properties[name], depth + 1, false, state);
  }
}

function assertResponseString(
  schema: Record<string, unknown>,
  nullable: boolean,
  state: ResponseSchemaProfileState,
): void {
  if (!Object.hasOwn(schema, "enum")) {
    if (!exactProfileKeys(schema, ["type"])) invalidSchemaProfile();
    return;
  }
  if (!exactProfileKeys(schema, ["enum", "type"]) || !Array.isArray(schema.enum) ||
      schema.enum.length === 0 || schema.enum.length > MAX_RESPONSE_SCHEMA_ENUM_VALUES ||
      schema.enum.some((item) => typeof item !== "string" && (!nullable || item !== null)) ||
      new Set(schema.enum).size !== schema.enum.length ||
      (nullable && (!schema.enum.includes(null) ||
        !schema.enum.some((item) => typeof item === "string")))) {
    invalidSchemaProfile();
  }
  state.enumValues += schema.enum.length;
  const enumCharacters = schema.enum.reduce(
    (total, item) => total + (typeof item === "string" ? unicodeScalarLength(item) : 0),
    0,
  );
  if (schema.enum.length > 250 && enumCharacters > MAX_LARGE_ENUM_CHARACTERS) {
    invalidSchemaProfile();
  }
  state.symbolCharacters += enumCharacters;
  if (state.enumValues > MAX_RESPONSE_SCHEMA_ENUM_VALUES) invalidSchemaProfile();
  if (state.symbolCharacters > MAX_RESPONSE_SCHEMA_SYMBOL_CHARACTERS) invalidSchemaProfile();
}

function isNullableType(value: unknown, base: "integer" | "string"): boolean {
  return Array.isArray(value) && value.length === 2 &&
    new Set(value).size === 2 && value.includes(base) && value.includes("null");
}

function exactProfileKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  if (Object.hasOwn(value, "description") && typeof value.description !== "string") return false;
  return exactKeys(value, Object.hasOwn(value, "description") ? [...expected, "description"] : expected);
}

function boundedNonnegativeInteger(value: unknown, maximum: number): boolean {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= maximum;
}

function unicodeScalarLength(value: string): number {
  return [...value].length;
}

function invalidSchemaProfile(): never {
  throw new TypeError("Agent responseSchema must use the bounded structured-output profile");
}

/**
 * Make one non-streaming OpenAI Responses call and normalize only its final
 * Agent Run value. Dispatch retry is disabled; process ownership and abort
 * fencing remain the responsibility of the containing worker controller.
 */
export async function requestPrivateOpenAIResponse(
  request: PrivateOpenAIResponsesClientRequest,
  dependencies: PrivateOpenAIResponsesClientDependencies,
): Promise<PrivateOpenAIResponsesResult> {
  requireClientRequest(request);
  requireApiKey(dependencies.apiKey);
  if (dependencies.client !== undefined && dependencies.fetch !== undefined) {
    throw new PrivateOpenAIResponsesError(
      "AGENT_PROVIDER_CONFIGURATION",
      "OpenAI Responses test transport is ambiguous",
    );
  }

  const body = createBody(request);
  const client = dependencies.client ?? sdkClient(
    request.baseURL,
    dependencies.apiKey,
    dependencies.fetch,
  );
  let response: unknown;
  try {
    response = await client.create(body);
  } catch {
    // Provider and SDK errors are intentionally not reflected: an upstream
    // diagnostic can contain request data, endpoint credentials, or headers.
    throw new PrivateOpenAIResponsesError(
      "AGENT_PROVIDER_UNAVAILABLE",
      "OpenAI Responses request failed",
    );
  }
  return normalizePrivateOpenAIResponse(response, request.responseSchema !== undefined);
}

export function normalizePrivateOpenAIResponse(
  response: unknown,
  structuredRequested: boolean,
): PrivateOpenAIResponsesResult {
  const record = ordinaryRecord(response);
  if (record === undefined ||
      (record.status !== "completed" && record.status !== "incomplete" &&
        record.status !== "failed" && record.status !== "cancelled" &&
        record.status !== "queued" && record.status !== "in_progress") ||
      !Array.isArray(record.output)) {
    throw invalidResponse();
  }
  if ((Object.hasOwn(record, "error") && record.error !== null) ||
      record.status === "failed" || record.status === "cancelled") {
    throw new PrivateOpenAIResponsesError(
      "AGENT_PROVIDER_UNAVAILABLE",
      "OpenAI Responses request did not complete",
    );
  }
  if (record.status === "queued" || record.status === "in_progress") {
    throw invalidResponse();
  }

  const content = responseContent(record, record.status === "incomplete");
  let outcome: PrivateOpenAIResponsesResult["outcome"];
  if (content.refusals.length > 0) {
    outcome = "blocked";
  } else if (record.status === "incomplete") {
    const details = ordinaryRecord(record.incomplete_details);
    outcome = details?.reason === "content_filter" ? "blocked" : "limit";
  } else {
    outcome = "completed";
  }
  const text = outcome === "blocked" && content.refusals.length > 0
    ? joinBounded(content.refusals, "\n")
    : joinBounded(content.text, "");

  if (!structuredRequested) return Object.freeze({ outcome, text });
  try {
    const structured = decodeJson1(new TextEncoder().encode(text));
    return Object.freeze({ outcome, text, structured });
  } catch {
    if (outcome !== "completed") return Object.freeze({ outcome, text });
    throw new PrivateOpenAIResponsesError(
      "AGENT_PROVIDER_RESPONSE_INVALID",
      "OpenAI structured response is not valid JSON/1",
    );
  }
}

function sdkClient(
  baseURL: string,
  apiKey: string,
  injectedFetch: PrivateOpenAIFetch | undefined,
): PrivateOpenAIResponsesCreateClient {
  const sdk = new OpenAI({
    baseURL,
    apiKey,
    adminAPIKey: null,
    organization: null,
    project: null,
    webhookSecret: null,
    maxRetries: 0,
    logLevel: "off",
    logger: SILENT_LOGGER,
    ...(injectedFetch === undefined ? {} : { fetch: injectedFetch }),
  });
  return Object.freeze({
    create(body: ResponseCreateParamsNonStreaming): Promise<unknown> {
      return sdk.responses.create(body);
    },
  });
}

const SILENT_LOGGER = Object.freeze({
  error(): void {},
  warn(): void {},
  info(): void {},
  debug(): void {},
});

function createBody(
  request: PrivateOpenAIResponsesClientRequest,
): ResponseCreateParamsNonStreaming {
  const base = {
    model: request.model,
    input: request.instructions,
    max_output_tokens: MAX_OUTPUT_TOKENS,
    store: false,
    stream: false,
  } as const;
  if (request.responseSchema === undefined) return base;
  return {
    ...base,
    text: {
      format: {
        type: "json_schema",
        name: RESPONSE_FORMAT_NAME,
        schema: projectPrivateAgentResponseSchema(request.responseSchema),
        strict: true,
      },
    },
  };
}

export function projectPrivateAgentResponseSchema(
  responseSchema: JsonObject,
): Record<string, unknown> {
  // Schema/1's root declaration identifies Jig's validator dialect, not a
  // provider meta-schema. Keep the exact input untouched and remove only that
  // declaration from the provider-facing copy.
  return Object.fromEntries(
    Object.entries(responseSchema).filter(([name]) => name !== "$schema"),
  );
}

function requireClientRequest(request: PrivateOpenAIResponsesClientRequest): void {
  if (request === null || typeof request !== "object" ||
      typeof request.baseURL !== "string" || typeof request.model !== "string" ||
      typeof request.instructions !== "string" ||
      !boundedCharacters(request.instructions, MAX_INSTRUCTION_CHARACTERS)) {
    throw new PrivateOpenAIResponsesError(
      "AGENT_PROVIDER_CONFIGURATION",
      "OpenAI Responses client request is invalid",
    );
  }
  try {
    validateJson1(request.instructions);
  } catch {
    throw new PrivateOpenAIResponsesError(
      "AGENT_PROVIDER_CONFIGURATION",
      "OpenAI Responses instructions are not valid JSON/1 text",
    );
  }
  requireEndpoint(request.baseURL);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/.test(request.model)) {
    throw new PrivateOpenAIResponsesError(
      "AGENT_PROVIDER_CONFIGURATION",
      "OpenAI Responses model is invalid",
    );
  }
  if (request.responseSchema !== undefined) {
    if (ordinaryRecord(request.responseSchema) === undefined) {
      throw new PrivateOpenAIResponsesError(
        "AGENT_PROVIDER_CONFIGURATION",
        "OpenAI response schema is invalid",
      );
    }
    let bytes: Uint8Array;
    try {
      validateJson1(request.responseSchema);
      bytes = canonicalJson(request.responseSchema);
    } catch {
      throw new PrivateOpenAIResponsesError(
        "AGENT_PROVIDER_CONFIGURATION",
        "OpenAI response schema is not valid JSON/1",
      );
    }
    if (bytes.byteLength > MAX_RESPONSE_SCHEMA_BYTES) {
      throw new PrivateOpenAIResponsesError(
        "AGENT_PROVIDER_CONFIGURATION",
        "OpenAI response schema exceeds its byte bound",
      );
    }
    try {
      assertPrivateAgentResponseSchema(request.responseSchema);
    } catch {
      throw new PrivateOpenAIResponsesError(
        "AGENT_PROVIDER_CONFIGURATION",
        "OpenAI response schema is outside the supported profile",
      );
    }
  }
}

function requireEndpoint(baseURL: string): void {
  if (baseURL.length === 0 || baseURL.length > 4_096) {
    throw invalidEndpoint();
  }
  let parsed: URL;
  try {
    parsed = new URL(baseURL);
  } catch {
    throw invalidEndpoint();
  }
  if (parsed.protocol !== "https:" ||
      parsed.username !== "" || parsed.password !== "" || parsed.search !== "" ||
      parsed.hash !== "") {
    throw invalidEndpoint();
  }
}

function invalidEndpoint(): PrivateOpenAIResponsesError {
  return new PrivateOpenAIResponsesError(
    "AGENT_PROVIDER_CONFIGURATION",
    "OpenAI Responses base URL is invalid",
  );
}

function requireApiKey(apiKey: string): void {
  if (typeof apiKey !== "string" || apiKey.trim().length === 0 || apiKey.includes("\0") ||
      new TextEncoder().encode(apiKey).byteLength > 16_384) {
    throw new PrivateOpenAIResponsesError(
      "AGENT_PROVIDER_CONFIGURATION",
      "OpenAI Responses API key is unavailable",
    );
  }
}

function responseContent(record: Record<string, unknown>, allowEmpty: boolean): {
  readonly text: readonly string[];
  readonly refusals: readonly string[];
} {
  const text: string[] = [];
  const refusals: string[] = [];
  let foundText = false;
  for (const rawItem of record.output as readonly unknown[]) {
    const item = ordinaryRecord(rawItem);
    if (item === undefined) throw invalidResponse();
    if (item.type !== "message") continue;
    if (!Array.isArray(item.content)) throw invalidResponse();
    for (const rawPart of item.content) {
      const part = ordinaryRecord(rawPart);
      if (part === undefined) throw invalidResponse();
      if (part.type === "output_text") {
        if (typeof part.text !== "string") throw invalidResponse();
        foundText = true;
        text.push(part.text);
      } else if (part.type === "refusal") {
        if (typeof part.refusal !== "string") throw invalidResponse();
        refusals.push(part.refusal);
      } else {
        throw invalidResponse();
      }
    }
  }
  if (!foundText && refusals.length === 0 && typeof record.output_text === "string") {
    foundText = true;
    text.push(record.output_text);
  }
  if (!foundText && refusals.length === 0 && !allowEmpty) throw invalidResponse();
  return Object.freeze({ text: Object.freeze(text), refusals: Object.freeze(refusals) });
}

function joinBounded(parts: readonly string[], separator: string): string {
  let bytes = 0;
  const separatorBytes = new TextEncoder().encode(separator).byteLength;
  for (const [index, part] of parts.entries()) {
    bytes += new TextEncoder().encode(part).byteLength;
    if (index !== 0) bytes += separatorBytes;
    if (bytes > JSON_1_LIMITS.stringBytes) {
      throw new PrivateOpenAIResponsesError(
        "AGENT_PROVIDER_OUTPUT_LIMIT",
        "OpenAI Responses text exceeds its byte bound",
      );
    }
  }
  return parts.join(separator);
}

function ordinaryRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return undefined;
  return value as Record<string, unknown>;
}

function exactKeys(value: object, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sorted = [...expected].sort();
  return actual.length === sorted.length &&
    actual.every((name, index) => name === sorted[index]);
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

function invalidResponse(): PrivateOpenAIResponsesError {
  return new PrivateOpenAIResponsesError(
    "AGENT_PROVIDER_RESPONSE_INVALID",
    "OpenAI Responses returned an invalid final response",
  );
}
