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
  PRIVATE_OPENROUTER_RESPONSES_BASE_URL,
  PrivateOpenRouterResponsesError,
  PRIVATE_OPENROUTER_RESPONSES_MODEL,
  type PrivateOpenRouterResponsesResult,
} from "./openrouter-responses-protocol.js";

const MAX_INSTRUCTION_CHARACTERS = 1_048_576;
const MAX_RESPONSE_SCHEMA_BYTES = 256 * 1024;
const RESPONSE_FORMAT_NAME = "jig_agent_run_result";
const MAX_OUTPUT_TOKENS = 4_096;
const MAX_ENUM_PROPERTIES = 32;
const MAX_ENUM_VALUES = 256;

export type PrivateOpenRouterFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface PrivateOpenRouterResponsesCreateClient {
  create(body: ResponseCreateParamsNonStreaming): Promise<unknown>;
}

export interface PrivateOpenRouterResponsesClientRequest {
  readonly baseURL: string;
  readonly model: string;
  readonly instructions: string;
  readonly responseSchema?: JsonObject;
}

export interface PrivateOpenRouterResponsesClientDependencies {
  readonly apiKey: string;
  /** Test seam: production uses the bundled OpenAI SDK with the global fetch. */
  readonly fetch?: PrivateOpenRouterFetch;
  /** Test seam: production creates exactly one bundled OpenAI Responses client. */
  readonly client?: PrivateOpenRouterResponsesCreateClient;
}

/** The first provider proves only the closed enum-object shape routing needs. */
export function assertPrivateOpenRouterResponseSchema(schema: JsonObject): void {
  if (!exactKeys(schema, ["$schema", "additionalProperties", "properties", "required", "type"]) ||
      schema.$schema !== "https://flow.jig.md/schemas/schema-1.json" ||
      schema.type !== "object" || schema.additionalProperties !== false ||
      ordinaryRecord(schema.properties) === undefined || !Array.isArray(schema.required)) {
    throw new TypeError("OpenRouter responseSchema must be one closed enum object");
  }
  const properties = schema.properties as JsonObject;
  const names = Object.keys(properties);
  if (names.length === 0 || names.length > MAX_ENUM_PROPERTIES ||
      schema.required.length !== names.length ||
      new Set(schema.required).size !== names.length ||
      schema.required.some((name) => typeof name !== "string" || !Object.hasOwn(properties, name))) {
    throw new TypeError("OpenRouter responseSchema must require every enum property");
  }
  for (const value of Object.values(properties)) {
    const property = ordinaryRecord(value);
    if (property === undefined || !exactKeys(property, ["enum"]) ||
        !Array.isArray(property.enum) || property.enum.length === 0 ||
        property.enum.length > MAX_ENUM_VALUES ||
        property.enum.some((item) => typeof item !== "string") ||
        new Set(property.enum).size !== property.enum.length) {
      throw new TypeError("OpenRouter responseSchema properties must be string enums");
    }
  }
}

/**
 * Make one non-streaming OpenAI Responses call and normalize only its final
 * Agent Run value. Dispatch retry is disabled; process ownership and abort
 * fencing remain the responsibility of the containing worker controller.
 */
export async function requestPrivateOpenRouterResponse(
  request: PrivateOpenRouterResponsesClientRequest,
  dependencies: PrivateOpenRouterResponsesClientDependencies,
): Promise<PrivateOpenRouterResponsesResult> {
  requireClientRequest(request, dependencies.client !== undefined || dependencies.fetch !== undefined);
  requireApiKey(dependencies.apiKey);
  if (dependencies.client !== undefined && dependencies.fetch !== undefined) {
    throw new PrivateOpenRouterResponsesError(
      "AGENT_PROVIDER_CONFIGURATION",
      "OpenRouter Responses test transport is ambiguous",
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
    throw new PrivateOpenRouterResponsesError(
      "AGENT_PROVIDER_UNAVAILABLE",
      "OpenRouter Responses request failed",
    );
  }
  return normalizePrivateOpenRouterResponse(response, request.responseSchema !== undefined);
}

export function normalizePrivateOpenRouterResponse(
  response: unknown,
  structuredRequested: boolean,
): PrivateOpenRouterResponsesResult {
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
    throw new PrivateOpenRouterResponsesError(
      "AGENT_PROVIDER_UNAVAILABLE",
      "OpenRouter Responses request did not complete",
    );
  }
  if (record.status === "queued" || record.status === "in_progress") {
    throw invalidResponse();
  }

  const content = responseContent(record, record.status === "incomplete");
  let outcome: PrivateOpenRouterResponsesResult["outcome"];
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
    throw new PrivateOpenRouterResponsesError(
      "AGENT_PROVIDER_RESPONSE_INVALID",
      "OpenRouter structured response is not valid JSON/1",
    );
  }
}

function sdkClient(
  baseURL: string,
  apiKey: string,
  injectedFetch: PrivateOpenRouterFetch | undefined,
): PrivateOpenRouterResponsesCreateClient {
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
  request: PrivateOpenRouterResponsesClientRequest,
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
        schema: providerSchema(request.responseSchema),
        strict: true,
      },
    },
  };
}

function providerSchema(responseSchema: JsonObject): Record<string, unknown> {
  // Schema/1's root declaration identifies Jig's validator dialect, not a
  // provider meta-schema. Keep the exact input untouched and remove only that
  // declaration from the provider-facing copy.
  return Object.fromEntries(
    Object.entries(responseSchema).filter(([name]) => name !== "$schema"),
  );
}

function requireClientRequest(
  request: PrivateOpenRouterResponsesClientRequest,
  injectedTransport: boolean,
): void {
  if (request === null || typeof request !== "object" ||
      typeof request.baseURL !== "string" || typeof request.model !== "string" ||
      typeof request.instructions !== "string" ||
      !boundedCharacters(request.instructions, MAX_INSTRUCTION_CHARACTERS)) {
    throw new PrivateOpenRouterResponsesError(
      "AGENT_PROVIDER_CONFIGURATION",
      "OpenRouter Responses client request is invalid",
    );
  }
  try {
    validateJson1(request.instructions);
  } catch {
    throw new PrivateOpenRouterResponsesError(
      "AGENT_PROVIDER_CONFIGURATION",
      "OpenRouter Responses instructions are not valid JSON/1 text",
    );
  }
  requireEndpoint(request.baseURL);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/.test(request.model)) {
    throw new PrivateOpenRouterResponsesError(
      "AGENT_PROVIDER_CONFIGURATION",
      "OpenRouter Responses model is invalid",
    );
  }
  if (!injectedTransport &&
      (request.baseURL !== PRIVATE_OPENROUTER_RESPONSES_BASE_URL ||
        request.model !== PRIVATE_OPENROUTER_RESPONSES_MODEL)) {
    throw new PrivateOpenRouterResponsesError(
      "AGENT_PROVIDER_CONFIGURATION",
      "OpenRouter Responses production configuration is not pinned",
    );
  }
  if (request.responseSchema !== undefined) {
    if (ordinaryRecord(request.responseSchema) === undefined) {
      throw new PrivateOpenRouterResponsesError(
        "AGENT_PROVIDER_CONFIGURATION",
        "OpenRouter response schema is invalid",
      );
    }
    let bytes: Uint8Array;
    try {
      validateJson1(request.responseSchema);
      bytes = canonicalJson(request.responseSchema);
    } catch {
      throw new PrivateOpenRouterResponsesError(
        "AGENT_PROVIDER_CONFIGURATION",
        "OpenRouter response schema is not valid JSON/1",
      );
    }
    if (bytes.byteLength > MAX_RESPONSE_SCHEMA_BYTES) {
      throw new PrivateOpenRouterResponsesError(
        "AGENT_PROVIDER_CONFIGURATION",
        "OpenRouter response schema exceeds its byte bound",
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
  if ((parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
      parsed.username !== "" || parsed.password !== "" || parsed.search !== "" ||
      parsed.hash !== "") {
    throw invalidEndpoint();
  }
}

function invalidEndpoint(): PrivateOpenRouterResponsesError {
  return new PrivateOpenRouterResponsesError(
    "AGENT_PROVIDER_CONFIGURATION",
    "OpenRouter Responses base URL is invalid",
  );
}

function requireApiKey(apiKey: string): void {
  if (typeof apiKey !== "string" || apiKey.trim().length === 0 || apiKey.includes("\0") ||
      new TextEncoder().encode(apiKey).byteLength > 16_384) {
    throw new PrivateOpenRouterResponsesError(
      "AGENT_PROVIDER_CONFIGURATION",
      "OPENROUTER_API_KEY is unavailable",
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
      throw new PrivateOpenRouterResponsesError(
        "AGENT_PROVIDER_OUTPUT_LIMIT",
        "OpenRouter Responses text exceeds its byte bound",
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

function invalidResponse(): PrivateOpenRouterResponsesError {
  return new PrivateOpenRouterResponsesError(
    "AGENT_PROVIDER_RESPONSE_INVALID",
    "OpenRouter Responses returned an invalid final response",
  );
}
