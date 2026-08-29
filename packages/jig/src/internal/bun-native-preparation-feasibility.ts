import { realpath, rmdir } from "node:fs/promises";

import {
  requirePrivateRuntimeSupportObservation,
  type PrivateRuntimeSupportObservation,
} from "./agent-sandbox-runtime-support.js";
import {
  normalizePrivateBunNativePreparedCandidate,
  type PrivateBunNativePreparedCandidate,
} from "./bun-native-prepared-candidate.js";
import { observePrivateBunNativePreparation } from "./bun-native-preparation.js";
import { privateFileDigest } from "./identity.js";
import {
  PrivateLinuxFenceUnconfirmedError,
  releasePrivateLinuxOwnerState,
  requirePrivateLinuxCgroupBackend,
  type PrivateLinuxCgroupBackend,
  type PrivateLinuxConfirmedEnforcementReceipt,
  type PrivateLinuxSealedOwner,
} from "./linux-cgroup-backend.js";
import { captureStoredPackage } from "./package-artifact-store.js";
import { materializeCapturedPackage } from "./package-materialization.js";
import {
  requirePrivateActivationRequest,
  type PrivateActivationRequest,
} from "../project/package-resolution.js";

const WORKER_DESTINATION = "/jig-bun-native-preparation-worker.js";
const PACKAGE_DESTINATION = "/package";
const BUN_POLICY = Object.freeze([
  "--no-env-file",
  "--no-install",
  "--config=/dev/null",
] as const);
const MAX_WALL_CLOCK_MS = 30_000;
const MAX_STDOUT_BYTES = 2 * 1024 * 1024;
const MAX_STDERR_BYTES = 64 * 1024;

const RESOURCE_LIMITS = Object.freeze({
  memoryBytes: 512 * 1024 * 1024,
  pids: 64,
  cpuQuotaMicros: 50_000,
  cpuPeriodMicros: 100_000,
  cancellationGraceMs: 1_000,
  cleanupTimeoutMs: 5_000,
});

/**
 * Ephemeral proof output only. This does not publish a prepared artifact,
 * durable owner, READY disposition, Runtime Adapter, or Sandbox Backend SPI.
 */
export interface PrivateBunNativePreparationFeasibilityResult {
  readonly candidate: PrivateBunNativePreparedCandidate;
  readonly workerDigest: string;
  readonly envelopeDigest: string;
  readonly enforcement: PrivateLinuxConfirmedEnforcementReceipt;
}

/**
 * Feasibility-only terminal: internal materialized backing remains retained
 * and this proof exposes no recovery handle. The operator must establish an
 * external fence before manual cleanup. A durable owner must replace this
 * limitation before preparation can participate in admission or readiness.
 */
export class PrivateBunNativePreparationFenceUnconfirmedError extends Error {
  override readonly cause: unknown;

  constructor(cause: unknown) {
    super("Bun native preparation ownership remained unconfirmed; mount backing was retained");
    this.name = "PrivateBunNativePreparationFenceUnconfirmedError";
    this.cause = cause;
  }
}

/**
 * Exercise one exact package-local archive in the existing private Linux
 * envelope. The worker must be a single host-selected Bun bundle; source-tree
 * imports are never mounted into the preparation owner.
 */
export async function runPrivateBunNativePreparationFeasibility(input: {
  readonly request: PrivateActivationRequest;
  readonly packageStoreRoot: string;
  readonly runtimeSupport: PrivateRuntimeSupportObservation;
  readonly backend: PrivateLinuxCgroupBackend;
  readonly workerBundlePath: string;
  readonly workerBundleDigest: string;
  readonly runId: string;
  readonly deadlineUnixMs: number;
  readonly signal?: AbortSignal;
}): Promise<PrivateBunNativePreparationFeasibilityResult> {
  const request = requirePrivateActivationRequest(input.request);
  const runtimeSupport = requirePrivateRuntimeSupportObservation(input.runtimeSupport);
  const backend = requirePrivateLinuxCgroupBackend(input.backend);
  const deadlineUnixMs = Math.min(input.deadlineUnixMs, Date.now() + MAX_WALL_CLOCK_MS);
  if (!Number.isSafeInteger(deadlineUnixMs) || deadlineUnixMs <= Date.now()) {
    throw new RangeError("Bun native preparation deadline elapsed before activation");
  }

  const observation = await observePrivateBunNativePreparation({
    request,
    packageStoreRoot: input.packageStoreRoot,
  });
  const workerBundlePath = await realpath(input.workerBundlePath);
  const [workerDigest, executableDigest] = await Promise.all([
    privateFileDigest(workerBundlePath),
    privateFileDigest(runtimeSupport.executablePath),
  ]);
  if (workerDigest !== input.workerBundleDigest) {
    throw new Error("Bun native preparation worker bundle no longer matches host selection");
  }
  if (executableDigest !== runtimeSupport.executableDigest) {
    throw new Error("Bun native preparation runtime no longer matches retained host support");
  }

  const captured = await captureStoredPackage(input.packageStoreRoot, request.package);
  let materialized: Awaited<ReturnType<typeof materializeCapturedPackage>> | undefined;
  let materializationError: unknown;
  let materializationFailed = false;
  try {
    materialized = await materializeCapturedPackage(captured);
  } catch (error) {
    materializationFailed = true;
    materializationError = error;
  }
  let captureDisposalError: unknown;
  let captureDisposalFailed = false;
  try {
    await captured.dispose();
  } catch (error) {
    captureDisposalFailed = true;
    captureDisposalError = error;
  }
  if (materializationFailed) {
    if (captureDisposalFailed) {
      throw new AggregateError(
        [materializationError, captureDisposalError],
        "Bun native preparation materialization and capture disposal both failed",
      );
    }
    throw materializationError;
  }
  if (materialized === undefined) {
    throw new Error("Bun native preparation materialization produced no backing");
  }
  if (captureDisposalFailed) {
    try {
      await materialized.dispose();
    } catch (cleanupError) {
      throw new AggregateError(
        [captureDisposalError, cleanupError],
        "Bun native preparation capture and materialization disposal both failed",
      );
    }
    throw captureDisposalError;
  }

  let sealed: PrivateLinuxSealedOwner | undefined;
  let safeToDispose = false;
  try {
    try {
      sealed = await backend.seal({
        runId: input.runId,
        limits: {
          ...RESOURCE_LIMITS,
          deadlineUnixMs,
        },
        readOnlyMounts: [
          ...runtimeSupport.closureSources.map((source) => ({ source, destination: source })),
          { source: materialized.root, destination: PACKAGE_DESTINATION },
          { source: workerBundlePath, destination: WORKER_DESTINATION },
        ],
        privateProcessFilesystem: true,
        privateRuntimeDevices: true,
        command: [
          runtimeSupport.executablePath,
          ...BUN_POLICY,
          WORKER_DESTINATION,
          "--archive",
          `${PACKAGE_DESTINATION}/${observation.dependency.memberPath}`,
        ],
        environment: {},
      });
    } catch (error) {
      safeToDispose = true;
      throw error;
    }

    let component;
    try {
      component = await sealed.admit(input.signal);
    } catch (error) {
      if (error instanceof PrivateLinuxFenceUnconfirmedError) {
        const recovered = await recoverAutomaticOwnerFence(backend, sealed, error);
        safeToDispose = true;
        try {
          await releaseRecoveredAutomaticOwner(sealed, recovered);
        } catch (cleanupError) {
          throw new AggregateError(
            [error, cleanupError],
            "Bun native preparation was fenced but owner-state cleanup failed",
          );
        }
      }
      safeToDispose = true;
      throw error;
    }

    const terminate = async (): Promise<void> => await component.terminate();
    const stdout = collectBounded(component.stdout, MAX_STDOUT_BYTES, "stdout", terminate);
    const stderr = collectBounded(component.stderr, MAX_STDERR_BYTES, "stderr", terminate);
    void stdout.catch(() => undefined);
    void stderr.catch(() => undefined);
    let enforcement: PrivateLinuxConfirmedEnforcementReceipt;
    try {
      await component.closeInput();
      enforcement = await component.enforcement;
      safeToDispose = true;
    } catch (error) {
      await component.terminate().catch(() => undefined);
      try {
        enforcement = await component.enforcement;
        safeToDispose = true;
      } catch (fenceError) {
        enforcement = await recoverAutomaticOwnerFence(backend, sealed, fenceError);
        safeToDispose = true;
        try {
          await releaseRecoveredAutomaticOwner(sealed, enforcement);
        } catch (cleanupError) {
          await Promise.allSettled([stdout, stderr]);
          throw new AggregateError(
            [error, cleanupError],
            "Bun native preparation was fenced but owner-state cleanup failed",
          );
        }
      }
      await Promise.allSettled([stdout, stderr]);
      throw error;
    }

    const [stdoutBytes, stderrBytes] = await Promise.all([stdout, stderr]);
    if (enforcement.stopReason !== "payload_exit" || enforcement.exitCode !== 0 ||
        enforcement.signal !== null) {
      throw new Error(
        `Bun native preparation exited ${enforcement.exitCode ?? enforcement.signal}: ${diagnostic(stderrBytes)}`,
      );
    }
    if (await privateFileDigest(workerBundlePath) !== workerDigest) {
      throw new Error("Bun native preparation worker bundle changed during execution");
    }

    const candidate = normalizePrivateBunNativePreparedCandidate(observation, stdoutBytes);
    return Object.freeze({
      candidate,
      workerDigest,
      envelopeDigest: component.envelope.sealedPlanDigest,
      enforcement,
    });
  } finally {
    if (safeToDispose) await materialized.dispose();
  }
}

async function recoverAutomaticOwnerFence(
  backend: PrivateLinuxCgroupBackend,
  sealed: PrivateLinuxSealedOwner,
  cause: unknown,
): Promise<PrivateLinuxConfirmedEnforcementReceipt> {
  try {
    return await backend.recoverFence(sealed.identity);
  } catch (recoveryError) {
    throw new PrivateBunNativePreparationFenceUnconfirmedError(
      new AggregateError([cause, recoveryError], "Bun native preparation fence recovery failed"),
    );
  }
}

async function releaseRecoveredAutomaticOwner(
  sealed: PrivateLinuxSealedOwner,
  receipt: PrivateLinuxConfirmedEnforcementReceipt,
): Promise<void> {
  await releasePrivateLinuxOwnerState(sealed.identity, receipt);
  await rmdir(sealed.identity.ownerStateParent);
}

async function collectBounded(
  source: AsyncIterable<Uint8Array>,
  maximum: number,
  label: string,
  terminate: () => Promise<void>,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  let overflow = false;
  try {
    for await (const value of source) {
      if (overflow) continue;
      const byteLength = value.byteLength;
      if (byteLength > maximum - total) {
        overflow = true;
        await terminate();
        continue;
      }
      total += byteLength;
      chunks.push(Buffer.from(value));
    }
  } catch (error) {
    await terminate().catch(() => undefined);
    throw error;
  }
  if (overflow) throw new Error(`Bun native preparation ${label} exceeds its byte bound`);
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total);
}

function diagnostic(bytes: Uint8Array): string {
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes).trim();
  return text.length === 0 ? "no diagnostic" : text.replace(/[\r\n]+/g, " ").slice(0, 2_048);
}
