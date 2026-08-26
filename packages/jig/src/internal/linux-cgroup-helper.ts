import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir, readFile, rmdir, writeFile } from "node:fs/promises";
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
  readonly wallMs: number;
  readonly cleanupMs: number;
  readonly uid: string;
  readonly gid: string;
  readonly bubblewrap: string;
  readonly shell: string;
  readonly bubblewrapArguments: readonly string[];
}

type StopReason = "cancelled" | "coordinator_lost" | "deadline" | "payload_exit" | "setup_failed";

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
  const config = parseArguments(process.argv.slice(2));
  if (typeof process.getuid !== "function" || process.getuid() !== 0) {
    throw new Error("trusted cgroup helper requires uid 0");
  }

  const parentCgroup = join(config.scope, config.parent);
  const runCgroup = join(parentCgroup, "run");
  const control = await connectControl(config.control);
  let child: ChildProcessWithoutNullStreams | undefined;
  let parentCreated = false;
  let runCreated = false;
  let stopping: StopReason | undefined;
  let terminalSent = false;
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

  const deadline = setTimeout(() => requestStop("deadline"), config.wallMs);
  try {
    await admission;
    if (stopping !== undefined) throw new Error(`launch cancelled before admission: ${stopping}`);
    await requireScope(config.scope);
    await mkdir(parentCgroup, { mode: 0o755 });
    parentCreated = true;
    await requireControllers(parentCgroup, ["cpu", "memory", "pids"]);
    await writeFile(join(parentCgroup, "cgroup.subtree_control"), "+cpu +memory +pids");
    await mkdir(runCgroup, { mode: 0o755 });
    runCreated = true;
    await writeFile(join(runCgroup, "memory.max"), config.memory);
    await writeFile(join(runCgroup, "pids.max"), config.pids);
    await writeFile(join(runCgroup, "cpu.max"), `${config.cpuQuota} ${config.cpuPeriod}`);
    if (stopping !== undefined) throw new Error(`launch cancelled during setup: ${stopping}`);

    const launched = spawn(
      config.shell,
      ["-eu", "-c", ENTER_SCRIPT, "jig-cgroup-enter", runCgroup, config.bubblewrap, ...config.bubblewrapArguments],
      { stdio: ["pipe", "pipe", "pipe", "pipe"] },
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
    const cleanupResult = await cleanup(runCgroup, parentCgroup, config.cleanupMs);
    const cleanupError = cleanupResult.error;
    runCreated = cleanupError !== undefined;
    parentCreated = cleanupError !== undefined;
    const receipt = {
      type: "terminal",
      exitCode: exit.code,
      signal: exit.signal,
      reason: stopping,
      fenced: cleanupError === undefined,
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
      parentCreated ? parentCgroup : undefined,
      config.cleanupMs,
    );
    const cleanupError = cleanupResult.error;
    const message = errorText(error);
    if (!terminalSent && control.writable) {
      send(control, {
        type: "terminal",
        exitCode: null,
        signal: null,
        reason: stopping,
        fenced: cleanupError === undefined,
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
    clearTimeout(deadline);
    control.end();
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
    values.set(name.slice(2), value);
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
  const shell = required("shell");
  if (!bubblewrap.startsWith("/") || !shell.startsWith("/") || bubblewrapArguments.length === 0) {
    throw new Error("invalid Bubblewrap launch");
  }
  return {
    control: required("control"),
    scope,
    parent,
    memory: String(integer("memory")),
    pids: String(integer("pids")),
    cpuQuota: String(integer("cpu-quota")),
    cpuPeriod: String(integer("cpu-period")),
    wallMs: integer("wall-ms"),
    cleanupMs: integer("cleanup-ms"),
    uid: nonnegativeInteger("uid"),
    gid: nonnegativeInteger("gid"),
    bubblewrap,
    shell,
    bubblewrapArguments,
  };
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
