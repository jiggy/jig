import { describe, expect, test } from "bun:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { ExactComponentExit, ExactComponentProcess } from "../src/run/session.js";
import { ServiceHostSession } from "../src/service/session.js";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const typescriptFixture = join(testDirectory, "fixtures", "service-provider.ts");
const pythonFixture = join(testDirectory, "fixtures", "service-provider.py");
const counterFixture = join(testDirectory, "fixtures", "service-counter.ts");
const maliciousFixture = join(testDirectory, "fixtures", "service-malicious.ts");
const pythonSource = join(testDirectory, "..", "..", "flowmd-sdk", "src");

describe("private Service/1 process integration", () => {
  for (const provider of providers()) {
    test(`drives a real ${provider.name} Provider through mount, calls, and cleanup`, async () => {
      const process = spawnProvider(provider.command, provider.environment);
      const service = new ServiceHostSession(process, {
        settings: {},
        attachments: {},
        scratch: "/scratch",
        startupDeadlineUnixMs: Date.now() + 5_000,
        exports: ["sessions"],
      });
      await service.start();

      expect(await service.invoke({
        exportName: "sessions",
        method: "read",
        input: { session: "s-1" },
        deadlineUnixMs: Date.now() + 5_000,
      })).toEqual({
        status: "succeeded",
        value: { input: { session: "s-1" } },
      });

      expect(await service.invoke({
        exportName: "sessions",
        method: "missing",
        input: { session: "s-2" },
        deadlineUnixMs: Date.now() + 5_000,
      })).toEqual({
        status: "application-error",
        name: "not-found",
        data: { session: "s-2" },
      });

      expect(await service.invoke({
        exportName: "sessions",
        method: "dependency",
        input: { key: "s-3" },
        deadlineUnixMs: Date.now() + 5_000,
      })).toMatchObject({
        status: "failed",
        code: "UNAVAILABLE",
      });

      expect(await service.stop()).toMatchObject({
        status: "succeeded",
        diagnostics: { stderrBytes: 0 },
      });
    });
  }

  test("keeps Service state across sequential invocations", async () => {
    const service = new ServiceHostSession(
      spawnProvider([process.execPath, "run", counterFixture], {}),
      {
        settings: {},
        attachments: {},
        scratch: "/scratch",
        startupDeadlineUnixMs: Date.now() + 5_000,
        exports: ["counter"],
      },
    );
    await service.start();

    expect(await service.invoke({
      exportName: "counter",
      method: "next",
      input: null,
      deadlineUnixMs: Date.now() + 5_000,
    })).toEqual({ status: "succeeded", value: 1 });
    expect(await service.invoke({
      exportName: "counter",
      method: "next",
      input: null,
      deadlineUnixMs: Date.now() + 5_000,
    })).toEqual({ status: "succeeded", value: 2 });

    expect(await service.stop()).toMatchObject({
      status: "succeeded",
      diagnostics: { stderrBytes: 0 },
    });
  });

  for (const [scenario, code] of [
    ["trailing-frame", "PROTOCOL_ERROR"],
    ["partial-frame", "PROTOCOL_ERROR"],
    ["nonzero-exit", "EXECUTION_FAILED"],
  ] as const) {
    test(`rejects ${scenario} after a valid Mount response`, async () => {
      const service = new ServiceHostSession(
        spawnProvider([process.execPath, "run", maliciousFixture, scenario], {}),
        activation(),
      );
      await service.start();
      expect(await service.stop()).toMatchObject({ status: "failed", code });
    });
  }

  test("classifies a Provider crash before readiness as channel loss", async () => {
    const service = new ServiceHostSession(
      spawnProvider([process.execPath, "run", maliciousFixture, "crash-before-ready"], {}),
      activation(),
    );
    await expect(service.start()).rejects.toThrow("CHANNEL_LOST");
    expect(await service.result()).toMatchObject({ status: "failed", code: "CHANNEL_LOST" });
  });

  test("loses a pending invocation when its Provider crashes", async () => {
    const service = new ServiceHostSession(
      spawnProvider([process.execPath, "run", maliciousFixture, "crash-on-invoke"], {}),
      activation(),
    );
    await service.start();
    expect(await service.invoke({
      exportName: "sessions",
      method: "read",
      input: null,
      deadlineUnixMs: Date.now() + 5_000,
    })).toMatchObject({ status: "failed", code: "UNCERTAIN" });
    expect(await service.result()).toMatchObject({ status: "failed", code: "CHANNEL_LOST" });
  });

  test("hard-terminates a Provider which ignores Mount cancellation", async () => {
    const service = new ServiceHostSession(
      spawnProvider([process.execPath, "run", maliciousFixture, "ignore-mount-cancel"], {}),
      activation(),
      { cancellationGraceMs: 20 },
    );
    await service.start();
    expect(await service.stop()).toMatchObject({ status: "failed", code: "EXECUTION_FAILED" });
  });
});

function activation() {
  return {
    settings: {},
    attachments: {},
    scratch: "/scratch",
    startupDeadlineUnixMs: Date.now() + 5_000,
    exports: ["sessions"],
  } as const;
}

function providers(): ReadonlyArray<{
  readonly name: string;
  readonly command: readonly string[];
  readonly environment: Readonly<Record<string, string | undefined>>;
}> {
  const python = Bun.which("python3");
  if (python === null) throw new Error("Python Provider proof requires python3");
  return [
    { name: "TypeScript", command: [process.execPath, "run", typescriptFixture], environment: {} },
    {
      name: "Python",
      command: [python, pythonFixture],
      environment: { ...process.env, PYTHONPATH: pythonSource },
    },
  ];
}

function spawnProvider(
  command: readonly string[],
  environment: Readonly<Record<string, string | undefined>>,
): ExactComponentProcess {
  const child = Bun.spawn(command, {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: environment,
  });
  const completion = child.exited.then((exitCode): ExactComponentExit => ({
    exitCode,
    signal: null,
    fenced: true,
  }));
  return {
    stdout: child.stdout,
    stderr: child.stderr,
    completion,
    async write(bytes) {
      child.stdin.write(bytes);
      await child.stdin.flush();
    },
    async closeInput() {
      child.stdin.end();
    },
    async terminate() {
      child.kill();
      await child.exited;
    },
  };
}
