import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

import {
  ProjectAdministrationError,
  normalizeProjectApplyRequest,
  normalizeProjectPlanRequest,
} from "../src/administration/project.js";
import { compileSchemaFile, SchemaDiagnostic } from "../src/schema/index.js";

const digest = `sha256:${"a".repeat(64)}`;
const schema = compileSchemaFile(await readFile(new URL(
  "../../../docs/spec/machine/project-administration-1.schema.json",
  import.meta.url,
)), "project-administration-1.schema.json");

describe("project administration candidate values", () => {
  test("normalizes only the two closed requests", () => {
    expect(normalizeProjectPlanRequest({ lockMode: "update" })).toEqual({ lockMode: "update" });
    expect(normalizeProjectPlanRequest({ lockMode: "locked" })).toEqual({ lockMode: "locked" });
    expect(normalizeProjectApplyRequest({ planDigest: digest })).toEqual({
      planDigest: digest,
    });
    for (const value of [null, {}, { lockMode: "other" }, { lockMode: "update", extra: true }]) {
      expect(() => normalizeProjectPlanRequest(value)).toThrow(ProjectAdministrationError);
    }
    for (const value of [{}, { planDigest: "plan-1" }, {
      planDigest: `sha256:${"a".repeat(64)}`,
      extra: true,
    }]) {
      expect(() => normalizeProjectApplyRequest(value)).toThrow(ProjectAdministrationError);
    }
  });

  test("does not invoke accessors while rejecting a request", () => {
    let reads = 0;
    expect(() => normalizeProjectPlanRequest({
      get lockMode() {
        reads += 1;
        return "update";
      },
    })).toThrow(ProjectAdministrationError);
    expect(reads).toBe(0);

    const trapped = new Proxy({}, {
      getPrototypeOf(): never { throw new Error("prototype trap ran"); },
      ownKeys(): never { throw new Error("key trap ran"); },
      getOwnPropertyDescriptor(): never { throw new Error("descriptor trap ran"); },
    });
    expect(() => normalizeProjectPlanRequest(trapped)).toThrow(ProjectAdministrationError);
  });

  test("projects one closed error without an implementation details bag", () => {
    const error = new ProjectAdministrationError("PROJECT_BUSY", "project is busy");
    expect(error.toJSON()).toEqual({ code: "PROJECT_BUSY", message: "project is busy" });
    expect(Object.keys(error.toJSON())).toEqual(["code", "message"]);
    expect(() => new ProjectAdministrationError("OTHER" as never, "bad")).toThrow(TypeError);
    expect(() => new ProjectAdministrationError("INTERNAL", "\ud800")).toThrow(TypeError);
    expect(() => new ProjectAdministrationError("INTERNAL", "\udc00")).toThrow(TypeError);
    expect(new ProjectAdministrationError("INTERNAL", "😀".repeat(1_024)).message)
      .toBe("😀".repeat(1_024));
  });

  test("machine definitions admit every public value branch", () => {
    for (const value of [
      { lockMode: "update" },
      { state: "unchanged" },
      {
        state: "applicable",
        operation: "admission",
        planDigest: digest,
        review: { mediaType: "text/plain; charset=utf-8", text: "review" },
      },
      { planDigest: digest },
      { operation: "admission", planDigest: digest },
      { operation: "lock-repair", planDigest: digest },
      new ProjectAdministrationError("STALE_PLAN", "stale").toJSON(),
    ]) {
      expect(() => schema.validate(value, "INVALID_PROJECT_ADMINISTRATION")).not.toThrow();
    }
  });

  test("machine definitions reject crossed and open values", () => {
    for (const value of [
      { lockMode: "update", extra: true },
      { state: "unchanged", planDigest: digest },
      { state: "applicable", operation: "admission", planDigest: digest },
      { operation: "lock-repair", planDigest: digest, receiptDigest: digest },
      { code: "STALE_PLAN", message: "stale", details: {} },
    ]) {
      expect(() => schema.validate(value, "INVALID_PROJECT_ADMINISTRATION"))
        .toThrow(SchemaDiagnostic);
    }
  });

  test("applies the digest grammar after Schema/1 structural validation", () => {
    const sameLengthInvalid = `sha256:${"g".repeat(64)}`;
    expect(() => schema.validate(
      { planDigest: sameLengthInvalid },
      "INVALID_PROJECT_ADMINISTRATION",
    )).not.toThrow();
    expect(() => normalizeProjectApplyRequest({ planDigest: sameLengthInvalid }))
      .toThrow(ProjectAdministrationError);
  });
});
