import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

import {
  RootAdministrationError,
  normalizeRootRunStatusRequest,
  normalizeStartRootRunRequest,
} from "../src/administration/root.js";
import { compileSchemaFile, SchemaDiagnostic } from "../src/schema/index.js";

const digest = `sha256:${"a".repeat(64)}`;
const schema = compileSchemaFile(await readFile(new URL(
  "../../../docs/spec/machine/root-administration-1.schema.json",
  import.meta.url,
)), "root-administration-1.schema.json");

function captured(action: () => unknown): RootAdministrationError {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(RootAdministrationError);
    return error as RootAdministrationError;
  }
  throw new Error("expected RootAdministrationError");
}

describe("Root Administration/1 contract", () => {
  test("captures one closed immutable start request", () => {
    const input = { nested: [1, { ready: true }] };
    const normalized = normalizeStartRootRunRequest({
      submissionId: "ticket:42/attempt-1",
      target: { kind: "flow", path: "./flows/review" },
      input,
    });

    input.nested[1] = { ready: false };
    expect(normalized).toEqual({
      submissionId: "ticket:42/attempt-1",
      target: { kind: "flow", path: "flows/review" },
      input: { nested: [1, { ready: true }] },
    });
    expect(Object.isFrozen(normalized)).toBe(true);
    expect(Object.isFrozen(normalized.input)).toBe(true);
    expect(Object.isFrozen((normalized.input as any).nested)).toBe(true);
    expect(Object.isFrozen((normalized.input as any).nested[1])).toBe(true);
  });

  test("does not invoke accessors while rejecting a request", () => {
    let reads = 0;
    const request = {
      submissionId: "one",
      target: { kind: "binding", id: "review" },
      get input() {
        reads += 1;
        return {};
      },
    };
    expect(captured(() => normalizeStartRootRunRequest(request)).code).toBe("INVALID_REQUEST");
    expect(reads).toBe(0);
  });

  for (const [name, value] of [
    ["unknown request member", {
      submissionId: "one", target: { kind: "binding", id: "review" }, input: {}, extra: true,
    }],
    ["missing input", { submissionId: "one", target: { kind: "binding", id: "review" } }],
    ["invalid submission ID", {
      submissionId: " space", target: { kind: "binding", id: "review" }, input: {},
    }],
    ["invalid target tag", { submissionId: "one", target: { kind: "other", id: "review" }, input: {} }],
    ["unknown target member", {
      submissionId: "one", target: { kind: "binding", id: "review", path: "flows/review" }, input: {},
    }],
    ["non JSON/1 input", {
      submissionId: "one", target: { kind: "binding", id: "review" }, input: undefined,
    }],
  ] as const) {
    test(`rejects ${name} before allocation`, () => {
      expect(captured(() => normalizeStartRootRunRequest(value)).code).toBe("INVALID_REQUEST");
    });
  }

  test("normalizes only a closed digest status request", () => {
    expect(normalizeRootRunStatusRequest({ runId: digest })).toEqual({ runId: digest });
    expect(captured(() => normalizeRootRunStatusRequest({ runId: digest, extra: true })).code)
      .toBe("INVALID_REQUEST");
    expect(captured(() => normalizeRootRunStatusRequest({ runId: "run-1" })).code)
      .toBe("INVALID_REQUEST");
  });

  test("serializes a closed administration error without sharing details", () => {
    const details = { owner: "other" };
    const error = new RootAdministrationError("PROJECT_BUSY", "project is busy", details);
    details.owner = "changed";
    expect(error.toJSON()).toEqual({
      code: "PROJECT_BUSY",
      message: "project is busy",
      details: { owner: "other" },
    });
    expect(Object.isFrozen(error.details)).toBe(true);
    expect(() => schema.validate(error.toJSON(), "INVALID_ROOT_ADMINISTRATION")).not.toThrow();
  });

  test("machine definitions admit every public branch", () => {
    const diagnostics = { stderr: "", stderrBytes: 0, stderrTruncated: false };
    const values = [
      { submissionId: "one", target: { kind: "binding", id: "review" }, input: {} },
      { runId: digest },
      { runId: digest, submissionId: "one", target: { kind: "binding", id: "review" }, state: "pending" },
      {
        runId: digest,
        submissionId: "one",
        target: { kind: "flow", path: "flows/review" },
        state: "terminal",
        terminal: { status: "succeeded", outcome: "done", output: null, diagnostics },
      },
      {
        runId: digest,
        submissionId: "one",
        target: { kind: "binding", id: "review" },
        state: "terminal",
        terminal: {
          status: "failed", code: "INVALID_INPUT", message: "bad input", details: {}, diagnostics,
        },
      },
      {
        runId: digest,
        submissionId: "one",
        target: { kind: "binding", id: "review" },
        state: "terminal",
        terminal: { status: "lost", code: "COORDINATOR_LOST", message: "owner replaced" },
      },
    ];
    for (const value of values) {
      expect(() => schema.validate(value, "INVALID_ROOT_ADMINISTRATION")).not.toThrow();
    }
  });

  test("machine definitions reject open and crossed status shapes", () => {
    for (const value of [
      { runId: digest, extra: true },
      {
        runId: digest,
        submissionId: "one",
        target: { kind: "binding", id: "review" },
        state: "pending",
        terminal: { status: "lost", code: "COORDINATOR_LOST", message: "wrong" },
      },
      {
        runId: digest,
        submissionId: "one",
        target: { kind: "binding", id: "review" },
        state: "terminal",
      },
    ]) {
      expect(() => schema.validate(value, "INVALID_ROOT_ADMINISTRATION")).toThrow(SchemaDiagnostic);
    }
  });
});
