import { types as utilTypes } from "node:util";

import {
  parseCapabilityContract,
  type ParsedCapabilityContract,
} from "../capability/index.js";
import { canonicalJson, type JsonValue } from "../json.js";
import type { CompiledSchema } from "../schema/index.js";
import { snapshotPrivateOrdinaryJson } from "./private-ordinary-json.js";

const SEMANTIC_CHOICE_ID = "https://jig.dev/contracts/semantic-choice";
const SEMANTIC_CHOICE_VERSION = "1.0.0";
const SEMANTIC_CHOICE_DIGEST =
  "sha256:83767b89d02163d8a36c5e4f561d7c164135866a6bfdee1acd20f76370971e02";

export interface PrivateSemanticChoiceCandidate {
  readonly id: string;
  readonly description: string;
}

export interface PrivateSemanticChoiceRequest {
  readonly objective: string;
  readonly context: JsonValue;
  readonly candidates: readonly PrivateSemanticChoiceCandidate[];
}

export type PrivateSemanticChoiceResult =
  | {
      readonly status: "selected";
      readonly candidateId: string;
      readonly rationale?: string;
    }
  | {
      readonly status: "abstain";
      readonly rationale?: string;
    };

export type PrivateDeterministicChooser = (
  request: PrivateSemanticChoiceRequest,
) => unknown;

export class PrivateSemanticChoiceError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "PrivateSemanticChoiceError";
  }
}

/**
 * Pure closed-choice value boundary. The injected synchronous callback is
 * deterministic test machinery, not a Provider, dispatch, or security seam.
 */
export function choosePrivateSemanticCandidate(input: {
  readonly contract: ParsedCapabilityContract;
  readonly request: unknown;
  readonly choose: PrivateDeterministicChooser;
}): PrivateSemanticChoiceResult {
  const schemas = requireCanonicalContract(input.contract);
  const requestValue = snapshot(input.request, "Semantic Choice request");
  schemas.request.validate(requestValue, "SEMANTIC_CHOICE_INPUT_INVALID");
  const request = requestValue as unknown as PrivateSemanticChoiceRequest;
  const candidateIds = requireUniqueCandidates(request.candidates);

  const raw = input.choose(request);
  const resultValue = snapshot(raw, "Semantic Choice result");
  schemas.result.validate(resultValue, "SEMANTIC_CHOICE_OUTPUT_INVALID");
  const result = resultValue as unknown as PrivateSemanticChoiceResult;
  if (result.status === "selected" && !candidateIds.has(result.candidateId)) {
    throw new PrivateSemanticChoiceError(
      "SEMANTIC_CHOICE_UNKNOWN_CANDIDATE",
      `Semantic Choice selected unknown candidate ${JSON.stringify(result.candidateId)}`,
    );
  }
  return result;
}

function requireCanonicalContract(contract: ParsedCapabilityContract): {
  readonly request: CompiledSchema;
  readonly result: CompiledSchema;
} {
  if (contract === null || typeof contract !== "object" || utilTypes.isProxy(contract) ||
      (Object.getPrototypeOf(contract) !== Object.prototype && Object.getPrototypeOf(contract) !== null)) {
    throw mismatch();
  }
  const descriptorField = Object.getOwnPropertyDescriptor(contract, "descriptor");
  const digestField = Object.getOwnPropertyDescriptor(contract, "digest");
  if (descriptorField === undefined || !("value" in descriptorField) || !descriptorField.enumerable ||
      digestField === undefined || !("value" in digestField) || !digestField.enumerable) {
    throw mismatch();
  }
  const descriptor = snapshot(descriptorField.value, "Semantic Choice contract descriptor");
  let parsed: ParsedCapabilityContract;
  try {
    parsed = parseCapabilityContract(canonicalJson(descriptor), "canonical Semantic Choice contract");
  } catch {
    throw mismatch();
  }
  if (parsed.descriptor.id !== SEMANTIC_CHOICE_ID ||
      parsed.descriptor.version !== SEMANTIC_CHOICE_VERSION ||
      parsed.digest !== SEMANTIC_CHOICE_DIGEST || digestField.value !== parsed.digest ||
      !Object.hasOwn(parsed.descriptor.methods, "choose")) {
    throw mismatch();
  }
  const request = parsed.schemas.get("/methods/choose/input");
  const result = parsed.schemas.get("/methods/choose/output");
  if (request === undefined || result === undefined) throw mismatch();
  return { request, result };
}

function requireUniqueCandidates(
  candidates: readonly PrivateSemanticChoiceCandidate[],
): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const candidate of candidates) {
    if (ids.has(candidate.id)) {
      throw new PrivateSemanticChoiceError(
        "SEMANTIC_CHOICE_DUPLICATE_CANDIDATE",
        `Semantic Choice candidate ID repeats: ${JSON.stringify(candidate.id)}`,
      );
    }
    ids.add(candidate.id);
  }
  return ids;
}

function snapshot(value: unknown, label: string): JsonValue {
  return snapshotPrivateOrdinaryJson(
    value,
    label,
    (message) => new PrivateSemanticChoiceError("SEMANTIC_CHOICE_JSON_INVALID", message),
  );
}

function mismatch(): PrivateSemanticChoiceError {
  return new PrivateSemanticChoiceError(
    "SEMANTIC_CHOICE_CONTRACT_MISMATCH",
    "Semantic Choice requires the canonical 1.0.0 contract descriptor",
  );
}
