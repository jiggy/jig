import { describe, expect, test } from "bun:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { ExactComponentExit, ExactComponentProcess } from "../src/run/session.js";
import { ServiceHostSession } from "../src/service/session.js";

const fixture = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "service-provider.ts");

describe("private Service/1 process integration", () => {
  test("drives a real TypeScript Provider through mount, calls, and cleanup", async () => {
    const process = spawnProvider();
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
});

function spawnProvider(): ExactComponentProcess {
  const child = Bun.spawn([process.execPath, "run", fixture], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: {},
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
