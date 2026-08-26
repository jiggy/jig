import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { canonicalJson, type JsonValue } from "../src/json.js";
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

hostDescribe("private Python/Linux host generation", () => {
  let sourceRoot: string;
  let generation: PrivatePythonLinuxHostGeneration;

  beforeAll(async () => {
    const python = requiredEnvironment("JIG_TEST_PYTHON");
    const nixStore = requiredEnvironment("JIG_TEST_NIX_STORE");
    sourceRoot = await mkdtemp(join(tmpdir(), "jig-host-generation-"));
    const coordinatorSource = join(sourceRoot, "python-linux-coordinator.bundle.js");
    const helperSource = join(sourceRoot, "linux-cgroup-helper.bundle.js");
    await Promise.all([
      writeFile(coordinatorSource, "export const privateHostExtensionAbi = 'jig-private-python-linux-coordinator/1';\n"),
      writeFile(helperSource, "throw new Error('synthetic helper fixture');\n"),
    ]);
    const [coordinatorPath, helperPath, runtime, bash] = await Promise.all([
      addFlatStoreObject(nixStore, coordinatorSource),
      addFlatStoreObject(nixStore, helperSource),
      observePrivatePythonNixRuntime({ pythonPath: python, nixStorePath: nixStore }),
      hostBash(),
    ]);
    generation = await observePrivatePythonLinuxHostGeneration({
      coordinatorPath,
      helperPath,
      coordinatorBunPath: "/bin/bun",
      helperBunPath: "/bin/bun",
      bubblewrapPath: "/usr/bin/bwrap",
      bashPath: bash,
      runtime,
    });
  }, 120_000);

  afterAll(async () => {
    if (sourceRoot !== undefined) await rm(sourceRoot, { recursive: true });
  });

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
  ]);
  if (result.code !== 0) throw new Error(`could not add flat host fixture: ${result.stderr.trim()}`);
  const path = result.stdout.trim();
  if (!path.startsWith("/nix/store/")) throw new Error("nix-store --add returned an invalid path");
  return path;
}

async function hostBash(): Promise<string> {
  const wrapper = await realpath("/bin/sh");
  const first = (await readFile(wrapper, "utf8")).split("\n", 1)[0]!;
  if (!first.startsWith("#!/")) throw new Error("host did not expose the expected Bash shebang");
  return first.slice(2);
}

async function invoke(
  executable: string,
  arguments_: readonly string[],
): Promise<{ readonly code: number | null; readonly stdout: string; readonly stderr: string }> {
  const child = spawn(executable, [...arguments_], {
    argv0: "nix-store",
    cwd: "/",
    env: Object.create(null) as NodeJS.ProcessEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const [stdout, stderr, code] = await Promise.all([
    collect(child.stdout!),
    collect(child.stderr!),
    new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    }),
  ]);
  return Object.freeze({ code, stdout, stderr });
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

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined) throw new Error(`${name} is required for the host-generation proof`);
  return value;
}
