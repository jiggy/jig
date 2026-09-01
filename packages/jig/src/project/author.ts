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

export interface FlowRef {
  readonly kind: "flow";
  readonly path: string;
}

export interface BindingRef {
  readonly kind: "binding";
  readonly id: string;
}

export type RunTargetRef = FlowRef | BindingRef;

export interface PackageBindingDefinition {
  readonly kind: "package";
  readonly package: string;
  readonly settings: JsonObject;
}

export interface PackageBindingInput {
  readonly package: string;
  readonly settings?: JsonObject;
}

export type BindingDefinition = PackageBindingDefinition;

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

export function defineBinding(input: PackageBindingInput): PackageBindingDefinition {
  return normalizeBinding(input, false);
}

export function flowRef(path: string): FlowRef {
  return record({ kind: "flow", path: normalizeProjectPath(path, "Flow reference") }) as unknown as FlowRef;
}

export function bindingRef(id: string): BindingRef {
  return record({ kind: "binding", id: validateLocalName(id, "Binding reference") }) as unknown as BindingRef;
}

/** Evaluator-only canonical re-normalization; absent from the package root. */
export function normalizePackageBindingDefinition(input: unknown): PackageBindingDefinition {
  return normalizeBinding(input as PackageBindingInput, true);
}

function normalizeBinding(
  input: PackageBindingInput,
  canonical: boolean,
): PackageBindingDefinition {
  const captured = snapshotJsonObject(input, "Binding definition");
  assertClosedObject(
    captured,
    canonical
      ? ["kind", "package", "settings"]
      : ["package", "settings"],
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
  return record({ kind: "package", package: packagePath, settings }) as unknown as PackageBindingDefinition;
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
