import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { readdir } from "node:fs/promises";
import { resolve } from "node:path";

import {
  CAPABILITY_CONTRACT_LIMITS,
  CAPABILITY_CONTRACT_SCHEMA,
  parseCapabilityContract,
  type CapabilityContractDescriptor,
} from "../src/capability/index.js";
import { CheckError } from "../src/diagnostics.js";
import { canonicalJson, decodeJson1 } from "../src/json.js";
import { SchemaDiagnostic } from "../src/schema/index.js";

const encoder = new TextEncoder();
const examplePath = resolve(
  import.meta.dir,
  "../../../docs/spec/examples/capability-contracts/session-store.capability.json",
);

function descriptor(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    $schema: CAPABILITY_CONTRACT_SCHEMA,
    flowCapabilityContract: 1,
    id: "https://example.org/contracts/example",
    version: "1.0.0",
    methods: {
      call: {
        input: true,
        output: true,
        errors: {},
      },
    },
    ...overrides,
  };
}

function bytes(value: unknown): Uint8Array {
  return encoder.encode(JSON.stringify(value));
}

function expectCapabilityError(value: Uint8Array, code: string): void {
  try {
    parseCapabilityContract(value, "contract.json");
    throw new Error("expected descriptor rejection");
  } catch (error) {
    expect(error).toBeInstanceOf(CheckError);
    expect((error as CheckError).code).toBe(code);
    expect((error as CheckError).path).toBe("contract.json");
  }
}

describe("Capability Contract/1", () => {
  test("parses and compiles the normative descriptor with its exact digest", async () => {
    const source = new Uint8Array(await readFile(examplePath));
    const parsed = parseCapabilityContract(source, "session-store.capability.json");

    expect(parsed.descriptor.id).toBe("https://example.org/contracts/session-store");
    expect(parsed.descriptor.version).toBe("1.0.0");
    expect(parsed.digest).toBe(
      "sha256:a8273fd117aa2f2aa8ee8805c0d598b3e1f3bad9036d368d8847bd41513158c5",
    );
    expect([...parsed.schemas.keys()].sort()).toEqual([
      "/methods/read/errors/not-found",
      "/methods/read/input",
      "/methods/read/output",
    ]);

    parsed.schemas.get("/methods/read/input")!.validate({ sessionId: "s-1" }, "INVALID_INPUT");
    expect(() =>
      parsed.schemas.get("/methods/read/input")!.validate({}, "INVALID_INPUT")
    ).toThrow(SchemaDiagnostic);
  });

  test("accepts every published Jig capability descriptor", async () => {
    const directory = resolve(import.meta.dir, "../../../docs/spec/contracts/jig");
    const names = (await readdir(directory)).filter((name) => name.endsWith(".capability.json"));
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      const parsed = parseCapabilityContract(
        new Uint8Array(await readFile(resolve(directory, name))),
        name,
      );
      expect(parsed.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    }
  });

  test("digests parsed values rather than source formatting", () => {
    const compact = bytes(descriptor());
    const spaced = encoder.encode(`${JSON.stringify(descriptor(), null, 2)}\n`);
    expect(parseCapabilityContract(compact).digest).toBe(parseCapabilityContract(spaced).digest);

    const canonical = canonicalJson(decodeJson1(compact));
    const undomained = `sha256:${createHash("sha256").update(canonical).digest("hex")}`;
    expect(parseCapabilityContract(compact).digest).not.toBe(undomained);
  });

  test("any descriptor value, including an annotation, changes identity", () => {
    const base = descriptor({
      methods: { call: { input: { type: "string" }, output: true, errors: {} } },
    });
    const annotated = descriptor({
      methods: {
        call: {
          input: { type: "string", description: "input text" },
          output: true,
          errors: {},
        },
      },
    });
    expect(parseCapabilityContract(bytes(base)).digest).not.toBe(
      parseCapabilityContract(bytes(annotated)).digest,
    );
  });

  test("accepts the restricted canonical ID and stable SemVer core", () => {
    const id = `https://${"a".repeat(63)}.example.org/a_b.c~d-/v1`;
    const parsed = parseCapabilityContract(bytes(descriptor({ id, version: "0.10.203" })));
    expect(parsed.descriptor.id).toBe(id);
    expect(parsed.descriptor.version).toBe("0.10.203");
  });

  test.each([
    "http://example.org/contracts/x",
    "https://localhost/contracts/x",
    "https://Example.org/contracts/x",
    "https://example.org:443/contracts/x",
    "https://user@example.org/contracts/x",
    "https://127.0.0.1/contracts/x",
    "https://127.000.0.1/contracts/x",
    "https://example.org/contracts//x",
    "https://example.org/contracts/./x",
    "https://example.org/contracts/../x",
    "https://example.org/contracts/x%20y",
    "https://example.org/contracts/x?version=1",
    "https://example.org/contracts/x#fragment",
  ])("rejects noncanonical contract ID %s", (id) => {
    expectCapabilityError(bytes(descriptor({ id })), "CAPABILITY_ID");
  });

  test.each(["1", "v1.0.0", "01.0.0", "1.01.0", "1.0.01", "1.0.0-rc.1", "1.0.0+x"])(
    "rejects non-core version %s",
    (version) => {
      expectCapabilityError(bytes(descriptor({ version })), "CAPABILITY_VERSION");
    },
  );

  test("rejects unknown and missing descriptor or method fields", () => {
    expectCapabilityError(bytes(descriptor({ surprise: true })), "CAPABILITY_FIELD");
    const missingVersion = descriptor();
    delete missingVersion.version;
    expectCapabilityError(bytes(missingVersion), "CAPABILITY_VERSION");
    expectCapabilityError(
      bytes(descriptor({ methods: { call: { input: true, output: true, errors: {}, extra: 1 } } })),
      "CAPABILITY_FIELD",
    );
    expectCapabilityError(
      bytes(descriptor({ methods: { call: { input: true, output: true } } })),
      "CAPABILITY_METHOD",
    );
  });

  test("enforces names and descriptor collection bounds", () => {
    expectCapabilityError(
      bytes(descriptor({ methods: { BadName: { input: true, output: true, errors: {} } } })),
      "CAPABILITY_LOCAL_NAME",
    );
    expectCapabilityError(bytes(descriptor({ methods: {} })), "CAPABILITY_LIMIT");

    const methods: Record<string, unknown> = {};
    for (let index = 0; index <= CAPABILITY_CONTRACT_LIMITS.methods; index += 1) {
      methods[`m-${index}`] = { input: true, output: true, errors: {} };
    }
    expectCapabilityError(bytes(descriptor({ methods })), "CAPABILITY_LIMIT");

    const errors: Record<string, true> = {};
    for (let index = 0; index <= CAPABILITY_CONTRACT_LIMITS.errorsPerMethod; index += 1) {
      errors[`e-${index}`] = true;
    }
    expectCapabilityError(
      bytes(descriptor({ methods: { call: { input: true, output: true, errors } } })),
      "CAPABILITY_LIMIT",
    );

    const definitions: Record<string, true> = {};
    for (let index = 0; index <= CAPABILITY_CONTRACT_LIMITS.definitions; index += 1) {
      definitions[`D${index}`] = true;
    }
    expectCapabilityError(bytes(descriptor({ $defs: definitions })), "CAPABILITY_LIMIT");
  });

  test("rejects descriptors above the dedicated byte ceiling before parsing", () => {
    expectCapabilityError(
      new Uint8Array(CAPABILITY_CONTRACT_LIMITS.bytes + 1),
      "CAPABILITY_LIMIT",
    );
  });

  test("preserves JSON/1 duplicate-member and BOM rejection", () => {
    const duplicate = encoder.encode(
      '{"$schema":"https://flow.dev/schemas/capability-contract-1.schema.json",' +
        '"flowCapabilityContract":1,"id":"https://example.org/contracts/x",' +
        '"version":"1.0.0","version":"2.0.0","methods":{}}',
    );
    expectCapabilityError(duplicate, "CAPABILITY_INVALID_JSON");
    expectCapabilityError(Uint8Array.of(0xef, 0xbb, 0xbf, 0x7b, 0x7d), "CAPABILITY_INVALID_JSON");
  });

  test("accepts boolean schemas and shares descriptor-root definitions", () => {
    const parsed = parseCapabilityContract(bytes(descriptor({
      methods: {
        call: {
          input: { $ref: "#/$defs/Input" },
          output: false,
          errors: { unavailable: true },
        },
      },
      $defs: {
        Input: { type: "string", minLength: 1 },
      },
    })));
    parsed.schemas.get("/methods/call/input")!.validate("ok", "INVALID_INPUT");
    expect(() => parsed.schemas.get("/methods/call/input")!.validate("", "INVALID_INPUT"))
      .toThrow(SchemaDiagnostic);
    expect(() => parsed.schemas.get("/methods/call/output")!.validate(null, "INVALID_RESULT"))
      .toThrow(SchemaDiagnostic);
  });

  test("does not turn JSON Schema enum recommendations into extra contract rules", () => {
    const parsed = parseCapabilityContract(bytes(descriptor({
      methods: {
        call: {
          input: { enum: [] },
          output: { enum: ["same", "same"] },
          errors: {},
        },
      },
    })));
    expect(() => parsed.schemas.get("/methods/call/input")!.validate(null, "INVALID_INPUT"))
      .toThrow(SchemaDiagnostic);
    parsed.schemas.get("/methods/call/output")!.validate("same", "INVALID_RESULT");
  });

  test("rejects unresolved references and nested definitions", () => {
    expect(() => parseCapabilityContract(bytes(descriptor({
      methods: { call: { input: { $ref: "#/$defs/Missing" }, output: true, errors: {} } },
    })), "contract.json")).toThrow(SchemaDiagnostic);

    expect(() => parseCapabilityContract(bytes(descriptor({
      methods: {
        call: {
          input: { $defs: { Nested: true }, $ref: "#/$defs/Nested" },
          output: true,
          errors: {},
        },
      },
    })), "contract.json")).toThrow(SchemaDiagnostic);
  });

  test("applies Schema/1 graph limits across all method roots together", () => {
    const methods: Record<string, unknown> = {};
    for (let index = 0; index < CAPABILITY_CONTRACT_LIMITS.methods; index += 1) {
      methods[`m-${index}`] = {
        input: { allOf: Array.from({ length: 16 }, () => true) },
        output: true,
        errors: {},
      };
    }
    expect(() => parseCapabilityContract(bytes(descriptor({ methods })), "large.capability.json"))
      .toThrow(SchemaDiagnostic);
  });

  test("returns an immutable descriptor", () => {
    const parsed = parseCapabilityContract(bytes(descriptor())) as {
      descriptor: CapabilityContractDescriptor;
    };
    expect(Object.isFrozen(parsed.descriptor)).toBe(true);
    expect(Object.isFrozen(parsed.descriptor.methods)).toBe(true);
    expect(Object.isFrozen(parsed.descriptor.methods.call)).toBe(true);
  });

  test("publishes a machine schema whose local-reference pattern accepts Schema/1 refs", async () => {
    const machinePath = resolve(
      import.meta.dir,
      "../../../docs/spec/machine/capability-contract-1.schema.json",
    );
    const machine = JSON.parse(await readFile(machinePath, "utf8")) as {
      $defs: {
        schemaObject: {
          properties: {
            $ref: { pattern: string };
          };
        };
      };
    };
    const reference = new RegExp(machine.$defs.schemaObject.properties.$ref.pattern);
    expect(reference.test("#/$defs/Shared1")).toBe(true);
    expect(reference.test("#/definitions/Shared1")).toBe(false);
  });
});
