import { beforeAll, describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { access, readFile, readdir, realpath, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { canonicalJson, type JsonValue } from "../src/json.js";
import { privateDomainDigest, privateFileDigest } from "../src/internal/identity.js";
import { queryPrivateNixClosure } from "../src/internal/private-nix-store.js";
import {
  decodePrivatePythonLinuxHostGeneration,
  encodePrivatePythonLinuxHostGeneration,
  observePrivatePythonLinuxHostGeneration,
  requirePrivatePythonLinuxHostGeneration,
  verifyPrivatePythonLinuxHostGeneration,
  type PrivatePythonLinuxHostGeneration,
} from "../src/internal/python-linux-host-generation.js";
import { observePrivatePythonNixRuntime } from "../src/internal/python-nix-runtime.js";

const hostDescribe = process.env.JIG_NIX_GENERATION_HOST === "1" ? describe : describe.skip;
const PROBE_TIMEOUT_MS = 20_000;
const MAX_PROBE_OUTPUT_BYTES = 1024 * 1024;

hostDescribe("private Python/Linux host generation", () => {
  let generation: PrivatePythonLinuxHostGeneration;
  let expectedRuntimeDigest: string;
  let expectedRuntimeClosureCount: number;
  let visibleStores: readonly string[];
  let coordinatorSourceDigest: string;
  let helperSourceDigest: string;

  beforeAll(async () => {
    const python = requiredEnvironment("JIG_TEST_PYTHON");
    const nixStore = requiredEnvironment("JIG_TEST_NIX_STORE");
    const coordinatorSource = resolve(import.meta.dir, "../dist/internal/python-linux-coordinator.bundle.js");
    const helperSource = resolve(import.meta.dir, "../dist/internal/linux-cgroup-helper.bundle.js");
    const [coordinatorPath, helperPath, runtime, bash, expectedCoordinatorDigest, expectedHelperDigest] = await Promise.all([
      addFlatStoreObject(nixStore, coordinatorSource),
      addFlatStoreObject(nixStore, helperSource),
      observePrivatePythonNixRuntime({ pythonPath: python, nixStorePath: nixStore }),
      hostBash(),
      privateFileDigest(coordinatorSource),
      privateFileDigest(helperSource),
    ]);
    coordinatorSourceDigest = expectedCoordinatorDigest;
    helperSourceDigest = expectedHelperDigest;
    expectedRuntimeDigest = runtime.digest;
    expectedRuntimeClosureCount = runtime.closureStores.length;
    generation = await observePrivatePythonLinuxHostGeneration({
      coordinatorPath,
      helperPath,
      coordinatorBunPath: "/bin/bun",
      helperBunPath: "/bin/bun",
      bubblewrapPath: "/usr/bin/bwrap",
      bashPath: bash,
      runtime,
    });
    const closureQuery = generation.roles.find((role) => role.role === "nix-store")!.path;
    const closures = await Promise.all(generation.members.map((member) => (
      queryPrivateNixClosure(closureQuery, member.storePath)
    )));
    visibleStores = Object.freeze([...new Set(closures.flat())].sort());
  }, 120_000);

  test("loads the real coordinator and helper from protected Nix members", async () => {
    const roles = Object.fromEntries(generation.roles.map((role) => [role.role, role.path]));
    expect(generation.roles.find((role) => role.role === "coordinator")!.fileDigest)
      .toBe(coordinatorSourceDigest);
    expect(generation.roles.find((role) => role.role === "helper")!.fileDigest)
      .toBe(helperSourceDigest);
    const loaded = await loadCoordinator({
      sudo: requiredEnvironment("JIG_TEST_SUDO"),
      coordinator: roles.coordinator!,
      bun: roles["coordinator-bun"]!,
      bubblewrap: roles.bubblewrap!,
      bash: roles.bash!,
      python: roles.python!,
      nixStore: roles["nix-store"]!,
      helper: roles.helper!,
      visibleStores,
    });
    expect(loaded.exports).toEqual([
      "createBackend",
      "execute",
      "observeRuntime",
      "plan",
      "privateHostExtensionAbi",
    ]);
    expect(loaded.abi).toBe("jig-private-python-linux-coordinator/1");
    expect(loaded.runtimeKind).toBe("python-nix-runtime-observation/1");
    expect(loaded.runtimeDigest).toBe(expectedRuntimeDigest);
    expect(loaded.closureCount).toBe(expectedRuntimeClosureCount);
    expect(loaded.intentBoundary).toBe("noncanonical-intent-rejected");
    expect(loaded.planBoundary).toBe("backend-brand-rejected");
    expect(loaded.backendConstructed).toBe(true);

    const helper = await loadHelper({
      sudo: requiredEnvironment("JIG_TEST_SUDO"),
      helper: roles.helper!,
      bun: roles["helper-bun"]!,
      bubblewrap: roles.bubblewrap!,
      bash: roles.bash!,
      visibleStores,
    });
    expect(helper.code).toBe(70);
    expect(helper.signal).toBeNull();
    expect(helper.stdout).toBe("");
    expect(helper.stderr).toContain("jig cgroup helper failed:");
    expect(helper.stderr).toContain("missing helper argument --scope");
    expect(helper.stderr).not.toContain("requires uid 0");
    expect(helper.stderr).not.toContain("requires fixed cwd");
    expect(helper.stderr).not.toContain("requires an empty environment");
    expect(helper.stderr).not.toContain("requires the fixed Bun policy");

    const nonRoot = await loadHelper({
      sudo: requiredEnvironment("JIG_TEST_SUDO"),
      helper: roles.helper!,
      bun: roles["helper-bun"]!,
      bubblewrap: roles.bubblewrap!,
      bash: roles.bash!,
      visibleStores,
    }, { uid: 1000, gid: 100 });
    expect(nonRoot.code).toBe(70);
    expect(nonRoot.stderr).toContain("requires uid 0");

    const wrongCwd = await loadHelper({
      sudo: requiredEnvironment("JIG_TEST_SUDO"),
      helper: roles.helper!,
      bun: roles["helper-bun"]!,
      bubblewrap: roles.bubblewrap!,
      bash: roles.bash!,
      visibleStores,
    }, { cwd: "/tmp" });
    expect(wrongCwd.code).toBe(70);
    expect(wrongCwd.stderr).toContain("requires fixed cwd /");

    const ambient = await loadHelper({
      sudo: requiredEnvironment("JIG_TEST_SUDO"),
      helper: roles.helper!,
      bun: roles["helper-bun"]!,
      bubblewrap: roles.bubblewrap!,
      bash: roles.bash!,
      visibleStores,
    }, { environment: { JIG_HELPER_PROBE: "must-reject" } });
    expect(ambient.code).toBe(70);
    expect(ambient.stderr).toContain("requires an empty environment");

    const policyDrift = await loadHelper({
      sudo: requiredEnvironment("JIG_TEST_SUDO"),
      helper: roles.helper!,
      bun: roles["helper-bun"]!,
      bubblewrap: roles.bubblewrap!,
      bash: roles.bash!,
      visibleStores,
    }, { extraBunArguments: ["--smol"] });
    expect(policyDrift.code).toBe(70);
    expect(policyDrift.stderr).toContain("requires the fixed Bun policy");
  }, 120_000);

  test("runs one benign envelope through the bundled Backend and helper", async () => {
    const roles = Object.fromEntries(generation.roles.map((role) => [role.role, role.path]));
    const scope = await delegatedCgroupScope();
    const before = await jigCgroups(scope);
    const coordinator = await import(roles.coordinator!);
    const backend = coordinator.createBackend({
      cgroupScope: scope,
      sudoPath: requiredEnvironment("JIG_TEST_SUDO"),
      bunPath: roles["helper-bun"]!,
      bubblewrapPath: roles.bubblewrap!,
      bashPath: roles.bash!,
      helperPath: roles.helper!,
      payloadUid: 1000,
      payloadGid: 100,
    });
    const mechanism = await backend.observeMechanism();
    expect(mechanism.trustedBackendPath).toBe(roles.coordinator);
    expect(mechanism.trustedHelperPath).toBe(roles.helper);
    const component = await backend.launch({
      runId: "bundle-canary",
      limits: {
        memoryBytes: 64 * 1024 * 1024,
        pids: 8,
        cpuQuotaMicros: 50_000,
        cpuPeriodMicros: 100_000,
        wallClockMs: 2_000,
        cleanupTimeoutMs: 5_000,
      },
      readOnlyMounts: visibleStores.map((store) => ({ source: store, destination: store })),
      command: [roles.bash!, "-c", "printf 'bundle-canary\\n'"],
      environment: {},
      rootProcessMappings: false,
      entropyDevice: false,
      expectedMechanismDigest: mechanism.digest,
      trustedHelperPath: roles.helper!,
    });
    const stdout = collect(component.stdout);
    const stderr = collect(component.stderr);
    await component.closeInput();
    const completion = await component.completion;
    expect(await stdout).toBe("bundle-canary\n");
    expect(await stderr).toBe("");
    expect(completion).toEqual({ exitCode: 0, signal: null, fenced: true });
    expect(await component.terminationReason).toBe("payload_exit");
    expect(await component.evidence).toMatchObject({
      memoryEvents: { max: 0 },
      pidsEvents: { max: 0 },
    });
    await expect(access(component.cgroup.parentCgroup)).rejects.toBeDefined();
    expect(await jigCgroups(scope)).toEqual(before);
  }, 120_000);

  test("closes the fixed role set over sorted unique flat and directory members", async () => {
    expect(generation.kind).toBe("python-linux-host-generation/1");
    expect(generation.roles.map((role) => role.role)).toEqual([
      "coordinator",
      "helper",
      "coordinator-bun",
      "helper-bun",
      "python",
      "bubblewrap",
      "nix-store",
      "bash",
    ]);
    expect(generation.members.map((member) => member.storePath)).toEqual(
      [...generation.members.map((member) => member.storePath)].sort(),
    );
    expect(new Set(generation.members.map((member) => member.storePath)).size).toBe(generation.members.length);
    expect(generation.members.length).toBeLessThan(generation.roles.length);
    const coordinator = generation.roles[0]!;
    const helper = generation.roles[1]!;
    expect((await stat(coordinator.storePath)).isFile()).toBe(true);
    expect((await stat(helper.storePath)).isFile()).toBe(true);
    expect(generation.members.find((member) => member.storePath === coordinator.storePath)?.roles)
      .toContain("coordinator");
    expect(generation.members.find((member) => member.storePath === helper.storePath)?.roles)
      .toContain("helper");
    for (const member of generation.members) {
      expect(member.closureCount).toBeGreaterThan(0);
      expect(member.closureDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    }
    expect(await verifyPrivatePythonLinuxHostGeneration(generation)).toBe(generation);
  }, 120_000);

  test("strictly round-trips canonical inert bytes without granting lookalikes", async () => {
    const encoded = encodePrivatePythonLinuxHostGeneration(generation);
    expect(encoded.at(-1)).toBe(0x0a);
    const decoded = decodePrivatePythonLinuxHostGeneration(encoded);
    expect(decoded).toEqual(generation);
    expect(decoded).not.toBe(generation);
    expect(() => requirePrivatePythonLinuxHostGeneration(decoded)).toThrow(
      "host generation was not produced",
    );
    expect(() => requirePrivatePythonLinuxHostGeneration({ ...generation })).toThrow(
      "host generation was not produced",
    );

    const noncanonical = Buffer.concat([Buffer.from(" "), Buffer.from(encoded)]);
    expect(() => decodePrivatePythonLinuxHostGeneration(noncanonical)).toThrow(
      "not canonically encoded",
    );

    const changedDigest = Buffer.from(encoded);
    const digestStart = changedDigest.indexOf(Buffer.from("sha256:")) + 7;
    changedDigest[digestStart] = changedDigest[digestStart] === 0x30 ? 0x31 : 0x30;
    expect(() => decodePrivatePythonLinuxHostGeneration(changedDigest)).toThrow(
      "digest does not match",
    );

    const parsed = JSON.parse(Buffer.from(encoded.subarray(0, -1)).toString("utf8")) as Record<string, JsonValue>;
    parsed.roles = (parsed.roles as JsonValue[]).slice(0, -1);
    expect(() => decodePrivatePythonLinuxHostGeneration(withLf(canonicalJson(parsed)))).toThrow(
      "role set is incomplete",
    );
  }, 120_000);
});

async function addFlatStoreObject(nixStore: string, source: string): Promise<string> {
  const executable = await realpath(nixStore);
  const result = await invoke(executable, [
    "--store", "daemon",
    "--option", "substitute", "false",
    "--option", "fallback", "false",
    "--add", source,
  ], "nix-store");
  if (result.code !== 0) throw new Error(`could not add flat host fixture: ${result.stderr.trim()}`);
  const path = result.stdout.trim();
  if (!path.startsWith("/nix/store/")) throw new Error("nix-store --add returned an invalid path");
  return path;
}

interface CoordinatorLoadResult {
  readonly exports: readonly string[];
  readonly abi: string;
  readonly runtimeKind: string;
  readonly runtimeDigest: string;
  readonly closureCount: number;
  readonly intentBoundary: "noncanonical-intent-rejected";
  readonly planBoundary: "backend-brand-rejected";
  readonly backendConstructed: true;
}

async function loadCoordinator(options: {
  readonly sudo: string;
  readonly coordinator: string;
  readonly bun: string;
  readonly bubblewrap: string;
  readonly bash: string;
  readonly python: string;
  readonly nixStore: string;
  readonly helper: string;
  readonly visibleStores: readonly string[];
}): Promise<CoordinatorLoadResult> {
  const intent = planningIntent("flows/bundle-probe", `sha256:${"a".repeat(64)}`);
  const script = `
const module = await import(${JSON.stringify(options.coordinator)});
const names = Object.keys(module).sort();
const expected = ["createBackend", "execute", "observeRuntime", "plan", "privateHostExtensionAbi"];
if (JSON.stringify(names) !== JSON.stringify(expected)) throw new Error("unexpected coordinator exports");
if (module.privateHostExtensionAbi !== "jig-private-python-linux-coordinator/1") throw new Error("unexpected coordinator ABI");
for (const name of ["createBackend", "execute", "observeRuntime", "plan"]) {
  if (typeof module[name] !== "function") throw new Error("coordinator operation is not callable: " + name);
}
const runtime = await module.observeRuntime({
  pythonPath: ${JSON.stringify(options.python)},
  nixStorePath: ${JSON.stringify(options.nixStore)},
});
const planningIntent = Uint8Array.from(${JSON.stringify([...intent])});
const planInput = {
  storeRoot: "/unreachable",
  runtime,
  backend: {},
  policyDigest: "sha256:${"b".repeat(64)}",
  sandboxLimits: {
    memoryBytes: 1,
    pids: 1,
    cpuQuotaMicros: 1,
    cpuPeriodMicros: 1,
    wallClockMs: 1,
    cleanupTimeoutMs: 1,
  },
  runHostLimits: {
    cancellationGraceMs: 0,
    stdoutBytes: ${16 * 1024 * 1024 + 1},
    stderrBytes: 0,
    capturedStderrBytes: 0,
  },
};
let intentBoundary;
try {
  await module.plan({
    ...planInput,
    request: Uint8Array.from([0x20, ...planningIntent]),
  });
  throw new Error("noncanonical intent unexpectedly reached live planning");
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes("not canonically encoded")) throw error;
  intentBoundary = "noncanonical-intent-rejected";
}
let planBoundary;
try {
  await module.plan({
    ...planInput,
    request: planningIntent,
  });
  throw new Error("foreign backend unexpectedly reached planning");
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes("Linux Backend mechanism was not produced")) throw error;
  planBoundary = "backend-brand-rejected";
}
let missingHelperRejected = false;
try {
  module.createBackend({});
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes("requires an exact helperPath")) throw error;
  missingHelperRejected = true;
}
if (!missingHelperRejected) throw new Error("coordinator accepted an implicit helper path");
const backend = module.createBackend({
  cgroupScope: "/sys/fs/cgroup/not-mounted-in-inspection",
  sudoPath: "/not-mounted/sudo",
  bunPath: ${JSON.stringify(options.bun)},
  bubblewrapPath: ${JSON.stringify(options.bubblewrap)},
  bashPath: ${JSON.stringify(options.bash)},
  helperPath: ${JSON.stringify(options.helper)},
  payloadUid: 1000,
  payloadGid: 100,
});
if (typeof backend.launch !== "function" || typeof backend.observeMechanism !== "function") {
  throw new Error("coordinator did not construct its Backend");
}
process.stdout.write(JSON.stringify({
  exports: names,
  abi: module.privateHostExtensionAbi,
  runtimeKind: runtime.kind,
  runtimeDigest: runtime.digest,
  closureCount: runtime.closureStores.length,
  intentBoundary,
  planBoundary,
  backendConstructed: true,
}) + "\\n");
`;
  const result = await fixedInspectionSandbox(options, [
    options.bun,
    "--no-env-file",
    "--no-install",
    "--config=/dev/null",
    "--eval",
    script,
  ], options.visibleStores);
  if (result.code !== 0) {
    throw new Error(`coordinator load probe failed (${result.code ?? result.signal}): ${result.stderr}`);
  }
  if (!result.stdout.endsWith("\n") || result.stdout.indexOf("\n") !== result.stdout.length - 1) {
    throw new Error("coordinator load probe did not produce one JSON line");
  }
  return JSON.parse(result.stdout) as CoordinatorLoadResult;
}

async function loadHelper(options: {
  readonly sudo: string;
  readonly helper: string;
  readonly bun: string;
  readonly bubblewrap: string;
  readonly bash: string;
  readonly visibleStores: readonly string[];
}, posture: {
  readonly uid?: number;
  readonly gid?: number;
  readonly cwd?: string;
  readonly environment?: Readonly<Record<string, string>>;
  readonly extraBunArguments?: readonly string[];
} = {}): Promise<Awaited<ReturnType<typeof fixedRootBash>>> {
  return fixedInspectionSandbox(options, [
    options.bun,
    ...(posture.extraBunArguments ?? []),
    "--no-env-file",
    "--no-install",
    "--config=/dev/null",
    options.helper,
  ], options.visibleStores, posture);
}

async function fixedInspectionSandbox(
  options: { readonly sudo: string; readonly bubblewrap: string; readonly bash: string },
  command: readonly string[],
  visibleStores: readonly string[],
  posture: {
    readonly uid?: number;
    readonly gid?: number;
    readonly cwd?: string;
    readonly environment?: Readonly<Record<string, string>>;
  } = {},
): Promise<Awaited<ReturnType<typeof fixedRootBash>>> {
  const storeMounts = visibleStores.flatMap((store) => ["--ro-bind", store, store]);
  const environment = Object.entries(posture.environment ?? {}).flatMap(([name, value]) => [
    "--setenv", name, value,
  ]);
  if ((posture.uid === undefined) !== (posture.gid === undefined)) {
    throw new TypeError("inspection identity requires both uid and gid");
  }
  const identity = posture.uid === undefined && posture.gid === undefined
    ? []
    : ["--uid", String(posture.uid!), "--gid", String(posture.gid!)];
  return fixedRootBash(options.sudo, options.bash, [
    options.bubblewrap,
    "--unshare-all",
    "--as-pid-1",
    "--die-with-parent",
    "--new-session",
    "--clearenv",
    "--dev", "/dev",
    "--proc", "/proc",
    "--tmpfs", "/tmp",
    "--tmpfs", "/run",
    "--dir", "/etc",
    "--ro-bind", "/etc/passwd", "/etc/passwd",
    "--dir", "/nix",
    "--dir", "/nix/store",
    ...storeMounts,
    "--dir", "/nix/var",
    "--dir", "/nix/var/nix",
    "--ro-bind", "/nix/var/nix/daemon-socket", "/nix/var/nix/daemon-socket",
    "--tmpfs", "/home",
    "--chdir", posture.cwd ?? "/",
    ...environment,
    ...identity,
    "--cap-drop", "ALL",
    "--",
    options.bash,
    "--noprofile",
    "--norc",
    "-p",
    "-c",
    posture.environment === undefined ? 'exec -c -- "$@"' : 'exec -- "$@"',
    "jig-inspection-payload",
    ...command,
  ]);
}

async function fixedRootBash(
  sudo: string,
  bash: string,
  command: readonly string[],
): Promise<{ readonly code: number | null; readonly signal: string | null; readonly stdout: string; readonly stderr: string }> {
  return invoke(await realpath(sudo), [
    "-n",
    "--",
    bash,
    "--noprofile",
    "--norc",
    "-p",
    "-c",
    'cd -- / && exec -c -- "$@"',
    "jig-host-bundle-probe",
    ...command,
  ]);
}

async function hostBash(): Promise<string> {
  const wrapper = await realpath("/bin/sh");
  const first = (await readFile(wrapper, "utf8")).split("\n", 1)[0]!;
  if (!first.startsWith("#!/")) throw new Error("host did not expose the expected Bash shebang");
  return first.slice(2);
}

async function delegatedCgroupScope(): Promise<string> {
  const relative = (await readFile("/proc/self/cgroup", "utf8")).trim().split(":").at(-1)!;
  return dirname(await realpath(`/sys/fs/cgroup${relative}`));
}

async function jigCgroups(scope: string): Promise<readonly string[]> {
  return (await readdir(scope)).filter((name) => name.startsWith("jig-run-")).sort();
}

async function invoke(
  executable: string,
  arguments_: readonly string[],
  argv0?: string,
): Promise<{ readonly code: number | null; readonly signal: string | null; readonly stdout: string; readonly stderr: string }> {
  const child = spawn(executable, [...arguments_], {
    ...(argv0 === undefined ? {} : { argv0 }),
    cwd: "/",
    detached: true,
    env: Object.create(null) as NodeJS.ProcessEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let timedOut = false;
  const terminate = (): void => {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      // The leader may already have exited or changed process groups.
    }
    try {
      child.kill("SIGKILL");
    } catch {
      // Close remains the authoritative completion fence.
    }
  };
  child.stdout!.on("data", (chunk: Buffer) => {
    stdoutBytes += chunk.byteLength;
    if (stdoutBytes <= MAX_PROBE_OUTPUT_BYTES) stdoutChunks.push(Buffer.from(chunk));
    else terminate();
  });
  child.stderr!.on("data", (chunk: Buffer) => {
    stderrBytes += chunk.byteLength;
    if (stderrBytes <= MAX_PROBE_OUTPUT_BYTES) stderrChunks.push(Buffer.from(chunk));
    else terminate();
  });
  const close = await new Promise<{ readonly code: number | null; readonly signal: string | null }>((resolve, reject) => {
    const timer = setTimeout(() => {
      timedOut = true;
      terminate();
    }, PROBE_TIMEOUT_MS);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
  if (stdoutBytes > MAX_PROBE_OUTPUT_BYTES || stderrBytes > MAX_PROBE_OUTPUT_BYTES) {
    throw new Error("host-generation probe exceeded its output limit");
  }
  if (timedOut) throw new Error("host-generation probe exceeded its deadline");
  let stdout: string;
  let stderr: string;
  try {
    const decoder = new TextDecoder("utf-8", { fatal: true });
    stdout = decoder.decode(Buffer.concat(stdoutChunks, stdoutBytes));
    stderr = decoder.decode(Buffer.concat(stderrChunks, stderrBytes));
  } catch {
    throw new Error("host-generation probe produced invalid UTF-8");
  }
  return Object.freeze({ ...close, stdout, stderr });
}

async function collect(source: AsyncIterable<Uint8Array>): Promise<string> {
  let result = "";
  for await (const chunk of source) result += Buffer.from(chunk).toString("utf8");
  return result;
}

function withLf(value: Uint8Array): Uint8Array {
  const result = new Uint8Array(value.byteLength + 1);
  result.set(value);
  result[result.length - 1] = 0x0a;
  return result;
}

function planningIntent(packagePath: string, digest: string): Uint8Array {
  return withLf(canonicalJson({
    kind: "python-exact-planning-intent/1",
    requestDigest: privateDomainDigest("JIG-Activation-Request/1", {
      kind: "activation-request/1",
      target: { kind: "flow", path: packagePath },
      mode: "run",
      packagePath,
      package: { kind: "flow-package/1", digest },
      entrypoint: { path: "flow.py", suffix: "py" },
      settings: {},
      attachments: {},
      slots: {},
    }),
    packagePath,
    package: { kind: "flow-package/1", digest },
  }));
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined) throw new Error(`${name} is required for the host-generation proof`);
  return value;
}
