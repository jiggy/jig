import { createHash } from "node:crypto";

import { CheckError, unavailable } from "../diagnostics.js";
import {
  decodeJson1,
  Json1Error,
  type JsonObject,
  type JsonValue,
} from "../json.js";
import { inspectCapturedPackage } from "../package/inspect.js";
import { validateLogicalPath } from "../package/paths.js";
import {
  requirePrivateActivationRequest,
  type PrivateActivationRequest,
} from "../project/package-resolution.js";
import { privateDomainDigest } from "./identity.js";
import { captureStoredPackage } from "./package-artifact-store.js";

const DEPENDENCY_KEY = "@flowmd/sdk";
const ENTRYPOINT = "flow.ts";
const SELECTOR = "bun";
const MANIFEST_PATH = "package.json";
const MANIFEST_LIMIT_BYTES = 65_536;
const ARCHIVE_LIMIT_BYTES = 1024 * 1024;
const LOCAL_ARCHIVE_PREFIX = "file:./";
const LOCAL_ARCHIVE_MEMBER = /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*\.tgz$/;
const OTHER_DEPENDENCY_FIELDS = Object.freeze([
  "bundleDependencies",
  "bundledDependencies",
  "catalog",
  "catalogs",
  "devDependencies",
  "optionalDependencies",
  "overrides",
  "patchedDependencies",
  "peerDependencies",
  "peerDependenciesMeta",
  "resolutions",
  "trustedDependencies",
  "workspaces",
] as const);

const authenticObservations = new WeakSet<object>();

export interface PrivateBunNativeDependency {
  readonly key: typeof DEPENDENCY_KEY;
  readonly memberPath: string;
  readonly memberSize: number;
  readonly memberDigest: string;
}

/**
 * One exact package-local dependency relation derived from retained Package/1
 * bytes. This value is inert inspection evidence, not a preparation plan,
 * installer invocation, prepared tree, or execution authority.
 */
export interface PrivateBunNativePreparationObservation {
  readonly kind: "private-bun-native-preparation-observation/1";
  readonly digest: string;
  readonly requestDigest: string;
  readonly packageDigest: string;
  readonly dependency: PrivateBunNativeDependency;
}

/**
 * Reacquire one retained Bun Run Binding and recognize only the first fixed
 * package-local @flowmd/sdk archive relation. Tar metadata is deliberately not
 * interpreted at this boundary.
 */
export async function observePrivateBunNativePreparation(input: {
  readonly request: PrivateActivationRequest;
  readonly packageStoreRoot: string;
}): Promise<PrivateBunNativePreparationObservation> {
  const request = requirePrivateActivationRequest(input.request);
  requireFirstBunRunBinding(request);

  const captured = await captureStoredPackage(input.packageStoreRoot, request.package);
  try {
    const inspected = await inspectCapturedPackage(captured);
    if (
      inspected.digest !== request.package.digest ||
      inspected.mode !== request.mode ||
      inspected.entrypoint?.path !== request.entrypoint.path ||
      inspected.entrypoint.suffix !== request.entrypoint.suffix ||
      inspected.entrypoint.selector !== request.entrypoint.selector
    ) {
      throw new Error("retained Package/1 no longer matches the Bun Run Binding activation request");
    }

    const manifestFile = captured.files.find((file) => file.path === MANIFEST_PATH);
    if (manifestFile === undefined) {
      unavailable(
        "BUN_NATIVE_MANIFEST_MISSING",
        `the first Bun native preparation requires exact ${MANIFEST_PATH}`,
        MANIFEST_PATH,
      );
    }
    if (manifestFile.size > MANIFEST_LIMIT_BYTES) {
      unavailable(
        "BUN_NATIVE_MANIFEST_LIMIT",
        `${MANIFEST_PATH} exceeds the ${MANIFEST_LIMIT_BYTES}-byte first-preparation limit`,
        MANIFEST_PATH,
      );
    }

    const manifest = parseManifest(await captured.read(MANIFEST_PATH, MANIFEST_LIMIT_BYTES));
    if (captured.files.some((file) =>
      file.path === "node_modules" || file.path.startsWith("node_modules/"))) {
      unavailable(
        "BUN_NATIVE_SOURCE_CONFLICT",
        "the first Bun native preparation requires Package/1 to contain no node_modules tree",
      );
    }
    rejectOtherDependencyFields(manifest);
    const dependencies = requireJsonObject(
      manifest.dependencies,
      "Bun native package.json dependencies",
      MANIFEST_PATH,
      "/dependencies",
    );
    const dependencyKeys = Object.keys(dependencies);
    if (dependencyKeys.length !== 1 || dependencyKeys[0] !== DEPENDENCY_KEY) {
      unavailable(
        "BUN_NATIVE_DEPENDENCY_SET",
        `package.json dependencies must contain exactly ${DEPENDENCY_KEY}`,
        MANIFEST_PATH,
        "/dependencies",
      );
    }
    const specifier = dependencies[DEPENDENCY_KEY];
    if (typeof specifier !== "string" || !specifier.startsWith(LOCAL_ARCHIVE_PREFIX)) {
      unavailable(
        "BUN_NATIVE_DEPENDENCY_SOURCE",
        `${DEPENDENCY_KEY} must use one normalized relative file:./ archive`,
        MANIFEST_PATH,
        "/dependencies/@flowmd~1sdk",
      );
    }
    let memberPath: string;
    try {
      memberPath = validateLogicalPath(specifier.slice(LOCAL_ARCHIVE_PREFIX.length));
    } catch (error) {
      if (error instanceof CheckError) {
        unavailable(
          "BUN_NATIVE_DEPENDENCY_SOURCE",
          `${DEPENDENCY_KEY} must refer to one normalized portable .tgz member`,
          MANIFEST_PATH,
          "/dependencies/@flowmd~1sdk",
        );
      }
      throw error;
    }
    if (!LOCAL_ARCHIVE_MEMBER.test(memberPath)) {
      unavailable(
        "BUN_NATIVE_DEPENDENCY_SOURCE",
        `${DEPENDENCY_KEY} must refer to one normalized portable .tgz member`,
        MANIFEST_PATH,
        "/dependencies/@flowmd~1sdk",
      );
    }
    const member = captured.files.find((file) => file.path === memberPath);
    if (member === undefined) {
      unavailable(
        "BUN_NATIVE_DEPENDENCY_MISSING",
        `package-local dependency member ${memberPath} is missing`,
        memberPath,
      );
    }
    if (member.size > ARCHIVE_LIMIT_BYTES) {
      unavailable(
        "BUN_NATIVE_DEPENDENCY_LIMIT",
        `${memberPath} exceeds the ${ARCHIVE_LIMIT_BYTES}-byte first-preparation limit`,
        memberPath,
      );
    }

    const hash = createHash("sha256");
    for await (const chunk of captured.stream(memberPath, ARCHIVE_LIMIT_BYTES)) hash.update(chunk);
    const dependency = Object.freeze({
      key: DEPENDENCY_KEY,
      memberPath,
      memberSize: member.size,
      memberDigest: `sha256:${hash.digest("hex")}`,
    });
    const identity = Object.freeze({
      kind: "private-bun-native-preparation-observation/1" as const,
      requestDigest: request.digest,
      packageDigest: request.package.digest,
      dependency,
    });
    const observation = Object.freeze({
      ...identity,
      digest: privateDomainDigest(
        "JIG-Private-Bun-Native-Preparation-Observation/1",
        identity as unknown as JsonValue,
      ),
    });
    authenticObservations.add(observation);
    return observation;
  } finally {
    await captured.dispose();
  }
}

export function requirePrivateBunNativePreparationObservation(
  value: unknown,
): PrivateBunNativePreparationObservation {
  if (value === null || typeof value !== "object" || !authenticObservations.has(value)) {
    throw new TypeError("Bun native preparation observation was not produced by private inspection");
  }
  return value as PrivateBunNativePreparationObservation;
}

function requireFirstBunRunBinding(request: PrivateActivationRequest): void {
  if (
    request.mode !== "run" ||
    request.target.kind !== "binding" ||
    request.entrypoint.path !== ENTRYPOINT ||
    request.entrypoint.suffix !== "ts" ||
    (request.entrypoint.selector !== undefined && request.entrypoint.selector !== SELECTOR)
  ) {
    throw new TypeError(
      "first Bun native preparation requires one matching flow.ts Run Binding activation; direct Flows are not yet covered",
    );
  }
}

function parseManifest(bytes: Uint8Array): JsonObject {
  let value: JsonValue;
  try {
    value = decodeJson1(bytes);
  } catch (error) {
    if (error instanceof Json1Error) {
      unavailable(
        "BUN_NATIVE_MANIFEST_INVALID",
        `package.json is not strict JSON/1: ${error.message}`,
        MANIFEST_PATH,
      );
    }
    throw error;
  }
  return requireJsonObject(value, "Bun native package.json", MANIFEST_PATH);
}

function requireJsonObject(
  value: JsonValue | undefined,
  label: string,
  path: string,
  pointer?: string,
): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    unavailable("BUN_NATIVE_MANIFEST_SHAPE", `${label} must be an object`, path, pointer);
  }
  return value as JsonObject;
}

function rejectOtherDependencyFields(manifest: JsonObject): void {
  for (const field of OTHER_DEPENDENCY_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(manifest, field)) {
      unavailable(
        "BUN_NATIVE_DEPENDENCY_SET",
        `the first Bun native preparation does not support package.json ${field}`,
        MANIFEST_PATH,
        `/${field}`,
      );
    }
  }
}
