import { CheckError, invalid } from "../diagnostics.js";
import type { JsonObject, JsonValue } from "../json.js";
import type { InspectedPackage } from "../package/inspect.js";
import { SchemaDiagnostic } from "../schema/index.js";
import {
  defineBinding,
  normalizePackageBindingDefinition,
  type BindingDefinition,
  type PackageBindingInput,
} from "./author.js";
import { isDirectRunEligible } from "./flow-source.js";
import {
  requireRetainedFlowInput,
  type RetainedFlowInput,
} from "./retained-flow.js";
import {
  assertNoProjectPathCollisions,
  compareProjectPaths,
  isProtectedProjectPath,
  normalizeProjectPath,
} from "./paths.js";

const LOCAL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_MEMBERS = 65_536;
const MAX_SEMANTIC_WORK = 1_000_000;
const authenticPackageProjects = new WeakSet<object>();

export interface InjectedBindingDeclaration {
  readonly sourcePath: string;
  readonly definition: unknown;
}

export interface PackageProjectInput {
  readonly flows: readonly RetainedFlowInput[];
  readonly bindings: readonly InjectedBindingDeclaration[];
}

export interface LinkedFlow {
  readonly provenance: RetainedFlowInput["provenance"];
  readonly package: RetainedFlowInput["package"];
  readonly mode: "run";
  readonly metadata: InspectedPackage["metadata"];
  readonly entrypoint?: InspectedPackage["entrypoint"];
  readonly skills: readonly string[];
  readonly directRun: boolean;
}

export type RunTargetIdentity =
  | { readonly kind: "flow"; readonly path: string }
  | { readonly kind: "binding"; readonly id: string };

export interface LinkedPackageBinding {
  readonly kind: "package";
  readonly id: string;
  readonly declarationPath: string;
  readonly packagePath: string;
  readonly settings: JsonObject;
  readonly attachments: Readonly<Record<string, {
    readonly source: string;
    readonly access: "read" | "read-write";
  }>>;
}

export interface PackageProjectValue {
  readonly flows: readonly LinkedFlow[];
  readonly bindings: readonly LinkedPackageBinding[];
}

interface PreparedBinding {
  readonly id: string;
  readonly declarationPath: string;
  readonly definition: BindingDefinition;
  readonly flow: PreparedFlow;
}

interface PreparedFlow {
  readonly value: LinkedFlow;
  readonly inspected: InspectedPackage;
}

/** Link retained Run packages and evaluated Binding values without I/O. */
export function linkPackageProject(
  input: PackageProjectInput,
  maximumActivationTargets?: number,
): PackageProjectValue {
  if (maximumActivationTargets !== undefined &&
      (!Number.isSafeInteger(maximumActivationTargets) || maximumActivationTargets < 1)) {
    throw new TypeError("maximum activation targets must be a positive safe integer");
  }
  const root = readClosedRecord(input, ["flows", "bindings"], "package project");
  const budget = new WorkBudget();
  const flows = prepareFlows(readBoundedArray(root.flows, "flows"), budget);
  const flowByPath = new Map(flows.map((flow) => [flow.value.provenance.projectPath, flow]));
  const preparedBindings = prepareBindings(
    readBoundedArray(root.bindings, "bindings"),
    flowByPath,
    budget,
  );
  const activationTargetCount = preparedBindings.length + flows.filter(
    ({ value }) => value.directRun,
  ).length;
  if (maximumActivationTargets !== undefined && activationTargetCount > maximumActivationTargets) {
    invalid(
      "PROJECT_ACTIVATION_TARGET_LIMIT",
      `project contains ${activationTargetCount} activation targets, exceeding the caller bound ${maximumActivationTargets}`,
    );
  }
  const value = Object.freeze({
    flows: Object.freeze(flows.map((flow) => flow.value)),
    bindings: Object.freeze(preparedBindings.map(linkBinding)),
  });
  authenticPackageProjects.add(value);
  return value;
}

export function requirePackageProjectValue(value: unknown): PackageProjectValue {
  if (value === null || typeof value !== "object" || !authenticPackageProjects.has(value)) {
    throw new TypeError("project was not produced by the package-project linker");
  }
  return value as PackageProjectValue;
}

function prepareFlows(values: readonly unknown[], budget: WorkBudget): readonly PreparedFlow[] {
  const flows = values.map((value) => {
    let retained: RetainedFlowInput;
    try {
      retained = requireRetainedFlowInput(value);
    } catch (error) {
      invalid("PROJECT_FLOW_NOT_RETAINED", errorText(error));
    }
    if (retained.package.digest !== retained.inspected.digest) {
      throw new Error("retained Flow invariant violated: Package/1 digest differs from inspection");
    }
    if (retained.inspected.mode !== "run") {
      invalid(
        "PROJECT_FLOW_MODE_UNSUPPORTED",
        "the direct alpha supports Run packages only",
        retained.provenance.projectPath,
      );
    }
    if (Object.keys(retained.inspected.metadata.uses ?? {}).length !== 0) {
      invalid(
        "PROJECT_FLOW_CAPABILITY_UNSUPPORTED",
        "the direct alpha does not configure Flow capabilities",
        retained.provenance.projectPath,
      );
    }
    budget.consume(
      1 + retained.inspected.skills.length +
      Object.keys(retained.inspected.metadata.attachments ?? {}).length,
    );
    const linked = Object.freeze({
      provenance: retained.provenance,
      package: retained.package,
      mode: "run" as const,
      metadata: retained.inspected.metadata,
      ...(retained.inspected.entrypoint === undefined
        ? {}
        : { entrypoint: retained.inspected.entrypoint }),
      skills: retained.inspected.skills,
      directRun: isDirectRunEligible(retained.inspected),
    });
    return Object.freeze({ value: linked, inspected: retained.inspected });
  });
  flows.sort((left, right) => compareProjectPaths(
    left.value.provenance.projectPath,
    right.value.provenance.projectPath,
  ));
  try {
    assertNoProjectPathCollisions(
      flows.map((flow) => flow.value.provenance.projectPath),
      "Flow member",
    );
  } catch (error) {
    invalid("PROJECT_FLOW_COLLISION", errorText(error));
  }
  return Object.freeze(flows);
}

function prepareBindings(
  values: readonly unknown[],
  flowByPath: ReadonlyMap<string, PreparedFlow>,
  budget: WorkBudget,
): readonly PreparedBinding[] {
  const bindings = values.map((value, index) => {
    const record = readClosedRecord(value, ["sourcePath", "definition"], `bindings[${index}]`);
    const declarationPath = normalizeProjectPath(
      record.sourcePath,
      `bindings[${index}] source path`,
    );
    if (isProtectedProjectPath(declarationPath)) {
      invalid(
        "PROJECT_BINDING_PROTECTED_PATH",
        "Binding declaration cannot be beneath .jig",
        declarationPath,
      );
    }
    const name = declarationPath.slice(declarationPath.lastIndexOf("/") + 1);
    if (!name.endsWith(".ts") || name.slice(0, -3).includes(".")) {
      invalid(
        "PROJECT_BINDING_DECLARATION_PATH",
        "Binding declaration must be named <LocalName>.ts",
        declarationPath,
      );
    }
    const id = name.slice(0, -3);
    if (!LOCAL_NAME.test(id) || id.length > 64) {
      invalid(
        "PROJECT_BINDING_ID",
        "Binding declaration basename must be a LocalName",
        declarationPath,
      );
    }
    let definition: BindingDefinition;
    try {
      const candidate = record.definition;
      definition = typeof candidate === "object" && candidate !== null &&
          Object.hasOwn(candidate, "kind")
        ? normalizePackageBindingDefinition(candidate)
        : defineBinding(candidate as PackageBindingInput);
    } catch (error) {
      invalid("PROJECT_BINDING_DECLARATION", errorText(error), declarationPath);
    }
    budget.consume(jsonWork(definition as unknown as JsonValue));
    const flow = flowByPath.get(definition.package);
    if (flow === undefined) {
      invalid(
        "PROJECT_BINDING_PACKAGE_MISSING",
        `Binding ${id} selects unknown Flow member ${definition.package}`,
        declarationPath,
        "/package",
      );
    }
    if (flow.inspected.entrypoint === undefined) {
      invalid(
        "PROJECT_BINDING_AGENT_REQUIRED",
        `Binding ${id} selects an instruction-only package but the direct alpha has no Agent provider`,
        declarationPath,
        "/package",
      );
    }
    validateSettings(definition.settings, flow.inspected, declarationPath);
    return Object.freeze({ id, declarationPath, definition, flow });
  });
  bindings.sort((left, right) => compareProjectPaths(left.id, right.id));
  assertUniqueBindings(bindings);
  return Object.freeze(bindings);
}

function linkBinding(prepared: PreparedBinding): LinkedPackageBinding {
  const { id, declarationPath, definition, flow } = prepared;
  return Object.freeze({
    kind: "package" as const,
    id,
    declarationPath,
    packagePath: definition.package,
    settings: definition.settings,
    attachments: linkAttachments(definition.attachments, flow.inspected, declarationPath),
  });
}

function linkAttachments(
  configured: Readonly<Record<string, string>>,
  inspected: InspectedPackage,
  path: string,
): LinkedPackageBinding["attachments"] {
  const declared = inspected.metadata.attachments ?? {};
  const configuredKeys = Object.keys(configured).sort(compareProjectPaths);
  const declaredKeys = Object.keys(declared).sort(compareProjectPaths);
  if (configuredKeys.join("\0") !== declaredKeys.join("\0")) {
    const differing = configuredKeys.find((name) => !Object.hasOwn(declared, name)) ??
      declaredKeys.find((name) => !Object.hasOwn(configured, name));
    invalid(
      "PROJECT_BINDING_ATTACHMENTS",
      "configured attachments must exactly match package attachment declarations",
      path,
      differing === undefined ? "/attachments" : attachmentPointer(differing),
    );
  }
  const output: Record<string, {
    readonly source: string;
    readonly access: "read" | "read-write";
  }> = Object.create(null) as Record<string, {
    readonly source: string;
    readonly access: "read" | "read-write";
  }>;
  for (const name of declaredKeys) {
    const source = configured[name]!;
    if (isProtectedProjectPath(source)) {
      invalid(
        "PROJECT_BINDING_ATTACHMENT_PROTECTED",
        `attachment ${name} cannot expose .jig`,
        path,
        attachmentPointer(name),
      );
    }
    output[name] = Object.freeze({ source, access: declared[name]! });
  }
  return freezeRecord(output);
}

function validateSettings(settings: JsonObject, inspected: InspectedPackage, path: string): void {
  if (inspected.schemas.settings === undefined) {
    if (Object.keys(settings).length !== 0) {
      invalid(
        "PROJECT_BINDING_SETTINGS_UNDECLARED",
        "package has no settings.schema.json but Binding settings are not empty",
        path,
        "/settings",
      );
    }
    return;
  }
  try {
    inspected.schemas.settings.validate(settings, "PROJECT_BINDING_SETTINGS_INVALID");
  } catch (error) {
    if (error instanceof SchemaDiagnostic) {
      throw new CheckError(
        "invalid",
        error.code,
        error.message,
        path,
        `/settings${error.instancePointer}`,
      );
    }
    throw error;
  }
}

class WorkBudget {
  private used = 0;

  consume(amount: number): void {
    this.used += amount;
    if (this.used > MAX_SEMANTIC_WORK) {
      invalid(
        "PROJECT_PACKAGE_WORK_LIMIT",
        `package-project semantic work exceeds ${MAX_SEMANTIC_WORK} units`,
      );
    }
  }
}

function jsonWork(value: JsonValue): number {
  if (value === null || typeof value !== "object") return 1;
  let work = 1;
  for (const child of Object.values(value)) work += jsonWork(child);
  return work;
}

function assertUniqueBindings(bindings: readonly PreparedBinding[]): void {
  const ids = new Set<string>();
  const paths: string[] = [];
  for (const binding of bindings) {
    if (ids.has(binding.id)) {
      invalid(
        "PROJECT_BINDING_COLLISION",
        `duplicate Binding ID ${binding.id}`,
        binding.declarationPath,
      );
    }
    ids.add(binding.id);
    paths.push(binding.declarationPath);
  }
  try {
    assertNoProjectPathCollisions(paths, "Binding declaration");
  } catch (error) {
    invalid("PROJECT_BINDING_COLLISION", errorText(error));
  }
}

function readBoundedArray(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) invalid("PROJECT_PACKAGE_INPUT", `${label} must be an array`);
  if (value.length > MAX_MEMBERS) {
    invalid("PROJECT_PACKAGE_LIMIT", `${label} exceeds ${MAX_MEMBERS} members`);
  }
  if (Object.getPrototypeOf(value) !== Array.prototype) {
    invalid("PROJECT_PACKAGE_INPUT", `${label} must be an ordinary array`);
  }
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1 || keys.some((key) =>
    typeof key !== "string" || (key !== "length" && !/^(0|[1-9][0-9]*)$/.test(key)))) {
    invalid("PROJECT_PACKAGE_INPUT", `${label} must not contain extra or symbolic properties`);
  }
  const output: unknown[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
      invalid("PROJECT_PACKAGE_INPUT", `${label} must not be sparse or accessor-backed`);
    }
    output.push(descriptor.value);
  }
  return output;
}

function readClosedRecord(
  value: unknown,
  fields: readonly string[],
  label: string,
): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    invalid("PROJECT_PACKAGE_INPUT", `${label} must be an object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    invalid("PROJECT_PACKAGE_INPUT", `${label} must be a plain object`);
  }
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string") || keys.length !== fields.length ||
      fields.some((field) => !keys.includes(field))) {
    invalid("PROJECT_PACKAGE_INPUT", `${label} must contain only ${fields.join(" and ")}`);
  }
  const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const field of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
      invalid("PROJECT_PACKAGE_INPUT", `${label}.${field} must be an enumerable data property`);
    }
    output[field] = descriptor.value;
  }
  return output;
}

function attachmentPointer(name: string): string {
  return `/attachments/${escapePointer(name)}`;
}

function escapePointer(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

function freezeRecord<T>(value: Record<string, T>): Readonly<Record<string, T>> {
  return Object.freeze(value);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
