import { afterAll, describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  PrivateLinuxCgroupBackend,
  type PrivateLinuxLaunchPlan,
} from "../src/internal/linux-cgroup-backend.js";
import { evaluateAuthorClosure } from "../src/project/author-evaluator.js";
import { captureAuthorClosure } from "../src/project/author-module.js";
import { RunHostSession } from "../src/run/session.js";
import { ServiceHostSession } from "../src/service/session.js";

const HOSTILE = process.env.JIG_LINUX_CGROUP_HOSTILE === "1";
const hostileDescribe = HOSTILE ? describe.serial : describe.skip;

describe("private Linux cgroup-v2 plan boundary", () => {
  test("rejects cgroupfs mounts and malformed finite limits before launch", async () => {
    const backend = new PrivateLinuxCgroupBackend({
      cgroupScope: "/sys/fs/cgroup/jig-test-scope",
      sudoPath: "/usr/bin/sudo",
      bunPath: "/usr/bin/bun",
      bubblewrapPath: "/usr/bin/bwrap",
      payloadUid: 1000,
      payloadGid: 1000,
    });
    await expect(backend.launch({
      runId: "unsafe-mount",
      limits: limits(),
      readOnlyMounts: [{ source: "/sys/fs/cgroup", destination: "/host-cgroup" }],
      command: ["/payload"],
    })).rejects.toThrow("host cgroupfs cannot enter the sandbox");
    await expect(backend.launch({
      runId: "invalid-limit",
      limits: { ...limits(), pids: 0 },
      readOnlyMounts: [],
      command: ["/payload"],
    })).rejects.toThrow("pids must be a positive safe integer");
  });
});

hostileDescribe("private Linux cgroup-v2 hostile envelope", () => {
  let host: Awaited<ReturnType<typeof hostConfiguration>>;

  afterAll(async () => {
    if (host === undefined) return;
    const residue = await jigCgroups(host.scope);
    expect(residue).toEqual([]);
  });

  test("hides cgroupfs, prevents migration, and runs as the payload identity", async () => {
    host = await hostConfiguration();
    const result = await run(host, "visibility", [
      "set -eu",
      "test \"$(/bin/id -u)\" = 1000",
      "test \"$(/bin/id -g)\" = 100",
      "test ! -e /sys/fs/cgroup",
      "test ! -e /proc/self/cgroup",
      "! /bin/mkdir /sys 2>/dev/null",
      "! printf 1 > /proc/self/cgroup 2>/tmp/proc-denied",
      "printf envelope-ok",
    ].join("\n"));

    expect(result.stdout).toBe("envelope-ok");
    expect(result.exit).toMatchObject({ exitCode: 0, signal: null, fenced: true });
    await expect(access(result.cgroup.parentCgroup)).rejects.toBeDefined();
  });

  test("contains a fork storm with aggregate pids.max", async () => {
    host = await hostConfiguration();
    const result = await run(host, "fork-storm", [
      `worker=${shellQuote(host.bash)}`,
      "for ((i=0; i<256; i++)); do \"$worker\" -c 'while :; do :; done' & done",
      "wait",
    ].join("\n"), {
      ...limits(),
      pids: 12,
      wallClockMs: 500,
    });

    expect(result.exit.fenced).toBe(true);
    expect(result.evidence.pidsEvents.max).toBeGreaterThan(0);
  });

  test("accounts aggregate descendant memory exhaustion", async () => {
    host = await hostConfiguration();
    const result = await run(host, "memory-bomb", [
      `worker=${shellQuote(host.bash)}`,
      "for ((i=0; i<4; i++)); do \"$worker\" -c 'x=xxxxxxxxxxxxxxxx; while :; do x=$x$x; done' & done",
      "wait",
    ].join("\n"), {
      ...limits(),
      memoryBytes: 32 * 1024 * 1024,
      wallClockMs: 1_500,
    });

    expect(result.exit.fenced).toBe(true);
    expect(result.evidence.memoryEvents.max).toBeGreaterThan(0);
  });

  test("combines CPU throttling with an independent hard wall deadline", async () => {
    host = await hostConfiguration();
    const started = performance.now();
    const result = await run(host, "cpu-deadline", "while :; do :; done", {
      ...limits(),
      cpuQuotaMicros: 10_000,
      cpuPeriodMicros: 100_000,
      wallClockMs: 300,
    });

    expect(performance.now() - started).toBeLessThan(2_000);
    expect(result.exit).toMatchObject({ signal: "SIGKILL", fenced: true });
    expect(result.evidence.cpuStat.nr_throttled).toBeGreaterThan(0);
  });

  test("cancels during startup and shutdown without leaking ownership", async () => {
    host = await hostConfiguration();
    const before = new Set(await jigCgroups(host.scope));
    const abort = new AbortController();
    const launching = backend(host).launch(plan(host, "startup-cancel", "/bin/sleep 10"), abort.signal);
    abort.abort();
    await expect(launching).rejects.toThrow("cancelled during startup");
    await waitUntil(async () => sameMembers(before, new Set(await jigCgroups(host.scope))), 5_000);

    const process = await backend(host).launch(plan(host, "shutdown-cancel", "/bin/sleep 10"));
    void drain(process.stdout);
    void drain(process.stderr);
    await Promise.all([process.terminate(), process.terminate()]);
    expect(await process.completion).toMatchObject({ signal: "SIGKILL", fenced: true });
    await expect(access(process.cgroup.parentCgroup)).rejects.toBeDefined();
  });

  test("fences orphaned grandchildren after the activation root exits", async () => {
    host = await hostConfiguration();
    const result = await run(host, "orphans", [
      `worker=${shellQuote(host.bash)}`,
      ": >/tmp/empty",
      "\"$worker\" -c '\"$0\" -c \"while :; do :; done\" </tmp/empty >/tmp/grandchild 2>&1 &' \"$worker\" >/tmp/child 2>&1 &",
      "exit 0",
    ].join("\n"));

    expect(result.exit).toMatchObject({ exitCode: 0, signal: null, fenced: true });
    await expect(access(result.cgroup.parentCgroup)).rejects.toBeDefined();
  });

  test("reaps after coordinator SIGKILL and remains leak-free across repeated Runs", async () => {
    host = await hostConfiguration();
    const fixture = spawn(
      "/bin/bun",
      [join(import.meta.dir, "fixtures", "linux-cgroup-coordinator.ts")],
      {
        env: {
          ...process.env,
          JIG_TEST_SCOPE: host.scope,
          JIG_TEST_BASH: host.bash,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const line = await firstLine(fixture.stdout!);
    const announced = JSON.parse(line) as { parentCgroup: string };
    fixture.kill("SIGKILL");
    await waitUntil(async () => !(await exists(announced.parentCgroup)), 5_000);

    for (let index = 0; index < 8; index += 1) {
      const result = await run(host, `repeat-${index}`, "exit 0");
      expect(result.exit.fenced).toBe(true);
    }
    expect(await jigCgroups(host.scope)).toEqual([]);
  });

  test("keeps the Bun recipe unavailable when a descendant cannot use root-pinned mappings", async () => {
    host = await hostConfiguration();
    const bun = await bunClosure();
    const component = await backend(host).launch({
      runId: "bun-descendant-gate",
      limits: {
        ...limits(),
        memoryBytes: 256 * 1024 * 1024,
        wallClockMs: 3_000,
      },
      readOnlyMounts: [
        { source: bun.store, destination: bun.store },
        { source: bun.glibcStore, destination: bun.glibcStore },
      ],
      rootProcessMappings: true,
      entropyDevice: true,
      command: [bun.executable, "-e", [
        "const child = Bun.spawn([process.execPath, '-e', 'console.log(\\\"child-ok\\\")'], { stdout: 'pipe', stderr: 'pipe' });",
        "const stdout = await new Response(child.stdout).text();",
        "const stderr = await new Response(child.stderr).text();",
        "console.log(JSON.stringify({ exit: await child.exited, stdout, stderr }));",
      ].join(" ")],
    });
    const stdout = collect(component.stdout);
    const stderr = collect(component.stderr);
    await component.closeInput();
    expect(await component.completion).toMatchObject({ exitCode: 0, fenced: true });
    expect(await stderr).toBe("");
    const child = JSON.parse((await stdout).trim()) as { exit: number; stdout: string; stderr: string };
    expect(child).toEqual({ exit: 134, stdout: "", stderr: "" });
  });

  test("evaluates one captured project declaration in a root-only Bun envelope", async () => {
    host = await hostConfiguration();
    const bun = await bunClosure();
    const distribution = await realpath(join(import.meta.dir, "..", "dist"));
    const root = await mkdtemp(join(tmpdir(), "jig-evaluator-proof-"));
    const evaluator = {
      backend: backend(host),
      bunPath: bun.executable,
      runtimeMounts: [
        { source: bun.store, destination: bun.store },
        { source: bun.glibcStore, destination: bun.glibcStore },
      ],
      runtimeObservation: {
        executableDigest: bun.digest,
        closureSources: [bun.store, bun.glibcStore],
      },
      jigDistributionPath: distribution,
    } as const;
    let fixtureSequence = 0;
    const evaluate = async (source: string, expected: "project" | "binding" = "project") => {
      const path = `fixture-${++fixtureSequence}.ts`;
      await writeFile(join(root, path), source);
      const fixture = await captureAuthorClosure(root, [path]);
      try {
        return await evaluateAuthorClosure(evaluator, fixture, path, expected);
      } finally {
        fixture.dispose();
      }
    };
    try {
      const entry = join(root, "jig.ts");
      await writeFile(join(root, "shared.ts"), [
        'import { defineBinding, defineJig, discover, flowRef } from "@jigging/jig";',
        'export const project = defineJig({ flows: discover("./flows") });',
        "export const binding = defineBinding({",
        '  package: "flows/worker",',
        "  settings: { maxRetries: 3 },",
        '  slots: { fallback: flowRef("flows/fallback") },',
        "});",
      ].join("\n"));
      await writeFile(entry, [
        'import { project } from "./shared.ts";',
        "export default project;",
      ].join("\n"));
      await writeFile(join(root, "build.ts"), [
        'import { binding } from "./shared.ts";',
        "export default binding;",
      ].join("\n"));
      const captured = await captureAuthorClosure(root, ["jig.ts", "build.ts"]);
      try {
        await writeFile(entry, "export default { changed: true };\n");
        await writeFile(join(root, "shared.ts"), "export const changed = true;\n");
        const evaluated = await evaluateAuthorClosure(evaluator, captured, "jig.ts", "project");
        expect(evaluated.value).toEqual({
          flows: { kind: "discover", roots: ["flows"] },
        });
        expect(evaluated.source.digest).toBe(captured.closureDigest);
        expect(evaluated.source.modules.map(({ projectPath }) => projectPath)).toEqual([
          "build.ts",
          "jig.ts",
          "shared.ts",
        ]);
        expect(evaluated.profile).toMatchObject({
          protocol: "jig-author-evaluator/1",
          buildOptions: "bun-cjs-closed-static-closure/1",
          sandbox: {
            kind: "linux-cgroup-v2-bubblewrap/1",
            rootProcessMappings: true,
            entropyDevice: true,
            limits: {
              memoryBytes: 256 * 1024 * 1024,
              pids: 32,
              wallClockMs: 3_000,
            },
          },
        });
        expect(evaluated.enforcement).toMatchObject({
          cgroup: {
            parentCgroup: expect.any(String),
            runCgroup: expect.any(String),
            payloadPid: expect.any(Number),
          },
          terminal: {
            reason: "payload_exit",
            exitCode: 0,
            signal: null,
            fenced: true,
          },
          memoryEvents: { max: 0 },
          pidsEvents: { max: 0 },
        });
        const binding = await evaluateAuthorClosure(evaluator, captured, "build.ts", "binding");
        expect(binding.value).toEqual({
          kind: "package",
          package: "flows/worker",
          settings: { maxRetries: 3 },
          slots: { fallback: { kind: "flow", path: "flows/fallback" } },
          attachments: {},
        });
        expect(binding.source.digest).toBe(captured.closureDigest);
      } finally {
        captured.dispose();
      }

      await writeFile(join(root, "other.ts"), [
        'import { defineJig } from "@jigging/jig";',
        'export const value = defineJig({ flows: ["flows/local"] });',
      ].join("\n"));
      expect((await evaluate([
        'import { value } from "./other.ts";',
        "export default value;",
      ].join("\n"))).value).toEqual({
        flows: { kind: "members", paths: ["flows/local"] },
      });
      await expect(evaluate([
        'import "jig-author:evil";',
        "export default {};",
      ].join("\n"))).rejects.toMatchObject({ code: "PROJECT_EVALUATOR_IMPORT" });
      await expect(evaluate([
        'const jig = require("@jigging/jig");',
        "export default jig.defineJig({});",
      ].join("\n"))).rejects.toMatchObject({ code: "PROJECT_EVALUATOR_IMPORT" });
      await expect(evaluate([
        'const load = () => import("@jigging/jig");',
        "export default load();",
      ].join("\n"))).rejects.toMatchObject({ code: "PROJECT_EVALUATOR_IMPORT" });

      await expect(evaluate([
        "export const extra = true;",
        "export default {};",
      ].join("\n"))).rejects.toMatchObject({ code: "PROJECT_DEFAULT_EXPORT" });
      await expect(evaluate("export default { flows: ; };\n"))
        .rejects.toMatchObject({ code: "PROJECT_EVALUATOR_COMPILE" });
      await expect(evaluate("export default { flows: [] };\n", "binding"))
        .rejects.toMatchObject({ code: "PROJECT_AUTHORING_SCHEMA_INVALID" });
      await expect(evaluate([
        'const loader = Function("return import(\\"./other.ts\\")");',
        "loader();",
        "export default {};",
      ].join("\n"))).rejects.toMatchObject({ code: "PROJECT_EVALUATION_FAILED" });
      await expect(evaluate("while (true) {}\nexport default {};\n"))
        .rejects.toMatchObject({ code: "PROJECT_EVALUATION_LIMIT" });

      const contained = await evaluate([
        'import { defineJig } from "@jigging/jig";',
        'const forged = JSON.stringify({ protocol: "jig-author-evaluator/1", status: "ok", value: {} });',
        "const globalObject = globalThis as any;",
        "for (const exposed of [",
        "  TextEncoder,",
        "  globalObject.__jigRequire,",
        "  globalObject.constructor,",
        "  Object.getPrototypeOf(globalObject)?.constructor,",
        "]) {",
        "  try {",
        '    const outerProcess = exposed.constructor("return process")();',
        "    outerProcess.stdout.write(forged);",
        "    outerProcess.exit(0);",
        "  } catch {}",
        "}",
        'export default defineJig({ flows: ["flows/café", "flows/😀"] });',
      ].join("\n"));
      expect(contained.value).toEqual({
        flows: { kind: "members", paths: ["flows/café", "flows/😀"] },
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("drives a real Python Run/1 component through the complete envelope", async () => {
    host = await hostConfiguration();
    const python = await pythonClosure();
    const sdk = await realpath(join(import.meta.dir, "..", "..", "flowmd-sdk", "src"));
    const fixture = await realpath(join(import.meta.dir, "..", "..", "flowmd-sdk", "tests"));
    const component = await backend(host).launch({
      runId: "python-run1",
      limits: {
        ...limits(),
        memoryBytes: 256 * 1024 * 1024,
        pids: 16,
        wallClockMs: 5_000,
      },
      readOnlyMounts: [
        ...python.stores.map((store) => ({ source: store, destination: store })),
        { source: sdk, destination: "/flowmd-sdk" },
        { source: fixture, destination: "/component" },
      ],
      entropyDevice: true,
      environment: {
        PYTHONPATH: "/flowmd-sdk",
        PYTHONDONTWRITEBYTECODE: "1",
        PYTHONUNBUFFERED: "1",
      },
      command: [python.executable, "/component/fixture_component.py"],
    });

    const terminal = await new RunHostSession(component, {
      input: { message: "inside the enforced envelope" },
      settings: {},
      attachments: {},
      scratch: "/work",
      deadlineUnixMs: Date.now() + 3_000,
    }).run();

    expect(terminal).toMatchObject({
      status: "succeeded",
      result: {
        outcome: "done",
        output: { message: "inside the enforced envelope" },
      },
      diagnostics: { stderr: "" },
    });
    expect(await component.evidence).toMatchObject({
      memoryEvents: { max: 0 },
      pidsEvents: { max: 0 },
    });
    await expect(access(component.cgroup.parentCgroup)).rejects.toBeDefined();
  });

  test("drives a real Python Service/1 Mount through the complete envelope", async () => {
    host = await hostConfiguration();
    const python = await pythonClosure();
    const sdk = await realpath(join(import.meta.dir, "..", "..", "flowmd-sdk", "src"));
    const fixture = await realpath(join(import.meta.dir, "fixtures", "service-provider.py"));
    const component = await backend(host).launch({
      runId: "python-service1",
      limits: {
        ...limits(),
        memoryBytes: 256 * 1024 * 1024,
        pids: 16,
        wallClockMs: 5_000,
      },
      readOnlyMounts: [
        ...python.stores.map((store) => ({ source: store, destination: store })),
        { source: sdk, destination: "/flowmd-sdk" },
        { source: fixture, destination: "/component/service-provider.py" },
      ],
      entropyDevice: true,
      environment: {
        PYTHONPATH: "/flowmd-sdk",
        PYTHONDONTWRITEBYTECODE: "1",
        PYTHONUNBUFFERED: "1",
      },
      command: [python.executable, "/component/service-provider.py"],
    });
    const service = new ServiceHostSession(component, {
      settings: {},
      attachments: {},
      scratch: "/work",
      startupDeadlineUnixMs: Date.now() + 3_000,
      exports: ["sessions"],
    });

    await service.start();
    expect(await service.invoke({
      exportName: "sessions",
      method: "read",
      input: { message: "inside the enforced envelope" },
      deadlineUnixMs: Date.now() + 3_000,
    })).toEqual({
      status: "succeeded",
      value: { input: { message: "inside the enforced envelope" } },
    });
    expect(await service.stop()).toMatchObject({
      status: "succeeded",
      diagnostics: { stderr: "" },
    });
    expect(await component.evidence).toMatchObject({
      memoryEvents: { max: 0 },
      pidsEvents: { max: 0 },
    });
    await expect(access(component.cgroup.parentCgroup)).rejects.toBeDefined();
  });
});

interface HostConfiguration {
  readonly scope: string;
  readonly bash: string;
}

async function hostConfiguration(): Promise<HostConfiguration> {
  const relative = (await readFile("/proc/self/cgroup", "utf8")).trim().split(":").at(-1)!;
  const self = await realpath(`/sys/fs/cgroup${relative}`);
  const shellWrapper = await realpath("/bin/sh");
  const first = (await readFile(shellWrapper, "utf8")).split("\n", 1)[0]!;
  if (!first.startsWith("#!/")) throw new Error("test host did not expose the expected real bash shebang");
  return { scope: dirname(self), bash: first.slice(2) };
}

async function bunClosure(): Promise<{
  executable: string;
  store: string;
  glibcStore: string;
  digest: string;
}> {
  const executable = await realpath("/bin/bun");
  const bytes = await readFile(executable);
  const match = bytes.toString("latin1").match(
    /\/nix\/store\/[a-z0-9]{32}-glibc-[^/\0]+\/lib\/ld-linux-x86-64\.so\.2/,
  );
  if (match === null) throw new Error("could not derive Bun's pinned glibc closure from its ELF interpreter");
  const glibcStore = match[0]!.slice(0, match[0]!.indexOf("/lib/"));
  return {
    executable,
    store: dirname(dirname(executable)),
    glibcStore,
    digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
  };
}

async function pythonClosure(): Promise<{ executable: string; stores: readonly string[] }> {
  const configuredPython = process.env.JIG_TEST_PYTHON;
  const configuredNixStore = process.env.JIG_TEST_NIX_STORE;
  if (configuredPython === undefined || configuredNixStore === undefined) {
    throw new Error("JIG_TEST_PYTHON and JIG_TEST_NIX_STORE are required for the Python runtime proof");
  }
  const executable = await realpath(configuredPython);
  const store = executable.match(/^\/nix\/store\/[^/]+/)?.[0];
  if (store === undefined) throw new Error("the Python runtime proof requires an immutable Nix store executable");
  const query = spawn(configuredNixStore, ["-qR", store], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdout = collect(query.stdout!);
  const stderr = collect(query.stderr!);
  const exit = await childExit(query);
  if (exit.code !== 0) {
    throw new Error(`could not derive the Python runtime closure: ${(await stderr).trim()}`);
  }
  const stores = (await stdout).trim().split("\n").filter(Boolean);
  if (!stores.includes(store)) throw new Error("Python closure omitted its root store path");
  return { executable, stores: Object.freeze(stores) };
}

function backend(host: HostConfiguration): PrivateLinuxCgroupBackend {
  return new PrivateLinuxCgroupBackend({
    cgroupScope: host.scope,
    sudoPath: "/agent-sudo/bin/sudo",
    bunPath: "/bin/bun",
    bubblewrapPath: "/usr/bin/bwrap",
    payloadUid: 1000,
    payloadGid: 100,
  });
}

function plan(
  host: HostConfiguration,
  runId: string,
  script: string,
  resourceLimits: PrivateLinuxLaunchPlan["limits"] = limits(),
): PrivateLinuxLaunchPlan {
  return {
    runId,
    limits: resourceLimits,
    readOnlyMounts: [
      { source: "/nix/store", destination: "/nix/store" },
      { source: "/bin", destination: "/bin" },
    ],
    command: [host.bash, "-c", script],
  };
}

function limits(): PrivateLinuxLaunchPlan["limits"] {
  return {
    memoryBytes: 64 * 1024 * 1024,
    pids: 24,
    cpuQuotaMicros: 50_000,
    cpuPeriodMicros: 100_000,
    wallClockMs: 2_000,
    cleanupTimeoutMs: 5_000,
  };
}

async function run(
  host: HostConfiguration,
  runId: string,
  script: string,
  resourceLimits: PrivateLinuxLaunchPlan["limits"] = limits(),
): Promise<{
  stdout: string;
  stderr: string;
  exit: Awaited<ReturnType<PrivateLinuxCgroupBackend["launch"]>>["completion"] extends Promise<infer T> ? T : never;
  evidence: Awaited<ReturnType<PrivateLinuxCgroupBackend["launch"]>>["evidence"] extends Promise<infer T> ? T : never;
  cgroup: Awaited<ReturnType<PrivateLinuxCgroupBackend["launch"]>>["cgroup"];
}> {
  const process = await backend(host).launch(plan(host, runId, script, resourceLimits));
  const stdout = collect(process.stdout);
  const stderr = collect(process.stderr);
  await process.closeInput();
  const exit = await process.completion;
  return {
    stdout: await stdout,
    stderr: await stderr,
    exit,
    evidence: await process.evidence,
    cgroup: process.cgroup,
  };
}

async function collect(source: AsyncIterable<Uint8Array>): Promise<string> {
  let result = "";
  for await (const chunk of source) result += Buffer.from(chunk).toString("utf8");
  return result;
}

async function drain(source: AsyncIterable<Uint8Array>): Promise<void> {
  for await (const _ of source) {
    // Intentionally drained.
  }
}

async function jigCgroups(scope: string): Promise<string[]> {
  return (await readdir(scope)).filter((name) => name.startsWith("jig-run-")).sort();
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function waitUntil(predicate: () => Promise<boolean>, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() >= deadline) throw new Error("condition did not settle before timeout");
    await Bun.sleep(10);
  }
}

function sameMembers(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

function firstLine(stream: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolveLine, reject) => {
    let buffer = "";
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => {
      buffer += String(chunk);
      const newline = buffer.indexOf("\n");
      if (newline !== -1) resolveLine(buffer.slice(0, newline));
    });
    stream.once("error", reject);
    stream.once("end", () => reject(new Error("coordinator exited before announcing its cgroup")));
  });
}

function childExit(child: ReturnType<typeof spawn>): Promise<{ code: number | null; signal: string | null }> {
  return new Promise((resolveExit, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolveExit({ code, signal }));
  });
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}
