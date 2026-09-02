import { describe, expect, test } from "bun:test";
import Ajv2020 from "ajv/dist/2020.js";

import cases from "./fixtures/messages.json";
import errorRegistry from "../../docs/flow/spec/machine/run-1-errors.json";
import schema from "../../docs/flow/spec/machine/run-1.schema.json";

const ajv = new Ajv2020({ allErrors: true, strict: true });
ajv.addSchema(schema);

describe("Run/1 message schemas", () => {
  for (const fixture of cases.valid) {
    test(`accepts ${fixture.name}`, () => {
      const validate = definition(fixture.definition);
      expect(validate(fixture.value), JSON.stringify(validate.errors)).toBe(true);
    });
  }

  for (const fixture of cases.invalid) {
    test(`rejects ${fixture.name}`, () => {
      const validate = definition(fixture.definition);
      expect(validate(fixture.value)).toBe(false);
    });
  }

  test("enforces the fixed attachment bound", () => {
    const validate = definition("flowRunRequest");
    const attachments = Object.fromEntries(
      Array.from({ length: 257 }, (_, index) => [
        `a-${index}`,
        { path: `/a/${index}`, access: "read" },
      ]),
    );
    expect(
      validate({
        jsonrpc: "2.0",
        id: "host:1",
        method: "flow/run",
        params: {
          protocol: "run/1",
          input: null,
          settings: {},
          attachments,
          scratch: "/tmp",
          deadlineUnixMs: 0,
        },
      }),
    ).toBe(false);
  });

  test("enforces the error-message scalar bound", () => {
    const validate = definition("flowErrorResponse");
    expect(
      validate({
        jsonrpc: "2.0",
        id: "host:1",
        error: {
          code: -32000,
          message: "x".repeat(1_025),
          data: { code: "EXECUTION_FAILED" },
        },
      }),
    ).toBe(false);
  });

  test("requires null only for parse errors", () => {
    const validate = definition("standardErrorResponse");
    expect(validate(standardError(-32700, "host:1"))).toBe(false);
    expect(validate(standardError(-32602, null))).toBe(false);
    expect(validate(standardError(-32700, null))).toBe(true);
    expect(validate(standardError(-32602, "host:1"))).toBe(true);
  });

  test("keeps the schema and error registry code sets identical", () => {
    const definition = schema.$defs.flowErrorCode as { enum: string[] };
    expect(definition.enum).toEqual(errorRegistry.wire);
  });
});

function standardError(code: number, id: string | null) {
  return {
    jsonrpc: "2.0",
    id,
    error: { code, message: "error" },
  };
}

function definition(name: string) {
  const validate = ajv.getSchema(`${schema.$id}#/$defs/${name}`);
  if (!validate) throw new Error(`schema definition not found: ${name}`);
  return validate;
}
