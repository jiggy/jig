import { describe, expect, test } from "bun:test";
import Ajv2020 from "ajv/dist/2020.js";

import cases from "./fixtures/messages.json";
import errorRegistry from "../../docs/spec/machine/service-1-errors.json";
import schema from "../../docs/spec/machine/service-1.schema.json";

const ajv = new Ajv2020({ allErrors: true, strict: true });
ajv.addSchema(schema);

describe("Service/1 message schemas", () => {
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

  test("bounds the fixed export set", () => {
    const validate = definition("serviceReadyRequest");
    expect(validate({
      jsonrpc: "2.0",
      id: "provider:1",
      method: "service/ready",
      params: {
        ownerRequestId: "host:1",
        exports: Array.from({ length: 257 }, (_, index) => `export-${index}`),
      },
    })).toBe(false);
  });

  test("keeps the Service and Run operational code sets identical", () => {
    const definition = schema.$defs.flowErrorCode as { enum: string[] };
    expect(definition.enum).toEqual(errorRegistry.wire);
  });

  test("requires readiness ordering as a protocol rule beyond JSON Schema", () => {
    const validate = definition("serviceReadyRequest");
    expect(validate({
      jsonrpc: "2.0",
      id: "provider:1",
      method: "service/ready",
      params: { ownerRequestId: "host:1", exports: ["sessions", "documents"] },
    })).toBe(true);
  });
});

function definition(name: string) {
  const validate = ajv.getSchema(`${schema.$id}#/$defs/${name}`);
  if (!validate) throw new Error(`schema definition not found: ${name}`);
  return validate;
}
