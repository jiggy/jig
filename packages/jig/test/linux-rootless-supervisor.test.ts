import { describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const POLICY = ["--no-env-file", "--no-install", "--config=/dev/null"] as const;
const SUPERVISOR = fileURLToPath(
  new URL("../src/internal/linux-rootless-supervisor.ts", import.meta.url),
);
const DIGEST_A = `sha256:${"a".repeat(64)}`;
const DIGEST_B = `sha256:${"b".repeat(64)}`;
const DIGEST_C = `sha256:${"c".repeat(64)}`;
const OWNER_TOKEN = "d".repeat(64);

describe("private rootless Linux supervisor admission boundary", () => {
  test("exits when its coordinator connects but never sends a start message", async () => {
    const fixture = await fixtureFor("missing-start");
    try {
      const result = await invokeSupervisor(fixture.configuration, [], {
        sendStart: false,
        startupTimeoutMs: 50,
      });

      expect(result).toMatchObject({
        code: 70,
        signal: null,
        control: "",
        stdout: "",
      });
      expect(result.stderr).toContain("rootless supervisor start timed out");
      await expectMissing(join(fixture.ownerStateDirectory, "claim.json"));
      await expectMissing(fixture.runCgroup);
      await expectMissing(fixture.marker);
    } finally {
      await fixture.dispose();
    }
  });

  test("rejects a malformed limit before claiming or creating a cgroup", async () => {
    const fixture = await fixtureFor("invalid-limit");
    try {
      await writeOwner(fixture, fixture.configuration);
      const malformed = {
        ...fixture.configuration,
        limits: {
          ...fixture.configuration.limits,
          memoryBytes: "max",
        },
      };

      const result = await invokeSupervisor(malformed);

      expect(result).toMatchObject({
        code: 70,
        signal: null,
        control: "",
        stdout: "",
      });
      expect(result.stderr).toContain("invalid rootless supervisor configuration");
      await expectMissing(join(fixture.ownerStateDirectory, "claim.json"));
      await expectMissing(fixture.runCgroup);
      await expectMissing(fixture.marker);
    } finally {
      await fixture.dispose();
    }
  });

  test("rejects configuration which does not match its durable owner", async () => {
    const fixture = await fixtureFor("owner-mismatch");
    try {
      await writeOwner(fixture, {
        ...fixture.configuration,
        ownerDigest: DIGEST_C,
      });

      const result = await invokeSupervisor(fixture.configuration);

      expect(result).toMatchObject({
        code: 70,
        signal: null,
        control: "",
        stdout: "",
      });
      expect(result.stderr).toContain("rootless owner-state record is invalid");
      await expectMissing(join(fixture.ownerStateDirectory, "claim.json"));
      await expectMissing(fixture.runCgroup);
      await expectMissing(fixture.marker);
    } finally {
      await fixture.dispose();
    }
  });

  test("an existing active claim rejects a duplicate launch before mutation", async () => {
    const fixture = await fixtureFor("duplicate-active");
    try {
      await writeOwner(fixture, fixture.configuration);
      const claim = {
        allocationDigest: fixture.configuration.ownerStateAllocationDigest,
        kind: "private-linux-owner-claim/1",
        state: "active",
        token: fixture.configuration.ownerToken,
      };
      await writeFile(
        join(fixture.ownerStateDirectory, "claim.json"),
        `${JSON.stringify(claim)}\n`,
        { mode: 0o600 },
      );

      // Queue admission as well as the start. A broken claim guard therefore
      // cannot pass merely because the test withheld permission to execute.
      const result = await invokeSupervisor(fixture.configuration, [{ type: "admit" }]);

      expect(result).toMatchObject({
        code: 70,
        signal: null,
        control: "",
        stdout: "",
      });
      expect(result.stderr).toContain("rootless owner claim is already active");
      expect(JSON.parse(await readFile(join(fixture.ownerStateDirectory, "claim.json"), "utf8")))
        .toEqual(claim);
      await expectMissing(fixture.runCgroup);
      await expectMissing(fixture.marker);
    } finally {
      await fixture.dispose();
    }
  });
});

interface Configuration {
  readonly delegatedCgroup: string;
  readonly runCgroup: string;
  readonly ownerStateDirectory: string;
  readonly ownerStateAllocationDigest: string;
  readonly ownerToken: string;
  readonly ownerDigest: string;
  readonly mechanismDigest: string;
  readonly sealedPlanDigest: string;
  readonly limits: {
    readonly memoryBytes: number;
    readonly pids: number;
    readonly cpuQuotaMicros: number;
    readonly cpuPeriodMicros: number;
    readonly deadlineUnixMs: number;
    readonly cancellationGraceMs: number;
    readonly cleanupTimeoutMs: number;
  };
  readonly readOnlyMounts: readonly [];
  readonly command: readonly [string, ...string[]];
  readonly environment: Readonly<Record<string, string>>;
  readonly network: "isolated";
  readonly bunPath: string;
  readonly bunHostLibraryPath: string;
  readonly bubblewrapPath: string;
  readonly payloadUid: number;
  readonly payloadGid: number;
  readonly supervisorPath: string;
}

interface Fixture {
  readonly root: string;
  readonly ownerStateDirectory: string;
  readonly runCgroup: string;
  readonly marker: string;
  readonly configuration: Configuration;
  dispose(): Promise<void>;
}

async function fixtureFor(runId: string): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "jig-rootless-supervisor-test-"));
  await chmod(root, 0o700);
  const ownerStateDirectory = join(root, "owner");
  await mkdir(ownerStateDirectory, { mode: 0o700 });
  const marker = join(root, "payload-ran");
  const bunPath = await realpath("/bin/bun");
  const bunHostLibraryPath = dirname(await realpath("/lib64/ld-linux-x86-64.so.2"));
  const delegatedCgroup = `/sys/fs/cgroup/jig-supervisor-test-${randomBytes(8).toString("hex")}`;
  const runCgroup = `${delegatedCgroup}/jig-run-${runId}-${randomBytes(12).toString("hex")}`;
  const configuration: Configuration = {
    delegatedCgroup,
    runCgroup,
    ownerStateDirectory,
    ownerStateAllocationDigest: DIGEST_A,
    ownerToken: OWNER_TOKEN,
    ownerDigest: DIGEST_B,
    mechanismDigest: DIGEST_A,
    sealedPlanDigest: DIGEST_C,
    limits: {
      memoryBytes: 64 * 1024 * 1024,
      pids: 16,
      cpuQuotaMicros: 10_000,
      cpuPeriodMicros: 100_000,
      deadlineUnixMs: Date.now() + 2_000,
      cancellationGraceMs: 100,
      cleanupTimeoutMs: 100,
    },
    readOnlyMounts: [],
    command: [
      bunPath,
      ...POLICY,
      "-e",
      `await Bun.write(${JSON.stringify(marker)}, "ran")`,
    ],
    environment: {},
    network: "isolated",
    bunPath,
    bunHostLibraryPath,
    bubblewrapPath: "/usr/bin/bwrap",
    payloadUid: process.getuid?.() ?? 1_000,
    payloadGid: process.getgid?.() ?? 100,
    supervisorPath: SUPERVISOR,
  };
  return {
    root,
    ownerStateDirectory,
    runCgroup,
    marker,
    configuration,
    dispose: async () => await rm(root, { recursive: true, force: true }),
  };
}

async function writeOwner(fixture: Fixture, configuration: Configuration): Promise<void> {
  await writeFile(join(fixture.ownerStateDirectory, "owner.json"), `${JSON.stringify({
    allocationDigest: configuration.ownerStateAllocationDigest,
    kind: "private-linux-owner-state/1",
    mechanismDigest: configuration.mechanismDigest,
    ownerDigest: configuration.ownerDigest,
    runCgroup: configuration.runCgroup,
    sealedPlanDigest: configuration.sealedPlanDigest,
    token: configuration.ownerToken,
  })}\n`, { mode: 0o600 });
}

async function invokeSupervisor(
  configuration: unknown,
  messages: readonly unknown[] = [],
  options: {
    readonly sendStart?: boolean;
    readonly startupTimeoutMs?: number;
  } = {},
): Promise<{
  readonly code: number | null;
  readonly signal: string | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly control: string;
}> {
  const controlDirectory = await mkdtemp(join(tmpdir(), "jig-rootless-supervisor-control-"));
  const controlPath = join(controlDirectory, "control.sock");
  const server = createServer();
  await listen(server, controlPath);
  const accepted = acceptOne(server);
  const bunPath = await realpath("/bin/bun");
  const child = spawn(bunPath, [
    ...POLICY,
    SUPERVISOR,
    "--supervisor",
    controlPath,
    String(options.startupTimeoutMs ?? 1_000),
  ], {
    cwd: "/",
    detached: true,
    env: {
      LD_LIBRARY_PATH: dirname(await realpath("/lib64/ld-linux-x86-64.so.2")),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdout = collect(child.stdout!);
  const stderr = collect(child.stderr!);
  let socket: Socket | undefined;
  try {
    socket = await accepted;
    server.close();
    if (options.sendStart !== false) {
      socket.write(`${JSON.stringify({ type: "start", configuration })}\n`);
      for (const message of messages) socket.write(`${JSON.stringify(message)}\n`);
    }
    const control = collect(socket);
    const exit = await withTimeout(childClose(child), 2_000, "rootless supervisor rejection");
    return {
      ...exit,
      stdout: await stdout,
      stderr: await stderr,
      control: await control,
    };
  } finally {
    socket?.destroy();
    child.kill("SIGKILL");
    await closeServer(server);
    await rm(controlDirectory, { recursive: true, force: true });
  }
}

async function expectMissing(path: string): Promise<void> {
  await expect(lstat(path)).rejects.toMatchObject({ code: "ENOENT" });
}

function listen(server: Server, path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(path, resolve);
  });
}

function acceptOne(server: Server): Promise<Socket> {
  return new Promise((resolve, reject) => {
    server.once("connection", resolve);
    server.once("error", reject);
  });
}

function childClose(child: ReturnType<typeof spawn>): Promise<{
  readonly code: number | null;
  readonly signal: string | null;
}> {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
}

async function withTimeout<T>(promise: Promise<T>, milliseconds: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out`)), milliseconds);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function collect(stream: NodeJS.ReadableStream): Promise<string> {
  let result = "";
  for await (const chunk of stream) result += String(chunk);
  return result;
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!server.listening) return resolve();
    server.close((error) => error === undefined ? resolve() : reject(error));
  });
}
