import { expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { realpath, rm, stat } from "node:fs/promises";

import {
  acquireOrReexecutePrivateRootlessLinux,
  reexecutePrivateRootlessLinuxCommand,
} from "../src/internal/linux-rootless-delegation.js";

const hostile = process.env.JIG_LINUX_ROOTLESS_HOSTILE === "1" ? test : test.skip;

hostile("continues in the already delegated process without reexecution", async () => {
  const processId = process.pid;
  const result = await acquireOrReexecutePrivateRootlessLinux();

  expect(result.kind).toBe("private-rootless-linux-ready/1");
  expect(process.pid).toBe(processId);
});

hostile("prepares and collects one real transient delegated user scope", async () => {
  const manager = await fixedManager();
  const unit = `jig-${randomBytes(12).toString("hex")}.scope`;
  const moduleUrl = new URL("../src/internal/linux-rootless-delegation.ts", import.meta.url).href;
  const resultPath = `/tmp/jig-rootless-result-${randomBytes(12).toString("hex")}.json`;
  const script = [
    `import { acquireOrReexecutePrivateRootlessLinux } from ${JSON.stringify(moduleUrl)};`,
    "import { writeFile } from 'node:fs/promises';",
    "const result = await acquireOrReexecutePrivateRootlessLinux();",
    "const cgroup = await Bun.file('/proc/self/cgroup').text();",
    `await writeFile(${JSON.stringify(resultPath)}, JSON.stringify({ result, cgroup }), { mode: 0o600 });`,
  ].join("\n");
  try {
    const execution = await reexecutePrivateRootlessLinuxCommand(
      manager,
      unit,
      [process.execPath, "--no-env-file", "--no-install", "--config=/dev/null", "-e", script],
      "/",
      process.env,
    );
    expect(execution).toMatchObject({ exitCode: 0, signal: null });
    const output = JSON.parse(await Bun.file(resultPath).text()) as {
      readonly result: {
        readonly kind: string;
        readonly observation: { readonly delegatedCgroup: string; readonly currentCgroup: string };
      };
      readonly cgroup: string;
    };
    expect(output.result.kind).toBe("private-rootless-linux-ready/1");
    expect(output.result.observation.delegatedCgroup.endsWith(`/${unit}`)).toBe(true);
    expect(output.result.observation.currentCgroup).toBe(
      `${output.result.observation.delegatedCgroup}/jig`,
    );
    expect(output.cgroup).toBe(
      `0::${output.result.observation.currentCgroup.slice("/sys/fs/cgroup".length)}\n`,
    );
    await expectAbsent(output.result.observation.delegatedCgroup);
  } finally {
    await rm(resultPath, { force: true });
  }
});

hostile("keeps support identity stable while transient launch authority changes", async () => {
  const manager = await fixedManager();
  const delegationUrl = new URL("../src/internal/linux-rootless-delegation.ts", import.meta.url).href;
  const backendUrl = new URL("../src/internal/linux-rootless-backend.ts", import.meta.url).href;
  const results = [
    `/tmp/jig-rootless-mechanism-${randomBytes(12).toString("hex")}.json`,
    `/tmp/jig-rootless-mechanism-${randomBytes(12).toString("hex")}.json`,
  ] as const;
  try {
    for (const resultPath of results) {
      const unit = `jig-${randomBytes(12).toString("hex")}.scope`;
      const script = [
        `import { acquireOrReexecutePrivateRootlessLinux } from ${JSON.stringify(delegationUrl)};`,
        `import { PrivateLinuxCgroupBackend } from ${JSON.stringify(backendUrl)};`,
        "import { realpath, writeFile } from 'node:fs/promises';",
        "import { dirname } from 'node:path';",
        "const acquired = await acquireOrReexecutePrivateRootlessLinux();",
        "if (acquired.kind !== 'private-rootless-linux-ready/1') throw new Error('not ready');",
        "const loader = await realpath('/lib64/ld-linux-x86-64.so.2');",
        "const backend = new PrivateLinuxCgroupBackend({",
        "  bunPath: await realpath(process.execPath), bunHostLibraryPath: dirname(loader),",
        "});",
        "const observation = await backend.observeMechanism();",
        `await writeFile(${JSON.stringify(resultPath)}, JSON.stringify(observation), { mode: 0o600 });`,
      ].join("\n");
      const execution = await reexecutePrivateRootlessLinuxCommand(
        manager,
        unit,
        [process.execPath, "--no-env-file", "--no-install", "--config=/dev/null", "-e", script],
        "/",
        process.env,
        2_000,
        10_000,
      );
      expect(execution).toMatchObject({ exitCode: 0, signal: null });
    }

    const first = JSON.parse(await Bun.file(results[0]).text()) as {
      readonly support: Readonly<Record<string, unknown>>;
      readonly authority: { readonly delegatedCgroup: string; readonly delegatedCgroupInode: string };
    };
    const second = JSON.parse(await Bun.file(results[1]).text()) as typeof first;
    expect(first.support).toEqual(second.support);
    expect(first.authority.delegatedCgroup).not.toBe(second.authority.delegatedCgroup);
    expect(first.authority.delegatedCgroupInode).not.toBe(second.authority.delegatedCgroupInode);
  } finally {
    await Promise.all(results.map((path) => rm(path, { force: true })));
  }
});

hostile("manager lifetime timer collects a no-ack scope after wrapper loss", async () => {
  const manager = await fixedManager();
  const control = await fixedControl();
  const unit = `jig-${randomBytes(12).toString("hex")}.scope`;
  const moduleUrl = new URL("../src/internal/linux-rootless-delegation.ts", import.meta.url).href;
  const script = [
    `import { reexecutePrivateRootlessLinuxCommand } from ${JSON.stringify(moduleUrl)};`,
    `await reexecutePrivateRootlessLinuxCommand(${JSON.stringify(manager)}, ${JSON.stringify(unit)},`,
    "  ['/bin/sleep', '30'], '/', process.env, 250, 600);",
  ].join("\n");
  const wrapper = Bun.spawn([
    process.execPath,
    "--no-env-file",
    "--no-install",
    "--config=/dev/null",
    "-e",
    script,
  ], { cwd: "/", env: process.env, stdin: "ignore", stdout: "ignore", stderr: "ignore" });

  const cgroup = await waitForControlGroup(control, unit, 2_000);
  wrapper.kill(9);
  await wrapper.exited;
  await expectManagerUnitsAbsent(control, unit, 3_000);
  await expectAbsent(cgroup);
});

for (const signal of ["SIGKILL", "SIGTERM"] as const) {
  hostile(`lifetime channel kills the acknowledged scope and fork after wrapper ${signal}`, async () => {
    const manager = await fixedManager();
    const control = await fixedControl();
    const unit = `jig-${randomBytes(12).toString("hex")}.scope`;
    const readyPath = `/tmp/jig-rootless-lifetime-${randomBytes(12).toString("hex")}.json`;
    const wrapper = spawnAcknowledgedWrapper(manager, unit, readyPath, 2_000);
    try {
      const ready = await waitForJsonFile(readyPath, 2_000) as AcknowledgedWitness;
      const lifetime = `${unit.slice(0, -".scope".length)}-lifetime`;
      expect((await managerProperties(control, `${lifetime}.timer`)).activeState).toBe("active");
      wrapper.kill(signal);
      await wrapper.exited;

      await expectAbsent(ready.delegatedCgroup, 1_000);
      await expectProcessAbsent(ready.forkPid, 1_000);
      await expectManagerUnitsAbsent(control, unit, 3_000);
    } finally {
      wrapper.kill(9);
      await forceCollect(control, unit);
      await rm(readyPath, { force: true });
    }
  });
}

hostile("lifetime timer fences simultaneous wrapper and coordinator loss", async () => {
  const manager = await fixedManager();
  const control = await fixedControl();
  const unit = `jig-${randomBytes(12).toString("hex")}.scope`;
  const readyPath = `/tmp/jig-rootless-dual-loss-${randomBytes(12).toString("hex")}.json`;
  const wrapper = spawnAcknowledgedWrapper(manager, unit, readyPath, 2_000);
  let ready: AcknowledgedWitness | undefined;
  try {
    ready = await waitForJsonFile(readyPath, 2_000) as AcknowledgedWitness;
    process.kill(ready.coordinatorPid, "SIGSTOP");
    wrapper.kill(9);
    await wrapper.exited;
    process.kill(ready.coordinatorPid, "SIGKILL");
    await pause(100);

    expectProcessPresent(ready.forkPid);
    await expectManagerUnitsAbsent(control, unit, 3_000);
    await expectAbsent(ready.delegatedCgroup);
    await expectProcessAbsent(ready.forkPid, 2_000);
  } finally {
    wrapper.kill(9);
    forceKill(ready?.coordinatorPid);
    forceKill(ready?.forkPid);
    await forceCollect(control, unit);
    await rm(readyPath, { force: true });
  }
});

hostile("lifetime timer fences a stopped coordinator after wrapper loss", async () => {
  const manager = await fixedManager();
  const control = await fixedControl();
  const unit = `jig-${randomBytes(12).toString("hex")}.scope`;
  const readyPath = `/tmp/jig-rootless-stopped-${randomBytes(12).toString("hex")}.json`;
  const wrapper = spawnAcknowledgedWrapper(manager, unit, readyPath, 1_000);
  let ready: AcknowledgedWitness | undefined;
  try {
    ready = await waitForJsonFile(readyPath, 2_000) as AcknowledgedWitness;
    process.kill(ready.coordinatorPid, "SIGSTOP");
    wrapper.kill(9);
    await wrapper.exited;

    await expectManagerUnitsAbsent(control, unit, 3_000);
    await expectAbsent(ready.delegatedCgroup);
    await expectProcessAbsent(ready.coordinatorPid, 2_000);
    await expectProcessAbsent(ready.forkPid, 2_000);
  } finally {
    wrapper.kill(9);
    forceKill(ready?.coordinatorPid);
    forceKill(ready?.forkPid);
    await forceCollect(control, unit);
    await rm(readyPath, { force: true });
  }
});

hostile("lifetime timer enforces the complete command lifetime", async () => {
  const manager = await fixedManager();
  const control = await fixedControl();
  const unit = `jig-${randomBytes(12).toString("hex")}.scope`;
  const readyPath = `/tmp/jig-rootless-hard-lifetime-${randomBytes(12).toString("hex")}.json`;
  const command = acknowledgedCommand(readyPath);
  let ready: AcknowledgedWitness | undefined;
  try {
    const executionPromise = reexecutePrivateRootlessLinuxCommand(
      manager,
      unit,
      command,
      "/",
      process.env,
      2_000,
      750,
    );
    ready = await waitForJsonFile(readyPath, 2_000) as AcknowledgedWitness;
    const execution = await executionPromise;

    expect(execution.exitCode !== 0 || execution.signal !== null).toBe(true);
    await expectManagerUnitsAbsent(control, unit, 2_000);
    await expectAbsent(ready.delegatedCgroup);
    await expectProcessAbsent(ready.coordinatorPid, 2_000);
    await expectProcessAbsent(ready.forkPid, 2_000);
  } finally {
    forceKill(ready?.coordinatorPid);
    forceKill(ready?.forkPid);
    await forceCollect(control, unit);
    await rm(readyPath, { force: true });
  }
});

hostile("collects silent no-ack and immediate child or manager start failures", async () => {
  const manager = await fixedManager();
  const control = await fixedControl();
  for (const [label, launchManager, command] of [
    ["silent", manager, ["/bin/sleep", "30"]],
    ["child", manager, ["/bin/false"]],
    ["manager", "/bin/false", ["/bin/true"]],
  ] as const) {
    const unit = `jig-${randomBytes(12).toString("hex")}.scope`;
    const failure = await reexecutePrivateRootlessLinuxCommand(
      launchManager,
      unit,
      command,
      "/",
      process.env,
      250,
      1_000,
    ).then(() => undefined, (error) => error);
    expect(failure, label).toBeInstanceOf(Error);
    await expectManagerUnitsAbsent(control, unit);
  }
});

hostile("repeats transient acquisition without scope, timer, process, or cgroup residue", async () => {
  const manager = await fixedManager();
  const control = await fixedControl();
  const moduleUrl = new URL("../src/internal/linux-rootless-delegation.ts", import.meta.url).href;
  const script = [
    `import { acquireOrReexecutePrivateRootlessLinux } from ${JSON.stringify(moduleUrl)};`,
    "const result = await acquireOrReexecutePrivateRootlessLinux();",
    "if (result.kind !== 'private-rootless-linux-ready/1') throw new Error('not ready');",
  ].join("\n");

  for (let index = 0; index < 5; index += 1) {
    const unit = `jig-${randomBytes(12).toString("hex")}.scope`;
    const result = await reexecutePrivateRootlessLinuxCommand(
      manager,
      unit,
      [process.execPath, "--no-env-file", "--no-install", "--config=/dev/null", "-e", script],
      "/",
      process.env,
      2_000,
      5_000,
    );
    expect(result).toMatchObject({ exitCode: 0, signal: null });
    await expectManagerUnitsAbsent(control, unit);
  }
});

interface AcknowledgedWitness {
  readonly delegatedCgroup: string;
  readonly coordinatorPid: number;
  readonly forkPid: number;
}

function acknowledgedCommand(readyPath: string): [string, ...string[]] {
  const moduleUrl = new URL("../src/internal/linux-rootless-delegation.ts", import.meta.url).href;
  const childScript = [
    `import { acquireOrReexecutePrivateRootlessLinux } from ${JSON.stringify(moduleUrl)};`,
    "import { writeFile } from 'node:fs/promises';",
    "const result = await acquireOrReexecutePrivateRootlessLinux();",
    "if (result.kind !== 'private-rootless-linux-ready/1') throw new Error('not ready');",
    "const fork = Bun.spawn(['/bin/sleep', '30'], { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' });",
    `await writeFile(${JSON.stringify(readyPath)}, JSON.stringify({`,
    "  delegatedCgroup: result.observation.delegatedCgroup, coordinatorPid: process.pid, forkPid: fork.pid,",
    "}), { mode: 0o600 });",
    "await new Promise((resolve) => setTimeout(resolve, 30_000));",
  ].join("\n");
  return [
    process.execPath,
    "--no-env-file",
    "--no-install",
    "--config=/dev/null",
    "-e",
    childScript,
  ];
}

function spawnAcknowledgedWrapper(
  manager: string,
  unit: string,
  readyPath: string,
  lifetimeMs: number,
): ReturnType<typeof Bun.spawn> {
  const moduleUrl = new URL("../src/internal/linux-rootless-delegation.ts", import.meta.url).href;
  const wrapperScript = [
    `import { reexecutePrivateRootlessLinuxCommand } from ${JSON.stringify(moduleUrl)};`,
    `await reexecutePrivateRootlessLinuxCommand(${JSON.stringify(manager)}, ${JSON.stringify(unit)},`,
    `  [${acknowledgedCommand(readyPath).map((value) => JSON.stringify(value)).join(", ")}],`,
    `  '/', process.env, 2_000, ${lifetimeMs});`,
  ].join("\n");
  return Bun.spawn([
    process.execPath,
    "--no-env-file",
    "--no-install",
    "--config=/dev/null",
    "-e",
    wrapperScript,
  ], { cwd: "/", env: process.env, stdin: "ignore", stdout: "ignore", stderr: "ignore" });
}

function expectProcessPresent(processId: number): void {
  expect(() => process.kill(processId, 0)).not.toThrow();
}

function forceKill(processId: number | undefined): void {
  if (processId === undefined) return;
  try {
    process.kill(processId, "SIGKILL");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}

async function forceCollect(control: string, scope: string): Promise<void> {
  const lifetime = `${scope.slice(0, -".scope".length)}-lifetime`;
  for (const arguments_ of [
    ["--user", "kill", "--kill-whom=all", "--signal=KILL", scope],
    ["--user", "stop", scope],
    ["--user", "stop", `${lifetime}.timer`],
    ["--user", "stop", `${lifetime}.service`],
  ] as const) {
    const child = Bun.spawn([control, ...arguments_], {
      cwd: "/",
      env: process.env,
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
    });
    await child.exited;
  }
}

async function fixedManager(): Promise<string> {
  for (const candidate of ["/usr/bin/systemd-run", "/bin/systemd-run"] as const) {
    try {
      const resolved = await realpath(candidate);
      if ((await stat(resolved)).isFile()) return resolved;
    } catch {
      // The product uses the same closed candidate list.
    }
  }
  throw new Error("fixed systemd-run candidate is unavailable");
}

async function fixedControl(): Promise<string> {
  for (const candidate of ["/usr/bin/systemctl", "/bin/systemctl"] as const) {
    try {
      const resolved = await realpath(candidate);
      if ((await stat(resolved)).isFile()) return resolved;
    } catch {
      // The product uses the same closed candidate list.
    }
  }
  throw new Error("fixed systemctl candidate is unavailable");
}

async function managerProperties(control: string, unit: string): Promise<{
  readonly loadState: string;
  readonly activeState: string;
  readonly controlGroup: string;
}> {
  const child = Bun.spawn([
    control,
    "--user",
    "show",
    "--property=LoadState,ActiveState,ControlGroup",
    unit,
  ], { cwd: "/", env: process.env, stdin: "ignore", stdout: "pipe", stderr: "ignore" });
  const stdout = await new Response(child.stdout).text();
  await child.exited;
  const values = new Map(stdout.trim().split("\n").map((line) => {
    const separator = line.indexOf("=");
    return separator < 1 ? [line, ""] : [line.slice(0, separator), line.slice(separator + 1)];
  }));
  return {
    loadState: values.get("LoadState") ?? "",
    activeState: values.get("ActiveState") ?? "",
    controlGroup: values.get("ControlGroup") ?? "",
  };
}

async function waitForControlGroup(control: string, unit: string, timeoutMs: number): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const observation = await managerProperties(control, unit);
    if (observation.controlGroup !== "") return `/sys/fs/cgroup${observation.controlGroup}`;
    if (Date.now() >= deadline) throw new Error(`transient scope did not appear: ${unit}`);
    await pause(20);
  }
}

async function expectManagerUnitsAbsent(control: string, scope: string, timeoutMs = 2_000): Promise<void> {
  const lifetime = `${scope.slice(0, -".scope".length)}-lifetime`;
  const units = [scope, `${lifetime}.timer`, `${lifetime}.service`];
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const states = await Promise.all(units.map(async (unit) => (await managerProperties(control, unit)).loadState));
    if (states.every((state) => state === "not-found")) return;
    if (Date.now() >= deadline) throw new Error(`transient manager units remained: ${units.join(", ")}`);
    await pause(20);
  }
}

async function waitForJsonFile(path: string, timeoutMs: number): Promise<unknown> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      return JSON.parse(await Bun.file(path).text());
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
    }
    if (Date.now() >= deadline) throw new Error(`lifetime witness was not written: ${path}`);
    await pause(20);
  }
}

async function expectProcessAbsent(processId: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      process.kill(processId, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") return;
      throw error;
    }
    if (Date.now() >= deadline) throw new Error(`forked process remained after scope loss: ${processId}`);
    await pause(20);
  }
}


async function expectAbsent(path: string, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      await stat(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    if (Date.now() >= deadline) throw new Error(`transient scope remained after collection: ${path}`);
    await pause(20);
  }
}

function pause(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
