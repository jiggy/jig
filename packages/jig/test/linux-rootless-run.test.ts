import { afterAll, describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  PrivateLinuxCgroupBackend,
  PrivateLinuxFenceUnconfirmedError,
  requirePrivateLinuxMechanismUnchanged,
  releasePrivateLinuxOwnerState,
  type PrivateLinuxReadOnlyMount,
  type PrivateLinuxLaunchPlan,
} from "../src/internal/linux-rootless-backend.js";
import { RunHostSession } from "../src/run/session.js";

const HOSTILE = process.env.JIG_LINUX_ROOTLESS_HOSTILE === "1";
const hostileDescribe = HOSTILE ? describe.serial : describe.skip;
const delegatedCgroup = process.env.AGENT_DELEGATED_CGROUP;
const delegatedDescribe = delegatedCgroup === undefined ? describe.skip : describe;
const initialRootlessTemporaryState = new Set(
  (await readdir(tmpdir())).filter(rootlessTemporaryEntry),
);
let portableBunRoot: string | undefined;
let portableBunPromise: Promise<string> | undefined;

afterAll(async () => {
  if (portableBunRoot !== undefined) await rm(portableBunRoot, { recursive: true, force: true });
});

delegatedDescribe("private rootless Linux Run", () => {
  test("preflights and executes one isolated payload", async () => {
    const host = await hostConfiguration();
    const fixture = await createFixture(`
      import { dlopen, FFIType } from "bun:ffi";
      import { chmodSync, existsSync, readFileSync, statSync } from "node:fs";
      const status = readFileSync("/proc/self/status", "utf8");
      const nspid = status.split("\\n").find((line) => line.startsWith("NSpid:"));
      const libc = dlopen("/jig-runtime/lib/libc.so.6", {
        unshare: { args: [FFIType.i32], returns: FFIType.i32 },
      });
      const nestedUserDenied = libc.symbols.unshare(0x10000000) === -1;
      libc.close();
      let deviceMutationDenied = false;
      try { chmodSync("/dev/urandom", 0o777); } catch { deviceMutationDenied = true; }
      console.log(JSON.stringify({
        cgroupVisible: existsSync("/sys/fs/cgroup/cgroup.procs"),
        deviceMutationDenied,
        nestedUserDenied,
        networkRoutes: readFileSync("/proc/net/route", "utf8").trim().split("\\n").length,
        nullMode: statSync("/dev/null").mode & 0o777,
        urandomMode: statSync("/dev/urandom").mode & 0o777,
        nspid,
        uid: process.getuid?.(),
        gid: process.getgid?.(),
      }));
    `);
    try {
      const component = await host.backend.launch(plan(host, fixture, "normal"));
      await component.closeInput();
      const [stdout, stderr, completion] = await Promise.all([
        collect(component.stdout),
        collect(component.stderr),
        component.completion,
      ]);
      expect(stderr).toBe("");
      expect(completion).toMatchObject({ exitCode: 0, signal: null, fenced: true, stopReason: "payload_exit" });
      expect(component.envelope.network).toBe("isolated");
      const isolation = JSON.parse(stdout) as { readonly nspid: string };
      expect(isolation).toMatchObject({
        cgroupVisible: false,
        deviceMutationDenied: true,
        nestedUserDenied: true,
        networkRoutes: 1,
        nullMode: 0o666,
        urandomMode: 0o666,
        uid: process.getuid?.() ?? 1_000,
        gid: process.getgid?.() ?? 100,
      });
      expect(isolation.nspid.trim().split(/\s+/)).toHaveLength(2);
      expect((await stat("/dev/urandom")).mode & 0o777).toBe(0o666);
      expect(await missing(component.cgroup.runCgroup)).toBe(true);
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });

  test("executes one FLOW Run/1 component through the rootless envelope", async () => {
    const host = await hostConfiguration();
    const fixture = await createFixture(`
      import { serve } from "/flow-sdk/src/index.ts";
      await serve(async (run) => ({ outcome: "done", output: { input: run.input, settings: run.settings } }));
    `);
    const sdk = fileURLToPath(new URL("../../flow-sdk", import.meta.url));
    try {
      const base = plan(host, fixture, "run-wire");
      const component = await host.backend.launch({
        ...base,
        readOnlyMounts: [...base.readOnlyMounts, { source: sdk, destination: "/flow-sdk" }],
      });
      const terminal = await new RunHostSession(component, {
        input: { request: "hello" },
        settings: { mode: "proof" },
        attachments: {},
        scratch: "/tmp/run",
        deadlineUnixMs: Date.now() + 4_000,
      }).run();
      expect(terminal).toMatchObject({
        status: "succeeded",
        result: {
          outcome: "done",
          output: { input: { request: "hello" }, settings: { mode: "proof" } },
        },
      });
      expect(await missing(component.cgroup.runCgroup)).toBe(true);
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });

  test("rejects mount aliases into protected host or payload namespaces", async () => {
    const host = await hostConfiguration();
    const fixture = await createFixture("console.log('unreachable');");
    try {
      const base = plan(host, fixture, "bad-mount");
      await expect(host.backend.launch({
        ...base,
        readOnlyMounts: [{ source: fixture, destination: "/work/../sys" }],
      })).rejects.toThrow("rootless Linux read-only mount is invalid");
      await expect(host.backend.launch({
        ...base,
        readOnlyMounts: [{ source: "/proc", destination: "/host-proc" }],
      })).rejects.toThrow("host pseudo-filesystem cannot enter the rootless sandbox");
      await waitForNoRunCgroups();
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });

  test("rejects changed launch authority under the same support identity", async () => {
    const host = await hostConfiguration();
    const sealed = await host.backend.observeMechanism();
    const changed = Object.freeze({
      support: sealed.support,
      authority: Object.freeze({
        ...sealed.authority,
        delegatedCgroupInode: String(BigInt(sealed.authority.delegatedCgroupInode) + 1n),
      }),
    });

    expect(() => requirePrivateLinuxMechanismUnchanged(sealed, sealed)).not.toThrow();
    expect(() => requirePrivateLinuxMechanismUnchanged(sealed, changed)).toThrow(
      "rootless Linux mechanism changed after sealing",
    );
  });

  test("recovers and releases an unadmitted owner on the same boot", async () => {
    const host = await hostConfiguration();
    const fixture = await createFixture("console.log('unreachable');");
    const ownerStateParent = await mkdtemp(join(tmpdir(), "jig-rootless-same-boot-owner-"));
    try {
      const owner = await host.backend.seal(plan(host, fixture, "same-boot-recovery"), {
        parent: ownerStateParent,
        name: "owner",
      });
      const receipt = await host.backend.recoverFence(owner.identity);
      expect(receipt).toMatchObject({ fenced: true, stopReason: "recovered" });
      await releasePrivateLinuxOwnerState(owner.identity, receipt);
      expect(await missing(owner.identity.ownerStateDirectory)).toBe(true);
    } finally {
      await rm(fixture, { recursive: true, force: true });
      await rm(ownerStateParent, { recursive: true, force: true });
    }
  });
});

hostileDescribe("private rootless Linux hostile envelope", () => {
  afterAll(async () => {
    if (delegatedCgroup === undefined) return;
    const entries = await Array.fromAsync(new Bun.Glob("jig-run-*").scan({ cwd: delegatedCgroup, onlyFiles: false }));
    expect(entries).toEqual([]);
    expect((await readdir(tmpdir())).filter(rootlessTemporaryEntry)
      .filter((entry) => !initialRootlessTemporaryState.has(entry))).toEqual([]);
    expect((await readdir("/dev")).filter((entry) =>
      entry.startsWith(".jig-") && entry.endsWith("-devices")
    )).toEqual([]);
  });

  test("enforces cancellation and removes the complete Run", async () => {
    const host = await hostConfiguration();
    const fixture = await createFixture("await new Promise(() => {});");
    try {
      const component = await host.backend.launch(plan(host, fixture, "cancel"));
      await component.terminate();
      const completion = await component.completion;
      expect(completion).toMatchObject({ fenced: true, stopReason: "cancelled" });
      expect(await missing(component.cgroup.runCgroup)).toBe(true);
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });

  test("enforces aggregate PID limits", async () => {
    const host = await hostConfiguration();
    const fixture = await createFixture(`
      const children = [];
      for (let index = 0; index < 128; index += 1) {
        try {
          children.push(Bun.spawn([
            process.execPath,
            "--no-env-file", "--no-install", "--config=/dev/null",
            "-e", "await new Promise(() => {})",
          ], { stdout: "ignore", stderr: "ignore" }));
        } catch {}
      }
      await Bun.sleep(100);
    `);
    try {
      const component = await host.backend.launch(plan(host, fixture, "pids", { pids: 24 }));
      const [completion, evidence] = await Promise.all([component.completion, component.evidence]);
      expect(completion.fenced).toBe(true);
      expect(evidence.pidsEvents.max).toBeGreaterThan(0);
      expect(await missing(component.cgroup.runCgroup)).toBe(true);
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });

  test("enforces aggregate descendant memory limits", async () => {
    const host = await hostConfiguration();
    const fixture = await createFixture(`
      const children = Array.from({ length: 4 }, () => Bun.spawn([
        process.execPath,
        "--no-env-file", "--no-install", "--config=/dev/null",
        "-e", "const chunks=[]; for (;;) { chunks.push(Buffer.alloc(16*1024*1024, 1)); await Bun.sleep(1); }",
      ], { stdout: "ignore", stderr: "ignore" }));
      await Promise.all(children.map((child) => child.exited));
    `);
    try {
      const component = await host.backend.launch(plan(host, fixture, "memory", {
        memoryBytes: 192 * 1024 * 1024,
        pids: 256,
        cpuQuotaMicros: 100_000,
        deadlineMs: 8_000,
      }));
      const [completion, evidence] = await Promise.all([component.completion, component.evidence]);
      expect(completion.fenced).toBe(true);
      expect(evidence.memoryEvents.max).toBeGreaterThan(0);
      expect(await missing(component.cgroup.runCgroup)).toBe(true);
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });

  test("throttles aggregate CPU and independently enforces the wall deadline", async () => {
    const host = await hostConfiguration();
    const fixture = await createFixture(`
      for (let index = 0; index < 4; index += 1) {
        Bun.spawn([process.execPath, "--no-env-file", "--no-install", "--config=/dev/null", "-e", "for (;;) {}"], {
          stdout: "ignore", stderr: "ignore",
        });
      }
      for (;;) {}
    `);
    try {
      const started = Date.now();
      const component = await host.backend.launch(plan(host, fixture, "cpu", {
        cpuQuotaMicros: 10_000,
        deadlineMs: 2_500,
      }));
      const [completion, evidence] = await Promise.all([component.completion, component.evidence]);
      expect(completion).toMatchObject({ fenced: true, stopReason: "deadline" });
      expect(Date.now() - started).toBeLessThan(6_000);
      expect(evidence.cpuStat.nr_throttled).toBeGreaterThan(0);
      expect(await missing(component.cgroup.runCgroup)).toBe(true);
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });

  test("settles the entry child before publishing a pre-readiness deadline fence", async () => {
    const host = await hostConfiguration();
    const fixture = await createFixture("console.log('unreachable');");
    const ownerStateParent = await mkdtemp(join(tmpdir(), "jig-rootless-deadline-owner-"));
    const enteredMarker = join(ownerStateParent, "entry-entered");
    const settledMarker = join(ownerStateParent, "entry-settled");
    const delayedSupervisor = await delayedReadinessSupervisor(enteredMarker, settledMarker);
    const backend = new PrivateLinuxCgroupBackend({
      bunPath: host.bun,
      bunHostLibraryPath: host.bunHostLibraryPath,
      supervisorPath: delayedSupervisor.path,
    });
    const launchPlan = plan(host, fixture, "readiness-deadline", { deadlineMs: 8_000 });
    const owner = await backend.seal(launchPlan, {
      parent: ownerStateParent,
      name: "deadline-owner",
    });
    let released = false;
    try {
      await expect(owner.admit()).rejects.toThrow();
      expect(await readFile(enteredMarker, "utf8")).toBe("entered\n");
      expect(await readFile(settledMarker, "utf8")).toBe("settled\n");

      const receipt = await waitForFence(backend, owner.identity, 5_000);
      expect(receipt).toMatchObject({ fenced: true, stopReason: "deadline" });
      expect(await missing(owner.identity.runCgroup)).toBe(true);
      await releasePrivateLinuxOwnerState(owner.identity, receipt);
      released = true;
      await waitForNoRunCgroups();
    } finally {
      if (released) {
        await rm(fixture, { recursive: true, force: true });
        await rm(delayedSupervisor.root, { recursive: true, force: true });
        await rm(ownerStateParent, { recursive: true, force: true });
      }
    }
  });

  test("cancels during prepared admission without starting package code", async () => {
    const host = await hostConfiguration();
    const marker = join(await mkdtemp(join(tmpdir(), "jig-rootless-marker-")), "ran");
    const fixture = await createFixture(`await Bun.write(${JSON.stringify(marker)}, "ran");`);
    const controller = new AbortController();
    try {
      const owner = await host.backend.seal(plan(host, fixture, "startup-cancel"));
      await expect(owner.admit(
        controller.signal,
        async () => controller.abort(),
      )).rejects.toThrow("cancelled before admission");
      expect(await missing(marker)).toBe(true);
      await waitForNoRunCgroups();
    } finally {
      await rm(fixture, { recursive: true, force: true });
      await rm(join(marker, ".."), { recursive: true, force: true });
    }
  });

  test("fences orphaned grandchildren on cancellation", async () => {
    const host = await hostConfiguration();
    const fixture = await createFixture(`
      Bun.spawn([
        process.execPath,
        "--no-env-file", "--no-install", "--config=/dev/null",
        "-e", "Bun.spawn([process.execPath, '--no-env-file', '--no-install', '--config=/dev/null', '-e', 'await new Promise(() => {})'], {stdout:'ignore',stderr:'ignore'}); await new Promise(() => {})",
      ], { stdout: "ignore", stderr: "ignore" });
      await new Promise(() => {});
    `);
    try {
      const component = await host.backend.launch(plan(host, fixture, "grandchild"));
      await Bun.sleep(100);
      await component.terminate();
      expect(await component.completion).toMatchObject({ fenced: true, stopReason: "cancelled" });
      expect(await missing(component.cgroup.runCgroup)).toBe(true);
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });

  test("settles a cancellation racing payload shutdown", async () => {
    const host = await hostConfiguration();
    const fixture = await createFixture("await Bun.sleep(25);");
    try {
      const component = await host.backend.launch(plan(host, fixture, "shutdown-cancel"));
      await Bun.sleep(20);
      await component.terminate();
      expect(await component.completion).toMatchObject({ fenced: true });
      expect(await missing(component.cgroup.runCgroup)).toBe(true);
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });

  test("survives coordinator death and fences its Run", async () => {
    const host = await hostConfiguration();
    const fixture = await createFixture("await new Promise(() => {});");
    const configurationDirectory = await mkdtemp(join(tmpdir(), "jig-rootless-coordinator-"));
    const ownerStateParent = await mkdtemp(join(tmpdir(), "jig-rootless-coordinator-owner-"));
    const configuration = join(configurationDirectory, "configuration.json");
    await writeFile(configuration, JSON.stringify({
      delegatedCgroup,
      bunPath: host.bun,
      bunHostLibraryPath: host.bunHostLibraryPath,
      bubblewrapPath: await realpath("/usr/bin/bwrap"),
      mounts: host.mounts,
      fixture,
      ownerStateParent,
      uid: process.getuid?.() ?? 1_000,
      gid: process.getgid?.() ?? 100,
    }));
    const coordinator = spawn(host.bun, [
      "--no-env-file", "--no-install", "--config=/dev/null",
      fileURLToPath(new URL("./fixtures/linux-rootless-coordinator.ts", import.meta.url)),
      configuration,
    ], { stdio: ["ignore", "pipe", "pipe"] });
    try {
      const started = JSON.parse(await readLine(coordinator.stdout!)) as {
        readonly cgroup: string;
        readonly owner: unknown;
      };
      coordinator.kill("SIGKILL");
      await childExit(coordinator);
      await waitForMissing(started.cgroup, 5_000);
      const receipt = await waitForFence(host.backend, started.owner, 5_000);
      await releasePrivateLinuxOwnerState(started.owner, receipt);
    } finally {
      coordinator.kill("SIGKILL");
      await rm(fixture, { recursive: true, force: true });
      await rm(configurationDirectory, { recursive: true, force: true });
      await rm(ownerStateParent, { recursive: true, force: true });
    }
  });

  test("repeats Runs without cgroup residue", async () => {
    const host = await hostConfiguration();
    const fixture = await createFixture("console.log('ok');");
    try {
      for (let index = 0; index < 8; index += 1) {
        const component = await host.backend.launch(plan(host, fixture, `repeat-${index}`));
        expect(await component.completion).toMatchObject({ exitCode: 0, fenced: true });
      }
      await waitForNoRunCgroups();
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });
});

interface HostConfiguration {
  readonly backend: PrivateLinuxCgroupBackend;
  readonly bun: string;
  readonly bunHostLibraryPath: string;
  readonly mounts: readonly PrivateLinuxReadOnlyMount[];
}

async function hostConfiguration(): Promise<HostConfiguration> {
  if (delegatedCgroup === undefined) throw new Error("rootless proof host did not expose its delegated cgroup");
  const bun = await portableBun();
  const loader = await realpath("/lib64/ld-linux-x86-64.so.2");
  const bunHostLibraryPath = dirname(loader);
  const mounts = await runtimeMounts(bun, loader, bunHostLibraryPath);
  return {
    bun,
    bunHostLibraryPath,
    mounts,
    backend: new PrivateLinuxCgroupBackend({ bunPath: bun, bunHostLibraryPath }),
  };
}

async function portableBun(): Promise<string> {
  portableBunPromise ??= (async () => {
    portableBunRoot = await mkdtemp(join(tmpdir(), "jig-portable-bun-"));
    const directory = join(portableBunRoot, "bin");
    await mkdir(directory);
    const destination = join(directory, "jig");
    const source = await realpath(process.execPath);
    const bytes = Buffer.from(await readFile(source));
    const fixedInterpreter = Buffer.from("/lib64/ld-linux-x86-64.so.2\0");
    if (bytes.indexOf(fixedInterpreter) === -1) {
      const hostInterpreter = Buffer.from(`${await realpath("/lib64/ld-linux-x86-64.so.2")}\0`);
      const offset = bytes.indexOf(hostInterpreter);
      if (offset === -1 || fixedInterpreter.length > hostInterpreter.length) {
        throw new Error("proof Bun does not expose a replaceable ELF interpreter");
      }
      bytes.fill(0, offset, offset + hostInterpreter.length);
      fixedInterpreter.copy(bytes, offset);
    }
    await writeFile(destination, bytes, { mode: 0o755 });
    return await realpath(destination);
  })();
  return await portableBunPromise;
}

function plan(
  host: HostConfiguration,
  fixture: string,
  runId: string,
  overrides: {
    readonly memoryBytes?: number;
    readonly pids?: number;
    readonly cpuQuotaMicros?: number;
    readonly deadlineMs?: number;
  } = {},
): PrivateLinuxLaunchPlan {
  return {
    runId,
    limits: {
      memoryBytes: overrides.memoryBytes ?? 256 * 1024 * 1024,
      pids: overrides.pids ?? 64,
      cpuQuotaMicros: overrides.cpuQuotaMicros ?? 50_000,
      cpuPeriodMicros: 100_000,
      deadlineUnixMs: Date.now() + (overrides.deadlineMs ?? 5_000),
      cancellationGraceMs: 250,
    },
    readOnlyMounts: [
      ...host.mounts,
      { source: fixture, destination: "/package" },
    ],
    command: ["/jig-runtime/bun", ...["--no-env-file", "--no-install", "--config=/dev/null"], "/package/flow.ts"],
  };
}

async function runtimeMounts(
  bun: string,
  loader: string,
  libraryDirectory: string,
): Promise<readonly PrivateLinuxReadOnlyMount[]> {
  const libraries = ["libc.so.6", "libm.so.6", "libdl.so.2", "libpthread.so.0"];
  return Object.freeze([
    Object.freeze({ source: bun, destination: "/jig-runtime/bun" }),
    Object.freeze({ source: loader, destination: "/lib64/ld-linux-x86-64.so.2" }),
    ...await Promise.all(libraries.map(async (name) => Object.freeze({
      source: await realpath(join(libraryDirectory, name)),
      destination: `/jig-runtime/lib/${name}`,
    }))),
  ]);
}

async function createFixture(source: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "jig-rootless-fixture-"));
  await writeFile(join(directory, "flow.ts"), source, "utf8");
  return directory;
}

async function delayedReadinessSupervisor(enteredMarker: string, settledMarker: string): Promise<{
  readonly path: string;
  readonly root: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "jig-rootless-delayed-supervisor-"));
  const path = join(root, "linux-rootless-supervisor.ts");
  const sourcePath = fileURLToPath(new URL("../src/internal/linux-rootless-supervisor.ts", import.meta.url));
  let source = await readFile(sourcePath, "utf8");
  source = replaceOnce(
    source,
    'import { closeSync, readFileSync, statSync, writeSync } from "node:fs";',
    'import { closeSync, readFileSync, statSync, writeFileSync, writeSync } from "node:fs";',
  );
  source = replaceOnce(
    source,
    "  await requireActiveClaim(ownerStateDirectory!, ownerToken!, ownerStateAllocationDigest!);\n" +
      "  writeSync(3, `${process.pid}\\n`);",
    "  await requireActiveClaim(ownerStateDirectory!, ownerToken!, ownerStateAllocationDigest!);\n" +
      `  writeFileSync(${JSON.stringify(enteredMarker)}, "entered\\n");\n` +
      "  await Bun.sleep(20_000);\n" +
      "  writeSync(3, `${process.pid}\\n`);",
  );
  source = replaceOnce(
    source,
    "    let failure: unknown;",
    '    let failure: unknown = new Error("forced child-close failure");',
  );
  source = replaceOnce(
    source,
    '    child.once("close", (code, signal) => {\n' +
      '      if (failure === undefined) resolve({ code, signal });\n' +
      '      else reject(failure);\n' +
      '    });',
    '    child.once("close", (code, signal) => {\n' +
      '      const timer = setTimeout(() => {\n' +
      `        writeFileSync(${JSON.stringify(settledMarker)}, "settled\\n");\n` +
      '        if (failure === undefined) resolve({ code, signal });\n' +
      '        else reject(failure);\n' +
      '      }, 1_000);\n' +
    '    });',
  );
  await writeFile(path, source, { mode: 0o600 });
  return Object.freeze({ path: await realpath(path), root });
}

function replaceOnce(source: string, pattern: string, replacement: string): string {
  const offset = source.indexOf(pattern);
  if (offset === -1 || source.indexOf(pattern, offset + pattern.length) !== -1) {
    throw new Error("rootless delayed-supervisor fixture no longer matches its trusted source");
  }
  return `${source.slice(0, offset)}${replacement}${source.slice(offset + pattern.length)}`;
}

async function collect(stream: AsyncIterable<Uint8Array>): Promise<string> {
  let result = "";
  for await (const bytes of stream) result += Buffer.from(bytes).toString("utf8");
  return result;
}

async function missing(path: string): Promise<boolean> {
  try {
    await stat(path);
    return false;
  } catch (error) {
    if (error !== null && typeof error === "object" && (error as NodeJS.ErrnoException).code === "ENOENT") {
      return true;
    }
    throw error;
  }
}

async function waitForMissing(path: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    if (await missing(path)) return;
    await Bun.sleep(20);
  }
  throw new Error(`timed out waiting for ${path} removal`);
}

async function waitForNoRunCgroups(): Promise<void> {
  if (delegatedCgroup === undefined) return;
  const deadline = Date.now() + 5_000;
  while (Date.now() <= deadline) {
    const entries = await Array.fromAsync(new Bun.Glob("jig-run-*").scan({ cwd: delegatedCgroup, onlyFiles: false }));
    if (entries.length === 0) return;
    await Bun.sleep(20);
  }
  throw new Error("rootless Runs left cgroup residue");
}

async function readLine(stream: NodeJS.ReadableStream): Promise<string> {
  let buffer = "";
  for await (const chunk of stream) {
    buffer += String(chunk);
    const newline = buffer.indexOf("\n");
    if (newline !== -1) return buffer.slice(0, newline);
    if (buffer.length > 16_384) throw new Error("coordinator output line is too long");
  }
  throw new Error("coordinator exited before reporting its cgroup");
}

async function childExit(child: ReturnType<typeof spawn>): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => child.once("close", () => resolve()));
}

function rootlessTemporaryEntry(entry: string): boolean {
  return entry.startsWith("jig-rootless-control-") ||
    entry.startsWith("jig-rootless-owner-") ||
    entry.startsWith("jig-rootless-deadline-owner-") ||
    entry.startsWith("jig-rootless-delayed-supervisor-");
}

async function waitForFence(
  backend: PrivateLinuxCgroupBackend,
  owner: unknown,
  timeoutMs: number,
) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      return await backend.recoverFence(owner);
    } catch (error) {
      if (!(error instanceof PrivateLinuxFenceUnconfirmedError) || Date.now() > deadline) throw error;
      await Bun.sleep(20);
    }
  }
}
