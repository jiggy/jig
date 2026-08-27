import { CheckError } from "../diagnostics.js";
import type { JsonValue } from "../json.js";
import { inspectCapturedPackage, type InspectedPackage } from "../package/inspect.js";
import { SchemaDiagnostic, type CompiledSchema } from "../schema/index.js";
import {
  type RunHostEffectCall,
  type RunHostEffectOperationTerminal,
} from "../run/session.js";
import {
  appendPrivateRootJournalEvent,
  listPrivateRootJournalAppends,
  type PrivateProjectCoordinator,
  type PrivateReacquiredRootExecutionWork,
} from "./activation-admission-store.js";
import { findPrivateActivationCandidateTarget } from "./activation-admission.js";
import { captureStoredPackage } from "./package-artifact-store.js";
import type { PrivateProjectLocalLock } from "./project-local-lock.js";
import {
  createPrivateRootJournalEffectsClosure,
  normalizePrivateRootJournalAppendAllocation,
  privateRootJournalEffectsClosureDigest,
} from "./root-journal-effect-state.js";
import type { PrivateActivationRequest } from "../project/package-resolution.js";
import {
  PRIVATE_CANONICAL_JOURNAL_CONTRACT,
  type ContractIdentity,
} from "../project/package-project.js";

const APPEND_INPUT = "/methods/append/input";
const APPEND_OUTPUT = "/methods/append/output";
const PROTECTED_EVENT_PREFIX = "https://jig.dev/events/";

interface JournalEffectContext {
  readonly publisherBinding: string;
  readonly eventTypes: readonly string[];
  readonly inputSchema: CompiledSchema;
  readonly outputSchema: CompiledSchema;
}

interface JournalEffectInput {
  readonly projectRoot: string;
  readonly packageStoreRoot: string;
  readonly parent: PrivateReacquiredRootExecutionWork;
  readonly coordinator: PrivateProjectCoordinator;
}

/** Dispatch the exact host-native Journal append selected by a pinned root Run. */
export async function executePrivateRootJournalEffect(
  input: JournalEffectInput & {
    readonly call: RunHostEffectCall;
    readonly signal: AbortSignal;
  },
): Promise<RunHostEffectOperationTerminal> {
  try {
    if (input.signal.aborted) return failed("CANCELLED", "Journal append was cancelled before admission");
    const context = await inspectJournalEffectContext(input, input.call);
    const inputFailure = schemaFailure(context.inputSchema, input.call.input, "INVALID_INPUT");
    if (inputFailure !== undefined) return inputFailure;
    requireEventTypeAuthority(context, input.call.input);
    if (input.signal.aborted) return failed("CANCELLED", "Journal append was cancelled before commit");

    const receipt = await appendPrivateRootJournalEvent({
      coordinator: input.coordinator,
      projectRoot: input.projectRoot,
      packageStoreRoot: input.packageStoreRoot,
      allocation: normalizePrivateRootJournalAppendAllocation({
        kind: "private-root-journal-append-allocation/1",
        parentRunId: input.parent.run.runId,
        coordinatorEpoch: input.parent.run.coordinatorEpoch,
        publisherBinding: context.publisherBinding,
        eventTypes: context.eventTypes,
        call: input.call,
      }),
      committedAtUnixMs: Date.now(),
    });
    const outputFailure = schemaFailure(context.outputSchema, receipt.event, "INVALID_RESULT");
    if (outputFailure !== undefined) return outputFailure;
    return Object.freeze({ status: "succeeded", result: receipt.terminal });
  } catch (error) {
    return operationFailure(error);
  }
}

/**
 * Reopen and verify every atomic append closure before the parent terminal is
 * released. The digest is an aggregate witness, including the empty set.
 */
export async function closePrivateRootJournalEffectsBeforeParent(
  input: JournalEffectInput,
): Promise<string> {
  const receipts = await listPrivateRootJournalAppends({
    coordinator: input.coordinator,
    projectRoot: input.projectRoot,
    parentRunId: input.parent.run.runId,
  });
  if (receipts.length !== 0) {
    const inspected = await inspectParentPackage(input);
    for (const receipt of receipts) {
      const context = requirePrivateCanonicalJournalEffectContext({
        request: parentRequest(input.parent),
        lock: input.parent.candidate.lock,
        inspected,
        call: receipt.allocation.call,
      });
      if (receipt.allocation.publisherBinding !== context.publisherBinding ||
          receipt.allocation.eventTypes.length !== context.eventTypes.length ||
          receipt.allocation.eventTypes.some((value, index) => value !== context.eventTypes[index])) {
        throw new Error("stored Journal append authority differs from its pinned parent context");
      }
      context.inputSchema.validate(receipt.allocation.call.input, "INVALID_INPUT");
      requireEventTypeAuthority(context, receipt.allocation.call.input);
      context.outputSchema.validate(receipt.event, "INVALID_RESULT");
    }
  }
  return privateRootJournalEffectsClosureDigest(createPrivateRootJournalEffectsClosure({
    parentRunId: input.parent.run.runId,
    receipts,
  }));
}

/** Pure private resolver kept separate so contract/authority failures are focused-testable. */
export function requirePrivateCanonicalJournalEffectContext(input: {
  readonly request: PrivateActivationRequest;
  readonly lock: PrivateProjectLocalLock;
  readonly inspected: InspectedPackage;
  readonly call: RunHostEffectCall;
}): JournalEffectContext {
  if (input.call.method !== "append") {
    throw new CheckError("unavailable", "UNAVAILABLE", "the selected capability has no requested method");
  }
  const slot = input.request.slots[input.call.slot];
  if (slot?.kind !== "capability" || !sameContract(slot.contract, PRIVATE_CANONICAL_JOURNAL_CONTRACT) ||
      slot.provider.export !== "journal") {
    throw new CheckError("unavailable", "UNAVAILABLE", "the requested slot has no canonical Journal publisher");
  }
  const packageLock = input.lock.packages[input.request.packagePath];
  const use = packageLock?.uses[input.call.slot];
  const publisher = input.lock.journalPublishers[slot.provider.binding];
  if (use?.kind !== "contract" || !sameContract(use, PRIVATE_CANONICAL_JOURNAL_CONTRACT) ||
      publisher === undefined || publisher.source !== `binding:${slot.provider.binding}` ||
      !sameContract(publisher.contract, PRIVATE_CANONICAL_JOURNAL_CONTRACT)) {
    throw new CheckError("unavailable", "UNAVAILABLE", "the admitted generation has no canonical Journal authority");
  }
  if (input.inspected.digest !== input.request.package.digest) {
    throw new Error("inspected Journal consumer differs from its pinned package");
  }
  const reference = input.inspected.usedContracts.find((candidate) => candidate.slot === input.call.slot);
  if (reference === undefined || !sameContract({
    id: reference.contract.descriptor.id,
    version: reference.contract.descriptor.version,
    digest: reference.contract.digest,
  }, PRIVATE_CANONICAL_JOURNAL_CONTRACT)) {
    throw new CheckError("unavailable", "UNAVAILABLE", "the protected package has no exact canonical Journal contract");
  }
  const inputSchema = reference.contract.schemas.get(APPEND_INPUT);
  const outputSchema = reference.contract.schemas.get(APPEND_OUTPUT);
  if (inputSchema === undefined || outputSchema === undefined) {
    throw new Error("canonical Journal contract lacks its append schemas");
  }
  return Object.freeze({
    publisherBinding: slot.provider.binding,
    eventTypes: publisher.eventTypes,
    inputSchema,
    outputSchema,
  });
}

async function inspectJournalEffectContext(
  input: JournalEffectInput,
  call: RunHostEffectCall,
): Promise<JournalEffectContext> {
  return requirePrivateCanonicalJournalEffectContext({
    request: parentRequest(input.parent),
    lock: input.parent.candidate.lock,
    inspected: await inspectParentPackage(input),
    call,
  });
}

async function inspectParentPackage(input: JournalEffectInput): Promise<InspectedPackage> {
  const request = parentRequest(input.parent);
  const captured = await captureStoredPackage(input.packageStoreRoot, request.package);
  try { return await inspectCapturedPackage(captured); }
  finally { await captured.dispose(); }
}

function parentRequest(parent: PrivateReacquiredRootExecutionWork): PrivateActivationRequest {
  const selected = findPrivateActivationCandidateTarget(parent.candidate, parent.run.target);
  if (selected === undefined || selected.request.digest !== parent.intent.requestDigest) {
    throw new Error("durable root Run differs from its pinned Journal consumer");
  }
  return selected.request;
}

function requireEventTypeAuthority(context: JournalEffectContext, value: JsonValue): void {
  const type = value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Readonly<Record<string, JsonValue>>).type
    : undefined;
  if (typeof type !== "string" || type.startsWith(PROTECTED_EVENT_PREFIX) ||
      !context.eventTypes.includes(type)) {
    throw new CheckError("unavailable", "PERMISSION_DENIED", "Journal publisher does not authorize this Event type");
  }
}

function sameContract(left: ContractIdentity, right: ContractIdentity): boolean {
  return left.id === right.id && left.version === right.version && left.digest === right.digest;
}

function schemaFailure(
  schema: CompiledSchema,
  value: unknown,
  code: "INVALID_INPUT" | "INVALID_RESULT",
): RunHostEffectOperationTerminal | undefined {
  try { schema.validate(value, code); }
  catch (error) {
    if (!(error instanceof SchemaDiagnostic)) throw error;
    return failed(code, error.message, {
      code: error.code,
      instancePointer: error.instancePointer,
      schemaPointer: error.schemaPointer,
      path: error.path,
      ...(error.keyword === undefined ? {} : { keyword: error.keyword }),
    });
  }
  return undefined;
}

function operationFailure(error: unknown): RunHostEffectOperationTerminal {
  if (error instanceof CheckError) {
    if (error.code === "RUN_ALREADY_TERMINAL" || error.code === "RUN_COORDINATOR_STALE") {
      return failed("OWNER_CLOSED", error.message);
    }
    if ([
      "CANCELLED", "DEADLINE_EXCEEDED", "OWNER_CLOSED", "OPERATION_CONFLICT", "UNAVAILABLE",
      "PERMISSION_DENIED", "RESOURCE_EXHAUSTED", "INVALID_INPUT", "INVALID_RESULT", "UNCERTAIN",
    ].includes(error.code)) {
      return failed(error.code as Exclude<RunHostEffectOperationTerminal, { readonly status: "succeeded" }>["code"], error.message);
    }
  }
  return failed("EXECUTION_FAILED", error instanceof Error ? error.message : String(error));
}

function failed(
  code: Exclude<RunHostEffectOperationTerminal, { readonly status: "succeeded" }>["code"],
  message: string,
  details?: JsonValue,
): RunHostEffectOperationTerminal {
  return Object.freeze({
    status: "failed",
    code,
    message,
    ...(details === undefined ? {} : { details }),
  });
}
