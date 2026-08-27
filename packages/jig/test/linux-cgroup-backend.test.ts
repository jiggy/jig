import { afterAll, describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { access, chmod, mkdir, mkdtemp, readFile, readdir, realpath, rm, rmdir, stat, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import {
  createPrivateActivationPlanningObservation,
} from "../src/internal/activation-planning.js";
import {
  observeAgentSandboxRuntimeSupport,
  requirePrivateRuntimeSupportObservation,
} from "../src/internal/agent-sandbox-runtime-support.js";
import {
  planPrivateBunDirectRun,
  requirePrivateBunDirectRecipe,
  runPrivateBunDirectRecipe,
} from "../src/internal/bun-direct-run.js";
import {
  planPrivateDirectRun,
  requirePrivateDirectRunRecipe,
  runPrivateDirectRunRecipe,
} from "../src/internal/direct-run.js";
import {
  cancelPrivateLinuxOwnerStateAllocation,
  planPrivateLinuxOwnerStateAllocation,
  PrivateLinuxCgroupBackend,
  releasePrivateLinuxOwnerState,
  requirePrivateLinuxCgroupBackend,
  type PrivateLinuxPreparedOwnerIdentity,
  type PrivateLinuxLaunchPlan,
  type PrivateLinuxOwnerStateAllocationIdentity,
} from "../src/internal/linux-cgroup-backend.js";
import { captureStoredPackage } from "../src/internal/package-artifact-store.js";
import {
  planPrivatePythonDirectRun,
  requirePrivatePythonDirectRecipe,
  runPrivatePythonDirectRecipe,
} from "../src/internal/python-direct-run.js";
import {
  createPrivateActivationCandidate,
  decodePrivateActivationCandidate,
  encodePrivateActivationCandidate,
  privateActivationCandidateDigest,
  requirePrivateCreatedActivationCandidate,
} from "../src/internal/activation-admission.js";
import {
  applyPrivateActivationReviewPlan,
  createPrivateActivationReviewPlan,
  loadPrivateActiveActivation,
  loadPrivateActivationReviewPlan,
  publishPrivateActivationCandidate,
  requirePrivateStoredActivationCandidate,
} from "../src/internal/activation-admission-store.js";
import { openPrivateRootAdministrationController } from "../src/internal/root-administration-controller.js";
import { executePrivateRootRunLaunch } from "../src/internal/root-run-controller.js";
import { evaluateAuthorClosure } from "../src/project/author-evaluator.js";
import { captureAuthorClosure } from "../src/project/author-module.js";
import { defineJig } from "../src/project/author.js";
import { captureFlowSource } from "../src/project/flow-source.js";
import { linkPackageProject } from "../src/project/package-project.js";
import {
  buildPrivateActivationRequests,
  requirePrivateRetainedResolutionObservation,
  resolveRetainedPackageProjectObservation,
} from "../src/project/package-resolution.js";
import { retainFlowSourcePackages } from "../src/project/retained-flow.js";
import { retainPackageProject } from "../src/project/retained-project.js";

const HOSTILE = process.env.JIG_LINUX_CGROUP_HOSTILE === "1";
const hostileDescribe = HOSTILE ? describe.serial : describe.skip;

describe("private Linux cgroup-v2 plan boundary", () => {
  test("rejects cgroupfs mounts and malformed finite limits before launch", async () => {
    const backend = new PrivateLinuxCgroupBackend({
      cgroupScope: "/sys/fs/cgroup/jig-test-scope",
      sudoPath: "/usr/bin/sudo",
      subreaperPath: "/usr/bin/catatonit",
      mknodPath: "/bin/mknod",
      bunPath: "/usr/bin/bun",
      bubblewrapPath: "/usr/bin/bwrap",
      bashPath: "/usr/bin/bash",
      payloadUid: process.getuid!(),
      payloadGid: process.getgid!(),
    });
    expect(requirePrivateLinuxCgroupBackend(backend)).toBe(backend);
    expect(Object.isFrozen(backend)).toBe(true);
    let recipeAccessorRead = false;
    const forgedRecipe = Object.defineProperty({}, "kind", {
      get() {
        recipeAccessorRead = true;
        return "private-bun-direct-recipe/1";
      },
    });
    expect(() => requirePrivateDirectRunRecipe(forgedRecipe)).toThrow(
      "direct Run recipe was not produced by a private planner",
    );
    expect(recipeAccessorRead).toBe(false);
    expect(() => requirePrivateLinuxCgroupBackend({
      observeMechanism: backend.observeMechanism,
      launch: backend.launch,
    })).toThrow("Linux Backend was not produced by the private constructor");
    await expect(backend.launch({
      runId: "unsafe-mount",
      limits: limits(),
      readOnlyMounts: [{ source: "/sys/fs/cgroup", destination: "/host-cgroup" }],
      command: ["/payload"],
    })).rejects.toThrow("host cgroupfs cannot enter the sandbox");
    const aliasRoot = await mkdtemp(join(tmpdir(), "jig-pseudo-alias-"));
    try {
      const alias = join(aliasRoot, "status");
      await symlink("/proc/self/status", alias);
      await expect(backend.launch({
        runId: "unsafe-pseudo-alias",
        limits: limits(),
        readOnlyMounts: [{ source: alias, destination: "/data/status" }],
        command: ["/payload"],
      })).rejects.toThrow("host pseudo-filesystem cannot enter the sandbox through an alias");
      const deviceAlias = join(aliasRoot, "urandom");
      await symlink("/dev/urandom", deviceAlias);
      await expect(backend.launch({
        runId: "unsafe-device-alias",
        limits: limits(),
        readOnlyMounts: [{ source: deviceAlias, destination: "/data/urandom" }],
        command: ["/payload"],
      })).rejects.toThrow("host pseudo-filesystem cannot enter the sandbox through an alias");
    } finally {
      await rm(aliasRoot, { recursive: true, force: true });
    }
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

  test("rejects ambient, policy-drifted, and ambiguous privileged helper starts", async () => {
    host = await hostConfiguration();
    const helper = join(import.meta.dir, "..", "src", "internal", "linux-cgroup-helper.ts");
    const bun = await realpath("/bin/bun");
    const sudo = "/agent-sudo/bin/sudo";
    const policy = ["--no-env-file", "--no-install", "--config=/dev/null"];
    const bridge = [
      "-n",
      "--",
      host.bash,
      "--noprofile",
      "--norc",
      "-p",
      "-c",
      'cd -- / && exec -c -- "$@"',
      "jig-cgroup-helper",
      bun,
    ];

    const ambient = await invoke(sudo, ["-n", "--", bun, ...policy, helper]);
    expect(ambient.code).toBe(70);
    expect(ambient.stderr).toContain("trusted cgroup helper requires an empty environment");

    const drifted = await invoke(sudo, [...bridge, "--no-env-file", "--no-install", helper]);
    expect(drifted.code).toBe(70);
    expect(drifted.stderr).toContain("trusted cgroup helper requires the fixed Bun policy");

    const duplicate = await invoke(sudo, [
      ...bridge,
      ...policy,
      helper,
      "--scope", host.scope,
      "--scope", host.scope,
      "--",
      "/invalid",
    ]);
    expect(duplicate.code).toBe(70);
    expect(duplicate.stderr).toContain("invalid trusted cgroup helper arguments");
  });

  test("reacquires the leased runtime support in a fresh coordinator process", async () => {
    const executable = await realpath("/bin/bun");
    const receiptsDirectory = process.env.AGENT_RUNTIME_RECEIPTS_DIR;
    const expectedLeaseId = process.env.AGENT_RUNTIME_LEASE_ID;
    if (receiptsDirectory === undefined || expectedLeaseId === undefined) {
      throw new Error("proof host did not expose its runtime lease receipt");
    }
    const module = pathToFileURL(join(
      import.meta.dir,
      "..",
      "src",
      "internal",
      "agent-sandbox-runtime-support.ts",
    )).href;
    const program = [
      `import { observeAgentSandboxRuntimeSupport } from ${JSON.stringify(module)};`,
      `const value = await observeAgentSandboxRuntimeSupport(${JSON.stringify({
        receiptsDirectory,
        expectedLeaseId,
        executablePath: executable,
      })});`,
      "console.log(JSON.stringify(value));",
    ].join("\n");
    const arguments_ = [
      "--no-env-file",
      "--no-install",
      "--config=/dev/null",
      "-e",
      program,
    ];
    const first = await invoke(executable, arguments_);
    const second = await invoke(executable, arguments_);
    expect(first).toEqual({ code: 0, stdout: expect.any(String), stderr: "" });
    expect(second).toEqual({ code: 0, stdout: first.stdout, stderr: "" });
    expect(JSON.parse(second.stdout)).toMatchObject({
      kind: "runtime-support-observation/1",
      lease: { id: expectedLeaseId, retention: "until-sandbox-teardown" },
      executablePath: executable,
    });

    const mismatched = program.replace(expectedLeaseId, "sandbox-intentionally-wrong");
    const rejected = await invoke(executable, [...arguments_.slice(0, -1), mismatched]);
    expect(rejected.code).not.toBe(0);
    expect(rejected.stdout).toBe("");
    expect(rejected.stderr).toContain("runtime lease receipt does not match the selected sandbox lease");
  });

  test("runs one Bun FLOW component from exact leased support", async () => {
    host = await hostConfiguration();
    const bun = await proofHostBunClosure();
    const root = await mkdtemp(join(tmpdir(), "jig-bun-flow-"));
    const store = join(root, "store");
    const component = join(root, "flows", "run");
    try {
      await mkdir(store, { mode: 0o700 });
      await mkdir(component, { recursive: true });
      const sdk = join(component, "flow-sdk");
      await mkdir(sdk);
      for (const name of [
        "index.ts",
        "json.ts",
        "protocol.ts",
        "service-session.ts",
        "session.ts",
        "transport.ts",
        "types.ts",
      ]) {
        await writeFile(
          join(sdk, name),
          await readFile(join(import.meta.dir, "..", "..", "flow-sdk", "src", name)),
        );
      }
      await writeFile(join(component, "FLOW.md"), [
        "---",
        "name: retained-bun",
        "description: Exact retained Bun Run fixture.",
        "---",
        "",
      ].join("\n"));
      await writeFile(join(component, "flow.ts"), [
        "#!/usr/bin/env bun",
        'import { serve } from "./flow-sdk/index.ts";',
        "",
        "await serve(async (context) => ({",
        '  outcome: "done",',
        "  output: { echo: context.input },",
        "}));",
        "",
      ].join("\n"));
      const source = await captureFlowSource(root, defineJig({ flows: ["flows/run"] }).flows);
      try {
        const retained = await retainFlowSourcePackages(store, source);
        const project = linkPackageProject({ flows: retained, bindings: [] });
        const [request] = buildPrivateActivationRequests(project);
        const recipe = await planPrivateDirectRun({
          request: request!,
          runtimeSupport: bun.runtimeSupport,
          backend: backend(host),
        });
        expect(requirePrivateBunDirectRecipe(recipe)).toBe(recipe);
        expect(requirePrivateDirectRunRecipe(recipe)).toBe(recipe);
        expect((await planPrivateBunDirectRun({
          request: request!,
          runtimeSupport: bun.runtimeSupport,
          backend: backend(host),
        })).observation.digest).toBe(recipe.observation.digest);
        await expect(planPrivateBunDirectRun({
          request: request!,
          runtimeSupport: bun.runtimeSupport,
          backend: backend(host),
          selector: "not-bun",
        })).rejects.toThrow("matching direct flow.ts activation");
        await expect(runPrivateBunDirectRecipe({
          recipe,
          packageStoreRoot: store,
          runId: "bun-config-drift",
          invocation: {
            input: {},
            settings: { unexpected: true },
            attachments: {},
            deadlineUnixMs: Date.now() + 20_000,
          },
        })).rejects.toThrow("differs from its admitted settings or attachments");

        const result = await runPrivateDirectRunRecipe({
          recipe,
          packageStoreRoot: store,
          runId: "bun-flow",
          invocation: {
            input: { message: "retained" },
            settings: {},
            attachments: {},
            deadlineUnixMs: Date.now() + 20_000,
          },
        });
        expect(result.terminal).toEqual({
          status: "succeeded",
          result: {
            outcome: "done",
            output: { echo: { message: "retained" } },
          },
          diagnostics: { stderr: "", stderrBytes: 0, stderrTruncated: false },
        });
        expect(result.enforcement).toMatchObject({
          terminationReason: "payload_exit",
          evidence: {
            cpuStat: expect.any(Object),
            memoryEvents: expect.any(Object),
            pidsEvents: expect.any(Object),
          },
        });
      } finally {
        await source.dispose();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("runs one Python FLOW component from exact leased support", async () => {
    host = await hostConfiguration();
    const python = await proofHostPythonClosure();
    const root = await mkdtemp(join(tmpdir(), "jig-python-flow-"));
    const store = join(root, "store");
    const component = join(root, "flows", "run");
    try {
      await mkdir(store, { mode: 0o700 });
      await mkdir(component, { recursive: true });
      const sdk = join(component, "flowmd_sdk");
      await mkdir(sdk);
      for (const name of ["__init__.py", "_json.py", "_runtime.py", "_service.py", "_types.py"]) {
        const source = join(import.meta.dir, "..", "..", "flowmd-sdk", "src", "flowmd_sdk", name);
        await writeFile(join(sdk, name), await readFile(source));
      }
      await writeFile(join(component, "FLOW.md"), [
        "---",
        "name: retained-python",
        "description: Exact retained Python Run fixture.",
        "---",
        "",
      ].join("\n"));
      await writeFile(join(component, "flow.py"), [
        "#!/usr/bin/env python",
        "from flowmd_sdk import serve",
        "",
        "async def run(context):",
        "    return {\"outcome\": \"done\", \"output\": {\"echo\": context.input}}",
        "",
        "serve(run)",
        "",
      ].join("\n"));
      const source = await captureFlowSource(root, defineJig({ flows: ["flows/run"] }).flows);
      try {
        const retained = await retainFlowSourcePackages(store, source);
        const project = linkPackageProject({ flows: retained, bindings: [] });
        const [request] = buildPrivateActivationRequests(project);
        const recipe = await planPrivatePythonDirectRun({
          request: request!,
          runtimeSupport: python.runtimeSupport,
          backend: backend(host),
        });
        expect(requirePrivatePythonDirectRecipe(recipe)).toBe(recipe);
        expect((await planPrivatePythonDirectRun({
          request: request!,
          runtimeSupport: python.runtimeSupport,
          backend: backend(host),
        })).observation.digest).toBe(recipe.observation.digest);
        await expect(planPrivatePythonDirectRun({
          request: request!,
          runtimeSupport: python.runtimeSupport,
          backend: backend(host),
          selector: "not-python",
        })).rejects.toThrow("matching direct flow.py activation");
        await expect(runPrivatePythonDirectRecipe({
          recipe,
          packageStoreRoot: store,
          runId: "python-config-drift",
          invocation: {
            input: {},
            settings: { unexpected: true },
            attachments: {},
            deadlineUnixMs: Date.now() + 20_000,
          },
        })).rejects.toThrow("differs from its admitted settings or attachments");

        const result = await runPrivatePythonDirectRecipe({
          recipe,
          packageStoreRoot: store,
          runId: "python-flow",
          invocation: {
            input: { message: "retained" },
            settings: {},
            attachments: {},
            deadlineUnixMs: Date.now() + 20_000,
          },
        });
        expect(result.terminal).toEqual({
          status: "succeeded",
          result: {
            outcome: "done",
            output: { echo: { message: "retained" } },
          },
          diagnostics: { stderr: "", stderrBytes: 0, stderrTruncated: false },
        });
        expect(result.enforcement).toMatchObject({
          terminationReason: "payload_exit",
          evidence: {
            cpuStat: expect.any(Object),
            memoryEvents: expect.any(Object),
            pidsEvents: expect.any(Object),
          },
        });
      } finally {
        await source.dispose();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("hides cgroupfs, prevents migration, and runs as the payload identity", async () => {
    host = await hostConfiguration();
    const unshare = await proofHostUnshare();
    const result = await run(host, "visibility", [
      "set -eu",
      `unshare=${shellQuote(unshare)}`,
      "test \"$(/bin/id -u)\" = 1000",
      "test \"$(/bin/id -g)\" = 100",
      "test ! -e /sys/fs/cgroup",
      "test ! -e /proc/self/cgroup",
      "! /bin/mkdir /sys 2>/dev/null",
      "! printf 1 > /proc/self/cgroup 2>/tmp/proc-denied",
      "! \"$unshare\" --user /bin/true 2>/tmp/userns-denied",
      "printf envelope-ok",
    ].join("\n"));

    expect(result.stdout).toBe("envelope-ok");
    expect(result.exit).toMatchObject({ exitCode: 0, signal: null, fenced: true });
    await expect(access(result.cgroup.parentCgroup)).rejects.toBeDefined();
  });

  test("mounts an exact source beneath a protected 0700 ancestor", async () => {
    host = await hostConfiguration();
    const protectedRoot = await mkdtemp(join(tmpdir(), "jig-protected-mount-"));
    await chmod(protectedRoot, 0o700);
    try {
      const source = join(protectedRoot, "captured-package");
      await mkdir(source, { mode: 0o755 });
      await writeFile(join(source, "value.txt"), "descriptor-pinned\n", { mode: 0o644 });
      const base = plan(host, "protected-mount", [
        "set -eu",
        "test \"$(< /sealed-input/value.txt)\" = descriptor-pinned",
        `test ! -e ${shellQuote(source)}`,
        "! { printf changed > /sealed-input/value.txt; } 2>/tmp/write-denied",
        "printf protected-mount-ok",
      ].join("\n"), {
        ...limits(),
        deadlineUnixMs: Date.now() + 10_000,
      });
      const component = await backend(host).launch({
        ...base,
        privateProcessFilesystem: true,
        readOnlyMounts: [
          ...base.readOnlyMounts,
          { source, destination: "/sealed-input" },
        ],
      });
      const stdout = collect(component.stdout);
      const stderr = collect(component.stderr);
      await component.closeInput();
      expect({
        exit: await component.completion,
        stdout: await stdout,
        stderr: await stderr,
      }).toMatchObject({
        exit: { exitCode: 0, signal: null, fenced: true },
        stdout: "protected-mount-ok",
        stderr: "",
      });
      expect(await readFile(join(source, "value.txt"), "utf8")).toBe("descriptor-pinned\n");
    } finally {
      await rm(protectedRoot, { recursive: true, force: true });
    }
  });

  test("seals one deep launch snapshot before asynchronous observation", async () => {
    host = await hostConfiguration();
    const mutable = plan(host, "sealed-snapshot", "printf snapshot-ok", {
      ...limits(),
      deadlineUnixMs: Date.now() + 10_000,
    }) as {
      runId: string;
      limits: { memoryBytes: number } & PrivateLinuxLaunchPlan["limits"];
      readOnlyMounts: Array<{ source: string; destination: string }>;
      command: [string, ...string[]];
    };
    const sealing = backend(host).seal(mutable);
    mutable.runId = "mutated-run";
    mutable.limits.memoryBytes = 1;
    mutable.readOnlyMounts[0]!.source = "/sys/fs/cgroup";
    mutable.command[2] = "printf mutation-leaked";

    const sealed = await sealing;
    expect(sealed.identity.runId).toBe("sealed-snapshot");
    const component = await sealed.admit();
    const stdout = collect(component.stdout);
    const stderr = collect(component.stderr);
    await component.closeInput();
    expect(await component.completion).toMatchObject({ exitCode: 0, fenced: true });
    expect(await stdout).toBe("snapshot-ok");
    expect(await stderr).toBe("");
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
      deadlineUnixMs: Date.now() + 2_000,
      cancellationGraceMs: 100,
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
      deadlineUnixMs: Date.now() + 1_500,
      cancellationGraceMs: 100,
    });

    expect(result.exit.fenced).toBe(true);
    expect(result.evidence.memoryEvents.max).toBeGreaterThan(0);
  });

  test("combines CPU throttling with an independent hard wall deadline", async () => {
    host = await hostConfiguration();

    const throttled = await run(host, "cpu-throttling", [
      "SECONDS=0",
      "while (( SECONDS < 1 )); do :; done",
    ].join("\n"), {
      ...limits(),
      cpuQuotaMicros: 10_000,
      cpuPeriodMicros: 100_000,
      deadlineUnixMs: Date.now() + 3_500,
      cancellationGraceMs: 100,
    });

    expect(throttled.exit).toMatchObject({ exitCode: 0, signal: null, fenced: true });
    expect(throttled.evidence.cpuStat.usage_usec).toBeGreaterThan(0);
    expect(throttled.evidence.cpuStat.nr_throttled).toBeGreaterThan(0);

    const started = performance.now();
    const terminated = await run(host, "cpu-deadline", "while :; do :; done", {
      ...limits(),
      cpuQuotaMicros: 10_000,
      cpuPeriodMicros: 100_000,
      deadlineUnixMs: Date.now() + 1_500,
      cancellationGraceMs: 100,
    });

    expect(performance.now() - started).toBeLessThan(3_500);
    expect(terminated.exit).toMatchObject({ signal: "SIGKILL", fenced: true });
  }, 10_000);

  test("cancels during startup and shutdown without leaking ownership", async () => {
    host = await hostConfiguration();
    const before = new Set(await jigCgroups(host.scope));
    await expect(backend(host).launch(plan(host, "expired-before-admission", "printf must-not-run", {
      ...limits(),
      deadlineUnixMs: 0,
      cancellationGraceMs: 1,
    }))).rejects.toBeDefined();
    await waitUntil(async () => sameMembers(before, new Set(await jigCgroups(host.scope))), 5_000);

    const alreadyAborted = new AbortController();
    alreadyAborted.abort();
    await expect(backend(host).launch(
      plan(host, "pre-admission-cancel", "printf must-not-run"),
      alreadyAborted.signal,
    )).rejects.toThrow("cancelled before admission");
    expect(new Set(await jigCgroups(host.scope))).toEqual(before);

    const abort = new AbortController();
    const launching = backend(host).launch(plan(host, "startup-cancel", "/bin/sleep 10"), abort.signal);
    abort.abort();
    await expect(launching).rejects.toThrow("cancelled before admission");
    await waitUntil(async () => sameMembers(before, new Set(await jigCgroups(host.scope))), 5_000);

    const process = await backend(host).launch(plan(host, "shutdown-cancel", "/bin/sleep 10"));
    void drain(process.stdout);
    void drain(process.stderr);
    await Promise.all([process.terminate(), process.terminate()]);
    expect(await process.completion).toMatchObject({ signal: "SIGKILL", fenced: true });
    await expect(access(process.cgroup.parentCgroup)).rejects.toBeDefined();
  });

  test("cancellation during private-device setup cannot cross the admission fence", async () => {
    host = await hostConfiguration();
    const before = new Set(await jigCgroups(host.scope));
    const fixture = await mkdtemp(join(tmpdir(), "jig-mknod-barrier-"));
    const marker = join(fixture, "entered");
    const release = join(fixture, "release");
    const mknod = join(fixture, "mknod");
    const bubblewrap = join(fixture, "bwrap");
    const spawned = join(fixture, "payload-spawned");
    const exactMknod = await realpath("/bin/mknod");
    await writeFile(mknod, [
      `#!${host.bash}`,
      "set -eu",
      `printf entered > ${shellQuote(marker)}`,
      `while [[ ! -e ${shellQuote(release)} ]]; do :; done`,
      `exec -a mknod ${shellQuote(exactMknod)} "$@"`,
      "",
    ].join("\n"), { mode: 0o755 });
    await writeFile(bubblewrap, [
      `#!${host.bash}`,
      "set -eu",
      `printf spawned > ${shellQuote(spawned)}`,
      "exit 70",
      "",
    ].join("\n"), { mode: 0o755 });
    const guardedBackend = new PrivateLinuxCgroupBackend({
      cgroupScope: host.scope,
      sudoPath: "/agent-sudo/bin/sudo",
      subreaperPath: "/run/podman-init",
      mknodPath: mknod,
      bunPath: "/bin/bun",
      bubblewrapPath: bubblewrap,
      bashPath: host.bash,
      payloadUid: 1000,
      payloadGid: 100,
    });
    const abort = new AbortController();
    try {
      const launching = guardedBackend.launch({
        ...plan(host, "device-setup-cancel", "printf must-not-run", {
          ...limits(),
          deadlineUnixMs: Date.now() + 10_000,
        }),
        privateProcessFilesystem: true,
        privateRuntimeDevices: true,
      }, abort.signal);
      await waitUntil(async () => await exists(marker), 5_000);
      abort.abort();
      await writeFile(release, "release\n", { mode: 0o600 });
      await expect(launching).rejects.toBeDefined();
      expect(await exists(spawned)).toBe(false);
      await waitUntil(async () => sameMembers(before, new Set(await jigCgroups(host.scope))), 5_000);
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });

  test("persists preparation before admission and leaves root receipts readable to the coordinator", async () => {
    host = await hostConfiguration();
    const ownerParent = await mkdtemp(join(tmpdir(), "jig-owner-readable-"));
    await chmod(ownerParent, 0o700);
    try {
      const allocation = await planPrivateLinuxOwnerStateAllocation({
        parent: ownerParent,
        name: "prepared-owner",
      });
      const launchPlan = plan(host, "prepared-owner", "printf owner-state-ok");
      const sealed = await backend(host).seal(launchPlan, allocation);
      let continueAdmission!: () => void;
      const admissionBarrier = new Promise<void>((resolveAdmission) => {
        continueAdmission = resolveAdmission;
      });
      let reportPrepared!: (value: PrivateLinuxPreparedOwnerIdentity) => void;
      const prepared = new Promise<PrivateLinuxPreparedOwnerIdentity>((resolvePrepared) => {
        reportPrepared = resolvePrepared;
      });
      const launching = sealed.admit(undefined, async (identity) => {
        reportPrepared(identity);
        await admissionBarrier;
      });
      const preparedIdentity = await prepared;
      const owner = preparedIdentity.owner;
      expect((await readFile(join(owner.supervisorCgroup, "cgroup.procs"), "utf8")).trim()).not.toBe("");
      expect((await readFile(join(owner.runCgroup, "cgroup.procs"), "utf8")).trim()).toBe("");
      expect((await readFile(join(owner.runCgroup, "memory.max"), "utf8")).trim()).toBe(
        String(launchPlan.limits.memoryBytes),
      );
      const activeClaim = join(owner.ownerStateDirectory, "claim.json");
      expect(JSON.parse(await readFile(activeClaim, "utf8"))).toMatchObject({ state: "active" });
      expect((await stat(activeClaim)).mode & 0o777).toBe(0o644);

      continueAdmission();
      const component = await launching;
      const stdout = collect(component.stdout);
      const stderr = collect(component.stderr);
      await component.closeInput();
      const enforcement = await component.enforcement;
      expect(await component.completion).toMatchObject({ exitCode: 0, fenced: true });
      expect(await stdout).toBe("owner-state-ok");
      expect(await stderr).toBe("");
      expect(enforcement.stopReason).toBe("payload_exit");
      const finalReceipt = join(owner.ownerStateDirectory, "final.json");
      expect(JSON.parse(await readFile(finalReceipt, "utf8"))).toMatchObject({
        fenced: true,
        ownerDigest: preparedIdentity.digest,
      });
      expect((await stat(finalReceipt)).mode & 0o777).toBe(0o644);
      await releasePrivateLinuxOwnerState(preparedIdentity, enforcement);
      await expect(access(owner.ownerStateDirectory)).rejects.toBeDefined();
    } finally {
      await rm(ownerParent, { recursive: true, force: true });
    }
  });

  test("a cancelled durable allocation defeats a delayed trusted wrapper before host mutation", async () => {
    host = await hostConfiguration();
    const before = new Set(await jigCgroups(host.scope));
    const ownerParent = await mkdtemp(join(tmpdir(), "jig-owner-cancelled-"));
    await chmod(ownerParent, 0o700);
    const sentinel = join(ownerParent, "must-not-exist");
    try {
      const allocation = await planPrivateLinuxOwnerStateAllocation({
        parent: ownerParent,
        name: "cancelled-owner",
      });
      const cancellation = await cancelPrivateLinuxOwnerStateAllocation(allocation);
      await expect(backend(host).seal(
        plan(host, "cancelled-seal", "printf must-not-run"),
        allocation,
      )).rejects.toThrow("sealed Linux owner path already exists");
      expect(await exists(allocation.directory)).toBe(true);
      const wrapper = join(import.meta.dir, "..", "src", "internal", "linux-cgroup-launch-wrapper.ts");
      const result = await invoke("/agent-sudo/bin/sudo", [
        "-n", "--", "/run/podman-init", "--", host.bash,
        "--noprofile", "--norc", "-p", "-c", 'cd -- / && exec -c -- "$@"',
        "jig-cgroup-wrapper", "/bin/bun", "--no-env-file", "--no-install", "--config=/dev/null",
        wrapper,
        "--owner-dir", allocation.directory,
        "--owner-digest", testDigest("cancelled-wrapper"),
        "--allocation-digest", allocation.digest,
        "--owner-token", allocation.ownerToken,
        "--helper", host.bash, "-c", `printf ran > ${shellQuote(sentinel)}`,
        "--finalizer", "/bin/false",
      ]);
      expect(result).toEqual({ code: 0, stdout: "", stderr: "" });
      expect(await exists(sentinel)).toBe(false);
      expect(new Set(await jigCgroups(host.scope))).toEqual(before);
      await releasePrivateLinuxOwnerState(allocation, cancellation);
    } finally {
      await rm(ownerParent, { recursive: true, force: true });
    }
  });

  test("the outside owner finalizes an active claim even when helper spawn fails", async () => {
    host = await hostConfiguration();
    const before = new Set(await jigCgroups(host.scope));
    const ownerParent = await mkdtemp(join(tmpdir(), "jig-owner-helper-failure-"));
    await chmod(ownerParent, 0o700);
    try {
      const allocation = await planPrivateLinuxOwnerStateAllocation({
        parent: ownerParent,
        name: "failed-helper-owner",
      });
      await mkdir(allocation.directory, { mode: 0o700 });
      await writeFile(join(allocation.directory, "owner.json"), `${JSON.stringify({
        allocationDigest: allocation.digest,
        kind: "private-linux-owner-state/1",
        token: allocation.ownerToken,
      })}\n`, { mode: 0o600 });
      const ownerDigest = testDigest("failed-helper-wrapper");
      const finalizerReceipt = JSON.stringify({ fenced: true, ownerDigest });
      const wrapper = join(import.meta.dir, "..", "src", "internal", "linux-cgroup-launch-wrapper.ts");
      const result = await invoke("/agent-sudo/bin/sudo", [
        "-n", "--", "/run/podman-init", "--", host.bash,
        "--noprofile", "--norc", "-p", "-c", 'cd -- / && exec -c -- "$@"',
        "jig-cgroup-wrapper", "/bin/bun", "--no-env-file", "--no-install", "--config=/dev/null",
        wrapper,
        "--owner-dir", allocation.directory,
        "--owner-digest", ownerDigest,
        "--allocation-digest", allocation.digest,
        "--owner-token", allocation.ownerToken,
        "--helper", "/jig-intentionally-missing-helper", "unused",
        "--finalizer", host.bash, "-c", `printf '%s\\n' ${shellQuote(finalizerReceipt)}`,
      ]);
      expect(result.code).toBe(70);
      expect(result.stderr).toContain("trusted cgroup launch helper failed");
      expect(JSON.parse(await readFile(join(allocation.directory, "final.json"), "utf8"))).toEqual({
        fenced: true,
        ownerDigest,
      });
      expect((await stat(join(allocation.directory, "final.json"))).mode & 0o777).toBe(0o644);
      expect(new Set(await jigCgroups(host.scope))).toEqual(before);
    } finally {
      await rm(ownerParent, { recursive: true, force: true });
    }
  });

  test("settles concurrent sibling owners without migrating a helper into the shared scope", async () => {
    host = await hostConfiguration();
    const [first, second] = await Promise.all([
      run(host, "concurrent-owner-a", "/bin/sleep 0.2; printf a"),
      run(host, "concurrent-owner-b", "/bin/sleep 0.2; printf b"),
    ]);
    expect([first.stdout, second.stdout]).toEqual(["a", "b"]);
    expect(first.exit.fenced).toBe(true);
    expect(second.exit.fenced).toBe(true);
    expect((await readFile(join(host.scope, "cgroup.procs"), "utf8")).trim()).toBe("");
    expect(await jigCgroups(host.scope)).toEqual([]);
  });

  test("fences orphaned grandchildren after the activation root exits", async () => {
    host = await hostConfiguration();
    const zombiesBefore = await zombiePids();
    const result = await run(host, "orphans", [
      `worker=${shellQuote(host.bash)}`,
      ": >/tmp/empty",
      "\"$worker\" -c '\"$0\" -c \"while :; do :; done\" </tmp/empty >/tmp/grandchild 2>&1 &' \"$worker\" >/tmp/child 2>&1 &",
      "exit 0",
    ].join("\n"));

    expect(result.exit).toMatchObject({ exitCode: 0, signal: null, fenced: true });
    await expect(access(result.cgroup.parentCgroup)).rejects.toBeDefined();
    expect(await zombiePids()).toEqual(zombiesBefore);
  });

  test("reacquires an exact fence after coordinator loss at the prepared admission barrier", async () => {
    host = await hostConfiguration();
    const fixture = spawn(
      "/bin/bun",
      [join(import.meta.dir, "fixtures", "linux-cgroup-prepared-coordinator.ts")],
      {
        env: {
          ...process.env,
          JIG_TEST_SCOPE: host.scope,
          JIG_TEST_BASH: host.bash,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const diagnostics = collect(fixture.stderr!);
    const announced = JSON.parse(await firstLine(fixture.stdout!)) as {
      allocation: PrivateLinuxOwnerStateAllocationIdentity;
      ownerParent: string;
      prepared: PrivateLinuxPreparedOwnerIdentity;
    };
    expect((await readFile(join(announced.prepared.owner.runCgroup, "cgroup.procs"), "utf8")).trim()).toBe("");
    fixture.kill("SIGKILL");
    expect((await childExit(fixture)).signal).toBe("SIGKILL");
    expect(await diagnostics).toBe("");

    const successor = backend(host);
    let recovered: Awaited<ReturnType<PrivateLinuxCgroupBackend["recoverFence"]>> | undefined;
    await waitUntil(async () => {
      try {
        recovered = await successor.recoverFence(announced.prepared);
        return true;
      } catch {
        return false;
      }
    }, 5_000);
    expect(recovered).toMatchObject({ fenced: true, stopReason: "recovered" });
    await releasePrivateLinuxOwnerState(announced.prepared, recovered);
    await rmdir(announced.ownerParent);
    expect(await exists(announced.prepared.owner.parentCgroup)).toBe(false);
  });

  test("reaps after coordinator SIGKILL and remains leak-free across repeated Runs", async () => {
    host = await hostConfiguration();
    const zombiesBefore = await zombiePids();
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
    const announced = JSON.parse(line) as {
      allocation: PrivateLinuxOwnerStateAllocationIdentity;
      owner: PrivateLinuxPreparedOwnerIdentity;
      ownerParent: string;
      parentCgroup: string;
    };
    const privateDevices = join("/dev", `.jig-${basename(announced.parentCgroup)}-devices`);
    fixture.kill("SIGKILL");
    await waitUntil(async () => !(await exists(announced.parentCgroup)), 5_000);
    await waitUntil(async () => !(await exists(privateDevices)), 5_000);
    const successor = backend(host);
    let recovered: Awaited<ReturnType<PrivateLinuxCgroupBackend["recoverFence"]>> | undefined;
    await waitUntil(async () => {
      try {
        recovered = await successor.recoverFence(announced.owner);
        return true;
      } catch {
        return false;
      }
    }, 5_000);
    expect(recovered).toMatchObject({ fenced: true, stopReason: "recovered" });
    await releasePrivateLinuxOwnerState(announced.owner, recovered);
    await rmdir(announced.ownerParent);

    for (let index = 0; index < 8; index += 1) {
      const result = await run(host, `repeat-${index}`, "exit 0");
      expect(result.exit.fenced).toBe(true);
    }
    expect(await jigCgroups(host.scope)).toEqual([]);
    expect(await zombiePids()).toEqual(zombiesBefore);
  });

  test("runs Bun descendants with private read-only proc and entropy devices", async () => {
    host = await hostConfiguration();
    const bun = await proofHostBunClosure();
    const hostEntropy = await stat("/dev/urandom");
    const childProgram = [
      "import { readFileSync } from 'node:fs';",
      "console.log(JSON.stringify({",
      "  pid: process.pid,",
      "  mapsBytes: readFileSync('/proc/self/maps').byteLength,",
      "  selfVisible: readFileSync(`/proc/${process.pid}/status`, 'utf8').includes(`Pid:\\t${process.pid}`),",
      "}));",
    ].join(" ");
    const program = [
      "import { closeSync, openSync, readFileSync, readdirSync, statSync } from 'node:fs';",
      "import { randomBytes } from 'node:crypto';",
      `const childProgram = ${JSON.stringify(childProgram)};`,
      "let writeError = '';",
      "try { closeSync(openSync('/dev/urandom', 'w')); } catch (error) { writeError = error.code; }",
      "const entropy = statSync('/dev/urandom');",
      "const child = Bun.spawn([process.execPath, '-e', childProgram], { stdout: 'pipe', stderr: 'pipe' });",
      "const childStdout = await new Response(child.stdout).text();",
      "const childStderr = await new Response(child.stderr).text();",
      "console.log(JSON.stringify({",
      "  pid: process.pid,",
      `  outerVisible: readdirSync('/proc').includes(${JSON.stringify(String(process.pid))}),`,
      "  procMount: readFileSync('/proc/mounts', 'utf8').split('\\n').find((line) => line.includes(' /proc ')),",
      "  cgroup: readFileSync('/proc/self/cgroup', 'utf8'),",
      "  mapsBytes: readFileSync('/proc/self/maps').byteLength,",
      "  devices: readdirSync('/dev').sort(),",
      "  entropyMode: entropy.mode & 0o777,",
      "  entropyDevice: entropy.dev,",
      "  entropyInode: entropy.ino,",
      "  randomBytes: randomBytes(16).byteLength,",
      "  writeError,",
      "  child: { exit: await child.exited, stdout: childStdout, stderr: childStderr },",
      "}));",
    ].join(" ");
    const component = await backend(host).launch({
      runId: "bun-descendants",
      limits: {
        ...limits(),
        memoryBytes: 256 * 1024 * 1024,
        deadlineUnixMs: Date.now() + 10_000,
        cancellationGraceMs: 1_000,
      },
      readOnlyMounts: bun.runtimeSupport.closureSources.map((source) => ({
        source,
        destination: source,
      })),
      privateProcessFilesystem: true,
      privateRuntimeDevices: true,
      command: [bun.executable, "-e", program],
    });
    const stdout = collect(component.stdout);
    const stderr = collect(component.stderr);
    await component.closeInput();
    const completed = await component.completion;
    const diagnostics = await stderr;
    const output = await stdout;
    expect({ completed, diagnostics }).toMatchObject({
      completed: { exitCode: 0, fenced: true },
      diagnostics: "",
    });
    const result = JSON.parse(output.trim()) as {
      readonly pid: number;
      readonly outerVisible: boolean;
      readonly procMount: string;
      readonly cgroup: string;
      readonly mapsBytes: number;
      readonly devices: readonly string[];
      readonly entropyMode: number;
      readonly entropyDevice: number;
      readonly entropyInode: number;
      readonly randomBytes: number;
      readonly writeError: string;
      readonly child: { readonly exit: number; readonly stdout: string; readonly stderr: string };
    };
    expect(result).toMatchObject({
      pid: 1,
      outerVisible: false,
      cgroup: "0::/\n",
      entropyMode: 0o444,
      randomBytes: 16,
      writeError: "EACCES",
      child: { exit: 0, stderr: "" },
    });
    expect(result.procMount).toMatch(/^proc \/proc proc ro,nosuid,nodev,noexec,/);
    expect(result.mapsBytes).toBeGreaterThan(0);
    expect(result.devices).not.toContain("kvm");
    expect(result.devices).not.toContain("net");
    expect({ dev: result.entropyDevice, ino: result.entropyInode }).not.toEqual({
      dev: hostEntropy.dev,
      ino: hostEntropy.ino,
    });
    const hostEntropyAfter = await stat("/dev/urandom");
    expect({
      dev: hostEntropyAfter.dev,
      ino: hostEntropyAfter.ino,
      mode: hostEntropyAfter.mode & 0o777,
    }).toEqual({
      dev: hostEntropy.dev,
      ino: hostEntropy.ino,
      mode: hostEntropy.mode & 0o777,
    });
    expect(await exists(join(
      "/dev",
      `.jig-${basename(component.cgroup.parentCgroup)}-devices`,
    ))).toBe(false);
    const child = JSON.parse(result.child.stdout) as {
      readonly pid: number;
      readonly mapsBytes: number;
      readonly selfVisible: boolean;
    };
    expect(child.pid).toBeGreaterThan(1);
    expect(child.mapsBytes).toBeGreaterThan(0);
    expect(child.selfVisible).toBe(true);
  });

  test("evaluates one captured project declaration in a root-only Bun envelope", async () => {
    host = await hostConfiguration();
    const bun = await proofHostBunClosure();
    const distribution = await realpath(join(import.meta.dir, "..", "dist"));
    const root = await mkdtemp(join(tmpdir(), "jig-evaluator-proof-"));
    const evaluator = {
      backend: backend(host),
      bunPath: bun.executable,
      runtimeMounts: bun.runtimeSupport.closureSources.map((source) => ({
        source,
        destination: source,
      })),
      runtimeSupport: bun.runtimeSupport,
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
          runtimeSupport: {
            kind: "runtime-support-observation/1",
            digest: bun.runtimeSupport.digest,
            leaseId: bun.runtimeSupport.lease.id,
            receiptDigest: bun.runtimeSupport.lease.receiptDigest,
          },
          sandbox: {
            kind: "linux-cgroup-v2-bubblewrap/1",
            privateProcessFilesystem: true,
            privateRuntimeDevices: true,
            limits: {
              memoryBytes: 256 * 1024 * 1024,
              pids: 32,
              deadlineUnixMs: expect.any(Number),
              cancellationGraceMs: 1_000,
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

  test("publishes one complete retained package project from a shared root owner", async () => {
    host = await hostConfiguration();
    const bun = await proofHostBunClosure();
    const distribution = await realpath(join(import.meta.dir, "..", "dist"));
    const root = await mkdtemp(join(tmpdir(), "jig-retained-project-"));
    const store = await mkdtemp(join(tmpdir(), "jig-retained-store-"));
    let rootController: Awaited<ReturnType<typeof openPrivateRootAdministrationController>> | undefined;
    const evaluator = {
      backend: backend(host),
      bunPath: bun.executable,
      runtimeMounts: bun.runtimeSupport.closureSources.map((source) => ({
        source,
        destination: source,
      })),
      runtimeSupport: bun.runtimeSupport,
      jigDistributionPath: distribution,
    } as const;
    try {
      await mkdir(join(root, "bindings"));
      await mkdir(join(root, "flows", "run"), { recursive: true });
      await writeFile(join(root, "shared.ts"), [
        'import { defineBinding, defineJig, discover } from "@jigging/jig";',
        'export const project = defineJig({ flows: discover("flows"), bindings: discover("bindings") });',
        'export const configured = defineBinding({ package: "flows/run" });',
      ].join("\n"));
      await writeFile(join(root, "jig.ts"), [
        'import { project } from "./shared.ts";',
        "export default project;",
      ].join("\n"));
      await writeFile(join(root, "bindings", "run.ts"), [
        'import { configured } from "../shared.ts";',
        "export default configured;",
      ].join("\n"));
      await writeFile(join(root, "flows", "run", "FLOW.md"), [
        "---",
        "name: run",
        "description: Retained aggregate fixture.",
        "service: 1",
        "---",
        "",
      ].join("\n"));
      await writeFile(join(root, "flows", "run", "flow.ts"), "export {};\n");

      const aggregate = await retainPackageProject({
        projectRoot: root,
        storeRoot: store,
        evaluator,
      });

      expect(aggregate.captureDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(aggregate.root).toEqual({ device: expect.any(String), inode: expect.any(String) });
      expect(aggregate.bindings.map(({ id }) => id)).toEqual(["run"]);
      expect(aggregate.flows.map(({ provenance }) => provenance.projectPath)).toEqual(["flows/run"]);
      expect(aggregate.linked.bindings).toHaveLength(1);
      expect(aggregate.linked.bindings[0]).toMatchObject({
        id: "run",
        packagePath: "flows/run",
      });
      const requests = buildPrivateActivationRequests(aggregate.linked);
      const planning = createPrivateActivationPlanningObservation({
        policyDigest: testDigest("retained-policy"),
        mechanismDigest: testDigest("retained-mechanisms"),
        entries: requests.map((request) => ({
          target: request.target,
          requestDigest: request.digest,
          disposition: {
            state: "unavailable" as const,
            code: "RUNTIME_UNAVAILABLE" as const,
            evidenceDigests: [testDigest(`unavailable:${request.digest}`)],
          },
        })),
      });
      const resolution = resolveRetainedPackageProjectObservation(aggregate, planning);
      expect(requirePrivateRetainedResolutionObservation(resolution)).toBe(resolution);
      const unavailable = createPrivateActivationCandidate(aggregate, resolution);
      expect(requirePrivateCreatedActivationCandidate(unavailable)).toBe(unavailable);
      expect(privateActivationCandidateDigest(unavailable)).toMatch(/^sha256:[0-9a-f]{64}$/);
      const persisted = encodePrivateActivationCandidate(unavailable);
      const restarted = decodePrivateActivationCandidate(persisted);
      expect(encodePrivateActivationCandidate(restarted)).toEqual(persisted);
      expect(() => requirePrivateCreatedActivationCandidate(restarted)).toThrow(
        "was not built from a retained project",
      );

      const firstHead = await publishPrivateActivationCandidate({
        projectRoot: root,
        packageStoreRoot: store,
        candidate: unavailable,
      });
      expect(firstHead).toEqual({
        candidateRevision: 1,
        candidateDigest: privateActivationCandidateDigest(unavailable),
      });
      expect(await publishPrivateActivationCandidate({
        projectRoot: root,
        packageStoreRoot: store,
        candidate: unavailable,
      })).toEqual(firstHead);
      expect(await Promise.all(Array.from({ length: 4 }, () => retryAdmissionBusy(
        () => publishPrivateActivationCandidate({
          projectRoot: root,
          packageStoreRoot: store,
          candidate: unavailable,
        }),
      )))).toEqual(Array.from({ length: 4 }, () => firstHead));
      const firstPlan = await createPrivateActivationReviewPlan({
        projectRoot: root,
        packageStoreRoot: store,
        lockMode: "update",
      });
      expect(firstPlan.plan).toMatchObject({
        candidateRevision: 1,
        candidateDigest: firstHead.candidateDigest,
        baseGeneration: null,
        lockMode: "update",
        observedLock: { state: "absent" },
      });
      expect(requirePrivateStoredActivationCandidate(firstPlan.candidate)).toBe(firstPlan.candidate);
      expect(() => requirePrivateCreatedActivationCandidate(firstPlan.candidate)).toThrow(
        "was not built from a retained project",
      );
      const loadedFirstPlan = await loadPrivateActivationReviewPlan({
        projectRoot: root,
        packageStoreRoot: store,
        planDigest: firstPlan.planDigest,
      });
      expect(loadedFirstPlan.plan).toEqual(firstPlan.plan);
      expect(loadedFirstPlan.planBytes).toEqual(firstPlan.planBytes);
      expect(requirePrivateStoredActivationCandidate(loadedFirstPlan.candidate)).toBe(
        loadedFirstPlan.candidate,
      );
      expect((await createPrivateActivationReviewPlan({
        projectRoot: root,
        packageStoreRoot: store,
        lockMode: "update",
      })).planDigest).toBe(firstPlan.planDigest);
      expect(await Promise.all(Array.from({ length: 4 }, async () => (
        await retryAdmissionBusy(() => createPrivateActivationReviewPlan({
          projectRoot: root,
          packageStoreRoot: store,
          lockMode: "update",
        }))
      ).planDigest))).toEqual(
        Array.from({ length: 4 }, () => firstPlan.planDigest),
      );
      await expect(createPrivateActivationReviewPlan({
        projectRoot: root,
        packageStoreRoot: store,
        lockMode: "locked",
      }))
        .rejects.toMatchObject({ code: "LOCK_MISMATCH" });
      const admissionDatabase = join(root, ".jig", "private-activation-admission-v7.sqlite3");
      await writeFile(join(root, "jig.lock"), persisted.lock, { mode: 0o644 });
      const crashSqlite = createRequire(import.meta.url)("bun:sqlite") as any;
      const recovered = crashSqlite.Database.open(
        admissionDatabase,
        crashSqlite.constants.SQLITE_OPEN_READONLY | crashSqlite.constants.SQLITE_OPEN_NOFOLLOW,
      );
      expect(recovered.query("SELECT count(*) AS count FROM admissions").get().count).toBe(0);
      expect(recovered.query("SELECT revision FROM admission_head WHERE singleton = 1").get().revision)
        .toBeNull();
      recovered.close(true);
      const firstAdmission = await applyPrivateActivationReviewPlan({
        projectRoot: root,
        packageStoreRoot: store,
        planDigest: firstPlan.planDigest,
        baseGeneration: null,
      });
      expect(await applyPrivateActivationReviewPlan({
        projectRoot: root,
        packageStoreRoot: store,
        planDigest: firstPlan.planDigest,
        baseGeneration: null,
      })).toEqual(firstAdmission);
      expect(new Uint8Array(await readFile(join(root, "jig.lock")))).toEqual(persisted.lock);
      const lockedPlan = await createPrivateActivationReviewPlan({
        projectRoot: root,
        packageStoreRoot: store,
        lockMode: "locked",
      });
      expect(lockedPlan.plan.observedLock).toEqual({
        state: "present",
        digest: `sha256:${createHash("sha256").update(persisted.lock).digest("hex")}`,
      });
      expect(lockedPlan.plan.baseGeneration).toBe(firstAdmission.admissionDigest);
      await rm(join(root, "jig.lock"));

      const secondPlanning = createPrivateActivationPlanningObservation({
        policyDigest: testDigest("retained-policy-2"),
        mechanismDigest: testDigest("retained-mechanisms"),
        entries: requests.map((request) => ({
          target: request.target,
          requestDigest: request.digest,
          disposition: {
            state: "unavailable" as const,
            code: "RUNTIME_UNAVAILABLE" as const,
            evidenceDigests: [testDigest(`unavailable-2:${request.digest}`)],
          },
        })),
      });
      const second = createPrivateActivationCandidate(
        aggregate,
        resolveRetainedPackageProjectObservation(aggregate, secondPlanning),
      );
      const secondHead = await publishPrivateActivationCandidate({
        projectRoot: root,
        packageStoreRoot: store,
        candidate: second,
      });
      expect(secondHead.candidateRevision).toBe(2);
      expect(secondHead.candidateDigest).not.toBe(firstHead.candidateDigest);
      const replayedHead = await publishPrivateActivationCandidate({
        projectRoot: root,
        packageStoreRoot: store,
        candidate: unavailable,
      });
      expect(replayedHead).toEqual({ candidateRevision: 3, candidateDigest: firstHead.candidateDigest });
      const replayedPlan = await createPrivateActivationReviewPlan({
        projectRoot: root,
        packageStoreRoot: store,
        lockMode: "update",
      });
      expect(replayedPlan.plan).toMatchObject({
        candidateRevision: 3,
        candidateDigest: firstHead.candidateDigest,
      });
      expect((await loadPrivateActivationReviewPlan({
        projectRoot: root,
        packageStoreRoot: store,
        planDigest: firstPlan.planDigest,
      })).plan).toEqual(firstPlan.plan);
      expect((await stat(join(root, ".jig"))).mode & 0o777).toBe(0o700);
      expect((await stat(admissionDatabase)).mode & 0o777)
        .toBe(0o600);
      const interruptedWriter = spawn(process.execPath, [
        "-e",
        [
          'import { Database, constants } from "bun:sqlite";',
          "const database = Database.open(process.argv[1], constants.SQLITE_OPEN_READWRITE | constants.SQLITE_OPEN_NOFOLLOW);",
          'if (database.query("PRAGMA journal_mode").get().journal_mode !== "delete") throw new Error("not DELETE mode");',
          'database.exec("PRAGMA synchronous=EXTRA; PRAGMA cache_size=1; BEGIN IMMEDIATE");',
          'database.query("UPDATE candidates SET candidate_bytes = randomblob(1048576) WHERE revision = 3").run();',
          'console.log("READY");',
          "await Bun.sleep(3600000);",
        ].join("\n"),
        admissionDatabase,
      ], { stdio: ["ignore", "pipe", "pipe"] });
      expect(await firstLine(interruptedWriter.stdout!)).toBe("READY");
      await waitUntil(async () => {
        try { return (await stat(`${admissionDatabase}-journal`)).size > 0; }
        catch { return false; }
      }, 2_000);
      interruptedWriter.kill("SIGKILL");
      expect((await childExit(interruptedWriter)).signal).toBe("SIGKILL");
      expect((await loadPrivateActivationReviewPlan({
        projectRoot: root,
        packageStoreRoot: store,
        planDigest: replayedPlan.planDigest,
      })).plan).toEqual(replayedPlan.plan);
      const rollbackJournal = `${admissionDatabase}-journal`;
      const nonHotJournal = new Uint8Array(512);
      await writeFile(rollbackJournal, nonHotJournal, { mode: 0o600 });
      expect((await loadPrivateActivationReviewPlan({
        projectRoot: root,
        packageStoreRoot: store,
        planDigest: replayedPlan.planDigest,
      })).plan).toEqual(replayedPlan.plan);
      expect(new Uint8Array(await readFile(rollbackJournal))).toEqual(nonHotJournal);
      await chmod(rollbackJournal, 0o644);
      await expect(loadPrivateActivationReviewPlan({
        projectRoot: root,
        packageStoreRoot: store,
        planDigest: replayedPlan.planDigest,
      })).rejects.toMatchObject({ code: "ADMISSION_SQLITE_SIDECAR" });
      await rm(rollbackJournal);
      await writeFile(`${admissionDatabase}-wal`, new Uint8Array(), { mode: 0o600 });
      await expect(loadPrivateActivationReviewPlan({
        projectRoot: root,
        packageStoreRoot: store,
        planDigest: replayedPlan.planDigest,
      })).rejects.toMatchObject({ code: "ADMISSION_SQLITE_SIDECAR" });
      await rm(`${admissionDatabase}-wal`);
      const sqlite = createRequire(import.meta.url)("bun:sqlite") as any;
      const database = sqlite.Database.open(
        admissionDatabase,
        sqlite.constants.SQLITE_OPEN_READONLY | sqlite.constants.SQLITE_OPEN_NOFOLLOW,
      );
      try {
        expect(database.query(
          "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        ).all().map(({ name }: { name: string }) => name)).toEqual([
          "admission_head",
          "admissions",
          "candidate_head",
          "candidates",
          "coordinator_head",
          "review_plans",
          "root_execution_closures",
          "root_execution_lifecycles",
          "root_runs",
          "root_spawn_intents",
          "root_terminals",
        ]);
        expect(database.query("PRAGMA application_id").get().application_id).toBe(0x4a494737);
        expect(database.query("PRAGMA user_version").get().user_version).toBe(7);
        expect(database.query("PRAGMA journal_mode").get().journal_mode).toBe("delete");
        expect(database.query("SELECT revision FROM candidate_head WHERE singleton = 1").get().revision).toBe(3);
        expect(database.query("SELECT count(*) AS count FROM candidates").get().count).toBe(3);
        expect(database.query("SELECT count(*) AS count FROM review_plans").get().count).toBe(3);
        expect(database.query("SELECT count(*) AS count FROM admissions").get().count).toBe(1);
      } finally {
        database.close(true);
      }
      const declarations = await captureStoredPackage(store, aggregate.declarationArtifact.package);
      try {
        expect(declarations.files.map(({ path }) => path)).toEqual([
          "bindings/run.ts",
          "jig.ts",
          "shared.ts",
        ]);
      } finally {
        await declarations.dispose();
      }
      const writableFlags = sqlite.constants.SQLITE_OPEN_READWRITE |
        sqlite.constants.SQLITE_OPEN_NOFOLLOW;
      let corruptor = sqlite.Database.open(admissionDatabase, writableFlags);
      const secondRow = corruptor.query(
        "SELECT candidate_digest, candidate_bytes, lock_bytes FROM candidates WHERE revision = 2",
      ).get();
      const retainedSecondRow = {
        candidateDigest: secondRow.candidate_digest,
        candidateBytes: Uint8Array.from(secondRow.candidate_bytes),
        lockBytes: Uint8Array.from(secondRow.lock_bytes),
      };
      corruptor.query("DELETE FROM candidates WHERE revision = 2").run();
      corruptor.close(true);
      await expect(loadPrivateActivationReviewPlan({
        projectRoot: root,
        packageStoreRoot: store,
        planDigest: firstPlan.planDigest,
      })).rejects.toMatchObject({ code: "ADMISSION_STATE_CORRUPT" });

      corruptor = sqlite.Database.open(admissionDatabase, writableFlags);
      corruptor.query(
        "INSERT INTO candidates(revision, candidate_digest, candidate_bytes, lock_bytes) VALUES (2, ?1, ?2, ?3)",
      ).run(retainedSecondRow.candidateDigest, retainedSecondRow.candidateBytes, retainedSecondRow.lockBytes);
      corruptor.close(true);
      expect((await loadPrivateActivationReviewPlan({
        projectRoot: root,
        packageStoreRoot: store,
        planDigest: firstPlan.planDigest,
      })).plan).toEqual(firstPlan.plan);

      const secondAdmission = await applyPrivateActivationReviewPlan({
        projectRoot: root,
        packageStoreRoot: store,
        planDigest: replayedPlan.planDigest,
        baseGeneration: firstAdmission.admissionDigest,
      });
      expect(secondAdmission.admission.baseGeneration).toBe(firstAdmission.admissionDigest);
      expect(await applyPrivateActivationReviewPlan({
        projectRoot: root,
        packageStoreRoot: store,
        planDigest: firstPlan.planDigest,
        baseGeneration: null,
      })).toEqual(firstAdmission);
      await expect(applyPrivateActivationReviewPlan({
        projectRoot: root,
        packageStoreRoot: store,
        planDigest: lockedPlan.planDigest,
        baseGeneration: firstAdmission.admissionDigest,
      })).rejects.toMatchObject({ code: "STALE_PLAN" });

      await writeFile(join(root, "jig.ts"), [
        'import { defineJig } from "@jigging/jig";',
        'export default defineJig({ flows: ["flows/run"] });',
        "",
      ].join("\n"));
      await writeFile(join(root, "flows", "run", "FLOW.md"), [
        "---",
        "name: ready-run",
        "description: Admitted retained Bun Run fixture.",
        "---",
        "",
      ].join("\n"));
      const readySdk = join(root, "flows", "run", "flow-sdk");
      await mkdir(readySdk);
      for (const name of [
        "index.ts",
        "json.ts",
        "protocol.ts",
        "service-session.ts",
        "session.ts",
        "transport.ts",
        "types.ts",
      ]) {
        await writeFile(
          join(readySdk, name),
          await readFile(join(import.meta.dir, "..", "..", "flow-sdk", "src", name)),
        );
      }
      await writeFile(join(root, "flows", "run", "flow.ts"), [
        "#!/usr/bin/env bun",
        'import { serve } from "./flow-sdk/index.ts";',
        "",
        "await serve(async (context) => ({",
        '  outcome: "done",',
        "  output: { admitted: context.input },",
        "}));",
        "",
      ].join("\n"));
      const readyAggregate = await retainPackageProject({
        projectRoot: root,
        storeRoot: store,
        evaluator,
      });
      const [readyRequest] = buildPrivateActivationRequests(readyAggregate.linked);
      const readyRecipe = await planPrivateDirectRun({
        request: readyRequest!,
        runtimeSupport: bun.runtimeSupport,
        backend: backend(host),
      });
      const readyPlanning = createPrivateActivationPlanningObservation({
        policyDigest: testDigest("ready-policy"),
        mechanismDigest: readyRecipe.mechanismDigest,
        entries: [{
          target: readyRequest!.target,
          requestDigest: readyRequest!.digest,
          disposition: { state: "planned" as const, observation: readyRecipe.observation },
        }],
      });
      const readyResolution = resolveRetainedPackageProjectObservation(readyAggregate, readyPlanning);
      const readyCandidate = createPrivateActivationCandidate(
        readyAggregate,
        readyResolution,
        readyRecipe,
      );
      expect(readyCandidate.candidate.target.disposition).toEqual({
        state: "ready",
        recipeDigest: readyRecipe.digest,
        observationDigest: readyRecipe.observation.digest,
      });
      const readyHead = await publishPrivateActivationCandidate({
        projectRoot: root,
        packageStoreRoot: store,
        candidate: readyCandidate,
      });
      expect(readyHead.candidateRevision).toBe(4);
      const readyPlan = await createPrivateActivationReviewPlan({
        projectRoot: root,
        packageStoreRoot: store,
        lockMode: "update",
      });
      expect(readyPlan.candidate.candidate.target.disposition.state).toBe("ready");
      const readyAdmission = await applyPrivateActivationReviewPlan({
        projectRoot: root,
        packageStoreRoot: store,
        planDigest: readyPlan.planDigest,
        baseGeneration: secondAdmission.admissionDigest,
      });
      expect(readyAdmission.admission.baseGeneration).toBe(secondAdmission.admissionDigest);

      const restartedActivation = await loadPrivateActiveActivation({
        projectRoot: root,
        packageStoreRoot: store,
      });
      expect(restartedActivation.admission).toEqual(readyAdmission);
      const admittedRequest = restartedActivation.candidate.candidate.target.request;
      expect(admittedRequest.digest).toBe(readyRequest!.digest);
      const reacquiredBun = await proofHostBunClosure();
      const rootBackend = backend(host);
      rootController = await openPrivateRootAdministrationController({
        projectRoot: root,
        packageStoreRoot: store,
        runTimeoutMs: 20_000,
        execute: (runId, coordinator, signal) => executePrivateRootRunLaunch({
          projectRoot: root,
          packageStoreRoot: store,
          runId,
          coordinator,
          runtimeSupport: reacquiredBun.runtimeSupport,
          backend: rootBackend,
          signal,
        }),
      });
      const submitted = await rootController.administration.startRun({
        submissionId: "ticket-T-1",
        target: admittedRequest.target,
        input: { ticket: "T-1" },
      });
      expect((await rootController.administration.runStatus(submitted)).runId).toBe(submitted.runId);
      expect(await rootController.administration.startRun({
        submissionId: "ticket-T-1",
        target: admittedRequest.target,
        input: { ticket: "T-1" },
      })).toEqual(submitted);
      await rootController.drain();
      const completed = await rootController.administration.runStatus(submitted);
      expect(completed).toMatchObject({
        state: "terminal",
        terminal: {
          status: "succeeded",
          outcome: "done",
          output: { admitted: { ticket: "T-1" } },
        },
      });
      expect(await rootController.administration.startRun({
        submissionId: "ticket-T-1",
        target: admittedRequest.target,
        input: { ticket: "T-1" },
      })).toEqual(submitted);

      const competingCoordinator = spawn(process.execPath, [
        join(import.meta.dir, "fixtures", "root-run-submitter.ts"),
        root,
        store,
        "ticket-blocked",
      ], { stdio: ["ignore", "ignore", "pipe"] });
      const competingDiagnostics = collect(competingCoordinator.stderr!);
      expect((await childExit(competingCoordinator)).code).not.toBe(0);
      expect(await competingDiagnostics).toContain("another coordinator owns this project");

      await rootController.dispose();
      rootController = undefined;
      const lostCoordinator = spawn(process.execPath, [
        join(import.meta.dir, "fixtures", "root-run-submitter.ts"),
        root,
        store,
        "ticket-T-2",
      ], { stdio: ["ignore", "pipe", "pipe"] });
      const abandoned = JSON.parse(await firstLine(lostCoordinator.stdout!)) as { readonly runId: string };
      lostCoordinator.kill("SIGKILL");
      expect((await childExit(lostCoordinator)).signal).toBe("SIGKILL");
      rootController = await openPrivateRootAdministrationController({
        projectRoot: root,
        packageStoreRoot: store,
        runTimeoutMs: 20_000,
        execute: (runId, coordinator, signal) => executePrivateRootRunLaunch({
          projectRoot: root,
          packageStoreRoot: store,
          runId,
          coordinator,
          runtimeSupport: reacquiredBun.runtimeSupport,
          backend: rootBackend,
          signal,
        }),
      });
      expect(await rootController.administration.runStatus(abandoned)).toMatchObject({
        runId: abandoned.runId,
        state: "terminal",
        terminal: { status: "lost", code: "COORDINATOR_LOST" },
      });
      await rootController.dispose();
      rootController = undefined;

      corruptor = sqlite.Database.open(admissionDatabase, writableFlags);
      corruptor.query("UPDATE candidates SET candidate_digest = ?1 WHERE revision = 1")
        .run(`sha256:${"0".repeat(64)}`);
      corruptor.close(true);
      await expect(loadPrivateActivationReviewPlan({
        projectRoot: root,
        packageStoreRoot: store,
        planDigest: firstPlan.planDigest,
      })).rejects.toMatchObject({ code: "ADMISSION_STATE_CORRUPT" });
    } finally {
      await rootController?.dispose();
      await rm(root, { recursive: true, force: true });
      await rm(store, { recursive: true, force: true });
    }
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

/**
 * Host-specific fixture discovery for the current containment proof. It is
 * deliberately not a Runtime Adapter, Nix integration, or portable recipe.
 */
async function proofHostBunClosure(): Promise<{
  executable: string;
  runtimeSupport: Awaited<ReturnType<typeof observeAgentSandboxRuntimeSupport>>;
}> {
  const executable = await realpath("/bin/bun");
  const receiptsDirectory = process.env.AGENT_RUNTIME_RECEIPTS_DIR;
  const expectedLeaseId = process.env.AGENT_RUNTIME_LEASE_ID;
  if (receiptsDirectory === undefined || expectedLeaseId === undefined) {
    throw new Error("proof host did not expose its runtime lease receipt");
  }
  const runtimeSupport = await observeAgentSandboxRuntimeSupport({
    receiptsDirectory,
    expectedLeaseId,
    executablePath: executable,
  });
  expect(requirePrivateRuntimeSupportObservation(runtimeSupport)).toBe(runtimeSupport);
  return {
    executable,
    runtimeSupport,
  };
}

async function proofHostPythonClosure(): Promise<{
  executable: string;
  runtimeSupport: Awaited<ReturnType<typeof observeAgentSandboxRuntimeSupport>>;
}> {
  const receiptsDirectory = process.env.AGENT_RUNTIME_RECEIPTS_DIR;
  const expectedLeaseId = process.env.AGENT_RUNTIME_LEASE_ID;
  if (receiptsDirectory === undefined || expectedLeaseId === undefined) {
    throw new Error("proof host did not expose its runtime lease receipt");
  }
  const candidates: Array<{ receiptName: string; executablePath: string }> = [];
  for (const receiptName of (await readdir(receiptsDirectory)).sort()) {
    if (!/^need-[0-9a-f]{64}\.json$/.test(receiptName)) continue;
    const value = JSON.parse(await readFile(join(receiptsDirectory, receiptName), "utf8")) as {
      kind?: unknown;
      installable?: unknown;
      selected_out_path?: unknown;
    };
    if (value.kind === "need-materialization" &&
        value.installable === "nixpkgs#python314" &&
        typeof value.selected_out_path === "string") {
      candidates.push({
        receiptName,
        executablePath: join(value.selected_out_path, "bin", "python3"),
      });
    }
  }
  if (candidates.length === 0) {
    throw new Error("proof host has no leased python314 runtime receipt");
  }
  const observations = await Promise.all(candidates.map(async (candidate) => ({
    executable: await realpath(candidate.executablePath),
    runtimeSupport: await observeAgentSandboxRuntimeSupport({
      receiptsDirectory,
      expectedLeaseId,
      receiptName: candidate.receiptName,
      executablePath: candidate.executablePath,
    }),
  })));
  const selected = observations[0]!;
  if (observations.some((observation) => observation.runtimeSupport.digest !== selected.runtimeSupport.digest)) {
    throw new Error("proof host exposes ambiguous python314 runtime receipts");
  }
  return selected;
}

async function proofHostUnshare(): Promise<string> {
  for (const entry of (await readdir("/nix/store")).sort()) {
    if (!entry.includes("-util-linux-") || !entry.endsWith("-bin")) continue;
    const candidate = join("/nix/store", entry, "bin", "unshare");
    if (await exists(candidate)) return await realpath(candidate);
  }
  throw new Error("proof host has no util-linux unshare executable");
}

function testDigest(label: string): string {
  return `sha256:${createHash("sha256").update(label).digest("hex")}`;
}

function backend(host: HostConfiguration, startupTimeoutMs?: number): PrivateLinuxCgroupBackend {
  return new PrivateLinuxCgroupBackend({
    cgroupScope: host.scope,
    sudoPath: "/agent-sudo/bin/sudo",
    subreaperPath: "/run/podman-init",
    mknodPath: "/bin/mknod",
    bunPath: "/bin/bun",
    bubblewrapPath: "/usr/bin/bwrap",
    bashPath: host.bash,
    payloadUid: 1000,
    payloadGid: 100,
    ...(startupTimeoutMs === undefined ? {} : { startupTimeoutMs }),
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
    // The proof host exposes Bash through the Nix store. This mount is test
    // infrastructure, not a package-visible default or Jig runtime policy.
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
    deadlineUnixMs: Date.now() + 2_000,
    cancellationGraceMs: 1_000,
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

async function invoke(
  command: string,
  arguments_: readonly string[],
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const child = spawn(command, arguments_, {
    cwd: "/",
    env: {},
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdout = collect(child.stdout!);
  const stderr = collect(child.stderr!);
  const exit = await childExit(child);
  return { code: exit.code, stdout: await stdout, stderr: await stderr };
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

async function zombiePids(): Promise<number[]> {
  const pids: number[] = [];
  for (const entry of await readdir("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const fields = (await readFile(`/proc/${entry}/stat`, "utf8")).split(" ");
      if (fields[2] === "Z") pids.push(Number(entry));
    } catch {
      // The process disappeared between directory and stat inspection.
    }
  }
  return pids.sort((left, right) => left - right);
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

async function retryAdmissionBusy<T>(action: () => Promise<T>): Promise<T> {
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    try {
      return await action();
    } catch (error) {
      if (!errorTreeHasCode(error, "ADMISSION_STATE_BUSY") || attempt === 8) throw error;
      await Bun.sleep(attempt * 10);
    }
  }
  throw new Error("unreachable admission retry state");
}

function sameMembers(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

function errorTreeHasCode(error: unknown, code: string): boolean {
  if (error === null || typeof error !== "object") return false;
  if ((error as { code?: unknown }).code === code) return true;
  if (error instanceof AggregateError && error.errors.some((nested) => errorTreeHasCode(nested, code))) {
    return true;
  }
  return "cause" in error && errorTreeHasCode((error as { cause: unknown }).cause, code);
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
