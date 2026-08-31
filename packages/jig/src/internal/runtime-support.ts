import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

import type { JsonValue } from "../json.js";
import { privateDomainDigest, privateFileDigest } from "./identity.js";

const SUPPORT_ID = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const MAX_CLOSURE_SOURCES = 4_096;
const authenticObservations = new WeakSet<object>();

/** Exact runtime bytes selected and retained by trusted host policy. */
export interface PrivateRuntimeSupportObservation {
  readonly kind: "runtime-support-observation/1";
  readonly digest: string;
  readonly supportId: string;
  readonly executablePath: string;
  readonly executableDigest: string;
  readonly closureSources: readonly string[];
}

export interface PrivateRuntimeSupportInput {
  /** Host-owned identity for this retained support set. */
  readonly supportId: string;
  readonly executablePath: string;
  readonly closureSources: readonly string[];
}

/**
 * Observe one exact runtime support set already retained by the host.
 *
 * This does not install, retain, discover, or select a runtime. The caller is
 * trusted host policy; every supplied source must already be canonical and
 * covered by a read-only mount. FLOW code never receives this function.
 */
export async function observePrivateRuntimeSupport(
  input: PrivateRuntimeSupportInput,
): Promise<PrivateRuntimeSupportObservation> {
  if (!SUPPORT_ID.test(input.supportId) || !Array.isArray(input.closureSources) ||
      input.closureSources.length === 0 || input.closureSources.length > MAX_CLOSURE_SOURCES) {
    throw new TypeError("runtime support input is invalid");
  }
  const requestedExecutable = normalizedAbsolute(input.executablePath, "runtime executable");
  const requestedSources = input.closureSources.map((source) =>
    normalizedAbsolute(source, "runtime support source")
  );
  if (new Set(requestedSources).size !== requestedSources.length) {
    throw new TypeError("runtime support contains duplicate sources");
  }

  const mountInfo = await readFile("/proc/self/mountinfo", "utf8");
  const executablePath = await realpath(requestedExecutable);
  if (executablePath !== requestedExecutable) {
    throw new Error("runtime executable must be canonical");
  }
  const executable = await stat(executablePath);
  if (!executable.isFile() || (executable.mode & 0o111) === 0) {
    throw new Error("runtime executable is unavailable");
  }

  const closureSources: string[] = [];
  for (const requested of requestedSources) {
    const source = await realpath(requested);
    if (source !== requested) throw new Error(`runtime support source must be canonical: ${requested}`);
    const information = await stat(source);
    if (!information.isFile() && !information.isDirectory()) {
      throw new Error(`runtime support source has an unsupported type: ${source}`);
    }
    requireReadOnlyMount(source, mountInfo);
    closureSources.push(source);
  }
  closureSources.sort();
  if (!closureSources.some((source) =>
    executablePath === source || executablePath.startsWith(`${source}/`)
  )) {
    throw new Error("runtime executable is outside the retained support set");
  }

  const executableDigest = await privateFileDigest(executablePath);
  const identity = Object.freeze({
    kind: "runtime-support-observation/1" as const,
    supportId: input.supportId,
    executablePath,
    executableDigest,
    closureSources: Object.freeze(closureSources),
  });
  const observation = Object.freeze({
    ...identity,
    digest: privateDomainDigest("JIG-Runtime-Support-Observation/1", identity as unknown as JsonValue),
  });
  authenticObservations.add(observation);
  return observation;
}

export function requirePrivateRuntimeSupportObservation(
  value: unknown,
): PrivateRuntimeSupportObservation {
  if (value === null || typeof value !== "object" || !authenticObservations.has(value) ||
      !Object.isFrozen(value)) {
    throw new TypeError("runtime support was not produced by the private host observer");
  }
  return value as PrivateRuntimeSupportObservation;
}

function normalizedAbsolute(value: string, label: string): string {
  if (typeof value !== "string" || !isAbsolute(value) || resolve(value) !== value || value.includes("\0")) {
    throw new TypeError(`${label} must be a normalized absolute path`);
  }
  return value;
}

function requireReadOnlyMount(path: string, mountInfo: string): void {
  const mounts = mountInfo.split("\n").flatMap((line) => {
    if (line.length === 0) return [];
    const separator = line.indexOf(" - ");
    if (separator === -1) return [];
    const fields = line.slice(0, separator).split(" ");
    if (fields.length < 6) return [];
    return [{ point: unescapeMount(fields[4]!), options: fields[5]!.split(",") }];
  }).filter(({ point }) => path === point || path.startsWith(`${point === "/" ? "" : point}/`))
    .sort((left, right) => right.point.length - left.point.length);
  const mount = mounts[0];
  if (mount === undefined || !mount.options.includes("ro") || mount.options.includes("rw")) {
    throw new Error(`runtime support is not covered by a read-only host mount: ${path}`);
  }
}

function unescapeMount(value: string): string {
  return value.replace(/\\([0-7]{3})/g, (_match, digits: string) =>
    String.fromCharCode(Number.parseInt(digits, 8)));
}
