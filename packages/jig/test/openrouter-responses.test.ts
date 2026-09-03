import { describe, expect, test } from "bun:test";

import type { JsonObject } from "../src/json.js";
import {
  assertPrivateOpenRouterResponseSchema,
  normalizePrivateOpenRouterResponse,
  requestPrivateOpenRouterResponse,
  type PrivateOpenRouterResponsesClientRequest,
} from "../src/internal/openrouter-responses-client.js";
import {
  decodePrivateOpenRouterResponsesRequest,
  decodePrivateOpenRouterResponsesResponse,
  encodePrivateOpenRouterResponsesFailure,
  encodePrivateOpenRouterResponsesRequest,
  encodePrivateOpenRouterResponsesSuccess,
  PRIVATE_OPENROUTER_RESPONSES_BASE_URL,
  PrivateOpenRouterResponsesError,
  PRIVATE_OPENROUTER_RESPONSES_MODEL,
  PRIVATE_OPENROUTER_RESPONSES_PROTOCOL,
} from "../src/internal/openrouter-responses-protocol.js";

const RESPONSE_SCHEMA = Object.freeze({
  $schema: "https://flow.jig.md/schemas/schema-1.json",
  type: "object",
  properties: Object.freeze({ answer: Object.freeze({ type: "string" }) }),
  required: Object.freeze(["answer"]),
  additionalProperties: false,
}) as JsonObject;

const ROUTE_SCHEMA = Object.freeze({
  $schema: "https://flow.jig.md/schemas/schema-1.json",
  type: "object",
  properties: Object.freeze({
    route: Object.freeze({ enum: Object.freeze(["billing", "technical"]) }),
  }),
  required: Object.freeze(["route"]),
  additionalProperties: false,
}) as JsonObject;

describe("private OpenRouter Responses client", () => {
  test("accepts only the closed enum-object response shape proved by the provider", () => {
    expect(() => assertPrivateOpenRouterResponseSchema(ROUTE_SCHEMA)).not.toThrow();
    expect(() => assertPrivateOpenRouterResponseSchema(RESPONSE_SCHEMA)).toThrow("string enums");
    expect(() => assertPrivateOpenRouterResponseSchema({
      ...ROUTE_SCHEMA,
      additionalProperties: true,
    } as JsonObject)).toThrow("closed enum object");
  });
  test("uses the OpenAI Responses API with a variable base URL and strict structured output", async () => {
    const apiKey = "test-openrouter-secret";
    let outboundURL: string | undefined;
    let outboundHeaders: Headers | undefined;
    let outboundBody: Record<string, unknown> | undefined;

    const result = await requestPrivateOpenRouterResponse({
      baseURL: "https://provider.example/api/v1",
      model: "example/test-model",
      instructions: "Return the answer.",
      responseSchema: RESPONSE_SCHEMA,
    }, {
      apiKey,
      fetch: async (input, init) => {
        const request = input instanceof Request ? input : undefined;
        outboundURL = request?.url ?? String(input);
        outboundHeaders = new Headers(request?.headers ?? init?.headers);
        const body = request === undefined
          ? init?.body
          : await request.clone().text();
        if (typeof body !== "string") throw new Error("test expected a JSON request body");
        outboundBody = JSON.parse(body) as Record<string, unknown>;
        return jsonResponse({
          status: "completed",
          error: null,
          incomplete_details: null,
          output: [{
            type: "message",
            role: "assistant",
            status: "completed",
            content: [{ type: "output_text", text: '{"answer":"yes"}', annotations: [] }],
          }],
        });
      },
    });

    expect(outboundURL).toBe("https://provider.example/api/v1/responses");
    expect(outboundHeaders?.get("authorization")).toBe(`Bearer ${apiKey}`);
    expect(outboundBody).toEqual({
      model: "example/test-model",
      input: "Return the answer.",
      max_output_tokens: 4096,
      store: false,
      stream: false,
      text: {
        format: {
          type: "json_schema",
          name: "jig_agent_run_result",
          schema: {
            type: "object",
            properties: { answer: { type: "string" } },
            required: ["answer"],
            additionalProperties: false,
          },
          strict: true,
        },
      },
    });
    expect(JSON.stringify(outboundBody)).not.toContain(apiKey);
    expect(RESPONSE_SCHEMA.$schema).toBe("https://flow.jig.md/schemas/schema-1.json");
    expect(result).toEqual({
      outcome: "completed",
      text: '{"answer":"yes"}',
      structured: { answer: "yes" },
    });
  });

  test("scans all standard message content before using the SDK convenience field", async () => {
    const result = await requestPrivateOpenRouterResponse(clientRequest(), {
      apiKey: "test-key",
      client: {
        async create() {
          return {
            status: "completed",
            error: null,
            output_text: "wrong fallback",
            output: [
              { type: "reasoning", summary: [] },
              {
                type: "message",
                content: [
                  { type: "output_text", text: "alpha" },
                  { type: "output_text", text: " beta" },
                ],
              },
            ],
          };
        },
      },
    });
    expect(result).toEqual({ outcome: "completed", text: "alpha beta" });

    expect(normalizePrivateOpenRouterResponse({
      status: "completed",
      error: null,
      output: [],
      output_text: "SDK fallback",
    }, false)).toEqual({ outcome: "completed", text: "SDK fallback" });
  });

  test("maps incomplete and refusal responses without disguising transport failures", () => {
    expect(normalizePrivateOpenRouterResponse({
      status: "incomplete",
      error: null,
      incomplete_details: { reason: "max_output_tokens" },
      output: [{ type: "message", content: [{ type: "output_text", text: "partial" }] }],
    }, false)).toEqual({ outcome: "limit", text: "partial" });

    expect(normalizePrivateOpenRouterResponse({
      status: "incomplete",
      error: null,
      incomplete_details: { reason: "max_output_tokens" },
      output: [{ type: "reasoning", summary: [] }],
    }, false)).toEqual({ outcome: "limit", text: "" });

    expect(normalizePrivateOpenRouterResponse({
      status: "incomplete",
      error: null,
      incomplete_details: { reason: "content_filter" },
      output: [{ type: "message", content: [{ type: "output_text", text: "filtered" }] }],
    }, false)).toEqual({ outcome: "blocked", text: "filtered" });

    expect(normalizePrivateOpenRouterResponse({
      status: "completed",
      error: null,
      output: [{ type: "message", content: [{ type: "refusal", refusal: "cannot comply" }] }],
    }, false)).toEqual({ outcome: "blocked", text: "cannot comply" });

    expect(() => normalizePrivateOpenRouterResponse({
      status: "failed",
      error: { message: "provider failure" },
      output: [],
    }, false)).toThrow(expect.objectContaining({ code: "AGENT_PROVIDER_UNAVAILABLE" }));
  });

  test("requires completed structured output to be JSON/1", () => {
    expect(() => normalizePrivateOpenRouterResponse({
      status: "completed",
      error: null,
      output: [{ type: "message", content: [{ type: "output_text", text: "not json" }] }],
    }, true)).toThrow(expect.objectContaining({
      code: "AGENT_PROVIDER_RESPONSE_INVALID",
    }));
  });

  test("never reflects a rejected client's credential-bearing diagnostic", async () => {
    const apiKey = "secret-that-must-not-escape";
    let failure: unknown;
    try {
      await requestPrivateOpenRouterResponse(clientRequest(), {
        apiKey,
        client: {
          async create() {
            throw new Error(`Authorization: Bearer ${apiKey}`);
          },
        },
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(PrivateOpenRouterResponsesError);
    expect(failure).toMatchObject({
      code: "AGENT_PROVIDER_UNAVAILABLE",
      message: "OpenRouter Responses request failed",
    });
    expect(String(failure)).not.toContain(apiKey);
    expect((failure as Error).stack).not.toContain(apiKey);
  });

  test("does not retry a throttled provider dispatch", async () => {
    let calls = 0;
    let failure: unknown;
    try {
      await requestPrivateOpenRouterResponse(clientRequest(), {
        apiKey: "test-key",
        fetch: async () => {
          calls += 1;
          return new Response(JSON.stringify({ error: { message: "throttled" } }), {
            status: 429,
            headers: { "content-type": "application/json" },
          });
        },
      });
    } catch (error) {
      failure = error;
    }
    expect(calls).toBe(1);
    expect(failure).toMatchObject({
      code: "AGENT_PROVIDER_UNAVAILABLE",
      message: "OpenRouter Responses request failed",
    });
  });

  test("does not permit an unpinned production endpoint or model", async () => {
    await expect(requestPrivateOpenRouterResponse({
      ...clientRequest(),
      model: "different/model",
    }, { apiKey: "test-key" })).rejects.toMatchObject({
      code: "AGENT_PROVIDER_CONFIGURATION",
    });
  });
});

describe("private OpenRouter Responses worker protocol", () => {
  test("round-trips the exact closed production request", () => {
    const request = {
      protocol: PRIVATE_OPENROUTER_RESPONSES_PROTOCOL,
      apiKey: "transient-test-key",
      baseURL: PRIVATE_OPENROUTER_RESPONSES_BASE_URL,
      model: PRIVATE_OPENROUTER_RESPONSES_MODEL,
      instructions: "Answer succinctly.",
      responseSchema: RESPONSE_SCHEMA,
    } as const;
    const encoded = encodePrivateOpenRouterResponsesRequest(request);
    expect(new TextDecoder().decode(encoded)).not.toContain("OPENROUTER_API_KEY");
    expect(decodePrivateOpenRouterResponsesRequest(encoded)).toEqual(request);
  });

  test("rejects endpoint/model drift and malformed result envelopes", () => {
    expect(() => encodePrivateOpenRouterResponsesRequest({
      protocol: PRIVATE_OPENROUTER_RESPONSES_PROTOCOL,
      apiKey: "transient-test-key",
      baseURL: PRIVATE_OPENROUTER_RESPONSES_BASE_URL,
      model: "openrouter/free",
      instructions: "Answer.",
    })).toThrow(expect.objectContaining({ code: "AGENT_PROVIDER_PROTOCOL" }));

    expect(() => decodePrivateOpenRouterResponsesResponse(new TextEncoder().encode(JSON.stringify({
      protocol: PRIVATE_OPENROUTER_RESPONSES_PROTOCOL,
      status: "ok",
      value: { outcome: "invented", text: "bad" },
    })))).toThrow(expect.objectContaining({ code: "AGENT_PROVIDER_PROTOCOL" }));
  });

  test("round-trips bounded success and failure responses", () => {
    expect(decodePrivateOpenRouterResponsesResponse(
      encodePrivateOpenRouterResponsesSuccess({
        outcome: "completed",
        text: "done",
        structured: { answer: "yes" },
      }),
    )).toEqual({
      protocol: PRIVATE_OPENROUTER_RESPONSES_PROTOCOL,
      status: "ok",
      value: {
        outcome: "completed",
        text: "done",
        structured: { answer: "yes" },
      },
    });
    expect(decodePrivateOpenRouterResponsesResponse(
      encodePrivateOpenRouterResponsesFailure(
        "AGENT_PROVIDER_UNAVAILABLE",
        "provider unavailable",
      ),
    )).toEqual({
      protocol: PRIVATE_OPENROUTER_RESPONSES_PROTOCOL,
      status: "error",
      code: "AGENT_PROVIDER_UNAVAILABLE",
      message: "provider unavailable",
    });
  });
});

function clientRequest(): PrivateOpenRouterResponsesClientRequest {
  return {
    baseURL: PRIVATE_OPENROUTER_RESPONSES_BASE_URL,
    model: PRIVATE_OPENROUTER_RESPONSES_MODEL,
    instructions: "Answer.",
  };
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
