import { describe, expect, test } from "bun:test";

import type { JsonObject } from "../src/json.js";
import {
  assertPrivateAgentResponseSchema,
  normalizePrivateOpenAIAgentResponse,
  requestPrivateOpenAIAgent,
  type PrivateOpenAIAgentClientRequest,
} from "../src/internal/openai-agent-client.js";
import {
  decodePrivateOpenAIAgentRequest,
  decodePrivateOpenAIAgentResponse,
  encodePrivateOpenAIAgentFailure,
  encodePrivateOpenAIAgentRequest,
  encodePrivateOpenAIAgentSuccess,
  PrivateOpenAIAgentError,
  PRIVATE_OPENAI_AGENT_PROTOCOL,
} from "../src/internal/openai-agent-protocol.js";

const TEST_BASE_URL = "https://provider.example/api/v1";
const TEST_MODEL = "provider/test-model";
const mistralProof = process.env.JIG_MISTRAL_AGENT_PROOF === "1" &&
    process.env.MISTRAL_API_KEY !== undefined
  ? test
  : test.skip;

const RESPONSE_SCHEMA = Object.freeze({
  $schema: "https://flow.jig.md/schemas/schema-1.json",
  type: "object",
  description: "One bounded extraction result.",
  properties: Object.freeze({
    decision: Object.freeze({
      type: "object",
      properties: Object.freeze({
        route: Object.freeze({
          type: "string",
          enum: Object.freeze(["billing", "technical"]),
        }),
        note: Object.freeze({ type: Object.freeze(["string", "null"]) }),
        attempts: Object.freeze({ type: "integer" }),
        evidence: Object.freeze({
          type: "array",
          minItems: 0,
          maxItems: 2,
          items: Object.freeze({
            type: "object",
            properties: Object.freeze({
              page: Object.freeze({ type: "integer" }),
              amount: Object.freeze({ type: Object.freeze(["integer", "null"]) }),
              excerpt: Object.freeze({ type: Object.freeze(["string", "null"]) }),
            }),
            required: Object.freeze(["page", "amount", "excerpt"]),
            additionalProperties: false,
          }),
        }),
      }),
      required: Object.freeze(["route", "note", "attempts", "evidence"]),
      additionalProperties: false,
    }),
  }),
  required: Object.freeze(["decision"]),
  additionalProperties: false,
}) as JsonObject;

const RESPONSE_VALUE = Object.freeze({
  decision: Object.freeze({
    route: "technical",
    note: null,
    attempts: 1,
    evidence: Object.freeze([
      Object.freeze({ page: 2, amount: null, excerpt: "bounded source" }),
    ]),
  }),
});

describe("private OpenAI-compatible client", () => {
  mistralProof("uses the OpenAI client against Mistral's Chat Completions endpoint", async () => {
    const schema = closedSchema({ answer: { type: "string", enum: ["READY"] } });
    const result = await requestPrivateOpenAIAgent({
      api: "chat-completions",
      baseURL: "https://api.mistral.ai/v1",
      model: process.env.JIG_MISTRAL_AGENT_MODEL ?? "mistral-small-latest",
      instructions: 'Return exactly {"answer":"READY"}.',
      responseSchema: schema,
    }, { apiKey: process.env.MISTRAL_API_KEY! });
    expect(result).toMatchObject({
      outcome: "completed",
      structured: { answer: "READY" },
    });
    expect(JSON.parse(result.text)).toEqual({ answer: "READY" });
  }, 60_000);

  test("accepts the bounded recursive structured-output profile", () => {
    expect(() => assertPrivateAgentResponseSchema(RESPONSE_SCHEMA)).not.toThrow();
    expect(() => assertPrivateAgentResponseSchema(closedSchema({
      value: { type: ["null", "integer"] },
    }))).not.toThrow();
  });

  test("rejects open, optional, unbounded, and unsupported response shapes", () => {
    expect(() => assertPrivateAgentResponseSchema({
      ...closedSchema({ value: { type: "string" } }),
      additionalProperties: true,
    } as JsonObject)).toThrow();
    expect(() => assertPrivateAgentResponseSchema({
      ...closedSchema({ value: { type: "string" } }),
      required: [],
    } as JsonObject)).toThrow();
    expect(() => assertPrivateAgentResponseSchema(closedSchema({
      values: { type: "array", items: { type: "string" } },
    }))).toThrow();
    expect(() => assertPrivateAgentResponseSchema(closedSchema({
      values: { type: "array", items: { type: "string" }, maxItems: 257 },
    }))).toThrow();
    expect(() => assertPrivateAgentResponseSchema(closedSchema({
      value: { type: "boolean" },
    }))).toThrow();
    expect(() => assertPrivateAgentResponseSchema(closedSchema({
      value: { type: "number" },
    }))).toThrow();
    expect(() => assertPrivateAgentResponseSchema(closedSchema({
      value: { type: "object", additionalProperties: true },
    }))).toThrow();
    expect(() => assertPrivateAgentResponseSchema(closedSchema({
      value: { type: ["string", "null"], enum: ["known"] },
    }))).toThrow();
    expect(() => assertPrivateAgentResponseSchema(closedSchema({
      value: { type: ["string", "null"], enum: [null] },
    }))).toThrow();
    expect(() => assertPrivateAgentResponseSchema(closedSchema({
      value: { type: ["string", "null"], enum: ["known", null] },
    }))).not.toThrow();
  });

  test("rejects response shapes beyond recursive and aggregate bounds", () => {
    expect(() => assertPrivateAgentResponseSchema(deepSchema(10))).toThrow();

    const properties: Record<string, JsonObject> = {};
    for (let outer = 0; outer < 32; outer += 1) {
      const nested: Record<string, JsonObject> = {};
      for (let inner = 0; inner < 4; inner += 1) {
        nested[`field${inner}`] = { type: "integer" };
      }
      properties[`group${outer}`] = closedObject(nested);
    }
    expect(() => assertPrivateAgentResponseSchema(closedSchema(properties))).toThrow();
  });
  test("uses the OpenAI Responses API with a variable base URL and strict structured output", async () => {
    const apiKey = "test-provider-secret";
    let outboundURL: string | undefined;
    let outboundHeaders: Headers | undefined;
    let outboundBody: Record<string, unknown> | undefined;

    const result = await requestPrivateOpenAIAgent({
      api: "responses",
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
            content: [{
              type: "output_text",
              text: JSON.stringify(RESPONSE_VALUE),
              annotations: [],
            }],
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
            description: "One bounded extraction result.",
            properties: {
              decision: {
                type: "object",
                properties: {
                  route: { type: "string", enum: ["billing", "technical"] },
                  note: { type: ["string", "null"] },
                  attempts: { type: "integer" },
                  evidence: {
                    type: "array",
                    minItems: 0,
                    maxItems: 2,
                    items: {
                      type: "object",
                      properties: {
                        page: { type: "integer" },
                        amount: { type: ["integer", "null"] },
                        excerpt: { type: ["string", "null"] },
                      },
                      required: ["page", "amount", "excerpt"],
                      additionalProperties: false,
                    },
                  },
                },
                required: ["route", "note", "attempts", "evidence"],
                additionalProperties: false,
              },
            },
            required: ["decision"],
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
      text: JSON.stringify(RESPONSE_VALUE),
      structured: RESPONSE_VALUE,
    });
  });

  test("uses Chat Completions through the same SDK and normalizes structured output", async () => {
    let outboundURL: string | undefined;
    let outboundBody: Record<string, unknown> | undefined;
    const result = await requestPrivateOpenAIAgent({
      api: "chat-completions",
      baseURL: TEST_BASE_URL,
      model: TEST_MODEL,
      instructions: "Return the answer.",
      responseSchema: RESPONSE_SCHEMA,
    }, {
      apiKey: "test-provider-secret",
      fetch: async (input, init) => {
        const request = input instanceof Request ? input : undefined;
        outboundURL = request?.url ?? String(input);
        const body = request === undefined ? init?.body : await request.clone().text();
        if (typeof body !== "string") throw new Error("test expected a JSON request body");
        outboundBody = JSON.parse(body) as Record<string, unknown>;
        return jsonResponse({
          id: "completion-1",
          object: "chat.completion",
          created: 1,
          model: TEST_MODEL,
          choices: [{
            index: 0,
            finish_reason: "stop",
            message: {
              role: "assistant",
              content: JSON.stringify(RESPONSE_VALUE),
              refusal: null,
            },
          }],
        });
      },
    });

    expect(outboundURL).toBe("https://provider.example/api/v1/chat/completions");
    expect(outboundBody).toEqual({
      model: TEST_MODEL,
      messages: [{ role: "user", content: "Return the answer." }],
      max_tokens: 4096,
      stream: false,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "jig_agent_run_result",
          schema: {
            type: "object",
            description: "One bounded extraction result.",
            properties: {
              decision: {
                type: "object",
                properties: {
                  route: { type: "string", enum: ["billing", "technical"] },
                  note: { type: ["string", "null"] },
                  attempts: { type: "integer" },
                  evidence: {
                    type: "array",
                    minItems: 0,
                    maxItems: 2,
                    items: {
                      type: "object",
                      properties: {
                        page: { type: "integer" },
                        amount: { type: ["integer", "null"] },
                        excerpt: { type: ["string", "null"] },
                      },
                      required: ["page", "amount", "excerpt"],
                      additionalProperties: false,
                    },
                  },
                },
                required: ["route", "note", "attempts", "evidence"],
                additionalProperties: false,
              },
            },
            required: ["decision"],
            additionalProperties: false,
          },
          strict: true,
        },
      },
    });
    expect(result).toEqual({
      outcome: "completed",
      text: JSON.stringify(RESPONSE_VALUE),
      structured: RESPONSE_VALUE,
    });
  });

  test("scans all standard message content before using the SDK convenience field", async () => {
    const result = await requestPrivateOpenAIAgent(clientRequest(), {
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

    expect(normalizePrivateOpenAIAgentResponse({
      status: "completed",
      error: null,
      output: [],
      output_text: "SDK fallback",
    }, "responses", false)).toEqual({ outcome: "completed", text: "SDK fallback" });
  });

  test("maps incomplete and refusal responses without disguising transport failures", () => {
    expect(normalizePrivateOpenAIAgentResponse({
      status: "incomplete",
      error: null,
      incomplete_details: { reason: "max_output_tokens" },
      output: [{ type: "message", content: [{ type: "output_text", text: "partial" }] }],
    }, "responses", false)).toEqual({ outcome: "limit", text: "partial" });

    expect(normalizePrivateOpenAIAgentResponse({
      status: "incomplete",
      error: null,
      incomplete_details: { reason: "max_output_tokens" },
      output: [{ type: "reasoning", summary: [] }],
    }, "responses", false)).toEqual({ outcome: "limit", text: "" });

    expect(normalizePrivateOpenAIAgentResponse({
      status: "incomplete",
      error: null,
      incomplete_details: { reason: "content_filter" },
      output: [{ type: "message", content: [{ type: "output_text", text: "filtered" }] }],
    }, "responses", false)).toEqual({ outcome: "blocked", text: "filtered" });

    expect(normalizePrivateOpenAIAgentResponse({
      status: "completed",
      error: null,
      output: [{ type: "message", content: [{ type: "refusal", refusal: "cannot comply" }] }],
    }, "responses", false)).toEqual({ outcome: "blocked", text: "cannot comply" });

    expect(() => normalizePrivateOpenAIAgentResponse({
      status: "failed",
      error: { message: "provider failure" },
      output: [],
    }, "responses", false)).toThrow(expect.objectContaining({
      code: "AGENT_PROVIDER_UNAVAILABLE",
    }));
  });

  test("requires completed structured output to be JSON/1", () => {
    expect(() => normalizePrivateOpenAIAgentResponse({
      status: "completed",
      error: null,
      output: [{ type: "message", content: [{ type: "output_text", text: "not json" }] }],
    }, "responses", true)).toThrow(expect.objectContaining({
      code: "AGENT_PROVIDER_RESPONSE_INVALID",
    }));
  });

  test("maps Chat Completions terminal reasons and rejects tool dispatch", () => {
    expect(normalizePrivateOpenAIAgentResponse({
      choices: [{
        finish_reason: "length",
        message: { role: "assistant", content: "partial", refusal: null },
      }],
    }, "chat-completions", false)).toEqual({ outcome: "limit", text: "partial" });
    expect(normalizePrivateOpenAIAgentResponse({
      choices: [{
        finish_reason: "stop",
        message: { role: "assistant", content: null, refusal: "cannot comply" },
      }],
    }, "chat-completions", false)).toEqual({
      outcome: "blocked",
      text: "cannot comply",
    });
    expect(() => normalizePrivateOpenAIAgentResponse({
      choices: [{
        finish_reason: "tool_calls",
        message: { role: "assistant", content: null, tool_calls: [] },
      }],
    }, "chat-completions", false)).toThrow(expect.objectContaining({
      code: "AGENT_PROVIDER_RESPONSE_INVALID",
    }));
  });

  test("never reflects a rejected client's credential-bearing diagnostic", async () => {
    const apiKey = "secret-that-must-not-escape";
    let failure: unknown;
    try {
      await requestPrivateOpenAIAgent(clientRequest(), {
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
    expect(failure).toBeInstanceOf(PrivateOpenAIAgentError);
    expect(failure).toMatchObject({
      code: "AGENT_PROVIDER_UNAVAILABLE",
      message: "OpenAI Agent request failed",
    });
    expect(String(failure)).not.toContain(apiKey);
    expect((failure as Error).stack).not.toContain(apiKey);
  });

  test("does not retry a throttled provider dispatch", async () => {
    let calls = 0;
    let failure: unknown;
    try {
      await requestPrivateOpenAIAgent(clientRequest(), {
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
      message: "OpenAI Agent request failed",
    });
  });

  test("validates but does not choose the provider endpoint or model", async () => {
    await expect(requestPrivateOpenAIAgent({
      ...clientRequest(),
      baseURL: "http://provider.example/api/v1",
    }, { apiKey: "test-key", client: unusedClient })).rejects.toMatchObject({
      code: "AGENT_PROVIDER_CONFIGURATION",
    });
    await expect(requestPrivateOpenAIAgent({
      ...clientRequest(),
      model: "invalid model",
    }, { apiKey: "test-key", client: unusedClient })).rejects.toMatchObject({
      code: "AGENT_PROVIDER_CONFIGURATION",
    });
  });
});

describe("private OpenAI Agent worker protocol", () => {
  test("round-trips one provider-configured request", () => {
    const request = {
      protocol: PRIVATE_OPENAI_AGENT_PROTOCOL,
      apiKey: "transient-test-key",
      api: "chat-completions",
      baseURL: TEST_BASE_URL,
      model: TEST_MODEL,
      instructions: "Answer succinctly.",
      responseSchema: RESPONSE_SCHEMA,
    } as const;
    const encoded = encodePrivateOpenAIAgentRequest(request);
    expect(decodePrivateOpenAIAgentRequest(encoded)).toEqual(request);
  });

  test("rejects malformed provider configuration and result envelopes", () => {
    expect(() => encodePrivateOpenAIAgentRequest({
      protocol: PRIVATE_OPENAI_AGENT_PROTOCOL,
      apiKey: "transient-test-key",
      api: "responses",
      baseURL: "http://provider.example/api/v1",
      model: TEST_MODEL,
      instructions: "Answer.",
    })).toThrow(expect.objectContaining({ code: "AGENT_PROVIDER_PROTOCOL" }));
    expect(() => encodePrivateOpenAIAgentRequest({
      protocol: PRIVATE_OPENAI_AGENT_PROTOCOL,
      apiKey: "transient-test-key",
      api: "invented",
      baseURL: TEST_BASE_URL,
      model: TEST_MODEL,
      instructions: "Answer.",
    })).toThrow(expect.objectContaining({ code: "AGENT_PROVIDER_PROTOCOL" }));

    expect(() => decodePrivateOpenAIAgentResponse(new TextEncoder().encode(JSON.stringify({
      protocol: PRIVATE_OPENAI_AGENT_PROTOCOL,
      status: "ok",
      value: { outcome: "invented", text: "bad" },
    })))).toThrow(expect.objectContaining({ code: "AGENT_PROVIDER_PROTOCOL" }));
  });

  test("round-trips bounded success and failure responses", () => {
    expect(decodePrivateOpenAIAgentResponse(
      encodePrivateOpenAIAgentSuccess({
        outcome: "completed",
        text: "done",
        structured: { answer: "yes" },
      }),
    )).toEqual({
      protocol: PRIVATE_OPENAI_AGENT_PROTOCOL,
      status: "ok",
      value: {
        outcome: "completed",
        text: "done",
        structured: { answer: "yes" },
      },
    });
    expect(decodePrivateOpenAIAgentResponse(
      encodePrivateOpenAIAgentFailure(
        "AGENT_PROVIDER_UNAVAILABLE",
        "provider unavailable",
      ),
    )).toEqual({
      protocol: PRIVATE_OPENAI_AGENT_PROTOCOL,
      status: "error",
      code: "AGENT_PROVIDER_UNAVAILABLE",
      message: "provider unavailable",
    });
  });
});

function clientRequest(): PrivateOpenAIAgentClientRequest {
  return {
    api: "responses",
    baseURL: TEST_BASE_URL,
    model: TEST_MODEL,
    instructions: "Answer.",
  };
}

function closedSchema(properties: Record<string, JsonObject>): JsonObject {
  return {
    $schema: "https://flow.jig.md/schemas/schema-1.json",
    ...closedObject(properties),
  };
}

function closedObject(properties: Record<string, JsonObject>): JsonObject {
  return {
    type: "object",
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  };
}

function deepSchema(depth: number): JsonObject {
  let property: JsonObject = { type: "string" };
  for (let index = 0; index < depth; index += 1) {
    property = closedObject({ value: property });
  }
  return closedSchema({ value: property });
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
