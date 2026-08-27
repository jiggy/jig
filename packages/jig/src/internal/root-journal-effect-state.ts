import {
  JSON_1_LIMITS,
  canonicalJson,
  decodeJson1,
  validateJson1,
  type JsonObject,
  type JsonValue,
} from "../json.js";
import type { RunHostEffectCall, RunHostEffectResult } from "../run/session.js";
import {
  normalizePrivateHookSelectionSet,
  privateHookSelectionSetDigest,
} from "./hook-runtime-state.js";
import { privateDomainDigest } from "./identity.js";

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const LOCAL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const WIRE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/;
const PROTECTED_EVENT_PREFIX = "https://jig.dev/events/";

export interface PrivateRootJournalAppendAllocation {
  readonly kind: "private-root-journal-append-allocation/1";
  readonly parentRunId: string;
  readonly coordinatorEpoch: number;
  readonly publisherBinding: string;
  readonly eventTypes: readonly string[];
  readonly call: RunHostEffectCall;
}

export interface PrivateJournalEvent {
  readonly eventId: string;
  readonly journalPosition: number;
  readonly type: string;
  readonly source: string;
  readonly committedAtUnixMs: number;
  readonly data: JsonValue;
  readonly subject?: string;
  readonly occurredAtUnixMs?: number;
  readonly runId: string;
}

export interface PrivateRootJournalAppendClosure {
  readonly kind: "private-root-journal-append-closure/1";
  readonly parentRunId: string;
  readonly allocationDigest: string;
  readonly eventDigest: string;
  readonly terminalDigest: string;
  readonly hookSelectionDigest: string;
}

export interface PrivateRootJournalAppendReceipt {
  readonly allocation: PrivateRootJournalAppendAllocation;
  readonly allocationDigest: string;
  readonly event: PrivateJournalEvent;
  readonly eventDigest: string;
  readonly terminal: RunHostEffectResult;
  readonly terminalDigest: string;
  readonly hookSelectionDigest: string;
  readonly closureDigest: string;
}

export interface PrivateRootJournalEffectsClosure {
  readonly kind: "private-root-journal-effects-closure/1";
  readonly parentRunId: string;
  readonly operations: readonly {
    readonly operationId: string;
    readonly closureDigest: string;
  }[];
}

export function normalizePrivateRootJournalAppendAllocation(
  value: unknown,
): PrivateRootJournalAppendAllocation {
  const root = exactObject(value, [
    "call", "coordinatorEpoch", "eventTypes", "kind", "parentRunId", "publisherBinding",
  ], "Journal append allocation");
  if (root.kind !== "private-root-journal-append-allocation/1") {
    throw new TypeError("Journal append allocation kind is invalid");
  }
  const parentRunId = requireDigest(root.parentRunId, "Journal append parent Run");
  const coordinatorEpoch = requirePositiveInteger(root.coordinatorEpoch, "Journal append coordinator epoch");
  const publisherBinding = requireLocalName(root.publisherBinding, "Journal publisher Binding");
  if (!Array.isArray(root.eventTypes) || root.eventTypes.length < 1 ||
      root.eventTypes.length > JSON_1_LIMITS.containerEntries) {
    throw new TypeError("Journal publisher eventTypes are invalid");
  }
  const eventTypes = root.eventTypes.map((value) => requireEventType(value));
  const sorted = [...eventTypes].sort();
  if (eventTypes.some((value, index) => value !== sorted[index]) || new Set(eventTypes).size !== eventTypes.length) {
    throw new TypeError("Journal publisher eventTypes must be unique and sorted");
  }
  const callRoot = exactObject(root.call, ["input", "method", "operationId", "slot"], "Journal effect call");
  const call = Object.freeze({
    operationId: requireWireId(callRoot.operationId, "Journal operation ID"),
    slot: requireLocalName(callRoot.slot, "Journal effect slot"),
    method: requireLocalName(callRoot.method, "Journal effect method"),
    input: normalizeJson(callRoot.input),
  });
  if (call.method !== "append") throw new TypeError("Journal publisher exposes only append");
  return Object.freeze({
    kind: "private-root-journal-append-allocation/1",
    parentRunId,
    coordinatorEpoch,
    publisherBinding,
    eventTypes: Object.freeze(eventTypes),
    call,
  });
}

export function encodePrivateRootJournalAppendAllocation(
  value: PrivateRootJournalAppendAllocation,
): Uint8Array {
  return canonicalJson(normalizePrivateRootJournalAppendAllocation(value) as unknown as JsonValue);
}

export function decodePrivateRootJournalAppendAllocation(
  bytes: Uint8Array,
): PrivateRootJournalAppendAllocation {
  return normalizePrivateRootJournalAppendAllocation(decodeJson1(bytes));
}

export function privateRootJournalAppendAllocationDigest(
  value: PrivateRootJournalAppendAllocation,
): string {
  return privateDomainDigest(
    "JIG-Private-Root-Journal-Append-Allocation/1",
    normalizePrivateRootJournalAppendAllocation(value) as unknown as JsonValue,
  );
}

export function createPrivateJournalEvent(input: {
  readonly allocation: PrivateRootJournalAppendAllocation;
  readonly journalPosition: number;
  readonly committedAtUnixMs: number;
}): PrivateJournalEvent {
  const allocation = normalizePrivateRootJournalAppendAllocation(input.allocation);
  const position = requirePositiveInteger(input.journalPosition, "Journal position");
  const committedAtUnixMs = requireNonnegativeInteger(input.committedAtUnixMs, "Journal commit time");
  if (allocation.call.input === null || typeof allocation.call.input !== "object" ||
      Array.isArray(allocation.call.input)) {
    throw new TypeError("Journal append input must be an object");
  }
  const hasSubject = Object.hasOwn(allocation.call.input, "subject");
  const hasOccurredAt = Object.hasOwn(allocation.call.input, "occurredAtUnixMs");
  const append = exactObject(
    allocation.call.input,
    hasSubject
      ? hasOccurredAt
        ? ["data", "occurredAtUnixMs", "subject", "type"]
        : ["data", "subject", "type"]
      : hasOccurredAt
        ? ["data", "occurredAtUnixMs", "type"]
        : ["data", "type"],
    "Journal append input",
  );
  const type = requireEventType(append.type);
  if (!allocation.eventTypes.includes(type)) throw new TypeError("Journal event type exceeds publisher authority");
  const subject = append.subject === undefined
    ? undefined
    : requireBoundedString(append.subject, 0, 2_048, "Journal subject");
  const occurredAtUnixMs = append.occurredAtUnixMs === undefined
    ? undefined
    : requireSafeInteger(append.occurredAtUnixMs, "Journal occurred time");
  const allocationDigest = privateRootJournalAppendAllocationDigest(allocation);
  const eventId = privateDomainDigest("JIG-Private-Journal-Event-ID/1", {
    allocationDigest,
    journalPosition: position,
  });
  return Object.freeze({
    eventId,
    journalPosition: position,
    type,
    source: `binding:${allocation.publisherBinding}`,
    committedAtUnixMs,
    data: normalizeJson(append.data),
    ...(subject === undefined ? {} : { subject }),
    ...(occurredAtUnixMs === undefined ? {} : { occurredAtUnixMs }),
    runId: allocation.parentRunId,
  });
}

export function privateJournalEventDigest(value: PrivateJournalEvent): string {
  validateJson1(value as unknown as JsonValue);
  return privateDomainDigest("JIG-Private-Journal-Event/1", value as unknown as JsonValue);
}

export function privateRootJournalEffectTerminalDigest(value: RunHostEffectResult): string {
  validateJson1(value as unknown as JsonValue);
  return privateDomainDigest("JIG-Private-Root-Journal-Terminal/1", value as unknown as JsonValue);
}

export function privateEmptyHookSelectionDigest(event: PrivateJournalEvent): string {
  return privateHookSelectionSetDigest(privateEmptyHookSelection(event));
}

export function privateEmptyHookSelection(event: PrivateJournalEvent): JsonObject {
  return normalizePrivateHookSelectionSet({
    kind: "private-hook-selection-set/1",
    eventId: event.eventId,
    entries: [],
  }) as unknown as JsonObject;
}

export function normalizePrivateRootJournalAppendClosure(
  value: unknown,
): PrivateRootJournalAppendClosure {
  const root = exactObject(value, [
    "allocationDigest", "eventDigest", "hookSelectionDigest", "kind", "parentRunId", "terminalDigest",
  ], "Journal append closure");
  if (root.kind !== "private-root-journal-append-closure/1") {
    throw new TypeError("Journal append closure kind is invalid");
  }
  return Object.freeze({
    kind: "private-root-journal-append-closure/1",
    parentRunId: requireDigest(root.parentRunId, "Journal append closure parent Run"),
    allocationDigest: requireDigest(root.allocationDigest, "Journal append closure allocation"),
    eventDigest: requireDigest(root.eventDigest, "Journal append closure Event"),
    terminalDigest: requireDigest(root.terminalDigest, "Journal append closure terminal"),
    hookSelectionDigest: requireDigest(root.hookSelectionDigest, "Journal append closure Hook selection"),
  });
}

export function privateRootJournalAppendClosureDigest(value: PrivateRootJournalAppendClosure): string {
  return privateDomainDigest(
    "JIG-Private-Root-Journal-Append-Closure/1",
    normalizePrivateRootJournalAppendClosure(value) as unknown as JsonValue,
  );
}

/** One stable parent-release witness over every committed Journal operation. */
export function createPrivateRootJournalEffectsClosure(input: {
  readonly parentRunId: string;
  readonly receipts: readonly PrivateRootJournalAppendReceipt[];
}): PrivateRootJournalEffectsClosure {
  return normalizePrivateRootJournalEffectsClosure({
    kind: "private-root-journal-effects-closure/1",
    parentRunId: input.parentRunId,
    operations: input.receipts.map((receipt) => ({
      operationId: receipt.allocation.call.operationId,
      closureDigest: receipt.closureDigest,
    })).sort((left, right) => left.operationId < right.operationId ? -1 : left.operationId > right.operationId ? 1 : 0),
  });
}

export function normalizePrivateRootJournalEffectsClosure(value: unknown): PrivateRootJournalEffectsClosure {
  const root = exactObject(value, ["kind", "operations", "parentRunId"], "Journal effects closure");
  if (root.kind !== "private-root-journal-effects-closure/1" || !Array.isArray(root.operations) ||
      root.operations.length > JSON_1_LIMITS.containerEntries) {
    throw new TypeError("Journal effects closure is invalid");
  }
  const operations = root.operations.map((operation) => {
    const item = exactObject(operation, ["closureDigest", "operationId"], "Journal effects closure operation");
    return Object.freeze({
      operationId: requireWireId(item.operationId, "Journal effects closure operation ID"),
      closureDigest: requireDigest(item.closureDigest, "Journal effects closure operation"),
    });
  });
  for (let index = 1; index < operations.length; index += 1) {
    if (operations[index - 1]!.operationId >= operations[index]!.operationId) {
      throw new TypeError("Journal effects closure operations must be unique and sorted");
    }
  }
  return Object.freeze({
    kind: "private-root-journal-effects-closure/1",
    parentRunId: requireDigest(root.parentRunId, "Journal effects closure parent Run"),
    operations: Object.freeze(operations),
  });
}

export function privateRootJournalEffectsClosureDigest(value: PrivateRootJournalEffectsClosure): string {
  return privateDomainDigest(
    "JIG-Private-Root-Journal-Effects-Closure/1",
    normalizePrivateRootJournalEffectsClosure(value) as unknown as JsonValue,
  );
}

function exactObject(value: unknown, keys: readonly string[], label: string): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new TypeError(`${label} has unexpected members`);
  }
  return value as JsonObject;
}

function normalizeJson(value: unknown): JsonValue {
  validateJson1(value as JsonValue);
  return decodeJson1(canonicalJson(value as JsonValue));
}

function requireDigest(value: unknown, label: string): string {
  if (typeof value !== "string" || !DIGEST.test(value)) throw new TypeError(`${label} is invalid`);
  return value;
}

function requireWireId(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length > 128 || !WIRE_ID.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function requireLocalName(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length > 64 || !LOCAL_NAME.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function requireEventType(value: unknown): string {
  const result = requireBoundedString(value, 1, 512, "Journal event type");
  if (result.startsWith(PROTECTED_EVENT_PREFIX)) {
    throw new TypeError("Journal event type uses Jig's protected lifecycle namespace");
  }
  return result;
}

function requireBoundedString(value: unknown, minimum: number, maximum: number, label: string): string {
  if (typeof value !== "string" || [...value].length < minimum || [...value].length > maximum) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function requireSafeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value)) throw new TypeError(`${label} is invalid`);
  return value as number;
}

function requirePositiveInteger(value: unknown, label: string): number {
  const result = requireSafeInteger(value, label);
  if (result < 1) throw new TypeError(`${label} is invalid`);
  return result;
}

function requireNonnegativeInteger(value: unknown, label: string): number {
  const result = requireSafeInteger(value, label);
  if (result < 0) throw new TypeError(`${label} is invalid`);
  return result;
}
