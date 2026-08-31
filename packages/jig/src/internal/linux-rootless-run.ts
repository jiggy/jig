import { randomBytes } from "node:crypto";
import { spawn, type ChildProcess, type ChildProcessWithoutNullStreams } from "node:child_process";
import {
  closeSync,
  readFileSync,
  statSync,
  writeSync,
} from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  rmdir,
  stat,
  writeFile,
} from "node:fs/promises";
import { connect, createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { posix } from "node:path";
import { fileURLToPath } from "node:url";
import type { Readable } from "node:stream";

import type { ExactComponentExit, ExactComponentProcess } from "../run/session.js";

const RUN_ID = /^[a-z0-9][a-z0-9-]{0,47}$/;
const POLICY = Object.freeze(["--no-env-file", "--no-install", "--config=/dev/null"] as const);
const MAX_CONTROL_BYTES = 64 * 1024;
const REQUIRED_CONTROLLERS = Object.freeze(["cpu", "memory", "pids"] as const);
const MODULE_DESTINATION = "/jig/linux-rootless-run.ts";

export interface PrivateRootlessLinuxLimits {
  readonly memoryBytes: number;
  readonly pids: number;
  readonly cpuQuotaMicros: number;
  readonly cpuPeriodMicros: number;
  readonly deadlineUnixMs: number;
  readonly cleanupTimeoutMs?: number;
}

export interface PrivateRootlessLinuxMount {
  readonly source: string;
  readonly destination: string;
}

export interface PrivateRootlessLinuxPlan {
  readonly runId: string;
  readonly limits: PrivateRootlessLinuxLimits;
  readonly readOnlyMounts: readonly PrivateRootlessLinuxMount[];
  readonly command: readonly [string, ...string[]];
  readonly environment?: Readonly<Record<string, string>>;
}

export interface PrivateRootlessLinuxOptions {
  readonly delegatedCgroup: string;
  readonly bunPath: string;
  readonly bubblewrapPath: string;
  readonly payloadUid: number;
  readonly payloadGid: number;
  readonly startupTimeoutMs?: number;
}

interface SupervisorConfiguration extends PrivateRootlessLinuxPlan {
  readonly cgroup: string;
  readonly bunPath: string;
  readonly bubblewrapPath: string;
  readonly payloadUid: number;
  readonly payloadGid: number;
  readonly modulePath: string;
}

interface SupervisorPrepared {
  readonly type: "prepared";
  readonly cgroup: string;
}

interface SupervisorReady {
  readonly type: "ready";
  readonly cgroup: string;
  readonly payloadPid: number;
}

interface SupervisorTerminal {
  readonly type: "terminal";
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly stopReason: "cancelled" | "coordinator_lost" | "deadline" | "payload_exit" | "setup_failed";
  readonly fenced: boolean;
  readonly cleanupError?: string;
  readonly evidence: {
    readonly cpuStat: Readonly<Record<string, number>>;
    readonly memoryEvents: Readonly<Record<string, number>>;
    readonly pidsEvents: Readonly<Record<string, number>>;
  };
}

type SupervisorMessage = SupervisorPrepared | SupervisorReady | SupervisorTerminal;
type StopReason = SupervisorTerminal["stopReason"];

export type PrivateRootlessLinuxProcess = ExactComponentProcess & {
  readonly cgroup: string;
  readonly payloadPid: number;
  readonly evidence: Promise<SupervisorTerminal["evidence"]>;
};

/** Private zero-setup proof. It is not a public Sandbox Backend interface. */
export class PrivateRootlessLinuxBackend {
  readonly #options: Required<PrivateRootlessLinuxOptions>;
  readonly #modulePath: string;

  constructor(options: PrivateRootlessLinuxOptions) {
    validateOptions(options);
    this.#options = Object.freeze({
      ...options,
      startupTimeoutMs: options.startupTimeoutMs ?? 10_000,
    });
    this.#modulePath = fileURLToPath(import.meta.url);
  }

  async preflight(): Promise<void> {
    await requireDelegatedCgroup(this.#options.delegatedCgroup);
    await requireExecutable(this.#options.bunPath, "Bun");
    await requireExecutable(this.#options.bubblewrapPath, "Bubblewrap");
  }

  async launch(
    value: PrivateRootlessLinuxPlan,
    signal?: AbortSignal,
    beforeAdmission?: () => Promise<void>,
  ): Promise<PrivateRootlessLinuxProcess> {
    await this.preflight();
    const plan = snapshotPlan(value);
    await requireMountSources(plan.readOnlyMounts);
    if (signal?.aborted) throw new Error("rootless Run was cancelled before launch");

    const cgroup = `${this.#options.delegatedCgroup}/jig-run-${plan.runId}-${randomBytes(8).toString("hex")}`;
    const configuration: SupervisorConfiguration = Object.freeze({
      ...plan,
      cgroup,
      bunPath: this.#options.bunPath,
      bubblewrapPath: this.#options.bubblewrapPath,
      payloadUid: this.#options.payloadUid,
      payloadGid: this.#options.payloadGid,
      modulePath: this.#modulePath,
    });
    const controlDirectory = await mkdtemp(`${tmpdir()}/jig-rootless-control-`);
    const controlPath = `${controlDirectory}/control.sock`;
    const server = createServer();
    await listen(server, controlPath);
    const accepted = acceptOne(server, this.#options.startupTimeoutMs);
    const child = spawn(
      this.#options.bunPath,
      [...POLICY, this.#modulePath, "--supervisor", controlPath],
      {
        cwd: "/",
        env: {},
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    const supervisor = requirePipedChild(child);
    const closed = childClose(supervisor);
    const control = await Promise.race([
      accepted,
      closed.then((exit) => {
        throw new Error(`rootless supervisor exited before connecting (${exit.code ?? exit.signal})`);
      }),
    ]);
    server.close();
    await rm(controlPath, { force: true });
    await rmdir(controlDirectory);
    const parsed = readJsonLines(control)[Symbol.asyncIterator]();
    writeJsonLine(control, { type: "start", configuration });

    const cancel = (): void => writeJsonLine(control, { type: "cancel" });
    signal?.addEventListener("abort", cancel, { once: true });
    try {
      const prepared = requireMessage(
        await withTimeout(nextMessage(parsed, closed), this.#options.startupTimeoutMs, "rootless preparation"),
        "prepared",
      );
      if (prepared.cgroup !== cgroup) throw new Error("rootless supervisor prepared an unexpected cgroup");
      if (beforeAdmission !== undefined) await beforeAdmission();
      if (signal?.aborted) throw new Error("rootless Run was cancelled before admission");
      writeJsonLine(control, { type: "admit" });
      const ready = requireMessage(
        await withTimeout(nextMessage(parsed, closed), this.#options.startupTimeoutMs, "rootless readiness"),
        "ready",
      );
      if (ready.cgroup !== cgroup) throw new Error("rootless supervisor announced an unexpected cgroup");

      let inputClosed = false;
      let terminated = false;
      const terminal = (async (): Promise<SupervisorTerminal> => {
        for (;;) {
          const message = await nextMessage(parsed, closed);
          if (message.type === "terminal") return message;
        }
      })();
      const completion = terminal.then(async (receipt): Promise<ExactComponentExit> => {
        const exit = await closed;
        if (exit.code !== 0 && receipt.fenced) {
          throw new Error(`rootless supervisor exited unexpectedly (${exit.code ?? exit.signal})`);
        }
        return Object.freeze({
          exitCode: receipt.exitCode,
          signal: receipt.signal,
          fenced: receipt.fenced,
          stopReason: receipt.stopReason,
          ...(receipt.cleanupError === undefined ? {} : { cleanupError: new Error(receipt.cleanupError) }),
        });
      }).finally(() => {
        signal?.removeEventListener("abort", cancel);
        control.destroy();
      });
      return Object.freeze({
        cgroup,
        payloadPid: ready.payloadPid,
        stdout: streamBytes(supervisor.stdout),
        stderr: streamBytes(supervisor.stderr),
        completion,
        evidence: terminal.then((receipt) => receipt.evidence),
        write: async (bytes: Uint8Array): Promise<void> => {
          if (inputClosed) throw new Error("rootless Run input is closed");
          await writeBytes(supervisor.stdin, bytes);
        },
        closeInput: async (): Promise<void> => {
          if (inputClosed) return;
          inputClosed = true;
          supervisor.stdin.end();
        },
        terminate: async (): Promise<void> => {
          if (terminated) return;
          terminated = true;
          cancel();
          await completion;
        },
      });
    } catch (error) {
      cancel();
      supervisor.stdin.end();
      control.destroy();
      await closed.catch(() => undefined);
      signal?.removeEventListener("abort", cancel);
      throw error;
    }
  }
}

async function supervisorMain(controlPath: string): Promise<void> {
  requireFixedBunPosture("supervisor");
  if (!controlPath.startsWith("/")) throw new Error("invalid rootless supervisor control path");
  const control = connect(controlPath);
  control.on("error", () => {
    // The coordinator may disappear while this supervisor still owns cleanup.
  });
  await new Promise<void>((resolve, reject) => {
    control.once("connect", resolve);
    control.once("error", reject);
  });
  const output = control;
  const iterator = readJsonLines(control)[Symbol.asyncIterator]();
  const first = await iterator.next();
  if (first.done) return;
  const configuration = requireStart(first.value);
  const { cgroup, limits } = configuration;
  let cgroupCreated = false;
  let child: ChildProcess | undefined;
  let stopReason: StopReason | undefined;
  let admitted = false;
  let resolveAdmission!: () => void;
  let rejectAdmission!: (error: Error) => void;
  const admission = new Promise<void>((resolve, reject) => {
    resolveAdmission = resolve;
    rejectAdmission = reject;
  });

  const killRun = async (): Promise<void> => {
    if (!cgroupCreated) return;
    await writeFile(`${cgroup}/cgroup.kill`, "1\n").catch(ignoreMissing);
  };
  const stop = (reason: StopReason): void => {
    if (stopReason === undefined || stopReason === "payload_exit") stopReason = reason;
    if (!admitted) rejectAdmission(new Error(`rootless launch stopped before admission: ${reason}`));
    child?.kill("SIGKILL");
    void killRun();
  };
  const controlTask = (async (): Promise<void> => {
    for (;;) {
      const next = await iterator.next();
      if (next.done) {
        stop("coordinator_lost");
        return;
      }
      const type = recordType(next.value);
      if (type === "admit" && !admitted) {
        admitted = true;
        resolveAdmission();
      } else if (type === "cancel") {
        stop("cancelled");
      } else {
        stop("cancelled");
      }
    }
  })();
  void controlTask.catch(() => stop("coordinator_lost"));
  const deadline = setTimeout(
    () => stop("deadline"),
    Math.max(0, limits.deadlineUnixMs - Date.now()),
  );

  let exitCode: number | null = null;
  let exitSignal: string | null = null;
  let cleanupError: string | undefined;
  let evidence = emptyEvidence();
  try {
    await mkdir(cgroup, { mode: 0o755 });
    cgroupCreated = true;
    await writeFile(`${cgroup}/memory.max`, `${limits.memoryBytes}\n`);
    if (await exists(`${cgroup}/memory.swap.max`)) await writeFile(`${cgroup}/memory.swap.max`, "0\n");
    await writeFile(`${cgroup}/pids.max`, `${limits.pids}\n`);
    await writeFile(`${cgroup}/cpu.max`, `${limits.cpuQuotaMicros} ${limits.cpuPeriodMicros}\n`);
    if (stopReason !== undefined) throw new Error(`rootless launch stopped during setup: ${stopReason}`);
    safeSend(output, { type: "prepared", cgroup } satisfies SupervisorPrepared);
    await admission;
    if (stopReason !== undefined) throw new Error(`rootless launch stopped before spawn: ${stopReason}`);

    const bwrapArguments = bubblewrapArguments(configuration);
    const launched = spawn(
      configuration.bunPath,
      [...POLICY, configuration.modulePath, "--enter", cgroup, configuration.bubblewrapPath, ...bwrapArguments],
      { cwd: "/", env: {}, stdio: ["inherit", "inherit", "inherit", "pipe"] },
    );
    const exitPromise = childClose(launched);
    child = launched;
    const ready = await readReady(launched);
    safeSend(output, { type: "ready", cgroup, payloadPid: ready } satisfies SupervisorReady);
    const exit = await exitPromise;
    exitCode = exit.code;
    exitSignal = exit.signal;
    stopReason ??= "payload_exit";
  } catch (error) {
    stopReason ??= "setup_failed";
    if (stopReason === "setup_failed") process.stderr.write(`${errorText(error)}\n`);
  } finally {
    clearTimeout(deadline);
    try {
      await killRun();
      if (cgroupCreated) {
        await waitUntilEmpty(cgroup, limits.cleanupTimeoutMs ?? 5_000);
        evidence = await readEvidence(cgroup);
        await rmdir(cgroup);
        cgroupCreated = false;
      }
    } catch (error) {
      cleanupError = errorText(error);
    }
    safeSend(output, {
      type: "terminal",
      exitCode,
      signal: exitSignal,
      stopReason: stopReason ?? "setup_failed",
      fenced: cleanupError === undefined && !cgroupCreated,
      ...(cleanupError === undefined ? {} : { cleanupError }),
      evidence,
    } satisfies SupervisorTerminal);
    output.end();
  }
}

async function enterMain(arguments_: readonly string[]): Promise<void> {
  requireFixedBunPosture("entry trampoline");
  if (arguments_.length < 3) throw new Error("invalid rootless entry trampoline arguments");
  const cgroup = arguments_[0]!;
  const bubblewrap = arguments_[1]!;
  const bubblewrapArguments_ = arguments_.slice(2);
  if (!cgroup.startsWith("/sys/fs/cgroup/") || !bubblewrap.startsWith("/")) {
    throw new Error("invalid rootless entry trampoline path");
  }
  await writeFile(`${cgroup}/cgroup.procs`, "0\n");
  const current = readFileSync("/proc/self/cgroup", "utf8").split("\n")
    .find((line) => line.startsWith("0::"))?.slice(3);
  if (`/sys/fs/cgroup${current ?? ""}` !== cgroup) {
    throw new Error("rootless entry trampoline did not enter the Run cgroup");
  }
  writeSync(3, `${process.pid}\n`);
  closeSync(3);
  const child = spawn(bubblewrap, bubblewrapArguments_, {
    cwd: "/",
    env: {},
    stdio: "inherit",
  });
  const exit = await childClose(child);
  if (exit.signal !== null) process.kill(process.pid, exit.signal as NodeJS.Signals);
  process.exitCode = exit.code ?? 1;
}

async function innerMain(command: readonly string[]): Promise<void> {
  if (command.length === 0 || !command[0]!.startsWith("/")) {
    throw new Error("invalid rootless inner command");
  }
  const nullDevice = statSync("/dev/null");
  const entropyDevice = statSync("/dev/urandom");
  if (!nullDevice.isCharacterDevice() || !entropyDevice.isCharacterDevice() ||
      (nullDevice.mode & 0o777) !== 0o666 || (entropyDevice.mode & 0o777) !== 0o666) {
    throw new Error("rootless private devices do not satisfy the required projection");
  }
  const executable = command[0]!;
  const child = spawn(executable, command.slice(1), {
    cwd: "/work",
    env: process.env,
    stdio: "inherit",
  });
  const exit = await childClose(child);
  if (exit.signal !== null) process.kill(process.pid, exit.signal as NodeJS.Signals);
  process.exitCode = exit.code ?? 1;
}

function bubblewrapArguments(config: SupervisorConfiguration): string[] {
  const result = [
    "--unshare-all",
    "--unshare-user",
    "--disable-userns",
    "--assert-userns-disabled",
    "--as-pid-1",
    "--die-with-parent",
    "--new-session",
    "--clearenv",
    "--proc", "/proc",
    "--remount-ro", "/proc",
    "--dev", "/dev",
    "--tmpfs", "/tmp",
    "--tmpfs", "/run",
    "--dir", "/work",
    "--dir", "/jig",
    "--chdir", "/work",
  ];
  for (const mount of config.readOnlyMounts) result.push("--ro-bind", mount.source, mount.destination);
  result.push("--ro-bind", config.modulePath, MODULE_DESTINATION);
  for (const [name, value] of Object.entries(config.environment ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
    result.push("--setenv", name, value);
  }
  result.push(
    "--uid", String(config.payloadUid),
    "--gid", String(config.payloadGid),
    "--cap-drop", "ALL",
    "--",
    config.bunPath,
    ...POLICY,
    MODULE_DESTINATION,
    "--inner",
    "--",
    ...config.command,
  );
  return result;
}

function snapshotPlan(value: PrivateRootlessLinuxPlan): PrivateRootlessLinuxPlan {
  if (!RUN_ID.test(value.runId)) throw new TypeError("invalid rootless Run ID");
  const limits = value.limits;
  for (const [name, number] of Object.entries({
    memoryBytes: limits.memoryBytes,
    pids: limits.pids,
    cpuQuotaMicros: limits.cpuQuotaMicros,
    cpuPeriodMicros: limits.cpuPeriodMicros,
    deadlineUnixMs: limits.deadlineUnixMs,
    cleanupTimeoutMs: limits.cleanupTimeoutMs ?? 5_000,
  })) {
    if (!Number.isSafeInteger(number) || number <= 0) throw new TypeError(`invalid rootless ${name}`);
  }
  if (!Array.isArray(value.command) || value.command.length === 0 ||
      value.command.some((part) => typeof part !== "string" || part.includes("\0")) ||
      !value.command[0]!.startsWith("/")) {
    throw new TypeError("invalid rootless command");
  }
  const mounts = value.readOnlyMounts.map((mount) => {
    if (!mount.source.startsWith("/") || !mount.destination.startsWith("/") ||
        mount.source.includes("\0") || mount.destination.includes("\0") ||
        protectedDestination(mount.destination)) {
      throw new TypeError("invalid rootless read-only mount");
    }
    return Object.freeze({ source: mount.source, destination: mount.destination });
  });
  const environment: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const [name, content] of Object.entries(value.environment ?? {})) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || typeof content !== "string" || content.includes("\0")) {
      throw new TypeError("invalid rootless environment");
    }
    environment[name] = content;
  }
  return Object.freeze({
    runId: value.runId,
    limits: Object.freeze({ ...limits, cleanupTimeoutMs: limits.cleanupTimeoutMs ?? 5_000 }),
    readOnlyMounts: Object.freeze(mounts),
    command: Object.freeze([...value.command]) as unknown as readonly [string, ...string[]],
    environment: Object.freeze(environment),
  });
}

function validateOptions(options: PrivateRootlessLinuxOptions): void {
  for (const [name, value] of Object.entries({
    delegatedCgroup: options.delegatedCgroup,
    bunPath: options.bunPath,
    bubblewrapPath: options.bubblewrapPath,
  })) {
    if (typeof value !== "string" || !value.startsWith("/") || value.includes("\0")) {
      throw new TypeError(`invalid rootless ${name}`);
    }
  }
  for (const [name, value] of Object.entries({ payloadUid: options.payloadUid, payloadGid: options.payloadGid })) {
    if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`invalid rootless ${name}`);
  }
}

async function requireDelegatedCgroup(root: string): Promise<void> {
  const information = await stat(root);
  if (!information.isDirectory() || information.uid !== process.getuid!()) {
    throw new Error("rootless delegated cgroup is not owned by the current user");
  }
  if ((await readFile(`${root}/cgroup.procs`, "utf8")).trim() !== "") {
    throw new Error("rootless delegated cgroup is not empty");
  }
  const controllers = new Set((await readFile(`${root}/cgroup.controllers`, "utf8")).trim().split(/\s+/));
  const active = new Set((await readFile(`${root}/cgroup.subtree_control`, "utf8")).trim().split(/\s+/));
  for (const controller of REQUIRED_CONTROLLERS) {
    if (!controllers.has(controller) || !active.has(controller)) {
      throw new Error(`rootless delegated cgroup lacks active ${controller} control`);
    }
  }
}

async function requireExecutable(path: string, label: string): Promise<void> {
  const information = await stat(path);
  if (!information.isFile() || (information.mode & 0o111) === 0) {
    throw new Error(`${label} executable is unavailable`);
  }
}

async function requireMountSources(mounts: readonly PrivateRootlessLinuxMount[]): Promise<void> {
  for (const mount of mounts) {
    await stat(mount.source);
    const resolved = await realpath(mount.source);
    if (protectedHostSource(resolved)) throw new TypeError("invalid rootless read-only mount source");
  }
}

function protectedDestination(path: string): boolean {
  return path === "/" || posix.normalize(path) !== path ||
    ["/proc", "/dev", "/sys", "/run", "/tmp", "/work", "/jig"]
    .some((root) => path === root || path.startsWith(`${root}/`));
}

function protectedHostSource(path: string): boolean {
  return path === "/" || ["/proc", "/dev", "/sys", "/run"]
    .some((root) => path === root || path.startsWith(`${root}/`));
}

function requirePipedChild(child: ChildProcess): ChildProcessWithoutNullStreams {
  if (child.stdin === null || child.stdout === null || child.stderr === null) {
    throw new Error("rootless supervisor pipes are unavailable");
  }
  return child as ChildProcessWithoutNullStreams;
}

function requireStart(value: unknown): SupervisorConfiguration {
  if (recordType(value) !== "start" || !("configuration" in (value as object))) {
    throw new Error("invalid rootless supervisor start message");
  }
  return (value as { configuration: SupervisorConfiguration }).configuration;
}

function recordType(value: unknown): string | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
      "type" in value && typeof value.type === "string"
    ? value.type
    : undefined;
}

function requireMessage<T extends SupervisorMessage["type"]>(
  value: SupervisorMessage,
  type: T,
): Extract<SupervisorMessage, { readonly type: T }> {
  if (value.type !== type) throw new Error(`expected rootless ${type} message, received ${value.type}`);
  return value as Extract<SupervisorMessage, { readonly type: T }>;
}

async function nextMessage(
  iterator: AsyncIterator<unknown>,
  closed: Promise<{ readonly code: number | null; readonly signal: string | null }>,
): Promise<SupervisorMessage> {
  return await Promise.race([
    iterator.next().then((next) => {
      if (next.done) throw new Error("rootless supervisor control stream closed");
      return next.value as SupervisorMessage;
    }),
    closed.then((exit) => {
      throw new Error(`rootless supervisor exited before its terminal (${exit.code ?? exit.signal})`);
    }),
  ]);
}

async function* readJsonLines(stream: NodeJS.ReadableStream): AsyncIterable<unknown> {
  let buffer = "";
  for await (const chunk of stream) {
    buffer += String(chunk);
    if (Buffer.byteLength(buffer) > MAX_CONTROL_BYTES) throw new Error("rootless control stream overflow");
    let newline = buffer.indexOf("\n");
    while (newline !== -1) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (line !== "") yield JSON.parse(line) as unknown;
      newline = buffer.indexOf("\n");
    }
  }
  if (buffer !== "") throw new Error("rootless control stream ended mid-message");
}

function writeJsonLine(stream: NodeJS.WritableStream, value: unknown): void {
  stream.write(`${JSON.stringify(value)}\n`);
}

function safeSend(stream: NodeJS.WritableStream, value: unknown): void {
  try {
    writeJsonLine(stream, value);
  } catch {
    // A lost coordinator closes this private report channel. Cleanup remains owned here.
  }
}

async function readReady(child: ChildProcess): Promise<number> {
  const stream = child.stdio[3] as Readable | null | undefined;
  if (stream === null || stream === undefined) {
    throw new Error("rootless entry readiness pipe is unavailable");
  }
  let text = "";
  for await (const chunk of stream) {
    text += String(chunk);
    if (text.length > 32) throw new Error("invalid rootless entry readiness receipt");
  }
  const pid = Number(text.trim());
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error("invalid rootless entry readiness receipt");
  return pid;
}

async function waitUntilEmpty(cgroup: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    const events = await readCounters(`${cgroup}/cgroup.events`);
    if (events.populated === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("rootless Run cgroup did not become empty");
}

async function readEvidence(cgroup: string): Promise<SupervisorTerminal["evidence"]> {
  return Object.freeze({
    cpuStat: Object.freeze(await readCounters(`${cgroup}/cpu.stat`)),
    memoryEvents: Object.freeze(await readCounters(`${cgroup}/memory.events`)),
    pidsEvents: Object.freeze(await readCounters(`${cgroup}/pids.events`)),
  });
}

async function readCounters(path: string): Promise<Record<string, number>> {
  const result: Record<string, number> = Object.create(null) as Record<string, number>;
  for (const line of (await readFile(path, "utf8")).trim().split("\n")) {
    if (line === "") continue;
    const [name, raw] = line.trim().split(/\s+/, 2);
    const value = Number(raw);
    if (name === undefined || !Number.isSafeInteger(value) || value < 0) {
      throw new Error(`invalid cgroup counter in ${path}`);
    }
    result[name] = value;
  }
  return result;
}

function emptyEvidence(): SupervisorTerminal["evidence"] {
  return Object.freeze({ cpuStat: Object.freeze({}), memoryEvents: Object.freeze({}), pidsEvents: Object.freeze({}) });
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (hasCode(error, "ENOENT")) return false;
    throw error;
  }
}

function ignoreMissing(error: unknown): void {
  if (!hasCode(error, "ENOENT")) throw error;
}

function hasCode(error: unknown, code: string): boolean {
  return error !== null && typeof error === "object" && (error as NodeJS.ErrnoException).code === code;
}

function requireFixedBunPosture(label: string): void {
  if (process.cwd() !== "/" || Object.keys(process.env).length !== 0 ||
      process.execArgv.length !== POLICY.length ||
      process.execArgv.some((value, index) => value !== POLICY[index])) {
    throw new Error(`rootless ${label} has an invalid startup posture`);
  }
}

function childClose(child: ChildProcess): Promise<{ readonly code: number | null; readonly signal: string | null }> {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
}

async function* streamBytes(stream: NodeJS.ReadableStream): AsyncIterable<Uint8Array> {
  for await (const chunk of stream) yield new Uint8Array(chunk as Buffer);
}

async function writeBytes(stream: NodeJS.WritableStream, bytes: Uint8Array): Promise<void> {
  if (stream.write(bytes)) return;
  await new Promise<void>((resolve, reject) => {
    stream.once("drain", resolve);
    stream.once("error", reject);
  });
}

async function withTimeout<T>(promise: Promise<T>, milliseconds: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out`)), milliseconds);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function listen(server: Server, path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(path, () => resolve());
  });
}

function acceptOne(server: Server, timeoutMs: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("rootless supervisor connection timed out")), timeoutMs);
    server.once("connection", (socket) => {
      clearTimeout(timeout);
      resolve(socket);
    });
    server.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

async function main(): Promise<void> {
  const [mode, ...arguments_] = process.argv.slice(2);
  if (mode === "--supervisor") {
    if (arguments_.length !== 1) throw new Error("invalid rootless supervisor arguments");
    return await supervisorMain(arguments_[0]!);
  }
  if (mode === "--enter") return await enterMain(arguments_);
  if (mode === "--inner") {
    if (arguments_[0] !== "--") throw new Error("invalid rootless inner separator");
    return await innerMain(arguments_.slice(1));
  }
}

if (import.meta.main) {
  void main().catch((error) => {
    process.stderr.write(`jig rootless Run failed: ${errorText(error)}\n`);
    process.exitCode = 70;
  });
}
