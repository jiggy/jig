import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import { openPrivateProjectSession } from "../src/internal/project-session-controller.js";
import { openAgentSandboxProofHost } from "../scripts/private-proof-host.js";
import { tmpdir } from "node:os";

const HOSTILE = process.env.JIG_LINUX_CGROUP_HOSTILE === "1";
const proofDescribe = HOSTILE ? describe.serial : describe.skip;

describe("private foreground command boundary", () => {
  test("requires explicit approval separately from a reviewed Plan", async () => {
    const failure = await invokeFailure([
      "apply",
      ".",
      "--plan",
      `sha256:${"0".repeat(64)}`,
    ]);
    expect(failure).toContain("apply requires explicit --yes approval");
  });

  test("does not combine admission and root execution", async () => {
    expect(await invokeFailure(["run", ".", "--request"])).toContain(
      "--request requires a value",
    );
    expect(await invokeFailure(["apply-run"])).toContain(
      "usage: private-foreground",
    );
  });
});

proofDescribe("private foreground project path", () => {
  test("reviews, applies, and runs one direct Python and one composed Bun-to-Python target", async () => {
    const root = await mkdtemp(join(tmpdir(), "jig-private-foreground-"));
    const alias = `${root}-symlink`;
    try {
      await writeProject(root);
      await symlink(root, alias);
      const symlinkFailure = await invokeFailure(["plan", alias]);
      expect(JSON.parse(symlinkFailure)).toEqual({
        code: "PROJECT_UNSAFE",
        message: "project directory or protected state is unsafe",
      });
      expect(symlinkFailure).not.toContain(root);
      const planned = await invoke([
        "plan",
        root,
      ]) as {
        kind: string;
        state: string;
        planDigest: string;
        operation: string;
        review: { mediaType: string; text: string };
      };
      expect(planned).toMatchObject({
        kind: "private-foreground-plan/1",
        state: "applicable",
        operation: "admission",
      });
      expect(planned.review.mediaType).toBe("text/plain; charset=utf-8");
      expect(planned.review.text).toContain('"id": "parent"');
      expect(planned.review.text).toContain('"path": "flows/child"');
      expect(planned.review.text).not.toContain(root);
      expect(planned.review.text).not.toContain("recipeDigest");

      const recoveredPlan = await invoke(["plan", root]) as typeof planned;
      expect(recoveredPlan).toEqual(planned);
      await expect(readFile(join(root, "jig.lock"))).rejects.toMatchObject({ code: "ENOENT" });
      expect(inspectPlanningState(root)).toEqual({
        candidateRevision: 1,
        candidates: 1,
        plans: 1,
        admissions: 0,
        repairs: 0,
        rootRuns: 0,
        planDigest: planned.planDigest,
      });
      await writeFile(
        join(root, "flows", "child", "flow.py"),
        "raise RuntimeError('run must use the retained reviewed package')\n",
      );

      const applied = await invoke([
        "apply",
        root,
        "--plan",
        planned.planDigest,
        "--yes",
      ]) as {
        kind: string;
        planDigest: string;
        operation: string;
      };
      expect(applied).toMatchObject({
        kind: "private-foreground-apply/1",
        planDigest: planned.planDigest,
        operation: "admission",
      });

      const closingSession = await openPrivateProjectSession({
        directory: root,
        host: await openAgentSandboxProofHost(),
      });
      const acceptedApply = closingSession.apply({ planDigest: planned.planDigest });
      const closing = closingSession.close();
      expect(await acceptedApply).toEqual({
        operation: applied.operation,
        planDigest: applied.planDigest,
      });
      await closing;

      await writeFile(join(root, "jig.ts"), "throw new Error('apply must not evaluate source');\n");
      expect(await invoke([
        "apply",
        root,
        "--plan",
        planned.planDigest,
        "--yes",
      ])).toEqual(applied);
      await writeProjectDeclaration(root);

      const ran = await invoke([
        "run",
        root,
        "--request",
        JSON.stringify({
          submissionId: "foreground-direct",
          target: { kind: "flow", path: "flows/child" },
          input: { ticket: "direct" },
        }),
        "--request",
        JSON.stringify({
          submissionId: "foreground-composed",
          target: { kind: "binding", id: "parent" },
          input: { ticket: "composed" },
        }),
      ]) as {
        kind: string;
        runs: readonly { submissionId: string; status: unknown }[];
      };
      expect(ran).toMatchObject({
        kind: "private-foreground-run/1",
        runs: [
          {
            submissionId: "foreground-direct",
            status: {
              state: "terminal",
              terminal: {
                status: "succeeded",
                outcome: "done",
                output: { child: { ticket: "direct" } },
              },
            },
          },
          {
            submissionId: "foreground-composed",
            status: {
              state: "terminal",
              terminal: {
                status: "succeeded",
                outcome: "done",
                output: {
                  parent: "bun",
                  child: {
                    outcome: "done",
                    output: { child: { ticket: "composed" } },
                  },
                },
              },
            },
          },
        ],
      });

      const cancellationSession = await openPrivateProjectSession({
        directory: root,
        host: await openAgentSandboxProofHost(),
      });
      const cancelledReceipt = await cancellationSession.rootAdministration.startRun({
        submissionId: "foreground-close-cancel",
        target: { kind: "flow", path: "flows/child" },
        input: { ticket: "cancelled", delayMs: 20_000 },
      });
      await waitForPrepared(root, cancelledReceipt.runId);
      const escapedAdministration = cancellationSession.rootAdministration;
      await cancellationSession.close();
      await expect(escapedAdministration.runStatus(cancelledReceipt)).rejects.toMatchObject({
        code: "PROJECT_CLOSED",
      });
      const cancellationRecovery = await openPrivateProjectSession({
        directory: root,
        host: await openAgentSandboxProofHost(),
      });
      expect(await cancellationRecovery.rootAdministration.runStatus(cancelledReceipt)).toMatchObject({
        state: "terminal",
        terminal: { status: "failed", code: "CANCELLED" },
      });
      await cancellationRecovery.close();

      const crashed = Bun.spawn([
        process.execPath,
        join(import.meta.dir, "fixtures", "project-session-runner.ts"),
        root,
        "foreground-session-crash",
      ], { stdout: "pipe", stderr: "pipe" });
      const crashDiagnostics = new Response(crashed.stderr).text();
      const crashedReceipt = JSON.parse(await firstLine(crashed.stdout)) as { readonly runId: string };
      await waitForPrepared(root, crashedReceipt.runId).catch(async (error) => {
        crashed.kill("SIGKILL");
        await crashed.exited;
        throw new Error(`${String(error)}: ${await crashDiagnostics}`);
      });
      crashed.kill("SIGKILL");
      expect(await crashed.exited).toBe(137);
      const crashRecovery = await openPrivateProjectSession({
        directory: root,
        host: await openAgentSandboxProofHost(),
      });
      expect(await crashRecovery.rootAdministration.runStatus(crashedReceipt)).toMatchObject({
        state: "terminal",
        terminal: { status: "lost", code: "COORDINATOR_LOST" },
      });
      await crashRecovery.close();

      await writeFile(join(root, "jig.ts"), [
        "while (true) {}",
        "export default {};",
        "",
      ].join("\n"));
      const planningSession = await openPrivateProjectSession({
        directory: root,
        host: await openAgentSandboxProofHost(),
      });
      const interruptedPlan = planningSession.plan({ lockMode: "update" });
      await waitForAnyJigCgroup();
      const interruptedClose = planningSession.close();
      await expect(interruptedPlan).rejects.toMatchObject({ code: "PROJECT_CLOSED" });
      await interruptedClose;
      await writeProjectDeclaration(root);

      await writeFile(join(root, "flows", "child", "flow.py"), pythonChildProgram());
      await rm(join(root, "jig.lock"));
      const repairPlan = await invoke(["plan", root]) as {
        state: string;
        planDigest: string;
        operation: string;
      };
      expect(repairPlan).toMatchObject({ state: "applicable", operation: "lock-repair" });
      const repaired = await invoke([
        "apply",
        root,
        "--plan",
        repairPlan.planDigest,
        "--yes",
      ]) as { kind: string; operation: string };
      expect(repaired).toMatchObject({
        kind: "private-foreground-apply/1",
        operation: "lock-repair",
      });

      await rm(join(root, "flows", "child", "flow.py"));
      await writeFile(
        join(root, "flows", "child", "flow.sh"),
        "#!/usr/bin/env sh\nprintf '%s\\n' unsupported\n",
      );
      const unsupportedRuntime = await invokeFailure(["plan", root]);
      expect(JSON.parse(unsupportedRuntime)).toEqual({
        code: "UNAVAILABLE",
        message: "project target has no available exact execution recipe",
      });
      expect(unsupportedRuntime).not.toContain(root);

      await rm(join(root, "flows", "child", "flow.sh"));
      await writeFile(join(root, "flows", "child", "flow.py"), pythonChildProgram());
      const service = join(root, "flows", "service");
      await mkdir(service);
      await writeFile(join(service, "FLOW.md"), [
        "---",
        "name: unsupported-service",
        "description: Deliberately outside the finite project-session slice.",
        "service: 1",
        "---",
        "",
      ].join("\n"));
      await writeFile(join(service, "flow.ts"), "#!/usr/bin/env bun\n");
      await writeFile(join(root, "bindings", "service.ts"), [
        'import { defineBinding } from "@jigging/jig";',
        'export default defineBinding({ package: "flows/service" });',
        "",
      ].join("\n"));
      const unsupportedService = await invokeFailure(["plan", root]);
      expect(JSON.parse(unsupportedService)).toEqual({
        code: "UNAVAILABLE",
        message: "project target requires a host execution mode which is not available",
      });
      expect(unsupportedService).not.toContain(root);
      expect(await residualCgroups()).toEqual([]);
      expect((await readdir("/dev")).filter(
        (name) => name.startsWith(".jig-jig-run-") && name.endsWith("-devices"),
      )).toEqual([]);
    } finally {
      await rm(alias, { force: true });
      await rm(root, { recursive: true, force: true });
    }
  }, 300_000);
});

async function writeProject(root: string): Promise<void> {
  await mkdir(join(root, "bindings"));
  await mkdir(join(root, "flows", "parent"), { recursive: true });
  await mkdir(join(root, "flows", "child"), { recursive: true });
  await writeProjectDeclaration(root);
  await writeFile(join(root, "bindings", "parent.ts"), [
    'import { defineBinding, flowRef } from "@jigging/jig";',
    "export default defineBinding({",
    '  package: "flows/parent",',
    '  settings: { marker: "reviewed" },',
    '  slots: { child: flowRef("flows/child") },',
    "});",
    "",
  ].join("\n"));

  const parent = join(root, "flows", "parent");
  await writeFile(join(parent, "FLOW.md"), [
    "---",
    "name: foreground-parent",
    "description: Calls one exact Python child from a contained Bun Run.",
    "---",
    "",
  ].join("\n"));
  await writeFile(join(parent, "settings.schema.json"), JSON.stringify({
    $schema: "https://flow.dev/schemas/schema-1.json",
    type: "object",
    properties: { marker: { const: "reviewed" } },
    required: ["marker"],
    additionalProperties: false,
  }));
  await writeFile(join(parent, "flow.ts"), [
    "#!/usr/bin/env bun",
    'import { serve } from "./flow-sdk/index.ts";',
    "",
    "await serve(async (context) => ({",
    '  outcome: "done",',
    "  output: {",
    '    parent: "bun",',
    "    child: await context.callFlow({",
    '      operationId: "foreground-child",',
    '      slot: "child",',
    "      input: context.input,",
    "    }),",
    "  },",
    "}));",
    "",
  ].join("\n"));
  const typescriptSdk = join(parent, "flow-sdk");
  await mkdir(typescriptSdk);
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
      join(typescriptSdk, name),
      await readFile(join(import.meta.dir, "..", "..", "flow-sdk", "src", name)),
    );
  }

  const child = join(root, "flows", "child");
  await writeFile(join(child, "FLOW.md"), [
    "---",
    "name: foreground-child",
    "description: Returns its input from a contained Python Run.",
    "---",
    "",
  ].join("\n"));
  await writeFile(join(child, "input.schema.json"), JSON.stringify({
    $schema: "https://flow.dev/schemas/schema-1.json",
    type: "object",
    properties: {
      ticket: { type: "string" },
      delayMs: { type: "number", minimum: 0, maximum: 20_000 },
    },
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
        properties: { child: {} },
        required: ["child"],
        additionalProperties: false,
      },
    },
    required: ["outcome", "output"],
    additionalProperties: false,
  }));
  await writeFile(join(child, "flow.py"), pythonChildProgram());
  const pythonSdk = join(child, "flowmd_sdk");
  await mkdir(pythonSdk);
  for (const name of ["__init__.py", "_json.py", "_runtime.py", "_service.py", "_types.py"]) {
    await writeFile(
      join(pythonSdk, name),
      await readFile(join(import.meta.dir, "..", "..", "flowmd-sdk", "src", "flowmd_sdk", name)),
    );
  }
}

async function writeProjectDeclaration(root: string): Promise<void> {
  await writeFile(join(root, "jig.ts"), [
    'import { defineJig, discover } from "@jigging/jig";',
    'export default defineJig({ flows: discover("flows"), bindings: discover("bindings") });',
    "",
  ].join("\n"));
}

function pythonChildProgram(): string {
  return [
    "#!/usr/bin/env python",
    "import asyncio",
    "from flowmd_sdk import serve",
    "",
    "async def run(context):",
    '    delay_ms = context.input.get("delayMs", 0) if isinstance(context.input, dict) else 0',
    "    if isinstance(delay_ms, (int, float)) and delay_ms > 0:",
    "        await asyncio.sleep(delay_ms / 1000)",
    '    return {"outcome": "done", "output": {"child": context.input}}',
    "",
    "serve(run)",
    "",
  ].join("\n");
}

async function invoke(arguments_: readonly string[]): Promise<unknown> {
  const subprocess = Bun.spawn([
    process.execPath,
    join(import.meta.dir, "..", "scripts", "private-foreground.ts"),
    ...arguments_,
  ], {
    cwd: join(import.meta.dir, "..", "..", ".."),
    env: process.env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(subprocess.stdout).text(),
    new Response(subprocess.stderr).text(),
    subprocess.exited,
  ]);
  if (exitCode !== 0) throw new Error(`private foreground failed (${exitCode}): ${stderr}`);
  expect(stderr).toBe("");
  return JSON.parse(stdout);
}

async function invokeFailure(arguments_: readonly string[]): Promise<string> {
  const subprocess = Bun.spawn([
    process.execPath,
    join(import.meta.dir, "..", "scripts", "private-foreground.ts"),
    ...arguments_,
  ], {
    cwd: join(import.meta.dir, "..", "..", ".."),
    env: process.env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(subprocess.stdout).text(),
    new Response(subprocess.stderr).text(),
    subprocess.exited,
  ]);
  expect(exitCode).not.toBe(0);
  expect(stdout).toBe("");
  return stderr;
}

async function residualCgroups(): Promise<string[]> {
  const relative = (await readFile("/proc/self/cgroup", "utf8")).trim().split(":").at(-1)!;
  const self = await realpath(`/sys/fs/cgroup${relative}`);
  return (await readdir(dirname(self))).filter((name) => name.startsWith("jig-run-")).sort();
}

function inspectPlanningState(root: string): {
  readonly candidateRevision: number;
  readonly candidates: number;
  readonly plans: number;
  readonly admissions: number;
  readonly repairs: number;
  readonly rootRuns: number;
  readonly planDigest: string;
} {
  const sqlite = createRequire(import.meta.url)("bun:sqlite") as any;
  const database = sqlite.Database.open(
    join(root, ".jig", "private-activation-admission-v17.sqlite3"),
    sqlite.constants.SQLITE_OPEN_READONLY | sqlite.constants.SQLITE_OPEN_NOFOLLOW,
  );
  try {
    const scalar = (query: string, field: string): unknown => database.query(query).get()[field];
    return {
      candidateRevision: Number(scalar(
        "SELECT revision FROM candidate_head WHERE singleton = 1",
        "revision",
      )),
      candidates: Number(scalar("SELECT count(*) AS count FROM candidates", "count")),
      plans: Number(scalar("SELECT count(*) AS count FROM review_plans", "count")),
      admissions: Number(scalar("SELECT count(*) AS count FROM admissions", "count")),
      repairs: Number(scalar("SELECT count(*) AS count FROM lock_repairs", "count")),
      rootRuns: Number(scalar("SELECT count(*) AS count FROM root_runs", "count")),
      planDigest: String(scalar("SELECT plan_digest FROM review_plans", "plan_digest")),
    };
  } finally {
    database.close(true);
  }
}

async function waitForPrepared(root: string, runId: string): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const sqlite = createRequire(import.meta.url)("bun:sqlite") as any;
    let database: any;
    try {
      database = sqlite.Database.open(
        join(root, ".jig", "private-activation-admission-v17.sqlite3"),
        sqlite.constants.SQLITE_OPEN_READONLY | sqlite.constants.SQLITE_OPEN_NOFOLLOW,
      );
      const row = database.query([
        "SELECT count(*) AS count FROM root_execution_lifecycles",
        "WHERE run_id = ?1 AND prepared_digest IS NOT NULL",
      ].join(" ")).get(runId);
      if (Number(row.count) === 1) return;
    } catch (error) {
      if ((error as { readonly code?: unknown }).code !== "SQLITE_BUSY") throw error;
    } finally {
      database?.close(true);
    }
    await Bun.sleep(50);
  }
  throw new Error("root Run did not reach the prepared ownership boundary");
}

async function waitForAnyJigCgroup(): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if ((await residualCgroups()).length > 0) return;
    await Bun.sleep(20);
  }
  throw new Error("evaluator did not enter the cgroup envelope before cancellation");
}

async function firstLine(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) throw new Error("project-session fixture ended before its receipt");
      buffered += decoder.decode(next.value, { stream: true });
      const newline = buffered.indexOf("\n");
      if (newline !== -1) return buffered.slice(0, newline);
    }
  } finally {
    reader.releaseLock();
  }
}
