import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir, readFile, rm, rmdir, stat, writeFile } from "node:fs/promises";
import { connect, type Socket } from "node:net";
import { join } from "node:path";
import { Readable } from "node:stream";

interface Configuration {
  readonly control: string;
  readonly scope: string;
  readonly parent: string;
  readonly memory: string;
  readonly pids: string;
  readonly cpuQuota: string;
  readonly cpuPeriod: string;
  readonly deadlineUnixMs: number;
  readonly cancellationGraceMs: number;
  readonly cleanupMs: number;
  readonly uid: string;
  readonly gid: string;
  readonly bubblewrap: string;
  readonly mknod: string;
  readonly bash: string;
  readonly launcher: string;
  readonly bubblewrapArguments: readonly string[];
}

type StopReason = "cancelled" | "coordinator_lost" | "deadline" | "payload_exit" | "setup_failed";

const HELPER_BUN_POLICY = Object.freeze([
  "--no-env-file",
  "--no-install",
  "--config=/dev/null",
] as const);
const HELPER_FIELDS = new Set([
  "bubblewrap",
  "cancellation-grace-ms",
  "cleanup-ms",
  "control",
  "cpu-period",
  "cpu-quota",
  "deadline-unix-ms",
  "gid",
  "memory",
  "mknod",
  "launcher",
  "parent",
  "pids",
  "scope",
  "bash",
  "uid",
]);
const PRIVATE_NULL_SOURCE = "@jig-private-null@";
const PRIVATE_URANDOM_SOURCE = "@jig-private-urandom@";
const EMPTY_ENVIRONMENT = 'cd -- / && exec -c -- "$@"';

const ENTER_SCRIPT = [
  "set -eu",
  "run_cgroup=$1",
  "shift",
  "printf '%s\\n' \"$$\" > \"$run_cgroup/cgroup.procs\"",
  "printf 'ready\\n' >&3",
  "exec 3>&-",
  "exec \"$@\"",
].join("\n");

async function main(): Promise<void> {
  if (typeof process.getuid !== "function" || process.getuid() !== 0) {
    throw new Error("trusted cgroup helper requires uid 0");
  }
  if (process.cwd() !== "/") {
    throw new Error("trusted cgroup helper requires fixed cwd /");
  }
  if (Object.keys(process.env).length !== 0) {
    throw new Error("trusted cgroup helper requires an empty environment");
  }
  if (process.execArgv.length !== HELPER_BUN_POLICY.length ||
      process.execArgv.some((value, index) => value !== HELPER_BUN_POLICY[index])) {
    throw new Error("trusted cgroup helper requires the fixed Bun policy");
  }
  const config = parseArguments(process.argv.slice(2));

  const parentCgroup = join(config.scope, config.parent);
  const supervisorCgroup = join(parentCgroup, "supervisor");
  const runCgroup = join(parentCgroup, "run");
  const control = await connectControl(config.control);
  let child: ChildProcessWithoutNullStreams | undefined;
  let runCreated = false;
  let stopping: StopReason | undefined;
  let terminalSent = false;
  let privateDeviceDirectory: string | undefined;
  let controlBuffer = "";
  let admit!: () => void;
  let rejectAdmission!: (error: Error) => void;
  let admitted = false;
  let requestedKills = Promise.resolve();
  let requestedKillError: unknown;
  const admission = new Promise<void>((resolve, reject) => {
    admit = resolve;
    rejectAdmission = reject;
  });

  const requestStop = (reason: StopReason): void => {
    if (stopping === undefined || stopping === "payload_exit") stopping = reason;
    if (!admitted) rejectAdmission(new Error(`launch stopped before admission: ${reason}`));
    child?.kill("SIGKILL");
    if (runCreated) {
      requestedKills = requestedKills
        .then(() => killCgroup(runCgroup))
        .catch((error) => {
          requestedKillError ??= error;
        });
    }
  };
  control.on("data", (data) => {
    controlBuffer += String(data);
    let newline = controlBuffer.indexOf("\n");
    while (newline !== -1) {
      const line = controlBuffer.slice(0, newline);
      controlBuffer = controlBuffer.slice(newline + 1);
      if (line !== "") {
        try {
          const message: unknown = JSON.parse(line);
          if (typeof message === "object" && message !== null) {
            const type = (message as { type?: unknown }).type;
            if (type === "admit") {
              admitted = true;
              admit();
            }
            if (type === "cancel") requestStop("cancelled");
          }
        } catch {
          requestStop("cancelled");
        }
      }
      newline = controlBuffer.indexOf("\n");
    }
  });
  control.once("close", () => {
    requestStop("coordinator_lost");
    rejectAdmission(new Error("coordinator closed before launch admission"));
  });
  control.once("error", () => {
    requestStop("coordinator_lost");
    rejectAdmission(new Error("coordinator failed before launch admission"));
  });
  process.once("SIGTERM", () => requestStop("cancelled"));
  process.once("SIGINT", () => requestStop("cancelled"));

  const hardDeadlineUnixMs = config.deadlineUnixMs + config.cancellationGraceMs;
  const hardDeadlineDelayMs = Math.max(0, hardDeadlineUnixMs - Date.now());
  let deadline: ReturnType<typeof setTimeout> | undefined = setTimeout(
    () => requestStop("deadline"),
    hardDeadlineDelayMs,
  );
  try {
    await requireScope(config.scope);
    await mkdir(parentCgroup, { mode: 0o755 });
    await requireControllers(parentCgroup, ["cpu", "memory", "pids"]);
    await writeFile(join(parentCgroup, "cgroup.subtree_control"), "+cpu +memory +pids");
    await mkdir(supervisorCgroup, { mode: 0o755 });
    await mkdir(runCgroup, { mode: 0o755 });
    runCreated = true;
    await writeFile(join(runCgroup, "memory.max"), config.memory);
    await writeFile(join(runCgroup, "pids.max"), config.pids);
    await writeFile(join(runCgroup, "cpu.max"), `${config.cpuQuota} ${config.cpuPeriod}`);
    // The trusted Bun helper becomes the exact recoverable owner before it
    // reports preparation. Package execution is still impossible because the
    // admission message has not been received.
    await writeFile(join(supervisorCgroup, "cgroup.procs"), String(process.pid));
    send(control, {
      type: "prepared",
      parentCgroup,
      supervisorCgroup,
      runCgroup,
    });

    await admission;
    if (stopping !== undefined) throw new Error(`launch cancelled before admission: ${stopping}`);

    const nullSources = config.bubblewrapArguments.filter((value) => value === PRIVATE_NULL_SOURCE);
    const entropySources = config.bubblewrapArguments.filter((value) => value === PRIVATE_URANDOM_SOURCE);
    if (nullSources.length !== entropySources.length || entropySources.length > 1) {
      throw new Error("invalid private runtime device request");
    }
    let bubblewrapArguments = config.bubblewrapArguments;
    if (entropySources.length === 1) {
      const deviceDirectory = join("/dev", `.jig-${config.parent}-devices`);
      const nullSource = join(deviceDirectory, "null");
      const entropySource = join(deviceDirectory, "urandom");
      // The setup process now runs Bubblewrap as the package owner's host
      // identity so it can traverse the protected captured package tree.
      // This root-owned directory is searchable but never writable by that
      // identity; it contains only the two freshly-created least-mode devices.
      await mkdir(deviceDirectory, { mode: 0o711 });
      privateDeviceDirectory = deviceDirectory;
      await runMknod(config.mknod, nullSource, "0666", "3");
      await runMknod(config.mknod, entropySource, "0444", "9");
      bubblewrapArguments = config.bubblewrapArguments.map(
        (value) => value === PRIVATE_NULL_SOURCE ? nullSource :
          value === PRIVATE_URANDOM_SOURCE ? entropySource : value,
      );
    }

    // Device construction contains asynchronous trusted work. A cancellation,
    // coordinator loss, or hard deadline may have fenced the then-empty Run
    // cgroup while that work was pending. Recheck immediately before the
    // synchronous spawn so no payload can enter after that completed fence.
    if (stopping !== undefined) throw new Error(`launch cancelled during setup: ${stopping}`);

    const launched = spawn(
      config.bash,
      [
        "--noprofile",
        "--norc",
        "-p",
        "-eu",
        "-c",
        ENTER_SCRIPT,
        "jig-cgroup-enter",
        runCgroup,
        config.launcher,
        "-n",
        "-u", `#${config.uid}`,
        "-g", `#${config.gid}`,
        "--",
        config.bash,
        "--noprofile",
        "--norc",
        "-p",
        "-c",
        EMPTY_ENVIRONMENT,
        "jig-bubblewrap",
        config.bubblewrap,
        ...bubblewrapArguments,
      ],
      {
        cwd: "/",
        env: {},
        // fd 3 proves the root trampoline entered the Run cgroup before the
        // exact launcher drops to the package owner's host identity.
        stdio: ["pipe", "pipe", "pipe", "pipe"],
      },
    );
    if (launched.stdin === null || launched.stdout === null || launched.stderr === null) {
      throw new Error("payload process pipes were unavailable");
    }
    child = launched as ChildProcessWithoutNullStreams;
    const payload = child;
    payload.stdout.pipe(process.stdout);
    payload.stderr.pipe(process.stderr);
    process.stdin.pipe(payload.stdin);
    const exitPromise = childExit(payload);
    await waitForReady(payload);
    await requestedKills;
    if (stopping !== undefined) {
      await captureKillFailure(runCgroup, (error) => {
        requestedKillError ??= error;
      });
    } else {
      send(control, {
        type: "ready",
        parentCgroup,
        runCgroup,
        payloadPid: payload.pid,
      });
    }

    const exit = await exitPromise;
    stopping ??= "payload_exit";
    await requestedKills;
    await captureKillFailure(runCgroup, (error) => {
      requestedKillError ??= error;
    });
    const cleanupResult = await cleanup(runCgroup, undefined, config.cleanupMs);
    const deviceCleanupError = await cleanupPrivateDevices(privateDeviceDirectory);
    privateDeviceDirectory = deviceCleanupError === undefined ? undefined : privateDeviceDirectory;
    const cleanupError = joinErrors(cleanupResult.error, deviceCleanupError);
    runCreated = cleanupError !== undefined;
    const receipt = {
      type: "terminal",
      exitCode: exit.code,
      signal: exit.signal,
      reason: stopping,
      // The outside-owner wrapper removes supervisor/parent only after this
      // helper exits. This is a preliminary terminal, not the atomic fence.
      fenced: false,
      ...(requestedKillError === undefined ? {} : { killError: errorText(requestedKillError) }),
      ...(cleanupError === undefined ? {} : { cleanupError }),
      evidence: cleanupResult.evidence,
    };
    send(control, receipt);
    terminalSent = true;
  } catch (error) {
    stopping ??= "setup_failed";
    await requestedKills;
    if (runCreated) {
      await captureKillFailure(runCgroup, (killError) => {
        requestedKillError ??= killError;
      });
    }
    const cleanupResult = await cleanup(
      runCreated ? runCgroup : undefined,
      undefined,
      config.cleanupMs,
    );
    const deviceCleanupError = await cleanupPrivateDevices(privateDeviceDirectory);
    privateDeviceDirectory = deviceCleanupError === undefined ? undefined : privateDeviceDirectory;
    const cleanupError = joinErrors(cleanupResult.error, deviceCleanupError);
    const message = errorText(error);
    if (!terminalSent && control.writable) {
      send(control, {
        type: "terminal",
        exitCode: null,
        signal: null,
        reason: stopping,
        fenced: false,
        setupError: message,
        ...(requestedKillError === undefined ? {} : { killError: errorText(requestedKillError) }),
        ...(cleanupError === undefined ? {} : { cleanupError }),
        evidence: cleanupResult.evidence,
      });
      terminalSent = true;
    }
    if (cleanupError !== undefined) throw new Error(`${message}; cleanup: ${cleanupError}`);
    if (child === undefined) throw error;
  } finally {
    if (deadline !== undefined) clearTimeout(deadline);
    control.end();
    if (privateDeviceDirectory !== undefined) {
      const error = await cleanupPrivateDevices(privateDeviceDirectory);
      if (error !== undefined) process.stderr.write(`jig private device cleanup failed: ${error}\n`);
    }
  }
}

function parseArguments(arguments_: readonly string[]): Configuration {
  const values = new Map<string, string>();
  let index = 0;
  for (; index < arguments_.length; index += 2) {
    const name = arguments_[index];
    if (name === "--") break;
    const value = arguments_[index + 1];
    if (name === undefined || value === undefined || !name.startsWith("--")) {
      throw new Error("invalid trusted cgroup helper arguments");
    }
    const field = name.slice(2);
    if (!HELPER_FIELDS.has(field) || values.has(field)) {
      throw new Error("invalid trusted cgroup helper arguments");
    }
    values.set(field, value);
  }
  const bubblewrapArguments = arguments_.slice(index + 1);
  const required = (name: string): string => {
    const value = values.get(name);
    if (value === undefined) throw new Error(`missing helper argument --${name}`);
    return value;
  };
  const integer = (name: string): number => {
    const value = Number(required(name));
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`invalid helper argument --${name}`);
    return value;
  };
  const nonnegativeSafeInteger = (name: string): number => {
    const value = Number(required(name));
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`invalid helper argument --${name}`);
    return value;
  };
  const nonnegativeInteger = (name: string): string => {
    const value = Number(required(name));
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`invalid helper argument --${name}`);
    return String(value);
  };
  const scope = required("scope");
  const parent = required("parent");
  if (!scope.startsWith("/sys/fs/cgroup/") || parent.includes("/") || !parent.startsWith("jig-run-")) {
    throw new Error("helper cgroup target is outside the Jig-owned naming boundary");
  }
  const bubblewrap = required("bubblewrap");
  const mknod = required("mknod");
  const bash = required("bash");
  const launcher = required("launcher");
  if (!bubblewrap.startsWith("/") || !mknod.startsWith("/") || !bash.startsWith("/") ||
      !launcher.startsWith("/") ||
      bubblewrapArguments.length === 0) {
    throw new Error("invalid Bubblewrap launch");
  }
  const deadlineUnixMs = nonnegativeSafeInteger("deadline-unix-ms");
  const cancellationGraceMs = integer("cancellation-grace-ms");
  const hardDeadlineUnixMs = deadlineUnixMs + cancellationGraceMs;
  if (!Number.isSafeInteger(hardDeadlineUnixMs) ||
      hardDeadlineUnixMs - Date.now() > 2_147_483_647) {
    throw new Error("helper hard deadline is outside the supported timer range");
  }
  return {
    control: required("control"),
    scope,
    parent,
    memory: String(integer("memory")),
    pids: String(integer("pids")),
    cpuQuota: String(integer("cpu-quota")),
    cpuPeriod: String(integer("cpu-period")),
    deadlineUnixMs,
    cancellationGraceMs,
    cleanupMs: integer("cleanup-ms"),
    uid: nonnegativeInteger("uid"),
    gid: nonnegativeInteger("gid"),
    bubblewrap,
    mknod,
    bash,
    launcher,
    bubblewrapArguments,
  };
}

async function runMknod(
  executable: string,
  path: string,
  mode: "0444" | "0666",
  minor: "3" | "9",
): Promise<void> {
  const child = spawn(executable, ["-m", mode, path, "c", "1", minor], {
    // The proof host may provide GNU coreutils as one canonical multicall
    // executable. Preserve the exact digested target while selecting its
    // mknod applet without returning to a retargetable symlink.
    argv0: "mknod",
    cwd: "/",
    env: {},
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk) => {
    stderr += String(chunk);
  });
  const exit = await new Promise<{ code: number | null; signal: string | null }>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
  if (exit.code !== 0) throw new Error(`private runtime device creation failed: ${stderr.trim() || exit.signal}`);
  const information = await stat(path);
  if (!information.isCharacterDevice() ||
      (information.mode & 0o777) !== Number.parseInt(mode, 8) ||
      information.uid !== 0 || information.gid !== 0) {
    throw new Error("private runtime device has unexpected ownership or mode");
  }
}

async function cleanupPrivateDevices(directory: string | undefined): Promise<string | undefined> {
  if (directory === undefined) return undefined;
  try {
    await rm(directory, { recursive: true, force: false });
    return undefined;
  } catch (error) {
    return errorText(error);
  }
}

function joinErrors(...errors: readonly (string | undefined)[]): string | undefined {
  const present = errors.filter((error): error is string => error !== undefined);
  return present.length === 0 ? undefined : present.join("; ");
}

async function connectControl(path: string): Promise<Socket> {
  return await new Promise((resolve, reject) => {
    const socket = connect(path);
    socket.once("connect", () => resolve(socket));
    socket.once("error", reject);
  });
}

async function requireScope(scope: string): Promise<void> {
  const processes = (await readFile(join(scope, "cgroup.procs"), "utf8")).trim();
  if (processes !== "") throw new Error("configured cgroup scope is not an empty delegation point");
  await requireControllers(scope, ["cpu", "memory", "pids"]);
}

async function requireControllers(cgroup: string, required: readonly string[]): Promise<void> {
  const controllers = new Set((await readFile(join(cgroup, "cgroup.controllers"), "utf8")).trim().split(/\s+/));
  for (const controller of required) {
    if (!controllers.has(controller)) throw new Error(`missing cgroup controller: ${controller}`);
  }
}

async function waitForReady(child: ChildProcessWithoutNullStreams): Promise<void> {
  const readiness = child.stdio[3];
  if (!(readiness instanceof Readable)) throw new Error("cgroup entry readiness pipe was unavailable");
  const line = await new Promise<string>((resolve, reject) => {
    let value = "";
    readiness.setEncoding("utf8");
    readiness.on("data", (chunk) => {
      value += chunk;
      if (value.includes("\n")) resolve(value);
    });
    readiness.once("error", reject);
    readiness.once("end", () => {
      if (!value.includes("\n")) reject(new Error("cgroup entry trampoline exited before placement"));
    });
  });
  if (line !== "ready\n") throw new Error("invalid cgroup entry readiness marker");
}

function childExit(child: ChildProcessWithoutNullStreams): Promise<{ code: number | null; signal: string | null }> {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
}

async function killCgroup(runCgroup: string): Promise<void> {
  await writeFile(join(runCgroup, "cgroup.kill"), "1").catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
}

async function captureKillFailure(
  runCgroup: string,
  failed: (error: unknown) => void,
): Promise<void> {
  try {
    await killCgroup(runCgroup);
  } catch (error) {
    failed(error);
  }
}

async function cleanup(
  runCgroup: string | undefined,
  parentCgroup: string | undefined,
  timeoutMs: number,
): Promise<{
  readonly error?: string;
  readonly evidence: Awaited<ReturnType<typeof readEvidence>>;
}> {
  let evidence = await readEvidence(runCgroup);
  try {
    if (runCgroup !== undefined) {
      const deadline = Date.now() + timeoutMs;
      while (await populated(runCgroup)) {
        if (Date.now() >= deadline) throw new Error("timed out waiting for cgroup.events populated 0");
        await delay(10);
      }
      evidence = await readEvidence(runCgroup);
      await rmdir(runCgroup);
    }
    if (parentCgroup !== undefined) await rmdir(parentCgroup);
    return { evidence };
  } catch (error) {
    evidence = await readEvidence(runCgroup);
    return { error: errorText(error), evidence };
  }
}

async function populated(cgroup: string): Promise<boolean> {
  const events = await readFile(join(cgroup, "cgroup.events"), "utf8");
  const match = /^populated ([01])$/m.exec(events);
  if (match === null) throw new Error("cgroup.events omitted populated state");
  return match[1] === "1";
}

async function readEvidence(
  runCgroup: string | undefined,
): Promise<{
  cpuStat: Readonly<Record<string, number>>;
  memoryEvents: Readonly<Record<string, number>>;
  pidsEvents: Readonly<Record<string, number>>;
}> {
  if (runCgroup === undefined) return { cpuStat: {}, memoryEvents: {}, pidsEvents: {} };
  return {
    cpuStat: await readCounters(join(runCgroup, "cpu.stat")),
    memoryEvents: await readCounters(join(runCgroup, "memory.events")),
    pidsEvents: await readCounters(join(runCgroup, "pids.events")),
  };
}

async function readCounters(path: string): Promise<Readonly<Record<string, number>>> {
  try {
    const result: Record<string, number> = {};
    for (const line of (await readFile(path, "utf8")).trim().split("\n")) {
      const [name, raw] = line.split(/\s+/, 2);
      if (name !== undefined && raw !== undefined) result[name] = Number(raw);
    }
    return result;
  } catch {
    return {};
  }
}

function send(socket: Socket, value: object): void {
  if (socket.writable) socket.write(`${JSON.stringify(value)}\n`);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

void main().catch((error) => {
  process.stderr.write(`jig cgroup helper failed: ${errorText(error)}\n`);
  process.exitCode = 70;
});
