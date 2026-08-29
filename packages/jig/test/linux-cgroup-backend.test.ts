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
  observePrivateBunServicePackage,
  planPrivateBunService,
  type PrivateBunServiceRecipe,
} from "../src/internal/bun-service-recipe.js";
import {
  planPrivateDirectRun,
  requirePrivateDirectRunRecipe,
  runPrivateDirectRunRecipe,
} from "../src/internal/direct-run.js";
import {
  cancelPrivateLinuxOwnerStateAllocation,
  normalizePrivateLinuxConfirmedEnforcementReceipt,
  normalizePrivateLinuxOwnerStateReleaseReceipt,
  normalizePrivateLinuxPreparedOwnerIdentity,
  planPrivateLinuxOwnerStateAllocation,
  PrivateLinuxCgroupBackend,
  PrivateLinuxFenceUnconfirmedError,
  releasePrivateLinuxOwnerState,
  requirePrivateLinuxCgroupBackend,
  type PrivateLinuxCgroupBackendOptions,
  type PrivateLinuxLaunchPlan,
  type PrivateLinuxOwnerStateAllocationIdentity,
} from "../src/internal/linux-cgroup-backend.js";
import { privateDomainDigest } from "../src/internal/identity.js";
import { captureStoredPackage } from "../src/internal/package-artifact-store.js";
import {
  allocatePrivatePackageMaterialization,
  materializePrivatePackageLease,
} from "../src/internal/package-materialization.js";
import {
  planPrivatePythonDirectRun,
  requirePrivatePythonDirectRecipe,
  runPrivatePythonDirectRecipe,
} from "../src/internal/python-direct-run.js";
import {
  createPrivateActivationCandidateV5,
  decodePrivateActivationCandidateV5,
  encodePrivateActivationCandidateV5,
  privateActivationCandidateDigestV5,
  requirePrivateCreatedActivationCandidateV5,
} from "../src/internal/activation-admission.js";
import {
  allocatePrivateServiceMount,
  applyPrivateActivationReviewPlan,
  capturePrivateActivationPlanningBase,
  closePrivateServiceMount,
  createPrivateActivationReviewPlan,
  listPrivateServiceInvocations,
  listPrivateServiceLeases,
  listPrivateServiceMounts,
  listPrivateServiceMountRecoveryWork,
  loadPrivateActiveActivation,
  loadPrivateActivationReviewPlan,
  loadPrivateServiceMount,
  loadPrivateRootRun,
  openPrivateProjectCoordinator,
  publishPrivateActivationCandidate,
  publishPrivateActivationReviewPlan,
  recordPrivateServiceMountAcknowledged,
  recordPrivateServiceMountBacking,
  recordPrivateServiceMountFence,
  recordPrivateServiceMountGeneration,
  recordPrivateServiceMountPlan,
  recordPrivateServiceMountPrepared,
  recordPrivateServiceMountProvisional,
  recordPrivateServiceMountRelease,
  recordPrivateServiceMountSandbox,
  requirePrivateStoredActivationCandidate,
} from "../src/internal/activation-admission-store.js";
import {
  attachPrivateRootAdministrationController,
  openPrivateRootAdministrationController,
} from "../src/internal/root-administration-controller.js";
import {
  finalizeRecoveredPrivateServiceMounts,
  recoverPrivateServiceMountFences,
  startPrivateBunServiceMount,
} from "../src/internal/private-service-controller.js";
import { executePrivateRootRunLaunch } from "../src/internal/root-run-controller.js";
import {
  createPrivateRootJournalEffectsClosure,
  privateRootJournalEffectsClosureDigest,
} from "../src/internal/root-journal-effect-state.js";
import { privateServiceOwnerClosureDigest } from "../src/internal/private-service-state.js";
import { evaluateAuthorClosure } from "../src/project/author-evaluator.js";
import { captureAuthorClosure } from "../src/project/author-module.js";
import { defineJig, flowRef } from "../src/project/author.js";
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

  test("durable enforcement normalizers reject hostile shapes without invoking traps", () => {
    const enforcement = {
      kind: "private-linux-confirmed-enforcement/1" as const,
      ownerDigest: `sha256:${"a".repeat(64)}`,
      stopReason: "payload_exit" as const,
      exitCode: 0,
      signal: null,
      fenced: true as const,
      evidence: {
        cpuStat: { usage_usec: 1 },
        memoryEvents: { oom: 0 },
        pidsEvents: { max: 0 },
      },
    };
    const releaseFields = {
      kind: "private-linux-owner-state-release/1" as const,
      allocationDigest: `sha256:${"b".repeat(64)}`,
      directoryDevice: "1",
      directoryInode: "2",
      released: true as const,
    };
    const release = {
      ...releaseFields,
      digest: privateDomainDigest(
        "JIG-Private-Linux-Owner-State-Release/1",
        releaseFields,
      ),
    };
    expect(normalizePrivateLinuxConfirmedEnforcementReceipt(enforcement)).toEqual(enforcement);
    expect(normalizePrivateLinuxOwnerStateReleaseReceipt(release)).toEqual(release);

    for (const [valid, normalize] of [
      [enforcement, normalizePrivateLinuxConfirmedEnforcementReceipt],
      [release, normalizePrivateLinuxOwnerStateReleaseReceipt],
    ] as const) {
      let trapCalls = 0;
      const proxy = new Proxy(valid, {
        get() { trapCalls += 1; throw new Error("get trap invoked"); },
        getOwnPropertyDescriptor() { trapCalls += 1; throw new Error("descriptor trap invoked"); },
        getPrototypeOf() { trapCalls += 1; throw new Error("prototype trap invoked"); },
        ownKeys() { trapCalls += 1; throw new Error("keys trap invoked"); },
      });
      expect(() => normalize(proxy)).toThrow("invalid");
      expect(trapCalls).toBe(0);

      let accessorCalls = 0;
      const accessor = Object.defineProperty({ ...valid }, "kind", {
        enumerable: true,
        get() { accessorCalls += 1; throw new Error("accessor invoked"); },
      });
      expect(() => normalize(accessor)).toThrow("invalid");
      expect(accessorCalls).toBe(0);

      const nonenumerable = Object.defineProperty({ ...valid }, "kind", {
        enumerable: false,
        value: valid.kind,
      });
      expect(() => normalize(nonenumerable)).toThrow("invalid");
      expect(() => normalize(Object.assign(Object.create({ inherited: true }), valid)))
        .toThrow("invalid");
      expect(() => normalize(Object.assign({ ...valid }, { [Symbol("hostile")]: true })))
        .toThrow("invalid");
    }

    let nestedTrapCalls = 0;
    const hostileEvidence = new Proxy(enforcement.evidence, {
      get() { nestedTrapCalls += 1; throw new Error("get trap invoked"); },
      getOwnPropertyDescriptor() { nestedTrapCalls += 1; throw new Error("descriptor trap invoked"); },
      getPrototypeOf() { nestedTrapCalls += 1; throw new Error("prototype trap invoked"); },
      ownKeys() { nestedTrapCalls += 1; throw new Error("keys trap invoked"); },
    });
    expect(() => normalizePrivateLinuxConfirmedEnforcementReceipt({
      ...enforcement,
      evidence: hostileEvidence,
    })).toThrow("invalid");
    expect(nestedTrapCalls).toBe(0);
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
        })).rejects.toThrow("matching flow.ts activation");
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
              cpuQuotaMicros: 50_000,
              cpuPeriodMicros: 100_000,
              wallClockCeilingMs: 3_000,
              cancellationGraceMs: 1_000,
              cleanupTimeoutMs: 5_000,
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

  test("seals the private project Run-target authoring profile from ordinary evaluation", async () => {
    host = await hostConfiguration();
    const bun = await proofHostBunClosure();
    const distribution = await realpath(join(import.meta.dir, "..", "dist"));
    const root = await mkdtemp(join(tmpdir(), "jig-project-run-targets-evaluator-proof-"));
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
    const evaluate = async (
      source: string,
      expected: "binding" | "private-project-run-targets-binding",
    ) => {
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
      const projectRunTargetsSource = [
        'import { defineBinding, projectRunTargets } from "@jigging/jig/private/project-run-targets";',
        "export default defineBinding({",
        '  package: "flows/dispatcher",',
        "  slots: { work: projectRunTargets() },",
        "});",
      ].join("\n");
      const privateBinding = await evaluate(
        projectRunTargetsSource,
        "private-project-run-targets-binding",
      );
      expect(privateBinding.value).toEqual({
        kind: "package",
        package: "flows/dispatcher",
        settings: {},
        slots: { work: { kind: "project-run-targets" } },
        attachments: {},
      });
      expect(privateBinding.profile).toMatchObject({
        authoringProfile: "private-project-run-targets-authoring/1",
        privateProjectRunTargetsAuthoringSdkDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
        schemaDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      });
      await expect(evaluate(projectRunTargetsSource, "binding")).rejects.toMatchObject({
        code: "PROJECT_EVALUATOR_IMPORT",
      });
      await expect(evaluate([
        'import { defineHook, bindingRef, flowRef } from "@jigging/jig/experimental/hooks";',
        "export default defineHook({",
        '  on: { publisher: bindingRef("events"), type: "https://example.test/event" },',
        '  run: flowRef("flows/worker"),',
        "});",
      ].join("\n"), "private-project-run-targets-binding")).rejects.toMatchObject({
        code: "PROJECT_EVALUATOR_IMPORT",
      });
      expect((await evaluate([
        'import { defineJournalPublisher } from "@jigging/jig";',
        'export default defineJournalPublisher({ eventTypes: ["https://example.test/event"] });',
      ].join("\n"), "private-project-run-targets-binding")).value).toEqual({
        kind: "journal-publisher",
        eventTypes: ["https://example.test/event"],
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("allocates one authenticated Service Mount attempt per admitted generation", async () => {
    host = await hostConfiguration();
    const bun = await proofHostBunClosure();
    const distribution = await realpath(join(import.meta.dir, "..", "dist"));
    const root = await mkdtemp(join(tmpdir(), "jig-service-mount-store-"));
    const store = await mkdtemp(join(tmpdir(), "jig-service-mount-packages-"));
    let coordinator: Awaited<ReturnType<typeof openPrivateProjectCoordinator>> | undefined;
    let firstPackageLease: Awaited<ReturnType<typeof materializePrivatePackageLease>> | undefined;
    let thirdPackageLease: Awaited<ReturnType<typeof materializePrivatePackageLease>> | undefined;
    let firstPrepared: ReturnType<typeof normalizePrivateLinuxPreparedOwnerIdentity> | undefined;
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
      await mkdir(join(root, "flows", "counter", "contracts"), { recursive: true });
      await writeFile(join(root, "jig.ts"), [
        'import { defineJig, discover } from "@jigging/jig";',
        'export default defineJig({ flows: discover("flows"), bindings: discover("bindings") });',
        "",
      ].join("\n"));
      await writeFile(join(root, "bindings", "counter.ts"), [
        'import { defineBinding } from "@jigging/jig";',
        'export default defineBinding({ package: "flows/counter" });',
        "",
      ].join("\n"));
      await writeFile(join(root, "flows", "counter", "FLOW.md"), [
        "---",
        "name: counter",
        "description: Durable Service Mount allocation fixture.",
        "service: 1",
        "provides:",
        "  counter: ./contracts/counter.capability.json",
        "---",
        "",
      ].join("\n"));
      await writeFile(join(root, "flows", "counter", "contracts", "counter.capability.json"),
        JSON.stringify({
          $schema: "https://flow.dev/schemas/capability-contract-1.schema.json",
          flowCapabilityContract: 1,
          id: "https://example.test/capabilities/counter",
          version: "1.0.0",
          methods: {
            next: {
              input: { type: "object", additionalProperties: false },
              output: { type: "integer" },
              errors: {},
            },
          },
        }));
      await writeFile(
        join(root, "flows", "counter", "flow.ts"),
        "#!/usr/bin/env bun\nexport {};\n",
      );

      const firstAggregate = await retainPackageProject({
        projectRoot: root,
        storeRoot: store,
        evaluator,
      });
      const [firstRequest] = buildPrivateActivationRequests(firstAggregate.linked);
      expect(firstRequest?.target).toEqual({ kind: "binding", id: "counter" });
      const firstObservation = await observePrivateBunServicePackage({
        request: firstRequest!,
        packageStoreRoot: store,
      });
      const firstRecipe = await planPrivateBunService({
        request: firstRequest!,
        packageObservation: firstObservation,
        runtimeSupport: bun.runtimeSupport,
        backend: evaluator.backend,
      });
      const firstPlanning = createPrivateActivationPlanningObservation({
        policyDigest: testDigest("service-mount-policy-1"),
        mechanismDigest: firstRecipe.mechanismDigest,
        entries: [{
          target: firstRequest!.target,
          requestDigest: firstRequest!.digest,
          disposition: { state: "planned" as const, observation: firstRecipe.observation },
        }],
      });
      const firstCandidate = createPrivateActivationCandidateV5(
        firstAggregate,
        resolveRetainedPackageProjectObservation(firstAggregate, firstPlanning),
        firstRecipe,
      );
      await publishPrivateActivationCandidate({
        projectRoot: root,
        packageStoreRoot: store,
        candidate: firstCandidate,
      });
      const firstReview = await createPrivateActivationReviewPlan({
        projectRoot: root,
        packageStoreRoot: store,
        lockMode: "update",
      });
      const firstAdmission = await applyPrivateActivationReviewPlan({
        projectRoot: root,
        packageStoreRoot: store,
        planDigest: firstReview.planDigest,
      });

      coordinator = await openPrivateProjectCoordinator({ projectRoot: root });
      const firstDeadline = Date.now() + 20_000;
      const firstAllocations = await Promise.all([
        retryAdmissionBusy(async () => await allocatePrivateServiceMount({
          coordinator,
          projectRoot: root,
          packageStoreRoot: store,
          recipe: firstRecipe,
          effectiveDeadlineUnixMs: firstDeadline,
        })),
        retryAdmissionBusy(async () => await allocatePrivateServiceMount({
          coordinator,
          projectRoot: root,
          packageStoreRoot: store,
          recipe: firstRecipe,
          effectiveDeadlineUnixMs: firstDeadline,
        })),
      ]);
      expect(firstAllocations.filter(({ created }) => created)).toHaveLength(1);
      const firstAllocation = firstAllocations.find(({ created }) => created)!;
      const firstReplay = firstAllocations.find(({ created }) => !created)!;
      const firstMount = firstAllocation.snapshot;
      expect(firstMount).toMatchObject({
        coordinator: "current",
        allocation: {
          coordinatorEpoch: coordinator.epoch,
          admissionDigest: firstAdmission.admissionDigest,
          candidateRevision: firstAdmission.admission.candidateRevision,
          bindingId: "counter",
          requestDigest: firstRecipe.request.digest,
          recipeDigest: firstRecipe.digest,
          observationDigest: firstRecipe.observation.digest,
          expectedExports: ["counter"],
          effectiveDeadlineUnixMs: firstDeadline,
        },
      });
      expect(firstReplay).toEqual({ snapshot: firstMount, created: false });
      await expect(allocatePrivateServiceMount({
        coordinator,
        projectRoot: root,
        packageStoreRoot: store,
        recipe: firstRecipe,
        effectiveDeadlineUnixMs: firstDeadline + 1,
      })).rejects.toMatchObject({ code: "SERVICE_MOUNT_CONFLICT" });
      await expect(allocatePrivateServiceMount({
        coordinator,
        projectRoot: root,
        packageStoreRoot: store,
        recipe: { ...firstRecipe } as PrivateBunServiceRecipe,
        effectiveDeadlineUnixMs: firstDeadline,
      })).rejects.toThrow("Bun Service recipe was not produced by the private planner");
      expect(await loadPrivateServiceMount({
        coordinator,
        projectRoot: root,
        packageStoreRoot: store,
        mountId: firstMount.allocation.mountId,
      })).toEqual(firstMount);
      expect(await listPrivateServiceMounts({
        coordinator,
        projectRoot: root,
        packageStoreRoot: store,
        epoch: "current",
      })).toEqual([firstMount]);
      expect(await listPrivateServiceMounts({
        coordinator,
        projectRoot: root,
        packageStoreRoot: store,
        epoch: "older",
      })).toEqual([]);

      const serviceState = join(root, ".jig");
      const materializations = join(serviceState, "private-root-materializations");
      const owners = join(serviceState, "private-root-linux-owners");
      await mkdir(materializations, { mode: 0o700 });
      await mkdir(owners, { mode: 0o700 });
      const mountHex = firstMount.allocation.mountId.slice("sha256:".length);
      const packageAllocation = await allocatePrivatePackageMaterialization({
        protectedParent: materializations,
        name: `service-${mountHex}`,
        packageDigest: firstRecipe.request.package.digest,
        ownerToken: firstMount.allocationDigest,
      });
      const ownerAllocation = await planPrivateLinuxOwnerStateAllocation({
        parent: owners,
        name: `s-${mountHex.slice(0, 62)}`,
      });
      await expect(recordPrivateServiceMountPlan({
        coordinator,
        projectRoot: root,
        packageStoreRoot: store,
        mountId: firstMount.allocation.mountId,
        recipe: firstRecipe,
        allocation: firstReplay,
        packageAllocation,
        ownerAllocation,
      })).rejects.toThrow("Service Mount allocation did not create startup ownership");
      expect((await loadPrivateServiceMount({
        coordinator,
        projectRoot: root,
        packageStoreRoot: store,
        mountId: firstMount.allocation.mountId,
      })).plan).toBeUndefined();
      const plannedMount = await recordPrivateServiceMountPlan({
        coordinator,
        projectRoot: root,
        packageStoreRoot: store,
        mountId: firstMount.allocation.mountId,
        recipe: firstRecipe,
        allocation: firstAllocation,
        packageAllocation,
        ownerAllocation,
      });
      expect(plannedMount.plan?.value.packageAllocation).toEqual(packageAllocation);
      await expect(recordPrivateServiceMountGeneration({
        coordinator,
        projectRoot: root,
        packageStoreRoot: store,
        mountId: firstMount.allocation.mountId,
        recipe: firstRecipe,
        allocation: firstAllocation,
        exports: firstRecipe.expectedExports,
      })).rejects.toMatchObject({ code: "SERVICE_MOUNT_FACT_ORDER" });
      const capturedService = await captureStoredPackage(store, firstRecipe.request.package);
      try {
        firstPackageLease = await materializePrivatePackageLease(capturedService, packageAllocation);
      } finally {
        await capturedService.dispose();
      }
      const backedMount = await recordPrivateServiceMountBacking({
        coordinator,
        projectRoot: root,
        packageStoreRoot: store,
        mountId: firstMount.allocation.mountId,
        recipe: firstRecipe,
        allocation: firstAllocation,
        lease: firstPackageLease.identity,
      });
      const sealed = await firstRecipe.backend.seal({
        runId: `service-${mountHex.slice(0, 40)}`,
        limits: {
          ...firstRecipe.resourceCeilings,
          deadlineUnixMs: firstDeadline,
          cancellationGraceMs: firstRecipe.cancellationGraceMs,
        },
        readOnlyMounts: [
          ...firstRecipe.runtimeSupport.closureSources.map((source) => ({ source, destination: source })),
          { source: firstPackageLease.root, destination: firstRecipe.packageDestination },
        ],
        privateProcessFilesystem: true,
        privateRuntimeDevices: true,
        command: [
          firstRecipe.executablePath,
          ...firstRecipe.bunPolicy,
          `${firstRecipe.packageDestination}/${firstRecipe.request.entrypoint.path}`,
        ],
      }, ownerAllocation);
      const sandboxedMount = await recordPrivateServiceMountSandbox({
        coordinator,
        projectRoot: root,
        packageStoreRoot: store,
        mountId: firstMount.allocation.mountId,
        recipe: firstRecipe,
        allocation: firstAllocation,
        owner: sealed.identity,
      });
      firstPrepared = normalizePrivateLinuxPreparedOwnerIdentity({
        kind: "private-linux-prepared-owner/1",
        digest: privateDomainDigest(
          "JIG-Private-Linux-Prepared-Owner/1",
          sealed.identity,
        ),
        owner: sealed.identity,
      });
      const preparedMount = await recordPrivateServiceMountPrepared({
        coordinator,
        projectRoot: root,
        packageStoreRoot: store,
        mountId: firstMount.allocation.mountId,
        recipe: firstRecipe,
        allocation: firstAllocation,
        prepared: firstPrepared,
      });
      const generatedMount = await recordPrivateServiceMountGeneration({
        coordinator,
        projectRoot: root,
        packageStoreRoot: store,
        mountId: firstMount.allocation.mountId,
        recipe: firstRecipe,
        allocation: firstAllocation,
        exports: firstRecipe.expectedExports,
      });
      expect(generatedMount.generation?.value.exports).toEqual(["counter"]);
      await expect(recordPrivateServiceMountGeneration({
        coordinator,
        projectRoot: root,
        packageStoreRoot: store,
        mountId: firstMount.allocation.mountId,
        recipe: firstRecipe,
        allocation: firstAllocation,
        exports: [],
      })).rejects.toMatchObject({ code: "ADMISSION_STATE_CORRUPT" });
      const acknowledgedMount = await recordPrivateServiceMountAcknowledged({
        coordinator,
        projectRoot: root,
        packageStoreRoot: store,
        mountId: firstMount.allocation.mountId,
        recipe: firstRecipe,
        allocation: firstAllocation,
      });
      expect(acknowledgedMount).toMatchObject({
        plan: { digest: expect.any(String) },
        backing: { digest: expect.any(String) },
        sandbox: { digest: expect.any(String) },
        prepared: { digest: expect.any(String) },
        generation: { digest: expect.any(String) },
        acknowledged: { digest: expect.any(String) },
      });
      expect((await listPrivateServiceMountRecoveryWork({
        coordinator,
        projectRoot: root,
        epoch: "current",
      })).map(({ allocation }) => allocation.mountId)).toEqual([firstMount.allocation.mountId]);
      expect(await recordPrivateServiceMountAcknowledged({
        coordinator,
        projectRoot: root,
        packageStoreRoot: store,
        mountId: firstMount.allocation.mountId,
        recipe: firstRecipe,
        allocation: firstAllocation,
      })).toEqual(acknowledgedMount);
      expect(await recordPrivateServiceMountPlan({
        coordinator,
        projectRoot: root,
        packageStoreRoot: store,
        mountId: firstMount.allocation.mountId,
        recipe: firstRecipe,
        allocation: firstAllocation,
        packageAllocation,
        ownerAllocation,
      })).toEqual(acknowledgedMount);
      await coordinator.dispose();
      coordinator = undefined;

      coordinator = await openPrivateProjectCoordinator({ projectRoot: root });
      expect((await loadPrivateServiceMount({
        coordinator,
        projectRoot: root,
        packageStoreRoot: store,
        mountId: firstMount.allocation.mountId,
      })).coordinator).toBe("older");
      expect((await listPrivateServiceMounts({
        coordinator,
        projectRoot: root,
        packageStoreRoot: store,
        epoch: "older",
      })).map(({ allocation }) => allocation.mountId)).toEqual([firstMount.allocation.mountId]);
      expect((await listPrivateServiceMountRecoveryWork({
        coordinator,
        projectRoot: root,
        epoch: "older",
      })).map(({ allocation }) => allocation.mountId)).toEqual([firstMount.allocation.mountId]);
      await expect(allocatePrivateServiceMount({
        coordinator,
        projectRoot: root,
        packageStoreRoot: store,
        recipe: firstRecipe,
        effectiveDeadlineUnixMs: firstDeadline,
      })).rejects.toMatchObject({ code: "SERVICE_MOUNT_ALREADY_ATTEMPTED" });

      const coordinatorLossTerminal = {
        status: "failed" as const,
        code: "UNCERTAIN" as const,
        message: "coordinator ownership was lost",
        diagnostics: { stderr: "", stderrBytes: 0, stderrTruncated: false },
      };
      const provisionalMount = await recordPrivateServiceMountProvisional({
        coordinator,
        projectRoot: root,
        packageStoreRoot: store,
        mountId: firstMount.allocation.mountId,
        classification: "coordinator-loss",
        terminal: coordinatorLossTerminal,
      });
      const enforcement = normalizePrivateLinuxConfirmedEnforcementReceipt({
        kind: "private-linux-confirmed-enforcement/1",
        ownerDigest: firstPrepared!.digest,
        stopReason: "recovered",
        exitCode: null,
        signal: null,
        fenced: true,
        evidence: { cpuStat: {}, memoryEvents: {}, pidsEvents: {} },
      });
      const fencedMount = await recordPrivateServiceMountFence({
        coordinator,
        projectRoot: root,
        packageStoreRoot: store,
        mountId: firstMount.allocation.mountId,
        proof: {
          kind: "enforcement-confirmed",
          sandboxDigest: provisionalMount.sandbox!.digest,
          receipt: enforcement,
        },
      });
      await firstPackageLease!.dispose();
      firstPackageLease = undefined;
      const releaseFields = {
        kind: "private-linux-owner-state-release/1" as const,
        allocationDigest: fencedMount.plan!.value.ownerAllocation.digest,
        directoryDevice: fencedMount.sandbox!.value.owner.ownerStateDevice,
        directoryInode: fencedMount.sandbox!.value.owner.ownerStateInode,
        released: true as const,
      };
      const ownerRelease = normalizePrivateLinuxOwnerStateReleaseReceipt({
        ...releaseFields,
        digest: privateDomainDigest(
          "JIG-Private-Linux-Owner-State-Release/1",
          releaseFields,
        ),
      });
      const releasedMount = await recordPrivateServiceMountRelease({
        coordinator,
        projectRoot: root,
        packageStoreRoot: store,
        mountId: firstMount.allocation.mountId,
        packageReleased: true,
        ownerRelease,
      });
      const closedMount = await closePrivateServiceMount({
        coordinator,
        projectRoot: root,
        packageStoreRoot: store,
        mountId: firstMount.allocation.mountId,
      });
      expect(closedMount).toMatchObject({
        coordinator: "older",
        provisional: { value: { classification: "coordinator-loss" } },
        fence: { digest: expect.any(String) },
        release: { digest: releasedMount.release!.digest },
        closure: { digest: expect.any(String) },
      });
      expect((await recordPrivateServiceMountProvisional({
        coordinator,
        projectRoot: root,
        mountId: firstMount.allocation.mountId,
        classification: "coordinator-loss",
        terminal: coordinatorLossTerminal,
      })).closure?.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(await listPrivateServiceMountRecoveryWork({
        coordinator,
        projectRoot: root,
        epoch: "older",
      })).toEqual([]);

      await writeFile(join(root, "bindings", "other.ts"), [
        'import { defineBinding } from "@jigging/jig";',
        'export default defineBinding({ package: "flows/counter" });',
        "",
      ].join("\n"));
      const secondAggregate = await retainPackageProject({
        projectRoot: root,
        storeRoot: store,
        evaluator,
      });
      const secondRequests = buildPrivateActivationRequests(secondAggregate.linked);
      const otherRequest = secondRequests.find(({ target }) =>
        target.kind === "binding" && target.id === "other");
      const currentRequest = secondRequests.find(({ target }) =>
        target.kind === "binding" && target.id === "counter");
      expect(otherRequest?.target).toEqual({ kind: "binding", id: "other" });
      expect(currentRequest?.target).toEqual({ kind: "binding", id: "counter" });
      const otherObservation = await observePrivateBunServicePackage({
        request: otherRequest!,
        packageStoreRoot: store,
      });
      const otherRecipe = await planPrivateBunService({
        request: otherRequest!,
        packageObservation: otherObservation,
        runtimeSupport: bun.runtimeSupport,
        backend: evaluator.backend,
      });
      const currentObservation = await observePrivateBunServicePackage({
        request: currentRequest!,
        packageStoreRoot: store,
      });
      const currentRecipe = await planPrivateBunService({
        request: currentRequest!,
        packageObservation: currentObservation,
        runtimeSupport: bun.runtimeSupport,
        backend: evaluator.backend,
      });
      await expect(allocatePrivateServiceMount({
        coordinator,
        projectRoot: root,
        packageStoreRoot: store,
        recipe: otherRecipe,
        effectiveDeadlineUnixMs: Date.now() + 20_000,
      })).rejects.toMatchObject({ code: "SERVICE_MOUNT_TARGET_MISMATCH" });
      await coordinator.dispose();
      coordinator = undefined;

      const multiplePlanning = createPrivateActivationPlanningObservation({
        policyDigest: testDigest("service-mount-policy-multiple"),
        mechanismDigest: otherRecipe.mechanismDigest,
        entries: secondRequests.map((request) => ({
          target: request.target,
          requestDigest: request.digest,
          disposition: {
            state: "planned" as const,
            observation: request.target.kind === "binding" && request.target.id === "other"
              ? otherRecipe.observation
              : currentRecipe.observation,
          },
        })),
      });
      const multipleCandidate = createPrivateActivationCandidateV5(
        secondAggregate,
        resolveRetainedPackageProjectObservation(secondAggregate, multiplePlanning),
        [currentRecipe, otherRecipe],
      );
      await publishPrivateActivationCandidate({
        projectRoot: root,
        packageStoreRoot: store,
        candidate: multipleCandidate,
      });
      const multipleReview = await createPrivateActivationReviewPlan({
        projectRoot: root,
        packageStoreRoot: store,
        lockMode: "update",
      });
      const multipleAdmission = await applyPrivateActivationReviewPlan({
        projectRoot: root,
        packageStoreRoot: store,
        planDigest: multipleReview.planDigest,
      });
      coordinator = await openPrivateProjectCoordinator({ projectRoot: root });
      await expect(allocatePrivateServiceMount({
        coordinator,
        projectRoot: root,
        packageStoreRoot: store,
        recipe: otherRecipe,
        effectiveDeadlineUnixMs: Date.now() + 20_000,
      })).rejects.toMatchObject({ code: "SERVICE_SCOPE_UNSUPPORTED" });
      await coordinator.dispose();
      coordinator = undefined;

      const secondPlanning = createPrivateActivationPlanningObservation({
        policyDigest: testDigest("service-mount-policy-2"),
        mechanismDigest: otherRecipe.mechanismDigest,
        entries: secondRequests.map((request) => request.target.kind === "binding" &&
          request.target.id === "other" ? {
            target: request.target,
            requestDigest: request.digest,
            disposition: { state: "planned" as const, observation: otherRecipe.observation },
          } : {
            target: request.target,
            requestDigest: request.digest,
            disposition: {
              state: "unavailable" as const,
              code: "RUNTIME_UNAVAILABLE" as const,
              evidenceDigests: [testDigest(`service-mount-unavailable:${request.digest}`)],
            },
          }),
      });
      const secondCandidate = createPrivateActivationCandidateV5(
        secondAggregate,
        resolveRetainedPackageProjectObservation(secondAggregate, secondPlanning),
        otherRecipe,
      );
      await publishPrivateActivationCandidate({
        projectRoot: root,
        packageStoreRoot: store,
        candidate: secondCandidate,
      });
      const secondReview = await createPrivateActivationReviewPlan({
        projectRoot: root,
        packageStoreRoot: store,
        lockMode: "update",
      });
      const secondAdmission = await applyPrivateActivationReviewPlan({
        projectRoot: root,
        packageStoreRoot: store,
        planDigest: secondReview.planDigest,
      });
      coordinator = await openPrivateProjectCoordinator({ projectRoot: root });
      await expect(allocatePrivateServiceMount({
        coordinator,
        projectRoot: root,
        packageStoreRoot: store,
        recipe: firstRecipe,
        effectiveDeadlineUnixMs: Date.now() + 20_000,
      })).rejects.toMatchObject({ code: "SERVICE_MOUNT_TARGET_MISMATCH" });
      const secondDeadline = Date.now() + 20_000;
      const secondAllocation = await allocatePrivateServiceMount({
        coordinator,
        projectRoot: root,
        packageStoreRoot: store,
        recipe: otherRecipe,
        effectiveDeadlineUnixMs: secondDeadline,
      });
      expect(secondAllocation.created).toBeTrue();
      const secondMount = secondAllocation.snapshot;
      expect(secondMount.allocation.admissionDigest).toBe(secondAdmission.admissionDigest);
      expect(secondMount.allocation.mountId).not.toBe(firstMount.allocation.mountId);
      expect((await listPrivateServiceMounts({
        coordinator,
        projectRoot: root,
        packageStoreRoot: store,
        epoch: "current",
      })).map(({ allocation }) => allocation.mountId)).toEqual([secondMount.allocation.mountId]);
      expect((await listPrivateServiceMounts({
        coordinator,
        projectRoot: root,
        packageStoreRoot: store,
        epoch: "older",
      })).map(({ allocation }) => allocation.mountId)).toEqual([firstMount.allocation.mountId]);
      await expect(recordPrivateServiceMountPlan({
        coordinator,
        projectRoot: root,
        packageStoreRoot: store,
        mountId: secondMount.allocation.mountId,
        recipe: otherRecipe,
        allocation: secondAllocation,
        packageAllocation,
        ownerAllocation,
      })).rejects.toMatchObject({ code: "ADMISSION_STATE_CORRUPT" });
      const secondHex = secondMount.allocation.mountId.slice("sha256:".length);
      const secondPackageAllocation = await allocatePrivatePackageMaterialization({
        protectedParent: materializations,
        name: `service-${secondHex}`,
        packageDigest: otherRecipe.request.package.digest,
        ownerToken: secondMount.allocationDigest,
      });
      const secondOwnerAllocation = await planPrivateLinuxOwnerStateAllocation({
        parent: owners,
        name: `s-${secondHex.slice(0, 62)}`,
      });
      const supersedingPlanning = createPrivateActivationPlanningObservation({
        policyDigest: testDigest("service-mount-policy-superseding"),
        mechanismDigest: otherRecipe.mechanismDigest,
        entries: secondRequests.map((request) => request.target.kind === "binding" &&
          request.target.id === "other" ? {
            target: request.target,
            requestDigest: request.digest,
            disposition: { state: "planned" as const, observation: otherRecipe.observation },
          } : {
            target: request.target,
            requestDigest: request.digest,
            disposition: {
              state: "unavailable" as const,
              code: "RUNTIME_UNAVAILABLE" as const,
              evidenceDigests: [testDigest(`service-mount-superseded:${request.digest}`)],
            },
          }),
      });
      const supersedingCandidate = createPrivateActivationCandidateV5(
        secondAggregate,
        resolveRetainedPackageProjectObservation(secondAggregate, supersedingPlanning),
        otherRecipe,
      );
      await publishPrivateActivationCandidate({
        projectRoot: root,
        packageStoreRoot: store,
        candidate: supersedingCandidate,
      });
      const supersedingReview = await createPrivateActivationReviewPlan({
        projectRoot: root,
        packageStoreRoot: store,
        lockMode: "update",
      });
      await applyPrivateActivationReviewPlan({
        projectRoot: root,
        packageStoreRoot: store,
        planDigest: supersedingReview.planDigest,
      });
      await expect(recordPrivateServiceMountPlan({
        coordinator,
        projectRoot: root,
        packageStoreRoot: store,
        mountId: secondMount.allocation.mountId,
        recipe: otherRecipe,
        allocation: secondAllocation,
        packageAllocation: secondPackageAllocation,
        ownerAllocation: secondOwnerAllocation,
      })).rejects.toMatchObject({ code: "SERVICE_MOUNT_SUPERSEDED" });
      const earlyTerminal = {
        status: "failed" as const,
        code: "CANCELLED" as const,
        message: "cancelled before resource allocation",
        diagnostics: { stderr: "", stderrBytes: 0, stderrTruncated: false },
      };
      const earlyProvisional = await recordPrivateServiceMountProvisional({
        coordinator,
        projectRoot: root,
        packageStoreRoot: store,
        mountId: secondMount.allocation.mountId,
        classification: "startup-cancelled",
        terminal: earlyTerminal,
      });
      await expect(recordPrivateServiceMountFence({
        coordinator,
        projectRoot: root,
        packageStoreRoot: store,
        mountId: secondMount.allocation.mountId,
        proof: {
          kind: "allocation-cancelled",
          cancellation: {
            kind: "private-linux-owner-state-cancellation/1",
            digest: testDigest("unreachable-cancellation"),
            allocationDigest: testDigest("unreachable-allocation"),
            directoryDevice: "1",
            directoryInode: "2",
            state: "cancelled",
          },
        },
      })).rejects.toMatchObject({ code: "SERVICE_MOUNT_FACT_ORDER" });
      const earlyRelease = await recordPrivateServiceMountRelease({
        coordinator,
        projectRoot: root,
        packageStoreRoot: store,
        mountId: secondMount.allocation.mountId,
        packageReleased: true,
        ownerRelease: null,
      });
      const earlyClosed = await closePrivateServiceMount({
        coordinator,
        projectRoot: root,
        packageStoreRoot: store,
        mountId: secondMount.allocation.mountId,
      });
      expect(earlyClosed).toMatchObject({
        provisional: { digest: earlyProvisional.provisional!.digest },
        release: { digest: earlyRelease.release!.digest },
        closure: { digest: expect.any(String) },
      });
      expect(earlyClosed.plan).toBeUndefined();
      expect(earlyClosed.fence).toBeUndefined();

      const thirdDeadline = Date.now() + 20_000;
      const thirdAllocation = await allocatePrivateServiceMount({
        coordinator,
        projectRoot: root,
        packageStoreRoot: store,
        recipe: otherRecipe,
        effectiveDeadlineUnixMs: thirdDeadline,
      });
      expect(thirdAllocation.created).toBeTrue();
      const thirdMount = thirdAllocation.snapshot;
      const thirdHex = thirdMount.allocation.mountId.slice("sha256:".length);
      const thirdPackageAllocation = await allocatePrivatePackageMaterialization({
        protectedParent: materializations,
        name: `service-${thirdHex}`,
        packageDigest: otherRecipe.request.package.digest,
        ownerToken: thirdMount.allocationDigest,
      });
      const thirdOwnerAllocation = await planPrivateLinuxOwnerStateAllocation({
        parent: owners,
        name: `s-${thirdHex.slice(0, 62)}`,
      });
      await recordPrivateServiceMountPlan({
        coordinator,
        projectRoot: root,
        packageStoreRoot: store,
        mountId: thirdMount.allocation.mountId,
        recipe: otherRecipe,
        allocation: thirdAllocation,
        packageAllocation: thirdPackageAllocation,
        ownerAllocation: thirdOwnerAllocation,
      });
      const thirdCaptured = await captureStoredPackage(store, otherRecipe.request.package);
      try {
        thirdPackageLease = await materializePrivatePackageLease(
          thirdCaptured,
          thirdPackageAllocation,
        );
      } finally {
        await thirdCaptured.dispose();
      }
      await recordPrivateServiceMountBacking({
        coordinator,
        projectRoot: root,
        packageStoreRoot: store,
        mountId: thirdMount.allocation.mountId,
        recipe: otherRecipe,
        allocation: thirdAllocation,
        lease: thirdPackageLease.identity,
      });
      const thirdSealed = await otherRecipe.backend.seal({
        runId: `service-${thirdHex.slice(0, 40)}`,
        limits: {
          ...otherRecipe.resourceCeilings,
          deadlineUnixMs: thirdDeadline,
          cancellationGraceMs: otherRecipe.cancellationGraceMs,
        },
        readOnlyMounts: [
          ...otherRecipe.runtimeSupport.closureSources.map((source) => ({ source, destination: source })),
          { source: thirdPackageLease.root, destination: otherRecipe.packageDestination },
        ],
        privateProcessFilesystem: true,
        privateRuntimeDevices: true,
        command: [
          otherRecipe.executablePath,
          ...otherRecipe.bunPolicy,
          `${otherRecipe.packageDestination}/${otherRecipe.request.entrypoint.path}`,
        ],
      }, thirdOwnerAllocation);
      const thirdSandbox = await recordPrivateServiceMountSandbox({
        coordinator,
        projectRoot: root,
        packageStoreRoot: store,
        mountId: thirdMount.allocation.mountId,
        recipe: otherRecipe,
        allocation: thirdAllocation,
        owner: thirdSealed.identity,
      });
      const thirdProvisional = await recordPrivateServiceMountProvisional({
        coordinator,
        projectRoot: root,
        mountId: thirdMount.allocation.mountId,
        classification: "startup-cancelled",
        terminal: earlyTerminal,
      });
      const thirdCancellation = await cancelPrivateLinuxOwnerStateAllocation(thirdOwnerAllocation);
      const thirdFence = await recordPrivateServiceMountFence({
        coordinator,
        projectRoot: root,
        mountId: thirdMount.allocation.mountId,
        proof: { kind: "allocation-cancelled", cancellation: thirdCancellation },
      });
      expect(thirdFence).toMatchObject({
        sandbox: { digest: thirdSandbox.sandbox!.digest },
        provisional: { digest: thirdProvisional.provisional!.digest },
        fence: { value: { proof: { kind: "allocation-cancelled" } } },
      });
      expect(thirdFence.prepared).toBeUndefined();
      await thirdPackageLease.dispose();
      thirdPackageLease = undefined;
      const thirdOwnerRelease = await releasePrivateLinuxOwnerState(
        thirdOwnerAllocation,
        thirdCancellation,
      );
      await recordPrivateServiceMountRelease({
        coordinator,
        projectRoot: root,
        mountId: thirdMount.allocation.mountId,
        packageReleased: true,
        ownerRelease: thirdOwnerRelease,
      });
      await closePrivateServiceMount({
        coordinator,
        projectRoot: root,
        mountId: thirdMount.allocation.mountId,
      });
      await coordinator.dispose();
      coordinator = undefined;

      const sqlite = createRequire(import.meta.url)("bun:sqlite") as any;
      const databasePath = join(root, ".jig", "private-activation-admission-v18.sqlite3");
      const writable = sqlite.constants.SQLITE_OPEN_READWRITE |
        sqlite.constants.SQLITE_OPEN_NOFOLLOW;
      let corruptor = sqlite.Database.open(databasePath, writable);
      const retainedAllocation = Uint8Array.from(corruptor.query(
        "SELECT allocation_bytes FROM service_mounts WHERE mount_id = ?1",
      ).get(secondMount.allocation.mountId).allocation_bytes);
      corruptor.query(
        "UPDATE service_mounts SET allocation_bytes = ?1 WHERE mount_id = ?2",
      ).run(new TextEncoder().encode("{}"), secondMount.allocation.mountId);
      corruptor.close(true);
      coordinator = await openPrivateProjectCoordinator({ projectRoot: root });
      await expect(loadPrivateServiceMount({
        coordinator,
        projectRoot: root,
        packageStoreRoot: store,
        mountId: secondMount.allocation.mountId,
      })).rejects.toMatchObject({ code: "ADMISSION_STATE_CORRUPT" });
      await coordinator.dispose();
      coordinator = undefined;

      corruptor = sqlite.Database.open(databasePath, writable);
      corruptor.query(
        "UPDATE service_mounts SET allocation_bytes = ?1 WHERE mount_id = ?2",
      ).run(retainedAllocation, secondMount.allocation.mountId);
      corruptor.close(true);
      coordinator = await openPrivateProjectCoordinator({ projectRoot: root });
      expect((await loadPrivateServiceMount({
        coordinator,
        projectRoot: root,
        packageStoreRoot: store,
        mountId: secondMount.allocation.mountId,
      })).allocation).toEqual(secondMount.allocation);
      await coordinator.dispose();
      coordinator = undefined;

      corruptor = sqlite.Database.open(databasePath, writable);
      const retainedPlan = Uint8Array.from(corruptor.query([
        "SELECT fact_bytes FROM service_mount_facts",
        "WHERE mount_id = ?1 AND fact_name = 'plan'",
      ].join(" ")).get(firstMount.allocation.mountId).fact_bytes);
      corruptor.query([
        "UPDATE service_mount_facts SET fact_bytes = ?1",
        "WHERE mount_id = ?2 AND fact_name = 'plan'",
      ].join(" ")).run(new TextEncoder().encode("{}"), firstMount.allocation.mountId);
      corruptor.close(true);
      coordinator = await openPrivateProjectCoordinator({ projectRoot: root });
      await expect(loadPrivateServiceMount({
        coordinator,
        projectRoot: root,
        packageStoreRoot: store,
        mountId: firstMount.allocation.mountId,
      })).rejects.toMatchObject({ code: "ADMISSION_STATE_CORRUPT" });
      await coordinator.dispose();
      coordinator = undefined;
      corruptor = sqlite.Database.open(databasePath, writable);
      corruptor.query([
        "UPDATE service_mount_facts SET fact_bytes = ?1",
        "WHERE mount_id = ?2 AND fact_name = 'plan'",
      ].join(" ")).run(retainedPlan, firstMount.allocation.mountId);
      corruptor.close(true);
      coordinator = await openPrivateProjectCoordinator({ projectRoot: root });
      expect((await loadPrivateServiceMount({
        coordinator,
        projectRoot: root,
        packageStoreRoot: store,
        mountId: firstMount.allocation.mountId,
      })).closure?.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    } finally {
      await firstPackageLease?.dispose();
      await thirdPackageLease?.dispose();
      await coordinator?.dispose();
      await rm(root, { recursive: true, force: true });
      await rm(store, { recursive: true, force: true });
    }
  }, 120_000);

  test("starts, acknowledges, and cleanly closes one admitted Bun Service Mount", async () => {
    host = await hostConfiguration();
    const bun = await proofHostBunClosure();
    const distribution = await realpath(join(import.meta.dir, "..", "dist"));
    const sdkSource = await realpath(join(import.meta.dir, "..", "..", "flow-sdk", "src"));
    const root = await mkdtemp(join(tmpdir(), "jig-service-controller-"));
    const store = await mkdtemp(join(tmpdir(), "jig-service-controller-store-"));
    let coordinator: Awaited<ReturnType<typeof openPrivateProjectCoordinator>> | undefined;
    let mounted: Awaited<ReturnType<typeof startPrivateBunServiceMount>> | undefined;
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
      await mkdir(join(root, "flows", "counter", "contracts"), { recursive: true });
      await mkdir(join(root, "flows", "counter", "sdk"));
      await writeFile(join(root, "jig.ts"), [
        'import { defineJig, discover } from "@jigging/jig";',
        'export default defineJig({ flows: discover("flows"), bindings: discover("bindings") });',
        "",
      ].join("\n"));
      await writeFile(join(root, "bindings", "counter.ts"), [
        'import { defineBinding } from "@jigging/jig";',
        'export default defineBinding({ package: "flows/counter" });',
        "",
      ].join("\n"));
      await writeFile(join(root, "flows", "counter", "FLOW.md"), [
        "---",
        "name: counter",
        "description: Exact controller-owned Service fixture.",
        "service: 1",
        "provides:",
        "  counter: ./contracts/counter.capability.json",
        "---",
        "",
      ].join("\n"));
      await writeFile(join(root, "flows", "counter", "contracts", "counter.capability.json"),
        JSON.stringify({
          $schema: "https://flow.dev/schemas/capability-contract-1.schema.json",
          flowCapabilityContract: 1,
          id: "https://example.test/capabilities/controller-counter",
          version: "1.0.0",
          methods: {
            next: {
              input: { type: "object", additionalProperties: false },
              output: { type: "integer" },
              errors: {},
            },
          },
        }));
      for (const file of [
        "index.ts", "json.ts", "protocol.ts", "service-session.ts", "service.ts", "session.ts", "transport.ts", "types.ts",
      ]) {
        await writeFile(
          join(root, "flows", "counter", "sdk", file),
          await readFile(join(sdkSource, file)),
        );
      }
      await writeFile(join(root, "flows", "counter", "flow.ts"), [
        "#!/usr/bin/env bun",
        'import { serveService } from "./sdk/service.ts";',
        "await serveService({",
        "  exports: { counter: async () => 0 },",
        "  async mount(context) {",
        "    await context.ready();",
        "    await context.cancelled;",
        "  },",
        "});",
        "",
      ].join("\n"));

      const aggregate = await retainPackageProject({ projectRoot: root, storeRoot: store, evaluator });
      const [request] = buildPrivateActivationRequests(aggregate.linked);
      if (request === undefined) throw new Error("missing Service activation request");
      const observation = await observePrivateBunServicePackage({
        request,
        packageStoreRoot: store,
      });
      const recipe = await planPrivateBunService({
        request,
        packageObservation: observation,
        runtimeSupport: bun.runtimeSupport,
        backend: evaluator.backend,
      });
      const planning = createPrivateActivationPlanningObservation({
        policyDigest: testDigest("service-controller-policy"),
        mechanismDigest: recipe.mechanismDigest,
        entries: [{
          target: request.target,
          requestDigest: request.digest,
          disposition: { state: "planned", observation: recipe.observation },
        }],
      });
      const candidate = createPrivateActivationCandidateV5(
        aggregate,
        resolveRetainedPackageProjectObservation(aggregate, planning),
        recipe,
      );
      await publishPrivateActivationCandidate({
        projectRoot: root,
        packageStoreRoot: store,
        candidate,
      });
      const review = await createPrivateActivationReviewPlan({
        projectRoot: root,
        packageStoreRoot: store,
        lockMode: "update",
      });
      await applyPrivateActivationReviewPlan({
        projectRoot: root,
        packageStoreRoot: store,
        planDigest: review.planDigest,
      });

      coordinator = await openPrivateProjectCoordinator({ projectRoot: root });
      const mountDeadline = Date.now() + 20_000;
      mounted = await startPrivateBunServiceMount({
        coordinator,
        projectRoot: root,
        packageStoreRoot: store,
        recipe,
        effectiveDeadlineUnixMs: mountDeadline,
      });
      expect(mounted.bindingId).toBe("counter");
      expect(mounted.generationId).toMatch(/^sha256:[0-9a-f]{64}$/);
      let dispatchAdmitted = false;
      expect(await mounted.invokeDetailed({
        exportName: "counter",
        method: "next",
        input: {},
        deadlineUnixMs: mountDeadline,
      }, {
        async beforeDispatch(): Promise<void> { dispatchAdmitted = true; },
      })).toEqual({
        source: "provider-response",
        terminal: { status: "succeeded", value: 0 },
      });
      expect(dispatchAdmitted).toBeTrue();
      await expect(startPrivateBunServiceMount({
        coordinator,
        projectRoot: root,
        packageStoreRoot: store,
        recipe,
        effectiveDeadlineUnixMs: mountDeadline,
      })).rejects.toThrow("Service Mount startup attempt was already allocated");
      const liveMount = await loadPrivateServiceMount({
        coordinator,
        projectRoot: root,
        packageStoreRoot: store,
        mountId: mounted.mountId,
      });
      expect(liveMount.acknowledged?.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(liveMount.provisional).toBeUndefined();
      expect(liveMount.fence).toBeUndefined();
      expect(liveMount.release).toBeUndefined();
      expect(liveMount.closure).toBeUndefined();
      const fenced = await mounted.fence();
      expect(fenced).toMatchObject({
        provisional: {
          value: { classification: "host-lifetime", terminal: { status: "succeeded" } },
        },
        fence: {
          value: {
            proof: {
              kind: "enforcement-confirmed",
              receipt: { fenced: true },
            },
          },
        },
      });
      expect(fenced.release).toBeUndefined();
      expect(fenced.closure).toBeUndefined();
      expect(await jigCgroups(host.scope)).toEqual([]);
      expect(await listOrEmpty(join(root, ".jig", "private-root-materializations"))).toHaveLength(1);
      expect(await listOrEmpty(join(root, ".jig", "private-root-linux-owners"))).toHaveLength(1);
      expect(await mounted.fence()).toEqual(fenced);
      const closed = await mounted.stop();
      expect(closed).toMatchObject({
        generation: {
          value: { generationId: mounted.generationId, exports: ["counter"] },
        },
        acknowledged: { digest: expect.any(String) },
        provisional: {
          value: { classification: "host-lifetime", terminal: { status: "succeeded" } },
        },
        fence: {
          value: {
            proof: {
              kind: "enforcement-confirmed",
              receipt: { fenced: true },
            },
          },
        },
        release: { value: { packageReleased: true, leaseReleases: [] } },
        closure: { digest: expect.any(String) },
      });
      expect(closed.fence!.value.proof.kind).toBe("enforcement-confirmed");
      if (closed.fence!.value.proof.kind !== "enforcement-confirmed") {
        throw new Error("expected helper enforcement evidence");
      }
      expect(closed.fence!.value.proof.receipt.ownerDigest).toBe(
        closed.prepared!.value.prepared.digest,
      );
      expect(closed.fence!.value.proof.receipt.stopReason).toBe("payload_exit");
      expect(await mounted.stop()).toEqual(closed);
      expect(await recoverPrivateServiceMountFences({
        coordinator,
        projectRoot: root,
        backend: evaluator.backend,
      })).toEqual([]);
      expect(await finalizeRecoveredPrivateServiceMounts({
        coordinator,
        projectRoot: root,
      })).toEqual([]);
      expect(await jigCgroups(host.scope)).toEqual([]);
      expect(await listOrEmpty(join(root, ".jig", "private-root-materializations"))).toEqual([]);
      expect(await listOrEmpty(join(root, ".jig", "private-root-linux-owners"))).toEqual([]);
      expect((await readdir("/dev")).filter((name) =>
        name.startsWith(".jig-jig-run-") && name.endsWith("-devices")
      )).toEqual([]);
    } finally {
      await mounted?.stop().catch(() => undefined);
      await coordinator?.dispose();
      await rm(root, { recursive: true, force: true });
      await rm(store, { recursive: true, force: true });
    }
  }, 120_000);

  test("publishes one complete retained package project from a shared root owner", async () => {
    host = await hostConfiguration();
    const bun = await proofHostBunClosure();
    const distribution = await realpath(join(import.meta.dir, "..", "dist"));
    const root = await mkdtemp(join(tmpdir(), "jig-retained-project-"));
    const foreignRoot = await mkdtemp(join(tmpdir(), "jig-retained-foreign-project-"));
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

      const initialPlanningBase = await capturePrivateActivationPlanningBase({ projectRoot: root });
      const foreignPlanningBase = await capturePrivateActivationPlanningBase({
        projectRoot: foreignRoot,
      });
      const admissionDatabase = join(root, ".jig", "private-activation-admission-v18.sqlite3");
      const sqlite = createRequire(import.meta.url)("bun:sqlite") as any;

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
      const [serviceRequest] = requests;
      const servicePackageObservation = await observePrivateBunServicePackage({
        request: serviceRequest!,
        packageStoreRoot: store,
      });
      const serviceRecipe = await planPrivateBunService({
        request: serviceRequest!,
        packageObservation: servicePackageObservation,
        runtimeSupport: bun.runtimeSupport,
        backend: evaluator.backend,
      });
      const servicePlanning = createPrivateActivationPlanningObservation({
        policyDigest: testDigest("retained-service-policy"),
        mechanismDigest: serviceRecipe.mechanismDigest,
        entries: [{
          target: serviceRequest!.target,
          requestDigest: serviceRequest!.digest,
          disposition: { state: "planned" as const, observation: serviceRecipe.observation },
        }],
      });
      const serviceResolution = resolveRetainedPackageProjectObservation(
        aggregate,
        servicePlanning,
      );
      expect(createPrivateActivationCandidateV5(
        aggregate,
        serviceResolution,
        serviceRecipe,
      ).candidate.targets[0]!.disposition).toEqual({
        state: "ready",
        recipeDigest: serviceRecipe.digest,
        observationDigest: serviceRecipe.observation.digest,
      });
      expect(createPrivateActivationCandidateV5(
        aggregate,
        serviceResolution,
        [serviceRecipe],
      ).candidate.targets[0]!.disposition.state).toBe("ready");
      let forgedKindRead = false;
      const forgedServiceRecipe = Object.defineProperty({}, "kind", {
        get() {
          forgedKindRead = true;
          return "private-bun-service-recipe/1";
        },
      });
      expect(() => createPrivateActivationCandidateV5(
        aggregate,
        serviceResolution,
        forgedServiceRecipe as never,
      )).toThrow("activation recipe was not produced by a private planner");
      expect(forgedKindRead).toBe(false);
      let recipeArrayTrapRead = false;
      const proxiedRecipeArray = new Proxy([serviceRecipe], {
        get() {
          recipeArrayTrapRead = true;
          throw new Error("recipe array get trap must not run");
        },
        getOwnPropertyDescriptor() {
          recipeArrayTrapRead = true;
          throw new Error("recipe array descriptor trap must not run");
        },
        getPrototypeOf() {
          recipeArrayTrapRead = true;
          throw new Error("recipe array prototype trap must not run");
        },
        ownKeys() {
          recipeArrayTrapRead = true;
          throw new Error("recipe array ownKeys trap must not run");
        },
      });
      expect(() => createPrivateActivationCandidateV5(
        aggregate,
        serviceResolution,
        proxiedRecipeArray,
      )).toThrow("activation recipes must not be a Proxy");
      expect(recipeArrayTrapRead).toBe(false);
      let recipeArrayAccessorRead = false;
      const accessorRecipeArray: PrivateBunServiceRecipe[] = [];
      Object.defineProperty(accessorRecipeArray, "0", {
        configurable: true,
        enumerable: true,
        get() {
          recipeArrayAccessorRead = true;
          return serviceRecipe;
        },
      });
      expect(() => createPrivateActivationCandidateV5(
        aggregate,
        serviceResolution,
        accessorRecipeArray,
      )).toThrow("activation recipes must contain enumerable data properties");
      expect(recipeArrayAccessorRead).toBe(false);
      expect(() => createPrivateActivationCandidateV5(
        aggregate,
        serviceResolution,
        new Array<PrivateBunServiceRecipe>(1),
      )).toThrow("activation recipes must be a dense array");
      const wrongPrototypeRecipeArray = [serviceRecipe];
      Object.setPrototypeOf(wrongPrototypeRecipeArray, null);
      expect(() => createPrivateActivationCandidateV5(
        aggregate,
        serviceResolution,
        wrongPrototypeRecipeArray,
      )).toThrow("activation recipes must be a bounded ordinary array");
      expect(() => createPrivateActivationCandidateV5(
        aggregate,
        serviceResolution,
        [serviceRecipe, serviceRecipe],
      )).toThrow("activation recipes must be a bounded ordinary array");
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
      expect(() => createPrivateActivationCandidateV5(
        aggregate,
        resolution,
        serviceRecipe,
      )).toThrow("recipe for an unplanned target");
      const unavailable = createPrivateActivationCandidateV5(aggregate, resolution);
      expect(requirePrivateCreatedActivationCandidateV5(unavailable)).toBe(unavailable);
      expect(privateActivationCandidateDigestV5(unavailable)).toMatch(/^sha256:[0-9a-f]{64}$/);
      const persisted = encodePrivateActivationCandidateV5(unavailable);
      const restarted = decodePrivateActivationCandidateV5(persisted);
      expect(encodePrivateActivationCandidateV5(restarted)).toEqual(persisted);
      expect(() => requirePrivateCreatedActivationCandidateV5(restarted)).toThrow(
        "was not built from a retained project",
      );

      await expect(publishPrivateActivationReviewPlan({
        projectRoot: root,
        packageStoreRoot: store,
        planningBase: {} as never,
        candidate: unavailable,
        lockMode: "update",
      })).rejects.toThrow("activation planning base was not captured by protected storage");
      await expect(publishPrivateActivationReviewPlan({
        projectRoot: root,
        packageStoreRoot: store,
        planningBase: foreignPlanningBase,
        candidate: unavailable,
        lockMode: "update",
      })).rejects.toMatchObject({ code: "PROJECT_BUSY" });
      await expect(publishPrivateActivationReviewPlan({
        projectRoot: root,
        packageStoreRoot: store,
        planningBase: initialPlanningBase,
        candidate: unavailable,
        lockMode: "locked",
      })).rejects.toMatchObject({ code: "LOCK_MISMATCH" });
      await expect(publishPrivateActivationReviewPlan({
        projectRoot: root,
        packageStoreRoot: store,
        planningBase: initialPlanningBase,
        candidate: unavailable,
        lockMode: "update",
        beforePersistApplicable(): void {
          throw new Error("display gate rejected the complete review");
        },
      })).rejects.toThrow("display gate rejected the complete review");
      let atomicState = sqlite.Database.open(
        admissionDatabase,
        sqlite.constants.SQLITE_OPEN_READONLY | sqlite.constants.SQLITE_OPEN_NOFOLLOW,
      );
      expect(atomicState.query(
        "SELECT revision FROM candidate_head WHERE singleton = 1",
      ).get().revision).toBeNull();
      expect(atomicState.query("SELECT count(*) AS count FROM candidates").get().count).toBe(0);
      expect(atomicState.query("SELECT count(*) AS count FROM review_plans").get().count).toBe(0);
      atomicState.close(true);

      const firstPlanResult = await publishPrivateActivationReviewPlan({
        projectRoot: root,
        packageStoreRoot: store,
        planningBase: initialPlanningBase,
        candidate: unavailable,
        lockMode: "update",
      });
      if (firstPlanResult.state !== "applicable") {
        throw new Error("hostile fixture expected one atomically published Plan");
      }
      const firstPlan = firstPlanResult;
      const firstHead = {
        candidateRevision: firstPlan.plan.candidateRevision,
        candidateDigest: firstPlan.plan.candidateDigest,
      };
      expect(firstHead).toEqual({
        candidateRevision: 1,
        candidateDigest: privateActivationCandidateDigestV5(unavailable),
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
      expect(firstPlan.plan).toMatchObject({
        candidateRevision: 1,
        candidateDigest: firstHead.candidateDigest,
        baseGeneration: null,
        lockMode: "update",
        observedLock: { state: "absent" },
      });
      expect(requirePrivateStoredActivationCandidate(firstPlan.candidate)).toBe(firstPlan.candidate);
      expect(() => requirePrivateCreatedActivationCandidateV5(firstPlan.candidate)).toThrow(
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
      await writeFile(join(root, "jig.lock"), persisted.lock, { mode: 0o644 });
      const recovered = sqlite.Database.open(
        admissionDatabase,
        sqlite.constants.SQLITE_OPEN_READONLY | sqlite.constants.SQLITE_OPEN_NOFOLLOW,
      );
      expect(recovered.query("SELECT count(*) AS count FROM admissions").get().count).toBe(0);
      expect(recovered.query("SELECT revision FROM admission_head WHERE singleton = 1").get().revision)
        .toBeNull();
      recovered.close(true);
      const admissionRaceBase = await capturePrivateActivationPlanningBase({ projectRoot: root });
      const firstAdmission = await applyPrivateActivationReviewPlan({
        projectRoot: root,
        packageStoreRoot: store,
        planDigest: firstPlan.planDigest,
      });
      expect(await applyPrivateActivationReviewPlan({
        projectRoot: root,
        packageStoreRoot: store,
        planDigest: firstPlan.planDigest,
      })).toEqual(firstAdmission);
      expect(new Uint8Array(await readFile(join(root, "jig.lock")))).toEqual(persisted.lock);
      const lockedPlan = await createPrivateActivationReviewPlan({
        projectRoot: root,
        packageStoreRoot: store,
        lockMode: "locked",
      });
      expect(lockedPlan).toEqual({ state: "unchanged" });
      await rm(join(root, "jig.lock"));
      const staleRepairPlan = await createPrivateActivationReviewPlan({
        projectRoot: root,
        packageStoreRoot: store,
        lockMode: "update",
      });
      if (staleRepairPlan.state !== "applicable" || staleRepairPlan.plan.operation !== "lock-repair") {
        throw new Error("hostile fixture expected one retained lock-repair Plan");
      }

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
      const second = createPrivateActivationCandidateV5(
        aggregate,
        resolveRetainedPackageProjectObservation(aggregate, secondPlanning),
      );
      await expect(publishPrivateActivationReviewPlan({
        projectRoot: root,
        packageStoreRoot: store,
        planningBase: admissionRaceBase,
        candidate: second,
        lockMode: "update",
      })).rejects.toMatchObject({ code: "PROJECT_BUSY" });
      atomicState = sqlite.Database.open(
        admissionDatabase,
        sqlite.constants.SQLITE_OPEN_READONLY | sqlite.constants.SQLITE_OPEN_NOFOLLOW,
      );
      expect(atomicState.query(
        "SELECT revision FROM candidate_head WHERE singleton = 1",
      ).get().revision).toBe(1);
      expect(atomicState.query("SELECT count(*) AS count FROM candidates").get().count).toBe(1);
      atomicState.close(true);

      const candidateRaceBase = await capturePrivateActivationPlanningBase({ projectRoot: root });
      const secondHead = await publishPrivateActivationCandidate({
        projectRoot: root,
        packageStoreRoot: store,
        candidate: second,
      });
      expect(secondHead.candidateRevision).toBe(2);
      expect(secondHead.candidateDigest).not.toBe(firstHead.candidateDigest);
      await expect(publishPrivateActivationReviewPlan({
        projectRoot: root,
        packageStoreRoot: store,
        planningBase: candidateRaceBase,
        candidate: unavailable,
        lockMode: "update",
      })).rejects.toMatchObject({ code: "PROJECT_BUSY" });
      atomicState = sqlite.Database.open(
        admissionDatabase,
        sqlite.constants.SQLITE_OPEN_READONLY | sqlite.constants.SQLITE_OPEN_NOFOLLOW,
      );
      expect(atomicState.query(
        "SELECT revision FROM candidate_head WHERE singleton = 1",
      ).get().revision).toBe(2);
      expect(atomicState.query("SELECT count(*) AS count FROM candidates").get().count).toBe(2);
      atomicState.close(true);
      const changedPlan = await createPrivateActivationReviewPlan({
        projectRoot: root,
        packageStoreRoot: store,
        lockMode: "update",
      });
      if (changedPlan.state !== "applicable" || changedPlan.plan.operation !== "admission") {
        throw new Error("hostile fixture expected the changed candidate to require admission");
      }
      const changedAdmission = await applyPrivateActivationReviewPlan({
        projectRoot: root,
        packageStoreRoot: store,
        planDigest: changedPlan.planDigest,
      });
      if (!("admission" in changedAdmission)) {
        throw new Error("hostile fixture expected an admission receipt");
      }
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
          "hook_admission_boundaries",
          "hook_derivations",
          "hook_revisions",
          "journal_events",
          "journal_head",
          "lock_repairs",
          "review_plans",
          "root_execution_closures",
          "root_execution_lifecycles",
          "root_flow_call_closures",
          "root_flow_call_facts",
          "root_flow_calls",
          "root_journal_appends",
          "root_journal_closures",
          "root_journal_hook_selections",
          "root_journal_terminals",
          "root_runs",
          "root_spawn_intents",
          "root_terminals",
          "service_invocations",
          "service_leases",
          "service_mount_facts",
          "service_mounts",
        ]);
        expect(database.query("PRAGMA application_id").get().application_id).toBe(0x4a494741);
        expect(database.query("PRAGMA user_version").get().user_version).toBe(18);
        expect(database.query("PRAGMA journal_mode").get().journal_mode).toBe("delete");
        expect(database.query("SELECT revision FROM candidate_head WHERE singleton = 1").get().revision).toBe(3);
        expect(database.query("SELECT count(*) AS count FROM candidates").get().count).toBe(3);
        expect(database.query("SELECT count(*) AS count FROM review_plans").get().count).toBe(4);
        expect(database.query("SELECT count(*) AS count FROM admissions").get().count).toBe(2);
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
      });
      expect(secondAdmission.admission.baseGeneration).toBe(changedAdmission.admissionDigest);
      expect(await applyPrivateActivationReviewPlan({
        projectRoot: root,
        packageStoreRoot: store,
        planDigest: firstPlan.planDigest,
      })).toEqual(firstAdmission);
      await expect(applyPrivateActivationReviewPlan({
        projectRoot: root,
        packageStoreRoot: store,
        planDigest: staleRepairPlan.planDigest,
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
      expect(() => createPrivateActivationCandidateV5(
        readyAggregate,
        readyResolution,
        serviceRecipe,
      )).toThrow("ready recipe does not match the retained planned target");
      expect(() => createPrivateActivationCandidateV5(
        aggregate,
        serviceResolution,
        readyRecipe,
      )).toThrow("ready recipe does not match the retained planned target");
      const readyCandidate = createPrivateActivationCandidateV5(
        readyAggregate,
        readyResolution,
        readyRecipe,
      );
      expect(readyCandidate.candidate.targets[0]!.disposition).toEqual({
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
      expect(readyPlan.candidate.candidate.targets[0]!.disposition.state).toBe("ready");
      const readyAdmission = await applyPrivateActivationReviewPlan({
        projectRoot: root,
        packageStoreRoot: store,
        planDigest: readyPlan.planDigest,
      });
      expect(readyAdmission.admission.baseGeneration).toBe(secondAdmission.admissionDigest);

      const restartedActivation = await loadPrivateActiveActivation({
        projectRoot: root,
        packageStoreRoot: store,
      });
      expect(restartedActivation.admission).toEqual(readyAdmission);
      const admittedRequest = restartedActivation.candidate.candidate.targets[0]!.request;
      expect(admittedRequest.digest).toBe(readyRequest!.digest);
      const reacquiredBun = await proofHostBunClosure();
      const rootBackend = backend(host);
      rootController = await openPrivateRootAdministrationController({
        projectRoot: root,
        packageStoreRoot: store,
        runTimeoutMs: 20_000,
        execute: (runId, coordinator, signal, notifyWorkAvailable) => executePrivateRootRunLaunch({
          projectRoot: root,
          packageStoreRoot: store,
          runId,
          coordinator,
          runtimeSupport: reacquiredBun.runtimeSupport,
          backend: rootBackend,
          notifyWorkAvailable,
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
        execute: (runId, coordinator, signal, notifyWorkAvailable) => executePrivateRootRunLaunch({
          projectRoot: root,
          packageStoreRoot: store,
          runId,
          coordinator,
          runtimeSupport: reacquiredBun.runtimeSupport,
          backend: rootBackend,
          notifyWorkAvailable,
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
      await rm(foreignRoot, { recursive: true, force: true });
      await rm(store, { recursive: true, force: true });
    }
  });

  test("runs canonical Journal effects from one Bun root into one Python Hook Run", async () => {
    host = await hostConfiguration();
    const [bun, python] = await Promise.all([
      proofHostBunClosure(),
      proofHostPythonClosure(),
    ]);
    const distribution = await realpath(join(import.meta.dir, "..", "dist"));
    const root = await mkdtemp(join(tmpdir(), "jig-journal-project-"));
    const store = await mkdtemp(join(tmpdir(), "jig-journal-store-"));
    const rootBackend = backend(host);
    const evaluator = {
      backend: rootBackend,
      bunPath: bun.executable,
      runtimeMounts: bun.runtimeSupport.closureSources.map((source) => ({ source, destination: source })),
      runtimeSupport: bun.runtimeSupport,
      jigDistributionPath: distribution,
    } as const;
    let controller: Awaited<ReturnType<typeof openPrivateRootAdministrationController>> | undefined;
    let crashed: ReturnType<typeof spawn> | undefined;
    try {
      await mkdir(join(root, "bindings"));
      await mkdir(join(root, "hooks"));
      await mkdir(join(root, "flows", "journal-run"), { recursive: true });
      await mkdir(join(root, "flows", "journal-consumer"), { recursive: true });
      await writeFile(join(root, "jig.ts"), [
        'import { defineJig, discover } from "@jigging/jig/experimental/hooks";',
        'export default defineJig({',
        '  flows: discover("flows"),',
        '  bindings: discover("bindings"),',
        '  hooks: discover("hooks"),',
        '});',
        "",
      ].join("\n"));
      await writeFile(join(root, "bindings", "publisher.ts"), [
        'import { defineJournalPublisher } from "@jigging/jig";',
        "export default defineJournalPublisher({",
        "  eventTypes: [",
        '    "https://example.test/events/first",',
        '    "https://example.test/events/second",',
        "  ],",
        "});",
        "",
      ].join("\n"));
      await writeFile(join(root, "bindings", "journal-run.ts"), [
        'import { bindingRef, defineBinding } from "@jigging/jig";',
        "export default defineBinding({",
        '  package: "flows/journal-run",',
        '  slots: { journal: bindingRef("publisher") },',
        "});",
        "",
      ].join("\n"));
      await writeFile(join(root, "hooks", "on-first.ts"), [
        'import { bindingRef, defineHook, flowRef } from "@jigging/jig/experimental/hooks";',
        "export default defineHook({",
        '  on: { publisher: bindingRef("publisher"), type: "https://example.test/events/first" },',
        '  run: flowRef("flows/journal-consumer"),',
        "});",
        "",
      ].join("\n"));

      const flow = join(root, "flows", "journal-run");
      await mkdir(join(flow, "contracts"));
      await writeFile(join(flow, "FLOW.md"), [
        "---",
        "name: journal-run",
        "description: Publishes two exact Events through the canonical Journal.",
        "uses:",
        "  journal:",
        "    contract: ./contracts/journal.capability.json",
        "---",
        "",
      ].join("\n"));
      await writeFile(
        join(flow, "contracts", "journal.capability.json"),
        await readFile(new URL("../../../docs/spec/contracts/jig/journal.capability.json", import.meta.url)),
      );
      const sdk = join(flow, "flow-sdk");
      await mkdir(sdk);
      for (const name of [
        "index.ts", "json.ts", "protocol.ts", "service-session.ts", "session.ts", "transport.ts", "types.ts",
      ]) {
        await writeFile(join(sdk, name), await readFile(join(import.meta.dir, "..", "..", "flow-sdk", "src", name)));
      }
      await writeFile(join(flow, "flow.ts"), [
        "#!/usr/bin/env bun",
        'import { OperationError, serve } from "./flow-sdk/index.ts";',
        "",
        "const observed = async (operation) => {",
        "  try { return { result: await operation }; }",
        '  catch (error) { return { error: error instanceof OperationError ? error.code : "unexpected" }; }',
        "};",
        "",
        "await serve(async (context) => {",
        '  const request = context.input && typeof context.input === "object" ? context.input : {};',
        '  const hookDelayMs = typeof request.hookDelayMs === "number" ? request.hookDelayMs : 0;',
        "  const firstData = hookDelayMs > 0 ? { value: 1, hookDelayMs } : { value: 1 };",
        "  const firstCall = {",
        '    operationId: "publish-first", slot: "journal", method: "append",',
        '    input: { type: "https://example.test/events/first", data: firstData },',
        "  };",
        "  const first = await context.callEffect(firstCall);",
        "  const replay = await context.callEffect(firstCall);",
        "  const conflict = await observed(context.callEffect({",
        "    ...firstCall,",
        '    input: { type: "https://example.test/events/first", data: { value: 2 } },',
        "  }));",
        "  const second = await context.callEffect({",
        '    operationId: "publish-second", slot: "journal", method: "append",',
        '    input: { type: "https://example.test/events/second", data: { value: 2 } },',
        "  });",
        "  const denied = await observed(context.callEffect({",
        '    operationId: "publish-denied", slot: "journal", method: "append",',
        '    input: { type: "https://jig.dev/events/run-completed", data: null },',
        "  }));",
        "  const forgedSource = await observed(context.callEffect({",
        '    operationId: "publish-forged-source", slot: "journal", method: "append",',
        '    input: { type: "https://example.test/events/first", data: null, source: "kernel:jig" },',
        "  }));",
        '  if (context.input && typeof context.input === "object" && "delayMs" in context.input) {',
        "    await Bun.sleep(context.input.delayMs);",
        "  }",
        '  return { outcome: "done", output: { first, replay, conflict, second, denied, forgedSource } };',
        "});",
        "",
      ].join("\n"));

      const consumer = join(root, "flows", "journal-consumer");
      await writeFile(join(consumer, "FLOW.md"), [
        "---",
        "name: journal-consumer",
        "description: Returns the exact immutable Event from one contained Python Run.",
        "---",
        "",
      ].join("\n"));
      const eventSchema = {
        type: "object",
        properties: {
          eventId: { type: "string" },
          journalPosition: { type: "integer" },
          type: { const: "https://example.test/events/first" },
          source: { const: "binding:publisher" },
          committedAtUnixMs: { type: "integer" },
          data: {},
          runId: { type: "string" },
        },
        required: [
          "eventId", "journalPosition", "type", "source", "committedAtUnixMs", "data", "runId",
        ],
        additionalProperties: false,
      } as const;
      await writeFile(join(consumer, "input.schema.json"), JSON.stringify({
        $schema: "https://flow.dev/schemas/schema-1.json",
        ...eventSchema,
      }));
      await writeFile(join(consumer, "result.schema.json"), JSON.stringify({
        $schema: "https://flow.dev/schemas/schema-1.json",
        type: "object",
        properties: {
          outcome: { const: "done" },
          output: {
            type: "object",
            properties: { event: eventSchema },
            required: ["event"],
            additionalProperties: false,
          },
        },
        required: ["outcome", "output"],
        additionalProperties: false,
      }));
      const pythonSdk = join(consumer, "flowmd_sdk");
      await mkdir(pythonSdk);
      for (const name of ["__init__.py", "_json.py", "_runtime.py", "_service.py", "_types.py"]) {
        await writeFile(
          join(pythonSdk, name),
          await readFile(join(import.meta.dir, "..", "..", "flowmd-sdk", "src", "flowmd_sdk", name)),
        );
      }
      await writeFile(join(consumer, "flow.py"), [
        "#!/usr/bin/env python",
        "import asyncio",
        "from flowmd_sdk import serve",
        "",
        "async def run(context):",
        '    data = context.input.get("data") if isinstance(context.input, dict) else None',
        '    delay_ms = data.get("hookDelayMs") if isinstance(data, dict) else None',
        "    if isinstance(delay_ms, (int, float)) and delay_ms > 0:",
        "        await asyncio.sleep(delay_ms / 1000)",
        '    return {"outcome": "done", "output": {"event": context.input}}',
        "",
        "serve(run)",
        "",
      ].join("\n"));

      const aggregate = await retainPackageProject({ projectRoot: root, storeRoot: store, evaluator });
      expect(aggregate.linked.bindings).toHaveLength(1);
      expect(aggregate.linked.journalPublishers).toHaveLength(1);
      expect(aggregate.linked.hooks).toHaveLength(1);
      const requests = buildPrivateActivationRequests(aggregate.linked);
      const request = requests.find(({ target }) =>
        target.kind === "binding" && target.id === "journal-run"
      );
      expect(request?.target).toEqual({ kind: "binding", id: "journal-run" });
      const runtimeSupport = Object.freeze({ bun: bun.runtimeSupport, python: python.runtimeSupport });
      const recipes = await Promise.all(requests.map(async (candidate) => await planPrivateDirectRun({
        request: candidate,
        runtimeSupport,
        backend: rootBackend,
      })));
      const planning = createPrivateActivationPlanningObservation({
        policyDigest: testDigest("journal-policy"),
        mechanismDigest: recipes[0]!.mechanismDigest,
        entries: requests.map((candidate, index) => ({
          target: candidate.target,
          requestDigest: candidate.digest,
          disposition: { state: "planned" as const, observation: recipes[index]!.observation },
        })),
      });
      expect(recipes.length).toBeGreaterThanOrEqual(2);
      expect(() => createPrivateActivationCandidateV5(
        aggregate,
        resolveRetainedPackageProjectObservation(aggregate, planning),
        [recipes[0]!, recipes[0]!],
      )).toThrow("duplicate recipes for one request");
      const candidate = createPrivateActivationCandidateV5(
        aggregate,
        resolveRetainedPackageProjectObservation(aggregate, planning),
        recipes,
      );
      await publishPrivateActivationCandidate({ projectRoot: root, packageStoreRoot: store, candidate });
      const review = await createPrivateActivationReviewPlan({
        projectRoot: root,
        packageStoreRoot: store,
        lockMode: "update",
      });
      await applyPrivateActivationReviewPlan({
        projectRoot: root,
        packageStoreRoot: store,
        planDigest: review.planDigest,
      });
      const openController = async () => await openPrivateRootAdministrationController({
        projectRoot: root,
        packageStoreRoot: store,
        runTimeoutMs: 45_000,
        execute: (runId, coordinator, signal, notifyWorkAvailable) => executePrivateRootRunLaunch({
          projectRoot: root,
          packageStoreRoot: store,
          runId,
          coordinator,
          runtimeSupport,
          backend: rootBackend,
          notifyWorkAvailable,
          signal,
        }),
      });

      const databasePath = join(root, ".jig", "private-activation-admission-v18.sqlite3");
      controller = await openController();
      const submitted = await controller.administration.startRun({
        submissionId: "journal-success",
        target: request!.target,
        input: { delayMs: 20_000 },
      });
      const initialDerivation = await waitForHookDerivedRun(
        databasePath,
        submitted.runId,
        "publish-first",
      );
      const derived = await waitForTerminalRootRun(root, initialDerivation.runId, 15_000);
      expect(derived).toMatchObject({
        origin: { kind: "private-root-hook-derived-origin/1" },
        input: {
          journalPosition: 1,
          type: "https://example.test/events/first",
          source: "binding:publisher",
          data: { value: 1 },
          runId: submitted.runId,
        },
        state: "terminal",
        terminal: {
          status: "succeeded",
          result: {
            outcome: "done",
            output: {
              event: {
                journalPosition: 1,
                type: "https://example.test/events/first",
                source: "binding:publisher",
                data: { value: 1 },
                runId: submitted.runId,
              },
            },
          },
        },
      });
      expect(await controller.administration.runStatus(submitted)).toMatchObject({ state: "pending" });
      await controller.drain();
      const status = await controller.administration.runStatus(submitted);
      expect(status).toMatchObject({
        state: "terminal",
        terminal: {
          status: "succeeded",
          outcome: "done",
          output: {
            first: { journalPosition: 1, source: "binding:publisher" },
            replay: { journalPosition: 1, source: "binding:publisher" },
            conflict: { error: "OPERATION_CONFLICT" },
            second: { journalPosition: 2, source: "binding:publisher" },
            denied: { error: "PERMISSION_DENIED" },
            forgedSource: { error: "INVALID_INPUT" },
          },
        },
      });

      const sqlite = createRequire(import.meta.url)("bun:sqlite") as any;
      const database = sqlite.Database.open(
        databasePath,
        sqlite.constants.SQLITE_OPEN_READONLY | sqlite.constants.SQLITE_OPEN_NOFOLLOW,
      );
      try {
        expect(database.query(
          "SELECT count(*) AS count FROM root_journal_appends WHERE parent_run_id = ?1",
        ).get(submitted.runId).count).toBe(2);
        expect(database.query(
          "SELECT count(*) AS count FROM root_journal_closures WHERE parent_run_id = ?1",
        ).get(submitted.runId).count).toBe(2);
        const release = JSON.parse(new TextDecoder().decode(database.query(
          "SELECT release_bytes FROM root_execution_lifecycles WHERE run_id = ?1",
        ).get(submitted.runId).release_bytes)) as {
          readonly value?: {
            readonly kind?: unknown;
            readonly journalClosureDigest?: unknown;
            readonly serviceClosureDigest?: unknown;
          };
        };
        expect(release.value?.kind).toBe("private-direct-root-release/2");
        expect(release.value?.journalClosureDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
        expect(release.value?.serviceClosureDigest).toBeNull();
      } finally { database.close(true); }
      await controller.dispose();
      controller = undefined;

      crashed = spawn(process.execPath, [
        join(import.meta.dir, "fixtures", "composed-root-run-controller.ts"),
        root,
        store,
        "journal-crash",
        "journal-run",
      ], { stdio: ["ignore", "pipe", "pipe"] });
      const diagnostics = collect(crashed.stderr!);
      const abandoned = JSON.parse(await firstLine(crashed.stdout!)) as { readonly runId: string };
      await waitForRootJournalAppends(databasePath, abandoned.runId, 2).catch(async (error) => {
        crashed!.kill("SIGKILL");
        await childExit(crashed!);
        throw new Error(`${String(error)}: ${await diagnostics}`);
      });
      const crashDerivation = await waitForHookDerivedRun(
        databasePath,
        abandoned.runId,
        "publish-first",
      );
      await waitForRootExecutionPrepared(databasePath, crashDerivation.runId).catch(async (error) => {
        crashed!.kill("SIGKILL");
        await childExit(crashed!);
        throw new Error(`${String(error)}: ${await diagnostics}`);
      });
      expect(await loadPrivateRootRun({ projectRoot: root, runId: crashDerivation.runId })).toMatchObject({
        origin: {
          kind: "private-root-hook-derived-origin/1",
          eventId: crashDerivation.eventId,
        },
        input: crashDerivation.event,
        state: "spawn-intent",
      });
      expect(await hookDerivationCount(databasePath, crashDerivation.eventId)).toBe(1);
      crashed.kill("SIGKILL");
      expect((await childExit(crashed)).signal).toBe("SIGKILL");
      crashed = undefined;

      controller = await openController();
      expect(await controller.administration.runStatus(abandoned)).toMatchObject({
        state: "terminal",
        terminal: { status: "lost", code: "COORDINATOR_LOST" },
      });
      expect(await loadPrivateRootRun({
        projectRoot: root,
        runId: crashDerivation.runId,
      })).toMatchObject({
        origin: {
          kind: "private-root-hook-derived-origin/1",
          eventId: crashDerivation.eventId,
        },
        input: crashDerivation.event,
        state: "terminal",
        terminal: { status: "lost", code: "COORDINATOR_LOST" },
      });
      expect(await rootJournalAppendCount(databasePath, abandoned.runId)).toBe(2);
      expect(await hookDerivationCount(databasePath, crashDerivation.eventId)).toBe(1);
      await controller.dispose();
      controller = undefined;

      controller = await openController();
      expect(await loadPrivateRootRun({
        projectRoot: root,
        runId: crashDerivation.runId,
      })).toMatchObject({
        state: "terminal",
        terminal: { status: "lost", code: "COORDINATOR_LOST" },
      });
      expect(await rootJournalAppendCount(databasePath, abandoned.runId)).toBe(2);
      expect(await hookDerivationCount(databasePath, crashDerivation.eventId)).toBe(1);
      await controller.dispose();
      controller = undefined;
      expect(await jigCgroups(host.scope)).toEqual([]);
      expect(await listOrEmpty(join(root, ".jig", "private-root-materializations"))).toEqual([]);
      expect(await listOrEmpty(join(root, ".jig", "private-root-linux-owners"))).toEqual([]);
      expect((await readdir("/dev")).filter(
        (name) => name.startsWith(".jig-jig-run-") && name.endsWith("-devices"),
      )).toEqual([]);
    } finally {
      if (crashed !== undefined && crashed.exitCode === null && crashed.signalCode === null) {
        crashed.kill("SIGKILL");
        await childExit(crashed).catch(() => undefined);
      }
      await controller?.dispose();
      await rm(root, { recursive: true, force: true });
      await rm(store, { recursive: true, force: true });
    }
  }, 180_000);

  test("runs one admitted Bun parent through deterministically selected Python child Flows", async () => {
    host = await hostConfiguration();
    const [bun, python] = await Promise.all([
      proofHostBunClosure(),
      proofHostPythonClosure(),
    ]);
    const distribution = await realpath(join(import.meta.dir, "..", "dist"));
    const root = await mkdtemp(join(tmpdir(), "jig-child-flow-project-"));
    const store = await mkdtemp(join(tmpdir(), "jig-child-flow-store-"));
    let controller: Awaited<ReturnType<typeof openPrivateRootAdministrationController>> | undefined;
    let crashed: ReturnType<typeof spawn> | undefined;
    const rootBackend = backend(host);
    const evaluator = {
      backend: rootBackend,
      bunPath: bun.executable,
      runtimeMounts: bun.runtimeSupport.closureSources.map((source) => ({ source, destination: source })),
      runtimeSupport: bun.runtimeSupport,
      jigDistributionPath: distribution,
    } as const;
    try {
      await mkdir(join(root, "bindings"));
      await mkdir(join(root, "flows", "parent"), { recursive: true });
      await mkdir(join(root, "flows", "child"), { recursive: true });
      await mkdir(join(root, "flows", "child-two"), { recursive: true });
      await mkdir(join(root, "flows", "child-starting"), { recursive: true });
      await mkdir(join(root, "flows", "unavailable"), { recursive: true });
      await writeFile(join(root, "jig.ts"), [
        'import { defineJig, discover } from "@jigging/jig";',
        'export default defineJig({ flows: discover("flows"), bindings: discover("bindings") });',
        "",
      ].join("\n"));
      await writeFile(join(root, "bindings", "parent.ts"), [
        'import { defineBinding, flowRef } from "@jigging/jig";',
        "export default defineBinding({",
        '  package: "flows/parent",',
        '  settings: { marker: "admitted" },',
        '  slots: { child: flowRef("flows/child") },',
        "});",
        "",
      ].join("\n"));
      await writeFile(join(root, "bindings", "missing.ts"), [
        'import { defineBinding } from "@jigging/jig";',
        "export default defineBinding({",
        '  package: "flows/parent",',
        '  settings: { marker: "missing" },',
        "});",
        "",
      ].join("\n"));
      await writeFile(join(root, "bindings", "multiple.ts"), [
        'import { candidates, defineBinding, flowRef } from "@jigging/jig";',
        "export default defineBinding({",
        '  package: "flows/parent",',
        '  settings: { marker: "multiple" },',
        '  slots: { child: candidates([flowRef("flows/child"), flowRef("flows/child-two")]) },',
        "});",
        "",
      ].join("\n"));
      await writeFile(join(root, "bindings", "filtered.ts"), [
        'import { candidates, defineBinding, flowRef } from "@jigging/jig";',
        "export default defineBinding({",
        '  package: "flows/parent",',
        '  settings: { marker: "filtered" },',
        '  slots: { child: candidates([flowRef("flows/child"), flowRef("flows/unavailable")]) },',
        "});",
        "",
      ].join("\n"));
      await writeFile(join(root, "bindings", "unavailable.ts"), [
        'import { defineBinding, flowRef } from "@jigging/jig";',
        "export default defineBinding({",
        '  package: "flows/parent",',
        '  settings: { marker: "unavailable" },',
        '  slots: { child: flowRef("flows/unavailable") },',
        "});",
        "",
      ].join("\n"));
      await writeFile(join(root, "bindings", "starting.ts"), [
        'import { defineBinding, flowRef } from "@jigging/jig";',
        "export default defineBinding({",
        '  package: "flows/parent",',
        '  settings: { marker: "starting" },',
        '  slots: { child: flowRef("flows/child-starting") },',
        "});",
        "",
      ].join("\n"));

      const parent = join(root, "flows", "parent");
      await writeFile(join(parent, "FLOW.md"), [
        "---",
        "name: composed-parent",
        "description: Calls one exact admitted child Flow.",
        "---",
        "",
      ].join("\n"));
      await writeFile(join(parent, "settings.schema.json"), JSON.stringify({
        $schema: "https://flow.dev/schemas/schema-1.json",
        type: "object",
        properties: {
          marker: { enum: ["admitted", "filtered", "missing", "multiple", "unavailable", "starting"] },
        },
        required: ["marker"],
        additionalProperties: false,
      }));
      const parentSdk = join(parent, "flow-sdk");
      await mkdir(parentSdk);
      for (const name of [
        "index.ts", "json.ts", "protocol.ts", "service-session.ts", "session.ts", "transport.ts", "types.ts",
      ]) {
        await writeFile(join(parentSdk, name), await readFile(join(import.meta.dir, "..", "..", "flow-sdk", "src", name)));
      }
      await writeFile(join(parent, "flow.ts"), [
        "#!/usr/bin/env bun",
        'import { OperationError, serve } from "./flow-sdk/index.ts";',
        "",
        "await serve(async (context) => {",
        "  const request = context.input && typeof context.input === \"object\" ? context.input : {};",
        "  const call = { operationId: \"child-one\", slot: \"child\", input: context.input };",
        "  if (\"probe\" in request) {",
        "    const probeCall = {",
        "      operationId: \"probe-one\",",
        "      slot: typeof request.slot === \"string\" ? request.slot : \"child\",",
        "      input: Object.hasOwn(request, \"childInput\") ? request.childInput : context.input,",
        "    };",
        "    try {",
        "      return { outcome: \"done\", output: { marker: context.settings.marker, result: await context.callFlow(probeCall) } };",
        "    } catch (error) {",
        "      return {",
        "        outcome: \"done\",",
        "        output: { marker: context.settings.marker, error: error instanceof OperationError ? error.code : \"unexpected\" },",
        "      };",
        "    }",
        "  }",
        "  if (context.input && typeof context.input === \"object\" && \"cancelMode\" in context.input) {",
        "    const firstController = new AbortController();",
        "    const secondController = new AbortController();",
        "    const observed = (promise) => promise.then(",
        "      (result) => ({ result }),",
        "      (error) => ({ error: error instanceof OperationError ? error.code : \"unexpected\" }),",
        "    );",
        "    const first = observed(context.callFlow(call, { signal: firstController.signal }));",
        "    const second = observed(context.callFlow(call, { signal: secondController.signal }));",
        "    await Bun.sleep(100);",
        "    firstController.abort();",
        "    if (context.input.cancelMode === \"all\") secondController.abort();",
        "    return { outcome: \"done\", output: { waiters: await Promise.all([first, second]) } };",
        "  }",
        "  const first = await context.callFlow(call);",
        "  const replay = await context.callFlow(call);",
        "  let rejected = \"missing\";",
        "  try {",
        "    await context.callFlow({ ...call, operationId: \"child-two\" });",
        "  } catch (error) {",
        "    rejected = error instanceof OperationError ? error.code : \"unexpected\";",
        "  }",
        "  return {",
        '    outcome: "done",',
        "    output: { marker: context.settings.marker, first, replay, rejected },",
        "  };",
        "});",
        "",
      ].join("\n"));

      const child = join(root, "flows", "child");
      await writeFile(join(child, "FLOW.md"), [
        "---",
        "name: exact-child",
        "description: Returns one value from a contained Python Run.",
        "---",
        "",
      ].join("\n"));
      const childInputSchema = JSON.stringify({
        $schema: "https://flow.dev/schemas/schema-1.json",
        type: "object",
      });
      const childResultSchema = JSON.stringify({
        $schema: "https://flow.dev/schemas/schema-1.json",
        type: "object",
        properties: {
          outcome: { const: "done" },
          output: {
            type: "object",
            properties: { child: {} },
            required: ["child"],
            additionalProperties: false,
          },
        },
        required: ["outcome", "output"],
        additionalProperties: false,
      });
      const childProgram = [
        "#!/usr/bin/env python",
        "import asyncio",
        "import os",
        "from flowmd_sdk import serve",
        "",
        "async def run(context):",
        "    mode = context.input.get(\"childMode\") if isinstance(context.input, dict) else None",
        "    if mode == \"protocol\":",
        "        os.write(1, b\"not-json\\n\")",
        "        await asyncio.sleep(0.1)",
        "    if isinstance(context.input, dict) and context.input.get(\"delayMs\"):",
        "        await asyncio.sleep(context.input[\"delayMs\"] / 1000)",
        "    if mode == \"invalid-result\":",
        '        return {"outcome": "done", "output": "invalid"}',
        "    if mode == \"undeclared-outcome\":",
        '        return {"outcome": "unexpected", "output": {"child": context.input}}',
        '    return {"outcome": "done", "output": {"child": context.input}}',
        "",
        "serve(run)",
        "",
      ].join("\n");
      for (const childPath of [child, join(root, "flows", "child-two")]) {
        if (childPath !== child) {
          await writeFile(join(childPath, "FLOW.md"), [
            "---",
            "name: exact-child-two",
            "description: Second exact candidate used only to prove ambiguity refusal.",
            "---",
            "",
          ].join("\n"));
        }
        await writeFile(join(childPath, "input.schema.json"), childInputSchema);
        await writeFile(join(childPath, "result.schema.json"), childResultSchema);
        const pythonSdk = join(childPath, "flowmd_sdk");
        await mkdir(pythonSdk);
        for (const name of ["__init__.py", "_json.py", "_runtime.py", "_service.py", "_types.py"]) {
          await writeFile(join(pythonSdk, name), await readFile(join(import.meta.dir, "..", "..", "flowmd-sdk", "src", "flowmd_sdk", name)));
        }
        await writeFile(join(childPath, "flow.py"), childProgram);
      }
      const startingChild = join(root, "flows", "child-starting");
      await writeFile(join(startingChild, "FLOW.md"), [
        "---",
        "name: starting-child",
        "description: Delays its Run handshake to prove startup lifecycle handling.",
        "---",
        "",
      ].join("\n"));
      await writeFile(join(startingChild, "input.schema.json"), childInputSchema);
      await writeFile(join(startingChild, "result.schema.json"), childResultSchema);
      const startingPythonSdk = join(startingChild, "flowmd_sdk");
      await mkdir(startingPythonSdk);
      for (const name of ["__init__.py", "_json.py", "_runtime.py", "_service.py", "_types.py"]) {
        await writeFile(join(startingPythonSdk, name), await readFile(join(import.meta.dir, "..", "..", "flowmd-sdk", "src", "flowmd_sdk", name)));
      }
      await writeFile(
        join(startingChild, "flow.py"),
        childProgram.replace("serve(run)\n", "import time\ntime.sleep(30)\nserve(run)\n"),
      );
      const startingPadding = join(startingChild, "padding");
      await mkdir(startingPadding);
      await Promise.all(Array.from({ length: 512 }, (_, index) => writeFile(
        join(startingPadding, `${index.toString().padStart(4, "0")}.txt`),
        `retained startup fixture ${index}\n`,
      )));
      const unavailablePath = join(root, "flows", "unavailable");
      await writeFile(join(unavailablePath, "FLOW.md"), [
        "---",
        "name: unavailable-child",
        "description: Has no installed private direct-Run recipe.",
        "---",
        "",
      ].join("\n"));
      await writeFile(join(unavailablePath, "flow.sh"), "#!/usr/bin/env sh\nexit 0\n");

      const aggregate = await retainPackageProject({
        projectRoot: root,
        storeRoot: store,
        evaluator,
      });
      expect(aggregate.linked.bindings).toHaveLength(6);
      const requests = buildPrivateActivationRequests(aggregate.linked);
      expect(requests).toHaveLength(10);
      const runtimeSupport = Object.freeze({
        bun: bun.runtimeSupport,
        python: python.runtimeSupport,
      });
      const recipes = [];
      const entries = [];
      for (const request of requests) {
        const unsupportedParent = request.target.kind === "binding" && request.target.id === "missing";
        if (request.entrypoint.path === "flow.sh" || unsupportedParent) {
          if (unsupportedParent) {
            await expect(planPrivateDirectRun({
              request,
              runtimeSupport,
              backend: rootBackend,
            })).rejects.toThrow(
              "private Bun Binding recipe requires at least one admitted Flow-call or capability slot",
            );
          }
          entries.push({
            target: request.target,
            requestDigest: request.digest,
            disposition: {
              state: "unavailable" as const,
              code: "RUNTIME_UNAVAILABLE" as const,
              evidenceDigests: [testDigest(
                request.entrypoint.path === "flow.sh"
                  ? "unavailable-shell-recipe"
                  : `unsupported-parent-${request.target.kind === "binding" ? request.target.id : "unknown"}`,
              )],
            },
          });
          continue;
        }
        const recipe = await planPrivateDirectRun({ request, runtimeSupport, backend: rootBackend });
        recipes.push(recipe);
        entries.push({
          target: request.target,
          requestDigest: request.digest,
          disposition: { state: "planned" as const, observation: recipe.observation },
        });
      }
      const planning = createPrivateActivationPlanningObservation({
        policyDigest: testDigest("child-flow-policy"),
        mechanismDigest: recipes[0]!.mechanismDigest,
        entries,
      });
      const candidate = createPrivateActivationCandidateV5(
        aggregate,
        resolveRetainedPackageProjectObservation(aggregate, planning),
        recipes,
      );
      await publishPrivateActivationCandidate({
        projectRoot: root,
        packageStoreRoot: store,
        candidate,
      });
      const review = await createPrivateActivationReviewPlan({
        projectRoot: root,
        packageStoreRoot: store,
        lockMode: "update",
      });
      await applyPrivateActivationReviewPlan({
        projectRoot: root,
        packageStoreRoot: store,
        planDigest: review.planDigest,
      });
      const parentTarget = candidate.candidate.targets.find(
        ({ request }) => request.target.kind === "binding" && request.target.id === "parent",
      )!.request.target;
      expect(parentTarget).toEqual({ kind: "binding", id: "parent" });

      const openController = async (
        selectedBackend: PrivateLinuxCgroupBackend = rootBackend,
        runTimeoutMs = 25_000,
      ) => await openPrivateRootAdministrationController({
        projectRoot: root,
        packageStoreRoot: store,
        runTimeoutMs,
        execute: (runId, coordinator, signal, notifyWorkAvailable) => executePrivateRootRunLaunch({
          projectRoot: root,
          packageStoreRoot: store,
          runId,
          coordinator,
          runtimeSupport,
          backend: selectedBackend,
          notifyWorkAvailable,
          signal,
        }),
      });

      controller = await openController();
      const handle = await controller.administration.startRun({
        submissionId: "composed-one",
        target: parentTarget,
        input: { ticket: "T-child" },
      });
      await controller.drain();
      expect(await controller.administration.runStatus(handle)).toMatchObject({
        state: "terminal",
        terminal: {
          status: "succeeded",
          outcome: "done",
          output: {
            marker: "admitted",
            first: { outcome: "done", output: { child: { ticket: "T-child" } } },
            replay: { outcome: "done", output: { child: { ticket: "T-child" } } },
            rejected: "RESOURCE_EXHAUSTED",
          },
        },
      });
      const bindingTarget = (id: string) => candidate.candidate.targets.find(
        ({ request }) => request.target.kind === "binding" && request.target.id === id,
      )!.request.target;
      const probe = async (
        submissionId: string,
        target: ReturnType<typeof bindingTarget>,
        childInput: unknown,
      ) => {
        const started = await controller!.administration.startRun({
          submissionId,
          target,
          input: { probe: submissionId, childInput } as never,
        });
        await controller!.drain();
        return { started, status: await controller!.administration.runStatus(started) };
      };
      const missing = await controller.administration.startRun({
        submissionId: "composed-missing",
        target: bindingTarget("missing"),
        input: {},
      });
      const multiple = await controller.administration.startRun({
        submissionId: "composed-multiple",
        target: bindingTarget("multiple"),
        input: { probe: "composed-multiple", childInput: {} },
      });
      await controller.drain();
      expect(await controller.administration.runStatus(missing)).toMatchObject({
        state: "terminal",
        terminal: { status: "failed", code: "UNAVAILABLE" },
      });
      expect(await controller.administration.runStatus(multiple)).toMatchObject({
        state: "terminal",
        terminal: {
          status: "succeeded",
          outcome: "done",
          output: { marker: "multiple", error: "UNAVAILABLE" },
        },
      });
      const filtered = await controller.administration.startRun({
        submissionId: "composed-filtered",
        target: bindingTarget("filtered"),
        input: { ticket: "T-filtered" },
      });
      await controller.drain();
      expect(await controller.administration.runStatus(filtered)).toMatchObject({
        state: "terminal",
        terminal: {
          status: "succeeded",
          outcome: "done",
          output: {
            marker: "filtered",
            first: { outcome: "done", output: { child: { ticket: "T-filtered" } } },
            replay: { outcome: "done", output: { child: { ticket: "T-filtered" } } },
            rejected: "RESOURCE_EXHAUSTED",
          },
        },
      });
      const unavailable = await probe("composed-unavailable", bindingTarget("unavailable"), {});
      expect(unavailable.status).toMatchObject({
        state: "terminal",
        terminal: { status: "succeeded", output: { marker: "unavailable", error: "UNAVAILABLE" } },
      });
      const invalidInput = await probe("composed-invalid-input", parentTarget, "not-an-object");
      expect(invalidInput.status).toMatchObject({
        state: "terminal",
        terminal: { status: "succeeded", output: { marker: "admitted", error: "INVALID_INPUT" } },
      });
      const invalidResult = await probe(
        "composed-invalid-result",
        parentTarget,
        { childMode: "invalid-result" },
      );
      expect(invalidResult.status).toMatchObject({
        state: "terminal",
        terminal: { status: "succeeded", output: { marker: "admitted", error: "INVALID_RESULT" } },
      });
      const undeclaredOutcome = await probe(
        "composed-undeclared-outcome",
        parentTarget,
        { childMode: "undeclared-outcome" },
      );
      expect(undeclaredOutcome.status).toMatchObject({
        state: "terminal",
        terminal: { status: "succeeded", output: { marker: "admitted", error: "INVALID_RESULT" } },
      });
      const protocolFailure = await probe(
        "composed-protocol-failure",
        parentTarget,
        { childMode: "protocol" },
      );
      expect(protocolFailure.status).toMatchObject({
        state: "terminal",
        terminal: { status: "succeeded", output: { marker: "admitted", error: "EXECUTION_FAILED" } },
      });
      const cancelOne = await controller.administration.startRun({
        submissionId: "composed-cancel-one",
        target: parentTarget,
        input: { cancelMode: "one", delayMs: 500 },
      });
      await controller.drain();
      expect(await controller.administration.runStatus(cancelOne)).toMatchObject({
        state: "terminal",
        terminal: {
          status: "succeeded",
          output: {
            waiters: [
              { error: "CANCELLED" },
              { result: { outcome: "done", output: { child: { cancelMode: "one", delayMs: 500 } } } },
            ],
          },
        },
      });
      const cancelAll = await controller.administration.startRun({
        submissionId: "composed-cancel-all",
        target: parentTarget,
        input: { cancelMode: "all", delayMs: 30_000 },
      });
      await controller.drain();
      expect(await controller.administration.runStatus(cancelAll)).toMatchObject({
        state: "terminal",
        terminal: {
          status: "succeeded",
          output: { waiters: [{ error: "CANCELLED" }, { error: "CANCELLED" }] },
        },
      });
      const sqlite = createRequire(import.meta.url)("bun:sqlite") as any;
      const databasePath = join(root, ".jig", "private-activation-admission-v18.sqlite3");
      const database = sqlite.Database.open(
        databasePath,
        sqlite.constants.SQLITE_OPEN_READONLY | sqlite.constants.SQLITE_OPEN_NOFOLLOW,
      );
      try {
        expect(database.query("SELECT count(*) AS count FROM root_flow_calls").get().count).toBe(8);
        for (const refused of [missing, multiple, unavailable.started]) {
          expect(database.query(
            "SELECT count(*) AS count FROM root_flow_calls WHERE parent_run_id = ?1",
          ).get(refused.runId).count).toBe(0);
        }
        expect(database.query(
          "SELECT count(*) AS count FROM root_flow_call_facts WHERE parent_run_id = ?1 AND fact_name = 'plan'",
        ).get(invalidInput.started.runId).count).toBe(0);
        expect(database.query(
          "SELECT count(*) AS count FROM root_flow_call_facts WHERE fact_name = 'release'",
        ).get().count).toBe(8);
        expect(database.query(
          "SELECT count(*) AS count FROM root_flow_call_facts WHERE fact_name = 'admitted'",
        ).get().count).toBe(8);
        expect(database.query("SELECT count(*) AS count FROM root_flow_call_closures").get().count).toBe(8);
      } finally { database.close(true); }
      await controller.dispose();
      controller = undefined;
      expect(await jigCgroups(host.scope)).toEqual([]);

      controller = await openController();
      const heldFence = await controller.administration.startRun({
        submissionId: "composed-held-fence",
        target: parentTarget,
        input: { probe: "held-fence", childInput: { ticket: "held", delayMs: 2_000 } },
      });
      await waitForRootFlowCallFact(databasePath, heldFence.runId, "prepared");
      expect(await countRootFlowCallFact(databasePath, heldFence.runId, "fence")).toBe(0);
      expect(await controller.administration.runStatus(heldFence)).toMatchObject({ state: "pending" });
      await controller.drain();
      expect(await countRootFlowCallFact(databasePath, heldFence.runId, "fence")).toBe(1);
      expect(await controller.administration.runStatus(heldFence)).toMatchObject({
        state: "terminal",
        terminal: { status: "succeeded", output: { marker: "admitted" } },
      });
      await controller.dispose();
      controller = undefined;
      expect(await jigCgroups(host.scope)).toEqual([]);

      controller = await openController();
      const cancelledDuringStartup = await controller.administration.startRun({
        submissionId: "composed-cancel-startup",
        target: bindingTarget("starting"),
        input: {},
      });
      await waitForRootFlowCallFact(databasePath, cancelledDuringStartup.runId, "plan");
      await controller.dispose();
      controller = undefined;
      controller = await openController();
      expect(await controller.administration.runStatus(cancelledDuringStartup)).toMatchObject({
        state: "terminal",
        terminal: { status: "failed", code: "CANCELLED" },
      });
      expect(await countRootFlowCallFact(databasePath, cancelledDuringStartup.runId, "prepared")).toBe(0);
      await controller.dispose();
      controller = undefined;
      expect(await jigCgroups(host.scope)).toEqual([]);

      controller = await openController();
      const cancelledWhileRunning = await controller.administration.startRun({
        submissionId: "composed-cancel-running",
        target: parentTarget,
        input: { delayMs: 30_000 },
      });
      await waitForRootFlowCallFact(databasePath, cancelledWhileRunning.runId, "prepared");
      await controller.dispose();
      controller = undefined;
      controller = await openController();
      expect(await controller.administration.runStatus(cancelledWhileRunning)).toMatchObject({
        state: "terminal",
        terminal: { status: "failed", code: "CANCELLED" },
      });
      await controller.dispose();
      controller = undefined;
      expect(await jigCgroups(host.scope)).toEqual([]);

      controller = await openController(rootBackend, 30_000);
      const childDeadline = await controller.administration.startRun({
        submissionId: "composed-child-deadline",
        target: parentTarget,
        input: { delayMs: 60_000 },
      });
      await waitForRootFlowCallFact(databasePath, childDeadline.runId, "prepared", 25_000);
      await controller.drain();
      expect(await controller.administration.runStatus(childDeadline)).toMatchObject({
        state: "terminal",
        terminal: { status: "failed", code: "DEADLINE_EXCEEDED" },
      });
      await controller.dispose();
      controller = undefined;
      expect(await jigCgroups(host.scope)).toEqual([]);

      controller = await openController(rootBackend, 20_000);
      const startupDeadline = await controller.administration.startRun({
        submissionId: "composed-startup-deadline",
        target: bindingTarget("starting"),
        input: {},
      });
      await controller.drain();
      expect(await controller.administration.runStatus(startupDeadline)).toMatchObject({
        state: "terminal",
        terminal: { status: "failed", code: "DEADLINE_EXCEEDED" },
      });
      expect(await countRootFlowCallFact(databasePath, startupDeadline.runId, "plan")).toBe(1);
      expect(await countRootFlowCallFact(databasePath, startupDeadline.runId, "prepared")).toBe(0);
      await controller.dispose();
      controller = undefined;
      expect(await jigCgroups(host.scope)).toEqual([]);

      crashed = spawn(process.execPath, [
        join(import.meta.dir, "fixtures", "composed-root-run-controller.ts"),
        root,
        store,
        "composed-crash",
      ], { stdio: ["ignore", "pipe", "pipe"] });
      const crashedDiagnostics = collect(crashed.stderr!);
      const abandoned = JSON.parse(await firstLine(crashed.stdout!)) as { readonly runId: string };
      await waitForRootFlowCallFact(databasePath, abandoned.runId, "prepared", 20_000).catch(
        async (error) => {
          crashed!.kill("SIGKILL");
          await childExit(crashed!);
          throw new Error(`${String(error)}: ${await crashedDiagnostics}`);
        },
      );
      crashed.kill("SIGKILL");
      expect((await childExit(crashed)).signal).toBe("SIGKILL");
      crashed = undefined;

      controller = await openController();
      expect(await controller.administration.runStatus(abandoned)).toMatchObject({
        state: "terminal",
        terminal: { status: "lost", code: "COORDINATOR_LOST" },
      });
      await controller.dispose();
      controller = undefined;
      const recovered = sqlite.Database.open(
        databasePath,
        sqlite.constants.SQLITE_OPEN_READONLY | sqlite.constants.SQLITE_OPEN_NOFOLLOW,
      );
      try {
        expect(recovered.query(
          "SELECT count(*) AS count FROM root_flow_call_closures WHERE parent_run_id = ?1",
        ).get(abandoned.runId).count).toBe(1);
        expect(recovered.query(
          "SELECT count(*) AS count FROM root_flow_call_facts WHERE parent_run_id = ?1 AND fact_name = 'prepared'",
        ).get(abandoned.runId).count).toBe(1);
      } finally { recovered.close(true); }
      expect(await jigCgroups(host.scope)).toEqual([]);

      crashed = spawn(process.execPath, [
        join(import.meta.dir, "fixtures", "composed-root-run-controller.ts"),
        root,
        store,
        "composed-crash-before-admission",
        "starting",
      ], { stdio: ["ignore", "pipe", "pipe"] });
      const preAdmissionDiagnostics = collect(crashed.stderr!);
      const preAdmission = JSON.parse(await firstLine(crashed.stdout!)) as { readonly runId: string };
      await waitForRootFlowCallFact(databasePath, preAdmission.runId, "plan", 20_000).catch(
        async (error) => {
          crashed!.kill("SIGKILL");
          await childExit(crashed!);
          throw new Error(`${String(error)}: ${await preAdmissionDiagnostics}`);
        },
      );
      expect(await countRootFlowCallFact(databasePath, preAdmission.runId, "sandbox")).toBe(0);
      crashed.kill("SIGKILL");
      expect((await childExit(crashed)).signal).toBe("SIGKILL");
      crashed = undefined;

      controller = await openController();
      expect(await controller.administration.runStatus(preAdmission)).toMatchObject({
        state: "terminal",
        terminal: { status: "lost", code: "COORDINATOR_LOST" },
      });
      await controller.dispose();
      controller = undefined;
      expect(await countRootFlowCallFact(databasePath, preAdmission.runId, "sandbox")).toBe(0);
      expect(await countRootFlowCallFact(databasePath, preAdmission.runId, "prepared")).toBe(0);
      expect(await countRootFlowCallClosures(databasePath, preAdmission.runId)).toBe(1);
      expect(await jigCgroups(host.scope)).toEqual([]);
      expect(await listOrEmpty(join(root, ".jig", "private-root-materializations"))).toEqual([]);
      expect(await listOrEmpty(join(root, ".jig", "private-root-linux-owners"))).toEqual([]);
      expect((await readdir("/dev")).filter((name) => name.startsWith(".jig-jig-run-") && name.endsWith("-devices"))).toEqual([]);
    } finally {
      if (crashed !== undefined && crashed.exitCode === null && crashed.signalCode === null) {
        crashed.kill("SIGKILL");
        await childExit(crashed).catch(() => undefined);
      }
      await controller?.dispose();
      await rm(root, { recursive: true, force: true });
      await rm(store, { recursive: true, force: true });
    }
  }, 540_000);

  test("runs and manually recovers one private mixed composition across coordinator loss", async () => {
    host = await hostConfiguration();
    const [bun, python] = await Promise.all([
      proofHostBunClosure(),
      proofHostPythonClosure(),
    ]);
    const distribution = await realpath(join(import.meta.dir, "..", "dist"));
    const sdkSource = await realpath(join(import.meta.dir, "..", "..", "flow-sdk", "src"));
    const pythonSdkSource = await realpath(join(import.meta.dir, "..", "..", "flowmd-sdk", "src", "flowmd_sdk"));
    const root = await mkdtemp(join(tmpdir(), "jig-mixed-composition-project-"));
    const store = await mkdtemp(join(tmpdir(), "jig-mixed-composition-store-"));
    const rootBackend = backend(host);
    const evaluator = {
      backend: rootBackend,
      bunPath: bun.executable,
      runtimeMounts: bun.runtimeSupport.closureSources.map((source) => ({ source, destination: source })),
      runtimeSupport: bun.runtimeSupport,
      jigDistributionPath: distribution,
    } as const;
    let coordinator: Awaited<ReturnType<typeof openPrivateProjectCoordinator>> | undefined;
    let controller: Awaited<ReturnType<typeof attachPrivateRootAdministrationController>> | undefined;
    let mounted: Awaited<ReturnType<typeof startPrivateBunServiceMount>> | undefined;
    let crashed: ReturnType<typeof spawn> | undefined;
    let crashedExit: ReturnType<typeof childExit> | undefined;
    try {
      await mkdir(join(root, "bindings"));
      await mkdir(join(root, "flows", "mixed", "contracts"), { recursive: true });
      await mkdir(join(root, "flows", "mixed", "flow-sdk"));
      await mkdir(join(root, "flows", "child", "flowmd_sdk"), { recursive: true });
      await mkdir(join(root, "flows", "counter", "contracts"), { recursive: true });
      await mkdir(join(root, "flows", "counter", "flow-sdk"));

      await writeFile(join(root, "jig.ts"), [
        'import { defineJig, discover } from "@jigging/jig";',
        'export default defineJig({ flows: discover("flows"), bindings: discover("bindings") });',
        "",
      ].join("\n"));
      await writeFile(join(root, "bindings", "publisher.ts"), [
        'import { defineJournalPublisher } from "@jigging/jig";',
        "export default defineJournalPublisher({",
        '  eventTypes: ["https://example.test/events/mixed-completed"],',
        "});",
        "",
      ].join("\n"));
      await writeFile(join(root, "bindings", "counter.ts"), [
        'import { defineBinding } from "@jigging/jig";',
        'export default defineBinding({ package: "flows/counter" });',
        "",
      ].join("\n"));
      await writeFile(join(root, "bindings", "mixed.ts"), [
        'import { bindingRef, defineBinding, flowRef } from "@jigging/jig";',
        "export default defineBinding({",
        '  package: "flows/mixed",',
        "  slots: {",
        '    child: flowRef("flows/child"),',
        '    journal: bindingRef("publisher"),',
        '    counter: bindingRef("counter"),',
        "  },",
        "});",
        "",
      ].join("\n"));

      const counterContract = JSON.stringify({
        $schema: "https://flow.dev/schemas/capability-contract-1.schema.json",
        flowCapabilityContract: 1,
        id: "https://example.test/capabilities/mixed-counter",
        version: "1.0.0",
        methods: {
          next: {
            input: {
              type: "object",
              properties: {
                by: { type: "integer", minimum: 1 },
                hold: { type: "boolean" },
              },
              required: ["by"],
              additionalProperties: false,
            },
            output: { type: "integer", minimum: 1 },
            errors: {},
          },
          malformed: {
            input: { type: "object", additionalProperties: false },
            output: { type: "integer" },
            errors: {},
          },
        },
      });
      const counter = join(root, "flows", "counter");
      await writeFile(join(counter, "FLOW.md"), [
        "---",
        "name: mixed-counter",
        "description: One exact process-local counter Service.",
        "service: 1",
        "provides:",
        "  counter: ./contracts/counter.capability.json",
        "---",
        "",
      ].join("\n"));
      await writeFile(join(counter, "contracts", "counter.capability.json"), counterContract);
      for (const name of [
        "index.ts", "json.ts", "protocol.ts", "service-session.ts", "service.ts", "session.ts", "transport.ts", "types.ts",
      ]) {
        await writeFile(join(counter, "flow-sdk", name), await readFile(join(sdkSource, name)));
      }
      await writeFile(join(counter, "flow.ts"), [
        "#!/usr/bin/env bun",
        'import { ServiceError, serveService } from "./flow-sdk/service.ts";',
        "let value = 0;",
        "await serveService({",
        "  exports: {",
        "    counter: async (context) => {",
        '      if (context.method === "malformed") return "not-an-integer";',
        '      if (context.method !== "next") throw new ServiceError("not-found", { method: context.method });',
        "      if (context.input.hold === true) await new Promise<void>((resolve) => {",
        "        if (context.signal.aborted) resolve();",
        '        else context.signal.addEventListener("abort", resolve, { once: true });',
        "      });",
        "      value += 1;",
        "      return value;",
        "    },",
        "  },",
        "  async mount(context) {",
        "    await context.ready();",
        "    await context.cancelled;",
        "  },",
        "});",
        "",
      ].join("\n"));

      const mixed = join(root, "flows", "mixed");
      await writeFile(join(mixed, "FLOW.md"), [
        "---",
        "name: mixed-root",
        "description: Uses one exact child, Journal, and counter Service.",
        "uses:",
        "  journal:",
        "    contract: ./contracts/journal.capability.json",
        "  counter:",
        "    contract: ./contracts/counter.capability.json",
        "---",
        "",
      ].join("\n"));
      await writeFile(join(mixed, "contracts", "counter.capability.json"), counterContract);
      await writeFile(
        join(mixed, "contracts", "journal.capability.json"),
        await readFile(new URL("../../../docs/spec/contracts/jig/journal.capability.json", import.meta.url)),
      );
      for (const name of [
        "index.ts", "json.ts", "protocol.ts", "service-session.ts", "session.ts", "transport.ts", "types.ts",
      ]) {
        await writeFile(join(mixed, "flow-sdk", name), await readFile(join(sdkSource, name)));
      }
      await writeFile(join(mixed, "flow.ts"), [
        "#!/usr/bin/env bun",
        'import { OperationError, serve } from "./flow-sdk/index.ts";',
        "const observed = async (operation) => {",
        "  try { return { result: await operation }; }",
        '  catch (error) { return { error: error instanceof OperationError ? error.code : "unexpected" }; }',
        "};",
        "await serve(async (context) => {",
        "  const request = context.input && typeof context.input === \"object\" ? context.input : {};",
        "  const counterInput = request.counterHold === true ? { by: 1, hold: true } : { by: 1 };",
        "  const counterCall = { operationId: \"counter-next\", slot: \"counter\", method: \"next\", input: counterInput };",
        "  const [first, joined] = await Promise.all([context.callEffect(counterCall), context.callEffect(counterCall)]);",
        "  const replay = await context.callEffect(counterCall);",
        "  const conflict = await observed(context.callEffect({ ...counterCall, input: { by: 2 } }));",
        "  const invalid = await observed(context.callEffect({",
        "    operationId: \"counter-invalid\", slot: \"counter\", method: \"reset\", input: {},",
        "  }));",
        "  let child = null;",
        "  let journal = null;",
        "  let malformed = null;",
        "  if (request.full === true) {",
        "    malformed = await observed(context.callEffect({",
        "      operationId: \"counter-malformed\", slot: \"counter\", method: \"malformed\", input: {},",
        "    }));",
        "    child = await context.callFlow({ operationId: \"child-one\", slot: \"child\", input: { ticket: request.ticket } });",
        "    journal = await context.callEffect({",
        "      operationId: \"publish-one\", slot: \"journal\", method: \"append\",",
        "      input: { type: \"https://example.test/events/mixed-completed\", data: { ticket: request.ticket } },",
        "    });",
        "  }",
        '  if (typeof request.delayMs === "number") await Bun.sleep(request.delayMs);',
        '  return { outcome: "done", output: { first, joined, replay, conflict, invalid, malformed, child, journal } };',
        "});",
        "",
      ].join("\n"));

      const child = join(root, "flows", "child");
      await writeFile(join(child, "FLOW.md"), [
        "---",
        "name: mixed-python-child",
        "description: Returns one exact child result.",
        "---",
        "",
      ].join("\n"));
      await writeFile(join(child, "input.schema.json"), JSON.stringify({
        $schema: "https://flow.dev/schemas/schema-1.json",
        type: "object",
        properties: { ticket: { type: "string" } },
        required: ["ticket"],
        additionalProperties: false,
      }));
      await writeFile(join(child, "result.schema.json"), JSON.stringify({
        $schema: "https://flow.dev/schemas/schema-1.json",
        type: "object",
        properties: {
          outcome: { const: "done" },
          output: {
            type: "object",
            properties: { child: { type: "string" } },
            required: ["child"],
            additionalProperties: false,
          },
        },
        required: ["outcome", "output"],
        additionalProperties: false,
      }));
      for (const name of ["__init__.py", "_json.py", "_runtime.py", "_service.py", "_types.py"]) {
        await writeFile(join(child, "flowmd_sdk", name), await readFile(join(pythonSdkSource, name)));
      }
      await writeFile(join(child, "flow.py"), [
        "#!/usr/bin/env python",
        "from flowmd_sdk import serve",
        "",
        "async def run(context):",
        '    return {"outcome": "done", "output": {"child": context.input["ticket"]}}',
        "",
        "serve(run)",
        "",
      ].join("\n"));

      const aggregate = await retainPackageProject({ projectRoot: root, storeRoot: store, evaluator });
      const requests = buildPrivateActivationRequests(aggregate.linked);
      const runtimeSupport = Object.freeze({ bun: bun.runtimeSupport, python: python.runtimeSupport });
      const recipes = [];
      let serviceRecipe: PrivateBunServiceRecipe | undefined;
      for (const request of requests) {
        if (request.mode === "service") {
          const observation = await observePrivateBunServicePackage({
            request,
            packageStoreRoot: store,
          });
          serviceRecipe = await planPrivateBunService({
            request,
            packageObservation: observation,
            runtimeSupport: bun.runtimeSupport,
            backend: rootBackend,
          });
          recipes.push(serviceRecipe);
        } else {
          recipes.push(await planPrivateDirectRun({ request, runtimeSupport, backend: rootBackend }));
        }
      }
      if (serviceRecipe === undefined) throw new Error("mixed project has no Service recipe");
      const planning = createPrivateActivationPlanningObservation({
        policyDigest: testDigest("mixed-composition-policy"),
        mechanismDigest: recipes[0]!.mechanismDigest,
        entries: requests.map((request, index) => ({
          target: request.target,
          requestDigest: request.digest,
          disposition: { state: "planned" as const, observation: recipes[index]!.observation },
        })),
      });
      const candidate = createPrivateActivationCandidateV5(
        aggregate,
        resolveRetainedPackageProjectObservation(aggregate, planning),
        recipes,
      );
      await publishPrivateActivationCandidate({ projectRoot: root, packageStoreRoot: store, candidate });
      const review = await createPrivateActivationReviewPlan({
        projectRoot: root,
        packageStoreRoot: store,
        lockMode: "update",
      });
      await applyPrivateActivationReviewPlan({
        projectRoot: root,
        packageStoreRoot: store,
        planDigest: review.planDigest,
      });
      const mixedTarget = candidate.candidate.targets.find(({ request }) =>
        request.target.kind === "binding" && request.target.id === "mixed"
      )!.request.target;

      coordinator = await openPrivateProjectCoordinator({ projectRoot: root });
      mounted = await startPrivateBunServiceMount({
        coordinator,
        projectRoot: root,
        packageStoreRoot: store,
        recipe: serviceRecipe,
        effectiveDeadlineUnixMs: Date.now() + 29_950,
      });
      controller = await attachPrivateRootAdministrationController({
        coordinator,
        projectRoot: root,
        packageStoreRoot: store,
        runTimeoutMs: 45_000,
        execute: (runId, sharedCoordinator, signal, notifyWorkAvailable) => executePrivateRootRunLaunch({
          projectRoot: root,
          packageStoreRoot: store,
          runId,
          coordinator: sharedCoordinator,
          runtimeSupport,
          backend: rootBackend,
          notifyWorkAvailable,
          serviceMount: mounted,
          signal,
        }),
      });

      const rootA = await controller.administration.startRun({
        submissionId: "mixed-root-a",
        target: mixedTarget,
        input: { full: true, ticket: "T-mixed" },
      });
      await controller.drain();
      expect(await controller.administration.runStatus(rootA)).toMatchObject({
        state: "terminal",
        terminal: {
          status: "succeeded",
          outcome: "done",
          output: {
            first: 1,
            joined: 1,
            replay: 1,
            conflict: { error: "OPERATION_CONFLICT" },
            invalid: { error: "UNAVAILABLE" },
            malformed: { error: "INVALID_RESULT" },
            child: { outcome: "done", output: { child: "T-mixed" } },
            journal: { journalPosition: 1, source: "binding:publisher" },
          },
        },
      });
      const rootB = await controller.administration.startRun({
        submissionId: "mixed-root-b",
        target: mixedTarget,
        input: { full: false, ticket: "T-second" },
      });
      await controller.drain();
      expect(await controller.administration.runStatus(rootB)).toMatchObject({
        state: "terminal",
        terminal: {
          status: "succeeded",
          outcome: "done",
          output: {
            first: 2,
            joined: 2,
            replay: 2,
            conflict: { error: "OPERATION_CONFLICT" },
            invalid: { error: "UNAVAILABLE" },
            malformed: null,
            child: null,
            journal: null,
          },
        },
      });

      const sqlite = createRequire(import.meta.url)("bun:sqlite") as any;
      const databasePath = join(root, ".jig", "private-activation-admission-v18.sqlite3");
      const database = sqlite.Database.open(
        databasePath,
        sqlite.constants.SQLITE_OPEN_READONLY | sqlite.constants.SQLITE_OPEN_NOFOLLOW,
      );
      let expectedLeaseReleases: readonly {
        readonly ownerRunId: string;
        readonly slot: string;
        readonly releaseDigest: string;
      }[] = [];
      try {
        expect(database.query(
          "SELECT count(*) AS count FROM service_invocations WHERE terminal_digest IS NOT NULL AND closure_digest IS NOT NULL",
        ).get().count).toBe(3);
        expect(database.query("SELECT count(*) AS count FROM service_invocations").get().count).toBe(3);
        expect(database.query(
          "SELECT count(*) AS count FROM service_leases WHERE release_digest IS NOT NULL",
        ).get().count).toBe(2);
        expect(database.query(
          "SELECT count(*) AS count FROM root_flow_call_closures WHERE parent_run_id = ?1",
        ).get(rootA.runId).count).toBe(1);
        expect(database.query(
          "SELECT count(*) AS count FROM root_journal_closures WHERE parent_run_id = ?1",
        ).get(rootA.runId).count).toBe(1);
        expect(database.query(
          "SELECT count(*) AS count FROM service_mount_facts WHERE mount_id = ?1 AND fact_name IN ('release','closure')",
        ).get(mounted.mountId).count).toBe(0);
        const malformedTerminal = JSON.parse(new TextDecoder().decode(database.query([
          "SELECT terminal_bytes FROM service_invocations",
          "WHERE owner_run_id = ?1 AND operation_id = 'counter-malformed'",
        ].join(" ")).get(rootA.runId).terminal_bytes)) as {
          readonly observation?: {
            readonly terminal?: { readonly status?: unknown; readonly code?: unknown };
          };
        };
        expect(malformedTerminal.observation?.terminal).toMatchObject({
          status: "failed",
          code: "INVALID_RESULT",
        });
        expectedLeaseReleases = (database.query([
          "SELECT owner_run_id, slot, release_digest FROM service_leases",
          "WHERE mount_id = ?1 ORDER BY owner_run_id, slot",
        ].join(" ")).all(mounted.mountId) as readonly {
          readonly owner_run_id: string;
          readonly slot: string;
          readonly release_digest: string;
        }[]).map((row) => ({
          ownerRunId: row.owner_run_id,
          slot: row.slot,
          releaseDigest: row.release_digest,
        }));
        for (const handle of [rootA, rootB]) {
          const release = JSON.parse(new TextDecoder().decode(database.query(
            "SELECT release_bytes FROM root_execution_lifecycles WHERE run_id = ?1",
          ).get(handle.runId).release_bytes)) as {
            readonly value?: {
              readonly kind?: unknown;
              readonly childClosureDigest?: unknown;
              readonly journalClosureDigest?: unknown;
              readonly serviceClosureDigest?: unknown;
            };
          };
          expect(release.value?.kind).toBe("private-direct-root-release/2");
          expect(release.value?.serviceClosureDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
          if (handle.runId === rootA.runId) {
            expect(release.value?.childClosureDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
            expect(release.value?.journalClosureDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
          } else {
            expect(release.value?.childClosureDigest).toBeNull();
            expect(release.value?.journalClosureDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
          }
        }
      } finally { database.close(true); }

      await controller.dispose();
      controller = undefined;
      const fenced = await mounted.fence();
      expect(fenced.fence?.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(fenced.release).toBeUndefined();
      expect(fenced.closure).toBeUndefined();
      const closed = await mounted.stop();
      expect(closed.release?.value.leaseReleases).toEqual(expectedLeaseReleases);
      expect(closed.closure?.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
      mounted = undefined;
      await coordinator.dispose();
      coordinator = undefined;

      await writeFile(
        join(mixed, "FLOW.md"),
        (await readFile(join(mixed, "FLOW.md"), "utf8")).replace(
          "description: Uses one exact child, Journal, and counter Service.",
          "description: Uses one exact child, Journal, and counter Service under coordinator loss.",
        ),
      );
      const lossAggregate = await retainPackageProject({
        projectRoot: root,
        storeRoot: store,
        evaluator,
      });
      const lossRequests = buildPrivateActivationRequests(lossAggregate.linked);
      const lossRecipes = [];
      for (const request of lossRequests) {
        if (request.mode === "service") {
          lossRecipes.push(await planPrivateBunService({
            request,
            packageObservation: await observePrivateBunServicePackage({
              request,
              packageStoreRoot: store,
            }),
            runtimeSupport: bun.runtimeSupport,
            backend: rootBackend,
          }));
        } else {
          lossRecipes.push(await planPrivateDirectRun({
            request,
            runtimeSupport,
            backend: rootBackend,
          }));
        }
      }
      const lossPlanning = createPrivateActivationPlanningObservation({
        policyDigest: testDigest("mixed-composition-loss-policy"),
        mechanismDigest: lossRecipes[0]!.mechanismDigest,
        entries: lossRequests.map((request, index) => ({
          target: request.target,
          requestDigest: request.digest,
          disposition: {
            state: "planned" as const,
            observation: lossRecipes[index]!.observation,
          },
        })),
      });
      const lossCandidate = createPrivateActivationCandidateV5(
        lossAggregate,
        resolveRetainedPackageProjectObservation(lossAggregate, lossPlanning),
        lossRecipes,
      );
      await publishPrivateActivationCandidate({
        projectRoot: root,
        packageStoreRoot: store,
        candidate: lossCandidate,
      });
      const lossReview = await createPrivateActivationReviewPlan({
        projectRoot: root,
        packageStoreRoot: store,
        lockMode: "update",
      });
      if (lossReview.state !== "applicable") {
        throw new Error("mixed coordinator-loss candidate did not require admission");
      }
      await applyPrivateActivationReviewPlan({
        projectRoot: root,
        packageStoreRoot: store,
        planDigest: lossReview.planDigest,
      });

      crashed = spawn(process.execPath, [
        join(import.meta.dir, "fixtures", "mixed-coordinator-loss.ts"),
        root,
        store,
      ], {
        env: {
          ...process.env,
          JIG_TEST_SCOPE: host.scope,
          JIG_TEST_BASH: host.bash,
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      const workerExit = childExit(crashed);
      crashedExit = workerExit;
      const crashedDiagnostics = collect(crashed.stderr!);
      let announcement: string;
      try {
        announcement = await firstLine(crashed.stdout!);
      } catch (error) {
        const [diagnostics, exit] = await Promise.all([crashedDiagnostics, workerExit]);
        throw new AggregateError(
          [
            error,
            new Error(`worker exit: code=${String(exit.code)} signal=${String(exit.signal)}`),
            ...(diagnostics === "" ? [] : [new Error(diagnostics.trimEnd())]),
          ],
          "mixed coordinator-loss worker exited before durable possible-dispatch",
        );
      }
      const abandoned = JSON.parse(announcement) as {
        readonly runId: string;
        readonly mountId: string;
        readonly dispatchDigest: string;
      };
      crashed.kill("SIGKILL");
      expect((await workerExit).signal).toBe("SIGKILL");
      expect(await crashedDiagnostics).toBe("");
      await waitUntil(async () => (
        (await jigCgroups(host.scope)).length === 0 &&
        (await jigPrivateDeviceDirectories()).length === 0
      ), 15_000);
      crashed = undefined;
      crashedExit = undefined;

      coordinator = await openPrivateProjectCoordinator({ projectRoot: root });
      let recoveredMounts:
        | Awaited<ReturnType<typeof recoverPrivateServiceMountFences>>
        | undefined;
      await waitUntil(async () => {
        try {
          recoveredMounts = await recoverPrivateServiceMountFences({
            coordinator: coordinator!,
            projectRoot: root,
            backend: rootBackend,
          });
          return true;
        } catch (error) {
          if (!(error instanceof PrivateLinuxFenceUnconfirmedError)) throw error;
          return false;
        }
      }, 10_000);
      expect(recoveredMounts).toHaveLength(1);
      const recoveredMount = recoveredMounts![0]!;
      expect(recoveredMount).toMatchObject({
        allocation: { mountId: abandoned.mountId },
        coordinator: "older",
        provisional: {
          value: {
            classification: "coordinator-loss",
            terminal: { status: "failed", code: "UNCERTAIN" },
          },
        },
        fence: {
          value: {
            proof: {
              kind: "enforcement-confirmed",
              receipt: { fenced: true },
            },
          },
        },
      });
      expect(recoveredMount.release).toBeUndefined();
      expect(recoveredMount.closure).toBeUndefined();

      controller = await attachPrivateRootAdministrationController({
        coordinator,
        projectRoot: root,
        packageStoreRoot: store,
        runTimeoutMs: 45_000,
        execute: (runId, sharedCoordinator, signal, notifyWorkAvailable) =>
          executePrivateRootRunLaunch({
            projectRoot: root,
            packageStoreRoot: store,
            runId,
            coordinator: sharedCoordinator,
            runtimeSupport,
            backend: rootBackend,
            notifyWorkAvailable,
            signal,
          }),
      });
      expect(await controller.administration.runStatus({ runId: abandoned.runId })).toMatchObject({
        state: "terminal",
        terminal: { status: "lost", code: "COORDINATOR_LOST" },
      });

      const recoveredInvocations = await listPrivateServiceInvocations({
        coordinator,
        projectRoot: root,
        ownerRunId: abandoned.runId,
      });
      expect(recoveredInvocations).toHaveLength(1);
      expect(recoveredInvocations[0]).toMatchObject({
        allocation: { call: { operationId: "counter-next" } },
        coordinator: "older",
        dispatch: { digest: abandoned.dispatchDigest },
        terminal: {
          value: {
            dispatchDigest: abandoned.dispatchDigest,
            observation: {
              source: "coordinator-loss",
              terminal: { status: "failed", code: "UNCERTAIN" },
            },
          },
        },
        closure: {
          value: { dispatchDigest: abandoned.dispatchDigest },
        },
      });
      const recoveredLeases = await listPrivateServiceLeases({
        coordinator,
        projectRoot: root,
        ownerRunId: abandoned.runId,
      });
      expect(recoveredLeases).toHaveLength(1);
      expect(recoveredLeases[0]).toMatchObject({
        allocation: {
          ownerRunId: abandoned.runId,
          slot: "counter",
          mountId: abandoned.mountId,
        },
        coordinator: "older",
        release: {
          value: {
            reason: "provider-lost",
            mountFenceDigest: recoveredMount.fence!.digest,
            invocations: [{
              operationId: "counter-next",
              closureDigest: recoveredInvocations[0]!.closure!.digest,
            }],
          },
        },
      });
      const expectedServiceClosureDigest = privateServiceOwnerClosureDigest({
        kind: "private-service-owner-closure/1",
        ownerRunId: abandoned.runId,
        leases: [{
          slot: "counter",
          releaseDigest: recoveredLeases[0]!.release!.digest,
        }],
      });
      const expectedJournalClosureDigest = privateRootJournalEffectsClosureDigest(
        createPrivateRootJournalEffectsClosure({
          parentRunId: abandoned.runId,
          receipts: [],
        }),
      );
      const recoveryDatabase = sqlite.Database.open(
        databasePath,
        sqlite.constants.SQLITE_OPEN_READONLY | sqlite.constants.SQLITE_OPEN_NOFOLLOW,
      );
      try {
        const release = JSON.parse(new TextDecoder().decode(recoveryDatabase.query(
          "SELECT release_bytes FROM root_execution_lifecycles WHERE run_id = ?1",
        ).get(abandoned.runId).release_bytes)) as {
          readonly value?: {
            readonly kind?: unknown;
            readonly childClosureDigest?: unknown;
            readonly journalClosureDigest?: unknown;
            readonly serviceClosureDigest?: unknown;
          };
        };
        expect(release.value).toMatchObject({
          kind: "private-direct-root-release/2",
          childClosureDigest: null,
          journalClosureDigest: expectedJournalClosureDigest,
          serviceClosureDigest: expectedServiceClosureDigest,
        });
      } finally { recoveryDatabase.close(true); }
      const awaitingFinalization = await loadPrivateServiceMount({
        coordinator,
        projectRoot: root,
        packageStoreRoot: store,
        mountId: abandoned.mountId,
      });
      expect(awaitingFinalization.release).toBeUndefined();
      expect(awaitingFinalization.closure).toBeUndefined();

      await controller.dispose();
      controller = undefined;
      const finalizedMounts = await finalizeRecoveredPrivateServiceMounts({
        coordinator,
        projectRoot: root,
      });
      expect(finalizedMounts).toHaveLength(1);
      expect(finalizedMounts[0]).toMatchObject({
        allocation: { mountId: abandoned.mountId },
        release: {
          value: {
            packageReleased: true,
            leaseReleases: [{
              ownerRunId: abandoned.runId,
              slot: "counter",
              releaseDigest: recoveredLeases[0]!.release!.digest,
            }],
          },
        },
        closure: { digest: expect.any(String) },
      });
      await coordinator.dispose();
      coordinator = undefined;

      expect(await jigCgroups(host.scope)).toEqual([]);
      expect(await listOrEmpty(join(root, ".jig", "private-root-materializations"))).toEqual([]);
      expect(await listOrEmpty(join(root, ".jig", "private-root-linux-owners"))).toEqual([]);
      expect(await jigPrivateDeviceDirectories()).toEqual([]);
      const entropy = await stat("/dev/urandom");
      expect(entropy.mode & 0o777).toBe(0o666);
      expect(entropy.rdev).not.toBe(0);
    } finally {
      const cleanupFailures: unknown[] = [];
      if (crashed !== undefined) {
        try {
          if (crashed.exitCode === null && crashed.signalCode === null) {
            crashed.kill("SIGKILL");
          }
          await (crashedExit ?? childExit(crashed));
          await waitUntil(async () => (
            (await jigCgroups(host.scope)).length === 0 &&
            (await jigPrivateDeviceDirectories()).length === 0
          ), 15_000);
          crashed = undefined;
          crashedExit = undefined;
        } catch (error) {
          cleanupFailures.push(error);
        }
      }
      try { await controller?.dispose(); } catch (error) { cleanupFailures.push(error); }
      try { await mounted?.fence(); } catch (error) { cleanupFailures.push(error); }
      try { await mounted?.stop(); } catch (error) { cleanupFailures.push(error); }
      try { await coordinator?.dispose(); } catch (error) { cleanupFailures.push(error); }
      try {
        await waitUntil(async () => (
          (await jigCgroups(host.scope)).length === 0 &&
          (await jigPrivateDeviceDirectories()).length === 0
        ), 15_000);
      } catch (error) {
        cleanupFailures.push(error);
      }
      if (cleanupFailures.length !== 0) {
        throw new AggregateError(
          cleanupFailures,
          "mixed coordinator-loss cleanup did not reach zero residue",
        );
      }
      await rm(root, { recursive: true, force: true });
      await rm(store, { recursive: true, force: true });
    }
  }, 300_000);

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

function backendOptions(
  host: HostConfiguration,
  startupTimeoutMs?: number,
): PrivateLinuxCgroupBackendOptions {
  return {
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
  };
}

function backend(host: HostConfiguration, startupTimeoutMs?: number): PrivateLinuxCgroupBackend {
  return new PrivateLinuxCgroupBackend(backendOptions(host, startupTimeoutMs));
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

async function jigPrivateDeviceDirectories(): Promise<string[]> {
  return (await readdir("/dev")).filter(
    (name) => name.startsWith(".jig-jig-run-") && name.endsWith("-devices"),
  ).sort();
}

async function waitForRootFlowCallFact(
  databasePath: string,
  parentRunId: string,
  factName: string,
  timeoutMs = 20_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (await countRootFlowCallFact(databasePath, parentRunId, factName) !== 1) {
    if (Date.now() >= deadline) {
      throw new Error(`child Flow did not record ${factName} before timeout`);
    }
    await Bun.sleep(50);
  }
}

async function countRootFlowCallFact(
  databasePath: string,
  parentRunId: string,
  factName: string,
): Promise<number> {
  return await queryAdmissionCount(databasePath, [
    "SELECT count(*) AS count FROM root_flow_call_facts",
    "WHERE parent_run_id = ?1 AND fact_name = ?2",
  ].join(" "), parentRunId, factName);
}

async function countRootFlowCallClosures(
  databasePath: string,
  parentRunId: string,
): Promise<number> {
  return await queryAdmissionCount(
    databasePath,
    "SELECT count(*) AS count FROM root_flow_call_closures WHERE parent_run_id = ?1",
    parentRunId,
  );
}

async function waitForRootJournalAppends(
  databasePath: string,
  parentRunId: string,
  expected: number,
  timeoutMs = 20_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (await rootJournalAppendCount(databasePath, parentRunId) !== expected) {
    if (Date.now() >= deadline) {
      throw new Error(`root Run did not commit ${expected} Journal appends before timeout`);
    }
    await Bun.sleep(50);
  }
}

async function rootJournalAppendCount(
  databasePath: string,
  parentRunId: string,
): Promise<number> {
  return await queryAdmissionCount(
    databasePath,
    "SELECT count(*) AS count FROM root_journal_appends WHERE parent_run_id = ?1",
    parentRunId,
  );
}

async function waitForHookDerivedRun(
  databasePath: string,
  parentRunId: string,
  operationId: string,
  timeoutMs = 20_000,
): Promise<{
  readonly runId: string;
  readonly eventId: string;
  readonly event: unknown;
}> {
  const deadline = Date.now() + timeoutMs;
  const sqlite = createRequire(import.meta.url)("bun:sqlite") as any;
  while (true) {
    let database: any;
    try {
      database = sqlite.Database.open(
        databasePath,
        sqlite.constants.SQLITE_OPEN_READONLY | sqlite.constants.SQLITE_OPEN_NOFOLLOW,
      );
      const rows = database.query([
        "SELECT hook_derivations.run_id, journal_events.event_id, journal_events.event_bytes",
        "FROM root_journal_appends",
        "JOIN journal_events ON journal_events.position = root_journal_appends.event_position",
        "JOIN hook_derivations ON hook_derivations.event_id = journal_events.event_id",
        "WHERE root_journal_appends.parent_run_id = ?1 AND root_journal_appends.operation_id = ?2",
      ].join(" ")).all(parentRunId, operationId) as readonly {
        readonly run_id: string;
        readonly event_id: string;
        readonly event_bytes: Uint8Array;
      }[];
      if (rows.length === 1) {
        return Object.freeze({
          runId: rows[0]!.run_id,
          eventId: rows[0]!.event_id,
          event: JSON.parse(new TextDecoder().decode(rows[0]!.event_bytes)),
        });
      }
      if (rows.length > 1) throw new Error("Hook Event selected more than one identical derivation");
    } catch (error) {
      if ((error as { readonly code?: unknown }).code !== "SQLITE_BUSY") throw error;
    } finally {
      database?.close(true);
    }
    if (Date.now() >= deadline) throw new Error("Hook Event did not allocate its exact derived Run");
    await Bun.sleep(50);
  }
}

async function waitForTerminalRootRun(
  projectRoot: string,
  runId: string,
  timeoutMs: number,
): Promise<Awaited<ReturnType<typeof loadPrivateRootRun>>> {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    const run = await retryAdmissionBusy(() => loadPrivateRootRun({ projectRoot, runId }));
    if (run.state === "terminal") return run;
    if (Date.now() >= deadline) throw new Error("Hook-derived Run did not settle before timeout");
    await Bun.sleep(50);
  }
}

async function waitForRootExecutionPrepared(
  databasePath: string,
  runId: string,
  timeoutMs = 20_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (await queryAdmissionCount(databasePath, [
    "SELECT count(*) AS count FROM root_execution_lifecycles",
    "WHERE run_id = ?1 AND prepared_digest IS NOT NULL",
  ].join(" "), runId) !== 1) {
    if (Date.now() >= deadline) throw new Error("Hook-derived Run did not reach preparation before timeout");
    await Bun.sleep(50);
  }
}

async function hookDerivationCount(databasePath: string, eventId: string): Promise<number> {
  return await queryAdmissionCount(
    databasePath,
    "SELECT count(*) AS count FROM hook_derivations WHERE event_id = ?1",
    eventId,
  );
}

async function queryAdmissionCount(
  databasePath: string,
  query: string,
  ...parameters: readonly string[]
): Promise<number> {
  const sqlite = createRequire(import.meta.url)("bun:sqlite") as any;
  for (let attempt = 1; attempt <= 20; attempt += 1) {
    let database: any;
    try {
      database = sqlite.Database.open(
        databasePath,
        sqlite.constants.SQLITE_OPEN_READONLY | sqlite.constants.SQLITE_OPEN_NOFOLLOW,
      );
      return database.query(query).get(...parameters).count;
    } catch (error) {
      if ((error as { readonly code?: unknown }).code !== "SQLITE_BUSY" || attempt === 20) throw error;
      await Bun.sleep(attempt * 5);
    } finally {
      database?.close(true);
    }
  }
  throw new Error("unreachable admission count retry state");
}

async function listOrEmpty(path: string): Promise<string[]> {
  try {
    return (await readdir(path)).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
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
