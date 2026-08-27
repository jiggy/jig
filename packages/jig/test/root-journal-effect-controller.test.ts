import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

import { parseCapabilityContract } from "../src/capability/index.js";
import type { InspectedPackage } from "../src/package/inspect.js";
import type { PrivateProjectLocalLock } from "../src/internal/project-local-lock.js";
import { requirePrivateCanonicalJournalEffectContext } from "../src/internal/root-journal-effect-controller.js";
import type { PrivateActivationRequest } from "../src/project/package-resolution.js";
import { PRIVATE_CANONICAL_JOURNAL_CONTRACT } from "../src/project/package-project.js";
import { SchemaDiagnostic } from "../src/schema/index.js";

const packageDigest = `sha256:${"1".repeat(64)}`;
const contract = parseCapabilityContract(await readFile(new URL(
  "../../../docs/spec/contracts/jig/journal.capability.json",
  import.meta.url,
)), "contracts/journal.capability.json");

describe("private root Journal effect resolution", () => {
  test("resolves only the exact pinned Journal slot and protected descriptor", () => {
    const context = requirePrivateCanonicalJournalEffectContext(fixture());
    expect(context.publisherBinding).toBe("publisher");
    expect(context.eventTypes).toEqual(["https://example.org/events/item-created"]);
    expect(() => context.inputSchema.validate({
      type: "https://example.org/events/item-created",
      data: { item: 1 },
    }, "INVALID_INPUT")).not.toThrow();
    expect(() => context.outputSchema.validate({ bad: true }, "INVALID_RESULT"))
      .toThrow(SchemaDiagnostic);
  });

  test("rejects unknown methods and slot/provider/contract drift as unavailable", () => {
    expect(() => requirePrivateCanonicalJournalEffectContext(fixture({ method: "query" })))
      .toThrow(expect.objectContaining({ code: "UNAVAILABLE" }));
    expect(() => requirePrivateCanonicalJournalEffectContext(fixture({ providerExport: "other" })))
      .toThrow(expect.objectContaining({ code: "UNAVAILABLE" }));
    expect(() => requirePrivateCanonicalJournalEffectContext(fixture({ descriptorDigest: `sha256:${"2".repeat(64)}` })))
      .toThrow(expect.objectContaining({ code: "UNAVAILABLE" }));
  });

  test("keeps application schema failure distinct from the Run/1 envelope", () => {
    const context = requirePrivateCanonicalJournalEffectContext(fixture());
    expect(() => context.inputSchema.validate({ data: null }, "INVALID_INPUT"))
      .toThrow(expect.objectContaining({ code: "INVALID_INPUT" }));
  });
});

function fixture(overrides: {
  readonly method?: string;
  readonly providerExport?: string;
  readonly descriptorDigest?: string;
} = {}): Parameters<typeof requirePrivateCanonicalJournalEffectContext>[0] {
  const identity = PRIVATE_CANONICAL_JOURNAL_CONTRACT;
  const request = {
    packagePath: "flows/producer",
    package: { digest: packageDigest },
    slots: {
      journal: {
        kind: "capability",
        contract: identity,
        provider: { binding: "publisher", export: overrides.providerExport ?? "journal" },
      },
    },
  } as unknown as PrivateActivationRequest;
  const lock = {
    packages: {
      "flows/producer": {
        uses: { journal: { kind: "contract", ...identity } },
      },
    },
    journalPublishers: {
      publisher: {
        source: "binding:publisher",
        contract: identity,
        eventTypes: ["https://example.org/events/item-created"],
      },
    },
  } as unknown as PrivateProjectLocalLock;
  const inspected = {
    digest: packageDigest,
    usedContracts: [{
      slot: "journal",
      path: "contracts/journal.capability.json",
      contract: overrides.descriptorDigest === undefined
        ? contract
        : { ...contract, digest: overrides.descriptorDigest },
    }],
  } as unknown as InspectedPackage;
  return {
    request,
    lock,
    inspected,
    call: {
      operationId: "publish-1",
      slot: "journal",
      method: overrides.method ?? "append",
      input: { type: "https://example.org/events/item-created", data: {} },
    },
  };
}
