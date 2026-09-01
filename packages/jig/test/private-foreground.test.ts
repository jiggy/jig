import { describe, expect, test } from "bun:test";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { openPrivateProjectSession } from "../src/internal/project-session-controller.js";
import { openPrivateInstalledBunHost } from "../src/internal/installed-bun-host.js";

const HOSTILE = process.env.JIG_LINUX_ROOTLESS_HOSTILE === "1";
const proofDescribe = HOSTILE ? describe.serial : describe.skip;
const installedExecutable = join(import.meta.dir, "..", "bin", "jig");
const initialRootlessTemporaryState = new Set(
  (await readdir(tmpdir())).filter(rootlessTemporaryEntry),
);
const initialRootlessCgroups = new Set(await rootlessCgroups());

describe("private foreground command boundary", () => {
  test("requires explicit approval separately from a reviewed Plan", async () => {
    const failure = await invokeFailure([
      "apply", ".", "--plan", `sha256:${"0".repeat(64)}`,
    ]);
    expect(failure).toContain("apply requires explicit --yes approval");
  });

  test("does not combine admission and root execution", async () => {
    expect(await invokeFailure(["run", ".", "--request"])).toContain(
      "--request requires a value",
    );
    expect(await invokeFailure(["apply-run"])).toContain("usage: private-foreground");
  });
});

proofDescribe("private rootless project session", () => {
  test("preserves one bounded malformed-source diagnostic through a real session", async () => {
    const root = await mkdtemp(join(tmpdir(), "jig-private-diagnostic-"));
    let session: Awaited<ReturnType<typeof openPrivateProjectSession>> | undefined;
    try {
      const malformed = join(root, "flows", "malformed");
      await mkdir(malformed, { recursive: true });
      await writeFile(join(root, "jig.ts"), [
        'import { defineJig, discover } from "@jigging/jig";',
        'export default defineJig({ flows: discover("flows") });',
        "",
      ].join("\n"));
      await writeFile(join(malformed, "FLOW.md"), "not Metadata/1\n");

      session = await openPrivateProjectSession({
        directory: root,
        host: await openPrivateInstalledBunHost(installedExecutable),
      });
      const failure = await session.plan({ lockMode: "update" })
        .then(() => undefined, (error) => error);
      expect(failure).toMatchObject({
        code: "INVALID_CANDIDATE",
        message: "project candidate is invalid",
        diagnostic: {
          code: "METADATA_DELIMITER",
          path: "flows/malformed/FLOW.md",
        },
      });
      expect(JSON.stringify(failure)).not.toContain(root);
      expect(JSON.stringify(failure)).not.toContain("not Metadata/1");
    } finally {
      await session?.close().catch(() => undefined);
      await rm(root, { recursive: true, force: true });
    }
  });

  test("reviews, admits, executes, replays, cancels, and recovers one exact Bun Flow", async () => {
    const root = await mkdtemp(join(tmpdir(), "jig-private-foreground-"));
    try {
      await writeProject(root);

      const planned = await invoke(["plan", root]) as ApplicablePlan;
      expect(planned).toMatchObject({
        kind: "private-foreground-plan/1",
        state: "applicable",
        operation: "admission",
      });
      expect(planned.review.mediaType).toBe("text/plain; charset=utf-8");
      expect(planned.review.text).toContain('"path": "flows/worker"');
      expect(planned.review.text).not.toContain(root);
      expect(planned.review.text).not.toContain("recipeDigest");

      await expect(readFile(join(root, "jig.lock"))).rejects.toMatchObject({ code: "ENOENT" });
      expect(inspectPlanningState(root)).toEqual({
        candidateRevision: 1,
        candidates: 1,
        plans: 1,
        admissions: 0,
        rootRuns: 0,
        planDigest: planned.planDigest,
      });

      // Applying retained review bytes must not re-evaluate mutable source.
      await writeFile(
        join(root, "flows", "worker", "flow.ts"),
        "throw new Error('Run must use the retained reviewed package');\n",
      );
      expect(await invoke([
        "apply", root, "--plan", planned.planDigest, "--yes",
      ])).toEqual({
        kind: "private-foreground-apply/1",
        operation: "admission",
        planDigest: planned.planDigest,
      });

      const directRequest = {
        submissionId: "foreground-direct",
        target: { kind: "flow", path: "flows/worker" },
        input: { ticket: "direct" },
      } as const;
      const ran = await invoke([
        "run", root,
        "--request", JSON.stringify(directRequest),
        "--request", JSON.stringify(directRequest),
      ]) as ForegroundRunResult;
      expect(ran.kind).toBe("private-foreground-run/1");
      expect(ran.runs).toHaveLength(2);
      expect(ran.runs[0]!.receipt).toEqual(ran.runs[1]!.receipt);
      for (const run of ran.runs) {
        expect(run).toMatchObject({
          submissionId: "foreground-direct",
          status: {
            state: "terminal",
            terminal: {
              status: "succeeded",
              outcome: "done",
              output: { worker: { ticket: "direct" } },
            },
          },
        });
      }
      expect(inspectPlanningState(root).rootRuns).toBe(1);

      expect(JSON.parse(await invokeFailure([
        "run", root,
        "--request", JSON.stringify({ ...directRequest, input: { ticket: "changed" } }),
      ]))).toMatchObject({ code: "SUBMISSION_CONFLICT" });
      expect(inspectPlanningState(root).rootRuns).toBe(1);

      const cancellationSession = await openPrivateProjectSession({
        directory: root,
        host: await openPrivateInstalledBunHost(installedExecutable),
      });
      const cancellationRequest = {
        submissionId: "foreground-close-cancel",
        target: { kind: "flow" as const, path: "flows/worker" },
        input: { ticket: "cancelled", delayMs: 20_000 },
      };
      const cancelledReceipt = await cancellationSession.rootAdministration.startRun(
        cancellationRequest,
      );
      await waitForPrepared(root, cancelledReceipt.runId);
      const escapedAdministration = cancellationSession.rootAdministration;
      await cancellationSession.close();
      await expect(escapedAdministration.runStatus(cancelledReceipt)).rejects.toMatchObject({
        code: "PROJECT_CLOSED",
      });

      const cancellationRecovery = await openPrivateProjectSession({
        directory: root,
        host: await openPrivateInstalledBunHost(installedExecutable),
      });
      expect(await cancellationRecovery.rootAdministration.startRun(cancellationRequest))
        .toEqual(cancelledReceipt);
      expect(await cancellationRecovery.rootAdministration.runStatus(cancelledReceipt)).toMatchObject({
        state: "terminal",
        terminal: { status: "failed", code: "CANCELLED" },
      });
      await cancellationRecovery.close();

      const crashRequest = {
        submissionId: "foreground-session-crash",
        target: { kind: "flow" as const, path: "flows/worker" },
        input: { ticket: "foreground-session-crash", delayMs: 20_000 },
      };
      const crashed = Bun.spawn([
        process.execPath,
        join(import.meta.dir, "fixtures", "project-session-runner.ts"),
        root,
        crashRequest.submissionId,
      ], { stdout: "pipe", stderr: "pipe" });
      const crashDiagnostics = new Response(crashed.stderr).text();
      const crashedReceipt = JSON.parse(await firstLine(crashed.stdout)) as { readonly runId: string };
      await waitForPrepared(root, crashedReceipt.runId).catch(async (error) => {
        crashed.kill("SIGKILL");
        await crashed.exited;
        throw new Error(`${String(error)}: ${await crashDiagnostics}`);
      });
      const beforeRecovery = inspectRootExecution(root, crashedReceipt.runId);
      crashed.kill("SIGKILL");
      expect(await crashed.exited).toBe(137);
      await waitForRootlessCgroups(initialRootlessCgroups);

      const crashRecovery = await openPrivateProjectSession({
        directory: root,
        host: await openPrivateInstalledBunHost(installedExecutable),
      });
      expect(await crashRecovery.rootAdministration.startRun(crashRequest)).toEqual(crashedReceipt);
      expect(await crashRecovery.rootAdministration.runStatus(crashedReceipt)).toMatchObject({
        state: "terminal",
        terminal: { status: "lost", code: "COORDINATOR_LOST" },
      });
      expect(inspectRootExecution(root, crashedReceipt.runId)).toMatchObject({
        sandboxDigest: beforeRecovery.sandboxDigest,
        preparedDigest: beforeRecovery.preparedDigest,
        rows: 1,
      });
      await crashRecovery.close();

      // Closing the recovered session releases exclusive project authority.
      const reopened = await openPrivateProjectSession({
        directory: root,
        host: await openPrivateInstalledBunHost(installedExecutable),
      });
      await reopened.close();
      await waitForRootlessCgroups(initialRootlessCgroups);
      await waitForRootlessTemporaryState(initialRootlessTemporaryState);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 300_000);
});

interface ApplicablePlan {
  readonly kind: string;
  readonly state: "applicable";
  readonly operation: "admission";
  readonly planDigest: string;
  readonly review: { readonly mediaType: string; readonly text: string };
}

interface ForegroundRunResult {
  readonly kind: string;
  readonly runs: readonly {
    readonly submissionId: string;
    readonly receipt: { readonly runId: string };
    readonly status: unknown;
  }[];
}

async function writeProject(root: string): Promise<void> {
  const worker = join(root, "flows", "worker");
  await mkdir(worker, { recursive: true });
  await writeFile(join(root, "jig.ts"), [
    'import { defineJig, discover } from "@jigging/jig";',
    'export default defineJig({ flows: discover("flows") });',
    "",
  ].join("\n"));
  await writeFile(join(worker, "FLOW.md"), [
    "---",
    "name: foreground-worker",
    "description: Returns its input from one contained Bun Run.",
    "---",
    "",
  ].join("\n"));
  await writeFile(join(worker, "input.schema.json"), JSON.stringify({
    $schema: "https://flow.jig.md/schemas/schema-1.json",
    type: "object",
    properties: {
      ticket: { type: "string" },
      delayMs: { type: "number", minimum: 0, maximum: 20_000 },
    },
    required: ["ticket"],
    additionalProperties: false,
  }));
  await writeFile(join(worker, "result.schema.json"), JSON.stringify({
    $schema: "https://flow.jig.md/schemas/schema-1.json",
    type: "object",
    properties: {
      outcome: { const: "done" },
      output: {
        type: "object",
        properties: { worker: {} },
        required: ["worker"],
        additionalProperties: false,
      },
    },
    required: ["outcome", "output"],
    additionalProperties: false,
  }));
  await writeFile(join(worker, "flow.ts"), bunWorkerProgram());
  const sdk = join(worker, "flow-sdk");
  await mkdir(sdk);
  for (const name of ["index.ts", "json.ts", "protocol.ts", "session.ts", "transport.ts", "types.ts"]) {
    await writeFile(
      join(sdk, name),
      await readFile(join(import.meta.dir, "..", "..", "flow-sdk", "src", name)),
    );
  }
}

function bunWorkerProgram(): string {
  return [
    "#!/usr/bin/env bun",
    'import { serve } from "./flow-sdk/index.ts";',
    "",
    "await serve(async (context) => {",
    '  const delayMs = typeof context.input === "object" && context.input !== null &&',
    '    "delayMs" in context.input && typeof context.input.delayMs === "number"',
    "    ? context.input.delayMs",
    "    : 0;",
    "  if (delayMs > 0) await Bun.sleep(delayMs);",
    '  return { outcome: "done", output: { worker: context.input } };',
    "});",
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

function inspectPlanningState(root: string): {
  readonly candidateRevision: number;
  readonly candidates: number;
  readonly plans: number;
  readonly admissions: number;
  readonly rootRuns: number;
  readonly planDigest: string;
} {
  return withStore(root, (database) => {
    const scalar = (query: string, field: string): unknown => database.query(query).get()[field];
    return {
      candidateRevision: Number(scalar(
        "SELECT revision FROM candidate_head WHERE singleton = 1",
        "revision",
      )),
      candidates: Number(scalar("SELECT count(*) AS count FROM candidates", "count")),
      plans: Number(scalar("SELECT count(*) AS count FROM review_plans", "count")),
      admissions: Number(scalar("SELECT count(*) AS count FROM admissions", "count")),
      rootRuns: Number(scalar("SELECT count(*) AS count FROM root_runs", "count")),
      planDigest: String(scalar("SELECT plan_digest FROM review_plans", "plan_digest")),
    };
  });
}

function inspectRootExecution(root: string, runId: string): {
  readonly rows: number;
  readonly sandboxDigest: string;
  readonly preparedDigest: string;
} {
  return withStore(root, (database) => {
    const row = database.query([
      "SELECT count(*) AS rows, max(sandbox_digest) AS sandbox_digest,",
      "max(prepared_digest) AS prepared_digest FROM root_execution_lifecycles WHERE run_id = ?1",
    ].join(" ")).get(runId);
    return {
      rows: Number(row.rows),
      sandboxDigest: String(row.sandbox_digest),
      preparedDigest: String(row.prepared_digest),
    };
  });
}

function withStore<Value>(root: string, use: (database: any) => Value): Value {
  const sqlite = createRequire(import.meta.url)("bun:sqlite") as any;
  const database = sqlite.Database.open(
    join(root, ".jig", "jig.sqlite3"),
    sqlite.constants.SQLITE_OPEN_READONLY | sqlite.constants.SQLITE_OPEN_NOFOLLOW,
  );
  try { return use(database); }
  finally { database.close(true); }
}

async function waitForPrepared(root: string, runId: string): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const prepared = withStore(root, (database) => database.query([
        "SELECT count(*) AS count FROM root_execution_lifecycles",
        "WHERE run_id = ?1 AND sandbox_digest IS NOT NULL AND prepared_digest IS NOT NULL",
      ].join(" ")).get(runId));
      if (Number(prepared.count) === 1) return;
    } catch (error) {
      if ((error as { readonly code?: unknown }).code !== "SQLITE_BUSY") throw error;
    }
    await Bun.sleep(50);
  }
  throw new Error("root Run did not reach the prepared ownership boundary");
}

async function rootlessCgroups(): Promise<string[]> {
  const delegated = process.env.AGENT_DELEGATED_CGROUP;
  if (delegated === undefined) {
    if (HOSTILE) throw new Error("rootless project proof has no delegated cgroup");
    return [];
  }
  return (await readdir(delegated)).filter((entry) => entry.startsWith("jig-run-")).sort();
}

async function waitForRootlessCgroups(expected: ReadonlySet<string>): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const current = await rootlessCgroups();
    if (sameMembers(current, expected)) return;
    await Bun.sleep(20);
  }
  throw new Error("rootless project Runs left cgroup residue");
}

function rootlessTemporaryEntry(entry: string): boolean {
  return entry.startsWith("jig-rootless-control-") ||
    entry.startsWith("jig-rootless-owner-") ||
    entry.startsWith("jig-rootless-devices-");
}

async function waitForRootlessTemporaryState(expected: ReadonlySet<string>): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const current = (await readdir(tmpdir())).filter(rootlessTemporaryEntry);
    if (sameMembers(current, expected)) return;
    await Bun.sleep(20);
  }
  throw new Error("rootless project Runs left temporary owner state");
}

function sameMembers(values: readonly string[], expected: ReadonlySet<string>): boolean {
  return values.every((value) => expected.has(value)) &&
    [...expected].every((value) => values.includes(value));
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
