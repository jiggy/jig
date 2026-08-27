import { types as utilTypes } from "node:util";

import {
  JSON_1_LIMITS,
  canonicalJson,
  decodeJson1,
  validateJson1,
  type JsonValue,
} from "../json.js";
import type { PrivateActivationCandidateTarget } from "./activation-admission.js";
import { privateDomainDigest } from "./identity.js";
import {
  PRIVATE_CANONICAL_JOURNAL_CONTRACT,
  type ContractIdentity,
  type RunTargetIdentity,
} from "../project/package-project.js";
import {
  isProtectedProjectPath,
  normalizeProjectPath,
} from "../project/paths.js";

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const LOCAL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PROTECTED_EVENT_PREFIX = "https://jig.dev/events/";
const MAX_DISPOSITION_EVIDENCE = 64;

const UNAVAILABLE_CODES = new Set([
  "RUNTIME_UNAVAILABLE",
  "RUNTIME_AMBIGUOUS",
  "PREPARATION_AUTHORITY_REQUIRED",
  "SANDBOX_UNAVAILABLE",
  "SANDBOX_AMBIGUOUS",
  "PERMISSION_UNENFORCEABLE",
  "DEPENDENCY_UNAVAILABLE",
]);

export interface PrivateHookJournalAuthority {
  readonly publisherBinding: string;
  readonly source: string;
  readonly contract: ContractIdentity;
  readonly type: string;
}

export interface PrivateHookTargetMeaning {
  readonly identity: RunTargetIdentity;
  readonly requestDigest: string;
  readonly dispositionDigest: string;
}

/** Exact executable meaning selected from an inert Hook relation. */
export interface PrivateHookMeaning {
  readonly kind: "private-hook-meaning/1";
  readonly hookId: string;
  readonly relationDigest: string;
  readonly journalAuthority: PrivateHookJournalAuthority;
  readonly target: PrivateHookTargetMeaning;
}

/** One immutable opening of a Hook meaning in the project Journal. */
export interface PrivateHookRevision {
  readonly kind: "private-hook-revision/1";
  readonly meaning: PrivateHookMeaning;
  readonly meaningDigest: string;
  readonly openingAdmissionDigest: string;
  readonly openingCandidateRevision: number;
  readonly openingCandidateDigest: string;
  readonly startPosition: number;
}

/**
 * The Hook-transition fact rooted by one activation admission. A null
 * position proves that admission preserved the preceding open Hook meanings.
 */
export interface PrivateHookAdmissionBoundary {
  readonly kind: "private-hook-admission-boundary/1";
  readonly baseGeneration: string | null;
  readonly planDigest: string;
  readonly candidateRevision: number;
  readonly candidateDigest: string;
  readonly lockDigest: string;
  readonly observedJournalPosition: number;
  readonly observedJournalEventDigest: string | null;
  readonly boundaryPosition: number | null;
}

export interface PrivateHookSelection {
  readonly hookId: string;
  readonly hookRevisionDigest: string;
  readonly runId: string;
}

/** Canonical Event-local fan-out selected in the Journal append transaction. */
export interface PrivateHookSelectionSet {
  readonly kind: "private-hook-selection-set/1";
  readonly eventId: string;
  readonly entries: readonly PrivateHookSelection[];
}

export function normalizePrivateHookMeaning(value: unknown): PrivateHookMeaning {
  const root = exactObject(
    value,
    ["hookId", "journalAuthority", "kind", "relationDigest", "target"],
    "Hook meaning",
  );
  if (root.kind !== "private-hook-meaning/1") {
    throw new TypeError("Hook meaning kind is invalid");
  }
  const hookId = localName(root.hookId, "Hook ID");
  const authorityValue = exactObject(
    root.journalAuthority,
    ["contract", "publisherBinding", "source", "type"],
    "Hook Journal authority",
  );
  const publisherBinding = localName(
    authorityValue.publisherBinding,
    "Hook Journal publisher Binding",
  );
  if (authorityValue.source !== `binding:${publisherBinding}`) {
    throw new TypeError("Hook Journal source does not name its publisher Binding");
  }
  const contractValue = exactObject(
    authorityValue.contract,
    ["digest", "id", "version"],
    "Hook Journal contract",
  );
  const contract = Object.freeze({
    id: exactString(contractValue.id, PRIVATE_CANONICAL_JOURNAL_CONTRACT.id, "Hook Journal contract ID"),
    version: exactString(
      contractValue.version,
      PRIVATE_CANONICAL_JOURNAL_CONTRACT.version,
      "Hook Journal contract version",
    ),
    digest: exactString(
      contractValue.digest,
      PRIVATE_CANONICAL_JOURNAL_CONTRACT.digest,
      "Hook Journal contract digest",
    ),
  });
  const targetValue = exactObject(
    root.target,
    ["dispositionDigest", "identity", "requestDigest"],
    "Hook target meaning",
  );
  const meaning = Object.freeze({
    kind: "private-hook-meaning/1" as const,
    hookId,
    relationDigest: digest(root.relationDigest, "Hook relation"),
    journalAuthority: Object.freeze({
      publisherBinding,
      source: authorityValue.source,
      contract,
      type: eventType(authorityValue.type),
    }),
    target: Object.freeze({
      identity: targetIdentity(targetValue.identity),
      requestDigest: digest(targetValue.requestDigest, "Hook target request"),
      dispositionDigest: digest(targetValue.dispositionDigest, "Hook target disposition"),
    }),
  });
  validateJson1(meaning as unknown as JsonValue);
  return meaning;
}

export function encodePrivateHookMeaning(value: unknown): Uint8Array {
  return canonicalJson(normalizePrivateHookMeaning(value) as unknown as JsonValue);
}

export function decodePrivateHookMeaning(bytes: Uint8Array): PrivateHookMeaning {
  return decodeCanonical(bytes, normalizePrivateHookMeaning, "Hook meaning");
}

export function privateHookMeaningDigest(value: unknown): string {
  return privateDomainDigest(
    "JIG-Private-Hook-Meaning/1",
    normalizePrivateHookMeaning(value) as unknown as JsonValue,
  );
}

/**
 * Identify one structurally closed candidate disposition. This digest carries
 * no claim that the disposition was read from protected admitted storage.
 */
export function privateHookTargetDispositionDigest(
  value: PrivateActivationCandidateTarget["disposition"] | unknown,
): string {
  return privateDomainDigest(
    "JIG-Private-Hook-Target-Disposition/1",
    normalizeDisposition(value) as unknown as JsonValue,
  );
}

export function normalizePrivateHookRevision(value: unknown): PrivateHookRevision {
  const root = exactObject(value, [
    "kind",
    "meaning",
    "meaningDigest",
    "openingAdmissionDigest",
    "openingCandidateDigest",
    "openingCandidateRevision",
    "startPosition",
  ], "Hook revision");
  if (root.kind !== "private-hook-revision/1") {
    throw new TypeError("Hook revision kind is invalid");
  }
  const meaning = normalizePrivateHookMeaning(root.meaning);
  const meaningDigest = digest(root.meaningDigest, "Hook meaning");
  if (meaningDigest !== privateHookMeaningDigest(meaning)) {
    throw new TypeError("Hook revision meaning digest does not match its meaning");
  }
  const revision = Object.freeze({
    kind: "private-hook-revision/1" as const,
    meaning,
    meaningDigest,
    openingAdmissionDigest: digest(root.openingAdmissionDigest, "Hook opening admission"),
    openingCandidateRevision: positiveSafeInteger(
      root.openingCandidateRevision,
      "Hook opening candidate revision",
    ),
    openingCandidateDigest: digest(root.openingCandidateDigest, "Hook opening candidate"),
    startPosition: positiveSafeInteger(root.startPosition, "Hook start position"),
  });
  validateJson1(revision as unknown as JsonValue);
  return revision;
}

export function encodePrivateHookRevision(value: unknown): Uint8Array {
  return canonicalJson(normalizePrivateHookRevision(value) as unknown as JsonValue);
}

export function decodePrivateHookRevision(bytes: Uint8Array): PrivateHookRevision {
  return decodeCanonical(bytes, normalizePrivateHookRevision, "Hook revision");
}

export function privateHookRevisionDigest(value: unknown): string {
  return privateDomainDigest(
    "JIG-Private-Hook-Revision/1",
    normalizePrivateHookRevision(value) as unknown as JsonValue,
  );
}

export function normalizePrivateHookAdmissionBoundary(
  value: unknown,
): PrivateHookAdmissionBoundary {
  const root = exactObject(value, [
    "baseGeneration",
    "boundaryPosition",
    "candidateDigest",
    "candidateRevision",
    "kind",
    "lockDigest",
    "observedJournalEventDigest",
    "observedJournalPosition",
    "planDigest",
  ], "Hook admission boundary");
  if (root.kind !== "private-hook-admission-boundary/1") {
    throw new TypeError("Hook admission boundary kind is invalid");
  }
  const observedJournalPosition = nonnegativeSafeInteger(
    root.observedJournalPosition,
    "Hook admission observed Journal position",
  );
  const observedJournalEventDigest = root.observedJournalEventDigest === null
    ? null
    : digest(root.observedJournalEventDigest, "Hook admission observed Journal Event");
  if ((observedJournalPosition === 0) !== (observedJournalEventDigest === null)) {
    throw new TypeError("Hook admission observed Journal Event must be null exactly at genesis");
  }
  const boundaryPosition = root.boundaryPosition === null
    ? null
    : positiveSafeInteger(root.boundaryPosition, "Hook admission boundary position");
  if (boundaryPosition !== null && (
    observedJournalPosition === Number.MAX_SAFE_INTEGER ||
    boundaryPosition !== observedJournalPosition + 1
  )) {
    throw new TypeError("Hook admission boundary must immediately follow its observed Journal position");
  }
  const boundary = Object.freeze({
    kind: "private-hook-admission-boundary/1" as const,
    baseGeneration: root.baseGeneration === null
      ? null
      : digest(root.baseGeneration, "Hook admission base generation"),
    planDigest: digest(root.planDigest, "Hook admission plan"),
    candidateRevision: positiveSafeInteger(
      root.candidateRevision,
      "Hook admission candidate revision",
    ),
    candidateDigest: digest(root.candidateDigest, "Hook admission candidate"),
    lockDigest: digest(root.lockDigest, "Hook admission lock"),
    observedJournalPosition,
    observedJournalEventDigest,
    boundaryPosition,
  });
  validateJson1(boundary as unknown as JsonValue);
  return boundary;
}

export function encodePrivateHookAdmissionBoundary(value: unknown): Uint8Array {
  return canonicalJson(normalizePrivateHookAdmissionBoundary(value) as unknown as JsonValue);
}

export function decodePrivateHookAdmissionBoundary(
  bytes: Uint8Array,
): PrivateHookAdmissionBoundary {
  return decodeCanonical(bytes, normalizePrivateHookAdmissionBoundary, "Hook admission boundary");
}

export function privateHookAdmissionBoundaryDigest(value: unknown): string {
  return privateDomainDigest(
    "JIG-Private-Hook-Admission-Boundary/1",
    normalizePrivateHookAdmissionBoundary(value) as unknown as JsonValue,
  );
}

/** Close the Journal-position arithmetic before any visible lock mutation. */
export function privateHookAdmissionBoundaryPosition(
  currentPosition: bigint,
  changesMeaning: boolean,
): number | null {
  if (typeof currentPosition !== "bigint" || currentPosition < 0n ||
      currentPosition > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new TypeError("current Journal position is invalid");
  }
  if (typeof changesMeaning !== "boolean") {
    throw new TypeError("Hook admission change flag is invalid");
  }
  if (!changesMeaning) return null;
  if (currentPosition === BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError("Journal position space is exhausted");
  }
  return Number(currentPosition + 1n);
}

export function normalizePrivateHookSelectionSet(value: unknown): PrivateHookSelectionSet {
  const root = exactObject(value, ["entries", "eventId", "kind"], "Hook selection set");
  if (root.kind !== "private-hook-selection-set/1") {
    throw new TypeError("Hook selection set kind is invalid");
  }
  const rawEntries = ordinaryArray(
    root.entries,
    JSON_1_LIMITS.containerEntries,
    "Hook selection entries",
  );
  const entries = rawEntries.map((value) => {
    const item = exactObject(
      value,
      ["hookId", "hookRevisionDigest", "runId"],
      "Hook selection",
    );
    return Object.freeze({
      hookId: localName(item.hookId, "Hook selection ID"),
      hookRevisionDigest: digest(item.hookRevisionDigest, "Hook selection revision"),
      runId: digest(item.runId, "Hook selection Run"),
    });
  });
  const revisions = new Set<string>();
  const runs = new Set<string>();
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!;
    if (index > 0 && entries[index - 1]!.hookId >= entry.hookId) {
      throw new TypeError("Hook selection entries must have unique, sorted Hook IDs");
    }
    if (revisions.has(entry.hookRevisionDigest)) {
      throw new TypeError("Hook selection contains a duplicate revision");
    }
    if (runs.has(entry.runId)) {
      throw new TypeError("Hook selection contains a duplicate derived Run");
    }
    revisions.add(entry.hookRevisionDigest);
    runs.add(entry.runId);
  }
  const selection = Object.freeze({
    kind: "private-hook-selection-set/1" as const,
    eventId: digest(root.eventId, "Hook selection Event"),
    entries: Object.freeze(entries),
  });
  validateJson1(selection as unknown as JsonValue);
  return selection;
}

export function encodePrivateHookSelectionSet(value: unknown): Uint8Array {
  return canonicalJson(normalizePrivateHookSelectionSet(value) as unknown as JsonValue);
}

export function decodePrivateHookSelectionSet(bytes: Uint8Array): PrivateHookSelectionSet {
  return decodeCanonical(bytes, normalizePrivateHookSelectionSet, "Hook selection set");
}

export function privateHookSelectionSetDigest(value: unknown): string {
  return privateDomainDigest(
    "JIG-Private-Hook-Selection-Set/1",
    normalizePrivateHookSelectionSet(value) as unknown as JsonValue,
  );
}

function normalizeDisposition(value: unknown): PrivateActivationCandidateTarget["disposition"] {
  const state = value !== null && typeof value === "object"
    ? exactObjectField(value, "state", "Hook target disposition")
    : undefined;
  if (state === "ready") {
    const ready = exactObject(
      value,
      ["observationDigest", "recipeDigest", "state"],
      "Hook target disposition",
    );
    return Object.freeze({
      state: "ready" as const,
      recipeDigest: digest(ready.recipeDigest, "Hook target recipe"),
      observationDigest: digest(ready.observationDigest, "Hook target observation"),
    });
  }
  const unavailable = exactObject(
    value,
    ["code", "evidenceDigests", "state"],
    "Hook target disposition",
  );
  if (unavailable.state !== "unavailable" ||
      typeof unavailable.code !== "string" ||
      !UNAVAILABLE_CODES.has(unavailable.code)) {
    throw new TypeError("Hook target disposition is invalid");
  }
  const evidence = ordinaryArray(
    unavailable.evidenceDigests,
    MAX_DISPOSITION_EVIDENCE,
    "Hook target disposition evidence",
  ).map((value) => digest(value, "Hook target disposition evidence"));
  if (evidence.length === 0) {
    throw new TypeError("unavailable Hook target requires evidence");
  }
  const sorted = [...evidence].sort(compareStrings);
  for (let index = 0; index < evidence.length; index += 1) {
    if (evidence[index] !== sorted[index] ||
        (index > 0 && evidence[index - 1] === evidence[index])) {
      throw new TypeError("Hook target disposition evidence must be unique and sorted");
    }
  }
  return Object.freeze({
    state: "unavailable" as const,
    code: unavailable.code as Extract<PrivateActivationCandidateTarget["disposition"], {
      readonly state: "unavailable";
    }>["code"],
    evidenceDigests: Object.freeze(evidence),
  });
}

function targetIdentity(value: unknown): RunTargetIdentity {
  const kind = value !== null && typeof value === "object"
    ? exactObjectField(value, "kind", "Hook target identity")
    : undefined;
  if (kind === "flow") {
    const target = exactObject(value, ["kind", "path"], "Hook Flow target identity");
    if (typeof target.path !== "string") throw new TypeError("Hook Flow target path is invalid");
    const path = normalizeProjectPath(target.path, "Hook Flow target path");
    if (isProtectedProjectPath(path)) throw new TypeError("Hook Flow target cannot be beneath .jig");
    return Object.freeze({ kind: "flow", path });
  }
  if (kind === "binding") {
    const target = exactObject(value, ["id", "kind"], "Hook Binding target identity");
    return Object.freeze({ kind: "binding", id: localName(target.id, "Hook Binding target ID") });
  }
  throw new TypeError("Hook target identity is invalid");
}

function exactObject(
  value: unknown,
  keys: readonly string[],
  label: string,
): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== "object" || utilTypes.isProxy(value)) {
    throw new TypeError(`${label} must be an ordinary object`);
  }
  if (Array.isArray(value)) {
    throw new TypeError(`${label} must be an ordinary object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must be an ordinary object`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.getOwnPropertySymbols(value).length !== 0) {
    throw new TypeError(`${label} has unexpected members`);
  }
  const actual = Object.keys(descriptors).sort(compareStrings);
  const expected = [...keys].sort(compareStrings);
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new TypeError(`${label} must contain exactly: ${expected.join(", ")}`);
  }
  const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of actual) {
    const descriptor = descriptors[key]!;
    if (!("value" in descriptor) || descriptor.enumerable !== true) {
      throw new TypeError(`${label} members must be enumerable data properties`);
    }
    output[key] = descriptor.value;
  }
  return output;
}

function exactObjectField(value: object, key: string, label: string): unknown {
  if (utilTypes.isProxy(value) || Array.isArray(value)) {
    throw new TypeError(`${label} must be an ordinary object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must be an ordinary object`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const descriptor = descriptors[key];
  if (descriptor === undefined || !("value" in descriptor) || descriptor.enumerable !== true) {
    throw new TypeError(`${label} must contain an enumerable ${key} data property`);
  }
  return descriptor.value;
}

function ordinaryArray(value: unknown, maximum: number, label: string): readonly unknown[] {
  if (value === null || typeof value !== "object" || utilTypes.isProxy(value) ||
      !Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    throw new TypeError(`${label} must be an ordinary array`);
  }
  if (value.length > maximum) throw new TypeError(`${label} exceed their bound`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const symbols = Object.getOwnPropertySymbols(value);
  if (symbols.length !== 0) throw new TypeError(`${label} have unexpected members`);
  const names = Object.keys(descriptors).filter((name) => name !== "length");
  if (names.length !== value.length) throw new TypeError(`${label} must be dense`);
  const result: unknown[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (descriptor === undefined || !("value" in descriptor) || descriptor.enumerable !== true) {
      throw new TypeError(`${label} must contain only enumerable data items`);
    }
    result.push(descriptor.value);
  }
  return result;
}

function decodeCanonical<T>(
  bytes: Uint8Array,
  normalize: (value: unknown) => T,
  label: string,
): T {
  if (bytes === null || typeof bytes !== "object" || utilTypes.isProxy(bytes) ||
      !(bytes instanceof Uint8Array) ||
      Object.getPrototypeOf(bytes) !== Uint8Array.prototype) {
    throw new TypeError(`${label} bytes must be an ordinary Uint8Array`);
  }
  const normalized = normalize(decodeJson1(bytes));
  if (!sameBytes(bytes, canonicalJson(normalized as unknown as JsonValue))) {
    throw new TypeError(`${label} is not canonical JSON/1`);
  }
  return normalized;
}

function localName(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length > 64 || !LOCAL_NAME.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function eventType(value: unknown): string {
  if (typeof value !== "string" || [...value].length < 1 || [...value].length > 512 ||
      value.startsWith(PROTECTED_EVENT_PREFIX)) {
    throw new TypeError("Hook Event type is invalid");
  }
  return value;
}

function digest(value: unknown, label: string): string {
  if (typeof value !== "string" || !DIGEST.test(value)) {
    throw new TypeError(`${label} digest is invalid`);
  }
  return value;
}

function exactString(value: unknown, expected: string, label: string): string {
  if (value !== expected) throw new TypeError(`${label} is not canonical`);
  return expected;
}

function positiveSafeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new TypeError(`${label} is invalid`);
  }
  return value as number;
}

function nonnegativeSafeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TypeError(`${label} is invalid`);
  }
  return value as number;
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && left.every((byte, index) => byte === right[index]);
}
