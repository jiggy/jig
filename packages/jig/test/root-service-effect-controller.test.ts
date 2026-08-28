import { describe, expect, test } from "bun:test";

import {
  CAPABILITY_CONTRACT_SCHEMA,
  parseCapabilityContract,
} from "../src/capability/index.js";
import type { InspectedPackage } from "../src/package/inspect.js";
import type { PrivateProjectLocalLock } from "../src/internal/project-local-lock.js";
import { requirePrivateServiceEffectContext } from "../src/internal/root-service-effect-controller.js";
import type { PrivateActivationRequest } from "../src/project/package-resolution.js";
import { SchemaDiagnostic } from "../src/schema/index.js";

const packageDigest = `sha256:${"1".repeat(64)}`;
const parsed = parseCapabilityContract(new TextEncoder().encode(JSON.stringify({
  $schema: CAPABILITY_CONTRACT_SCHEMA,
  flowCapabilityContract: 1,
  id: "https://example.org/contracts/counter",
  version: "1.0.0",
  methods: {
    next: {
      input: {
        type: "object",
        properties: { by: { type: "integer", minimum: 1 } },
        required: ["by"],
        additionalProperties: false,
      },
      output: { type: "integer", minimum: 1 },
      errors: {
        exhausted: {
          type: "object",
          properties: { limit: { type: "integer" } },
          required: ["limit"],
          additionalProperties: false,
        },
      },
    },
  },
})), "contracts/counter.capability.json");
const identity = Object.freeze({
  id: parsed.descriptor.id,
  version: parsed.descriptor.version,
  digest: parsed.digest,
});

describe("private root Service effect resolution", () => {
  test("resolves one exact pinned Service contract, export, method, and schemas", () => {
    const context = requirePrivateServiceEffectContext(fixture());
    expect(context.providerBinding).toBe("counter-service");
    expect(context.providerExport).toBe("counter");
    expect(context.contract).toEqual(identity);
    expect(() => context.inputSchema.validate({ by: 1 }, "INVALID_INPUT")).not.toThrow();
    expect(() => context.inputSchema.validate({ by: 0 }, "INVALID_INPUT"))
      .toThrow(SchemaDiagnostic);
    expect(() => context.outputSchema.validate(2, "INVALID_RESULT")).not.toThrow();
    expect(() => context.errorSchemas.get("exhausted")!.validate({ limit: 4 }, "INVALID_RESULT"))
      .not.toThrow();
  });

  test("rejects unknown methods and contract drift before Provider dispatch", () => {
    expect(() => requirePrivateServiceEffectContext(fixture({ method: "reset" })))
      .toThrow(expect.objectContaining({ code: "UNAVAILABLE" }));
    expect(() => requirePrivateServiceEffectContext(fixture({ requestDigest: `sha256:${"2".repeat(64)}` })))
      .toThrow(expect.objectContaining({ code: "UNAVAILABLE" }));
    expect(() => requirePrivateServiceEffectContext(fixture({ inspectedDigest: `sha256:${"3".repeat(64)}` })))
      .toThrow(expect.objectContaining({ code: "UNAVAILABLE" }));
  });

  test("does not reserve an export name outside the canonical Journal identity", () => {
    expect(requirePrivateServiceEffectContext(fixture({ providerExport: "journal" })).providerExport)
      .toBe("journal");
  });
});

function fixture(overrides: {
  readonly method?: string;
  readonly providerExport?: string;
  readonly requestDigest?: string;
  readonly inspectedDigest?: string;
} = {}): Parameters<typeof requirePrivateServiceEffectContext>[0] {
  const requestIdentity = {
    ...identity,
    ...(overrides.requestDigest === undefined ? {} : { digest: overrides.requestDigest }),
  };
  const request = {
    packagePath: "flows/consumer",
    package: { digest: packageDigest },
    slots: {
      counter: {
        kind: "capability",
        contract: requestIdentity,
        provider: {
          binding: "counter-service",
          export: overrides.providerExport ?? "counter",
        },
      },
    },
  } as unknown as PrivateActivationRequest;
  const lock = {
    packages: {
      "flows/consumer": {
        uses: { counter: { kind: "contract", ...identity } },
      },
    },
  } as unknown as PrivateProjectLocalLock;
  const inspected = {
    digest: packageDigest,
    usedContracts: [{
      slot: "counter",
      path: "contracts/counter.capability.json",
      contract: overrides.inspectedDigest === undefined
        ? parsed
        : { ...parsed, digest: overrides.inspectedDigest },
    }],
  } as unknown as InspectedPackage;
  return {
    request,
    lock,
    inspected,
    call: {
      operationId: "counter-1",
      slot: "counter",
      method: overrides.method ?? "next",
      input: { by: 1 },
    },
  };
}
