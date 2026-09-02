import { randomBytes } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import {
  link,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  realpath,
  rm,
  rmdir,
  stat,
  statfs,
  unlink,
} from "node:fs/promises";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { dirname, extname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";
import { types as utilTypes } from "node:util";

import type { JsonValue } from "../json.js";
import type { ExactComponentExit, ExactComponentProcess } from "../run/session.js";
import {
  acquirePrivateRootlessLinux,
  revalidatePrivateRootlessLinux,
  type PrivateRootlessLinuxAcquisitionObservation,
} from "./linux-rootless-acquisition.js";
import { privateDomainDigest, privateFileDigest } from "./identity.js";

const RUN_ID = /^[a-z0-9][a-z0-9-]{0,47}$/;
const OWNER_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;
const TOKEN = /^[0-9a-f]{64}$/;
const NONCE = /^[0-9a-f]{24}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const ENVIRONMENT_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const CONTROL_BYTES = 64 * 1024;
const CGROUP2_SUPER_MAGIC = 0x6367_7270n;
const BOOT_ID_PATH = "/proc/sys/kernel/random/boot_id";
const BOOT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DEVPTS_SUPER_MAGIC = 0x1cd1n;
const PROC_SUPER_MAGIC = 0x9fa0n;
const SYSFS_SUPER_MAGIC = 0x6265_6572n;
const BUN_POLICY = Object.freeze(["--no-env-file", "--no-install", "--config=/dev/null"] as const);
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

interface SealedMount extends PrivateLinuxReadOnlyMount {
  readonly sourceDevice: string;
  readonly sourceInode: string;
  readonly sourceType: "directory" | "file";
}

export interface PrivateLinuxLaunchPlan {
  readonly runId: string;
  readonly limits: PrivateLinuxCgroupLimits;
  readonly readOnlyMounts: readonly PrivateLinuxReadOnlyMount[];
  readonly command: readonly [string, ...string[]];
  readonly environment?: Readonly<Record<string, string>>;
  readonly network?: "isolated" | "inherited";
}

interface SealedLaunchPlan extends Omit<
  PrivateLinuxLaunchPlan,
  "limits" | "readOnlyMounts" | "environment" | "network"
> {
  readonly limits: Required<PrivateLinuxCgroupLimits>;
  readonly readOnlyMounts: readonly SealedMount[];
  readonly environment: Readonly<Record<string, string>>;
  readonly network: "isolated" | "inherited";
}

export interface PrivateLinuxCgroupBackendOptions {
  readonly bunPath: string;
  readonly bunHostLibraryPath: string;
  readonly supervisorPath?: string;
  readonly startupTimeoutMs?: number;
}

export interface PrivateLinuxOwnerStateLocation {
  readonly parent: string;
  readonly name: string;
}

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

export interface PrivateLinuxBackendMechanismSupport {
  readonly kind: "linux-rootless-cgroup-v2-bubblewrap-mechanism/1";
  readonly digest: string;
  readonly trustedBubblewrapPath: string;
  readonly trustedBubblewrapDigest: string;
  readonly bubblewrapVersion: string;
  readonly trustedCoordinatorBunPath: string;
  readonly trustedCoordinatorBunDigest: string;
  readonly trustedCoordinatorLibraryPath: string;
  readonly trustedSupervisorPath: string;
  readonly trustedSupervisorDigest: string;
  readonly cgroupVersion: 2;
  readonly controllers: readonly ["cpu", "memory", "pids"];
  readonly payloadUid: number;
  readonly payloadGid: number;
  readonly startupTimeoutMs: number;
}

export interface PrivateLinuxBackendLaunchAuthority {
  readonly bootId: string;
  readonly delegatedCgroup: string;
  readonly delegatedCgroupDevice: string;
  readonly delegatedCgroupInode: string;
}

export interface PrivateLinuxBackendMechanismObservation {
  readonly support: PrivateLinuxBackendMechanismSupport;
  readonly authority: PrivateLinuxBackendLaunchAuthority;
}

export interface PrivateLinuxSealedOwnerIdentity {
  readonly kind: "private-linux-sealed-owner/1";
  readonly digest: string;
  readonly runId: string;
  readonly nonce: string;
  readonly ownerToken: string;
  readonly mechanismDigest: string;
  readonly sealedPlanDigest: string;
  readonly bootId: string;
  readonly delegatedCgroup: string;
  readonly delegatedCgroupDevice: string;
  readonly delegatedCgroupInode: string;
  readonly runCgroup: string;
  readonly deadlineUnixMs: number;
  readonly cancellationGraceMs: number;
  readonly cleanupTimeoutMs: number;
  readonly ownerStateParent: string;
  readonly ownerStateParentDevice: string;
  readonly ownerStateParentInode: string;
  readonly ownerStateName: string;
  readonly ownerStateDirectory: string;
  readonly ownerStateDevice: string;
  readonly ownerStateInode: string;
  readonly ownerStateAllocationDigest: string;
}

export interface PrivateLinuxPreparedOwnerIdentity {
  readonly kind: "private-linux-prepared-owner/1";
  readonly digest: string;
  readonly owner: PrivateLinuxSealedOwnerIdentity;
}

export interface PrivateLinuxConfirmedEnforcementReceipt {
  readonly kind: "private-linux-confirmed-enforcement/1";
  readonly ownerDigest: string;
  readonly stopReason:
    | "cancelled"
    | "coordinator_lost"
    | "deadline"
    | "payload_exit"
    | "setup_failed"
    | "recovered";
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly fenced: true;
  readonly evidence: PrivateLinuxEnforcementEvidence;
}

export interface PrivateLinuxEnvelopeIdentity {
  readonly kind: "linux-rootless-cgroup-v2-bubblewrap/1";
  readonly mechanismDigest: string;
  readonly sealedPlanDigest: string;
  readonly trustedBubblewrapPath: string;
  readonly trustedBubblewrapDigest: string;
  readonly trustedCoordinatorBunPath: string;
  readonly trustedCoordinatorBunDigest: string;
  readonly trustedSupervisorPath: string;
  readonly trustedSupervisorDigest: string;
  readonly cgroupVersion: 2;
  readonly controllers: readonly ["cpu", "memory", "pids"];
  readonly payloadUid: number;
  readonly payloadGid: number;
  readonly limits: Required<PrivateLinuxCgroupLimits>;
  readonly privateProcessFilesystem: true;
  readonly privateRuntimeDevices: true;
  readonly network: "isolated" | "inherited";
}

export interface PrivateLinuxEnforcementEvidence {
  readonly cpuStat: Readonly<Record<string, number>>;
  readonly memoryEvents: Readonly<Record<string, number>>;
  readonly pidsEvents: Readonly<Record<string, number>>;
}

export interface PrivateLinuxSealedOwner {
  readonly identity: PrivateLinuxSealedOwnerIdentity;
  admit(
    signal?: AbortSignal,
    beforeAdmission?: (prepared: PrivateLinuxPreparedOwnerIdentity) => Promise<void>,
  ): Promise<PrivateLinuxComponentProcess>;
}

interface SupervisorPrepared {
  readonly type: "prepared";
  readonly runCgroup: string;
  readonly supervisorPid: number;
}

interface SupervisorReady {
  readonly type: "ready";
  readonly runCgroup: string;
  readonly payloadPid: number;
  readonly supervisorPid: number;
}

interface SupervisorTerminal {
  readonly type: "terminal";
  readonly ownerDigest: string;
  readonly runCgroup: string;
  readonly supervisorPid: number;
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly stopReason: Exclude<PrivateLinuxConfirmedEnforcementReceipt["stopReason"], "recovered">;
  readonly fenced: boolean;
  readonly cleanupError?: string;
  readonly evidence: PrivateLinuxEnforcementEvidence;
}

interface RecoveredFinal {
  readonly type: "recovered";
  readonly ownerDigest: string;
  readonly runCgroup: string;
  readonly stopReason: "recovered";
  readonly exitCode: null;
  readonly signal: null;
  readonly fenced: true;
  readonly recoveryBootId: string;
  readonly evidence: PrivateLinuxEnforcementEvidence;
}

type SupervisorMessage = SupervisorPrepared | SupervisorReady | SupervisorTerminal;
type FinalRecord = SupervisorTerminal | RecoveredFinal;

export type PrivateLinuxComponentProcess = ExactComponentProcess & {
  readonly owner: PrivateLinuxPreparedOwnerIdentity;
  readonly cgroup: {
    readonly runCgroup: string;
    readonly payloadPid: number;
    readonly supervisorPid: number;
  };
  readonly evidence: Promise<PrivateLinuxEnforcementEvidence>;
  readonly terminationReason: Promise<PrivateLinuxConfirmedEnforcementReceipt["stopReason"]>;
  readonly enforcement: Promise<PrivateLinuxConfirmedEnforcementReceipt>;
  readonly envelope: PrivateLinuxEnvelopeIdentity;
};

export class PrivateLinuxFenceUnconfirmedError extends Error {
  override readonly cause: unknown;

  constructor(cause: unknown) {
    super("rootless Linux launch failed without a confirmed ownership fence");
    this.name = "PrivateLinuxFenceUnconfirmedError";
    this.cause = cause;
  }
}

interface NormalizedOptions {
  readonly bunPath: string;
  readonly bunHostLibraryPath: string;
  readonly supervisorPath: string;
  readonly startupTimeoutMs: number;
}

interface AllocatedOwnerState {
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

interface SealedOwnerData {
  readonly backend: PrivateLinuxCgroupBackend;
  readonly sourcePlan: PrivateLinuxLaunchPlan;
  readonly sealedPlan: SealedLaunchPlan;
  readonly mechanism: PrivateLinuxBackendMechanismObservation;
  readonly identity: PrivateLinuxSealedOwnerIdentity;
  readonly prepared: PrivateLinuxPreparedOwnerIdentity;
  readonly automaticOwnerStateParent?: string;
}

interface InitialMechanismObservation {
  readonly acquisition: PrivateRootlessLinuxAcquisitionObservation;
  readonly mechanism: PrivateLinuxBackendMechanismObservation;
}

const authenticSealedOwners = new WeakMap<object, SealedOwnerData>();

/** One private Linux implementation; this is not a public Backend SPI. */
export class PrivateLinuxCgroupBackend {
  readonly #options: NormalizedOptions;
  #acquisition: PrivateRootlessLinuxAcquisitionObservation | undefined;
  #initialObservation: Promise<InitialMechanismObservation> | undefined;
  readonly #activeRunCgroups = new Set<string>();

  constructor(options: PrivateLinuxCgroupBackendOptions) {
    const sourcePath = fileURLToPath(import.meta.url);
    const extension = extname(sourcePath);
    this.#options = Object.freeze({
      bunPath: requireAbsolute(options.bunPath, "Bun path"),
      bunHostLibraryPath: requireAbsolute(options.bunHostLibraryPath, "Bun host library path"),
      supervisorPath: requireAbsolute(
        options.supervisorPath ?? join(dirname(sourcePath), `linux-rootless-supervisor${extension}`),
        "supervisor path",
      ),
      startupTimeoutMs: positiveInteger(options.startupTimeoutMs ?? 10_000, "startup timeout"),
    });
    authenticBackends.add(this);
    Object.freeze(this);
  }

  async observeMechanism(): Promise<PrivateLinuxBackendMechanismObservation> {
    requirePrivateLinuxCgroupBackend(this);
    return await this.#observeMechanism();
  }

  async seal(
    plan: PrivateLinuxLaunchPlan,
    ownerState?: PrivateLinuxOwnerStateLocation | PrivateLinuxOwnerStateAllocationIdentity,
  ): Promise<PrivateLinuxSealedOwner> {
    requirePrivateLinuxCgroupBackend(this);
    const snapshot = snapshotPlan(plan);
    const [mechanism, sealedPlan] = await Promise.all([
      this.#observeMechanism(),
      sealPlan(snapshot),
    ]);
    const sealedPlanDigest = privateDomainDigest("JIG-Rootless-Linux-Sealed-Plan/1", {
      mechanismDigest: mechanism.support.digest,
      plan: sealedPlan as unknown as JsonValue,
    });
    const nonce = randomBytes(12).toString("hex");
    const allocated = await createOwnerState(ownerState, nonce);
    const fields = {
      kind: "private-linux-sealed-owner/1" as const,
      runId: sealedPlan.runId,
      nonce,
      ownerToken: allocated.allocation.ownerToken,
      mechanismDigest: mechanism.support.digest,
      sealedPlanDigest,
      bootId: mechanism.authority.bootId,
      delegatedCgroup: mechanism.authority.delegatedCgroup,
      delegatedCgroupDevice: mechanism.authority.delegatedCgroupDevice,
      delegatedCgroupInode: mechanism.authority.delegatedCgroupInode,
      runCgroup: join(mechanism.authority.delegatedCgroup, `jig-run-${sealedPlan.runId}-${nonce}`),
      deadlineUnixMs: sealedPlan.limits.deadlineUnixMs,
      cancellationGraceMs: sealedPlan.limits.cancellationGraceMs,
      cleanupTimeoutMs: sealedPlan.limits.cleanupTimeoutMs,
      ownerStateParent: allocated.parent,
      ownerStateParentDevice: allocated.parentDevice,
      ownerStateParentInode: allocated.parentInode,
      ownerStateName: allocated.name,
      ownerStateDirectory: allocated.directory,
      ownerStateDevice: allocated.device,
      ownerStateInode: allocated.inode,
      ownerStateAllocationDigest: allocated.allocation.digest,
    };
    let identity: PrivateLinuxSealedOwnerIdentity;
    try {
      identity = normalizePrivateLinuxSealedOwnerIdentity({
        ...fields,
        digest: privateDomainDigest("JIG-Rootless-Linux-Sealed-Owner/1", fields as unknown as JsonValue),
      });
      await initializeOwnerState(identity);
      await requireOwnerUnused(identity);
    } catch (error) {
      if (allocated.automaticParent !== undefined) {
        await rm(allocated.automaticParent, { recursive: true, force: true }).catch(() => undefined);
      }
      throw error;
    }
    const prepared = preparedFor(identity);
    let admitted = false;
    const result: PrivateLinuxSealedOwner = Object.freeze({
      identity,
      admit: (
        signal?: AbortSignal,
        beforeAdmission?: (prepared: PrivateLinuxPreparedOwnerIdentity) => Promise<void>,
      ) => {
        if (admitted) return Promise.reject(new TypeError("sealed rootless Linux owner was already admitted"));
        admitted = true;
        this.#activeRunCgroups.add(identity.runCgroup);
        return this.launch(plan, signal, result, beforeAdmission).then(
          (component) => {
            const release = (): void => { this.#activeRunCgroups.delete(identity.runCgroup); };
            void component.enforcement.then(release, release);
            return component;
          },
          (error): never => {
            this.#activeRunCgroups.delete(identity.runCgroup);
            throw error;
          },
        );
      },
    });
    authenticSealedOwners.set(result, Object.freeze({
      backend: this,
      sourcePlan: plan,
      sealedPlan,
      mechanism,
      identity,
      prepared,
      ...(allocated.automaticParent === undefined
        ? {}
        : { automaticOwnerStateParent: allocated.automaticParent }),
    }));
    return result;
  }

  async #observeMechanism(): Promise<PrivateLinuxBackendMechanismObservation> {
    if (this.#acquisition === undefined) {
      const initial = this.#initialObservation ??= observeInitialMechanism(this.#options);
      try {
        const observed = await initial;
        this.#acquisition = observed.acquisition;
        return observed.mechanism;
      } catch (error) {
        if (this.#initialObservation === initial) this.#initialObservation = undefined;
        throw error;
      }
    }
    let acquisition: PrivateRootlessLinuxAcquisitionObservation;
    try {
      acquisition = await revalidatePrivateRootlessLinux(
        this.#acquisition,
        Object.freeze([...this.#activeRunCgroups].sort()),
      );
    } catch {
      // A trusted admit may create a newly tracked sibling between the active
      // set snapshot and the filesystem observation. One fresh observation
      // closes that race; an untracked sibling or any other drift still fails.
      acquisition = await revalidatePrivateRootlessLinux(
        this.#acquisition,
        Object.freeze([...this.#activeRunCgroups].sort()),
      );
    }
    return await observeMechanismWithAuthority(this.#options, acquisition);
  }

  async recoverFence(value: unknown): Promise<PrivateLinuxConfirmedEnforcementReceipt> {
    requirePrivateLinuxCgroupBackend(this);
    const owner = isPreparedValue(value)
      ? normalizePrivateLinuxPreparedOwnerIdentity(value).owner
      : normalizePrivateLinuxSealedOwnerIdentity(value);
    await requireOwnerState(owner);
    const prepared = preparedFor(owner);
    const existing = await tryReadFinal(prepared);
    if (existing !== undefined) return receiptFor(prepared, existing);

    const recoveryBootId = await observeLinuxBootId();
    const bootChanged = recoveryBootId !== owner.bootId;
    if (!bootChanged) await requireDelegatedIdentity(owner);

    const claim = await claimCancellation(ownerRecord(owner));
    if (claim === "active" && !bootChanged) {
      const completed = await tryReadFinal(prepared);
      if (completed !== undefined) return receiptFor(prepared, completed);
      throw new PrivateLinuxFenceUnconfirmedError(
        new Error("active rootless Linux cleanup owner has not published its final receipt"),
      );
    }
    if (!bootChanged && await pathExists(owner.runCgroup)) {
      throw new PrivateLinuxFenceUnconfirmedError(
        new Error("cancelled rootless Linux owner still has a Run cgroup"),
      );
    }
    const recovered: RecoveredFinal = Object.freeze({
      type: "recovered",
      ownerDigest: prepared.digest,
      runCgroup: owner.runCgroup,
      stopReason: "recovered",
      exitCode: null,
      signal: null,
      fenced: true,
      recoveryBootId,
      evidence: emptyEvidence(),
    });
    await persistFinal(prepared, recovered);
    return receiptFor(prepared, recovered);
  }

  async launch(
    plan: PrivateLinuxLaunchPlan,
    signal?: AbortSignal,
    sealedOwner?: PrivateLinuxSealedOwner,
    beforeAdmission?: (prepared: PrivateLinuxPreparedOwnerIdentity) => Promise<void>,
  ): Promise<PrivateLinuxComponentProcess> {
    requirePrivateLinuxCgroupBackend(this);
    if (sealedOwner === undefined) {
      if (signal?.aborted) throw new Error("rootless Linux Run was cancelled before allocation");
      const owner = await this.seal(plan);
      return await owner.admit(signal, beforeAdmission);
    }
    const data = requireSealedOwner(sealedOwner, this, plan);
    await requireSealedMounts(data.sealedPlan.readOnlyMounts);
    const currentMechanism = await this.#observeMechanism();
    requirePrivateLinuxMechanismUnchanged(data.mechanism, currentMechanism);
    await requireOwnerState(data.identity);

    const controlDirectory = await mkdtemp(join(tmpdir(), "jig-rootless-control-"));
    const controlPath = join(controlDirectory, "control.sock");
    const server = createServer();
    let supervisor: ChildProcessWithoutNullStreams | undefined;
    let control: Socket | undefined;
    let preparedReached = false;
    try {
      await listen(server, controlPath);
      const accepted = acceptOne(server, this.#options.startupTimeoutMs);
      supervisor = requirePipedChild(spawn(
        data.mechanism.support.trustedCoordinatorBunPath,
        [
          ...BUN_POLICY,
          data.mechanism.support.trustedSupervisorPath,
          "--supervisor",
          controlPath,
          String(this.#options.startupTimeoutMs),
        ],
        {
          cwd: "/",
          env: {
            LD_LIBRARY_PATH: data.mechanism.support.trustedCoordinatorLibraryPath,
          },
          detached: true,
          stdio: ["pipe", "pipe", "pipe"],
        },
      ));
      const closed = childClose(supervisor);
      control = await Promise.race([
        accepted,
        closed.then((exit) => {
          throw new Error(`rootless supervisor exited before connecting (${exit.code ?? exit.signal})`);
        }),
      ]);
      server.close();
      await unlink(controlPath).catch(ignoreMissing);
      await rmdir(controlDirectory);
      const messages = readJsonLines(control)[Symbol.asyncIterator]();
      writeControl(control, {
        type: "start",
        configuration: supervisorConfiguration(data),
      });
      const cancel = (): void => writeControlBestEffort(control!, { type: "cancel" });
      signal?.addEventListener("abort", cancel, { once: true });
      const preparedMessage = requireSupervisorMessage(
        await withTimeout(nextMessage(messages, closed), this.#options.startupTimeoutMs, "rootless preparation"),
        "prepared",
      );
      preparedReached = true;
      requirePreparedMessage(preparedMessage, data);
      await requirePreparedCgroup(data);
      if (beforeAdmission !== undefined) await beforeAdmission(data.prepared);
      if (signal?.aborted) throw new Error("rootless Linux Run was cancelled before admission");
      writeControl(control, { type: "admit" });
      const ready = requireSupervisorMessage(
        await withTimeout(nextMessage(messages, closed), this.#options.startupTimeoutMs, "rootless readiness"),
        "ready",
      );
      requireReadyMessage(ready, preparedMessage, data);
      await requirePayloadInCgroup(data.identity.runCgroup, ready.payloadPid);

      let inputClosed = false;
      let terminationRequested = false;
      const terminal = waitForTerminal(messages, closed).then((message) => {
        requireTerminalMessage(message, preparedMessage, data);
        return message;
      });
      const enforcement = terminal.then(async (message) => {
        const final = await readFinal(data.prepared);
        if (!sameJson(final, message)) {
          throw new PrivateLinuxFenceUnconfirmedError(
            new Error("rootless supervisor report differs from its durable final receipt"),
          );
        }
        if (!message.fenced || message.cleanupError !== undefined) {
          throw new PrivateLinuxFenceUnconfirmedError(
            new Error(message.cleanupError ?? "rootless supervisor did not confirm cleanup"),
          );
        }
        const exit = await closed;
        if (exit.code !== 0) {
          throw new PrivateLinuxFenceUnconfirmedError(
            new Error(`rootless supervisor exited unexpectedly (${exit.code ?? exit.signal})`),
          );
        }
        const receipt = receiptFor(data.prepared, message);
        if (data.automaticOwnerStateParent !== undefined) {
          await releasePrivateLinuxOwnerState(data.identity, receipt);
          await rmdir(data.automaticOwnerStateParent);
        }
        return receipt;
      }).catch((error): never => {
        throw asFenceUnconfirmed(error);
      }).finally(() => {
        signal?.removeEventListener("abort", cancel);
        control?.destroy();
      });
      const completion = enforcement.then((receipt): ExactComponentExit => Object.freeze({
        exitCode: receipt.exitCode,
        signal: receipt.signal,
        fenced: true,
        stopReason: receipt.stopReason,
      }));
      return Object.freeze({
        owner: data.prepared,
        cgroup: Object.freeze({
          runCgroup: data.identity.runCgroup,
          payloadPid: ready.payloadPid,
          supervisorPid: ready.supervisorPid,
        }),
        envelope: envelopeFor(data),
        stdout: streamBytes(supervisor.stdout),
        stderr: streamBytes(supervisor.stderr),
        completion,
        enforcement,
        evidence: enforcement.then((receipt) => receipt.evidence),
        terminationReason: enforcement.then((receipt) => receipt.stopReason),
        write: async (bytes: Uint8Array): Promise<void> => {
          if (inputClosed) throw new Error("rootless Linux Run input is closed");
          await writeBytes(supervisor!.stdin, bytes);
        },
        closeInput: async (): Promise<void> => {
          if (inputClosed) return;
          inputClosed = true;
          supervisor!.stdin.end();
        },
        terminate: async (): Promise<void> => {
          if (!terminationRequested) {
            terminationRequested = true;
            cancel();
          }
          await enforcement;
        },
      });
    } catch (error) {
      writeControlBestEffort(control, { type: "cancel" });
      supervisor?.stdin.end();
      control?.end();
      const closed = supervisor === undefined ? undefined : childCloseIfNeeded(supervisor);
      if (closed !== undefined) {
        await withTimeout(closed, data.identity.cleanupTimeoutMs + this.#options.startupTimeoutMs,
          "rootless supervisor cleanup").catch(() => undefined);
      }
      let fence: PrivateLinuxConfirmedEnforcementReceipt;
      try {
        fence = await this.recoverFence(data.prepared);
      } catch (fenceError) {
        throw asFenceUnconfirmed(fenceError);
      } finally {
        control?.destroy();
        server.close();
        await rm(controlDirectory, { recursive: true, force: true }).catch(() => undefined);
      }
      if (data.automaticOwnerStateParent !== undefined) {
        await releasePrivateLinuxOwnerState(data.identity, fence);
        await rmdir(data.automaticOwnerStateParent);
      }
      if (preparedReached || fence.stopReason === "recovered") throw error;
      throw asFenceUnconfirmed(error);
    }
  }
}

export function requirePrivateLinuxCgroupBackend(value: unknown): PrivateLinuxCgroupBackend {
  if (value === null || typeof value !== "object" || !authenticBackends.has(value)) {
    throw new TypeError("rootless Linux Backend was not produced by the private constructor");
  }
  return value as PrivateLinuxCgroupBackend;
}

export async function planPrivateLinuxOwnerStateAllocation(
  location: PrivateLinuxOwnerStateLocation,
): Promise<PrivateLinuxOwnerStateAllocationIdentity> {
  if (!OWNER_NAME.test(location.name)) throw new TypeError("Linux owner-state name is invalid");
  const parent = await realpath(requireAbsolute(location.parent, "Linux owner-state parent"));
  if (parent !== location.parent) throw new TypeError("Linux owner-state parent must be canonical");
  const information = await lstat(parent, { bigint: true });
  requirePrivateDirectory(information, "Linux owner-state parent");
  const directory = join(parent, location.name);
  if (await pathExists(directory)) throw new Error("Linux owner-state allocation already exists");
  const fields = {
    kind: "private-linux-owner-state-allocation/1" as const,
    parent,
    parentDevice: String(information.dev),
    parentInode: String(information.ino),
    name: location.name,
    directory,
    ownerToken: randomBytes(32).toString("hex"),
  };
  return normalizePrivateLinuxOwnerStateAllocationIdentity({
    ...fields,
    digest: privateDomainDigest("JIG-Rootless-Linux-Owner-Allocation/1", fields as unknown as JsonValue),
  });
}

export function normalizePrivateLinuxOwnerStateAllocationIdentity(
  value: unknown,
): PrivateLinuxOwnerStateAllocationIdentity {
  const record = exactRecord(value, [
    "digest", "directory", "kind", "name", "ownerToken", "parent", "parentDevice", "parentInode",
  ], "Linux owner-state allocation");
  if (record.kind !== "private-linux-owner-state-allocation/1" ||
      typeof record.digest !== "string" || !DIGEST.test(record.digest) ||
      typeof record.parent !== "string" || !canonicalAbsolute(record.parent) ||
      typeof record.parentDevice !== "string" || !nonnegativeIntegerText(record.parentDevice) ||
      typeof record.parentInode !== "string" || !positiveIntegerText(record.parentInode) ||
      typeof record.name !== "string" || !OWNER_NAME.test(record.name) ||
      typeof record.directory !== "string" || record.directory !== join(record.parent, record.name) ||
      typeof record.ownerToken !== "string" || !TOKEN.test(record.ownerToken)) {
    throw new TypeError("Linux owner-state allocation is invalid");
  }
  const fields = {
    kind: record.kind,
    parent: record.parent,
    parentDevice: record.parentDevice,
    parentInode: record.parentInode,
    name: record.name,
    directory: record.directory,
    ownerToken: record.ownerToken,
  };
  if (record.digest !== privateDomainDigest(
    "JIG-Rootless-Linux-Owner-Allocation/1",
    fields as unknown as JsonValue,
  )) throw new TypeError("Linux owner-state allocation digest is invalid");
  return Object.freeze({ ...fields, kind: "private-linux-owner-state-allocation/1" as const, digest: record.digest });
}

export async function cancelPrivateLinuxOwnerStateAllocation(
  value: unknown,
): Promise<PrivateLinuxOwnerStateCancellation> {
  const allocation = normalizePrivateLinuxOwnerStateAllocationIdentity(value);
  await requireAllocationParent(allocation);
  const directory = await ensureAllocationDirectory(allocation);
  const allocationRecord = ownerRecord(allocation);
  const existing = await allocationCancellationRecord(allocation, allocationRecord);
  const claim = await claimCancellation(existing);
  if (claim === "active") {
    throw new PrivateLinuxFenceUnconfirmedError(new Error("rootless Linux owner is already active"));
  }
  if (existing.ownerDigest !== undefined) {
    if (existing.runCgroup === undefined || await pathExists(existing.runCgroup)) {
      throw new PrivateLinuxFenceUnconfirmedError(
        new Error("sealed rootless Linux owner may have entered execution"),
      );
    }
    const entries = await readdir(allocation.directory);
    if (entries.some((name) => name !== "owner.json" && name !== "claim.json")) {
      throw new Error("rootless Linux owner state contains unexpected entries");
    }
    await unlink(join(allocation.directory, "owner.json"));
    await ensureOwnerRecord(allocationRecord);
    await syncDirectory(allocation.directory);
  }
  const fields = {
    kind: "private-linux-owner-state-cancellation/1" as const,
    allocationDigest: allocation.digest,
    directoryDevice: String(directory.dev),
    directoryInode: String(directory.ino),
    state: "cancelled" as const,
  };
  return normalizePrivateLinuxOwnerStateCancellation({
    ...fields,
    digest: privateDomainDigest("JIG-Rootless-Linux-Owner-Cancellation/1", fields),
  });
}

async function allocationCancellationRecord(
  allocation: PrivateLinuxOwnerStateAllocationIdentity,
  minimal: OwnerRecordReference,
): Promise<OwnerRecordReference> {
  try {
    await ensureOwnerRecord(minimal);
    return minimal;
  } catch (error) {
    let record: Record<string, unknown>;
    try {
      record = parseJsonLine(
        await readFile(join(allocation.directory, "owner.json"), "utf8"),
        "rootless Linux owner record",
      );
    } catch {
      throw error;
    }
    const keys = [
      "allocationDigest", "kind", "mechanismDigest", "ownerDigest", "runCgroup",
      "sealedPlanDigest", "token",
    ];
    if (Object.keys(record).sort().join("\0") !== keys.sort().join("\0") ||
        record.kind !== "private-linux-owner-state/1" ||
        record.allocationDigest !== allocation.digest || record.token !== allocation.ownerToken ||
        typeof record.ownerDigest !== "string" || !DIGEST.test(record.ownerDigest) ||
        typeof record.mechanismDigest !== "string" || !DIGEST.test(record.mechanismDigest) ||
        typeof record.sealedPlanDigest !== "string" || !DIGEST.test(record.sealedPlanDigest) ||
        typeof record.runCgroup !== "string" || !canonicalCgroup(record.runCgroup)) {
      throw error;
    }
    return {
      allocationDigest: allocation.digest,
      directory: allocation.directory,
      ownerToken: allocation.ownerToken,
      ownerDigest: record.ownerDigest,
      runCgroup: record.runCgroup,
      mechanismDigest: record.mechanismDigest,
      sealedPlanDigest: record.sealedPlanDigest,
    };
  }
}

export function normalizePrivateLinuxOwnerStateCancellation(
  value: unknown,
): PrivateLinuxOwnerStateCancellation {
  const record = exactRecord(value, [
    "allocationDigest", "digest", "directoryDevice", "directoryInode", "kind", "state",
  ], "Linux owner-state cancellation");
  if (record.kind !== "private-linux-owner-state-cancellation/1" ||
      typeof record.digest !== "string" || !DIGEST.test(record.digest) ||
      typeof record.allocationDigest !== "string" || !DIGEST.test(record.allocationDigest) ||
      typeof record.directoryDevice !== "string" || !nonnegativeIntegerText(record.directoryDevice) ||
      typeof record.directoryInode !== "string" || !positiveIntegerText(record.directoryInode) ||
      record.state !== "cancelled") {
    throw new TypeError("Linux owner-state cancellation is invalid");
  }
  const fields = {
    kind: record.kind,
    allocationDigest: record.allocationDigest,
    directoryDevice: record.directoryDevice,
    directoryInode: record.directoryInode,
    state: record.state,
  };
  if (record.digest !== privateDomainDigest("JIG-Rootless-Linux-Owner-Cancellation/1", fields)) {
    throw new TypeError("Linux owner-state cancellation digest is invalid");
  }
  return Object.freeze({
    ...fields,
    kind: "private-linux-owner-state-cancellation/1" as const,
    state: "cancelled" as const,
    digest: record.digest,
  });
}

export function normalizePrivateLinuxSealedOwnerIdentity(value: unknown): PrivateLinuxSealedOwnerIdentity {
  const record = exactRecord(value, [
    "bootId", "cancellationGraceMs", "cleanupTimeoutMs", "deadlineUnixMs", "delegatedCgroup",
    "delegatedCgroupDevice", "delegatedCgroupInode", "digest", "kind", "mechanismDigest", "nonce",
    "ownerStateAllocationDigest", "ownerStateDevice", "ownerStateDirectory", "ownerStateInode",
    "ownerStateName", "ownerStateParent", "ownerStateParentDevice", "ownerStateParentInode", "ownerToken",
    "runCgroup", "runId", "sealedPlanDigest",
  ], "sealed rootless Linux owner");
  if (record.kind !== "private-linux-sealed-owner/1" ||
      typeof record.digest !== "string" || !DIGEST.test(record.digest) ||
      typeof record.runId !== "string" || !RUN_ID.test(record.runId) ||
      typeof record.nonce !== "string" || !NONCE.test(record.nonce) ||
      typeof record.ownerToken !== "string" || !TOKEN.test(record.ownerToken) ||
      typeof record.mechanismDigest !== "string" || !DIGEST.test(record.mechanismDigest) ||
      typeof record.sealedPlanDigest !== "string" || !DIGEST.test(record.sealedPlanDigest) ||
      typeof record.bootId !== "string" || !BOOT_ID.test(record.bootId) ||
      typeof record.delegatedCgroup !== "string" || !canonicalCgroup(record.delegatedCgroup) ||
      typeof record.delegatedCgroupDevice !== "string" || !nonnegativeIntegerText(record.delegatedCgroupDevice) ||
      typeof record.delegatedCgroupInode !== "string" || !positiveIntegerText(record.delegatedCgroupInode) ||
      typeof record.runCgroup !== "string" ||
      record.runCgroup !== join(record.delegatedCgroup, `jig-run-${record.runId}-${record.nonce}`) ||
      !safeNonnegativeInteger(record.deadlineUnixMs) ||
      !safePositiveInteger(record.cancellationGraceMs) ||
      !safePositiveInteger(record.cleanupTimeoutMs) ||
      typeof record.ownerStateParent !== "string" || !canonicalAbsolute(record.ownerStateParent) ||
      typeof record.ownerStateParentDevice !== "string" || !nonnegativeIntegerText(record.ownerStateParentDevice) ||
      typeof record.ownerStateParentInode !== "string" || !positiveIntegerText(record.ownerStateParentInode) ||
      typeof record.ownerStateName !== "string" || !OWNER_NAME.test(record.ownerStateName) ||
      typeof record.ownerStateDirectory !== "string" ||
      record.ownerStateDirectory !== join(record.ownerStateParent, record.ownerStateName) ||
      typeof record.ownerStateDevice !== "string" || !nonnegativeIntegerText(record.ownerStateDevice) ||
      typeof record.ownerStateInode !== "string" || !positiveIntegerText(record.ownerStateInode) ||
      typeof record.ownerStateAllocationDigest !== "string" || !DIGEST.test(record.ownerStateAllocationDigest)) {
    throw new TypeError("sealed rootless Linux owner is invalid");
  }
  const fields = {
    kind: record.kind,
    runId: record.runId,
    nonce: record.nonce,
    ownerToken: record.ownerToken,
    mechanismDigest: record.mechanismDigest,
    sealedPlanDigest: record.sealedPlanDigest,
    bootId: record.bootId,
    delegatedCgroup: record.delegatedCgroup,
    delegatedCgroupDevice: record.delegatedCgroupDevice,
    delegatedCgroupInode: record.delegatedCgroupInode,
    runCgroup: record.runCgroup,
    deadlineUnixMs: Number(record.deadlineUnixMs),
    cancellationGraceMs: Number(record.cancellationGraceMs),
    cleanupTimeoutMs: Number(record.cleanupTimeoutMs),
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
    "JIG-Rootless-Linux-Sealed-Owner/1",
    fields as unknown as JsonValue,
  )) throw new TypeError("sealed rootless Linux owner digest is invalid");
  return Object.freeze({ ...fields, kind: "private-linux-sealed-owner/1" as const, digest: record.digest });
}

export function normalizePrivateLinuxPreparedOwnerIdentity(value: unknown): PrivateLinuxPreparedOwnerIdentity {
  const record = exactRecord(value, ["digest", "kind", "owner"], "prepared rootless Linux owner");
  const owner = normalizePrivateLinuxSealedOwnerIdentity(record.owner);
  if (record.kind !== "private-linux-prepared-owner/1" ||
      typeof record.digest !== "string" ||
      record.digest !== privateDomainDigest("JIG-Rootless-Linux-Prepared-Owner/1", owner as unknown as JsonValue)) {
    throw new TypeError("prepared rootless Linux owner is invalid");
  }
  return Object.freeze({ kind: record.kind, digest: record.digest, owner });
}

export function normalizePrivateLinuxConfirmedEnforcementReceipt(
  value: unknown,
): PrivateLinuxConfirmedEnforcementReceipt {
  const record = exactRecord(value, [
    "evidence", "exitCode", "fenced", "kind", "ownerDigest", "signal", "stopReason",
  ], "rootless Linux enforcement receipt");
  if (record.kind !== "private-linux-confirmed-enforcement/1" ||
      typeof record.ownerDigest !== "string" || !DIGEST.test(record.ownerDigest) ||
      !STOP_REASONS.has(record.stopReason as never) ||
      !(record.exitCode === null || Number.isSafeInteger(record.exitCode)) ||
      !(record.signal === null || typeof record.signal === "string") || record.fenced !== true) {
    throw new TypeError("rootless Linux enforcement receipt is invalid");
  }
  return Object.freeze({
    kind: record.kind,
    ownerDigest: record.ownerDigest,
    stopReason: record.stopReason as PrivateLinuxConfirmedEnforcementReceipt["stopReason"],
    exitCode: record.exitCode as number | null,
    signal: record.signal as string | null,
    fenced: true,
    evidence: normalizeEvidence(record.evidence),
  });
}

export function normalizePrivateLinuxOwnerStateReleaseReceipt(
  value: unknown,
): PrivateLinuxOwnerStateReleaseReceipt {
  const record = exactRecord(value, [
    "allocationDigest", "digest", "directoryDevice", "directoryInode", "kind", "released",
  ], "Linux owner-state release receipt");
  if (record.kind !== "private-linux-owner-state-release/1" ||
      typeof record.digest !== "string" || !DIGEST.test(record.digest) ||
      typeof record.allocationDigest !== "string" || !DIGEST.test(record.allocationDigest) ||
      typeof record.directoryDevice !== "string" || !nonnegativeIntegerText(record.directoryDevice) ||
      typeof record.directoryInode !== "string" || !positiveIntegerText(record.directoryInode) ||
      record.released !== true) throw new TypeError("Linux owner-state release receipt is invalid");
  const fields = {
    kind: record.kind,
    allocationDigest: record.allocationDigest,
    directoryDevice: record.directoryDevice,
    directoryInode: record.directoryInode,
    released: true as const,
  };
  if (record.digest !== privateDomainDigest("JIG-Rootless-Linux-Owner-Release/1", fields)) {
    throw new TypeError("Linux owner-state release receipt digest is invalid");
  }
  return Object.freeze({ ...fields, kind: "private-linux-owner-state-release/1" as const, digest: record.digest });
}

export async function releasePrivateLinuxOwnerState(
  ownerValue: unknown,
  proofValue: unknown,
): Promise<PrivateLinuxOwnerStateReleaseReceipt> {
  const reference = isAllocationValue(ownerValue)
    ? releaseReferenceForAllocation(ownerValue, proofValue)
    : releaseReferenceForOwner(ownerValue, proofValue);
  await requireExactParent(reference.parent, reference.parentDevice, reference.parentInode);
  const receipt = releaseReceipt(reference);
  let directoryInformation;
  try {
    directoryInformation = await lstat(reference.directory, { bigint: true });
  } catch (error) {
    if (hasCode(error, "ENOENT")) return receipt;
    throw error;
  }
  requirePrivateDirectory(directoryInformation, "Linux owner-state directory");
  if (String(directoryInformation.dev) !== reference.directoryDevice ||
      String(directoryInformation.ino) !== reference.directoryInode) {
    throw new Error("Linux owner-state directory changed before release");
  }
  const marker = join(reference.directory, "release.json");
  const markerText = `${JSON.stringify(receipt)}\n`;
  if (await pathExists(marker)) {
    if (await readFile(marker, "utf8") !== markerText) {
      throw new Error("Linux owner-state release marker conflicts");
    }
  } else {
    await requireReleaseFiles(reference);
    await writeExactFile(marker, markerText);
    await syncDirectory(reference.directory);
  }
  await requireReleasableEntries(reference);
  for (const name of await readdir(reference.directory)) {
    if (name === "release.json") continue;
    await unlink(join(reference.directory, name));
  }
  await unlink(marker);
  await rmdir(reference.directory);
  await syncDirectory(reference.parent);
  return receipt;
}

interface ReleaseReference {
  readonly allocationDigest: string;
  readonly parent: string;
  readonly parentDevice: string;
  readonly parentInode: string;
  readonly directory: string;
  readonly directoryDevice: string;
  readonly directoryInode: string;
  readonly ownerToken: string;
  readonly requiredClaim: "cancelled" | "active" | "recovered";
  readonly ownerBootId?: string;
  readonly expectedOwnerDigest?: string;
  readonly runCgroup?: string;
  readonly mechanismDigest?: string;
  readonly sealedPlanDigest?: string;
}

const STOP_REASONS = new Set<PrivateLinuxConfirmedEnforcementReceipt["stopReason"]>([
  "cancelled", "coordinator_lost", "deadline", "payload_exit", "setup_failed", "recovered",
]);

function releaseReferenceForAllocation(ownerValue: unknown, proofValue: unknown): ReleaseReference {
  const allocation = normalizePrivateLinuxOwnerStateAllocationIdentity(ownerValue);
  const proof = normalizePrivateLinuxOwnerStateCancellation(proofValue);
  if (proof.allocationDigest !== allocation.digest) throw new TypeError("owner cancellation does not match allocation");
  return {
    allocationDigest: allocation.digest,
    parent: allocation.parent,
    parentDevice: allocation.parentDevice,
    parentInode: allocation.parentInode,
    directory: allocation.directory,
    directoryDevice: proof.directoryDevice,
    directoryInode: proof.directoryInode,
    ownerToken: allocation.ownerToken,
    requiredClaim: "cancelled",
  };
}

function releaseReferenceForOwner(ownerValue: unknown, proofValue: unknown): ReleaseReference {
  const owner = isPreparedValue(ownerValue)
    ? normalizePrivateLinuxPreparedOwnerIdentity(ownerValue).owner
    : normalizePrivateLinuxSealedOwnerIdentity(ownerValue);
  const proof = normalizePrivateLinuxConfirmedEnforcementReceipt(proofValue);
  const prepared = preparedFor(owner);
  if (proof.ownerDigest !== prepared.digest) throw new TypeError("enforcement receipt does not match owner");
  return {
    allocationDigest: owner.ownerStateAllocationDigest,
    parent: owner.ownerStateParent,
    parentDevice: owner.ownerStateParentDevice,
    parentInode: owner.ownerStateParentInode,
    directory: owner.ownerStateDirectory,
    directoryDevice: owner.ownerStateDevice,
    directoryInode: owner.ownerStateInode,
    ownerToken: owner.ownerToken,
    requiredClaim: proof.stopReason === "recovered" ? "recovered" : "active",
    ...(proof.stopReason === "recovered" ? { ownerBootId: owner.bootId } : {}),
    expectedOwnerDigest: prepared.digest,
    runCgroup: owner.runCgroup,
    mechanismDigest: owner.mechanismDigest,
    sealedPlanDigest: owner.sealedPlanDigest,
  };
}

function releaseReceipt(reference: ReleaseReference): PrivateLinuxOwnerStateReleaseReceipt {
  const fields = {
    kind: "private-linux-owner-state-release/1" as const,
    allocationDigest: reference.allocationDigest,
    directoryDevice: reference.directoryDevice,
    directoryInode: reference.directoryInode,
    released: true as const,
  };
  return normalizePrivateLinuxOwnerStateReleaseReceipt({
    ...fields,
    digest: privateDomainDigest("JIG-Rootless-Linux-Owner-Release/1", fields),
  });
}

async function observeInitialMechanism(options: NormalizedOptions): Promise<InitialMechanismObservation> {
  const authority = await acquirePrivateRootlessLinux();
  return Object.freeze({
    acquisition: authority,
    mechanism: await observeMechanismWithAuthority(options, authority),
  });
}

async function observeMechanismWithAuthority(
  options: NormalizedOptions,
  authority: PrivateRootlessLinuxAcquisitionObservation,
): Promise<PrivateLinuxBackendMechanismObservation> {
  const [bunPath, bunHostLibraryPath, supervisorPath] = await Promise.all([
    realpath(options.bunPath),
    realpath(options.bunHostLibraryPath),
    realpath(options.supervisorPath),
  ]);
  if (bunPath !== options.bunPath || bunHostLibraryPath !== options.bunHostLibraryPath ||
      supervisorPath !== options.supervisorPath) {
    throw new Error("rootless Linux support paths must be canonical");
  }
  const [scope, bootId, bun, bunLibraries, supervisor, bubblewrap] = await Promise.all([
    lstat(authority.delegatedCgroup, { bigint: true }),
    observeLinuxBootId(),
    lstat(bunPath),
    lstat(bunHostLibraryPath),
    lstat(supervisorPath),
    lstat(authority.bubblewrapPath),
  ]);
  requireExecutable(bun, "Bun");
  if (!bunLibraries.isDirectory() || bunLibraries.isSymbolicLink()) {
    throw new Error("Bun host library path is unavailable");
  }
  requireRegularFile(supervisor, "rootless supervisor");
  requireExecutable(bubblewrap, "Bubblewrap");
  const [bunDigest, supervisorDigest, bubblewrapDigest] = await Promise.all([
    privateFileDigest(bunPath),
    privateFileDigest(supervisorPath),
    privateFileDigest(authority.bubblewrapPath),
  ]);
  // The mechanism identity describes reproducible host support. The delegated
  // cgroup is invocation authority: retain and recheck it for this launch,
  // but do not make every transient CLI scope a different admitted recipe.
  const supportFields = {
    kind: "linux-rootless-cgroup-v2-bubblewrap-mechanism/1" as const,
    trustedBubblewrapPath: authority.bubblewrapPath,
    trustedBubblewrapDigest: bubblewrapDigest,
    bubblewrapVersion: authority.bubblewrapVersion,
    trustedCoordinatorBunPath: bunPath,
    trustedCoordinatorBunDigest: bunDigest,
    trustedCoordinatorLibraryPath: bunHostLibraryPath,
    trustedSupervisorPath: supervisorPath,
    trustedSupervisorDigest: supervisorDigest,
    cgroupVersion: 2 as const,
    controllers: Object.freeze(["cpu", "memory", "pids"] as const),
    payloadUid: authority.payloadUid,
    payloadGid: authority.payloadGid,
    startupTimeoutMs: options.startupTimeoutMs,
  };
  const support = Object.freeze({
    ...supportFields,
    digest: privateDomainDigest("JIG-Rootless-Linux-Mechanism/1", supportFields as unknown as JsonValue),
  });
  const launchAuthority = Object.freeze({
    bootId,
    delegatedCgroup: authority.delegatedCgroup,
    delegatedCgroupDevice: String(scope.dev),
    delegatedCgroupInode: String(scope.ino),
  });
  return Object.freeze({ support, authority: launchAuthority });
}

async function observeLinuxBootId(): Promise<string> {
  const [resolved, information, filesystem, text] = await Promise.all([
    realpath(BOOT_ID_PATH),
    lstat(BOOT_ID_PATH),
    statfs(BOOT_ID_PATH),
    readFile(BOOT_ID_PATH, "utf8"),
  ]);
  if (resolved !== BOOT_ID_PATH || !information.isFile() || information.isSymbolicLink() ||
      (Number(information.mode) & 0o222) !== 0 || BigInt(filesystem.type) !== PROC_SUPER_MAGIC ||
      !text.endsWith("\n") || text.indexOf("\n") !== text.length - 1) {
    throw new Error("Linux boot identity is unavailable");
  }
  const bootId = text.slice(0, -1);
  if (!BOOT_ID.test(bootId)) throw new Error("Linux boot identity is unavailable");
  return bootId;
}

/** Private launch guard; this is not a public Backend or host extension seam. */
export function requirePrivateLinuxMechanismUnchanged(
  sealed: PrivateLinuxBackendMechanismObservation,
  current: PrivateLinuxBackendMechanismObservation,
): void {
  if (current.support.digest !== sealed.support.digest ||
      current.authority.bootId !== sealed.authority.bootId ||
      current.authority.delegatedCgroup !== sealed.authority.delegatedCgroup ||
      current.authority.delegatedCgroupDevice !== sealed.authority.delegatedCgroupDevice ||
      current.authority.delegatedCgroupInode !== sealed.authority.delegatedCgroupInode) {
    throw new Error("rootless Linux mechanism changed after sealing");
  }
}

function supervisorConfiguration(data: SealedOwnerData): object {
  return Object.freeze({
    runCgroup: data.identity.runCgroup,
    delegatedCgroup: data.identity.delegatedCgroup,
    ownerStateDirectory: data.identity.ownerStateDirectory,
    ownerStateAllocationDigest: data.identity.ownerStateAllocationDigest,
    ownerToken: data.identity.ownerToken,
    ownerDigest: data.prepared.digest,
    mechanismDigest: data.identity.mechanismDigest,
    sealedPlanDigest: data.identity.sealedPlanDigest,
    limits: data.sealedPlan.limits,
    readOnlyMounts: data.sealedPlan.readOnlyMounts.map(({ source, destination }) => ({ source, destination })),
    command: data.sealedPlan.command,
    environment: data.sealedPlan.environment,
    network: data.sealedPlan.network,
    bunPath: data.mechanism.support.trustedCoordinatorBunPath,
    bunHostLibraryPath: data.mechanism.support.trustedCoordinatorLibraryPath,
    bubblewrapPath: data.mechanism.support.trustedBubblewrapPath,
    payloadUid: data.mechanism.support.payloadUid,
    payloadGid: data.mechanism.support.payloadGid,
    supervisorPath: data.mechanism.support.trustedSupervisorPath,
  });
}

function envelopeFor(data: SealedOwnerData): PrivateLinuxEnvelopeIdentity {
  return Object.freeze({
    kind: "linux-rootless-cgroup-v2-bubblewrap/1",
    mechanismDigest: data.mechanism.support.digest,
    sealedPlanDigest: data.identity.sealedPlanDigest,
    trustedBubblewrapPath: data.mechanism.support.trustedBubblewrapPath,
    trustedBubblewrapDigest: data.mechanism.support.trustedBubblewrapDigest,
    trustedCoordinatorBunPath: data.mechanism.support.trustedCoordinatorBunPath,
    trustedCoordinatorBunDigest: data.mechanism.support.trustedCoordinatorBunDigest,
    trustedSupervisorPath: data.mechanism.support.trustedSupervisorPath,
    trustedSupervisorDigest: data.mechanism.support.trustedSupervisorDigest,
    cgroupVersion: 2,
    controllers: data.mechanism.support.controllers,
    payloadUid: data.mechanism.support.payloadUid,
    payloadGid: data.mechanism.support.payloadGid,
    limits: data.sealedPlan.limits,
    privateProcessFilesystem: true,
    privateRuntimeDevices: true,
    network: data.sealedPlan.network,
  });
}

function requireSealedOwner(
  owner: PrivateLinuxSealedOwner,
  backend: PrivateLinuxCgroupBackend,
  plan: PrivateLinuxLaunchPlan,
): SealedOwnerData {
  const data = authenticSealedOwners.get(owner);
  if (data === undefined || data.backend !== backend || data.sourcePlan !== plan || !Object.isFrozen(owner)) {
    throw new TypeError("sealed rootless Linux owner was not produced for this launch");
  }
  return data;
}

async function sealPlan(plan: PrivateLinuxLaunchPlan): Promise<SealedLaunchPlan> {
  const snapshot = snapshotPlan(plan);
  const mounts: SealedMount[] = [];
  for (const mount of snapshot.readOnlyMounts) {
    const source = await realpath(mount.source);
    const [information, filesystem] = await Promise.all([
      lstat(source, { bigint: true }),
      statfs(source),
    ]);
    if ((protectedHostSource(source) &&
        !privateLinuxResolverProjection(mount.source, source, mount.destination)) ||
        protectedFilesystem(BigInt(filesystem.type))) {
      throw new TypeError("host pseudo-filesystem cannot enter the rootless sandbox");
    }
    const sourceType = information.isDirectory() ? "directory" : information.isFile() ? "file" : undefined;
    if (sourceType === undefined || information.isSymbolicLink()) {
      throw new TypeError("rootless read-only mount source must be a regular file or directory");
    }
    mounts.push(Object.freeze({
      source,
      destination: mount.destination,
      sourceDevice: String(information.dev),
      sourceInode: String(information.ino),
      sourceType,
    }));
  }
  return Object.freeze({ ...snapshot, readOnlyMounts: Object.freeze(mounts) });
}

function snapshotPlan(value: PrivateLinuxLaunchPlan): SealedLaunchPlan {
  if (value === null || typeof value !== "object" || !RUN_ID.test(value.runId)) {
    throw new TypeError("rootless Linux launch plan is invalid");
  }
  const limits = value.limits;
  const normalizedLimits = Object.freeze({
    memoryBytes: positiveInteger(limits.memoryBytes, "memoryBytes"),
    pids: positiveInteger(limits.pids, "pids"),
    cpuQuotaMicros: positiveInteger(limits.cpuQuotaMicros, "cpuQuotaMicros"),
    cpuPeriodMicros: positiveInteger(limits.cpuPeriodMicros, "cpuPeriodMicros"),
    deadlineUnixMs: nonnegativeInteger(limits.deadlineUnixMs, "deadlineUnixMs"),
    cancellationGraceMs: positiveInteger(limits.cancellationGraceMs, "cancellationGraceMs"),
    cleanupTimeoutMs: positiveInteger(limits.cleanupTimeoutMs ?? 5_000, "cleanupTimeoutMs"),
  });
  if (normalizedLimits.deadlineUnixMs + normalizedLimits.cancellationGraceMs > Number.MAX_SAFE_INTEGER) {
    throw new TypeError("rootless Linux deadline is invalid");
  }
  if (!Array.isArray(value.command) || value.command.length === 0 ||
      value.command.some((part) => typeof part !== "string" || part.includes("\0")) ||
      !canonicalAbsolute(value.command[0]!)) {
    throw new TypeError("rootless Linux command is invalid");
  }
  if (!Array.isArray(value.readOnlyMounts)) throw new TypeError("rootless Linux mounts are invalid");
  const destinations = new Set<string>();
  const mounts = value.readOnlyMounts.map((mount) => {
    if (mount === null || typeof mount !== "object" || !canonicalAbsolute(mount.source) ||
        !canonicalAbsolute(mount.destination) || protectedDestination(mount.destination) ||
        destinations.has(mount.destination)) {
      throw new TypeError("rootless Linux read-only mount is invalid");
    }
    for (const destination of destinations) {
      if (destination.startsWith(`${mount.destination}/`) || mount.destination.startsWith(`${destination}/`)) {
        throw new TypeError("rootless Linux read-only mounts overlap");
      }
    }
    destinations.add(mount.destination);
    return Object.freeze({ source: mount.source, destination: mount.destination });
  });
  const environment: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const [name, content] of Object.entries(value.environment ?? {})) {
    if (!ENVIRONMENT_NAME.test(name) || name === "BUN_BE_BUN" || name === "LD_LIBRARY_PATH" ||
        typeof content !== "string" || content.includes("\0")) {
      throw new TypeError("rootless Linux environment is invalid");
    }
    environment[name] = content;
  }
  const network = value.network ?? "isolated";
  if (network !== "isolated" && network !== "inherited") {
    throw new TypeError("rootless Linux network policy is invalid");
  }
  return Object.freeze({
    runId: value.runId,
    limits: normalizedLimits,
    readOnlyMounts: Object.freeze(mounts) as unknown as readonly SealedMount[],
    command: Object.freeze([...value.command]) as unknown as readonly [string, ...string[]],
    environment: Object.freeze(environment),
    network,
  });
}

async function requireSealedMounts(mounts: readonly SealedMount[]): Promise<void> {
  for (const mount of mounts) {
    const information = await lstat(mount.source, { bigint: true });
    const type = information.isDirectory() ? "directory" : information.isFile() ? "file" : undefined;
    if (information.isSymbolicLink() || String(information.dev) !== mount.sourceDevice ||
        String(information.ino) !== mount.sourceInode || type !== mount.sourceType) {
      throw new Error("rootless Linux mount source changed after sealing");
    }
  }
}

function preparedFor(owner: PrivateLinuxSealedOwnerIdentity): PrivateLinuxPreparedOwnerIdentity {
  return Object.freeze({
    kind: "private-linux-prepared-owner/1",
    digest: privateDomainDigest("JIG-Rootless-Linux-Prepared-Owner/1", owner as unknown as JsonValue),
    owner,
  });
}

async function createOwnerState(
  source: PrivateLinuxOwnerStateLocation | PrivateLinuxOwnerStateAllocationIdentity | undefined,
  nonce: string,
): Promise<AllocatedOwnerState> {
  let allocation: PrivateLinuxOwnerStateAllocationIdentity;
  let automaticParent: string | undefined;
  if (source === undefined) {
    automaticParent = await mkdtemp(join(tmpdir(), "jig-rootless-owner-"));
    await (await open(automaticParent, "r")).close();
    allocation = await planPrivateLinuxOwnerStateAllocation({ parent: automaticParent, name: `owner-${nonce}` });
  } else if (isAllocationValue(source)) {
    allocation = normalizePrivateLinuxOwnerStateAllocationIdentity(source);
  } else {
    allocation = await planPrivateLinuxOwnerStateAllocation(source);
  }
  await requireAllocationParent(allocation);
  const information = await ensureAllocationDirectory(allocation);
  return {
    allocation,
    parent: allocation.parent,
    parentDevice: allocation.parentDevice,
    parentInode: allocation.parentInode,
    name: allocation.name,
    directory: allocation.directory,
    device: String(information.dev),
    inode: String(information.ino),
    ...(automaticParent === undefined ? {} : { automaticParent }),
  };
}

interface OwnerRecordReference {
  readonly allocationDigest: string;
  readonly directory: string;
  readonly ownerToken: string;
  readonly ownerDigest?: string;
  readonly runCgroup?: string;
  readonly mechanismDigest?: string;
  readonly sealedPlanDigest?: string;
}

function ownerRecord(value: PrivateLinuxOwnerStateAllocationIdentity | PrivateLinuxSealedOwnerIdentity): OwnerRecordReference {
  if (value.kind === "private-linux-owner-state-allocation/1") {
    return { allocationDigest: value.digest, directory: value.directory, ownerToken: value.ownerToken };
  }
  return {
    allocationDigest: value.ownerStateAllocationDigest,
    directory: value.ownerStateDirectory,
    ownerToken: value.ownerToken,
    ownerDigest: preparedFor(value).digest,
    runCgroup: value.runCgroup,
    mechanismDigest: value.mechanismDigest,
    sealedPlanDigest: value.sealedPlanDigest,
  };
}

async function initializeOwnerState(owner: PrivateLinuxSealedOwnerIdentity): Promise<void> {
  await requireOwnerStateDirectory(owner);
  await ensureOwnerRecord(ownerRecord(owner));
  await syncDirectory(owner.ownerStateDirectory);
  await syncDirectory(owner.ownerStateParent);
  await requireOwnerState(owner);
}

async function requireOwnerUnused(owner: PrivateLinuxSealedOwnerIdentity): Promise<void> {
  for (const path of [owner.runCgroup, join(owner.ownerStateDirectory, "claim.json"),
    join(owner.ownerStateDirectory, "final.json")]) {
    if (await pathExists(path)) throw new Error(`rootless Linux owner path already exists: ${path}`);
  }
}

async function ensureOwnerRecord(reference: OwnerRecordReference): Promise<void> {
  const path = join(reference.directory, "owner.json");
  const fields = {
    allocationDigest: reference.allocationDigest,
    kind: "private-linux-owner-state/1",
    token: reference.ownerToken,
    ...(reference.ownerDigest === undefined ? {} : {
      ownerDigest: reference.ownerDigest,
      runCgroup: reference.runCgroup,
      mechanismDigest: reference.mechanismDigest,
      sealedPlanDigest: reference.sealedPlanDigest,
    }),
  };
  const text = `${JSON.stringify(fields)}\n`;
  try {
    await writeExactFile(path, text);
  } catch (error) {
    if (!hasCode(error, "EEXIST")) throw error;
    const existing = await readFile(path, "utf8");
    if (existing === text) return;
    if (!incompleteJsonLine(existing) ||
        (await readdir(reference.directory)).some((name) => name !== "owner.json")) {
      throw new Error("rootless Linux owner record conflicts");
    }
    const information = await lstat(path);
    if (!information.isFile() || information.isSymbolicLink()) {
      throw new Error("rootless Linux owner record conflicts");
    }
    await unlink(path);
    await writeExactFile(path, text);
    await syncDirectory(reference.directory);
  }
}

async function requireOwnerRecord(reference: OwnerRecordReference): Promise<void> {
  const record = parseJsonLine(await readFile(join(reference.directory, "owner.json"), "utf8"),
    "rootless Linux owner record");
  const expectedKeys = reference.ownerDigest === undefined
    ? ["allocationDigest", "kind", "token"]
    : ["allocationDigest", "kind", "mechanismDigest", "ownerDigest", "runCgroup", "sealedPlanDigest", "token"];
  if (record.kind !== "private-linux-owner-state/1" ||
      record.allocationDigest !== reference.allocationDigest || record.token !== reference.ownerToken ||
      record.ownerDigest !== reference.ownerDigest || record.runCgroup !== reference.runCgroup ||
      record.mechanismDigest !== reference.mechanismDigest || record.sealedPlanDigest !== reference.sealedPlanDigest ||
      Object.keys(record).sort().join("\0") !== expectedKeys.sort().join("\0")) {
    throw new Error("rootless Linux owner record is invalid");
  }
}

async function claimCancellation(reference: OwnerRecordReference): Promise<"won" | "cancelled" | "active"> {
  await requireOwnerRecord(reference);
  const path = join(reference.directory, "claim.json");
  const cancellation = `${JSON.stringify({
    allocationDigest: reference.allocationDigest,
    kind: "private-linux-owner-claim/1",
    state: "cancelled",
    token: reference.ownerToken,
  })}\n`;
  try {
    await writeExactFile(path, cancellation);
    await syncDirectory(reference.directory);
    return "won";
  } catch (error) {
    if (!hasCode(error, "EEXIST")) throw error;
  }
  const claim = parseJsonLine(await readFile(path, "utf8"), "rootless Linux owner claim");
  if (claim.allocationDigest !== reference.allocationDigest || claim.kind !== "private-linux-owner-claim/1" ||
      claim.token !== reference.ownerToken || (claim.state !== "active" && claim.state !== "cancelled") ||
      Object.keys(claim).sort().join("\0") !== ["allocationDigest", "kind", "state", "token"].join("\0")) {
    throw new Error("rootless Linux owner claim is invalid");
  }
  return claim.state;
}

async function requireOwnerState(owner: PrivateLinuxSealedOwnerIdentity): Promise<void> {
  await requireOwnerStateDirectory(owner);
  await requireOwnerRecord(ownerRecord(owner));
}

async function requireOwnerStateDirectory(owner: PrivateLinuxSealedOwnerIdentity): Promise<void> {
  await requireExactParent(owner.ownerStateParent, owner.ownerStateParentDevice, owner.ownerStateParentInode);
  const information = await lstat(owner.ownerStateDirectory, { bigint: true });
  requirePrivateDirectory(information, "rootless Linux owner-state directory");
  if (String(information.dev) !== owner.ownerStateDevice || String(information.ino) !== owner.ownerStateInode) {
    throw new Error("rootless Linux owner-state identity changed");
  }
}

async function requireAllocationParent(allocation: PrivateLinuxOwnerStateAllocationIdentity): Promise<void> {
  await requireExactParent(allocation.parent, allocation.parentDevice, allocation.parentInode);
}

async function requireExactParent(path: string, device: string, inode: string): Promise<void> {
  const information = await lstat(path, { bigint: true });
  requirePrivateDirectory(information, "Linux owner-state parent");
  if (String(information.dev) !== device || String(information.ino) !== inode) {
    throw new Error("Linux owner-state parent changed");
  }
}

async function ensureAllocationDirectory(allocation: PrivateLinuxOwnerStateAllocationIdentity) {
  try {
    await mkdir(allocation.directory, { mode: 0o700 });
    await syncDirectory(allocation.parent);
  } catch (error) {
    if (!hasCode(error, "EEXIST")) throw error;
  }
  const information = await lstat(allocation.directory, { bigint: true });
  requirePrivateDirectory(information, "Linux owner-state directory");
  return information;
}

async function requireDelegatedIdentity(owner: PrivateLinuxSealedOwnerIdentity): Promise<void> {
  try {
    const information = await lstat(owner.delegatedCgroup, { bigint: true });
    if (!information.isDirectory() || information.isSymbolicLink() ||
        String(information.dev) !== owner.delegatedCgroupDevice ||
        String(information.ino) !== owner.delegatedCgroupInode ||
        BigInt((await statfs(owner.delegatedCgroup)).type) !== CGROUP2_SUPER_MAGIC) {
      throw new Error("delegated cgroup identity changed");
    }
  } catch (error) {
    throw asFenceUnconfirmed(error);
  }
}

async function requirePreparedCgroup(data: SealedOwnerData): Promise<void> {
  const [memory, pids, cpu, processes] = await Promise.all([
    readFile(join(data.identity.runCgroup, "memory.max"), "utf8"),
    readFile(join(data.identity.runCgroup, "pids.max"), "utf8"),
    readFile(join(data.identity.runCgroup, "cpu.max"), "utf8"),
    readFile(join(data.identity.runCgroup, "cgroup.procs"), "utf8"),
  ]);
  if (memory.trim() !== String(data.sealedPlan.limits.memoryBytes) ||
      pids.trim() !== String(data.sealedPlan.limits.pids) ||
      cpu.trim() !== `${data.sealedPlan.limits.cpuQuotaMicros} ${data.sealedPlan.limits.cpuPeriodMicros}` ||
      processes.trim() !== "") {
    throw new Error("rootless Linux Run cgroup was not prepared before admission");
  }
}

async function requirePayloadInCgroup(cgroup: string, payloadPid: number): Promise<void> {
  const members = new Set((await readFile(join(cgroup, "cgroup.procs"), "utf8")).trim().split(/\s+/));
  if (!members.has(String(payloadPid))) throw new Error("rootless Linux payload did not enter its Run cgroup");
}

function requirePreparedMessage(message: SupervisorPrepared, data: SealedOwnerData): void {
  if (message.runCgroup !== data.identity.runCgroup || !safePositiveInteger(message.supervisorPid)) {
    throw new Error("rootless supervisor prepared an unexpected owner");
  }
}

function requireReadyMessage(
  message: SupervisorReady,
  prepared: SupervisorPrepared,
  data: SealedOwnerData,
): void {
  if (message.runCgroup !== data.identity.runCgroup || message.supervisorPid !== prepared.supervisorPid ||
      !safePositiveInteger(message.payloadPid)) {
    throw new Error("rootless supervisor announced an unexpected payload");
  }
}

function requireTerminalMessage(
  message: SupervisorTerminal,
  prepared: SupervisorPrepared,
  data: SealedOwnerData,
): void {
  const normalized = normalizeFinal(message);
  if (normalized.type !== "terminal" || normalized.ownerDigest !== data.prepared.digest ||
      normalized.runCgroup !== data.identity.runCgroup || normalized.supervisorPid !== prepared.supervisorPid) {
    throw new Error("rootless supervisor returned an unexpected terminal");
  }
}

async function tryReadFinal(prepared: PrivateLinuxPreparedOwnerIdentity): Promise<FinalRecord | undefined> {
  try {
    return await readFinal(prepared);
  } catch (error) {
    if (hasCode(error, "ENOENT")) return undefined;
    throw error;
  }
}

async function readFinal(prepared: PrivateLinuxPreparedOwnerIdentity): Promise<FinalRecord> {
  await requireOwnerState(prepared.owner);
  const path = join(prepared.owner.ownerStateDirectory, "final.json");
  const information = await lstat(path);
  if (!information.isFile() || information.isSymbolicLink() || (information.mode & 0o022) !== 0) {
    throw new Error("rootless Linux final receipt file is invalid");
  }
  const final = normalizeFinal(JSON.parse(requireJsonLine(await readFile(path, "utf8"), "final receipt")));
  if (final.ownerDigest !== prepared.digest || final.runCgroup !== prepared.owner.runCgroup) {
    throw new Error("rootless Linux final receipt does not match its owner");
  }
  return final;
}

async function persistFinal(prepared: PrivateLinuxPreparedOwnerIdentity, final: RecoveredFinal): Promise<void> {
  const directory = prepared.owner.ownerStateDirectory;
  const target = join(directory, "final.json");
  const temporary = join(directory, `.final-recovery-${process.pid}-${randomBytes(8).toString("hex")}`);
  const text = `${JSON.stringify(final)}\n`;
  await writeExactFile(temporary, text);
  try {
    await link(temporary, target);
    await syncDirectory(directory);
  } catch (error) {
    if (!hasCode(error, "EEXIST")) throw error;
    const existing = await readFinal(prepared);
    if (!sameJson(existing, final)) {
      throw new PrivateLinuxFenceUnconfirmedError(new Error("rootless cleanup owners produced conflicting receipts"));
    }
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

function normalizeFinal(value: unknown): FinalRecord {
  const record = ordinaryRecord(value, "rootless Linux final receipt");
  if (record.type === "recovered") {
    const exact = exactRecord(record, [
      "evidence", "exitCode", "fenced", "ownerDigest", "recoveryBootId", "runCgroup", "signal",
      "stopReason", "type",
    ], "rootless Linux recovered receipt");
    if (typeof exact.ownerDigest !== "string" || !DIGEST.test(exact.ownerDigest) ||
        typeof exact.runCgroup !== "string" || !canonicalCgroup(exact.runCgroup) ||
        typeof exact.recoveryBootId !== "string" || !BOOT_ID.test(exact.recoveryBootId) ||
        exact.stopReason !== "recovered" || exact.exitCode !== null || exact.signal !== null || exact.fenced !== true) {
      throw new TypeError("rootless Linux recovered receipt is invalid");
    }
    return Object.freeze({
      type: "recovered",
      ownerDigest: exact.ownerDigest,
      runCgroup: exact.runCgroup,
      stopReason: "recovered",
      exitCode: null,
      signal: null,
      fenced: true,
      recoveryBootId: exact.recoveryBootId,
      evidence: normalizeEvidence(exact.evidence),
    });
  }
  const allowed = record.cleanupError === undefined
    ? ["evidence", "exitCode", "fenced", "ownerDigest", "runCgroup", "signal", "stopReason", "supervisorPid", "type"]
    : ["cleanupError", "evidence", "exitCode", "fenced", "ownerDigest", "runCgroup", "signal", "stopReason", "supervisorPid", "type"];
  const exact = exactRecord(record, allowed, "rootless Linux supervisor terminal");
  if (exact.type !== "terminal" || typeof exact.ownerDigest !== "string" || !DIGEST.test(exact.ownerDigest) ||
      typeof exact.runCgroup !== "string" || !canonicalCgroup(exact.runCgroup) ||
      !safePositiveInteger(exact.supervisorPid) || !SUPERVISOR_STOP_REASONS.has(exact.stopReason as never) ||
      !(exact.exitCode === null || Number.isSafeInteger(exact.exitCode)) ||
      !(exact.signal === null || typeof exact.signal === "string") || typeof exact.fenced !== "boolean" ||
      !(exact.cleanupError === undefined || typeof exact.cleanupError === "string")) {
    throw new TypeError("rootless Linux supervisor terminal is invalid");
  }
  return Object.freeze({
    type: "terminal",
    ownerDigest: exact.ownerDigest,
    runCgroup: exact.runCgroup,
    supervisorPid: Number(exact.supervisorPid),
    exitCode: exact.exitCode as number | null,
    signal: exact.signal as string | null,
    stopReason: exact.stopReason as SupervisorTerminal["stopReason"],
    fenced: exact.fenced,
    ...(exact.cleanupError === undefined ? {} : { cleanupError: exact.cleanupError }),
    evidence: normalizeEvidence(exact.evidence),
  });
}

const SUPERVISOR_STOP_REASONS = new Set<SupervisorTerminal["stopReason"]>([
  "cancelled", "coordinator_lost", "deadline", "payload_exit", "setup_failed",
]);

function receiptFor(
  prepared: PrivateLinuxPreparedOwnerIdentity,
  final: FinalRecord,
): PrivateLinuxConfirmedEnforcementReceipt {
  if (!final.fenced || (final.type === "terminal" && final.cleanupError !== undefined)) {
    throw new PrivateLinuxFenceUnconfirmedError(
      new Error(final.type === "terminal" ? final.cleanupError ?? "cleanup was not confirmed" : "cleanup was not confirmed"),
    );
  }
  return normalizePrivateLinuxConfirmedEnforcementReceipt({
    kind: "private-linux-confirmed-enforcement/1",
    ownerDigest: prepared.digest,
    stopReason: final.stopReason,
    exitCode: final.exitCode,
    signal: final.signal,
    fenced: true,
    evidence: final.evidence,
  });
}

function normalizeEvidence(value: unknown): PrivateLinuxEnforcementEvidence {
  const record = exactRecord(value, ["cpuStat", "memoryEvents", "pidsEvents"], "rootless Linux evidence");
  return Object.freeze({
    cpuStat: normalizeCounters(record.cpuStat),
    memoryEvents: normalizeCounters(record.memoryEvents),
    pidsEvents: normalizeCounters(record.pidsEvents),
  });
}

function normalizeCounters(value: unknown): Readonly<Record<string, number>> {
  const record = ordinaryRecord(value, "rootless Linux counters");
  const result: Record<string, number> = Object.create(null) as Record<string, number>;
  for (const key of Object.keys(record).sort()) {
    if (!/^[a-z][a-z0-9_.-]*$/.test(key) || !safeNonnegativeInteger(record[key])) {
      throw new TypeError("rootless Linux counters are invalid");
    }
    result[key] = Number(record[key]);
  }
  return Object.freeze(result);
}

function emptyEvidence(): PrivateLinuxEnforcementEvidence {
  return Object.freeze({
    cpuStat: Object.freeze({}),
    memoryEvents: Object.freeze({}),
    pidsEvents: Object.freeze({}),
  });
}

interface ReleaseFileExpectation {
  readonly claim: "active" | "cancelled" | "recovered";
  readonly ownerBootId?: string;
  readonly finalOwnerDigest?: string;
}

async function requireReleaseFiles(reference: ReleaseReference): Promise<void> {
  await requireOwnerRecord({
    allocationDigest: reference.allocationDigest,
    directory: reference.directory,
    ownerToken: reference.ownerToken,
    ...(reference.expectedOwnerDigest === undefined ? {} : {
      ownerDigest: reference.expectedOwnerDigest,
      runCgroup: reference.runCgroup,
      mechanismDigest: reference.mechanismDigest,
      sealedPlanDigest: reference.sealedPlanDigest,
    }),
  });
  const claim = parseJsonLine(await readFile(join(reference.directory, "claim.json"), "utf8"), "owner claim");
  if ((claim.state !== "active" && claim.state !== "cancelled") ||
      claim.kind !== "private-linux-owner-claim/1" ||
      claim.allocationDigest !== reference.allocationDigest) {
    throw new Error("rootless Linux owner claim does not permit release");
  }
  const expectation: ReleaseFileExpectation = {
    claim: reference.requiredClaim,
    ...(reference.ownerBootId === undefined ? {} : { ownerBootId: reference.ownerBootId }),
    ...(reference.expectedOwnerDigest === undefined ? {} : { finalOwnerDigest: reference.expectedOwnerDigest }),
  };
  if (expectation.finalOwnerDigest !== undefined) {
    const final = normalizeFinal(JSON.parse(requireJsonLine(
      await readFile(join(reference.directory, "final.json"), "utf8"),
      "final receipt",
    )));
    if (final.ownerDigest !== expectation.finalOwnerDigest || !final.fenced) {
      throw new Error("rootless Linux final receipt does not permit release");
    }
    const rebootRecovery = expectation.claim === "recovered" && final.type === "recovered" &&
      expectation.ownerBootId !== undefined && final.recoveryBootId !== expectation.ownerBootId;
    if (claim.state !== (expectation.claim === "recovered" ? "cancelled" : expectation.claim) &&
        !(claim.state === "active" && rebootRecovery)) {
      throw new Error("rootless Linux owner claim does not permit release");
    }
  } else if (claim.state !== expectation.claim) {
    throw new Error("rootless Linux owner claim does not permit release");
  }
  await requireReleasableEntries(reference);
}

async function requireReleasableEntries(reference: ReleaseReference): Promise<void> {
  const allowed = new Set(["owner.json", "claim.json", "release.json", ...(reference.expectedOwnerDigest === undefined
    ? [] : ["final.json"])]);
  for (const name of await readdir(reference.directory)) {
    if (allowed.has(name)) continue;
    if (name.startsWith(".final-") && reference.expectedOwnerDigest !== undefined) {
      const information = await lstat(join(reference.directory, name));
      if (!information.isFile() || information.isSymbolicLink()) {
        throw new Error("rootless Linux final temporary is invalid");
      }
      continue;
    }
    throw new Error("rootless Linux owner state contains unexpected entries");
  }
}

function isAllocationValue(value: unknown): boolean {
  return dataKind(value) === "private-linux-owner-state-allocation/1";
}

function isPreparedValue(value: unknown): boolean {
  return dataKind(value) === "private-linux-prepared-owner/1";
}

function dataKind(value: unknown): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value) || utilTypes.isProxy(value)) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, "kind");
  return descriptor !== undefined && "value" in descriptor ? descriptor.value : undefined;
}

function ordinaryRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value) || utilTypes.isProxy(value) ||
      (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) ||
      Object.getOwnPropertySymbols(value).length !== 0) throw new TypeError(`${label} is invalid`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.values(descriptors).some((descriptor) => !("value" in descriptor) || !descriptor.enumerable)) {
    throw new TypeError(`${label} is invalid`);
  }
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const [key, descriptor] of Object.entries(descriptors)) result[key] = descriptor.value;
  return result;
}

function exactRecord(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  const record = ordinaryRecord(value, label);
  if (Object.keys(record).sort().join("\0") !== [...keys].sort().join("\0")) {
    throw new TypeError(`${label} is invalid`);
  }
  return record;
}

function parseJsonLine(text: string, label: string): Record<string, unknown> {
  return ordinaryRecord(JSON.parse(requireJsonLine(text, label)) as unknown, label);
}

function requireJsonLine(text: string, label: string): string {
  if (!text.endsWith("\n") || text.slice(0, -1).includes("\n")) throw new Error(`${label} is invalid`);
  return text.slice(0, -1);
}

function incompleteJsonLine(text: string): boolean {
  if (text.endsWith("\n") && !text.slice(0, -1).includes("\n")) {
    try { JSON.parse(text.slice(0, -1)); return false; } catch { return true; }
  }
  try { JSON.parse(text); return false; } catch { return true; }
}

async function* readJsonLines(stream: NodeJS.ReadableStream): AsyncIterable<unknown> {
  let buffer = "";
  for await (const chunk of stream) {
    buffer += String(chunk);
    if (Buffer.byteLength(buffer) > CONTROL_BYTES) throw new Error("rootless supervisor control overflow");
    let newline = buffer.indexOf("\n");
    while (newline !== -1) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (line !== "") yield JSON.parse(line) as unknown;
      newline = buffer.indexOf("\n");
    }
  }
  if (buffer !== "") throw new Error("rootless supervisor control ended mid-message");
}

function requireSupervisorMessage<T extends SupervisorMessage["type"]>(
  value: unknown,
  type: T,
): Extract<SupervisorMessage, { readonly type: T }> {
  const message = value as SupervisorMessage;
  if (message === null || typeof message !== "object" || message.type !== type) {
    throw new Error(`expected rootless supervisor ${type} message`);
  }
  return message as Extract<SupervisorMessage, { readonly type: T }>;
}

async function nextMessage(
  iterator: AsyncIterator<unknown>,
  closed: Promise<{ readonly code: number | null; readonly signal: string | null }>,
): Promise<unknown> {
  return await Promise.race([
    iterator.next().then((next) => {
      if (next.done) throw new Error("rootless supervisor control closed");
      return next.value;
    }),
    closed.then((exit) => {
      throw new Error(`rootless supervisor exited before completing (${exit.code ?? exit.signal})`);
    }),
  ]);
}

async function waitForTerminal(
  iterator: AsyncIterator<unknown>,
  closed: Promise<{ readonly code: number | null; readonly signal: string | null }>,
): Promise<SupervisorTerminal> {
  for (;;) {
    const value = await nextMessage(iterator, closed);
    if (dataType(value) === "terminal") return normalizeFinal(value) as SupervisorTerminal;
  }
}

function dataType(value: unknown): unknown {
  return value !== null && typeof value === "object" && !Array.isArray(value) && "type" in value
    ? value.type
    : undefined;
}

function writeControl(socket: Socket, value: unknown): void {
  if (!socket.write(`${JSON.stringify(value)}\n`)) {
    throw new Error("rootless supervisor control backpressure is unsupported during admission");
  }
}

function writeControlBestEffort(socket: Socket | undefined, value: unknown): void {
  try { socket?.write(`${JSON.stringify(value)}\n`); } catch { /* owner detects channel loss */ }
}

async function listen(server: Server, path: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(path, () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function acceptOne(server: Server, timeoutMs: number): Promise<Socket> {
  return withTimeout(new Promise<Socket>((resolve, reject) => {
    server.once("connection", resolve);
    server.once("error", reject);
  }), timeoutMs, "rootless supervisor connection");
}

function requirePipedChild(child: ReturnType<typeof spawn>): ChildProcessWithoutNullStreams {
  if (child.stdin === null || child.stdout === null || child.stderr === null) {
    throw new Error("rootless supervisor pipes are unavailable");
  }
  return child as ChildProcessWithoutNullStreams;
}

function childClose(child: ChildProcessWithoutNullStreams) {
  return new Promise<{ readonly code: number | null; readonly signal: string | null }>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
}

function childCloseIfNeeded(child: ChildProcessWithoutNullStreams) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  }
  return childClose(child);
}

async function writeBytes(stream: NodeJS.WritableStream, bytes: Uint8Array): Promise<void> {
  if (stream.write(bytes)) return;
  await new Promise<void>((resolve, reject) => {
    stream.once("drain", resolve);
    stream.once("error", reject);
  });
}

async function* streamBytes(stream: NodeJS.ReadableStream): AsyncGenerator<Uint8Array> {
  for await (const chunk of stream) yield new Uint8Array(Buffer.from(chunk));
}

function withTimeout<T>(promise: Promise<T>, milliseconds: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out`)), milliseconds);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

async function writeExactFile(path: string, text: string): Promise<void> {
  const file = await open(path, "wx", 0o600);
  try {
    await file.writeFile(text, "utf8");
    await file.sync();
  } finally {
    await file.close();
  }
}

async function syncDirectory(path: string): Promise<void> {
  const file = await open(path, "r");
  try { await file.sync(); } finally { await file.close(); }
}

function requirePrivateDirectory(information: Awaited<ReturnType<typeof lstat>>, label: string): void {
  if (!information.isDirectory() || information.isSymbolicLink() || (Number(information.mode) & 0o077) !== 0) {
    throw new Error(`${label} must be a private ordinary directory`);
  }
}

function requireExecutable(information: Awaited<ReturnType<typeof lstat>>, label: string): void {
  requireRegularFile(information, label);
  if ((Number(information.mode) & 0o111) === 0 || (Number(information.mode) & 0o6000) !== 0) {
    throw new Error(`${label} is not an ordinary executable`);
  }
}

function requireRegularFile(information: Awaited<ReturnType<typeof lstat>>, label: string): void {
  if (!information.isFile() || information.isSymbolicLink()) throw new Error(`${label} is not an ordinary file`);
}

function requireAbsolute(value: string, label: string): string {
  if (typeof value !== "string" || !canonicalAbsolute(value)) throw new TypeError(`${label} must be canonical absolute`);
  return value;
}

function canonicalAbsolute(value: string): boolean {
  return value.startsWith("/") && !value.includes("\0") && posix.normalize(value) === value;
}

function canonicalCgroup(value: string): boolean {
  return value.startsWith("/sys/fs/cgroup/") && canonicalAbsolute(value);
}

function protectedDestination(value: string): boolean {
  return value === "/" || ["/dev", "/jig", "/proc", "/run", "/sys", "/tmp", "/work"]
    .some((root) => value === root || value.startsWith(`${root}/`));
}

function protectedHostSource(value: string): boolean {
  return value === "/" || ["/dev", "/proc", "/run", "/sys"]
    .some((root) => value === root || value.startsWith(`${root}/`));
}

/** Pure policy seam for the one trusted resolver-file projection. */
export function privateLinuxResolverProjection(
  requestedSource: string,
  resolvedSource: string,
  destination: string,
): boolean {
  if (requestedSource !== "/etc/resolv.conf" || destination !== "/etc/resolv.conf" ||
      !resolvedSource.startsWith("/run/")) return false;
  const name = posix.basename(resolvedSource);
  return name === "resolv.conf" || name === "stub-resolv.conf";
}

function protectedFilesystem(type: bigint): boolean {
  return type === CGROUP2_SUPER_MAGIC || type === DEVPTS_SUPER_MAGIC || type === PROC_SUPER_MAGIC ||
    type === SYSFS_SUPER_MAGIC;
}

function positiveInteger(value: number, label: string): number {
  if (!safePositiveInteger(value)) throw new TypeError(`${label} must be a positive safe integer`);
  return value;
}

function nonnegativeInteger(value: number, label: string): number {
  if (!safeNonnegativeInteger(value)) throw new TypeError(`${label} must be a nonnegative safe integer`);
  return value;
}

function safePositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function safeNonnegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function positiveIntegerText(value: string): boolean {
  return /^[1-9][0-9]*$/.test(value);
}

function nonnegativeIntegerText(value: string): boolean {
  return /^(?:0|[1-9][0-9]*)$/.test(value);
}

async function pathExists(path: string): Promise<boolean> {
  try { await lstat(path); return true; }
  catch (error) { if (hasCode(error, "ENOENT")) return false; throw error; }
}

function ignoreMissing(error: unknown): void {
  if (!hasCode(error, "ENOENT")) throw error;
}

function hasCode(error: unknown, code: string): boolean {
  return error !== null && typeof error === "object" && (error as NodeJS.ErrnoException).code === code;
}

function asFenceUnconfirmed(error: unknown): PrivateLinuxFenceUnconfirmedError {
  return error instanceof PrivateLinuxFenceUnconfirmedError ? error : new PrivateLinuxFenceUnconfirmedError(error);
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
