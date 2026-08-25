import { describe, expect, test } from "bun:test";

import { parseEnvelope, validateFlowCall } from "../src/protocol.ts";

describe("JSON-RPC envelope validation", () => {
  test("rejects null and scalar request params", () => {
    for (const params of [null, false, 1, "value"]) {
      expect(() =>
        parseEnvelope({
          jsonrpc: "2.0",
          id: "host:1",
          method: "flow/run",
          params,
        }),
      ).toThrow();
    }
  });

  test("rejects null and scalar notification params", () => {
    for (const params of [null, false, 1, "value"]) {
      expect(() =>
        parseEnvelope({
          jsonrpc: "2.0",
          method: "request/cancel",
          params,
        }),
      ).toThrow();
    }
  });

  test("accepts object and array params", () => {
    expect(
      parseEnvelope({
        jsonrpc: "2.0",
        id: "host:1",
        method: "flow/run",
        params: {},
      }).value.params,
    ).toEqual({});
    expect(
      parseEnvelope({
        jsonrpc: "2.0",
        method: "progress",
        params: ["working"],
      }).value.params,
    ).toEqual(["working"]);
  });
});

describe("public call validation", () => {
  test("counts intent length in Unicode scalars rather than UTF-16 units", () => {
    expect(() =>
      validateFlowCall({
        operationId: "unicode:1",
        slot: "worker",
        intent: "😀".repeat(10_000),
        input: null,
      }),
    ).not.toThrow();
    expect(() =>
      validateFlowCall({
        operationId: "unicode:2",
        slot: "worker",
        intent: "x".repeat(16_384),
        input: null,
      }),
    ).not.toThrow();
    expect(() =>
      validateFlowCall({
        operationId: "unicode:3",
        slot: "worker",
        intent: "x".repeat(16_385),
        input: null,
      }),
    ).toThrow(TypeError);
  });

  test("rejects non-string iterable and array-like intents at runtime", () => {
    for (const intent of [42, ["x"], { 0: "x", length: 1 }]) {
      expect(() =>
        validateFlowCall({
          operationId: "invalid:1",
          slot: "worker",
          intent,
          input: null,
        } as never),
      ).toThrow(TypeError);
    }
  });
});
