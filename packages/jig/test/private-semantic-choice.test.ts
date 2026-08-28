import { beforeAll, describe, expect, test } from "bun:test";

import { parseCapabilityContract, type ParsedCapabilityContract } from "../src/capability/index.js";
import {
  PrivateSemanticChoiceError,
  choosePrivateSemanticCandidate,
  type PrivateSemanticChoiceRequest,
} from "../src/internal/private-semantic-choice.js";

let contract: ParsedCapabilityContract;

beforeAll(async () => {
  contract = parseCapabilityContract(
    await Bun.file(new URL(
      "../../../docs/spec/contracts/jig/semantic-choice.capability.json",
      import.meta.url,
    )).bytes(),
    "semantic-choice.capability.json",
  );
});

describe("private deterministic Semantic Choice", () => {
  test("selects only from the exact frozen candidate order", () => {
    const source = request();
    let seen: PrivateSemanticChoiceRequest | undefined;
    const result = choosePrivateSemanticCandidate({
      contract,
      request: source,
      choose(value) {
        seen = value;
        source.context.ticket = "mutated";
        source.candidates.reverse();
        expect(value.context).toEqual({ ticket: "T-1", labels: ["feature"] });
        expect(value.candidates.map((candidate) => candidate.id)).toEqual(["gauntlet", "vote"]);
        expect(Object.isFrozen(value)).toBe(true);
        expect(Object.isFrozen(value.context)).toBe(true);
        expect(Object.isFrozen(value.candidates)).toBe(true);
        return { status: "selected", candidateId: "vote", rationale: "two reviews" };
      },
    });

    expect(result).toEqual({ status: "selected", candidateId: "vote", rationale: "two reviews" });
    expect(Object.isFrozen(result)).toBe(true);
    expect(seen).toBeDefined();
  });

  test("preserves abstention without selecting a fallback", () => {
    expect(choosePrivateSemanticCandidate({
      contract,
      request: request(),
      choose: () => ({ status: "abstain", rationale: "insufficient distinction" }),
    })).toEqual({ status: "abstain", rationale: "insufficient distinction" });
    expect(choosePrivateSemanticCandidate({
      contract,
      request: request(),
      choose: () => ({ status: "abstain" }),
    })).toEqual({ status: "abstain" });
  });

  test("rejects duplicate IDs before invoking the chooser", () => {
    let calls = 0;
    expect(() => choosePrivateSemanticCandidate({
      contract,
      request: {
        objective: "choose",
        context: null,
        candidates: [
          { id: "same", description: "first" },
          { id: "same", description: "second" },
        ],
      },
      choose: () => {
        calls += 1;
        return { status: "abstain" };
      },
    })).toThrow(expect.objectContaining({ code: "SEMANTIC_CHOICE_DUPLICATE_CANDIDATE" }));
    expect(calls).toBe(0);
  });

  test("treats IDs as opaque exact strings", () => {
    const ids = ["A", "a", "é", "e\u0301"];
    expect(choosePrivateSemanticCandidate({
      contract,
      request: {
        objective: "choose exact ID",
        context: null,
        candidates: ids.map((id) => ({ id, description: id })),
      },
      choose: (value) => ({ status: "selected", candidateId: value.candidates[3]!.id }),
    })).toEqual({ status: "selected", candidateId: "e\u0301" });
  });

  test("rejects an unknown selected ID", () => {
    expect(() => choosePrivateSemanticCandidate({
      contract,
      request: request(),
      choose: () => ({ status: "selected", candidateId: "invented" }),
    })).toThrow(expect.objectContaining({ code: "SEMANTIC_CHOICE_UNKNOWN_CANDIDATE" }));
  });

  test("enforces the exact two-to-256 portable request bound", () => {
    for (const candidates of [
      [{ id: "only", description: "one" }],
      Array.from({ length: 257 }, (_, index) => ({ id: `c-${index}`, description: "candidate" })),
    ]) {
      let calls = 0;
      expect(() => choosePrivateSemanticCandidate({
        contract,
        request: { objective: "choose", context: null, candidates },
        choose: () => {
          calls += 1;
          return { status: "abstain" };
        },
      })).toThrow(expect.objectContaining({ code: "SEMANTIC_CHOICE_INPUT_INVALID" }));
      expect(calls).toBe(0);
    }
  });

  test("rejects malformed results and asynchronous callbacks", () => {
    for (const output of [
      { status: "selected" },
      { status: "abstain", extra: true },
      Promise.resolve({ status: "abstain" }),
    ]) {
      expect(() => choosePrivateSemanticCandidate({
        contract,
        request: request(),
        choose: () => output,
      })).toThrow();
    }
  });

  test("rejects accessors and proxies before or after chooser work", () => {
    let inputCalls = 0;
    const accessor = request() as unknown as Record<string, unknown>;
    Object.defineProperty(accessor, "objective", {
      enumerable: true,
      get() {
        throw new Error("must not execute");
      },
    });
    expect(() => choosePrivateSemanticCandidate({
      contract,
      request: accessor,
      choose: () => {
        inputCalls += 1;
        return { status: "abstain" };
      },
    })).toThrow(expect.objectContaining({ code: "SEMANTIC_CHOICE_JSON_INVALID" }));
    expect(inputCalls).toBe(0);

    expect(() => choosePrivateSemanticCandidate({
      contract,
      request: request(),
      choose: () => new Proxy({ status: "abstain" }, {}),
    })).toThrow(expect.objectContaining({ code: "SEMANTIC_CHOICE_JSON_INVALID" }));

    const output = {} as Record<string, unknown>;
    Object.defineProperty(output, "status", {
      enumerable: true,
      get() {
        throw new Error("must not execute");
      },
    });
    expect(() => choosePrivateSemanticCandidate({
      contract,
      request: request(),
      choose: () => output,
    })).toThrow(expect.objectContaining({ code: "SEMANTIC_CHOICE_JSON_INVALID" }));
  });

  test("maps JSON/1 primitive failures to the private boundary", () => {
    const value = request();
    (value.context as { score?: number }).score = Number.NaN;
    let calls = 0;
    expect(() => choosePrivateSemanticCandidate({
      contract,
      request: value,
      choose: () => {
        calls += 1;
        return { status: "abstain" };
      },
    })).toThrow(expect.objectContaining({ code: "SEMANTIC_CHOICE_JSON_INVALID" }));
    expect(calls).toBe(0);
  });

  test("reparses the canonical descriptor and ignores forged schema maps", () => {
    const forgedSchemas = new Map(contract.schemas);
    forgedSchemas.set("/methods/choose/input", { path: "forged", schemaPointer: "", validate() {} });
    forgedSchemas.set("/methods/choose/output", { path: "forged", schemaPointer: "", validate() {} });
    const forged = { ...contract, schemas: forgedSchemas } as ParsedCapabilityContract;
    expect(() => choosePrivateSemanticCandidate({
      contract: forged,
      request: { objective: "invalid", context: null, candidates: [] },
      choose: () => ({ status: "selected", candidateId: "invented" }),
    })).toThrow(expect.objectContaining({ code: "SEMANTIC_CHOICE_INPUT_INVALID" }));

    const changed = structuredClone(contract.descriptor);
    changed.version = "1.0.1";
    expect(() => choosePrivateSemanticCandidate({
      contract: { ...contract, descriptor: changed } as ParsedCapabilityContract,
      request: request(),
      choose: () => ({ status: "abstain" }),
    })).toThrow(expect.objectContaining({ code: "SEMANTIC_CHOICE_CONTRACT_MISMATCH" }));
  });
});

function request(): {
  objective: string;
  context: { ticket: string; labels: string[] };
  candidates: { id: string; description: string }[];
} {
  return {
    objective: "Choose a workflow for the ticket.",
    context: { ticket: "T-1", labels: ["feature"] },
    candidates: [
      { id: "gauntlet", description: "Iterative build and evaluation." },
      { id: "vote", description: "Independent proposals and majority vote." },
    ],
  };
}
