import { realpath, readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

import { privateDomainDigest, privateFileDigest } from "./identity.js";
import { decodeJson1, type JsonValue } from "../json.js";

const LEASE_ID = /^[a-z0-9][a-z0-9-]{0,127}$/;
const NAR_HASH = /^sha256-[A-Za-z0-9+/]+={0,2}$/;
const MAX_OUTPUTS = 64;
const MAX_CLOSURE = 4_096;
const MAX_REFERENCES = 4_096;
const authenticObservations = new WeakSet<object>();

export interface PrivateRuntimeSupportObservation {
  readonly kind: "runtime-support-observation/1";
  readonly digest: string;
  readonly lease: {
    readonly id: string;
    readonly owner: "agent-sandbox";
    readonly scope: string;
    readonly retention: "until-sandbox-teardown";
    readonly receiptDigest: string;
  };
  readonly executablePath: string;
  readonly executableDigest: string;
  readonly closureSources: readonly string[];
}

export interface AgentSandboxRuntimeSupportOptions {
  readonly receiptsDirectory: string;
  readonly expectedLeaseId: string;
  readonly executablePath: string;
}

/**
 * Observe one runtime already retained by the agent-sandbox host.
 *
 * This is a private proof-host adapter. It consumes a bounded read-only
 * receipt and confers no Nix, lease-management, or package authority.
 */
export async function observeAgentSandboxRuntimeSupport(
  options: AgentSandboxRuntimeSupportOptions,
): Promise<PrivateRuntimeSupportObservation> {
  if (!isAbsolute(options.receiptsDirectory) || !LEASE_ID.test(options.expectedLeaseId)) {
    throw new TypeError("runtime support requires an absolute receipt directory and valid lease ID");
  }
  const [receiptsDirectory, executablePath, mountInfo] = await Promise.all([
    realpath(options.receiptsDirectory),
    realpath(options.executablePath),
    readFile("/proc/self/mountinfo", "utf8"),
  ]);
  if (receiptsDirectory !== resolve(options.receiptsDirectory)) {
    throw new Error("runtime receipt directory must be canonical");
  }
  requireReadOnlyMount(receiptsDirectory, mountInfo, "runtime receipt directory");

  const [leaseValue, runtimeValue] = await Promise.all([
    readReceipt(`${receiptsDirectory}/lease.json`, "runtime lease"),
    readReceipt(`${receiptsDirectory}/runtime-rootfs.json`, "runtime artifact"),
  ]);
  const lease = parseLease(leaseValue, options.expectedLeaseId, receiptsDirectory);
  const runtime = parseRuntimeReceipt(runtimeValue, lease.id);
  const entry = containingEntry(runtime.closure, executablePath);
  const closureSources = transitiveSources(runtime.closure, entry.path);
  for (const source of closureSources) {
    if (await realpath(source) !== source) {
      throw new Error(`runtime support member is not canonical: ${source}`);
    }
    requireReadOnlyMount(source, mountInfo, "runtime support member");
  }
  if (!runtime.outputPaths.every((path) => runtime.closure.has(path))) {
    throw new Error("runtime receipt output is absent from its declared closure");
  }

  const [executableDigest, receiptDigest] = await Promise.all([
    privateFileDigest(executablePath),
    privateDomainDigest("JIG-Agent-Sandbox-Runtime-Receipt/1", runtimeValue),
  ]);
  const identity = Object.freeze({
    kind: "runtime-support-observation/1" as const,
    lease: Object.freeze({
      id: lease.id,
      owner: lease.owner,
      scope: lease.scope,
      retention: lease.retention,
      receiptDigest,
    }),
    executablePath,
    executableDigest,
    closureSources: Object.freeze(closureSources),
  });
  const observation = Object.freeze({
    ...identity,
    digest: privateDomainDigest(
      "JIG-Runtime-Support-Observation/1",
      identity as unknown as JsonValue,
    ),
  });
  authenticObservations.add(observation);
  return observation;
}

export function requirePrivateRuntimeSupportObservation(
  value: unknown,
): PrivateRuntimeSupportObservation {
  if (value === null || typeof value !== "object" || !authenticObservations.has(value)) {
    throw new TypeError("runtime support was not produced by the private host observer");
  }
  return value as PrivateRuntimeSupportObservation;
}

interface ParsedLease {
  readonly id: string;
  readonly owner: "agent-sandbox";
  readonly scope: string;
  readonly retention: "until-sandbox-teardown";
}

interface ClosureEntry {
  readonly path: string;
  readonly references: readonly string[];
}

interface ParsedRuntimeReceipt {
  readonly outputPaths: readonly string[];
  readonly closure: ReadonlyMap<string, ClosureEntry>;
}

async function readReceipt(path: string, label: string): Promise<JsonValue> {
  try {
    return decodeJson1(await readFile(path));
  } catch (error) {
    throw new Error(`${label} receipt is unavailable or invalid: ${errorText(error)}`);
  }
}

function parseLease(value: JsonValue, expectedLeaseId: string, receiptsDirectory: string): ParsedLease {
  const root = exactRecord(
    value,
    ["lease_id", "owner", "receipt_directory", "retention", "schema_version", "scope"],
    "runtime lease receipt",
  );
  if (root.schema_version !== 1 || root.lease_id !== expectedLeaseId ||
      root.owner !== "agent-sandbox" || root.retention !== "until-sandbox-teardown" ||
      typeof root.scope !== "string" || root.scope.length === 0 || root.scope.length > 128 ||
      root.receipt_directory !== receiptsDirectory) {
    throw new Error("runtime lease receipt does not match the selected sandbox lease");
  }
  return Object.freeze({
    id: expectedLeaseId,
    owner: "agent-sandbox" as const,
    scope: root.scope,
    retention: "until-sandbox-teardown" as const,
  });
}

function parseRuntimeReceipt(value: JsonValue, leaseId: string): ParsedRuntimeReceipt {
  const root = exactRecord(
    value,
    ["artifact", "closure", "kind", "lease_id", "output_paths", "schema_version"],
    "runtime artifact receipt",
  );
  if (root.schema_version !== 1 || root.lease_id !== leaseId ||
      root.kind !== "runtime-artifact" || root.artifact !== "rootfs") {
    throw new Error("runtime artifact receipt does not match the selected sandbox lease");
  }
  const outputPaths = pathArray(root.output_paths, MAX_OUTPUTS, "runtime output paths");
  const rawClosure = boundedArray(root.closure, MAX_CLOSURE, "runtime closure");
  const closure = new Map<string, ClosureEntry>();
  for (const [index, raw] of rawClosure.entries()) {
    const entry = exactRecord(
      raw,
      ["narHash", "narSize", "path", "references"],
      `runtime closure entry ${index}`,
    );
    const path = absolutePath(entry.path, `runtime closure entry ${index}`);
    if (closure.has(path) || typeof entry.narHash !== "string" || !NAR_HASH.test(entry.narHash) ||
        typeof entry.narSize !== "number" || !Number.isSafeInteger(entry.narSize) || entry.narSize < 0) {
      throw new Error(`runtime closure entry ${index} has invalid identity evidence`);
    }
    closure.set(path, Object.freeze({
      path,
      references: pathArray(
        entry.references,
        MAX_REFERENCES,
        `runtime closure entry ${index} references`,
        true,
      ),
    }));
  }
  if (closure.size === 0) throw new Error("runtime closure is empty");
  for (const entry of closure.values()) {
    for (const reference of entry.references) {
      if (!closure.has(reference)) {
        throw new Error(`runtime closure reference is outside the receipt: ${reference}`);
      }
    }
  }
  return Object.freeze({ outputPaths, closure });
}

function containingEntry(
  closure: ReadonlyMap<string, ClosureEntry>,
  executablePath: string,
): ClosureEntry {
  const candidates = [...closure.values()].filter(({ path }) =>
    executablePath === path || executablePath.startsWith(`${path}/`)
  ).sort((left, right) => right.path.length - left.path.length);
  const entry = candidates[0];
  if (entry === undefined) throw new Error("selected runtime executable is outside the leased closure");
  return entry;
}

function transitiveSources(
  closure: ReadonlyMap<string, ClosureEntry>,
  start: string,
): string[] {
  const pending = [start];
  const selected = new Set<string>();
  while (pending.length > 0) {
    const path = pending.pop()!;
    if (selected.has(path)) continue;
    const entry = closure.get(path);
    if (entry === undefined) throw new Error(`runtime closure is missing ${path}`);
    selected.add(path);
    pending.push(...entry.references);
  }
  return [...selected].sort();
}

function requireReadOnlyMount(path: string, mountInfo: string, label: string): void {
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
    throw new Error(`${label} is not covered by a read-only host mount: ${path}`);
  }
}

function unescapeMount(value: string): string {
  return value.replace(/\\([0-7]{3})/g, (_match, digits: string) =>
    String.fromCharCode(Number.parseInt(digits, 8)));
}

function exactRecord(value: JsonValue, keys: readonly string[], label: string): Record<string, JsonValue> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} has unknown or missing fields`);
  }
  return value as Record<string, JsonValue>;
}

function boundedArray(
  value: JsonValue | undefined,
  maximum: number,
  label: string,
  allowEmpty = false,
): JsonValue[] {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0) || value.length > maximum) {
    throw new Error(`${label} must contain between ${allowEmpty ? 0 : 1} and ${maximum} entries`);
  }
  return value;
}

function pathArray(
  value: JsonValue | undefined,
  maximum: number,
  label: string,
  allowEmpty = false,
): readonly string[] {
  const values = boundedArray(value, maximum, label, allowEmpty).map((entry, index) =>
    absolutePath(entry, `${label} entry ${index}`));
  if (new Set(values).size !== values.length) throw new Error(`${label} contains duplicate paths`);
  return Object.freeze(values);
}

function absolutePath(value: JsonValue | undefined, label: string): string {
  if (typeof value !== "string" || !isAbsolute(value) || resolve(value) !== value || value.includes("\0")) {
    throw new Error(`${label} must be a normalized absolute path`);
  }
  return value;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
