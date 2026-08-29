import type { JsonObject, JsonValue } from "../json.js";
import { JSON_1_LIMITS, validateJson1 } from "../json.js";
import {
  assertNoProjectPathCollisions,
  compareProjectPaths,
  normalizeProjectPath,
} from "./paths.js";

const LOCAL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const GLOB_CHARACTERS = /[*?\[\]{}]/;

export interface DiscoverySource {
  readonly kind: "discover";
  readonly roots: readonly string[];
}

export interface MembersSource {
  readonly kind: "members";
  readonly paths: readonly string[];
}

export type ProjectSource = DiscoverySource | MembersSource;
export type ProjectSourceInput = DiscoverySource | readonly string[];

export interface JigDefinition {
  readonly flows?: ProjectSource;
  readonly bindings?: ProjectSource;
}

export interface JigDefinitionInput {
  readonly flows?: ProjectSourceInput;
  readonly bindings?: ProjectSourceInput;
}

/** Private experimental overlay; not part of Project Authoring SDK/1. */
export interface PrivateHookJigDefinition extends JigDefinition {
  readonly hooks?: ProjectSource;
}

/** Private experimental overlay; not part of Project Authoring SDK/1. */
export interface PrivateHookJigDefinitionInput extends JigDefinitionInput {
  readonly hooks?: ProjectSourceInput;
}

export interface FlowRef {
  readonly kind: "flow";
  readonly path: string;
}

export interface BindingRef {
  readonly kind: "binding";
  readonly id: string;
}

export type RunTargetRef = FlowRef | BindingRef;

export interface CandidateSetRef {
  readonly kind: "candidates";
  readonly targets: readonly RunTargetRef[];
}

export type SlotRef = RunTargetRef | CandidateSetRef;

/** Private experimental marker; not part of Project Authoring SDK/1. */
export interface PrivateProjectRunTargetsRef {
  readonly kind: "project-run-targets";
}

/** Private experimental slot overlay; not part of Project Authoring SDK/1. */
export type PrivateProjectRunTargetsSlotRef = SlotRef | PrivateProjectRunTargetsRef;

export interface PackageBindingDefinition {
  readonly kind: "package";
  readonly package: string;
  readonly settings: JsonObject;
  readonly slots: Readonly<Record<string, SlotRef>>;
  readonly attachments: Readonly<Record<string, string>>;
}

export interface PackageBindingInput {
  readonly package: string;
  readonly settings?: JsonObject;
  readonly slots?: Readonly<Record<string, SlotRef>>;
  readonly attachments?: Readonly<Record<string, string>>;
}

/** Private experimental Binding overlay; not part of Project Authoring SDK/1. */
export interface PrivateProjectRunTargetsBindingDefinition
  extends Omit<PackageBindingDefinition, "slots"> {
  readonly slots: Readonly<Record<string, PrivateProjectRunTargetsSlotRef>>;
}

/** Private experimental Binding input; not part of Project Authoring SDK/1. */
export interface PrivateProjectRunTargetsBindingInput
  extends Omit<PackageBindingInput, "slots"> {
  readonly slots?: Readonly<Record<string, PrivateProjectRunTargetsSlotRef>>;
}

export interface JournalPublisherDefinition {
  readonly kind: "journal-publisher";
  readonly eventTypes: readonly string[];
}

export interface JournalPublisherInput {
  readonly eventTypes: readonly string[];
}

export interface HookDefinition {
  readonly kind: "hook";
  readonly on: {
    readonly publisher: BindingRef;
    readonly type: string;
  };
  readonly run: RunTargetRef;
}

export interface HookInput {
  readonly on: {
    readonly publisher: BindingRef;
    readonly type: string;
  };
  readonly run: RunTargetRef;
}

export type BindingDefinition = PackageBindingDefinition | JournalPublisherDefinition;

export function discover(roots: string | readonly string[]): DiscoverySource {
  const values = typeof roots === "string"
    ? [roots]
    : snapshotStringArray(roots, "roots");
  if (values.length === 0) throw new TypeError("discover() requires at least one root");
  return record({
    kind: "discover",
    roots: normalizeUniquePaths(values, "root", true),
  }) as unknown as DiscoverySource;
}

export function defineJig(input: JigDefinitionInput): JigDefinition {
  return normalizeJig(input, false);
}

/** Evaluator-only canonical re-normalization; absent from the package root. */
export function normalizeJigDefinition(input: unknown): JigDefinition {
  return normalizeJig(input as JigDefinitionInput, true);
}

function normalizeJig(input: JigDefinitionInput, canonical: boolean): JigDefinition {
  const captured = snapshotJsonObject(input, "Jig definition");
  assertClosedObject(captured, ["flows", "bindings"], "Jig definition");
  const output: { flows?: ProjectSource; bindings?: ProjectSource } = {};
  if (Object.hasOwn(captured, "flows")) {
    output.flows = normalizeSource(
      captured.flows as unknown as ProjectSourceInput,
      "flows",
      canonical,
    );
  }
  if (Object.hasOwn(captured, "bindings")) {
    output.bindings = normalizeSource(
      captured.bindings as unknown as ProjectSourceInput,
      "bindings",
      canonical,
    );
  }
  return record(output) as unknown as JigDefinition;
}

/** Private experimental project helper used only by the Hook vertical. */
export function definePrivateHookJig(input: PrivateHookJigDefinitionInput): PrivateHookJigDefinition {
  return normalizePrivateHookJig(input, false);
}

/** Evaluator-only normalization for the private Hook authoring overlay. */
export function normalizePrivateHookJigDefinition(input: unknown): PrivateHookJigDefinition {
  return normalizePrivateHookJig(input as PrivateHookJigDefinitionInput, true);
}

function normalizePrivateHookJig(
  input: PrivateHookJigDefinitionInput,
  canonical: boolean,
): PrivateHookJigDefinition {
  const captured = snapshotJsonObject(input, "experimental Hook Jig definition");
  assertClosedObject(captured, ["flows", "bindings", "hooks"], "experimental Hook Jig definition");
  const baseInput: JigDefinitionInput = {
    ...(Object.hasOwn(captured, "flows") ? { flows: captured.flows as unknown as ProjectSourceInput } : {}),
    ...(Object.hasOwn(captured, "bindings") ? { bindings: captured.bindings as unknown as ProjectSourceInput } : {}),
  };
  const base = normalizeJig(baseInput, canonical);
  const output: { flows?: ProjectSource; bindings?: ProjectSource; hooks?: ProjectSource } = { ...base };
  if (Object.hasOwn(captured, "hooks")) {
    output.hooks = normalizeSource(captured.hooks as unknown as ProjectSourceInput, "hooks", canonical);
  }
  return record(output) as unknown as PrivateHookJigDefinition;
}

export function defineBinding(input: PackageBindingInput): PackageBindingDefinition {
  return normalizeBinding(input, false, false) as PackageBindingDefinition;
}

/** Private experimental marker constructor; absent from the package root. */
export function projectRunTargets(): PrivateProjectRunTargetsRef {
  return record({ kind: "project-run-targets" }) as unknown as PrivateProjectRunTargetsRef;
}

/** Private experimental Binding helper; absent from the package root. */
export function definePrivateProjectRunTargetsBinding(
  input: PrivateProjectRunTargetsBindingInput,
): PrivateProjectRunTargetsBindingDefinition {
  return normalizeBinding(input, false, true) as PrivateProjectRunTargetsBindingDefinition;
}

/** Declare one canonical Jig Journal publisher with an exact authority ceiling. */
export function defineJournalPublisher(input: JournalPublisherInput): JournalPublisherDefinition {
  return normalizeJournalPublisher(input, false);
}

/** Evaluator-only canonical re-normalization; absent from the package root. */
export function normalizeJournalPublisherDefinition(input: unknown): JournalPublisherDefinition {
  return normalizeJournalPublisher(input as JournalPublisherInput, true);
}

/** Declare one exact inert Event-to-Run relation. */
export function defineHook(input: HookInput): HookDefinition {
  return normalizeHook(input, false);
}

/** Evaluator-only canonical re-normalization; absent from the package root. */
export function normalizeHookDefinition(input: unknown): HookDefinition {
  return normalizeHook(input as HookInput, true);
}

function normalizeHook(input: HookInput, canonical: boolean): HookDefinition {
  const captured = snapshotJsonObject(input, "Hook definition");
  assertClosedObject(captured, canonical ? ["kind", "on", "run"] : ["on", "run"], "Hook definition");
  if (canonical && captured.kind !== "hook") throw new TypeError("Hook kind must be hook");
  if (!Object.hasOwn(captured, "on") || !Object.hasOwn(captured, "run")) {
    throw new TypeError("Hook on and run are required");
  }
  const on = assertRecord(captured.on as unknown as HookInput["on"], "Hook on");
  assertClosedObject(on, ["publisher", "type"], "Hook on");
  if (!Object.hasOwn(on, "publisher") || !Object.hasOwn(on, "type")) {
    throw new TypeError("Hook on.publisher and on.type are required");
  }
  const publisher = normalizeRunTarget(on.publisher as RunTargetRef);
  if (publisher.kind !== "binding") throw new TypeError("Hook publisher must be a bindingRef()");
  const type = validateEventType(on.type);
  const run = normalizeRunTarget(captured.run as unknown as RunTargetRef);
  return record({
    kind: "hook",
    on: record({ publisher, type }),
    run,
  }) as unknown as HookDefinition;
}

function normalizeJournalPublisher(
  input: JournalPublisherInput,
  canonical: boolean,
): JournalPublisherDefinition {
  const captured = snapshotJsonObject(input, "Journal publisher definition");
  assertClosedObject(
    captured,
    canonical ? ["kind", "eventTypes"] : ["eventTypes"],
    "Journal publisher definition",
  );
  if (canonical && captured.kind !== "journal-publisher") {
    throw new TypeError("Journal publisher kind must be journal-publisher");
  }
  if (!Object.hasOwn(captured, "eventTypes")) {
    throw new TypeError("Journal publisher eventTypes are required");
  }
  const values = snapshotStringArray(
    captured.eventTypes as unknown as readonly string[],
    "Journal publisher eventTypes",
  );
  if (values.length === 0) {
    throw new TypeError("Journal publisher requires at least one event type");
  }
  if (values.length > JSON_1_LIMITS.containerEntries) {
    throw new TypeError("Journal publisher eventTypes exceed the JSON/1 container bound");
  }
  const eventTypes = values.map((value) => validateEventType(value));
  eventTypes.sort();
  for (let index = 1; index < eventTypes.length; index += 1) {
    if (eventTypes[index - 1] === eventTypes[index]) {
      throw new TypeError(`duplicate Journal event type ${eventTypes[index]}`);
    }
  }
  return record({ kind: "journal-publisher", eventTypes: Object.freeze(eventTypes) }) as unknown as JournalPublisherDefinition;
}

/** Evaluator-only canonical re-normalization; absent from the package root. */
export function normalizePackageBindingDefinition(input: unknown): PackageBindingDefinition {
  return normalizeBinding(input as PackageBindingInput, true, false) as PackageBindingDefinition;
}

/** Evaluator-only normalization for the private project-Run-target overlay. */
export function normalizePrivateProjectRunTargetsBindingDefinition(
  input: unknown,
): PrivateProjectRunTargetsBindingDefinition {
  return normalizeBinding(
    input as PrivateProjectRunTargetsBindingInput,
    true,
    true,
  ) as PrivateProjectRunTargetsBindingDefinition;
}

function normalizeBinding(
  input: PackageBindingInput | PrivateProjectRunTargetsBindingInput,
  canonical: boolean,
  allowProjectRunTargets: boolean,
): PackageBindingDefinition | PrivateProjectRunTargetsBindingDefinition {
  const captured = snapshotJsonObject(input, "Binding definition");
  assertClosedObject(
    captured,
    canonical
      ? ["kind", "package", "settings", "slots", "attachments"]
      : ["package", "settings", "slots", "attachments"],
    "Binding definition",
  );
  if (canonical && captured.kind !== "package") {
    throw new TypeError("Binding kind must be package");
  }
  if (!Object.hasOwn(captured, "package")) throw new TypeError("Binding package is required");
  const packagePath = normalizeProjectPath(captured.package, "package");
  const settings = Object.hasOwn(captured, "settings")
    ? expectJsonObject(captured.settings, "settings")
    : emptyRecord();
  const slots = Object.hasOwn(captured, "slots")
    ? normalizeSlots(
      captured.slots as unknown as Readonly<Record<string, PrivateProjectRunTargetsSlotRef>>,
      allowProjectRunTargets,
    )
    : emptyRecord();
  const attachments = Object.hasOwn(captured, "attachments")
    ? normalizeAttachments(captured.attachments as unknown as Readonly<Record<string, string>>)
    : emptyRecord();
  return record({ kind: "package", package: packagePath, settings, slots, attachments }) as unknown as PackageBindingDefinition;
}

export function flowRef(path: string): FlowRef {
  return record({ kind: "flow", path: normalizeProjectPath(path, "Flow reference") }) as unknown as FlowRef;
}

export function bindingRef(id: string): BindingRef {
  return record({ kind: "binding", id: validateLocalName(id, "Binding reference") }) as unknown as BindingRef;
}

export function candidates(targets: readonly RunTargetRef[]): CandidateSetRef {
  const input = snapshotJson(targets, "candidate targets");
  validateJson1(input);
  if (!Array.isArray(input)) throw new TypeError("candidate targets must be an array");
  if (input.length < 2) throw new TypeError("candidates() requires at least two targets");
  if (input.length > JSON_1_LIMITS.containerEntries) {
    throw new TypeError("candidate targets exceed the JSON/1 container bound");
  }
  const normalized = input.map((target) => normalizeRunTarget(target));
  normalized.sort(compareTargets);
  for (let index = 1; index < normalized.length; index += 1) {
    if (targetKey(normalized[index - 1]!) === targetKey(normalized[index]!)) {
      throw new TypeError(`duplicate candidate target ${targetKey(normalized[index]!)}`);
    }
  }
  return record({ kind: "candidates", targets: Object.freeze(normalized) }) as unknown as CandidateSetRef;
}

function normalizeSource(
  value: ProjectSourceInput | MembersSource | undefined,
  field: string,
  canonical: boolean,
): ProjectSource {
  if (value === undefined) throw new TypeError(`${field} cannot be undefined`);
  if (isReadonlyArray(value)) {
    return record({
      kind: "members",
      paths: normalizeUniquePaths(snapshotStringArray(value, field), `${field} member`, false),
    }) as unknown as MembersSource;
  }
  if ((value as ProjectSource).kind === "members") {
    if (!canonical) throw new TypeError(`${field} source must come from discover()`);
    const members = value as unknown as MembersSource;
    assertClosedObject(members, ["kind", "paths"], `${field} source`);
    return record({
      kind: "members",
      paths: normalizeUniquePaths(
        snapshotStringArray(members.paths, `${field} paths`),
        `${field} member`,
        false,
      ),
    }) as unknown as MembersSource;
  }
  assertClosedObject(value, ["kind", "roots"], `${field} source`);
  if (value.kind !== "discover") throw new TypeError(`${field} source has an invalid kind`);
  const roots = normalizeUniquePaths(
    snapshotStringArray(value.roots, `${field} roots`),
    `${field} root`,
    true,
  );
  if (roots.length === 0) throw new TypeError(`${field} discovery requires at least one root`);
  return record({ kind: "discover", roots }) as unknown as DiscoverySource;
}

function normalizeSlots(
  value: Readonly<Record<string, PrivateProjectRunTargetsSlotRef>> | undefined,
  allowProjectRunTargets: boolean,
): Readonly<Record<string, PrivateProjectRunTargetsSlotRef>> {
  const input = assertRecord(value, "slots");
  const output: Record<string, PrivateProjectRunTargetsSlotRef> = {};
  for (const key of sortedKeys(input)) {
    validateLocalName(key, "slot name");
    output[key] = normalizeSlot(input[key], allowProjectRunTargets);
  }
  return record(output);
}

function normalizeAttachments(
  value: Readonly<Record<string, string>> | undefined,
): Readonly<Record<string, string>> {
  const input = assertRecord(value, "attachments");
  const output: Record<string, string> = {};
  for (const key of sortedKeys(input)) {
    validateLocalName(key, "attachment name");
    output[key] = normalizeProjectPath(input[key], `attachment ${key}`);
  }
  return record(output);
}

function normalizeSlot(
  value: PrivateProjectRunTargetsSlotRef | undefined,
  allowProjectRunTargets: boolean,
): PrivateProjectRunTargetsSlotRef {
  if (value === undefined) throw new TypeError("slot value cannot be undefined");
  const object = assertRecord(value, "slot reference") as Partial<PrivateProjectRunTargetsSlotRef>;
  if (object.kind === "project-run-targets") {
    if (!allowProjectRunTargets) {
      throw new TypeError("projectRunTargets() is not part of Project Authoring SDK/1");
    }
    assertClosedObject(object, ["kind"], "slot reference");
    return projectRunTargets();
  }
  if (object.kind === "candidates") {
    assertClosedObject(object, ["kind", "targets"], "slot reference");
    // candidates() deliberately accepts only exact Run targets. A changing
    // source cannot be nested inside another candidate source.
    return candidates((object as Partial<CandidateSetRef>).targets!);
  }
  return normalizeRunTarget(object as RunTargetRef);
}

function normalizeRunTarget(value: RunTargetRef): RunTargetRef {
  const object = assertRecord(value, "Run target") as Partial<RunTargetRef>;
  if (object.kind === "flow") {
    assertClosedObject(object, ["kind", "path"], "Run target");
    return flowRef(object.path!);
  }
  if (object.kind === "binding") {
    assertClosedObject(object, ["kind", "id"], "Run target");
    return bindingRef(object.id!);
  }
  throw new TypeError("Run target must be a flowRef() or bindingRef()");
}

function normalizeUniquePaths(
  values: readonly unknown[],
  label: string,
  rejectGlob: boolean,
): readonly string[] {
  if (values.length > JSON_1_LIMITS.containerEntries) {
    throw new TypeError(`${label} values exceed the JSON/1 container bound`);
  }
  const paths = values.map((value) => {
    const path = normalizeProjectPath(value, label);
    if (rejectGlob && GLOB_CHARACTERS.test(path)) {
      throw new TypeError(`${label} cannot contain glob characters`);
    }
    return path;
  });
  paths.sort(compareProjectPaths);
  assertNoProjectPathCollisions(paths, label);
  return Object.freeze(paths);
}

function validateLocalName(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length > 64 || !LOCAL_NAME.test(value)) {
    throw new TypeError(`${label} must be a LocalName`);
  }
  return value;
}

function validateEventType(value: unknown): string {
  if (typeof value !== "string" || [...value].length === 0 || [...value].length > 512) {
    throw new TypeError("Journal event type must be a non-empty string of at most 512 characters");
  }
  if (value.startsWith("https://jig.dev/events/")) {
    throw new TypeError("Journal event type uses Jig's protected lifecycle namespace");
  }
  return value;
}

function snapshotJsonObject(value: unknown, label: string): JsonObject {
  const snapshot = snapshotJson(value, label);
  validateJson1(snapshot);
  return expectJsonObject(snapshot, label);
}

function expectJsonObject(value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as JsonObject;
}

function snapshotJson(
  value: unknown,
  label: string,
  active: WeakSet<object> = new WeakSet<object>(),
): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))) {
      throw new TypeError(`${label} contains an invalid JSON/1 number`);
    }
    return value;
  }
  if (typeof value !== "object") throw new TypeError(`${label} contains a non-JSON value`);
  if (active.has(value)) throw new TypeError(`${label} contains a cycle`);
  active.add(value);
  try {
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key === "symbol")) {
      throw new TypeError(`${label} contains a symbol property`);
    }
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) {
        throw new TypeError(`${label} contains an array subclass`);
      }
      const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
      if (lengthDescriptor === undefined || !("value" in lengthDescriptor)) {
        throw new TypeError(`${label} has an invalid array length`);
      }
      const length = lengthDescriptor.value as number;
      if (keys.length !== length + 1) {
        throw new TypeError(`${label} contains a sparse or extended array`);
      }
      const output: JsonValue[] = [];
      for (let index = 0; index < length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
          throw new TypeError(`${label} contains a sparse or accessor-backed array`);
        }
        output.push(snapshotJson(descriptor.value, label, active));
      }
      return Object.freeze(output);
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`${label} contains a non-plain object`);
    }
    const output: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>;
    for (const key of keys as string[]) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
        throw new TypeError(`${label} contains an accessor or hidden property`);
      }
      Object.defineProperty(output, key, {
        value: snapshotJson(descriptor.value, label, active),
        enumerable: true,
        writable: false,
        configurable: false,
      });
    }
    return Object.freeze(output);
  } finally {
    active.delete(value);
  }
}

function assertRecord<T extends object>(value: T | undefined, label: string): T {
  if (value === undefined || value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must be a plain object`);
  }
  if (Object.getOwnPropertySymbols(value).length !== 0) {
    throw new TypeError(`${label} cannot contain symbol properties`);
  }
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (!("value" in descriptor) || !descriptor.enumerable) {
      throw new TypeError(`${label}.${key} must be an enumerable data property`);
    }
  }
  return value;
}

function assertClosedObject<T extends object>(value: T, allowed: readonly string[], label: string): void {
  const object = assertRecord(value, label);
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(object)) {
    if (!allowedSet.has(key)) throw new TypeError(`${label} has unknown field ${key}`);
  }
}

function isReadonlyArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

function sortedKeys(value: object): string[] {
  return Object.keys(value).sort(compareUtf8);
}

function compareTargets(left: RunTargetRef, right: RunTargetRef): number {
  return compareUtf8(targetKey(left), targetKey(right));
}

function targetKey(target: RunTargetRef): string {
  return target.kind === "flow" ? `flow:${target.path}` : `binding:${target.id}`;
}

function snapshotStringArray(value: unknown, label: string): readonly string[] {
  const snapshot = snapshotJson(value, label);
  validateJson1(snapshot);
  if (!Array.isArray(snapshot) || snapshot.some((item) => typeof item !== "string")) {
    throw new TypeError(`${label} must be an array of strings`);
  }
  return snapshot as readonly string[];
}

function emptyRecord<T>(): Readonly<Record<string, T>> {
  return Object.freeze(Object.create(null) as Record<string, T>);
}

function record<T extends object>(value: T): Readonly<T> {
  const output = Object.create(null) as Record<string, unknown>;
  for (const key of sortedKeys(value)) {
    Object.defineProperty(output, key, {
      value: (value as Record<string, unknown>)[key],
      enumerable: true,
      writable: false,
      configurable: false,
    });
  }
  return Object.freeze(output) as Readonly<T>;
}

function compareUtf8(left: string, right: string): number {
  return compareProjectPaths(left, right);
}
