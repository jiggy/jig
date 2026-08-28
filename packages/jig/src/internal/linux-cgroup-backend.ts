import { randomBytes } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { link, lstat, mkdir, mkdtemp, open, readFile, readdir, realpath, rm, rmdir, stat, statfs, unlink } from "node:fs/promises";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { types as utilTypes } from "node:util";

import { privateDomainDigest, privateFileDigest } from "./identity.js";
import type { JsonValue } from "../json.js";
import type { ExactComponentExit, ExactComponentProcess } from "../run/session.js";

const RUN_ID = /^[a-z0-9][a-z0-9-]{0,47}$/;
const ENVIRONMENT_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const CONTROL_BYTES = 64 * 1024;
const CGROUP2_SUPER_MAGIC = 0x63677270;
const DEVPTS_SUPER_MAGIC = 0x1cd1;
const PROC_SUPER_MAGIC = 0x9fa0;
const SYSFS_SUPER_MAGIC = 0x62656572;
const PRIVATE_NULL_SOURCE = "@jig-private-null@";
const PRIVATE_URANDOM_SOURCE = "@jig-private-urandom@";
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const NONCE = /^[0-9a-f]{24}$/;
const HELPER_BUN_POLICY = Object.freeze([
  "--no-env-file",
  "--no-install",
  "--config=/dev/null",
] as const);
const EMPTY_ROOT_ENVIRONMENT = 'cd -- / && exec -c -- "$@"';
const authenticBackends = new WeakSet<object>();

export interface PrivateLinuxCgroupLimits {
  readonly memoryBytes: number;
  readonly pids: number;
  readonly cpuQuotaMicros: number;
  readonly cpuPeriodMicros: number;
  readonly deadlineUnixMs: number;
  readonly cancellationGraceMs: number;
  readonly cleanupTimeoutMs?: number;
}

export interface PrivateLinuxReadOnlyMount {
  readonly source: string;
  readonly destination: string;
}

interface PrivateLinuxSealedReadOnlyMount extends PrivateLinuxReadOnlyMount {
  readonly sourceDevice: string;
  readonly sourceInode: string;
  readonly sourceType: "directory" | "file";
}

interface PrivateLinuxSealedLaunchPlan extends Omit<PrivateLinuxLaunchPlan, "readOnlyMounts"> {
  readonly readOnlyMounts: readonly PrivateLinuxSealedReadOnlyMount[];
}

export interface PrivateLinuxLaunchPlan {
  readonly runId: string;
  readonly limits: PrivateLinuxCgroupLimits;
  readonly readOnlyMounts: readonly PrivateLinuxReadOnlyMount[];
  readonly command: readonly [string, ...string[]];
  readonly environment?: Readonly<Record<string, string>>;
  /** Backend-owned runtime predicate; never package-selected. */
  readonly privateProcessFilesystem?: boolean;
  /** Backend-owned runtime predicate; never package-selected. */
  readonly privateRuntimeDevices?: boolean;
  /** Backend-owned exact helper override; never package-selected. */
  readonly trustedHelperPath?: string;
}

export interface PrivateLinuxCgroupBackendOptions {
  readonly cgroupScope: string;
  readonly sudoPath: string;
  readonly subreaperPath: string;
  readonly mknodPath: string;
  readonly bunPath: string;
  readonly bubblewrapPath: string;
  readonly bashPath: string;
  readonly payloadUid: number;
  readonly payloadGid: number;
  readonly helperPath?: string;
  readonly launchWrapperPath?: string;
  readonly recoveryHelperPath?: string;
  readonly startupTimeoutMs?: number;
}

export interface PrivateLinuxOwnerStateLocation {
  readonly parent: string;
  readonly name: string;
}

/** No-effect identity which trusted durable state records before mkdir/spawn. */
export interface PrivateLinuxOwnerStateAllocationIdentity {
  readonly kind: "private-linux-owner-state-allocation/1";
  readonly digest: string;
  readonly parent: string;
  readonly parentDevice: string;
  readonly parentInode: string;
  readonly name: string;
  readonly directory: string;
  readonly ownerToken: string;
}

export interface PrivateLinuxOwnerStateCancellation {
  readonly kind: "private-linux-owner-state-cancellation/1";
  readonly digest: string;
  readonly allocationDigest: string;
  readonly directoryDevice: string;
  readonly directoryInode: string;
  readonly state: "cancelled";
}

export interface PrivateLinuxOwnerStateReleaseReceipt {
  readonly kind: "private-linux-owner-state-release/1";
  readonly digest: string;
  readonly allocationDigest: string;
  readonly directoryDevice: string;
  readonly directoryInode: string;
  readonly released: true;
}

/** Serializable identity fixed before a sealed owner may execute package bytes. */
export interface PrivateLinuxSealedOwnerIdentity {
  readonly kind: "private-linux-sealed-owner/1";
  readonly digest: string;
  readonly runId: string;
  readonly nonce: string;
  readonly ownerToken: string;
  readonly mechanismDigest: string;
  readonly sealedPlanDigest: string;
  readonly cgroupScope: string;
  readonly cgroupScopeDevice: string;
  readonly cgroupScopeInode: string;
  readonly parentName: string;
  readonly parentCgroup: string;
  readonly supervisorCgroup: string;
  readonly runCgroup: string;
  readonly privateDeviceDirectory: string;
  readonly deadlineUnixMs: number;
  readonly cancellationGraceMs: number;
  readonly cleanupTimeoutMs: number;
  readonly trustedHelperPath: string;
  readonly trustedHelperDigest: string;
  readonly ownerStateParent: string;
  readonly ownerStateParentDevice: string;
  readonly ownerStateParentInode: string;
  readonly ownerStateName: string;
  readonly ownerStateDirectory: string;
  readonly ownerStateDevice: string;
  readonly ownerStateInode: string;
  readonly ownerStateAllocationDigest: string;
}

/** Emitted only after the trusted helper is inside the exact supervisor. */
export interface PrivateLinuxPreparedOwnerIdentity {
  readonly kind: "private-linux-prepared-owner/1";
  readonly digest: string;
  readonly owner: PrivateLinuxSealedOwnerIdentity;
}

export interface PrivateLinuxConfirmedEnforcementReceipt {
  readonly kind: "private-linux-confirmed-enforcement/1";
  readonly ownerDigest: string;
  readonly stopReason: "cancelled" | "coordinator_lost" | "deadline" | "payload_exit" | "setup_failed" | "recovered";
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly fenced: true;
  readonly setupError?: string;
  readonly killError?: string;
  readonly evidence: {
    readonly cpuStat: Readonly<Record<string, number>>;
    readonly memoryEvents: Readonly<Record<string, number>>;
    readonly pidsEvents: Readonly<Record<string, number>>;
  };
}

export interface PrivateLinuxSealedOwner {
  readonly identity: PrivateLinuxSealedOwnerIdentity;
  admit(
    signal?: AbortSignal,
    beforeAdmission?: (prepared: PrivateLinuxPreparedOwnerIdentity) => Promise<void>,
  ): Promise<PrivateLinuxComponentProcess>;
}

export interface PrivateLinuxEnvelopeIdentity {
  readonly kind: "linux-cgroup-v2-bubblewrap/1";
  readonly trustedHelperPath: string;
  readonly trustedHelperDigest: string;
  readonly trustedLaunchWrapperPath: string;
  readonly trustedLaunchWrapperDigest: string;
  readonly trustedRecoveryHelperPath: string;
  readonly trustedRecoveryHelperDigest: string;
  readonly trustedBubblewrapPath: string;
  readonly trustedBubblewrapDigest: string;
  readonly trustedCoordinatorBunPath: string;
  readonly trustedCoordinatorBunDigest: string;
  readonly trustedLauncherPath: string;
  readonly trustedLauncherDigest: string;
  readonly trustedSubreaperPath: string;
  readonly trustedSubreaperDigest: string;
  readonly trustedMknodPath: string;
  readonly trustedMknodTargetPath: string;
  readonly trustedMknodDigest: string;
  readonly trustedBashPath: string;
  readonly trustedBashDigest: string;
  readonly trustedBackendPath: string;
  readonly trustedBackendDigest: string;
  readonly cgroupVersion: 2;
  readonly controllers: readonly ["cpu", "memory", "pids"];
  readonly scopeEmpty: true;
  readonly launcherMode: "sudo-n";
  readonly mechanismDigest: string;
  readonly sealedPlanDigest: string;
  readonly payloadUid: number;
  readonly payloadGid: number;
  readonly limits: PrivateLinuxCgroupLimits;
  readonly privateProcessFilesystem: boolean;
  readonly privateRuntimeDevices: boolean;
}

export interface PrivateLinuxBackendMechanismObservation {
  readonly kind: "linux-cgroup-v2-bubblewrap-mechanism/1";
  readonly digest: string;
  readonly cgroupScope: string;
  readonly trustedHelperPath: string;
  readonly trustedHelperDigest: string;
  readonly trustedLaunchWrapperPath: string;
  readonly trustedLaunchWrapperDigest: string;
  readonly trustedRecoveryHelperPath: string;
  readonly trustedRecoveryHelperDigest: string;
  readonly trustedBubblewrapPath: string;
  readonly trustedBubblewrapDigest: string;
  readonly trustedCoordinatorBunPath: string;
  readonly trustedCoordinatorBunDigest: string;
  readonly trustedLauncherPath: string;
  readonly trustedLauncherDigest: string;
  readonly trustedSubreaperPath: string;
  readonly trustedSubreaperDigest: string;
  readonly trustedMknodPath: string;
  readonly trustedMknodTargetPath: string;
  readonly trustedMknodDigest: string;
  readonly trustedBashPath: string;
  readonly trustedBashDigest: string;
  readonly trustedBackendPath: string;
  readonly trustedBackendDigest: string;
  readonly cgroupVersion: 2;
  readonly cgroupScopeDevice: string;
  readonly cgroupScopeInode: string;
  readonly controllers: readonly ["cpu", "memory", "pids"];
  readonly scopeEmpty: true;
  readonly launcherMode: "sudo-n";
  readonly payloadUid: number;
  readonly payloadGid: number;
  readonly startupTimeoutMs: number;
}

/** A launch failed after ownership became ambiguous; mounted backing must remain retained. */
export class PrivateLinuxFenceUnconfirmedError extends Error {
  override readonly cause: unknown;

  constructor(cause: unknown) {
    super("cgroup launch failed without a confirmed ownership fence");
    this.name = "PrivateLinuxFenceUnconfirmedError";
    this.cause = cause;
  }
}

interface HelperReady {
  readonly type: "ready";
  readonly parentCgroup: string;
  readonly runCgroup: string;
  readonly payloadPid: number;
}

interface HelperPrepared {
  readonly type: "prepared";
  readonly parentCgroup: string;
  readonly supervisorCgroup: string;
  readonly runCgroup: string;
}

interface HelperTerminal {
  readonly type: "terminal";
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly reason: string;
  readonly fenced: boolean;
  readonly setupError?: string;
  readonly killError?: string;
  readonly cleanupError?: string;
  readonly evidence: {
    readonly cpuStat: Readonly<Record<string, number>>;
    readonly memoryEvents: Readonly<Record<string, number>>;
    readonly pidsEvents: Readonly<Record<string, number>>;
  };
}

interface RecoveryFenceMessage {
  readonly type: "fenced";
  readonly ownerDigest: string;
  readonly stopReason: "recovered";
  readonly exitCode: null;
  readonly signal: null;
  readonly fenced: true;
  readonly parentCgroup: string;
  readonly supervisorCgroup: string;
  readonly runCgroup: string;
  readonly privateDeviceDirectory: string;
  readonly evidence: HelperTerminal["evidence"];
}

export type PrivateLinuxComponentProcess = ExactComponentProcess & {
  readonly owner: PrivateLinuxPreparedOwnerIdentity;
  readonly cgroup: Readonly<Pick<HelperReady, "parentCgroup" | "runCgroup" | "payloadPid">>;
  readonly evidence: Promise<HelperTerminal["evidence"]>;
  readonly terminationReason: Promise<HelperTerminal["reason"]>;
  /** Atomic receipt. Rejection is branded when a complete fence was not proven. */
  readonly enforcement: Promise<PrivateLinuxConfirmedEnforcementReceipt>;
  readonly envelope: PrivateLinuxEnvelopeIdentity;
};

type HelperMessage = HelperPrepared | HelperReady | HelperTerminal | {
  readonly type: "error";
  readonly message: string;
};

type NormalizedBackendOptions = Required<
  Omit<PrivateLinuxCgroupBackendOptions, "helperPath" | "launchWrapperPath" | "recoveryHelperPath">
> & {
  readonly helperPath: string;
  readonly launchWrapperPath: string;
  readonly recoveryHelperPath: string;
};

interface SealedOwnerData {
  readonly backend: PrivateLinuxCgroupBackend;
  readonly sourcePlan: PrivateLinuxLaunchPlan;
  readonly sealedPlan: PrivateLinuxSealedLaunchPlan;
  readonly mechanism: PrivateLinuxBackendMechanismObservation;
  readonly identity: PrivateLinuxSealedOwnerIdentity;
  readonly preparedIdentity: PrivateLinuxPreparedOwnerIdentity;
  readonly automaticOwnerStateParent?: string;
}

const authenticSealedOwners = new WeakMap<object, SealedOwnerData>();

/**
 * Linux-only Phase 2 proof backend. It is deliberately package-private and
 * does not establish the future public Sandbox Backend interface.
 */
export class PrivateLinuxCgroupBackend {
  private readonly options: NormalizedBackendOptions;

  constructor(options: PrivateLinuxCgroupBackendOptions) {
    const sourcePath = fileURLToPath(import.meta.url);
    const helperExtension = extname(sourcePath);
    this.options = Object.freeze({
      ...options,
      helperPath: options.helperPath ?? join(dirname(sourcePath), `linux-cgroup-helper${helperExtension}`),
      launchWrapperPath: options.launchWrapperPath ??
        join(dirname(sourcePath), `linux-cgroup-launch-wrapper${helperExtension}`),
      recoveryHelperPath: options.recoveryHelperPath ??
        join(dirname(sourcePath), `linux-cgroup-recovery-helper${helperExtension}`),
      startupTimeoutMs: options.startupTimeoutMs ?? 10_000,
    });
    validateOptions(this.options);
    authenticBackends.add(this);
    Object.freeze(this);
  }

  /** Observe the exact private mechanism without starting package code. */
  async observeMechanism(): Promise<PrivateLinuxBackendMechanismObservation> {
    requirePrivateLinuxCgroupBackend(this);
    return await observeBackendMechanism(this.options, this.options.helperPath);
  }

  /**
   * Fix one exact owner before admission. This performs no package execution
   * and creates no cgroup. The returned object is invocation-local; only its
   * deeply frozen identity is intended for private durable state.
   */
  async seal(
    plan: PrivateLinuxLaunchPlan,
    ownerState?: PrivateLinuxOwnerStateLocation | PrivateLinuxOwnerStateAllocationIdentity,
  ): Promise<PrivateLinuxSealedOwner> {
    requirePrivateLinuxCgroupBackend(this);
    const planSnapshot = snapshotPrivateLinuxLaunchPlan(plan);
    validatePlan(planSnapshot);
    const sealedPlan = await sealMountSources(planSnapshot, this.options.payloadUid);
    const mechanism = await observeBackendMechanism(
      this.options,
      planSnapshot.trustedHelperPath ?? this.options.helperPath,
    );
    const sealedPlanDigest = privateDomainDigest(
      "JIG-Linux-Sealed-Launch-Plan/1",
      {
        mechanismDigest: mechanism.digest,
        payloadUid: mechanism.payloadUid,
        payloadGid: mechanism.payloadGid,
        plan: sealedPlan as unknown as JsonValue,
      },
    );
    const nonce = randomBytes(12).toString("hex");
    const parentName = `jig-run-${planSnapshot.runId}-${nonce}`;
    const allocatedState = await createPrivateLinuxOwnerState(ownerState, nonce);
    const ownerToken = allocatedState.allocation.ownerToken;
    const fields = {
      kind: "private-linux-sealed-owner/1" as const,
      runId: planSnapshot.runId,
      nonce,
      ownerToken,
      mechanismDigest: mechanism.digest,
      sealedPlanDigest,
      cgroupScope: mechanism.cgroupScope,
      cgroupScopeDevice: mechanism.cgroupScopeDevice,
      cgroupScopeInode: mechanism.cgroupScopeInode,
      parentName,
      parentCgroup: join(mechanism.cgroupScope, parentName),
      supervisorCgroup: join(mechanism.cgroupScope, parentName, "supervisor"),
      runCgroup: join(mechanism.cgroupScope, parentName, "run"),
      privateDeviceDirectory: join("/dev", `.jig-${parentName}-devices`),
      deadlineUnixMs: sealedPlan.limits.deadlineUnixMs,
      cancellationGraceMs: sealedPlan.limits.cancellationGraceMs,
      cleanupTimeoutMs: sealedPlan.limits.cleanupTimeoutMs ?? 5_000,
      trustedHelperPath: mechanism.trustedHelperPath,
      trustedHelperDigest: mechanism.trustedHelperDigest,
      ownerStateParent: allocatedState.parent,
      ownerStateParentDevice: allocatedState.parentDevice,
      ownerStateParentInode: allocatedState.parentInode,
      ownerStateName: allocatedState.name,
      ownerStateDirectory: allocatedState.directory,
      ownerStateDevice: allocatedState.device,
      ownerStateInode: allocatedState.inode,
      ownerStateAllocationDigest: allocatedState.allocation.digest,
    };
    let identity: PrivateLinuxSealedOwnerIdentity;
    let preparedIdentity: PrivateLinuxPreparedOwnerIdentity;
    try {
      identity = normalizePrivateLinuxSealedOwnerIdentity({
        ...fields,
        digest: privateDomainDigest("JIG-Private-Linux-Sealed-Owner/1", fields as unknown as JsonValue),
      });
      preparedIdentity = normalizePrivateLinuxPreparedOwnerIdentity({
        kind: "private-linux-prepared-owner/1",
        digest: privateDomainDigest(
          "JIG-Private-Linux-Prepared-Owner/1",
          identity as unknown as JsonValue,
        ),
        owner: identity,
      });
      await initializePrivateLinuxOwnerState(identity);
      await requireSealedOwnerUnused(identity);
    } catch (error) {
      // A caller-provided allocation is durable state. Never erase it on a
      // failed seal: a successor must still be able to win cancellation and
      // prevent an already-spawned wrapper from becoming a future creator.
      if (allocatedState.automaticParent !== undefined) {
        await rm(allocatedState.automaticParent, { recursive: true, force: true }).catch(() => undefined);
      }
      throw error;
    }

    let admitted = false;
    const owner: PrivateLinuxSealedOwner = Object.freeze({
      identity,
      admit: (
        signal?: AbortSignal,
        beforeAdmission?: (prepared: PrivateLinuxPreparedOwnerIdentity) => Promise<void>,
      ): Promise<PrivateLinuxComponentProcess> => {
        if (admitted) return Promise.reject(new TypeError("sealed Linux owner was already admitted"));
        admitted = true;
        return this.launch(plan, signal, owner, beforeAdmission);
      },
    });
    authenticSealedOwners.set(owner, Object.freeze({
      backend: this,
      sourcePlan: plan,
      sealedPlan,
      mechanism,
      identity,
      preparedIdentity,
      ...(allocatedState.automaticParent === undefined
        ? {}
        : { automaticOwnerStateParent: allocatedState.automaticParent }),
    }));
    return owner;
  }

  /** Fence only one exact identity previously persisted by trusted Jig state. */
  async recoverFence(value: unknown): Promise<PrivateLinuxConfirmedEnforcementReceipt> {
    requirePrivateLinuxCgroupBackend(this);
    const identity = isPreparedOwnerValue(value)
      ? normalizePrivateLinuxPreparedOwnerIdentity(value).owner
      : normalizePrivateLinuxSealedOwnerIdentity(value);
    const prepared = preparedIdentityFor(identity);
    const mechanism = await observeBackendMechanism(this.options, identity.trustedHelperPath);
    requireOwnerMatchesMechanism(identity, mechanism);
    const finalized = await recoverPrivateLinuxOwnerState(this.options, mechanism, identity);
    return confirmedRecoveryReceipt(prepared, finalized);
  }

  async launch(
    plan: PrivateLinuxLaunchPlan,
    signal?: AbortSignal,
    sealedOwner?: PrivateLinuxSealedOwner,
    beforeAdmission?: (prepared: PrivateLinuxPreparedOwnerIdentity) => Promise<void>,
  ): Promise<PrivateLinuxComponentProcess> {
    requirePrivateLinuxCgroupBackend(this);
    if (sealedOwner === undefined) return await (await this.seal(plan)).admit(signal);
    const data = requireSealedOwner(sealedOwner, this, plan);
    const { sealedPlan, mechanism, identity, preparedIdentity } = data;
    const { nonce, parentName, sealedPlanDigest } = identity;
    const controlDirectory = join(tmpdir(), `jig-cgroup-control-${nonce}`);
    const controlPath = join(controlDirectory, "control.sock");
    const control = createServer();

    let child: ChildProcessWithoutNullStreams | undefined;
    let helperClose: Promise<{ code: number | null; signal: string | null }> | undefined;
    let finalizerReceipt: Promise<RecoveryFenceMessage> | undefined;
    let socket: Socket | undefined;
    let detachPersistentAbort: (() => void) | undefined;
    try {
      await mkdir(controlDirectory, { recursive: false, mode: 0o700 });
      await listen(control, controlPath);
      await requireSealedMountSources(sealedPlan.readOnlyMounts);
      const accepted = acceptOne(control, this.options.startupTimeoutMs, (acceptedSocket) => {
        socket = acceptedSocket;
      });
      const helperCommand = [
        mechanism.trustedCoordinatorBunPath,
        ...HELPER_BUN_POLICY,
        mechanism.trustedHelperPath,
        "--control", controlPath,
        "--scope", mechanism.cgroupScope,
        "--parent", parentName,
        "--memory", String(sealedPlan.limits.memoryBytes),
        "--pids", String(sealedPlan.limits.pids),
        "--cpu-quota", String(sealedPlan.limits.cpuQuotaMicros),
        "--cpu-period", String(sealedPlan.limits.cpuPeriodMicros),
        "--deadline-unix-ms", String(sealedPlan.limits.deadlineUnixMs),
        "--cancellation-grace-ms", String(sealedPlan.limits.cancellationGraceMs),
        "--cleanup-ms", String(sealedPlan.limits.cleanupTimeoutMs ?? 5_000),
        "--uid", String(this.options.payloadUid),
        "--gid", String(this.options.payloadGid),
        "--bubblewrap", mechanism.trustedBubblewrapPath,
        "--mknod", mechanism.trustedMknodPath,
        "--bash", mechanism.trustedBashPath,
        "--launcher", mechanism.trustedLauncherPath,
        "--",
        ...bubblewrapArguments(sealedPlan, this.options.payloadUid, this.options.payloadGid),
      ];
      const finalizerCommand = [
        mechanism.trustedCoordinatorBunPath,
        ...HELPER_BUN_POLICY,
        mechanism.trustedRecoveryHelperPath,
        "--scope", mechanism.cgroupScope,
        "--parent", parentName,
        "--owner-digest", preparedIdentity.digest,
        "--cleanup-ms", String(sealedPlan.limits.cleanupTimeoutMs ?? 5_000),
      ];
      child = spawn(
        mechanism.trustedLauncherPath,
        [
          "-n",
          "--",
          mechanism.trustedSubreaperPath,
          "--",
          mechanism.trustedBashPath,
          "--noprofile",
          "--norc",
          "-p",
          "-c",
          EMPTY_ROOT_ENVIRONMENT,
          "jig-cgroup-helper",
          mechanism.trustedCoordinatorBunPath,
          ...HELPER_BUN_POLICY,
          mechanism.trustedLaunchWrapperPath,
          "--owner-dir", identity.ownerStateDirectory,
          "--owner-digest", preparedIdentity.digest,
          "--allocation-digest", identity.ownerStateAllocationDigest,
          "--owner-token", identity.ownerToken,
          "--helper", ...helperCommand,
          "--finalizer", ...finalizerCommand,
        ],
        {
          cwd: "/",
          env: {},
          stdio: ["pipe", "pipe", "pipe"],
        },
      ) as ChildProcessWithoutNullStreams;
      helperClose = childClose(child);
      const finalizer = helperClose.then(async () => await readPrivateLinuxFinalReceipt(preparedIdentity));
      finalizerReceipt = finalizer;
      void finalizer.catch(() => undefined);
      const connectedSocket = await Promise.race([
        accepted,
        helperClose.then(({ code, signal: exitSignal }) => {
          throw new Error(`trusted cgroup helper exited before connecting (${code ?? exitSignal})`);
        }),
      ]);
      socket = connectedSocket;
      const messages = readMessages(connectedSocket);
      const terminal = deferred<HelperTerminal>();
      const prepared = deferred<HelperPrepared>();
      const ready = deferred<HelperReady>();
      const messageTask = consumeMessages(messages, prepared, ready, terminal);
      // Stop admission immediately, but do not await Server.close(): its
      // callback waits for the already accepted control connection to end.
      control.close();
      await rm(controlPath, { force: true });
      await rm(controlDirectory, { recursive: true, force: true });
      const close = helperClose;
      close.then(async ({ code, signal: exitSignal }) => {
        await messageTask.catch(() => undefined);
        prepared.reject(new Error(`trusted cgroup helper exited before preparation (${code ?? exitSignal})`));
        ready.reject(new Error(`trusted cgroup helper exited before readiness (${code ?? exitSignal})`));
        terminal.reject(new Error(`trusted cgroup helper exited without a terminal receipt (${code ?? exitSignal})`));
      }).catch((error) => {
        prepared.reject(error);
        ready.reject(error);
        terminal.reject(error);
      });

      const aborted = deferred<never>();
      const abort = (): void => writeControl(connectedSocket, { type: "cancel" });
      const abortStartup = (): void => aborted.reject(new Error("cgroup launch was cancelled during startup"));
      signal?.addEventListener("abort", abort, { once: true });
      signal?.addEventListener("abort", abortStartup, { once: true });
      detachPersistentAbort = (): void => signal?.removeEventListener("abort", abort);
      if (signal?.aborted) {
        signal.removeEventListener("abort", abortStartup);
        detachPersistentAbort();
        detachPersistentAbort = undefined;
        throw new Error("cgroup launch was cancelled before admission");
      }

      const preparedReceipt = await withTimeout(
        Promise.race([prepared.promise, aborted.promise]),
        this.options.startupTimeoutMs,
        "cgroup helper preparation",
      );
      if (preparedReceipt.parentCgroup !== identity.parentCgroup ||
          preparedReceipt.supervisorCgroup !== identity.supervisorCgroup ||
          preparedReceipt.runCgroup !== identity.runCgroup) {
        writeControl(connectedSocket, { type: "cancel" });
        throw new Error("trusted cgroup helper announced an unexpected prepared owner");
      }
      if (beforeAdmission !== undefined) {
        await Promise.race([
          beforeAdmission(preparedIdentity),
          aborted.promise,
          close.then(({ code, signal: exitSignal }) => {
            throw new Error(
              `trusted cgroup helper exited while admission persistence was pending (${code ?? exitSignal})`,
            );
          }),
        ]);
      }
      if (signal?.aborted) {
        writeControl(connectedSocket, { type: "cancel" });
        throw new Error("cgroup launch was cancelled before package admission");
      }

      // No await occurs between the abort check and this write. Once it may
      // have reached the helper, teardown requires a terminal fence receipt.
      writeControl(connectedSocket, { type: "admit" });

      let readyReceipt: HelperReady;
      try {
        readyReceipt = await withTimeout(
          Promise.race([ready.promise, aborted.promise]),
          this.options.startupTimeoutMs,
          "cgroup helper readiness",
        );
      } catch (error) {
        writeControl(connectedSocket, { type: "cancel" });
        throw error;
      } finally {
        signal?.removeEventListener("abort", abortStartup);
      }
      const expectedParentCgroup = join(mechanism.cgroupScope, parentName);
      if (readyReceipt.parentCgroup !== expectedParentCgroup ||
          readyReceipt.runCgroup !== join(expectedParentCgroup, "run")) {
        writeControl(connectedSocket, { type: "cancel" });
        throw new Error("trusted cgroup helper announced an unexpected ownership path");
      }

      const componentProcess = child;
      if (componentProcess === undefined) throw new Error("trusted cgroup helper process was unavailable");
      const controlSocket = connectedSocket;
      let inputClosed = false;
      let terminationStarted = false;
      const enforcement = Promise.all([terminal.promise, finalizer, close]).then(
        async ([receipt, finalized]) => {
          const confirmed = confirmedEnforcementReceipt(preparedIdentity, receipt, finalized);
          if (data.automaticOwnerStateParent !== undefined) {
            await disposePrivateLinuxOwnerState(identity, data.automaticOwnerStateParent);
          }
          return confirmed;
        },
        (error) => {
          throw asFenceUnconfirmed(error);
        },
      );
      const completion = (async (): Promise<ExactComponentExit> => {
        try {
          const receipt = await enforcement;
          return Object.freeze({
            exitCode: receipt.exitCode,
            signal: receipt.signal,
            fenced: true,
            stopReason: receipt.stopReason,
          });
        } finally {
          detachPersistentAbort?.();
          detachPersistentAbort = undefined;
          controlSocket.destroy();
        }
      })();
      const evidence = enforcement.then((receipt) => receipt.evidence);
      const terminationReason = enforcement.then((receipt) => receipt.stopReason);
      // Preserve rejection for explicit awaiters while preventing unobserved
      // projection promises from becoming fatal during an ownership failure.
      void evidence.catch(() => undefined);
      void terminationReason.catch(() => undefined);
      void enforcement.catch(() => undefined);

      return Object.freeze({
        owner: preparedIdentity,
        envelope: Object.freeze({
          kind: "linux-cgroup-v2-bubblewrap/1" as const,
          trustedHelperPath: mechanism.trustedHelperPath,
          trustedHelperDigest: mechanism.trustedHelperDigest,
          trustedLaunchWrapperPath: mechanism.trustedLaunchWrapperPath,
          trustedLaunchWrapperDigest: mechanism.trustedLaunchWrapperDigest,
          trustedRecoveryHelperPath: mechanism.trustedRecoveryHelperPath,
          trustedRecoveryHelperDigest: mechanism.trustedRecoveryHelperDigest,
          trustedBubblewrapPath: mechanism.trustedBubblewrapPath,
          trustedBubblewrapDigest: mechanism.trustedBubblewrapDigest,
          trustedCoordinatorBunPath: mechanism.trustedCoordinatorBunPath,
          trustedCoordinatorBunDigest: mechanism.trustedCoordinatorBunDigest,
          trustedLauncherPath: mechanism.trustedLauncherPath,
          trustedLauncherDigest: mechanism.trustedLauncherDigest,
          trustedSubreaperPath: mechanism.trustedSubreaperPath,
          trustedSubreaperDigest: mechanism.trustedSubreaperDigest,
          trustedMknodPath: mechanism.trustedMknodPath,
          trustedMknodTargetPath: mechanism.trustedMknodTargetPath,
          trustedMknodDigest: mechanism.trustedMknodDigest,
          trustedBashPath: mechanism.trustedBashPath,
          trustedBashDigest: mechanism.trustedBashDigest,
          trustedBackendPath: mechanism.trustedBackendPath,
          trustedBackendDigest: mechanism.trustedBackendDigest,
          cgroupVersion: mechanism.cgroupVersion,
          controllers: mechanism.controllers,
          scopeEmpty: mechanism.scopeEmpty,
          launcherMode: mechanism.launcherMode,
          mechanismDigest: mechanism.digest,
          sealedPlanDigest,
          payloadUid: this.options.payloadUid,
          payloadGid: this.options.payloadGid,
          limits: Object.freeze({ ...sealedPlan.limits }),
          privateProcessFilesystem: sealedPlan.privateProcessFilesystem === true,
          privateRuntimeDevices: sealedPlan.privateRuntimeDevices === true,
        }),
        cgroup: Object.freeze({
          parentCgroup: readyReceipt.parentCgroup,
          runCgroup: readyReceipt.runCgroup,
          payloadPid: readyReceipt.payloadPid,
        }),
        stdout: componentProcess.stdout,
        stderr: componentProcess.stderr,
        completion,
        evidence,
        terminationReason,
        enforcement,
        write(bytes: Uint8Array): Promise<void> {
          if (inputClosed) return Promise.reject(new Error("component input is closed"));
          return writeStream(componentProcess.stdin, bytes);
        },
        closeInput(): Promise<void> {
          if (inputClosed) return Promise.resolve();
          inputClosed = true;
          return endStream(componentProcess.stdin);
        },
        terminate(): Promise<void> {
          if (terminationStarted) return Promise.resolve();
          terminationStarted = true;
          writeControl(controlSocket, { type: "cancel" });
          return Promise.resolve();
        },
      });
    } catch (error) {
      detachPersistentAbort?.();
      detachPersistentAbort = undefined;
      const cleanupFailures: unknown[] = [];
      let fencingConfirmed = child === undefined;
      socket && writeControl(socket, { type: "cancel" });
      socket?.destroy();
      if (child === undefined && data.automaticOwnerStateParent !== undefined) {
        try {
          const allocation = ownerStateAllocationFor(identity);
          const cancelled = await cancelPrivateLinuxOwnerStateAllocation(allocation);
          await releasePrivateLinuxOwnerState(allocation, cancelled);
          await rmdir(data.automaticOwnerStateParent);
        } catch (cleanupError) {
          cleanupFailures.push(cleanupError);
        }
      }
      if (child !== undefined) {
        try {
          let recovered: RecoveryFenceMessage;
          if (helperClose !== undefined && finalizerReceipt !== undefined) {
            try {
              [recovered] = await Promise.all([
                withTimeout(
                  finalizerReceipt,
                  identity.cleanupTimeoutMs + this.options.startupTimeoutMs,
                  "cgroup failed-launch durable final receipt",
                ),
                withTimeout(helperClose, this.options.startupTimeoutMs, "cgroup failed-launch wrapper exit"),
              ]);
            } catch {
              recovered = await recoverPrivateLinuxOwnerState(this.options, mechanism, identity);
            }
          } else {
            recovered = await recoverPrivateLinuxOwnerState(this.options, mechanism, identity);
          }
          requireRecoveryFenceMessage(recovered, preparedIdentity);
          if (data.automaticOwnerStateParent !== undefined) {
            await disposePrivateLinuxOwnerState(identity, data.automaticOwnerStateParent);
          }
          fencingConfirmed = true;
        } catch (cleanupError) {
          cleanupFailures.push(cleanupError);
        }
      }
      try {
        await closeServer(control);
      } catch (cleanupError) {
        cleanupFailures.push(cleanupError);
      }
      try {
        await rm(controlDirectory, { recursive: true, force: true });
      } catch (cleanupError) {
        cleanupFailures.push(cleanupError);
      }
      if (!fencingConfirmed) {
        throw new PrivateLinuxFenceUnconfirmedError(
          new AggregateError([error, ...cleanupFailures], "cgroup launch ownership remained ambiguous"),
        );
      }
      if (cleanupFailures.length > 0) {
        throw new AggregateError([error, ...cleanupFailures], "cgroup launch failed during cleanup");
      }
      throw error;
    }
  }
}

/** Reject lookalikes, subclasses, and method-shadowed Backend instances. */
export function requirePrivateLinuxCgroupBackend(value: unknown): PrivateLinuxCgroupBackend {
  if (value === null || typeof value !== "object" ||
      !authenticBackends.has(value) ||
      Object.getPrototypeOf(value) !== PrivateLinuxCgroupBackend.prototype ||
      !Object.isFrozen(value)) {
    throw new TypeError("Linux Backend was not produced by the private constructor");
  }
  return value as PrivateLinuxCgroupBackend;
}

Object.freeze(PrivateLinuxCgroupBackend.prototype);

/** Parse a private sealed-owner record reacquired from durable trusted state. */
export function normalizePrivateLinuxSealedOwnerIdentity(
  value: unknown,
): PrivateLinuxSealedOwnerIdentity {
  const record = exactDataRecord(value, [
    "cancellationGraceMs", "cgroupScope", "cgroupScopeDevice", "cgroupScopeInode", "cleanupTimeoutMs",
    "deadlineUnixMs", "digest", "kind",
    "mechanismDigest", "nonce", "ownerToken", "parentCgroup", "parentName", "privateDeviceDirectory",
    "runCgroup", "runId", "sealedPlanDigest", "supervisorCgroup", "trustedHelperDigest", "trustedHelperPath",
    "ownerStateParent", "ownerStateParentDevice", "ownerStateParentInode", "ownerStateName",
    "ownerStateDirectory", "ownerStateDevice", "ownerStateInode", "ownerStateAllocationDigest",
  ], "sealed Linux owner");
  if (record.kind !== "private-linux-sealed-owner/1" || typeof record.digest !== "string" ||
      typeof record.runId !== "string" || !RUN_ID.test(record.runId) ||
      typeof record.nonce !== "string" || !NONCE.test(record.nonce) ||
      typeof record.ownerToken !== "string" || !/^[0-9a-f]{64}$/.test(record.ownerToken) ||
      typeof record.mechanismDigest !== "string" || !DIGEST.test(record.mechanismDigest) ||
      typeof record.sealedPlanDigest !== "string" || !DIGEST.test(record.sealedPlanDigest) ||
      typeof record.cgroupScope !== "string" || !record.cgroupScope.startsWith("/sys/fs/cgroup/") ||
      resolve(record.cgroupScope) !== record.cgroupScope ||
      typeof record.cgroupScopeDevice !== "string" || !/^(?:0|[1-9][0-9]*)$/.test(record.cgroupScopeDevice) ||
      typeof record.cgroupScopeInode !== "string" || !/^[1-9][0-9]*$/.test(record.cgroupScopeInode) ||
      typeof record.parentName !== "string" || typeof record.parentCgroup !== "string" ||
      typeof record.supervisorCgroup !== "string" || typeof record.runCgroup !== "string" ||
      typeof record.privateDeviceDirectory !== "string" ||
      !Number.isSafeInteger(record.deadlineUnixMs) || Number(record.deadlineUnixMs) < 0 ||
      !Number.isSafeInteger(record.cancellationGraceMs) || Number(record.cancellationGraceMs) < 1 ||
      Number(record.deadlineUnixMs) + Number(record.cancellationGraceMs) > Number.MAX_SAFE_INTEGER ||
      !Number.isSafeInteger(record.cleanupTimeoutMs) || Number(record.cleanupTimeoutMs) < 1 ||
      typeof record.trustedHelperPath !== "string" || !record.trustedHelperPath.startsWith("/") ||
      resolve(record.trustedHelperPath) !== record.trustedHelperPath ||
      typeof record.trustedHelperDigest !== "string" || !DIGEST.test(record.trustedHelperDigest) ||
      typeof record.ownerStateParent !== "string" || !record.ownerStateParent.startsWith("/") ||
      resolve(record.ownerStateParent) !== record.ownerStateParent ||
      typeof record.ownerStateParentDevice !== "string" || !/^(?:0|[1-9][0-9]*)$/.test(record.ownerStateParentDevice) ||
      typeof record.ownerStateParentInode !== "string" || !/^[1-9][0-9]*$/.test(record.ownerStateParentInode) ||
      typeof record.ownerStateName !== "string" || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(record.ownerStateName) ||
      typeof record.ownerStateDirectory !== "string" ||
      record.ownerStateDirectory !== join(record.ownerStateParent, record.ownerStateName) ||
      typeof record.ownerStateDevice !== "string" || !/^(?:0|[1-9][0-9]*)$/.test(record.ownerStateDevice) ||
      typeof record.ownerStateInode !== "string" || !/^[1-9][0-9]*$/.test(record.ownerStateInode) ||
      typeof record.ownerStateAllocationDigest !== "string" || !DIGEST.test(record.ownerStateAllocationDigest)) {
    throw new TypeError("sealed Linux owner identity is invalid");
  }
  const parentName = `jig-run-${record.runId}-${record.nonce}`;
  const parentCgroup = join(record.cgroupScope, parentName);
  const supervisorCgroup = join(parentCgroup, "supervisor");
  const runCgroup = join(parentCgroup, "run");
  const privateDeviceDirectory = join("/dev", `.jig-${parentName}-devices`);
  if (record.parentName !== parentName || record.parentCgroup !== parentCgroup ||
      record.supervisorCgroup !== supervisorCgroup || record.runCgroup !== runCgroup ||
      record.privateDeviceDirectory !== privateDeviceDirectory) {
    throw new TypeError("sealed Linux owner paths are invalid");
  }
  const fields = {
    kind: "private-linux-sealed-owner/1" as const,
    runId: record.runId,
    nonce: record.nonce,
    ownerToken: record.ownerToken,
    mechanismDigest: record.mechanismDigest,
    sealedPlanDigest: record.sealedPlanDigest,
    cgroupScope: record.cgroupScope,
    cgroupScopeDevice: record.cgroupScopeDevice,
    cgroupScopeInode: record.cgroupScopeInode,
    parentName,
    parentCgroup,
    supervisorCgroup,
    runCgroup,
    privateDeviceDirectory,
    deadlineUnixMs: Number(record.deadlineUnixMs),
    cancellationGraceMs: Number(record.cancellationGraceMs),
    cleanupTimeoutMs: Number(record.cleanupTimeoutMs),
    trustedHelperPath: record.trustedHelperPath,
    trustedHelperDigest: record.trustedHelperDigest,
    ownerStateParent: record.ownerStateParent,
    ownerStateParentDevice: record.ownerStateParentDevice,
    ownerStateParentInode: record.ownerStateParentInode,
    ownerStateName: record.ownerStateName,
    ownerStateDirectory: record.ownerStateDirectory,
    ownerStateDevice: record.ownerStateDevice,
    ownerStateInode: record.ownerStateInode,
    ownerStateAllocationDigest: record.ownerStateAllocationDigest,
  };
  if (record.digest !== privateDomainDigest(
    "JIG-Private-Linux-Sealed-Owner/1",
    fields as unknown as JsonValue,
  )) {
    throw new TypeError("sealed Linux owner digest is invalid");
  }
  return Object.freeze({ ...fields, digest: record.digest });
}

/** Parse the phase marker emitted only after exact supervisor ownership. */
export function normalizePrivateLinuxPreparedOwnerIdentity(
  value: unknown,
): PrivateLinuxPreparedOwnerIdentity {
  const record = exactDataRecord(value, ["digest", "kind", "owner"], "prepared Linux owner");
  const owner = normalizePrivateLinuxSealedOwnerIdentity(record.owner);
  if (record.kind !== "private-linux-prepared-owner/1" || typeof record.digest !== "string" ||
      record.digest !== privateDomainDigest(
        "JIG-Private-Linux-Prepared-Owner/1",
        owner as unknown as JsonValue,
      )) {
    throw new TypeError("prepared Linux owner identity is invalid");
  }
  return Object.freeze({
    kind: "private-linux-prepared-owner/1" as const,
    digest: record.digest,
    owner,
  });
}

function exactDataRecord(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  const record = ordinaryDataRecord(value, label);
  if (Object.keys(record).sort().join("\0") !== [...keys].sort().join("\0")) {
    throw new TypeError(`${label} is invalid`);
  }
  return record;
}

function ordinaryDataRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value) || utilTypes.isProxy(value) ||
      (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) ||
      Object.getOwnPropertySymbols(value).length !== 0) {
    throw new TypeError(`${label} is invalid`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.values(descriptors).some((descriptor) =>
    !("value" in descriptor) || descriptor.enumerable !== true
  )) {
    throw new TypeError(`${label} is invalid`);
  }
  const record: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const [key, descriptor] of Object.entries(descriptors)) {
    record[key] = descriptor.value;
  }
  return record;
}

function requireSealedOwner(
  owner: PrivateLinuxSealedOwner,
  backend: PrivateLinuxCgroupBackend,
  plan: PrivateLinuxLaunchPlan,
): SealedOwnerData {
  const data = authenticSealedOwners.get(owner);
  if (data === undefined || data.backend !== backend || data.sourcePlan !== plan || !Object.isFrozen(owner)) {
    throw new TypeError("sealed Linux owner was not produced for this launch");
  }
  return data;
}

async function requireSealedOwnerUnused(identity: PrivateLinuxSealedOwnerIdentity): Promise<void> {
  for (const path of [
    identity.parentCgroup,
    identity.privateDeviceDirectory,
    join(identity.ownerStateDirectory, "claim.json"),
    join(identity.ownerStateDirectory, "final.json"),
  ]) {
    try {
      await lstat(path);
      throw new Error(`sealed Linux owner path already exists: ${path}`);
    } catch (error) {
      if (!hasErrorCode(error, "ENOENT")) throw error;
    }
  }
}

function requireOwnerMatchesMechanism(
  identity: PrivateLinuxSealedOwnerIdentity,
  mechanism: PrivateLinuxBackendMechanismObservation,
): void {
  if (identity.mechanismDigest !== mechanism.digest ||
      identity.trustedHelperPath !== mechanism.trustedHelperPath ||
      identity.trustedHelperDigest !== mechanism.trustedHelperDigest ||
      identity.cgroupScope !== mechanism.cgroupScope ||
      identity.cgroupScopeDevice !== mechanism.cgroupScopeDevice ||
      identity.cgroupScopeInode !== mechanism.cgroupScopeInode) {
    throw new Error("prepared Linux owner no longer matches the admitted mechanism");
  }
}

function confirmedEnforcementReceipt(
  prepared: PrivateLinuxPreparedOwnerIdentity,
  terminal: HelperTerminal,
  finalized: RecoveryFenceMessage,
): PrivateLinuxConfirmedEnforcementReceipt {
  requireRecoveryFenceMessage(finalized, prepared);
  if (terminal.cleanupError !== undefined) {
    throw asFenceUnconfirmed(new Error(`launch helper reported cleanup failure: ${terminal.cleanupError}`));
  }
  if (![
    "cancelled", "coordinator_lost", "deadline", "payload_exit", "setup_failed",
  ].includes(terminal.reason)) {
    throw asFenceUnconfirmed(new Error("launch helper returned an invalid stop reason"));
  }
  const receipt = {
    kind: "private-linux-confirmed-enforcement/1" as const,
    ownerDigest: prepared.digest,
    stopReason: terminal.reason as Exclude<PrivateLinuxConfirmedEnforcementReceipt["stopReason"], "recovered">,
    exitCode: terminal.exitCode,
    signal: terminal.signal,
    fenced: true as const,
    ...(terminal.setupError === undefined ? {} : { setupError: terminal.setupError }),
    ...(terminal.killError === undefined ? {} : { killError: terminal.killError }),
    evidence: mergeEvidence(terminal.evidence, finalized.evidence),
  };
  return Object.freeze(receipt);
}

function confirmedRecoveryReceipt(
  prepared: PrivateLinuxPreparedOwnerIdentity,
  finalized: RecoveryFenceMessage,
): PrivateLinuxConfirmedEnforcementReceipt {
  requireRecoveryFenceMessage(finalized, prepared);
  return Object.freeze({
    kind: "private-linux-confirmed-enforcement/1" as const,
    ownerDigest: prepared.digest,
    stopReason: "recovered" as const,
    exitCode: null,
    signal: null,
    fenced: true as const,
    evidence: finalized.evidence,
  });
}

function mergeEvidence(
  left: HelperTerminal["evidence"],
  right: HelperTerminal["evidence"],
): HelperTerminal["evidence"] {
  const merge = (
    a: Readonly<Record<string, number>>,
    b: Readonly<Record<string, number>>,
  ): Readonly<Record<string, number>> => Object.freeze(Object.fromEntries(
    [...new Set([...Object.keys(a), ...Object.keys(b)])].sort().map(
      (key) => [key, Math.max(a[key] ?? 0, b[key] ?? 0)],
    ),
  ));
  return Object.freeze({
    cpuStat: merge(left.cpuStat, right.cpuStat),
    memoryEvents: merge(left.memoryEvents, right.memoryEvents),
    pidsEvents: merge(left.pidsEvents, right.pidsEvents),
  });
}

function asFenceUnconfirmed(error: unknown): PrivateLinuxFenceUnconfirmedError {
  return error instanceof PrivateLinuxFenceUnconfirmedError
    ? error
    : new PrivateLinuxFenceUnconfirmedError(error);
}

function hasErrorCode(error: unknown, code: string): boolean {
  return error !== null && typeof error === "object" && (error as NodeJS.ErrnoException).code === code;
}

interface AllocatedLinuxOwnerState {
  readonly allocation: PrivateLinuxOwnerStateAllocationIdentity;
  readonly parent: string;
  readonly parentDevice: string;
  readonly parentInode: string;
  readonly name: string;
  readonly directory: string;
  readonly device: string;
  readonly inode: string;
  readonly automaticParent?: string;
}

/** Plan an exact protected owner-state allocation without creating its leaf. */
export async function planPrivateLinuxOwnerStateAllocation(
  location: PrivateLinuxOwnerStateLocation,
): Promise<PrivateLinuxOwnerStateAllocationIdentity> {
  if (!location.parent.startsWith("/") || resolve(location.parent) !== location.parent ||
      !/^[a-z0-9][a-z0-9-]{0,63}$/.test(location.name)) {
    throw new TypeError("Linux owner-state location is invalid");
  }
  const parent = await realpath(location.parent);
  if (parent !== location.parent) throw new TypeError("Linux owner-state parent must be canonical");
  const information = await lstat(parent, { bigint: true });
  const expectedUid = typeof process.getuid === "function" ? process.getuid() : -1;
  if (!information.isDirectory() || information.isSymbolicLink() ||
      Number(information.uid) !== expectedUid || (Number(information.mode) & 0o077) !== 0) {
    throw new TypeError("Linux owner-state parent is not protected");
  }
  const fields = {
    kind: "private-linux-owner-state-allocation/1" as const,
    parent,
    parentDevice: String(information.dev),
    parentInode: String(information.ino),
    name: location.name,
    directory: join(parent, location.name),
    ownerToken: randomBytes(32).toString("hex"),
  };
  return normalizePrivateLinuxOwnerStateAllocationIdentity({
    ...fields,
    digest: privateDomainDigest("JIG-Private-Linux-Owner-State-Allocation/1", fields as unknown as JsonValue),
  });
}

export function normalizePrivateLinuxOwnerStateAllocationIdentity(
  value: unknown,
): PrivateLinuxOwnerStateAllocationIdentity {
  const record = exactDataRecord(value, [
    "digest", "directory", "kind", "name", "ownerToken", "parent", "parentDevice", "parentInode",
  ], "Linux owner-state allocation");
  if (record.kind !== "private-linux-owner-state-allocation/1" ||
      typeof record.digest !== "string" || typeof record.parent !== "string" ||
      !record.parent.startsWith("/") || resolve(record.parent) !== record.parent ||
      typeof record.parentDevice !== "string" || !/^(?:0|[1-9][0-9]*)$/.test(record.parentDevice) ||
      typeof record.parentInode !== "string" || !/^[1-9][0-9]*$/.test(record.parentInode) ||
      typeof record.name !== "string" || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(record.name) ||
      typeof record.directory !== "string" || record.directory !== join(record.parent, record.name) ||
      typeof record.ownerToken !== "string" || !/^[0-9a-f]{64}$/.test(record.ownerToken)) {
    throw new TypeError("Linux owner-state allocation is invalid");
  }
  const fields = {
    kind: "private-linux-owner-state-allocation/1" as const,
    parent: record.parent,
    parentDevice: record.parentDevice,
    parentInode: record.parentInode,
    name: record.name,
    directory: record.directory,
    ownerToken: record.ownerToken,
  };
  if (record.digest !== privateDomainDigest(
    "JIG-Private-Linux-Owner-State-Allocation/1",
    fields as unknown as JsonValue,
  )) {
    throw new TypeError("Linux owner-state allocation digest is invalid");
  }
  return Object.freeze({ ...fields, digest: record.digest });
}

/**
 * Permanently cancel one persisted allocation before package admission.
 *
 * This operation addresses only the allocation named by trusted durable
 * state. It never enumerates owner directories or cgroups. The O_EXCL claim
 * is shared with the outside launch wrapper, so a delayed wrapper which loses
 * this race must exit before creating host resources.
 */
export async function cancelPrivateLinuxOwnerStateAllocation(
  value: unknown,
): Promise<PrivateLinuxOwnerStateCancellation> {
  const allocation = normalizePrivateLinuxOwnerStateAllocationIdentity(value);
  await requirePrivateLinuxOwnerStateAllocationParent(allocation);
  await mkdir(allocation.directory, { mode: 0o700 }).catch((error) => {
    if (!hasErrorCode(error, "EEXIST")) throw error;
  });
  const directory = await requirePrivateLinuxAllocationDirectory(allocation);
  await reconcileIncompletePrivateLinuxOwnerRecord(allocation);
  await ensurePrivateLinuxOwnerRecord({
    allocationDigest: allocation.digest,
    directory: allocation.directory,
    ownerToken: allocation.ownerToken,
  });
  const claim = await claimPrivateLinuxAllocationCancellation(allocation);
  if (claim === "active") {
    throw asFenceUnconfirmed(new Error(
      "active Linux cleanup owner cannot be fenced from allocation identity alone",
    ));
  }
  await syncPrivateDirectory(allocation.directory);
  await syncPrivateDirectory(allocation.parent);
  const fields = {
    kind: "private-linux-owner-state-cancellation/1" as const,
    allocationDigest: allocation.digest,
    directoryDevice: String(directory.dev),
    directoryInode: String(directory.ino),
    state: "cancelled" as const,
  };
  return normalizePrivateLinuxOwnerStateCancellation({
    ...fields,
    digest: privateDomainDigest(
      "JIG-Private-Linux-Owner-State-Cancellation/1",
      fields as unknown as JsonValue,
    ),
  });
}

export function normalizePrivateLinuxOwnerStateCancellation(
  value: unknown,
): PrivateLinuxOwnerStateCancellation {
  const record = exactDataRecord(value, [
    "allocationDigest", "digest", "directoryDevice", "directoryInode", "kind", "state",
  ], "Linux owner-state cancellation");
  if (record.kind !== "private-linux-owner-state-cancellation/1" || record.state !== "cancelled" ||
      typeof record.digest !== "string" || typeof record.allocationDigest !== "string" ||
      !DIGEST.test(record.allocationDigest) || typeof record.directoryDevice !== "string" ||
      !/^(?:0|[1-9][0-9]*)$/.test(record.directoryDevice) ||
      typeof record.directoryInode !== "string" || !/^[1-9][0-9]*$/.test(record.directoryInode)) {
    throw new TypeError("Linux owner-state cancellation is invalid");
  }
  const fields = {
    kind: "private-linux-owner-state-cancellation/1" as const,
    allocationDigest: record.allocationDigest,
    directoryDevice: record.directoryDevice,
    directoryInode: record.directoryInode,
    state: "cancelled" as const,
  };
  if (record.digest !== privateDomainDigest(
    "JIG-Private-Linux-Owner-State-Cancellation/1",
    fields as unknown as JsonValue,
  )) {
    throw new TypeError("Linux owner-state cancellation digest is invalid");
  }
  return Object.freeze({ ...fields, digest: record.digest });
}

/**
 * Remove one exact durable owner-state leaf after trusted state has retained
 * either its cancellation or its confirmed enforcement receipt.
 *
 * The returned receipt is deterministic and the operation is idempotent.
 * It never removes the protected parent and never scans sibling allocations.
 */
export async function releasePrivateLinuxOwnerState(
  ownerValue: unknown,
  proofValue: unknown,
): Promise<PrivateLinuxOwnerStateReleaseReceipt> {
  const reference = isOwnerStateAllocationValue(ownerValue)
    ? releaseReferenceForCancellation(ownerValue, proofValue)
    : releaseReferenceForConfirmedOwner(ownerValue, proofValue);
  await requireReleaseParent(reference);
  const receipt = privateLinuxOwnerStateReleaseReceipt(reference);
  let directory: Awaited<ReturnType<typeof lstat>>;
  try {
    directory = await lstat(reference.directory, { bigint: true });
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return receipt;
    throw error;
  }
  if (!directory.isDirectory() || directory.isSymbolicLink() ||
      String(directory.dev) !== reference.directoryDevice ||
      String(directory.ino) !== reference.directoryInode || (Number(directory.mode) & 0o077) !== 0) {
    throw new Error("Linux owner-state release identity changed");
  }

  const marker = await tryReadPrivateLinuxReleaseMarker(reference);
  if (marker === undefined) {
    const entries = await readdir(reference.directory);
    if (entries.length !== 0) await requirePrivateLinuxReleaseProofFiles(reference);
    await writePrivateLinuxReleaseMarker(reference);
  }
  await removePrivateLinuxOwnerStateFiles(reference);
  await rmdir(reference.directory).catch((error) => {
    if (!hasErrorCode(error, "ENOENT")) throw error;
  });
  await syncPrivateDirectory(reference.parent);
  return receipt;
}

interface PrivateLinuxOwnerStateReleaseReference {
  readonly allocationDigest: string;
  readonly parent: string;
  readonly parentDevice: string;
  readonly parentInode: string;
  readonly directory: string;
  readonly directoryDevice: string;
  readonly directoryInode: string;
  readonly ownerToken: string;
  readonly proofDigest: string;
  readonly proofKind: "cancelled" | "confirmed";
  readonly prepared?: PrivateLinuxPreparedOwnerIdentity;
}

function releaseReferenceForCancellation(
  ownerValue: unknown,
  proofValue: unknown,
): PrivateLinuxOwnerStateReleaseReference {
  const allocation = normalizePrivateLinuxOwnerStateAllocationIdentity(ownerValue);
  const cancellation = normalizePrivateLinuxOwnerStateCancellation(proofValue);
  if (cancellation.allocationDigest !== allocation.digest) {
    throw new TypeError("Linux owner-state cancellation belongs to another allocation");
  }
  return Object.freeze({
    allocationDigest: allocation.digest,
    parent: allocation.parent,
    parentDevice: allocation.parentDevice,
    parentInode: allocation.parentInode,
    directory: allocation.directory,
    directoryDevice: cancellation.directoryDevice,
    directoryInode: cancellation.directoryInode,
    ownerToken: allocation.ownerToken,
    proofDigest: cancellation.digest,
    proofKind: "cancelled" as const,
  });
}

function releaseReferenceForConfirmedOwner(
  ownerValue: unknown,
  proofValue: unknown,
): PrivateLinuxOwnerStateReleaseReference {
  const identity = isPreparedOwnerValue(ownerValue)
    ? normalizePrivateLinuxPreparedOwnerIdentity(ownerValue).owner
    : normalizePrivateLinuxSealedOwnerIdentity(ownerValue);
  const prepared = preparedIdentityFor(identity);
  const proof = normalizePrivateLinuxConfirmedEnforcementReceipt(proofValue);
  if (proof.ownerDigest !== prepared.digest) {
    throw new TypeError("Linux enforcement receipt belongs to another owner");
  }
  return Object.freeze({
    allocationDigest: identity.ownerStateAllocationDigest,
    parent: identity.ownerStateParent,
    parentDevice: identity.ownerStateParentDevice,
    parentInode: identity.ownerStateParentInode,
    directory: identity.ownerStateDirectory,
    directoryDevice: identity.ownerStateDevice,
    directoryInode: identity.ownerStateInode,
    ownerToken: identity.ownerToken,
    proofDigest: privateDomainDigest(
      "JIG-Private-Linux-Owner-State-Release-Proof/1",
      proof as unknown as JsonValue,
    ),
    proofKind: "confirmed" as const,
    prepared,
  });
}

export function normalizePrivateLinuxConfirmedEnforcementReceipt(
  value: unknown,
): PrivateLinuxConfirmedEnforcementReceipt {
  const record = ordinaryDataRecord(value, "Linux enforcement receipt");
  const keys = [
    "evidence", "exitCode", "fenced", "kind", "ownerDigest", "signal", "stopReason",
    ...(record.setupError === undefined ? [] : ["setupError"]),
    ...(record.killError === undefined ? [] : ["killError"]),
  ];
  if (!exactStringKeys(record, keys) || record.kind !== "private-linux-confirmed-enforcement/1" ||
      typeof record.ownerDigest !== "string" || !DIGEST.test(record.ownerDigest) || record.fenced !== true ||
      !["cancelled", "coordinator_lost", "deadline", "payload_exit", "setup_failed", "recovered"]
        .includes(String(record.stopReason)) ||
      !(record.exitCode === null || (Number.isSafeInteger(record.exitCode) && Number(record.exitCode) >= 0)) ||
      !(record.signal === null || typeof record.signal === "string") ||
      !(record.setupError === undefined || typeof record.setupError === "string") ||
      !(record.killError === undefined || typeof record.killError === "string")) {
    throw new TypeError("Linux enforcement receipt is invalid");
  }
  return Object.freeze({
    kind: "private-linux-confirmed-enforcement/1" as const,
    ownerDigest: record.ownerDigest,
    stopReason: record.stopReason as PrivateLinuxConfirmedEnforcementReceipt["stopReason"],
    exitCode: record.exitCode as number | null,
    signal: record.signal as string | null,
    fenced: true as const,
    ...(record.setupError === undefined ? {} : { setupError: record.setupError as string }),
    ...(record.killError === undefined ? {} : { killError: record.killError as string }),
    evidence: normalizeEvidence(record.evidence),
  });
}

/** Strictly decode one owner-state release receipt retained by Jig. */
export function normalizePrivateLinuxOwnerStateReleaseReceipt(
  value: unknown,
): PrivateLinuxOwnerStateReleaseReceipt {
  const record = exactDataRecord(value, [
    "allocationDigest", "digest", "directoryDevice", "directoryInode", "kind", "released",
  ], "Linux owner-state release receipt");
  if (record.kind !== "private-linux-owner-state-release/1" || record.released !== true ||
      typeof record.digest !== "string" || typeof record.allocationDigest !== "string" ||
      !DIGEST.test(record.allocationDigest) || typeof record.directoryDevice !== "string" ||
      !/^(?:0|[1-9][0-9]*)$/.test(record.directoryDevice) ||
      typeof record.directoryInode !== "string" || !/^[1-9][0-9]*$/.test(record.directoryInode)) {
    throw new TypeError("Linux owner-state release receipt is invalid");
  }
  const fields = {
    kind: "private-linux-owner-state-release/1" as const,
    allocationDigest: record.allocationDigest,
    directoryDevice: record.directoryDevice,
    directoryInode: record.directoryInode,
    released: true as const,
  };
  if (record.digest !== privateDomainDigest(
    "JIG-Private-Linux-Owner-State-Release/1",
    fields as unknown as JsonValue,
  )) {
    throw new TypeError("Linux owner-state release receipt digest is invalid");
  }
  return Object.freeze({ ...fields, digest: record.digest });
}

async function requireReleaseParent(reference: PrivateLinuxOwnerStateReleaseReference): Promise<void> {
  const parent = await lstat(reference.parent, { bigint: true });
  if (!parent.isDirectory() || parent.isSymbolicLink() ||
      String(parent.dev) !== reference.parentDevice || String(parent.ino) !== reference.parentInode ||
      (Number(parent.mode) & 0o077) !== 0) {
    throw new Error("Linux owner-state release parent changed");
  }
}

function privateLinuxOwnerStateReleaseReceipt(
  reference: PrivateLinuxOwnerStateReleaseReference,
): PrivateLinuxOwnerStateReleaseReceipt {
  const fields = {
    kind: "private-linux-owner-state-release/1" as const,
    allocationDigest: reference.allocationDigest,
    directoryDevice: reference.directoryDevice,
    directoryInode: reference.directoryInode,
    released: true as const,
  };
  return normalizePrivateLinuxOwnerStateReleaseReceipt({
    ...fields,
    digest: privateDomainDigest(
      "JIG-Private-Linux-Owner-State-Release/1",
      fields as unknown as JsonValue,
    ),
  });
}

interface PrivateLinuxReleaseMarker {
  readonly allocationDigest: string;
  readonly directoryDevice: string;
  readonly directoryInode: string;
  readonly kind: "private-linux-owner-state-release-marker/1";
  readonly proofDigest: string;
}

function privateLinuxReleaseMarker(
  reference: PrivateLinuxOwnerStateReleaseReference,
): PrivateLinuxReleaseMarker {
  return Object.freeze({
    allocationDigest: reference.allocationDigest,
    directoryDevice: reference.directoryDevice,
    directoryInode: reference.directoryInode,
    kind: "private-linux-owner-state-release-marker/1" as const,
    proofDigest: reference.proofDigest,
  });
}

async function tryReadPrivateLinuxReleaseMarker(
  reference: PrivateLinuxOwnerStateReleaseReference,
): Promise<PrivateLinuxReleaseMarker | undefined> {
  const path = join(reference.directory, "release.json");
  try {
    const information = await lstat(path);
    if (!information.isFile() || information.isSymbolicLink() || (information.mode & 0o077) !== 0) {
      throw new Error("Linux owner-state release marker is invalid");
    }
    const value = JSON.parse(await readFile(path, "utf8")) as unknown;
    const expected = privateLinuxReleaseMarker(reference);
    if (value === null || typeof value !== "object" || Array.isArray(value) ||
        !exactStringKeys(value as Record<string, unknown>, Object.keys(expected)) ||
        JSON.stringify(value) !== JSON.stringify(expected)) {
      throw new Error("Linux owner-state release marker is invalid");
    }
    return expected;
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return undefined;
    throw error;
  }
}

async function writePrivateLinuxReleaseMarker(
  reference: PrivateLinuxOwnerStateReleaseReference,
): Promise<void> {
  const marker = privateLinuxReleaseMarker(reference);
  const target = join(reference.directory, "release.json");
  const temporary = join(reference.directory, `.release-${process.pid}-${randomBytes(8).toString("hex")}`);
  const file = await open(temporary, "wx", 0o600);
  try {
    await file.writeFile(`${JSON.stringify(marker)}\n`, "utf8");
    await file.sync();
  } finally {
    await file.close();
  }
  try {
    await link(temporary, target);
    await syncPrivateDirectory(reference.directory);
  } catch (error) {
    if (!hasErrorCode(error, "EEXIST")) throw error;
    await tryReadPrivateLinuxReleaseMarker(reference);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

async function requirePrivateLinuxReleaseProofFiles(
  reference: PrivateLinuxOwnerStateReleaseReference,
): Promise<void> {
  const entries = await readdir(reference.directory);
  const withoutTemporary = entries.filter((entry) => !/^\.(?:final|release)-[0-9]+-[0-9a-f]{16}$/.test(entry));
  const allowed = new Set(["owner.json", "claim.json", "final.json", "release.json"]);
  if (withoutTemporary.some((entry) => !allowed.has(entry))) {
    throw new Error("Linux owner-state release found unexpected state");
  }
  await requirePrivateLinuxOwnerRecord({
    allocationDigest: reference.allocationDigest,
    directory: reference.directory,
    ownerToken: reference.ownerToken,
  });
  const claim = await readPrivateLinuxOwnerClaim(reference);
  if (reference.proofKind === "cancelled") {
    if (claim !== "cancelled") throw new Error("Linux owner-state release lacks its cancellation fence");
  } else {
    if (reference.prepared === undefined || await tryReadPrivateLinuxFinalReceipt(reference.prepared) === undefined) {
      throw asFenceUnconfirmed(new Error("Linux owner-state release lacks its durable fence receipt"));
    }
  }
}

async function removePrivateLinuxOwnerStateFiles(
  reference: PrivateLinuxOwnerStateReleaseReference,
): Promise<void> {
  const entries = await readdir(reference.directory);
  for (const entry of entries.filter((candidate) => candidate !== "release.json")) {
    if (!["owner.json", "claim.json", "final.json", "release.json"].includes(entry) &&
        !/^\.(?:final|release)-[0-9]+-[0-9a-f]{16}$/.test(entry)) {
      throw new Error("Linux owner-state release found unexpected state");
    }
    const path = join(reference.directory, entry);
    const information = await lstat(path);
    if (!information.isFile() || information.isSymbolicLink()) {
      throw new Error("Linux owner-state release found a non-file entry");
    }
    await unlink(path);
  }
  await syncPrivateDirectory(reference.directory);
  await unlink(join(reference.directory, "release.json")).catch((error) => {
    if (!hasErrorCode(error, "ENOENT")) throw error;
  });
  await syncPrivateDirectory(reference.directory);
}

async function requirePrivateLinuxOwnerStateAllocationParent(
  allocation: PrivateLinuxOwnerStateAllocationIdentity,
): Promise<void> {
  const parent = await lstat(allocation.parent, { bigint: true });
  const expectedUid = typeof process.getuid === "function" ? process.getuid() : -1;
  if (!parent.isDirectory() || parent.isSymbolicLink() ||
      String(parent.dev) !== allocation.parentDevice || String(parent.ino) !== allocation.parentInode ||
      Number(parent.uid) !== expectedUid || (Number(parent.mode) & 0o077) !== 0) {
    throw new Error("Linux owner-state allocation parent changed");
  }
}

async function requirePrivateLinuxAllocationDirectory(
  allocation: PrivateLinuxOwnerStateAllocationIdentity,
): Promise<Awaited<ReturnType<typeof lstat>>> {
  const directory = await lstat(allocation.directory, { bigint: true });
  const expectedUid = typeof process.getuid === "function" ? process.getuid() : -1;
  if (!directory.isDirectory() || directory.isSymbolicLink() ||
      Number(directory.uid) !== expectedUid || (Number(directory.mode) & 0o077) !== 0) {
    throw new Error("Linux owner-state allocation directory is not protected");
  }
  return directory;
}

async function reconcileIncompletePrivateLinuxOwnerRecord(
  allocation: PrivateLinuxOwnerStateAllocationIdentity,
): Promise<void> {
  const ownerPath = join(allocation.directory, "owner.json");
  try {
    const owner = await lstat(ownerPath);
    if (!owner.isFile() || owner.isSymbolicLink()) {
      throw new Error("Linux owner-state record is not a regular file");
    }
    try {
      await requirePrivateLinuxOwnerRecord({
        allocationDigest: allocation.digest,
        directory: allocation.directory,
        ownerToken: allocation.ownerToken,
      });
      return;
    } catch {
      const entries = await readdir(allocation.directory);
      if (entries.some((entry) => entry !== "owner.json")) {
        throw new Error("incomplete Linux owner state contains unexpected entries");
      }
      // No wrapper can pass authentication through an invalid owner record.
      // Unlinking only this exact regular file lets cancellation become the
      // permanent winner even if a crashed seal left a partial write.
      await unlink(ownerPath);
      await syncPrivateDirectory(allocation.directory);
    }
  } catch (error) {
    if (!hasErrorCode(error, "ENOENT")) throw error;
  }
}

interface PrivateLinuxOwnerRecordReference {
  readonly allocationDigest: string;
  readonly directory: string;
  readonly ownerToken: string;
}

async function ensurePrivateLinuxOwnerRecord(reference: PrivateLinuxOwnerRecordReference): Promise<void> {
  const path = join(reference.directory, "owner.json");
  try {
    const file = await open(path, "wx", 0o600);
    try {
      await file.writeFile(`${JSON.stringify({
        allocationDigest: reference.allocationDigest,
        kind: "private-linux-owner-state/1",
        token: reference.ownerToken,
      })}\n`, "utf8");
      await file.sync();
    } finally {
      await file.close();
    }
  } catch (error) {
    if (!hasErrorCode(error, "EEXIST")) throw error;
    await requirePrivateLinuxOwnerRecord(reference);
  }
}

async function requirePrivateLinuxOwnerRecord(reference: PrivateLinuxOwnerRecordReference): Promise<void> {
  const path = join(reference.directory, "owner.json");
  const information = await lstat(path);
  if (!information.isFile() || information.isSymbolicLink() || (information.mode & 0o077) !== 0) {
    throw new Error("Linux owner-state record is invalid");
  }
  const value = JSON.parse(await readFile(path, "utf8")) as unknown;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Linux owner-state record is invalid");
  }
  const record = value as Record<string, unknown>;
  if (!exactStringKeys(record, ["allocationDigest", "kind", "token"]) ||
      record.kind !== "private-linux-owner-state/1" ||
      record.allocationDigest !== reference.allocationDigest || record.token !== reference.ownerToken) {
    throw new Error("Linux owner-state record is invalid");
  }
}

async function claimPrivateLinuxAllocationCancellation(
  allocation: PrivateLinuxOwnerStateAllocationIdentity,
): Promise<"won" | "active" | "cancelled"> {
  const claimPath = join(allocation.directory, "claim.json");
  try {
    const file = await open(claimPath, "wx", 0o600);
    try {
      await file.writeFile(`${JSON.stringify({
        allocationDigest: allocation.digest,
        kind: "private-linux-owner-claim/1",
        state: "cancelled",
        token: allocation.ownerToken,
      })}\n`, "utf8");
      await file.sync();
    } finally {
      await file.close();
    }
    await syncPrivateDirectory(allocation.directory);
    return "won";
  } catch (error) {
    if (!hasErrorCode(error, "EEXIST")) throw error;
  }
  return await readPrivateLinuxOwnerClaim({
    allocationDigest: allocation.digest,
    directory: allocation.directory,
    ownerToken: allocation.ownerToken,
  });
}

async function readPrivateLinuxOwnerClaim(
  reference: PrivateLinuxOwnerRecordReference,
): Promise<"active" | "cancelled"> {
  const path = join(reference.directory, "claim.json");
  const information = await lstat(path);
  if (!information.isFile() || information.isSymbolicLink() || (information.mode & 0o022) !== 0) {
    throw new Error("Linux owner-state claim is invalid");
  }
  const value = JSON.parse(await readFile(path, "utf8")) as unknown;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Linux owner-state claim is invalid");
  }
  const record = value as Record<string, unknown>;
  if (!exactStringKeys(record, ["allocationDigest", "kind", "state", "token"]) ||
      record.kind !== "private-linux-owner-claim/1" ||
      record.allocationDigest !== reference.allocationDigest || record.token !== reference.ownerToken ||
      !["active", "cancelled"].includes(String(record.state))) {
    throw new Error("Linux owner-state claim is invalid");
  }
  return record.state as "active" | "cancelled";
}

async function createPrivateLinuxOwnerState(
  source: PrivateLinuxOwnerStateLocation | PrivateLinuxOwnerStateAllocationIdentity | undefined,
  nonce: string,
): Promise<AllocatedLinuxOwnerState> {
  let allocation: PrivateLinuxOwnerStateAllocationIdentity;
  let automaticParent: string | undefined;
  if (source === undefined) {
    automaticParent = await mkdtemp(join(tmpdir(), "jig-linux-owner-state-"));
    allocation = await planPrivateLinuxOwnerStateAllocation({
      parent: automaticParent,
      name: `owner-${nonce}`,
    });
  } else if (isOwnerStateAllocationValue(source)) {
    allocation = normalizePrivateLinuxOwnerStateAllocationIdentity(source);
  } else {
    allocation = await planPrivateLinuxOwnerStateAllocation(source as PrivateLinuxOwnerStateLocation);
  }
  const parentInformation = await lstat(allocation.parent, { bigint: true });
  const expectedUid = typeof process.getuid === "function" ? process.getuid() : -1;
  if (!parentInformation.isDirectory() || parentInformation.isSymbolicLink() ||
      String(parentInformation.dev) !== allocation.parentDevice ||
      String(parentInformation.ino) !== allocation.parentInode ||
      Number(parentInformation.uid) !== expectedUid || (Number(parentInformation.mode) & 0o077) !== 0) {
    if (automaticParent !== undefined) await rm(automaticParent, { recursive: true, force: true });
    throw new TypeError("Linux owner-state parent is not protected");
  }
  try {
    await mkdir(allocation.directory, { mode: 0o700 }).catch((error) => {
      if (!hasErrorCode(error, "EEXIST")) throw error;
    });
    const information = await lstat(allocation.directory, { bigint: true });
    if (!information.isDirectory() || information.isSymbolicLink() ||
        Number(information.uid) !== expectedUid || (Number(information.mode) & 0o077) !== 0) {
      throw new TypeError("Linux owner-state directory is not protected");
    }
    return Object.freeze({
      allocation,
      parent: allocation.parent,
      parentDevice: String(parentInformation.dev),
      parentInode: String(parentInformation.ino),
      name: allocation.name,
      directory: allocation.directory,
      device: String(information.dev),
      inode: String(information.ino),
      ...(automaticParent === undefined ? {} : { automaticParent }),
    });
  } catch (error) {
    if (automaticParent !== undefined) {
      await rm(allocation.directory, { recursive: true, force: true }).catch(() => undefined);
    }
    if (automaticParent !== undefined) await rm(automaticParent, { recursive: true, force: true });
    throw error;
  }
}

function isOwnerStateAllocationValue(value: unknown): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const descriptor = Object.getOwnPropertyDescriptor(value, "kind");
  return descriptor !== undefined && "value" in descriptor &&
    descriptor.value === "private-linux-owner-state-allocation/1";
}

function ownerStateAllocationFor(
  identity: PrivateLinuxSealedOwnerIdentity,
): PrivateLinuxOwnerStateAllocationIdentity {
  return normalizePrivateLinuxOwnerStateAllocationIdentity({
    kind: "private-linux-owner-state-allocation/1",
    digest: identity.ownerStateAllocationDigest,
    parent: identity.ownerStateParent,
    parentDevice: identity.ownerStateParentDevice,
    parentInode: identity.ownerStateParentInode,
    name: identity.ownerStateName,
    directory: identity.ownerStateDirectory,
    ownerToken: identity.ownerToken,
  });
}

async function initializePrivateLinuxOwnerState(identity: PrivateLinuxSealedOwnerIdentity): Promise<void> {
  await requirePrivateLinuxOwnerStateDirectory(identity, false);
  await ensurePrivateLinuxOwnerRecord({
    allocationDigest: identity.ownerStateAllocationDigest,
    directory: identity.ownerStateDirectory,
    ownerToken: identity.ownerToken,
  });
  await syncPrivateDirectory(identity.ownerStateDirectory);
  await syncPrivateDirectory(identity.ownerStateParent);
  await requirePrivateLinuxOwnerStateDirectory(identity);
}

function preparedIdentityFor(identity: PrivateLinuxSealedOwnerIdentity): PrivateLinuxPreparedOwnerIdentity {
  return normalizePrivateLinuxPreparedOwnerIdentity({
    kind: "private-linux-prepared-owner/1",
    digest: privateDomainDigest(
      "JIG-Private-Linux-Prepared-Owner/1",
      identity as unknown as JsonValue,
    ),
    owner: identity,
  });
}

function isPreparedOwnerValue(value: unknown): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const descriptor = Object.getOwnPropertyDescriptor(value, "kind");
  return descriptor !== undefined && "value" in descriptor && descriptor.value === "private-linux-prepared-owner/1";
}

async function requirePrivateLinuxOwnerStateDirectory(
  identity: PrivateLinuxSealedOwnerIdentity,
  requireOwnerRecord = true,
): Promise<void> {
  const [parent, directory] = await Promise.all([
    lstat(identity.ownerStateParent, { bigint: true }),
    lstat(identity.ownerStateDirectory, { bigint: true }),
  ]);
  if (!parent.isDirectory() || parent.isSymbolicLink() || String(parent.dev) !== identity.ownerStateParentDevice ||
      String(parent.ino) !== identity.ownerStateParentInode || (Number(parent.mode) & 0o077) !== 0 ||
      !directory.isDirectory() || directory.isSymbolicLink() || String(directory.dev) !== identity.ownerStateDevice ||
      String(directory.ino) !== identity.ownerStateInode || (Number(directory.mode) & 0o077) !== 0) {
    throw new Error("Linux owner-state identity changed");
  }
  if (!requireOwnerRecord) return;
  await requirePrivateLinuxOwnerRecord({
    allocationDigest: identity.ownerStateAllocationDigest,
    directory: identity.ownerStateDirectory,
    ownerToken: identity.ownerToken,
  });
}

async function claimPrivateLinuxOwnerCancellation(
  identity: PrivateLinuxSealedOwnerIdentity,
): Promise<"won" | "active" | "cancelled"> {
  const claimPath = join(identity.ownerStateDirectory, "claim.json");
  try {
    const file = await open(claimPath, "wx", 0o600);
    try {
      await file.writeFile(`${JSON.stringify({
        allocationDigest: identity.ownerStateAllocationDigest,
        kind: "private-linux-owner-claim/1",
        state: "cancelled",
        token: identity.ownerToken,
      })}\n`, "utf8");
      await file.sync();
    } finally {
      await file.close();
    }
    await syncPrivateDirectory(identity.ownerStateDirectory);
    return "won";
  } catch (error) {
    if (!hasErrorCode(error, "EEXIST")) throw error;
  }
  return await readPrivateLinuxOwnerClaim({
    allocationDigest: identity.ownerStateAllocationDigest,
    directory: identity.ownerStateDirectory,
    ownerToken: identity.ownerToken,
  });
}

async function recoverPrivateLinuxOwnerState(
  options: NormalizedBackendOptions,
  mechanism: PrivateLinuxBackendMechanismObservation,
  identity: PrivateLinuxSealedOwnerIdentity,
): Promise<RecoveryFenceMessage> {
  await requirePrivateLinuxOwnerStateDirectory(identity);
  const prepared = preparedIdentityFor(identity);
  const existing = await tryReadPrivateLinuxFinalReceipt(prepared);
  if (existing !== undefined) return existing;
  const claim = await claimPrivateLinuxOwnerCancellation(identity);
  if (claim === "active") {
    const completed = await tryReadPrivateLinuxFinalReceipt(prepared);
    if (completed !== undefined) return completed;
    throw asFenceUnconfirmed(new Error(
      "active Linux cleanup owner has not durably published its fence receipt",
    ));
  }
  const finalized = await runRecoveryHelper(options, mechanism, prepared);
  await writePrivateLinuxFinalReceipt(prepared, finalized);
  return finalized;
}

async function readPrivateLinuxFinalReceipt(
  prepared: PrivateLinuxPreparedOwnerIdentity,
): Promise<RecoveryFenceMessage> {
  const value = await tryReadPrivateLinuxFinalReceipt(prepared);
  if (value === undefined) throw new Error("Linux cleanup owner omitted its durable final receipt");
  return value;
}

async function tryReadPrivateLinuxFinalReceipt(
  prepared: PrivateLinuxPreparedOwnerIdentity,
): Promise<RecoveryFenceMessage | undefined> {
  await requirePrivateLinuxOwnerStateDirectory(prepared.owner);
  try {
    const path = join(prepared.owner.ownerStateDirectory, "final.json");
    const information = await lstat(path);
    if (!information.isFile() || information.isSymbolicLink() || (information.mode & 0o022) !== 0) {
      throw new Error("Linux cleanup owner final receipt is invalid");
    }
    const text = await readFile(path, "utf8");
    if (!text.endsWith("\n") || text.slice(0, -1).includes("\n")) {
      throw new Error("Linux cleanup owner final receipt is invalid");
    }
    const receipt = parseRecoveryFenceMessage(JSON.parse(text.slice(0, -1)) as unknown);
    requireRecoveryFenceMessage(receipt, prepared);
    return receipt;
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return undefined;
    throw error;
  }
}

async function writePrivateLinuxFinalReceipt(
  prepared: PrivateLinuxPreparedOwnerIdentity,
  receipt: RecoveryFenceMessage,
): Promise<void> {
  requireRecoveryFenceMessage(receipt, prepared);
  const directory = prepared.owner.ownerStateDirectory;
  const target = join(directory, "final.json");
  const temporary = join(directory, `.final-${process.pid}-${randomBytes(8).toString("hex")}`);
  const file = await open(temporary, "wx", 0o600);
  try {
    await file.writeFile(`${JSON.stringify(receipt)}\n`, "utf8");
    await file.sync();
  } finally {
    await file.close();
  }
  try {
    await link(temporary, target);
    await syncPrivateDirectory(directory);
  } catch (error) {
    if (!hasErrorCode(error, "EEXIST")) throw error;
    const existing = await readPrivateLinuxFinalReceipt(prepared);
    if (JSON.stringify(existing) !== JSON.stringify(receipt)) {
      throw asFenceUnconfirmed(new Error("Linux cleanup owners produced conflicting fence receipts"));
    }
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

async function disposePrivateLinuxOwnerState(
  identity: PrivateLinuxSealedOwnerIdentity,
  automaticParent?: string,
): Promise<void> {
  const prepared = preparedIdentityFor(identity);
  const finalized = await readPrivateLinuxFinalReceipt(prepared);
  await releasePrivateLinuxOwnerState(identity, confirmedRecoveryReceipt(prepared, finalized));
  if (automaticParent !== undefined) await rmdir(automaticParent);
}

async function syncPrivateDirectory(path: string): Promise<void> {
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function runRecoveryHelper(
  options: NormalizedBackendOptions,
  mechanism: PrivateLinuxBackendMechanismObservation,
  prepared: PrivateLinuxPreparedOwnerIdentity,
): Promise<RecoveryFenceMessage> {
  const identity = prepared.owner;
  const child = spawn(
    mechanism.trustedLauncherPath,
    [
      "-n",
      "--",
      mechanism.trustedSubreaperPath,
      "--",
      mechanism.trustedBashPath,
      "--noprofile",
      "--norc",
      "-p",
      "-c",
      EMPTY_ROOT_ENVIRONMENT,
      "jig-cgroup-recovery",
      mechanism.trustedCoordinatorBunPath,
      ...HELPER_BUN_POLICY,
      mechanism.trustedRecoveryHelperPath,
      "--scope", identity.cgroupScope,
      "--parent", identity.parentName,
      "--owner-digest", prepared.digest,
      "--cleanup-ms", String(identity.cleanupTimeoutMs),
    ],
    { cwd: "/", env: {}, stdio: ["pipe", "pipe", "pipe"] },
  );
  child.stdin.end();
  const receipt = readFinalizerReceipt(child.stdout);
  const stderr = readBoundedText(child.stderr, CONTROL_BYTES, "cgroup recovery stderr");
  const close = childClose(child);
  try {
    const result = await withTimeout(
      Promise.all([receipt, stderr, close]),
      identity.cleanupTimeoutMs + options.startupTimeoutMs,
      "exact cgroup recovery",
    );
    const [finalized, diagnostic, exit] = result;
    if (exit.code !== 0) {
      throw new Error(`trusted cgroup recovery failed (${exit.code ?? exit.signal}): ${diagnostic.trim()}`);
    }
    requireRecoveryFenceMessage(finalized, prepared);
    return finalized;
  } catch (error) {
    throw asFenceUnconfirmed(error);
  }
}

async function readFinalizerReceipt(source: unknown): Promise<RecoveryFenceMessage> {
  if (source === null || typeof source !== "object" ||
      typeof (source as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] !== "function") {
    throw new Error("trusted cgroup finalizer receipt pipe was unavailable");
  }
  const text = await readBoundedText(
    source as AsyncIterable<Uint8Array>,
    CONTROL_BYTES,
    "cgroup finalizer receipt",
  );
  if (!text.endsWith("\n") || text.slice(0, -1).includes("\n") || text.length < 2) {
    throw new Error("trusted cgroup finalizer returned an invalid receipt stream");
  }
  return parseRecoveryFenceMessage(JSON.parse(text.slice(0, -1)) as unknown);
}

async function readBoundedText(
  source: AsyncIterable<Uint8Array>,
  limit: number,
  label: string,
): Promise<string> {
  let result = "";
  for await (const chunk of source) {
    result += Buffer.from(chunk).toString("utf8");
    if (Buffer.byteLength(result) > limit) throw new Error(`${label} overflow`);
  }
  return result;
}

function parseRecoveryFenceMessage(value: unknown): RecoveryFenceMessage {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("invalid trusted cgroup finalizer receipt");
  }
  const message = value as Record<string, unknown>;
  if (!exactStringKeys(message, [
    "evidence", "exitCode", "fenced", "ownerDigest", "parentCgroup", "privateDeviceDirectory",
    "runCgroup", "signal", "stopReason", "supervisorCgroup", "type",
  ]) || message.type !== "fenced" || typeof message.ownerDigest !== "string" ||
      message.stopReason !== "recovered" || message.exitCode !== null || message.signal !== null ||
      message.fenced !== true || typeof message.parentCgroup !== "string" ||
      typeof message.supervisorCgroup !== "string" || typeof message.runCgroup !== "string" ||
      typeof message.privateDeviceDirectory !== "string") {
    throw new Error("invalid trusted cgroup finalizer receipt");
  }
  return Object.freeze({
    type: "fenced" as const,
    ownerDigest: message.ownerDigest,
    stopReason: "recovered" as const,
    exitCode: null,
    signal: null,
    fenced: true as const,
    parentCgroup: message.parentCgroup,
    supervisorCgroup: message.supervisorCgroup,
    runCgroup: message.runCgroup,
    privateDeviceDirectory: message.privateDeviceDirectory,
    evidence: normalizeEvidence(message.evidence),
  });
}

function requireRecoveryFenceMessage(
  message: RecoveryFenceMessage,
  prepared: PrivateLinuxPreparedOwnerIdentity,
): void {
  const owner = prepared.owner;
  if (message.ownerDigest !== prepared.digest || message.parentCgroup !== owner.parentCgroup ||
      message.supervisorCgroup !== owner.supervisorCgroup || message.runCgroup !== owner.runCgroup ||
      message.privateDeviceDirectory !== owner.privateDeviceDirectory || message.fenced !== true) {
    throw asFenceUnconfirmed(new Error("trusted cgroup finalizer fenced an unexpected owner"));
  }
}

async function observeBackendMechanism(
  options: NormalizedBackendOptions,
  helperPath: string,
): Promise<PrivateLinuxBackendMechanismObservation> {
  const [cgroupScope, trustedHelperPath, trustedLaunchWrapperPath, trustedRecoveryHelperPath, trustedBubblewrapPath,
    trustedCoordinatorBunPath, trustedLauncherPath, trustedSubreaperPath,
    trustedMknodTargetPath, trustedBashPath, trustedBackendPath] = await Promise.all([
    realpath(options.cgroupScope),
    realpath(helperPath),
    realpath(options.launchWrapperPath),
    realpath(options.recoveryHelperPath),
    realpath(options.bubblewrapPath),
    realpath(options.bunPath),
    realpath(options.sudoPath),
    realpath(options.subreaperPath),
    realpath(options.mknodPath),
    realpath(options.bashPath),
    realpath(fileURLToPath(import.meta.url)),
  ]);
  const [trustedHelperDigest, trustedLaunchWrapperDigest, trustedRecoveryHelperDigest,
    trustedBubblewrapDigest, trustedCoordinatorBunDigest,
    trustedLauncherDigest, trustedSubreaperDigest, trustedMknodDigest, trustedBashDigest,
    trustedBackendDigest] = await Promise.all([
    privateFileDigest(trustedHelperPath),
    privateFileDigest(trustedLaunchWrapperPath),
    privateFileDigest(trustedRecoveryHelperPath),
    privateFileDigest(trustedBubblewrapPath),
    privateFileDigest(trustedCoordinatorBunPath),
    privateFileDigest(trustedLauncherPath),
    privateFileDigest(trustedSubreaperPath),
    privateFileDigest(trustedMknodTargetPath),
    privateFileDigest(trustedBashPath),
    privateFileDigest(trustedBackendPath),
  ]);
  const [filesystem, scopeInformation, controllersText, processes] = await Promise.all([
    statfs(cgroupScope),
    stat(cgroupScope, { bigint: true }),
    readFile(join(cgroupScope, "cgroup.controllers"), "utf8"),
    readFile(join(cgroupScope, "cgroup.procs"), "utf8"),
  ]);
  if (filesystem.type !== CGROUP2_SUPER_MAGIC) throw new Error("Linux Backend requires cgroup v2");
  const availableControllers = new Set(controllersText.trim().split(/\s+/));
  const controllers = Object.freeze(["cpu", "memory", "pids"] as const);
  for (const controller of controllers) {
    if (!availableControllers.has(controller)) {
      throw new Error(`Linux Backend is missing the ${controller} controller`);
    }
  }
  if (processes.trim() !== "") throw new Error("Linux Backend cgroup scope is not empty");
  const identity = Object.freeze({
    kind: "linux-cgroup-v2-bubblewrap-mechanism/1" as const,
    cgroupScope,
    trustedHelperPath,
    trustedHelperDigest,
    trustedLaunchWrapperPath,
    trustedLaunchWrapperDigest,
    trustedRecoveryHelperPath,
    trustedRecoveryHelperDigest,
    trustedBubblewrapPath,
    trustedBubblewrapDigest,
    trustedCoordinatorBunPath,
    trustedCoordinatorBunDigest,
    trustedLauncherPath,
    trustedLauncherDigest,
    trustedSubreaperPath,
    trustedSubreaperDigest,
    // Execute the same canonical inode path whose bytes were digested above;
    // retaining the caller's symlink spelling would permit a later retarget.
    trustedMknodPath: trustedMknodTargetPath,
    trustedMknodTargetPath,
    trustedMknodDigest,
    trustedBashPath,
    trustedBashDigest,
    trustedBackendPath,
    trustedBackendDigest,
    cgroupVersion: 2 as const,
    cgroupScopeDevice: String(scopeInformation.dev),
    cgroupScopeInode: String(scopeInformation.ino),
    controllers,
    scopeEmpty: true as const,
    launcherMode: "sudo-n" as const,
    payloadUid: options.payloadUid,
    payloadGid: options.payloadGid,
    startupTimeoutMs: options.startupTimeoutMs,
  });
  const observation = Object.freeze({
    ...identity,
    digest: privateDomainDigest(
      "JIG-Linux-Backend-Mechanism/1",
      identity as unknown as JsonValue,
    ),
  });
  return observation;
}

async function sealMountSources(
  plan: PrivateLinuxLaunchPlan,
  payloadUid: number,
): Promise<PrivateLinuxSealedLaunchPlan> {
  const deviceRoot = await stat("/dev");
  const mounts: PrivateLinuxSealedReadOnlyMount[] = [];
  for (const mount of plan.readOnlyMounts) {
    const source = await realpath(mount.source);
    const [filesystem, information] = await Promise.all([
      statfs(source),
      stat(source, { bigint: true }),
    ]);
    if ([CGROUP2_SUPER_MAGIC, DEVPTS_SUPER_MAGIC, PROC_SUPER_MAGIC, SYSFS_SUPER_MAGIC]
      .includes(Number(filesystem.type)) || ["/dev", "/proc", "/run", "/sys"].some(
        (root) => source === root || source.startsWith(`${root}/`),
      ) || Number(information.dev) === deviceRoot.dev) {
      throw new TypeError("host pseudo-filesystem cannot enter the sandbox through an alias");
    }
    const sourceType = information.isDirectory()
      ? "directory"
      : information.isFile()
      ? "file"
      : undefined;
    if (sourceType === undefined) {
      throw new TypeError("read-only mount source must be a regular file or directory");
    }
    await requirePayloadTraversal(source, sourceType, payloadUid);
    mounts.push(Object.freeze({
      source,
      destination: resolve(mount.destination),
      sourceDevice: String(information.dev),
      sourceInode: String(information.ino),
      sourceType,
    }));
  }
  const environment = plan.environment === undefined
    ? undefined
    : Object.freeze(Object.fromEntries(Object.entries(plan.environment)));
  return Object.freeze({
    runId: plan.runId,
    limits: Object.freeze({
      memoryBytes: plan.limits.memoryBytes,
      pids: plan.limits.pids,
      cpuQuotaMicros: plan.limits.cpuQuotaMicros,
      cpuPeriodMicros: plan.limits.cpuPeriodMicros,
      deadlineUnixMs: plan.limits.deadlineUnixMs,
      cancellationGraceMs: plan.limits.cancellationGraceMs,
      ...(plan.limits.cleanupTimeoutMs === undefined
        ? {}
        : { cleanupTimeoutMs: plan.limits.cleanupTimeoutMs }),
    }),
    readOnlyMounts: Object.freeze(mounts),
    command: Object.freeze([...plan.command]) as unknown as readonly [string, ...string[]],
    ...(environment === undefined ? {} : { environment }),
    ...(plan.privateProcessFilesystem === undefined
      ? {}
      : { privateProcessFilesystem: plan.privateProcessFilesystem }),
    ...(plan.privateRuntimeDevices === undefined
      ? {}
      : { privateRuntimeDevices: plan.privateRuntimeDevices }),
    ...(plan.trustedHelperPath === undefined ? {} : { trustedHelperPath: plan.trustedHelperPath }),
  });
}

async function requirePayloadTraversal(
  source: string,
  sourceType: PrivateLinuxSealedReadOnlyMount["sourceType"],
  payloadUid: number,
): Promise<void> {
  const segments = source.split("/").filter(Boolean);
  const traversed = sourceType === "directory" ? segments : segments.slice(0, -1);
  let current = "/";
  for (const segment of traversed) {
    current = join(current, segment);
    const information = await stat(current);
    const executable = information.uid === payloadUid
      ? (information.mode & 0o100) !== 0
      : (information.mode & 0o001) !== 0;
    if (!information.isDirectory() || !executable) {
      throw new TypeError(`payload identity cannot traverse read-only mount source ${source}`);
    }
  }
}

async function requireSealedMountSources(mounts: readonly PrivateLinuxSealedReadOnlyMount[]): Promise<void> {
  for (const mount of mounts) {
    const information = await stat(mount.source, { bigint: true });
    const sourceType = information.isDirectory()
      ? "directory"
      : information.isFile()
      ? "file"
      : undefined;
    if (String(information.dev) !== mount.sourceDevice ||
        String(information.ino) !== mount.sourceInode || sourceType !== mount.sourceType) {
      throw new Error(`sealed read-only mount source changed: ${mount.source}`);
    }
  }
}

function snapshotPrivateLinuxLaunchPlan(plan: PrivateLinuxLaunchPlan): PrivateLinuxLaunchPlan {
  const limits = plan.limits;
  const environment = plan.environment === undefined
    ? undefined
    : Object.freeze(Object.fromEntries(Object.entries(plan.environment)));
  return Object.freeze({
    runId: plan.runId,
    limits: Object.freeze({
      memoryBytes: limits.memoryBytes,
      pids: limits.pids,
      cpuQuotaMicros: limits.cpuQuotaMicros,
      cpuPeriodMicros: limits.cpuPeriodMicros,
      deadlineUnixMs: limits.deadlineUnixMs,
      cancellationGraceMs: limits.cancellationGraceMs,
      ...(limits.cleanupTimeoutMs === undefined ? {} : { cleanupTimeoutMs: limits.cleanupTimeoutMs }),
    }),
    readOnlyMounts: Object.freeze(plan.readOnlyMounts.map((mount) => Object.freeze({
      source: mount.source,
      destination: mount.destination,
    }))),
    command: Object.freeze([...plan.command]) as unknown as readonly [string, ...string[]],
    ...(environment === undefined ? {} : { environment }),
    ...(plan.privateProcessFilesystem === undefined
      ? {}
      : { privateProcessFilesystem: plan.privateProcessFilesystem }),
    ...(plan.privateRuntimeDevices === undefined
      ? {}
      : { privateRuntimeDevices: plan.privateRuntimeDevices }),
    ...(plan.trustedHelperPath === undefined ? {} : { trustedHelperPath: plan.trustedHelperPath }),
  });
}

function bubblewrapArguments(
  plan: PrivateLinuxSealedLaunchPlan,
  uid: number,
  gid: number,
): string[] {
  const result = [
    "--unshare-all",
    "--unshare-user",
    "--disable-userns",
    "--assert-userns-disabled",
    "--as-pid-1",
    "--die-with-parent",
    "--new-session",
    "--clearenv",
    ...(plan.privateProcessFilesystem === true
      ? ["--proc", "/proc", "--remount-ro", "/proc"]
      : ["--dir", "/proc"]),
    "--dir", "/dev",
    "--tmpfs", "/tmp",
    "--tmpfs", "/run",
    "--dir", "/work",
    "--chdir", "/work",
  ];
  if (plan.privateRuntimeDevices === true) {
    result.push(
      "--dev-bind", PRIVATE_NULL_SOURCE, "/dev/null",
      "--dev-bind", PRIVATE_URANDOM_SOURCE, "/dev/urandom",
    );
  }
  for (const mount of plan.readOnlyMounts) {
    result.push("--ro-bind", mount.source, mount.destination);
  }
  for (const [name, value] of Object.entries(plan.environment ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
    result.push("--setenv", name, value);
  }
  result.push("--uid", String(uid), "--gid", String(gid), "--cap-drop", "ALL", "--", ...plan.command);
  return result;
}

function validateOptions(options: NormalizedBackendOptions): void {
  for (const [name, path] of Object.entries({
    cgroupScope: options.cgroupScope,
    sudoPath: options.sudoPath,
    subreaperPath: options.subreaperPath,
    mknodPath: options.mknodPath,
    bunPath: options.bunPath,
    bubblewrapPath: options.bubblewrapPath,
    helperPath: options.helperPath,
    launchWrapperPath: options.launchWrapperPath,
    recoveryHelperPath: options.recoveryHelperPath,
    bashPath: options.bashPath,
  })) {
    if (!path.startsWith("/") || path.includes("\0")) throw new TypeError(`${name} must be an absolute path`);
  }
  if (!resolve(options.cgroupScope).startsWith("/sys/fs/cgroup/")) {
    throw new TypeError("cgroupScope must be beneath /sys/fs/cgroup");
  }
  positiveInteger(options.payloadUid, "payloadUid", true);
  positiveInteger(options.payloadGid, "payloadGid", true);
  if (typeof process.getuid !== "function" || process.getuid() !== options.payloadUid ||
      typeof process.getgid !== "function" || process.getgid() !== options.payloadGid) {
    throw new TypeError("payload identity must equal the trusted coordinator uid and gid");
  }
  positiveInteger(options.startupTimeoutMs, "startupTimeoutMs");
}

function validatePlan(plan: PrivateLinuxLaunchPlan): void {
  if (!RUN_ID.test(plan.runId)) throw new TypeError("runId must be a lower-kebab identifier");
  positiveInteger(plan.limits.memoryBytes, "memoryBytes");
  positiveInteger(plan.limits.pids, "pids");
  positiveInteger(plan.limits.cpuQuotaMicros, "cpuQuotaMicros");
  positiveInteger(plan.limits.cpuPeriodMicros, "cpuPeriodMicros");
  if (!Number.isSafeInteger(plan.limits.deadlineUnixMs) || plan.limits.deadlineUnixMs < 0) {
    throw new TypeError("deadlineUnixMs must be a non-negative safe integer");
  }
  positiveInteger(plan.limits.cancellationGraceMs, "cancellationGraceMs");
  if (plan.limits.deadlineUnixMs + plan.limits.cancellationGraceMs > Number.MAX_SAFE_INTEGER) {
    throw new RangeError("deadline plus cancellation grace is outside the safe integer range");
  }
  if (plan.limits.deadlineUnixMs + plan.limits.cancellationGraceMs - Date.now() > 2_147_483_647) {
    throw new RangeError("deadline plus cancellation grace exceeds the timer range");
  }
  const cleanupTimeoutMs = plan.limits.cleanupTimeoutMs ?? 5_000;
  positiveInteger(cleanupTimeoutMs, "cleanupTimeoutMs");
  if (cleanupTimeoutMs > 60_000) throw new RangeError("cleanupTimeoutMs exceeds the recovery helper limit");
  if (plan.limits.cpuQuotaMicros > plan.limits.cpuPeriodMicros * 1_000) {
    throw new RangeError("cpuQuotaMicros is outside the supported closed range");
  }
  if (plan.command.length === 0 || !plan.command[0].startsWith("/")) {
    throw new TypeError("sandbox command must use an absolute path");
  }
  if (plan.trustedHelperPath !== undefined && !plan.trustedHelperPath.startsWith("/")) {
    throw new TypeError("trustedHelperPath must be absolute");
  }
  const destinations = new Set<string>();
  for (const mount of plan.readOnlyMounts) {
    if (!mount.source.startsWith("/") || !mount.destination.startsWith("/")) {
      throw new TypeError("read-only mounts require absolute source and destination paths");
    }
    const source = resolve(mount.source);
    const destination = resolve(mount.destination);
    if (source === "/sys/fs/cgroup" || source.startsWith("/sys/fs/cgroup/")) {
      throw new TypeError("host cgroupfs cannot enter the sandbox");
    }
    if (["/proc", "/dev", "/tmp", "/run", "/work", "/sys"].some(
      (root) => destination === root || destination.startsWith(`${root}/`),
    )) {
      throw new TypeError(`mount destination ${destination} overlaps a Backend-owned path`);
    }
    for (const prior of destinations) {
      if (destination === prior || destination.startsWith(`${prior}/`) || prior.startsWith(`${destination}/`)) {
        throw new TypeError(`overlapping mount destinations ${prior} and ${destination}`);
      }
    }
    destinations.add(destination);
  }
  for (const [name, value] of Object.entries(plan.environment ?? {})) {
    if (!ENVIRONMENT_NAME.test(name)) throw new TypeError(`invalid environment name ${name}`);
    if (value.includes("\0")) throw new TypeError(`environment value ${name} contains NUL`);
  }
}

function positiveInteger(value: number, name: string, allowZero = false): void {
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1)) {
    throw new TypeError(`${name} must be a ${allowZero ? "non-negative" : "positive"} safe integer`);
  }
}

async function listen(server: Server, path: string): Promise<void> {
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(path, () => {
      server.off("error", reject);
      resolveListen();
    });
  });
}

function acceptOne(server: Server, timeoutMs: number, own: (socket: Socket) => void): Promise<Socket> {
  return new Promise<Socket>((resolveSocket, reject) => {
    const cleanup = (): void => {
      clearTimeout(timer);
      server.off("connection", connected);
      server.off("error", failed);
    };
    const connected = (socket: Socket): void => {
      own(socket);
      cleanup();
      resolveSocket(socket);
    };
    const failed = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("trusted cgroup helper connection timed out"));
    }, timeoutMs);
    server.once("connection", connected);
    server.once("error", failed);
  });
}

function closeServer(server: Server): Promise<void> {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
}

async function* readMessages(socket: Socket): AsyncGenerator<HelperMessage> {
  let buffered = "";
  socket.setEncoding("utf8");
  for await (const raw of socket) {
    buffered += String(raw);
    if (Buffer.byteLength(buffered) > CONTROL_BYTES) throw new Error("cgroup helper control channel overflow");
    let newline = buffered.indexOf("\n");
    while (newline !== -1) {
      const line = buffered.slice(0, newline);
      buffered = buffered.slice(newline + 1);
      const value: unknown = JSON.parse(line);
      yield parseHelperMessage(value);
      newline = buffered.indexOf("\n");
    }
  }
  if (buffered !== "") throw new Error("cgroup helper ended with a partial control message");
}

async function consumeMessages(
  messages: AsyncIterable<HelperMessage>,
  prepared: Deferred<HelperPrepared>,
  ready: Deferred<HelperReady>,
  terminal: Deferred<HelperTerminal>,
): Promise<void> {
  try {
    for await (const message of messages) {
      if (message.type === "prepared") prepared.resolve(message);
      if (message.type === "ready") ready.resolve(message);
      if (message.type === "terminal") {
        terminal.resolve(message);
        prepared.reject(new Error(message.setupError ?? "trusted cgroup helper terminated before preparation"));
        ready.reject(new Error(message.setupError ?? "trusted cgroup helper terminated before readiness"));
      }
      if (message.type === "error") {
        const error = new Error(message.message);
        prepared.reject(error);
        ready.reject(error);
        terminal.reject(error);
      }
    }
  } catch (error) {
    prepared.reject(error);
    ready.reject(error);
    terminal.reject(error);
  }
}

function parseHelperMessage(value: unknown): HelperMessage {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("invalid cgroup helper message");
  }
  const message = value as Record<string, unknown>;
  if (message.type === "prepared" && typeof message.parentCgroup === "string" &&
    typeof message.supervisorCgroup === "string" && typeof message.runCgroup === "string" &&
    exactStringKeys(message, ["parentCgroup", "runCgroup", "supervisorCgroup", "type"])) {
    return Object.freeze({
      type: "prepared" as const,
      parentCgroup: message.parentCgroup,
      supervisorCgroup: message.supervisorCgroup,
      runCgroup: message.runCgroup,
    });
  }
  if (message.type === "ready" && typeof message.parentCgroup === "string" &&
    typeof message.runCgroup === "string" && Number.isSafeInteger(message.payloadPid) &&
    Number(message.payloadPid) > 0 && exactStringKeys(message, [
      "parentCgroup", "payloadPid", "runCgroup", "type",
    ])) {
    return Object.freeze({
      type: "ready" as const,
      parentCgroup: message.parentCgroup,
      runCgroup: message.runCgroup,
      payloadPid: Number(message.payloadPid),
    });
  }
  if (message.type === "terminal" &&
    (message.exitCode === null || (Number.isSafeInteger(message.exitCode) && Number(message.exitCode) >= 0)) &&
    (typeof message.signal === "string" || message.signal === null) &&
    ["cancelled", "coordinator_lost", "deadline", "payload_exit", "setup_failed"].includes(String(message.reason)) &&
    typeof message.fenced === "boolean" &&
    (message.setupError === undefined || typeof message.setupError === "string") &&
    (message.killError === undefined || typeof message.killError === "string") &&
    (message.cleanupError === undefined || typeof message.cleanupError === "string") &&
    !(message.fenced && message.cleanupError !== undefined) &&
    exactStringKeys(message, [
      "cleanupError", "evidence", "exitCode", "fenced", "killError", "reason", "setupError", "signal", "type",
    ], ["cleanupError", "killError", "setupError"])) {
    const evidence = normalizeEvidence(message.evidence);
    return Object.freeze({
      type: "terminal" as const,
      exitCode: message.exitCode as number | null,
      signal: message.signal,
      reason: String(message.reason),
      fenced: message.fenced,
      ...(message.setupError === undefined ? {} : { setupError: message.setupError }),
      ...(message.killError === undefined ? {} : { killError: message.killError }),
      ...(message.cleanupError === undefined ? {} : { cleanupError: message.cleanupError }),
      evidence,
    });
  }
  if (message.type === "error" && typeof message.message === "string" &&
      exactStringKeys(message, ["message", "type"])) {
    return { type: "error", message: message.message };
  }
  throw new Error("invalid cgroup helper message");
}

function normalizeEvidence(value: unknown): HelperTerminal["evidence"] {
  const record = exactDataRecord(
    value,
    ["cpuStat", "memoryEvents", "pidsEvents"],
    "cgroup helper evidence",
  );
  return Object.freeze({
    cpuStat: normalizeCounters(record.cpuStat),
    memoryEvents: normalizeCounters(record.memoryEvents),
    pidsEvents: normalizeCounters(record.pidsEvents),
  });
}

function normalizeCounters(value: unknown): Readonly<Record<string, number>> {
  const entries = Object.entries(ordinaryDataRecord(value, "cgroup helper counters"));
  if (entries.length > 64 || entries.some(([name, count]) =>
    !/^[a-z][a-z0-9_.]{0,63}$/.test(name) || !Number.isSafeInteger(count) || Number(count) < 0
  )) {
    throw new Error("invalid cgroup helper counters");
  }
  return Object.freeze(Object.fromEntries(entries) as Record<string, number>);
}

function exactStringKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const keys = Object.keys(value);
  const permitted = new Set(allowed);
  const optionalSet = new Set(optional);
  return keys.every((key) => permitted.has(key)) &&
    allowed.every((key) => optionalSet.has(key) || Object.hasOwn(value, key));
}

function writeControl(socket: Socket, message: object): void {
  if (socket.destroyed || !socket.writable) return;
  socket.write(`${JSON.stringify(message)}\n`);
}

function writeStream(stream: NodeJS.WritableStream, bytes: Uint8Array): Promise<void> {
  return new Promise((resolveWrite, reject) => {
    stream.write(bytes, (error?: Error | null) => error ? reject(error) : resolveWrite());
  });
}

function endStream(stream: NodeJS.WritableStream): Promise<void> {
  return new Promise((resolveEnd, reject) => {
    stream.once("error", reject);
    stream.end(() => {
      stream.removeListener("error", reject);
      resolveEnd();
    });
  });
}

function childClose(child: ChildProcessWithoutNullStreams): Promise<{ code: number | null; signal: string | null }> {
  return new Promise((resolveClose, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolveClose({ code, signal }));
  });
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolvePromise!: (value: T) => void;
  let rejectPromise!: (error: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  promise.catch(() => undefined);
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise((resolveTimeout, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolveTimeout(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
