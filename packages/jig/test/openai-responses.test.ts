import { describe, expect, test } from "bun:test";

import type { JsonObject } from "../src/json.js";
import {
  assertPrivateAgentResponseSchema,
  normalizePrivateOpenAIResponse,
  requestPrivateOpenAIResponse,
  type PrivateOpenAIResponsesClientRequest,
} from "../src/internal/openai-responses-client.js";
import {
  decodePrivateOpenAIResponsesRequest,
  decodePrivateOpenAIResponsesResponse,
  encodePrivateOpenAIResponsesFailure,
  encodePrivateOpenAIResponsesRequest,
  encodePrivateOpenAIResponsesSuccess,
  PrivateOpenAIResponsesError,
  PRIVATE_OPENAI_RESPONSES_PROTOCOL,
} from "../src/internal/openai-responses-protocol.js";

const TEST_BASE_URL = "https://provider.example/api/v1";
const TEST_MODEL = "provider/test-model";

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

describe("private OpenAI Responses client", () => {
  test("accepts only the closed enum-object response shape supported by the Agent slice", () => {
    expect(() => assertPrivateAgentResponseSchema(ROUTE_SCHEMA)).not.toThrow();
    expect(() => assertPrivateAgentResponseSchema(RESPONSE_SCHEMA)).toThrow("string enums");
    expect(() => assertPrivateAgentResponseSchema({
      ...ROUTE_SCHEMA,
      additionalProperties: true,
    } as JsonObject)).toThrow("closed enum object");
  });
  test("uses the OpenAI Responses API with a variable base URL and strict structured output", async () => {
    const apiKey = "test-provider-secret";
    let outboundURL: string | undefined;
    let outboundHeaders: Headers | undefined;
    let outboundBody: Record<string, unknown> | undefined;

    const result = await requestPrivateOpenAIResponse({
      baseURL: TEST_BASE_URL,
      model: TEST_MODEL,
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
      model: TEST_MODEL,
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
    const result = await requestPrivateOpenAIResponse(clientRequest(), {
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

    expect(normalizePrivateOpenAIResponse({
      status: "completed",
      error: null,
      output: [],
      output_text: "SDK fallback",
    }, false)).toEqual({ outcome: "completed", text: "SDK fallback" });
  });

  test("maps incomplete and refusal responses without disguising transport failures", () => {
    expect(normalizePrivateOpenAIResponse({
      status: "incomplete",
      error: null,
      incomplete_details: { reason: "max_output_tokens" },
      output: [{ type: "message", content: [{ type: "output_text", text: "partial" }] }],
    }, false)).toEqual({ outcome: "limit", text: "partial" });

    expect(normalizePrivateOpenAIResponse({
      status: "incomplete",
      error: null,
      incomplete_details: { reason: "max_output_tokens" },
      output: [{ type: "reasoning", summary: [] }],
    }, false)).toEqual({ outcome: "limit", text: "" });

    expect(normalizePrivateOpenAIResponse({
      status: "incomplete",
      error: null,
      incomplete_details: { reason: "content_filter" },
      output: [{ type: "message", content: [{ type: "output_text", text: "filtered" }] }],
    }, false)).toEqual({ outcome: "blocked", text: "filtered" });

    expect(normalizePrivateOpenAIResponse({
      status: "completed",
      error: null,
      output: [{ type: "message", content: [{ type: "refusal", refusal: "cannot comply" }] }],
    }, false)).toEqual({ outcome: "blocked", text: "cannot comply" });

    expect(() => normalizePrivateOpenAIResponse({
      status: "failed",
      error: { message: "provider failure" },
      output: [],
    }, false)).toThrow(expect.objectContaining({ code: "AGENT_PROVIDER_UNAVAILABLE" }));
  });

  test("requires completed structured output to be JSON/1", () => {
    expect(() => normalizePrivateOpenAIResponse({
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
      await requestPrivateOpenAIResponse(clientRequest(), {
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
    expect(failure).toBeInstanceOf(PrivateOpenAIResponsesError);
    expect(failure).toMatchObject({
      code: "AGENT_PROVIDER_UNAVAILABLE",
      message: "OpenAI Responses request failed",
    });
    expect(String(failure)).not.toContain(apiKey);
    expect((failure as Error).stack).not.toContain(apiKey);
  });

  test("does not retry a throttled provider dispatch", async () => {
    let calls = 0;
    let failure: unknown;
    try {
      await requestPrivateOpenAIResponse(clientRequest(), {
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
      message: "OpenAI Responses request failed",
    });
  });

  test("validates but does not choose the provider endpoint or model", async () => {
    await expect(requestPrivateOpenAIResponse({
      ...clientRequest(),
      baseURL: "http://provider.example/api/v1",
    }, { apiKey: "test-key", client: unusedClient })).rejects.toMatchObject({
      code: "AGENT_PROVIDER_CONFIGURATION",
    });
    await expect(requestPrivateOpenAIResponse({
      ...clientRequest(),
      model: "invalid model",
    }, { apiKey: "test-key", client: unusedClient })).rejects.toMatchObject({
      code: "AGENT_PROVIDER_CONFIGURATION",
    });
  });
});

describe("private OpenAI Responses worker protocol", () => {
  test("round-trips one provider-configured request", () => {
    const request = {
      protocol: PRIVATE_OPENAI_RESPONSES_PROTOCOL,
      apiKey: "transient-test-key",
      baseURL: TEST_BASE_URL,
      model: TEST_MODEL,
      instructions: "Answer succinctly.",
      responseSchema: RESPONSE_SCHEMA,
    } as const;
    const encoded = encodePrivateOpenAIResponsesRequest(request);
    expect(decodePrivateOpenAIResponsesRequest(encoded)).toEqual(request);
  });

  test("rejects malformed provider configuration and result envelopes", () => {
    expect(() => encodePrivateOpenAIResponsesRequest({
      protocol: PRIVATE_OPENAI_RESPONSES_PROTOCOL,
      apiKey: "transient-test-key",
      baseURL: "http://provider.example/api/v1",
      model: TEST_MODEL,
      instructions: "Answer.",
    })).toThrow(expect.objectContaining({ code: "AGENT_PROVIDER_PROTOCOL" }));

    expect(() => decodePrivateOpenAIResponsesResponse(new TextEncoder().encode(JSON.stringify({
      protocol: PRIVATE_OPENAI_RESPONSES_PROTOCOL,
      status: "ok",
      value: { outcome: "invented", text: "bad" },
    })))).toThrow(expect.objectContaining({ code: "AGENT_PROVIDER_PROTOCOL" }));
  });

  test("round-trips bounded success and failure responses", () => {
    expect(decodePrivateOpenAIResponsesResponse(
      encodePrivateOpenAIResponsesSuccess({
        outcome: "completed",
        text: "done",
        structured: { answer: "yes" },
      }),
    )).toEqual({
      protocol: PRIVATE_OPENAI_RESPONSES_PROTOCOL,
      status: "ok",
      value: {
        outcome: "completed",
        text: "done",
        structured: { answer: "yes" },
      },
    });
    expect(decodePrivateOpenAIResponsesResponse(
      encodePrivateOpenAIResponsesFailure(
        "AGENT_PROVIDER_UNAVAILABLE",
        "provider unavailable",
      ),
    )).toEqual({
      protocol: PRIVATE_OPENAI_RESPONSES_PROTOCOL,
      status: "error",
      code: "AGENT_PROVIDER_UNAVAILABLE",
      message: "provider unavailable",
    });
  });
});

function clientRequest(): PrivateOpenAIResponsesClientRequest {
  return {
    baseURL: TEST_BASE_URL,
    model: TEST_MODEL,
    instructions: "Answer.",
  };
}

const unusedClient = Object.freeze({
  async create(): Promise<never> {
    throw new Error("invalid requests must not reach the client");
  },
});

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
