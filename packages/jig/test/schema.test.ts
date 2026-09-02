import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

import type { JsonObject, JsonValue } from "../src/json.js";
import {
  compileEmbeddedSchema,
  compileEmbeddedSchemas,
  compileSchemaFile,
  SCHEMA_1_LIMITS,
  SCHEMA_1_URI,
  SchemaDiagnostic,
} from "../src/schema/index.js";

const encoder = new TextEncoder();

function fileSchema(schema: Record<string, unknown>): Uint8Array {
  return encoder.encode(JSON.stringify({ $schema: SCHEMA_1_URI, ...schema }));
}

function captured(action: () => void): SchemaDiagnostic {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(SchemaDiagnostic);
    return error as SchemaDiagnostic;
  }
  throw new Error("expected SchemaDiagnostic");
}

describe("Schema/1 compilation", () => {
  test("compiles a closed root and rejects unsupported or malformed keywords distinctly", () => {
    const compiled = compileSchemaFile(fileSchema({ type: "string" }), "input.schema.json");
    compiled.validate("yes", "INVALID_INPUT");

    const unsupported = captured(() => compileSchemaFile(
      fileSchema({ format: "email" }),
      "input.schema.json",
    ));
    expect(unsupported.code).toBe("SCHEMA_KEYWORD_UNSUPPORTED");
    expect(unsupported.schemaPointer).toBe("/format");
    expect(unsupported.keyword).toBe("format");

    const malformed = captured(() => compileSchemaFile(
      fileSchema({ minLength: -1 }),
      "input.schema.json",
    ));
    expect(malformed.code).toBe("SCHEMA_INVALID");
    expect(malformed.schemaPointer).toBe("/minLength");

    expect(captured(() => compileSchemaFile(
      fileSchema({ prefixItems: [] }),
      "input.schema.json",
    )).code).toBe("SCHEMA_INVALID");
  });

  test("admits the complete closed keyword inventory", () => {
    const compiled = compileSchemaFile(fileSchema({
      $comment: "inert",
      title: "Number",
      description: "All numeric bounds are deliberate.",
      examples: [2],
      type: ["number", "integer"],
      minimum: 0,
      exclusiveMinimum: -1,
      maximum: 10,
      exclusiveMaximum: 11,
    }), "input.schema.json");
    compiled.validate(2, "INVALID_INPUT");
  });

  test("reserves SCHEMA_INVALID_JSON for the encoded JSON/1 seam", () => {
    const duplicate = encoder.encode(`{"$schema":"${SCHEMA_1_URI}","type":"string","type":"number"}`);
    expect(captured(() => compileSchemaFile(duplicate, "input.schema.json")).code)
      .toBe("SCHEMA_INVALID_JSON");

    expect(captured(() => compileSchemaFile(encoder.encode("true"), "input.schema.json")).code)
      .toBe("SCHEMA_INVALID");
    expect(captured(() => compileSchemaFile(fileSchema({ $schema: "wrong" }), "input.schema.json")).code)
      .toBe("SCHEMA_INVALID");
  });

  test("keeps enum's 2020-12 recommendations non-normative", () => {
    const empty = compileSchemaFile(fileSchema({ enum: [] }), "input.schema.json");
    expect(captured(() => empty.validate("anything", "INVALID_INPUT")).keyword).toBe("enum");

    const duplicate = compileSchemaFile(fileSchema({ enum: ["same", "same"] }), "input.schema.json");
    duplicate.validate("same", "INVALID_INPUT");
  });

  test("accepts only existing, acyclic root-definition references", () => {
    const compiled = compileSchemaFile(fileSchema({
      $defs: {
        Name: { type: "string", minLength: 1 },
      },
      $ref: "#/$defs/Name",
    }), "input.schema.json");
    compiled.validate("Ada", "INVALID_INPUT");

    expect(captured(() => compileSchemaFile(fileSchema({ $ref: "other.json" }), "input.schema.json")).code)
      .toBe("SCHEMA_REFERENCE_INVALID");
    expect(captured(() => compileSchemaFile(fileSchema({ $ref: "#/$defs/Missing" }), "input.schema.json")).code)
      .toBe("SCHEMA_REFERENCE_INVALID");
    expect(captured(() => compileSchemaFile(fileSchema({
      $defs: { "not-safe": true },
    }), "input.schema.json")).code).toBe("SCHEMA_INVALID");
    expect(captured(() => compileSchemaFile(fileSchema({
      $defs: { Safe: true },
      $ref: "#/$defs/%53afe",
    }), "input.schema.json")).code).toBe("SCHEMA_REFERENCE_INVALID");
    const cycle = captured(() => compileSchemaFile(fileSchema({
      $defs: {
        A: { properties: { next: { $ref: "#/$defs/B" } } },
        B: { allOf: [{ $ref: "#/$defs/A" }] },
      },
    }), "input.schema.json"));
    expect(cycle.code).toBe("SCHEMA_REFERENCE_INVALID");
    expect(cycle.keyword).toBe("$ref");
    expect(cycle.schemaPointer.endsWith("/$ref")).toBe(true);
  });

  test("compiles descriptor schemas as one graph with shared root definitions", () => {
    const roots = compileEmbeddedSchemas([
      { pointer: "/methods/read/input", schema: { $ref: "#/$defs/Id" } },
      { pointer: "/methods/read/output", schema: { type: "boolean" } },
    ], {
      path: "contracts/store.capability.json",
      rootDefs: { Id: { type: "string", minLength: 1 } },
    });
    roots.get("/methods/read/input")!.validate("s-1", "INVALID_PARAMS");

    const nested = captured(() => compileEmbeddedSchema({
      $defs: { Local: true },
    }, {
      path: "contracts/store.capability.json",
      rootDefs: {},
      pointer: "/methods/read/input",
    }));
    expect(nested.code).toBe("SCHEMA_INVALID");
    expect(nested.schemaPointer).toBe("/methods/read/input/$defs");
  });

  test("enforces encoded bytes, structural depth, and aggregate node limits", () => {
    const oversized = new Uint8Array(SCHEMA_1_LIMITS.bytes + 1);
    expect(captured(() => compileSchemaFile(oversized, "input.schema.json")).code)
      .toBe("SCHEMA_LIMIT_EXCEEDED");

    let deep: JsonValue = true;
    for (let index = 0; index < SCHEMA_1_LIMITS.depth; index += 1) deep = { not: deep };
    expect(captured(() => compileEmbeddedSchema(deep, { path: "contract.json" })).code)
      .toBe("SCHEMA_LIMIT_EXCEEDED");

    const entries = Array.from({ length: SCHEMA_1_LIMITS.nodes + 1 }, (_, index) => ({
      pointer: `/methods/${index}`,
      schema: true as const,
    }));
    expect(captured(() => compileEmbeddedSchemas(entries, { path: "contract.json" })).code)
      .toBe("SCHEMA_LIMIT_EXCEEDED");
  });
});

describe("Schema/1 evaluation", () => {
  test("evaluates object, array, string, numeric, and conditional keywords", () => {
    const compiled = compileSchemaFile(fileSchema({
      type: "object",
      properties: {
        kind: { enum: ["small", "large"] },
        label: { type: "string", minLength: 2, maxLength: 8 },
        scores: {
          type: "array",
          prefixItems: [{ type: "integer", minimum: 0 }],
          items: { type: "number", exclusiveMaximum: 10 },
          contains: { const: 5 },
          minContains: 1,
          maxContains: 2,
          minItems: 2,
          maxItems: 4,
        },
      },
      required: ["kind", "label", "scores"],
      additionalProperties: false,
      dependentRequired: { kind: ["label"] },
      dependentSchemas: { scores: { properties: { kind: { const: "small" } } } },
      if: { properties: { kind: { const: "small" } }, required: ["kind"] },
      then: { maxProperties: 3 },
      else: { minProperties: 4 },
      minProperties: 3,
      maxProperties: 4,
    }), "input.schema.json");

    compiled.validate({ kind: "small", label: "ok", scores: [1, 5] }, "INVALID_INPUT");
    const error = captured(() => compiled.validate(
      { kind: "small", label: "x", scores: [1, 11], extra: true },
      "INVALID_INPUT",
    ));
    expect(error.code).toBe("INVALID_INPUT");
    expect(error.instancePointer).not.toBeUndefined();
    expect(error.schemaPointer.startsWith("/")).toBe(true);
  });

  test("evaluates every combinator branch and preserves false-schema locations", () => {
    const compiled = compileSchemaFile(fileSchema({
      allOf: [{ type: "number" }, { minimum: 1 }],
      anyOf: [{ const: 2 }, { const: 3 }],
      oneOf: [{ type: "integer" }, { const: 2 }],
      not: { const: 4 },
    }), "input.schema.json");
    compiled.validate(3, "INVALID_INPUT");
    expect(captured(() => compiled.validate(2, "INVALID_INPUT")).keyword).toBe("oneOf");

    const closed = compileSchemaFile(fileSchema({
      type: "object",
      properties: { okay: true },
      additionalProperties: false,
    }), "input.schema.json");
    const extra = captured(() => closed.validate({ extra: 1 }, "INVALID_INPUT"));
    expect(extra.schemaPointer).toBe("/additionalProperties");
    expect(extra.instancePointer).toBe("/extra");
  });

  test("uses Unicode scalar length", () => {
    const compiled = compileSchemaFile(fileSchema({ type: "string", minLength: 1, maxLength: 1 }), "input.schema.json");
    compiled.validate("😀", "INVALID_INPUT");
    expect(captured(() => compiled.validate("😀a", "INVALID_INPUT")).keyword).toBe("maxLength");
  });

  test("reports work exhaustion before returning a validation result", () => {
    const compiled = compileSchemaFile(fileSchema({ type: "string", maxLength: 2_000_000 }), "input.schema.json");
    const error = captured(() => compiled.validate("x".repeat(1_000_001), "INVALID_INPUT"));
    expect(error.code).toBe("SCHEMA_LIMIT_EXCEEDED");

    const exact = compileSchemaFile(fileSchema({ maxLength: 2_000_000 }), "input.schema.json");
    exact.validate("x".repeat(999_998), "INVALID_INPUT");
  });

  test("memoizes each schema-pointer and instance-pointer pair", () => {
    const compiled = compileSchemaFile(fileSchema({
      $defs: {
        Long: { maxLength: 1_000_000 },
      },
      allOf: [
        { $ref: "#/$defs/Long" },
        { $ref: "#/$defs/Long" },
      ],
    }), "input.schema.json");
    // Evaluating Long twice would exceed the meter; the normative pair cache
    // charges its length work only once.
    compiled.validate("x".repeat(600_000), "INVALID_INPUT");
  });

  test("rejects non-JSON/1 instances using the requested boundary code", () => {
    const compiled = compileSchemaFile(fileSchema({ type: "number" }), "settings.schema.json");
    const error = captured(() => compiled.validate(Number.NaN, "INVALID_SETTINGS"));
    expect(error.code).toBe("INVALID_SETTINGS");
    expect(error.instancePointer).toBe("");
  });
});

test("published Schema/1 meta-schema has the canonical identity", async () => {
  const url = new URL(
    "../../../docs/flow/spec/machine/schema-1.json",
    import.meta.url,
  );
  const value = JSON.parse(await readFile(url, "utf8")) as JsonObject;
  expect(value.$id).toBe(SCHEMA_1_URI);
  expect(value.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
});
