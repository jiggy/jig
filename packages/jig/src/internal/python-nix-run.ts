import { invalid } from "../diagnostics.js";
import { validateJson1, type JsonValue } from "../json.js";
import { inspectCapturedPackage } from "../package/inspect.js";
import {
  requirePrivateActivationRequest,
  type PrivateActivationRequest,
} from "../project/package-resolution.js";
import {
  RunHostSession,
  type RunHostLimits,
  type RunHostTerminal,
} from "../run/session.js";
import { privateDomainDigest } from "./identity.js";
import {
  PrivateLinuxFenceUnconfirmedError,
  requirePrivateLinuxCgroupBackend,
  requirePrivateLinuxBackendMechanismObservation,
  type PrivateLinuxBackendMechanismObservation,
  type PrivateLinuxCgroupLimits,
  type PrivateLinuxEnvelopeIdentity,
  type PrivateLinuxCgroupBackend,
} from "./linux-cgroup-backend.js";
import { captureStoredPackage, type PackageArtifactRef } from "./package-artifact-store.js";
import {
  materializeCapturedPackage,
  type PrivatePackageMaterialization,
} from "./package-materialization.js";
import {
  requirePrivatePythonNixRuntimeObservation,
  verifyPrivatePythonNixRuntime,
  type PrivatePythonNixRuntimeObservation,
} from "./python-nix-runtime.js";

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const RUN_ID = /^[a-z0-9][a-z0-9-]{0,47}$/;
const PREPARATION_FILES = new Set([
  "Pipfile",
  "Pipfile.lock",
  "pdm.lock",
  "poetry.lock",
  "pylock.toml",
  "pyproject.toml",
  "requirements.lock",
  "requirements.txt",
  "setup.cfg",
  "setup.py",
  "uv.lock",
]);
const FIXED_ENVIRONMENT = Object.freeze({
  PYTHONCOERCECLOCALE: "0",
  PYTHONDONTWRITEBYTECODE: "1",
  PYTHONUNBUFFERED: "1",
  PYTHONUTF8: "1",
});
const LOGICAL_LAUNCH = Object.freeze({
  packageDestination: "/component" as const,
  scratch: "/work" as const,
  entrypoint: "/component/flow.py" as const,
});
const AUTHORITY = Object.freeze({
  ambientEnvironment: false as const,
  attachments: false as const,
  capabilityCalls: false as const,
  extraHostFilesystem: false as const,
  flowCalls: false as const,
  network: false as const,
  scratch: "private-memory-accounted" as const,
});
const authenticCandidates = new WeakSet<object>();

export type PrivateExactLinuxLimits = Required<PrivateLinuxCgroupLimits>;

/** Backing intentionally retained because the Backend could not prove a fence. */
export class PrivatePythonMaterializationQuarantinedError extends Error {
  readonly materialization: PrivatePackageMaterialization;
  readonly materializationRoot: string;
  override readonly cause: unknown;

  constructor(materialization: PrivatePackageMaterialization, cause: unknown) {
    super("Python exact Run backing was retained because ownership was not fenced");
    this.name = "PrivatePythonMaterializationQuarantinedError";
    this.materialization = materialization;
    this.materializationRoot = materialization.root;
    this.cause = cause;
  }
}

/**
 * One retained, exact, invocation-local Python candidate. It is intentionally
 * not a lock record or an admission result: Nix GC roots, durable decoding,
 * and crash recovery do not exist yet.
 */
export interface PrivatePythonExactRunCandidate {
  readonly kind: "python-exact-run-candidate/1";
  readonly admissible: false;
  readonly digest: string;
  readonly adapterRevision: "python-nix-private-adapter/1";
  readonly launchPlannerRevision: "python-nix-linux-run/1";
  readonly requestDigest: string;
  readonly target: PrivateActivationRequest["target"];
  readonly packagePath: string;
  readonly package: PackageArtifactRef;
  readonly mode: "run";
  readonly entrypoint: Readonly<{ readonly path: "flow.py"; readonly suffix: "py" }>;
  readonly preparation: Readonly<{ readonly kind: "none" }>;
  readonly runtime: PrivatePythonNixRuntimeObservation;
  readonly backend: PrivateLinuxBackendMechanismObservation;
  readonly policyDigest: string;
  readonly environment: typeof FIXED_ENVIRONMENT;
  readonly runtimePredicates: readonly [];
  readonly authority: typeof AUTHORITY;
  readonly sandboxLimits: PrivateExactLinuxLimits;
  readonly runHostLimits: RunHostLimits;
  readonly logicalLaunch: typeof LOGICAL_LAUNCH;
}

export interface PrivatePythonExactRunCandidateInput {
  readonly storeRoot: string;
  readonly request: PrivateActivationRequest;
  readonly runtime: PrivatePythonNixRuntimeObservation;
  readonly backend: PrivateLinuxBackendMechanismObservation;
  readonly policyDigest: string;
  readonly sandboxLimits: PrivateExactLinuxLimits;
  readonly runHostLimits: RunHostLimits;
}

export interface PrivatePythonExactRunInvocation {
  readonly storeRoot: string;
  readonly candidate: PrivatePythonExactRunCandidate;
  readonly backend: PrivateLinuxCgroupBackend;
  readonly runId: string;
  readonly input: JsonValue;
  readonly deadlineUnixMs: number;
  readonly signal?: AbortSignal;
}

export interface PrivatePythonExactRunResult {
  readonly kind: "python-exact-run-result/1";
  readonly admissible: false;
  readonly candidateDigest: string;
  readonly terminal: RunHostTerminal;
  readonly envelope: PrivateLinuxEnvelopeIdentity;
  readonly terminationReason: string;
  readonly evidence: {
    readonly cpuStat: Readonly<Record<string, number>>;
    readonly memoryEvents: Readonly<Record<string, number>>;
    readonly pidsEvents: Readonly<Record<string, number>>;
  };
}

/** Plan one exact direct Run from retained Package/1 bytes. */
export async function planPrivatePythonExactRun(
  input: PrivatePythonExactRunCandidateInput,
): Promise<PrivatePythonExactRunCandidate> {
  const request = requirePrivateActivationRequest(input.request);
  const runtime = await verifyPrivatePythonNixRuntime(
    requirePrivatePythonNixRuntimeObservation(input.runtime),
  );
  const backend = requirePrivateLinuxBackendMechanismObservation(input.backend);
  requireDigest(input.policyDigest, "policy");
  const sandboxLimits = normalizeSandboxLimits(input.sandboxLimits);
  const runHostLimits = normalizeRunHostLimits(input.runHostLimits);
  requireExactPythonRequest(request);

  const captured = await captureStoredPackage(input.storeRoot, request.package);
  try {
    await requireExactPackage(captured, request);
  } finally {
    await captured.dispose();
  }

  const valueWithoutDigest = Object.freeze({
    kind: "python-exact-run-candidate/1" as const,
    admissible: false as const,
    adapterRevision: "python-nix-private-adapter/1" as const,
    launchPlannerRevision: "python-nix-linux-run/1" as const,
    requestDigest: request.digest,
    target: request.target,
    packagePath: request.packagePath,
    package: request.package,
    mode: "run" as const,
    entrypoint: Object.freeze({ path: "flow.py" as const, suffix: "py" as const }),
    preparation: Object.freeze({ kind: "none" as const }),
    runtime,
    backend,
    policyDigest: input.policyDigest,
    environment: FIXED_ENVIRONMENT,
    runtimePredicates: Object.freeze([]) as readonly [],
    authority: AUTHORITY,
    sandboxLimits,
    runHostLimits,
    logicalLaunch: LOGICAL_LAUNCH,
  });
  const candidate = Object.freeze({
    ...valueWithoutDigest,
    digest: privateDomainDigest(
      "JIG-Python-Exact-Run-Candidate/1",
      valueWithoutDigest as unknown as JsonValue,
    ),
  });
  authenticCandidates.add(candidate);
  return candidate;
}

export function requirePrivatePythonExactRunCandidate(
  value: unknown,
): PrivatePythonExactRunCandidate {
  if (value === null || typeof value !== "object" || !authenticCandidates.has(value)) {
    throw new TypeError("Python exact Run candidate was not produced by the private planner");
  }
  return value as PrivatePythonExactRunCandidate;
}

/** Execute one candidate; no alternative runtime, package, or Backend is selected. */
export async function executePrivatePythonExactRun(
  invocation: PrivatePythonExactRunInvocation,
): Promise<PrivatePythonExactRunResult> {
  const candidate = requirePrivatePythonExactRunCandidate(invocation.candidate);
  const backend = requirePrivateLinuxCgroupBackend(invocation.backend);
  validateInvocation(invocation);
  if (invocation.signal?.aborted) throw new Error("Python exact Run was cancelled before activation");
  if (Date.now() >= invocation.deadlineUnixMs) {
    throw new Error("Python exact Run deadline elapsed before activation");
  }

  await verifyPrivatePythonNixRuntime(candidate.runtime);
  const mechanism = await backend.observeMechanism();
  if (mechanism.digest !== candidate.backend.digest) {
    throw new Error("pinned Linux Backend mechanism observation changed");
  }

  const captured = await captureStoredPackage(invocation.storeRoot, candidate.package);
  let materialization: PrivatePackageMaterialization | undefined;
  let capturedOwned = true;
  try {
    const inspected = await requireExactPackage(captured, candidate);
    inspected.schemas.input?.validate(invocation.input, "RUN_INPUT_INVALID");
    materialization = await materializeCapturedPackage(captured);
    await captured.dispose();
    capturedOwned = false;

    if (invocation.signal?.aborted) throw new Error("Python exact Run was cancelled before launch");
    if (Date.now() >= invocation.deadlineUnixMs) {
      throw new Error("Python exact Run deadline elapsed before launch");
    }
    await verifyPrivatePythonNixRuntime(candidate.runtime);

    let component: Awaited<ReturnType<PrivateLinuxCgroupBackend["launch"]>>;
    try {
      component = await backend.launch({
        runId: invocation.runId,
        limits: candidate.sandboxLimits,
        readOnlyMounts: [
          ...candidate.runtime.closureStores.map((path) => ({ source: path, destination: path })),
          { source: materialization.root, destination: LOGICAL_LAUNCH.packageDestination },
        ],
        command: [candidate.runtime.executable, LOGICAL_LAUNCH.entrypoint],
        environment: candidate.environment,
        rootProcessMappings: false,
        entropyDevice: false,
        expectedMechanismDigest: candidate.backend.digest,
      }, invocation.signal);
    } catch (error) {
      if (error instanceof PrivateLinuxFenceUnconfirmedError) {
        // The materialized tree may still be referenced by an escaped payload.
        // Retaining it is safer than turning an ownership failure into deletion.
        const quarantined = materialization;
        materialization = undefined;
        throw new PrivatePythonMaterializationQuarantinedError(quarantined, error);
      }
      throw error;
    }

    let terminal: RunHostTerminal | undefined;
    let operationFailure: unknown;
    try {
      requireEnvelope(component.envelope, candidate);
      terminal = await new RunHostSession(component, {
        input: invocation.input,
        settings: Object.freeze(Object.create(null)),
        attachments: Object.freeze(Object.create(null)),
        scratch: LOGICAL_LAUNCH.scratch,
        deadlineUnixMs: invocation.deadlineUnixMs,
        ...(invocation.signal === undefined ? {} : { signal: invocation.signal }),
      }, candidate.runHostLimits).run();
      if (terminal.status === "succeeded") {
        inspected.schemas.result?.validate(terminal.result.output, "RUN_RESULT_INVALID");
      }
    } catch (error) {
      operationFailure = error;
    }

    const ownershipFailures: unknown[] = [];
    try {
      await component.terminate();
    } catch (error) {
      ownershipFailures.push(error);
    }
    const completion = await component.completion.then(
      (value) => value,
      (error) => {
        ownershipFailures.push(error);
        return undefined;
      },
    );
    if (completion === undefined || completion.fenced !== true || completion.cleanupError !== undefined) {
      const ownershipError = new Error("Python exact Run ended without a clean ownership fence");
      // Preserve mounted backing whenever the fence cannot be proven.
      const quarantined = materialization;
      materialization = undefined;
      ownershipFailures.push(quarantined === undefined
        ? ownershipError
        : new PrivatePythonMaterializationQuarantinedError(quarantined, ownershipError));
    }

    if (ownershipFailures.length === 0 && materialization !== undefined) {
      try {
        await materialization.dispose();
        materialization = undefined;
      } catch (error) {
        ownershipFailures.push(error);
      }
    }
    if (operationFailure !== undefined || ownershipFailures.length > 0) {
      throw new AggregateError(
        [...(operationFailure === undefined ? [] : [operationFailure]), ...ownershipFailures],
        "Python exact Run or its ownership cleanup failed",
      );
    }
    if (terminal === undefined) throw new Error("Python exact Run produced no terminal result");

    return Object.freeze({
      kind: "python-exact-run-result/1" as const,
      admissible: false as const,
      candidateDigest: candidate.digest,
      terminal,
      envelope: component.envelope,
      terminationReason: await component.terminationReason,
      evidence: await component.evidence,
    });
  } catch (operationError) {
    const failures: unknown[] = [];
    if (capturedOwned) {
      try {
        await captured.dispose();
      } catch (error) {
        failures.push(error);
      }
    }
    if (materialization !== undefined) {
      try {
        await materialization.dispose();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0) {
      throw new AggregateError(
        [operationError, ...failures],
        "Python exact Run failed and staging cleanup did not complete",
      );
    }
    throw operationError;
  }
}

async function requireExactPackage(
  captured: Awaited<ReturnType<typeof captureStoredPackage>>,
  request: Pick<PrivateActivationRequest, "package" | "entrypoint" | "mode">,
) {
  if (captured.digest !== request.package.digest) throw new Error("retained Package/1 digest changed");
  const preparationFile = captured.files.find((file) => PREPARATION_FILES.has(file.path));
  if (preparationFile !== undefined) {
    invalid(
      "PYTHON_PREPARATION_UNSUPPORTED",
      `the first exact Python recipe cannot prepare ${preparationFile.path}`,
      preparationFile.path,
    );
  }
  const inspected = await inspectCapturedPackage(captured);
  if (inspected.mode !== request.mode || inspected.entrypoint?.path !== request.entrypoint.path ||
      inspected.entrypoint.suffix !== request.entrypoint.suffix || inspected.entrypoint.selector !== undefined) {
    throw new Error("retained Python package no longer matches its exact request");
  }
  return inspected;
}

function requireExactPythonRequest(request: PrivateActivationRequest): void {
  if (request.target.kind !== "flow" || request.mode !== "run" || request.entrypoint.path !== "flow.py" ||
      request.entrypoint.suffix !== "py" || request.entrypoint.selector !== undefined) {
    invalid(
      "PYTHON_EXACT_RECIPE_UNSUPPORTED",
      "the first exact Python recipe accepts only a selector-free direct flow.py Run",
    );
  }
  if (Object.keys(request.settings).length !== 0 || Object.keys(request.attachments).length !== 0 ||
      Object.keys(request.slots).length !== 0) {
    invalid(
      "PYTHON_EXACT_RECIPE_UNSUPPORTED",
      "the first exact Python recipe accepts no settings, attachments, or slots",
    );
  }
}

function requireEnvelope(
  envelope: PrivateLinuxEnvelopeIdentity,
  candidate: PrivatePythonExactRunCandidate,
): void {
  if (envelope.mechanismDigest !== candidate.backend.digest ||
      envelope.rootProcessMappings || envelope.entropyDevice ||
      privateDomainDigest(
        "JIG-Python-Exact-Limits/1",
        envelope.limits as unknown as JsonValue,
      ) !== privateDomainDigest(
        "JIG-Python-Exact-Limits/1",
        candidate.sandboxLimits as unknown as JsonValue,
      )) {
    throw new Error("Linux Backend receipt differs from the exact Python candidate");
  }
}

function normalizeSandboxLimits(input: PrivateExactLinuxLimits): PrivateExactLinuxLimits {
  const keys = [
    "memoryBytes",
    "pids",
    "cpuQuotaMicros",
    "cpuPeriodMicros",
    "wallClockMs",
    "cleanupTimeoutMs",
  ] as const;
  requireExactKeys(input, keys, "sandbox limits");
  const limits = Object.freeze(Object.fromEntries(keys.map((key) => {
    const value = input[key];
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new TypeError(`${key} must be a positive safe integer`);
    }
    return [key, value];
  }))) as unknown as PrivateExactLinuxLimits;
  if (limits.cpuQuotaMicros > limits.cpuPeriodMicros * 1_000) {
    throw new RangeError("cpuQuotaMicros is outside the supported closed range");
  }
  return limits;
}

function normalizeRunHostLimits(input: RunHostLimits): RunHostLimits {
  const keys = ["cancellationGraceMs", "stdoutBytes", "stderrBytes", "capturedStderrBytes"] as const;
  requireExactKeys(input, keys, "Run host limits");
  const limits = Object.freeze(Object.fromEntries(keys.map((key) => {
    const value = input[key];
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new TypeError(`${key} must be a non-negative safe integer`);
    }
    return [key, value];
  }))) as unknown as RunHostLimits;
  if (limits.stdoutBytes < 16 * 1024 * 1024 + 1) {
    throw new TypeError("stdoutBytes must admit one maximum-size Run/1 frame and LF");
  }
  if (limits.cancellationGraceMs > 2_147_483_647) {
    throw new TypeError("cancellationGraceMs exceeds the timer range");
  }
  return limits;
}

function validateInvocation(invocation: PrivatePythonExactRunInvocation): void {
  if (typeof invocation.storeRoot !== "string" || !invocation.storeRoot.startsWith("/") ||
      invocation.storeRoot.includes("\0")) {
    throw new TypeError("storeRoot must be an absolute path");
  }
  if (!RUN_ID.test(invocation.runId)) throw new TypeError("runId must be a lower-kebab identifier");
  if (!Number.isSafeInteger(invocation.deadlineUnixMs) || invocation.deadlineUnixMs < 0) {
    throw new TypeError("deadlineUnixMs must be a non-negative safe integer");
  }
  validateJson1(invocation.input);
}

function requireDigest(value: string, label: string): void {
  if (typeof value !== "string" || !DIGEST.test(value)) {
    throw new TypeError(`${label} digest must be canonical SHA-256`);
  }
}

function requireExactKeys(
  value: object,
  expected: readonly string[],
  label: string,
): void {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be a record`);
  }
  const keys = Reflect.ownKeys(value);
  if (keys.length !== expected.length || expected.some((key) => !keys.includes(key))) {
    throw new TypeError(`${label} must contain exactly ${expected.join(", ")}`);
  }
}
