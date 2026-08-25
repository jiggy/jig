import { randomBytes } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir, realpath, rm } from "node:fs/promises";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { ExactComponentExit, ExactComponentProcess } from "../run/session.js";

const RUN_ID = /^[a-z0-9][a-z0-9-]{0,47}$/;
const ENVIRONMENT_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const CONTROL_BYTES = 64 * 1024;

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
}

export interface PrivateLinuxCgroupBackendOptions {
  readonly cgroupScope: string;
  readonly sudoPath: string;
  readonly bunPath: string;
  readonly bubblewrapPath: string;
  readonly payloadUid: number;
  readonly payloadGid: number;
  readonly helperPath?: string;
  readonly startupTimeoutMs?: number;
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

/**
 * Linux-only Phase 2 proof backend. It is deliberately package-private and
 * does not establish the future public Sandbox Backend interface.
 */
export class PrivateLinuxCgroupBackend {
  private readonly options: Required<Omit<PrivateLinuxCgroupBackendOptions, "helperPath">> & {
    readonly helperPath: string;
  };

  constructor(options: PrivateLinuxCgroupBackendOptions) {
    const sourcePath = fileURLToPath(import.meta.url);
    const helperExtension = extname(sourcePath);
    this.options = Object.freeze({
      ...options,
      helperPath: options.helperPath ?? join(dirname(sourcePath), `linux-cgroup-helper${helperExtension}`),
      startupTimeoutMs: options.startupTimeoutMs ?? 10_000,
    });
    validateOptions(this.options);
  }

  async launch(
    plan: PrivateLinuxLaunchPlan,
    signal?: AbortSignal,
  ): Promise<ExactComponentProcess & {
    readonly cgroup: Readonly<Pick<HelperReady, "parentCgroup" | "runCgroup" | "payloadPid">>;
    readonly evidence: Promise<HelperTerminal["evidence"]>;
  }> {
    validatePlan(plan);
    const sealedPlan = await sealMountSources(plan);
    const nonce = randomBytes(12).toString("hex");
    const parentName = `jig-run-${plan.runId}-${nonce}`;
    const controlDirectory = join(tmpdir(), `jig-cgroup-control-${nonce}`);
    await mkdir(controlDirectory, { recursive: false, mode: 0o700 });
    const controlPath = join(controlDirectory, "control.sock");
    const control = await listen(controlPath);

    let child: ChildProcessWithoutNullStreams | undefined;
    let helperClose: Promise<{ code: number | null; signal: string | null }> | undefined;
    let socket: Socket | undefined;
    try {
      const accepted = acceptOne(control, this.options.startupTimeoutMs);
      child = spawn(
        this.options.sudoPath,
        [
          "-n",
          this.options.bunPath,
          this.options.helperPath,
          "--control", controlPath,
          "--scope", this.options.cgroupScope,
          "--parent", parentName,
          "--memory", String(plan.limits.memoryBytes),
          "--pids", String(plan.limits.pids),
          "--cpu-quota", String(plan.limits.cpuQuotaMicros),
          "--cpu-period", String(plan.limits.cpuPeriodMicros),
          "--wall-ms", String(plan.limits.wallClockMs),
          "--cleanup-ms", String(plan.limits.cleanupTimeoutMs ?? 5_000),
          "--uid", String(this.options.payloadUid),
          "--gid", String(this.options.payloadGid),
          "--bubblewrap", this.options.bubblewrapPath,
          "--",
          ...bubblewrapArguments(sealedPlan, this.options.payloadUid, this.options.payloadGid),
        ],
        { stdio: ["pipe", "pipe", "pipe"] },
      );
      helperClose = childClose(child);
      socket = await accepted;
      const connectedSocket = socket;
      // Stop admission immediately, but do not await Server.close(): its
      // callback waits for the already accepted control connection to end.
      control.close();
      await rm(controlPath, { force: true });
      await rm(controlDirectory, { recursive: true, force: true });

      const messages = readMessages(connectedSocket);
      const terminal = deferred<HelperTerminal>();
      const ready = deferred<HelperReady>();
      const messageTask = consumeMessages(messages, ready, terminal);
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
      if (signal?.aborted) {
        writeControl(connectedSocket, { type: "cancel" });
        aborted.reject(new Error("cgroup launch was cancelled during startup"));
      }
      const abort = (): void => writeControl(connectedSocket, { type: "cancel" });
      const abortStartup = (): void => aborted.reject(new Error("cgroup launch was cancelled during startup"));
      signal?.addEventListener("abort", abort, { once: true });
      signal?.addEventListener("abort", abortStartup, { once: true });

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
          signal?.removeEventListener("abort", abort);
          controlSocket.destroy();
        }
      })();

      return Object.freeze({
        cgroup: Object.freeze({
          parentCgroup: readyReceipt.parentCgroup,
          runCgroup: readyReceipt.runCgroup,
          payloadPid: readyReceipt.payloadPid,
        }),
        stdout: process.stdout,
        stderr: process.stderr,
        completion,
        evidence: terminal.promise.then((receipt) => receipt.evidence),
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
      let cleanupFailure: unknown;
      if (socket !== undefined) {
        writeControl(socket, { type: "cancel" });
        if (helperClose !== undefined) {
          try {
            await withTimeout(
              helperClose,
              (plan.limits.cleanupTimeoutMs ?? 5_000) + this.options.startupTimeoutMs,
              "cgroup helper failed-launch cleanup",
            );
          } catch (cleanupError) {
            cleanupFailure = cleanupError;
          }
        }
        socket.destroy();
      } else if (child !== undefined) {
        // The helper connects before creating any cgroup. Prior to that
        // handshake it owns no host resource, so terminating it is safe.
        child.kill("SIGTERM");
      }
      await closeServer(control).catch(() => undefined);
      await rm(controlDirectory, { recursive: true, force: true }).catch(() => undefined);
      if (cleanupFailure !== undefined) {
        throw new AggregateError([error, cleanupFailure], "cgroup launch failed and cleanup was not confirmed");
      }
      throw error;
    }
  }
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

function validateOptions(options: Required<Omit<PrivateLinuxCgroupBackendOptions, "helperPath">> & {
  readonly helperPath: string;
}): void {
  for (const [name, path] of Object.entries({
    cgroupScope: options.cgroupScope,
    sudoPath: options.sudoPath,
    bunPath: options.bunPath,
    bubblewrapPath: options.bubblewrapPath,
    helperPath: options.helperPath,
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
    if (destinations.has(destination)) throw new TypeError(`duplicate mount destination ${destination}`);
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

async function listen(path: string): Promise<Server> {
  const server = createServer();
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(path, () => {
      server.off("error", reject);
      resolveListen();
    });
  });
  return server;
}

function acceptOne(server: Server, timeoutMs: number): Promise<Socket> {
  return withTimeout(new Promise<Socket>((resolveSocket, reject) => {
    server.once("connection", resolveSocket);
    server.once("error", reject);
  }), timeoutMs, "trusted cgroup helper connection");
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
      if (message.type === "terminal") terminal.resolve(message);
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
    typeof message.runCgroup === "string" && typeof message.payloadPid === "number") {
    return message as unknown as HelperReady;
  }
  if (message.type === "terminal" && (typeof message.exitCode === "number" || message.exitCode === null) &&
    (typeof message.signal === "string" || message.signal === null) && typeof message.reason === "string" &&
    typeof message.fenced === "boolean" && typeof message.evidence === "object" && message.evidence !== null) {
    return message as unknown as HelperTerminal;
  }
  if (message.type === "error" && typeof message.message === "string") {
    return { type: "error", message: message.message };
  }
  throw new Error("invalid cgroup helper message");
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
