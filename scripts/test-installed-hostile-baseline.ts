import assert from "node:assert/strict";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";

const systemctl = await fixedSystemctl();
const startedUnixMs = Date.now();
const temporary = await mkdtemp(join(tmpdir(), "jig-installed-hostile-baseline-"));
const runtimeTemporary = join(temporary, "runtime-tmp");

let failure: unknown;
try {
  await mkdir(runtimeTemporary);
  await eventuallyNoJigResidue();

  const archive = await requiredPackageArchive();
  const consumer = join(temporary, "consumer");
  await mkdir(consumer);
  await writeFile(join(consumer, "package.json"), `${JSON.stringify({
    private: true,
    dependencies: {
      "@jigging/jig": `file:${archive}`,
    },
  }, null, 2)}\n`);
  await run([
    process.execPath,
    "install",
    "--ignore-scripts",
    "--no-progress",
    "--cache-dir",
    join(temporary, "cache"),
    "--backend",
    "copyfile",
  ], consumer, [0], 60_000);

  const jig = join(consumer, "node_modules", ".bin", "jig");
  const project = join(consumer, "hostile-project");
  const initialized = await run([jig, "init", "--bare", project], consumer);
  assert.deepEqual(initialized, {
    exitCode: 0,
    stdout: "created bare Jig project\n",
    stderr: "",
  });

  await writeHostileFlow(project, "isolation-orphan", `
    const child = Bun.spawn([
      process.execPath,
      "--no-env-file", "--no-install", "--config=/dev/null",
      "-e", "await Bun.sleep(45_000)",
    ], { stdin: "ignore", stdout: "ignore", stderr: "ignore" });
    child.unref();
    await Bun.sleep(50);
    return { cgroupVisible: envelope.cgroupVisible, childStarted: Number.isSafeInteger(child.pid) && child.pid > 1 };
  `);
  await writeHostileFlow(project, "memory-pressure", `
    const child = Bun.spawn([
      process.execPath,
      "--no-env-file", "--no-install", "--config=/dev/null",
      "-e", "const chunks=[]; for (let i=0;i<20;i+=1) chunks.push(Buffer.alloc(16*1024*1024, 1))",
    ], { stdin: "ignore", stdout: "ignore", stderr: "ignore" });
    return { exitCode: await child.exited };
  `);
  await writeHostileFlow(project, "fixed-deadline", `
    await Bun.sleep(60_000);
    return { escapedDeadline: true };
  `);

  const approved = await run([jig, "check", project, "--yes"], consumer, [0], 120_000);
  assert.match(approved.stdout, /\nproject is ready\n$/);
  assert.equal(approved.stderr, "");

  process.stdout.write("Installed hostile case: isolation and orphan cleanup\n");
  const orphanStartedUnixMs = Date.now();
  const orphan = await run([jig, "run", "flow:flows/isolation-orphan"], project, [0], 60_000);
  assert.ok(Date.now() - orphanStartedUnixMs < 20_000);
  const orphanTerminal = successfulTerminal(orphan);
  assert.deepEqual(orphanTerminal.output, { cgroupVisible: false, childStarted: true });
  await eventuallyNoJigResidue();

  process.stdout.write("Installed hostile case: aggregate memory pressure\n");
  const memory = await run([jig, "run", "flow:flows/memory-pressure"], project, [0], 60_000);
  const memoryTerminal = successfulTerminal(memory);
  const memoryOutput = requireRecord(memoryTerminal.output);
  assert.ok(Number.isSafeInteger(memoryOutput.exitCode));
  assert.notEqual(memoryOutput.exitCode, 0);
  await eventuallyNoJigResidue();

  process.stdout.write("Installed hostile case: fixed wall-clock deadline\n");
  const deadlineStartedUnixMs = Date.now();
  const deadline = await run([jig, "run", "flow:flows/fixed-deadline"], project, [1], 75_000);
  const deadlineElapsedMs = Date.now() - deadlineStartedUnixMs;
  assert.equal(deadline.stderr, "");
  const deadlineTerminal = requireRecord(JSON.parse(deadline.stdout));
  assert.equal(deadlineTerminal.status, "failed");
  assert.equal(deadlineTerminal.code, "DEADLINE_EXCEEDED");
  assert.ok(deadlineElapsedMs >= 25_000 && deadlineElapsedMs < 55_000);
  await eventuallyNoJigResidue();
} catch (error) {
  failure = error;
}

try {
  await eventuallyNoJigResidue();
} catch (cleanupFailure) {
  failure = failure === undefined
    ? cleanupFailure
    : new AggregateError(
        [failure, cleanupFailure],
        "installed-archive hostile baseline and its residue check both failed",
      );
}
try {
  await rm(temporary, { recursive: true, force: true });
} catch (cleanupFailure) {
  try {
    await makeDirectoriesWritable(temporary);
    await rm(temporary, { recursive: true, force: true });
  } catch (forcedCleanupFailure) {
    failure = failure === undefined
      ? forcedCleanupFailure
      : new AggregateError(
          [failure, cleanupFailure, forcedCleanupFailure],
          "installed-archive hostile baseline and temporary cleanup both failed",
        );
  }
}
if (failure !== undefined) throw failure;

process.stdout.write(
  `Installed-archive hostile baseline passed in ${Date.now() - startedUnixMs} ms ` +
    "(isolation/orphan, memory pressure, fixed deadline)\n",
);

async function requiredPackageArchive(): Promise<string> {
  const supplied = process.env.JIG_PACKAGE_ARCHIVE;
  if (supplied === undefined || !isAbsolute(supplied) || supplied.includes("\0") ||
      !supplied.endsWith(".tgz")) {
    throw new Error("JIG_PACKAGE_ARCHIVE must name one absolute .tgz file");
  }
  const canonical = await realpath(supplied);
  if (canonical !== supplied || !(await stat(canonical)).isFile()) {
    throw new Error("JIG_PACKAGE_ARCHIVE must name one canonical regular file");
  }
  return canonical;
}

async function makeDirectoriesWritable(directory: string): Promise<void> {
  await chmod(directory, 0o700);
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) await makeDirectoriesWritable(join(directory, entry.name));
  }
}

async function writeHostileFlow(project: string, name: string, attack: string): Promise<void> {
  const flow = join(project, "flows", name);
  await mkdir(flow);
  await writeFile(join(flow, "FLOW.md"), [
    "---",
    `name: ${name}`,
    "description: Exercise one bounded installed-host containment invariant.",
    "---",
    "",
  ].join("\n"));
  await writeFile(join(flow, "flow.ts"), `
import { existsSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline";

function requireHostileEnvelope() {
  const status = readFileSync("/proc/self/status", "utf8");
  const nspid = status.split("\\n").find((line) => line.startsWith("NSpid:"));
  const nestedPids = nspid?.slice("NSpid:".length).trim().split(/\\s+/) ?? [];
  const initStatus = readFileSync("/proc/1/status", "utf8");
  const initUid = Number(initStatus.split("\\n").find((line) => line.startsWith("Uid:"))
    ?.slice("Uid:".length).trim().split(/\\s+/)[0]);
  const cgroupVisible = existsSync("/sys/fs/cgroup/cgroup.procs");
  if (cgroupVisible || nestedPids.length === 0 || nestedPids.at(-1) !== String(process.pid) ||
      process.pid <= 1 || process.getuid?.() !== initUid || initUid === 0) {
    throw new Error("installed hostile fixture refused to run outside the expected envelope");
  }
  return { cgroupVisible };
}

const lines = createInterface({ input: process.stdin });
for await (const line of lines) {
  const request = JSON.parse(line);
  if (request.jsonrpc !== "2.0" || request.method !== "flow/run") {
    throw new Error("expected one FLOW Run/1 request");
  }
  const envelope = requireHostileEnvelope();
  const output = await (async () => {${attack}
  })();
  process.stdout.write(JSON.stringify({
    jsonrpc: "2.0",
    id: request.id,
    result: { outcome: "done", output },
  }) + "\\n");
  lines.close();
  break;
}
`);
}

function successfulTerminal(execution: CommandResult): Record<string, unknown> {
  assert.equal(execution.exitCode, 0);
  assert.equal(execution.stderr, "");
  const terminal = requireRecord(JSON.parse(execution.stdout));
  assert.equal(terminal.status, "succeeded");
  assert.equal(terminal.outcome, "done");
  return terminal;
}

interface CommandResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

async function run(
  command: readonly string[],
  cwd: string,
  acceptedExitCodes: readonly number[] = [0],
  timeoutMs = 60_000,
): Promise<CommandResult> {
  const child = Bun.spawn([...command], {
    cwd,
    env: { ...process.env, TMPDIR: runtimeTemporary },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const timeout = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]).finally(() => clearTimeout(timeout));
  if (!acceptedExitCodes.includes(exitCode)) {
    throw new Error(`${command.map(shellWord).join(" ")} exited ${exitCode}\n${stdout}${stderr}`);
  }
  return { stdout, stderr, exitCode };
}

function shellWord(value: string): string {
  return /^[A-Za-z0-9_./:=@+-]+$/.test(value) ? value : JSON.stringify(value);
}

function requireRecord(value: unknown): Record<string, unknown> {
  assert.ok(typeof value === "object" && value !== null && !Array.isArray(value));
  return value as Record<string, unknown>;
}

async function eventuallyNoJigResidue(timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let residue: readonly string[] = [];
  do {
    residue = await jigResidue();
    if (residue.length === 0) return;
    await Bun.sleep(50);
  } while (Date.now() < deadline);
  assert.fail(`Jig execution residue remained:\n${residue.join("\n")}`);
}

async function jigResidue(): Promise<readonly string[]> {
  const units = await run([
    systemctl, "--user", "list-units", "--all", "--plain", "--no-legend", "jig-*",
  ], "/", [0], 5_000);
  const residue = units.stdout.split("\n").filter((line) => line.trim() !== "")
    .map((line) => `unit:${line.trim()}`);

  const directories = ["/sys/fs/cgroup"];
  while (directories.length > 0) {
    const directory = directories.pop()!;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const path = join(directory, entry.name);
      directories.push(path);
      if (/^jig-[0-9a-f]{24}\.scope$/.test(entry.name) || entry.name.startsWith("jig-run-")) {
        residue.push(`cgroup:${path}`);
      }
    }
  }

  for (const root of [tmpdir(), runtimeTemporary]) {
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (entry.name.startsWith("jig-rootless-control-") ||
          entry.name.startsWith("jig-rootless-owner-") ||
          entry.name.startsWith("jig-rootless-devices-")) {
        residue.push(`temporary:${join(root, entry.name)}`);
      }
    }
  }
  for (const entry of await readdir("/dev", { withFileTypes: true })) {
    if (entry.name.startsWith(".jig-") && entry.name.endsWith("-devices")) {
      residue.push(`device:/dev/${entry.name}`);
    }
  }
  return residue.sort();
}

async function fixedSystemctl(): Promise<string> {
  for (const candidate of ["/usr/bin/systemctl", "/bin/systemctl"] as const) {
    try {
      const canonical = await realpath(candidate);
      const information = await stat(canonical);
      if (isAbsolute(canonical) && information.isFile() && (information.mode & 0o111) !== 0 &&
          (information.mode & 0o6000) === 0) {
        return canonical;
      }
    } catch {
      // The acceptance gate shares the product's closed candidate set.
    }
  }
  throw new Error("the fixed user service manager control is unavailable");
}
