import { randomBytes } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir, readFile, realpath, rm, stat, statfs } from "node:fs/promises";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { privateDomainDigest, privateFileDigest } from "./identity.js";
import type { JsonValue } from "../json.js";
import type { ExactComponentExit, ExactComponentProcess } from "../run/session.js";

const RUN_ID = /^[a-z0-9][a-z0-9-]{0,47}$/;
const ENVIRONMENT_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const CONTROL_BYTES = 64 * 1024;
const HELPER_BUN_POLICY = Object.freeze([
  "--no-env-file",
  "--no-install",
  "--config=/dev/null",
] as const);
const EMPTY_ROOT_ENVIRONMENT = 'cd -- / && exec -c -- "$@"';
const authenticMechanismObservations = new WeakSet<object>();
const authenticBackends = new WeakSet<object>();

export interface PrivateLinuxCgroupLimits {
  readonly memoryBytes: number;
  readonly pids: number;
  readonly cpuQuotaMicros: number;
  readonly cpuPeriodMicros: number;
  readonly wallClockMs: number;
  readonly cleanupTimeoutMs?: number;
}

export interface PrivateLinuxReadOnlyMount {
  readonly source: string;
  readonly destination: string;
}

export interface PrivateLinuxLaunchPlan {
  readonly runId: string;
  readonly limits: PrivateLinuxCgroupLimits;
  readonly readOnlyMounts: readonly PrivateLinuxReadOnlyMount[];
  readonly command: readonly [string, ...string[]];
  readonly environment?: Readonly<Record<string, string>>;
  /** Backend-owned runtime predicate; never package-selected. */
  readonly rootProcessMappings?: boolean;
  /** Backend-owned runtime predicate; never package-selected. */
  readonly entropyDevice?: boolean;
  /** Backend-owned pin checked again immediately before helper spawn. */
  readonly expectedMechanismDigest?: string;
  /** Backend-owned exact helper override; never package-selected. */
  readonly trustedHelperPath?: string;
}

export interface PrivateLinuxCgroupBackendOptions {
  readonly cgroupScope: string;
  readonly sudoPath: string;
  readonly bunPath: string;
  readonly bubblewrapPath: string;
  readonly bashPath: string;
  readonly payloadUid: number;
  readonly payloadGid: number;
  readonly helperPath?: string;
  readonly startupTimeoutMs?: number;
}

export interface PrivateLinuxEnvelopeIdentity {
  readonly kind: "linux-cgroup-v2-bubblewrap/1";
  readonly trustedHelperPath: string;
  readonly trustedHelperDigest: string;
  readonly trustedBubblewrapPath: string;
  readonly trustedBubblewrapDigest: string;
  readonly trustedCoordinatorBunPath: string;
  readonly trustedCoordinatorBunDigest: string;
  readonly trustedLauncherPath: string;
  readonly trustedLauncherDigest: string;
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
  readonly rootProcessMappings: boolean;
  readonly entropyDevice: boolean;
}

export interface PrivateLinuxBackendMechanismObservation {
  readonly kind: "linux-cgroup-v2-bubblewrap-mechanism/1";
  readonly digest: string;
  readonly cgroupScope: string;
  readonly trustedHelperPath: string;
  readonly trustedHelperDigest: string;
  readonly trustedBubblewrapPath: string;
  readonly trustedBubblewrapDigest: string;
  readonly trustedCoordinatorBunPath: string;
  readonly trustedCoordinatorBunDigest: string;
  readonly trustedLauncherPath: string;
  readonly trustedLauncherDigest: string;
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

type HelperMessage = HelperReady | HelperTerminal | {
  readonly type: "error";
  readonly message: string;
};

type NormalizedBackendOptions = Required<
  Omit<PrivateLinuxCgroupBackendOptions, "helperPath">
> & {
  readonly helperPath: string;
};

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
      startupTimeoutMs: options.startupTimeoutMs ?? 10_000,
    });
    validateOptions(this.options);
    authenticBackends.add(this);
    Object.freeze(this);
  }

  /** Observe the exact trusted mechanism selected by this private backend. */
  async observeMechanism(): Promise<PrivateLinuxBackendMechanismObservation> {
    requirePrivateLinuxCgroupBackend(this);
    return observeBackendMechanism(this.options, this.options.helperPath);
  }

  async launch(
    plan: PrivateLinuxLaunchPlan,
    signal?: AbortSignal,
  ): Promise<ExactComponentProcess & {
    readonly cgroup: Readonly<Pick<HelperReady, "parentCgroup" | "runCgroup" | "payloadPid">>;
    readonly evidence: Promise<HelperTerminal["evidence"]>;
    readonly terminationReason: Promise<HelperTerminal["reason"]>;
    readonly envelope: PrivateLinuxEnvelopeIdentity;
  }> {
    requirePrivateLinuxCgroupBackend(this);
    validatePlan(plan);
    const sealedPlan = await sealMountSources(plan);
    const mechanism = await observeBackendMechanism(
      this.options,
      plan.trustedHelperPath ?? this.options.helperPath,
    );
    if (plan.expectedMechanismDigest !== undefined &&
        plan.expectedMechanismDigest !== mechanism.digest) {
      throw new Error("pinned Linux Backend mechanism observation changed");
    }
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
    const parentName = `jig-run-${plan.runId}-${nonce}`;
    const controlDirectory = join(tmpdir(), `jig-cgroup-control-${nonce}`);
    const controlPath = join(controlDirectory, "control.sock");
    const control = createServer();

    let child: ChildProcessWithoutNullStreams | undefined;
    let helperClose: Promise<{ code: number | null; signal: string | null }> | undefined;
    let terminalReceipt: Promise<HelperTerminal> | undefined;
    let socket: Socket | undefined;
    let admissionSent = false;
    let detachPersistentAbort: (() => void) | undefined;
    try {
      await mkdir(controlDirectory, { recursive: false, mode: 0o700 });
      await listen(control, controlPath);
      const accepted = acceptOne(control, this.options.startupTimeoutMs, (acceptedSocket) => {
        socket = acceptedSocket;
      });
      child = spawn(
        mechanism.trustedLauncherPath,
        [
          "-n",
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
          mechanism.trustedHelperPath,
          "--control", controlPath,
          "--scope", mechanism.cgroupScope,
          "--parent", parentName,
          "--memory", String(plan.limits.memoryBytes),
          "--pids", String(plan.limits.pids),
          "--cpu-quota", String(plan.limits.cpuQuotaMicros),
          "--cpu-period", String(plan.limits.cpuPeriodMicros),
          "--wall-ms", String(plan.limits.wallClockMs),
          "--cleanup-ms", String(plan.limits.cleanupTimeoutMs ?? 5_000),
          "--uid", String(this.options.payloadUid),
          "--gid", String(this.options.payloadGid),
          "--bubblewrap", mechanism.trustedBubblewrapPath,
          "--bash", mechanism.trustedBashPath,
          "--",
          ...bubblewrapArguments(sealedPlan, this.options.payloadUid, this.options.payloadGid),
        ],
        { cwd: "/", env: {}, stdio: ["pipe", "pipe", "pipe"] },
      );
      helperClose = childClose(child);
      const connectedSocket = await Promise.race([
        accepted,
        helperClose.then(({ code, signal: exitSignal }) => {
          throw new Error(`trusted cgroup helper exited before connecting (${code ?? exitSignal})`);
        }),
      ]);
      socket = connectedSocket;
      const messages = readMessages(connectedSocket);
      const terminal = deferred<HelperTerminal>();
      terminalReceipt = terminal.promise;
      const ready = deferred<HelperReady>();
      const messageTask = consumeMessages(messages, ready, terminal);
      // Stop admission immediately, but do not await Server.close(): its
      // callback waits for the already accepted control connection to end.
      control.close();
      await rm(controlPath, { force: true });
      await rm(controlDirectory, { recursive: true, force: true });
      const close = helperClose;
      close.then(async ({ code, signal: exitSignal }) => {
        await messageTask.catch(() => undefined);
        ready.reject(new Error(`trusted cgroup helper exited before readiness (${code ?? exitSignal})`));
        terminal.reject(new Error(`trusted cgroup helper exited without a terminal receipt (${code ?? exitSignal})`));
      }).catch((error) => {
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

      // No await occurs between the abort check and this write. Once it may
      // have reached the helper, teardown requires a terminal fence receipt.
      admissionSent = true;
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

      const process = child;
      const controlSocket = connectedSocket;
      let inputClosed = false;
      let terminationStarted = false;
      const completion = (async (): Promise<ExactComponentExit> => {
        try {
          const receipt = await terminal.promise;
          await close;
          return Object.freeze({
            exitCode: receipt.exitCode,
            signal: receipt.signal,
            fenced: receipt.fenced,
            ...(receipt.cleanupError === undefined ? {} : { cleanupError: receipt.cleanupError }),
          });
        } finally {
          detachPersistentAbort?.();
          detachPersistentAbort = undefined;
          controlSocket.destroy();
        }
      })();
      const evidence = terminal.promise.then((receipt) => receipt.evidence);
      const terminationReason = terminal.promise.then((receipt) => receipt.reason);
      // Preserve rejection for explicit awaiters while preventing unobserved
      // projection promises from becoming fatal during an ownership failure.
      void evidence.catch(() => undefined);
      void terminationReason.catch(() => undefined);

      return Object.freeze({
        envelope: Object.freeze({
          kind: "linux-cgroup-v2-bubblewrap/1" as const,
          trustedHelperPath: mechanism.trustedHelperPath,
          trustedHelperDigest: mechanism.trustedHelperDigest,
          trustedBubblewrapPath: mechanism.trustedBubblewrapPath,
          trustedBubblewrapDigest: mechanism.trustedBubblewrapDigest,
          trustedCoordinatorBunPath: mechanism.trustedCoordinatorBunPath,
          trustedCoordinatorBunDigest: mechanism.trustedCoordinatorBunDigest,
          trustedLauncherPath: mechanism.trustedLauncherPath,
          trustedLauncherDigest: mechanism.trustedLauncherDigest,
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
          rootProcessMappings: sealedPlan.rootProcessMappings === true,
          entropyDevice: sealedPlan.entropyDevice === true,
        }),
        cgroup: Object.freeze({
          parentCgroup: readyReceipt.parentCgroup,
          runCgroup: readyReceipt.runCgroup,
          payloadPid: readyReceipt.payloadPid,
        }),
        stdout: process.stdout,
        stderr: process.stderr,
        completion,
        evidence,
        terminationReason,
        write(bytes: Uint8Array): Promise<void> {
          if (inputClosed) return Promise.reject(new Error("component input is closed"));
          return writeStream(process.stdin, bytes);
        },
        closeInput(): Promise<void> {
          if (inputClosed) return Promise.resolve();
          inputClosed = true;
          return endStream(process.stdin);
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
      let fencingConfirmed = !admissionSent;
      if (socket !== undefined) {
        writeControl(socket, { type: "cancel" });
        if (admissionSent && helperClose !== undefined && terminalReceipt !== undefined) {
          try {
            const receipt = await withTimeout(
              terminalReceipt,
              (plan.limits.cleanupTimeoutMs ?? 5_000) + this.options.startupTimeoutMs,
              "cgroup helper failed-launch fencing receipt",
            );
            await withTimeout(
              helperClose,
              this.options.startupTimeoutMs,
              "cgroup helper failed-launch exit",
            );
            if (!receipt.fenced || receipt.cleanupError !== undefined) {
              cleanupFailures.push(new Error(
                `failed launch was not fenced: ${receipt.cleanupError ?? "missing fenced receipt"}`,
              ));
            } else {
              fencingConfirmed = true;
            }
          } catch (cleanupError) {
            cleanupFailures.push(cleanupError);
          }
        } else if (helperClose !== undefined) {
          socket.destroy();
          try {
            await withTimeout(helperClose, this.options.startupTimeoutMs, "unadmitted helper cleanup");
          } catch (cleanupError) {
            cleanupFailures.push(cleanupError);
          }
        } else if (admissionSent) {
          cleanupFailures.push(new Error("admitted helper had no terminal receipt owner"));
        }
        socket.destroy();
      } else if (child !== undefined) {
        // The helper connects before creating any cgroup. Prior to that
        // handshake it owns no host resource, so terminating it is safe.
        child.kill("SIGTERM");
        if (helperClose !== undefined) {
          try {
            await withTimeout(helperClose, this.options.startupTimeoutMs, "pre-handshake helper cleanup");
          } catch {
            child.kill("SIGKILL");
            try {
              await withTimeout(helperClose, this.options.startupTimeoutMs, "pre-handshake helper kill");
            } catch {
              // The missing terminal receipt below is the authoritative
              // cleanup failure; helper exit alone cannot prove fencing.
            }
            cleanupFailures.push(new Error(
              "pre-handshake helper required SIGKILL without a terminal fencing receipt",
            ));
          }
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

export function requirePrivateLinuxBackendMechanismObservation(
  value: unknown,
): PrivateLinuxBackendMechanismObservation {
  if (value === null || typeof value !== "object" || !authenticMechanismObservations.has(value)) {
    throw new TypeError("Linux Backend mechanism was not produced by the private observer");
  }
  return value as PrivateLinuxBackendMechanismObservation;
}

async function observeBackendMechanism(
  options: NormalizedBackendOptions,
  helperPath: string,
): Promise<PrivateLinuxBackendMechanismObservation> {
  const [cgroupScope, trustedHelperPath, trustedBubblewrapPath,
    trustedCoordinatorBunPath, trustedLauncherPath, trustedBashPath, trustedBackendPath] = await Promise.all([
    realpath(options.cgroupScope),
    realpath(helperPath),
    realpath(options.bubblewrapPath),
    realpath(options.bunPath),
    realpath(options.sudoPath),
    realpath(options.bashPath),
    realpath(fileURLToPath(import.meta.url)),
  ]);
  const [trustedHelperDigest, trustedBubblewrapDigest, trustedCoordinatorBunDigest,
    trustedLauncherDigest, trustedBashDigest, trustedBackendDigest] = await Promise.all([
    privateFileDigest(trustedHelperPath),
    privateFileDigest(trustedBubblewrapPath),
    privateFileDigest(trustedCoordinatorBunPath),
    privateFileDigest(trustedLauncherPath),
    privateFileDigest(trustedBashPath),
    privateFileDigest(trustedBackendPath),
  ]);
  const [filesystem, scopeInformation, controllersText, processes] = await Promise.all([
    statfs(cgroupScope),
    stat(cgroupScope, { bigint: true }),
    readFile(join(cgroupScope, "cgroup.controllers"), "utf8"),
    readFile(join(cgroupScope, "cgroup.procs"), "utf8"),
  ]);
  if (filesystem.type !== 0x63677270) throw new Error("Linux Backend requires cgroup v2");
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
    trustedBubblewrapPath,
    trustedBubblewrapDigest,
    trustedCoordinatorBunPath,
    trustedCoordinatorBunDigest,
    trustedLauncherPath,
    trustedLauncherDigest,
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
  authenticMechanismObservations.add(observation);
  return observation;
}

async function sealMountSources(plan: PrivateLinuxLaunchPlan): Promise<PrivateLinuxLaunchPlan> {
  const mounts: PrivateLinuxReadOnlyMount[] = [];
  for (const mount of plan.readOnlyMounts) {
    const source = await realpath(mount.source);
    if (source === "/sys/fs/cgroup" || source.startsWith("/sys/fs/cgroup/")) {
      throw new TypeError("host cgroupfs cannot enter the sandbox through an alias");
    }
    mounts.push(Object.freeze({ source, destination: resolve(mount.destination) }));
  }
  return Object.freeze({ ...plan, readOnlyMounts: Object.freeze(mounts) });
}

function bubblewrapArguments(
  plan: PrivateLinuxLaunchPlan,
  uid: number,
  gid: number,
): string[] {
  const result = [
    "--unshare-all",
    "--as-pid-1",
    "--die-with-parent",
    "--new-session",
    "--clearenv",
    "--dir", "/proc",
    "--dir", "/dev",
    "--tmpfs", "/tmp",
    "--tmpfs", "/run",
    "--dir", "/work",
    "--chdir", "/work",
  ];
  if (plan.rootProcessMappings === true) {
    result.push("--dir", "/proc/self", "--ro-bind", "/proc/self/maps", "/proc/self/maps");
  }
  if (plan.entropyDevice === true) {
    result.push("--dev-bind", "/dev/urandom", "/dev/urandom");
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
    bunPath: options.bunPath,
    bubblewrapPath: options.bubblewrapPath,
    helperPath: options.helperPath,
    bashPath: options.bashPath,
  })) {
    if (!path.startsWith("/") || path.includes("\0")) throw new TypeError(`${name} must be an absolute path`);
  }
  if (!resolve(options.cgroupScope).startsWith("/sys/fs/cgroup/")) {
    throw new TypeError("cgroupScope must be beneath /sys/fs/cgroup");
  }
  positiveInteger(options.payloadUid, "payloadUid", true);
  positiveInteger(options.payloadGid, "payloadGid", true);
  positiveInteger(options.startupTimeoutMs, "startupTimeoutMs");
}

function validatePlan(plan: PrivateLinuxLaunchPlan): void {
  if (!RUN_ID.test(plan.runId)) throw new TypeError("runId must be a lower-kebab identifier");
  positiveInteger(plan.limits.memoryBytes, "memoryBytes");
  positiveInteger(plan.limits.pids, "pids");
  positiveInteger(plan.limits.cpuQuotaMicros, "cpuQuotaMicros");
  positiveInteger(plan.limits.cpuPeriodMicros, "cpuPeriodMicros");
  positiveInteger(plan.limits.wallClockMs, "wallClockMs");
  positiveInteger(plan.limits.cleanupTimeoutMs ?? 5_000, "cleanupTimeoutMs");
  if (plan.limits.cpuQuotaMicros > plan.limits.cpuPeriodMicros * 1_000) {
    throw new RangeError("cpuQuotaMicros is outside the supported closed range");
  }
  if (plan.command.length === 0 || !plan.command[0].startsWith("/")) {
    throw new TypeError("sandbox command must use an absolute path");
  }
  if (plan.trustedHelperPath !== undefined && !plan.trustedHelperPath.startsWith("/")) {
    throw new TypeError("trustedHelperPath must be absolute");
  }
  if (plan.expectedMechanismDigest !== undefined &&
      !/^sha256:[0-9a-f]{64}$/.test(plan.expectedMechanismDigest)) {
    throw new TypeError("expectedMechanismDigest must be a canonical SHA-256 digest");
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
  ready: Deferred<HelperReady>,
  terminal: Deferred<HelperTerminal>,
): Promise<void> {
  try {
    for await (const message of messages) {
      if (message.type === "ready") ready.resolve(message);
      if (message.type === "terminal") {
        terminal.resolve(message);
        ready.reject(new Error(message.setupError ?? "trusted cgroup helper terminated before readiness"));
      }
      if (message.type === "error") {
        const error = new Error(message.message);
        ready.reject(error);
        terminal.reject(error);
      }
    }
  } catch (error) {
    ready.reject(error);
    terminal.reject(error);
  }
}

function parseHelperMessage(value: unknown): HelperMessage {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("invalid cgroup helper message");
  }
  const message = value as Record<string, unknown>;
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
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("invalid cgroup helper evidence");
  }
  const record = value as Record<string, unknown>;
  if (!exactStringKeys(record, ["cpuStat", "memoryEvents", "pidsEvents"])) {
    throw new Error("invalid cgroup helper evidence");
  }
  return Object.freeze({
    cpuStat: normalizeCounters(record.cpuStat),
    memoryEvents: normalizeCounters(record.memoryEvents),
    pidsEvents: normalizeCounters(record.pidsEvents),
  });
}

function normalizeCounters(value: unknown): Readonly<Record<string, number>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("invalid cgroup helper counters");
  }
  const entries = Object.entries(value);
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
