import { describe, expect, test } from "bun:test";
import { createRequire } from "node:module";
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { openPrivateProjectSession } from "../src/internal/project-session-controller.js";
import { openPrivateInstalledBunHost } from "../src/internal/installed-bun-host.js";
import {
  PrivateLinuxCgroupBackend,
  PrivateLinuxFenceUnconfirmedError,
  type PrivateLinuxCgroupBackendOptions,
  type PrivateLinuxConfirmedEnforcementReceipt,
  type PrivateLinuxSealedOwner,
  type PrivateLinuxSealedOwnerIdentity,
} from "../src/internal/linux-rootless-backend.js";
import type { RootAdministration, StartRootRunReceipt } from "../src/administration/root.js";
import { installedBunLocation } from "./fixtures/installed-bun-location.js";

const HOSTILE = process.env.JIG_LINUX_ROOTLESS_HOSTILE === "1";
const proofDescribe = HOSTILE ? describe.serial : describe.skip;
const agentProofTest = process.env.JIG_OPENAI_AGENT_PROOF === "1" ? test : test.skip;
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
  test("keeps unavailable Agent configuration out of capability-free review and Run", async () => {
    const root = await mkdtemp(join(tmpdir(), "jig-private-agent-isolation-"));
    let session: Awaited<ReturnType<typeof openPrivateProjectSession>> | undefined;
    try {
      await writeCapabilityFreeProject(root);
      const host = await openPrivateInstalledBunHost(installedBunLocation, {
        JIG_AGENT_CLIENT: "codex",
      });
      expect(host.agentProvider).toBeUndefined();
      session = await openPrivateProjectSession({ directory: root, host });

      const plan = await session.plan({ lockMode: "update" });
      if (plan.state !== "applicable") {
        throw new Error("capability-free project did not produce a Plan");
      }
      await session.apply({ planDigest: plan.planDigest });
      const receipt = await session.rootAdministration.startRun({
        submissionId: "agent-isolation",
        target: { kind: "flow", path: "flows/worker" },
        input: { ticket: "unrelated" },
      });
      expect(await waitForTerminalStatus(session.rootAdministration, receipt)).toMatchObject({
        state: "terminal",
        terminal: {
          status: "succeeded",
          outcome: "done",
          output: { worker: { ticket: "unrelated" } },
        },
      });
    } finally {
      await session?.close().catch(() => undefined);
      await rm(root, { recursive: true, force: true });
    }
  }, 300_000);

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
        host: await openPrivateInstalledBunHost(installedBunLocation),
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

  test("executes exact child slots inside the parent deadline and leaves no child owner", async () => {
    const root = await mkdtemp(join(tmpdir(), "jig-private-child-slots-"));
    try {
      await writeProject(root);
      const planned = await invoke(["plan", root]) as ApplicablePlan;
      expect(planned).toMatchObject({ state: "applicable", operation: "admission" });
      await invoke(["apply", root, "--plan", planned.planDigest, "--yes"]);

      const singleStarted = Date.now();
      const single = firstRun(await invokeRun(root, {
        submissionId: "child-slot-single",
        target: { kind: "binding", id: "ticket-router" },
        input: { scenario: "single", kind: "bug", ticket: "save fails" },
      }));
      expect(Date.now() - singleStarted).toBeLessThan(30_000);
      expect(single.status).toMatchObject({
        state: "terminal",
        terminal: {
          status: "succeeded",
          outcome: "done",
          output: {
            scenario: "single",
            route: "bug",
            parentSettings: ["label"],
            child: {
              outcome: "done",
              output: {
                handled: "bug",
                ticket: "save fails",
                settings: [],
                attachments: [],
                parentMarkerVisible: false,
              },
            },
          },
        },
      });
      await expectNoChildResidue(root);

      const sequential = firstRun(await invokeRun(root, {
        submissionId: "child-slot-sequential",
        target: { kind: "binding", id: "ticket-router" },
        input: { scenario: "sequential", kind: "bug", ticket: "two steps" },
      }));
      expect(sequential.status).toMatchObject({
        state: "terminal",
        terminal: {
          status: "succeeded",
          output: {
            scenario: "sequential",
            children: [
              {
                outcome: "done",
                output: { handled: "bug", parentMarkerVisible: false },
              },
              {
                outcome: "done",
                output: { handled: "question", parentMarkerVisible: false },
              },
            ],
          },
        },
      });
      await expectNoChildResidue(root);

      const concurrent = firstRun(await invokeRun(root, {
        submissionId: "child-slot-concurrent",
        target: { kind: "binding", id: "ticket-router" },
        input: { scenario: "concurrent", kind: "bug", ticket: "capacity" },
      }));
      expect(concurrent.status).toMatchObject({
        state: "terminal",
        terminal: {
          status: "succeeded",
          output: {
            scenario: "concurrent",
            after: { outcome: "done", output: { handled: "question" } },
          },
        },
      });
      const concurrentCalls = ((concurrent.status as any).terminal.output.concurrent as any[]);
      expect(concurrentCalls).toHaveLength(2);
      expect(concurrentCalls.filter(({ status }) => status === "succeeded")).toHaveLength(1);
      expect(concurrentCalls.filter(({ status, code }) =>
        status === "failed" && code === "RESOURCE_EXHAUSTED"
      )).toHaveLength(1);
      await expectNoChildResidue(root);

      for (const [scenario, code] of [
        ["invalid-input", "INVALID_INPUT"],
        ["invalid-result", "INVALID_RESULT"],
        ["execution-failure", "EXECUTION_FAILED"],
        ["recursive", "UNAVAILABLE"],
      ] as const) {
        const errorCase = firstRun(await invokeRun(root, {
          submissionId: `child-slot-${scenario}`,
          target: { kind: "binding", id: "ticket-router" },
          input: { scenario, kind: "bug", ticket: "fail safely" },
        }));
        expect(errorCase.status).toMatchObject({
          state: "terminal",
          terminal: {
            status: "succeeded",
            output: { scenario, observed: { status: "failed", code } },
          },
        });
        await expectNoChildResidue(root);
      }

      const direct = firstRun(await invokeRun(root, {
        submissionId: "child-slot-direct-parent",
        target: { kind: "flow", path: "flows/ticket-router" },
        input: { scenario: "single", kind: "question", ticket: "how?" },
      }));
      expect(direct.status).toMatchObject({
        state: "terminal",
        terminal: { status: "failed", code: "UNAVAILABLE" },
      });
      await expectNoChildResidue(root);

      const crashRequest = {
        submissionId: "child-slot-coordinator-loss",
        target: { kind: "binding" as const, id: "ticket-router" },
        input: { scenario: "slow", kind: "bug", ticket: "child-slot-coordinator-loss" },
      };
      const crashed = Bun.spawn([
        process.execPath,
        join(import.meta.dir, "fixtures", "project-session-runner.ts"),
        root,
        crashRequest.submissionId,
        "child",
      ], { stdout: "pipe", stderr: "pipe" });
      const crashDiagnostics = new Response(crashed.stderr).text();
      const crashedReceipt = JSON.parse(await firstLine(crashed.stdout)) as { readonly runId: string };
      await waitForChildSandbox(root, crashedReceipt.runId).catch(async (error) => {
        crashed.kill("SIGKILL");
        await crashed.exited;
        throw new Error(`${String(error)}: ${await crashDiagnostics}`);
      });
      crashed.kill("SIGKILL");
      expect(await crashed.exited).toBe(137);
      await waitForRootlessCgroups(initialRootlessCgroups);

      const recovered = await openPrivateProjectSession({
        directory: root,
        host: await openPrivateInstalledBunHost(installedBunLocation),
      });
      expect(await recovered.rootAdministration.startRun(crashRequest)).toEqual(crashedReceipt);
      expect(await recovered.rootAdministration.runStatus(crashedReceipt)).toMatchObject({
        state: "terminal",
        terminal: { status: "lost", code: "COORDINATOR_LOST" },
      });
      await recovered.close();
      await expectNoChildResidue(root);

      const withheldBase = await openPrivateInstalledBunHost(installedBunLocation);
      const withheldBackend = new WithheldChildFenceBackend({
        bunPath: withheldBase.installedBunSupport.executablePath,
        bunHostLibraryPath: withheldBase.installedBunSupport.hostLibraryDirectory,
        supervisorPath: withheldBase.installedBunSupport.supervisorPath,
      });
      const withheldSession = await openPrivateProjectSession({
        directory: root,
        host: Object.freeze({ ...withheldBase, backend: withheldBackend }),
      });
      const uncertainReceipt = await withheldSession.rootAdministration.startRun({
        submissionId: "child-slot-unconfirmed-fence",
        target: { kind: "binding", id: "ticket-router" },
        input: { scenario: "fence-uncertain", kind: "bug", ticket: "withhold fence" },
      });
      await waitForChildSandbox(root, uncertainReceipt.runId);
      await withheldBackend.waitForRecoverAttempts(2);
      expect(await withheldSession.rootAdministration.runStatus(uncertainReceipt)).toMatchObject({
        state: "pending",
      });
      expect(inspectRunOwnership(root, uncertainReceipt.runId)).toEqual({
        childOwners: 1,
        terminals: 0,
      });
      expect(withheldBackend.childAdmits()).toBe(1);
      await expect(withheldSession.close()).rejects.toMatchObject({ code: "UNAVAILABLE" });

      withheldBackend.allowRecovery();
      const uncertainRecovery = await openPrivateProjectSession({
        directory: root,
        host: Object.freeze({ ...withheldBase, backend: withheldBackend }),
      });
      expect(await uncertainRecovery.rootAdministration.runStatus(uncertainReceipt)).toMatchObject({
        state: "terminal",
        terminal: {
          status: "succeeded",
          output: {
            scenario: "fence-uncertain",
            observed: { status: "failed", code: "UNCERTAIN" },
          },
        },
      });
      expect(withheldBackend.childAdmits()).toBe(1);
      expect(inspectRunOwnership(root, uncertainReceipt.runId)).toEqual({
        childOwners: 0,
        terminals: 1,
      });
      await uncertainRecovery.close();
      await expectNoChildResidue(root);

      const cancellationRequest = {
        submissionId: "child-slot-cancellation",
        target: { kind: "binding" as const, id: "ticket-router" },
        input: { scenario: "slow", kind: "bug", ticket: "child-slot-cancellation" },
      };
      const cancelling = await openPrivateProjectSession({
        directory: root,
        host: await openPrivateInstalledBunHost(installedBunLocation),
      });
      const cancelledReceipt = await cancelling.rootAdministration.startRun(cancellationRequest);
      await waitForChildSandbox(root, cancelledReceipt.runId);
      await cancelling.close();
      const cancelled = await openPrivateProjectSession({
        directory: root,
        host: await openPrivateInstalledBunHost(installedBunLocation),
      });
      expect(await cancelled.rootAdministration.startRun(cancellationRequest)).toEqual(cancelledReceipt);
      expect(await cancelled.rootAdministration.runStatus(cancelledReceipt)).toMatchObject({
        state: "terminal",
        terminal: { status: "failed", code: "CANCELLED" },
      });
      await cancelled.close();
      await expectNoChildResidue(root);

      const deadlineRequest = {
        submissionId: "child-slot-deadline",
        target: { kind: "binding" as const, id: "ticket-router" },
        input: { scenario: "slow", kind: "bug", ticket: "child-slot-deadline" },
      };
      const installed = await openPrivateInstalledBunHost(installedBunLocation);
      const expiring = await openPrivateProjectSession({
        directory: root,
        host: Object.freeze({ ...installed, runTimeoutMs: 12_000 }),
      });
      const deadlineReceipt = await expiring.rootAdministration.startRun(deadlineRequest);
      await waitForChildSandbox(root, deadlineReceipt.runId);
      expect(await waitForTerminalStatus(expiring.rootAdministration, deadlineReceipt)).toMatchObject({
        state: "terminal",
        terminal: { status: "failed", code: "DEADLINE_EXCEEDED" },
      });
      await expiring.close();
      await expectNoChildResidue(root);

      expect(inspectPlanningState(root).rootRuns).toBe(12);
      await waitForRootlessCgroups(initialRootlessCgroups);
      await waitForRootlessTemporaryState(initialRootlessTemporaryState);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 300_000);

  agentProofTest("executes one contained Agent choice and exact child without retaining its key", async () => {
    const root = await mkdtemp(join(tmpdir(), "jig-private-agent-router-"));
    let session: Awaited<ReturnType<typeof openPrivateProjectSession>> | undefined;
    try {
      await writeAgentRouterProject(root);
      session = await openPrivateProjectSession({
        directory: root,
        host: await openPrivateInstalledBunHost(installedBunLocation),
      });
      const plan = await session.plan({ lockMode: "update" });
      if (plan.state !== "applicable") throw new Error("Agent router did not produce a Plan");
      expect(plan.review.text).toContain("https://jig.md/contracts/agent-run");
      await session.apply({ planDigest: plan.planDigest });

      const started = Date.now();
      const receipt = await session.rootAdministration.startRun({
        submissionId: "agent-router-live",
        target: { kind: "binding", id: "ticket-router" },
        input: { route: "technical", ticket: "Login fails after password reset" },
      });
      const status = await waitForTerminalStatus(session.rootAdministration, receipt);
      expect(Date.now() - started).toBeLessThan(30_000);
      expect(status).toMatchObject({
        state: "terminal",
        terminal: {
          status: "succeeded",
          outcome: "done",
          output: {
            route: "technical",
            evidence: [{ source: "ticket", sourceLine: 1, amount: null, ambiguity: null }],
            parentHasKey: false,
            child: {
              outcome: "done",
              output: { handled: "technical" },
            },
          },
        },
      });
      await session.close();
      session = undefined;
      await expectNoChildResidue(root);
      expect(await treeContains(root, process.env.OPENAI_API_KEY!)).toBeFalse();
      await waitForRootlessCgroups(initialRootlessCgroups);
      await waitForRootlessTemporaryState(initialRootlessTemporaryState);
    } finally {
      await session?.close().catch(() => undefined);
      await rm(root, { recursive: true, force: true });
    }
  }, 180_000);

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
        host: await openPrivateInstalledBunHost(installedBunLocation),
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
        host: await openPrivateInstalledBunHost(installedBunLocation),
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
        host: await openPrivateInstalledBunHost(installedBunLocation),
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
        host: await openPrivateInstalledBunHost(installedBunLocation),
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
  readonly runs: readonly ForegroundRunEntry[];
}

interface ForegroundRunEntry {
  readonly submissionId: string;
  readonly receipt: { readonly runId: string };
  readonly status: unknown;
}

async function writeProject(root: string): Promise<void> {
  const worker = join(root, "flows", "worker");
  await mkdir(worker, { recursive: true });
  await writeFile(join(root, "jig.ts"), [
    'import { defineJig, discover } from "@jigging/jig";',
    'export default defineJig({ flows: discover("flows"), bindings: discover("bindings") });',
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

  const router = join(root, "flows", "ticket-router");
  const bug = join(root, "flows", "handle-bug");
  const question = join(root, "flows", "answer-question");
  const invalidInput = join(root, "flows", "invalid-input-child");
  const invalidResult = join(root, "flows", "invalid-result-child");
  const executionFailure = join(root, "flows", "execution-failure-child");
  const recursive = join(root, "flows", "recursive-child");
  const slotPackages = [
    router,
    bug,
    question,
    invalidInput,
    invalidResult,
    executionFailure,
    recursive,
  ];
  for (const directory of slotPackages) await mkdir(directory, { recursive: true });
  await writeFile(join(router, "FLOW.md"), metadata("ticket-router", "Routes one ticket."));
  await writeFile(join(router, "input.schema.json"), ticketSchema());
  await writeFile(join(router, "settings.schema.json"), JSON.stringify({
    $schema: "https://flow.jig.md/schemas/schema-1.json",
    type: "object",
    properties: { label: { const: "parent" } },
    required: ["label"],
    additionalProperties: false,
  }));
  await writeFile(join(router, "flow.ts"), routerProgram());
  await writeFile(join(bug, "FLOW.md"), metadata("handle-bug", "Handles one bug."));
  await writeFile(join(bug, "input.schema.json"), ticketSchema("bug"));
  await writeFile(join(bug, "flow.ts"), childProgram("bug"));
  await writeFile(join(question, "FLOW.md"), metadata("answer-question", "Answers one question."));
  await writeFile(join(question, "input.schema.json"), ticketSchema("question"));
  await writeFile(join(question, "flow.ts"), childProgram("question"));
  await writeFile(
    join(invalidInput, "FLOW.md"),
    metadata("invalid-input-child", "Must never start for the invalid test input."),
  );
  await writeFile(join(invalidInput, "input.schema.json"), JSON.stringify({
    $schema: "https://flow.jig.md/schemas/schema-1.json",
    type: "object",
    properties: { allowed: { const: true } },
    required: ["allowed"],
    additionalProperties: false,
  }));
  await writeFile(join(invalidInput, "flow.ts"), throwingChildProgram("invalid input reached child code"));
  await writeFile(
    join(invalidResult, "FLOW.md"),
    metadata("invalid-result-child", "Returns a result rejected by its declaration."),
  );
  await writeFile(join(invalidResult, "result.schema.json"), JSON.stringify({
    $schema: "https://flow.jig.md/schemas/schema-1.json",
    type: "object",
    properties: {
      outcome: { const: "done" },
      output: {
        type: "object",
        properties: { valid: { const: true } },
        required: ["valid"],
        additionalProperties: false,
      },
    },
    required: ["outcome", "output"],
    additionalProperties: false,
  }));
  await writeFile(join(invalidResult, "flow.ts"), invalidResultChildProgram());
  await writeFile(
    join(executionFailure, "FLOW.md"),
    metadata("execution-failure-child", "Fails after it starts."),
  );
  await writeFile(join(executionFailure, "flow.ts"), throwingChildProgram("deliberate child failure"));
  await writeFile(join(recursive, "FLOW.md"), metadata("recursive-child", "Attempts one unavailable child call."));
  await writeFile(join(recursive, "flow.ts"), recursiveChildProgram());
  for (const directory of slotPackages) await copyFlowSdk(directory);
  const bindings = join(root, "bindings");
  await mkdir(bindings);
  await writeFile(join(bindings, "ticket-router.ts"), [
    'import { defineBinding } from "@jigging/jig";',
    "export default defineBinding({",
    '  package: "./flows/ticket-router",',
    '  settings: { label: "parent" },',
    "  slots: {",
    '    bug: "./flows/handle-bug",',
    '    question: "./flows/answer-question",',
    '    "invalid-input": "./flows/invalid-input-child",',
    '    "invalid-result": "./flows/invalid-result-child",',
    '    "execution-failure": "./flows/execution-failure-child",',
    '    recursive: "./flows/recursive-child",',
    "  },",
    "});",
    "",
  ].join("\n"));
}

async function writeCapabilityFreeProject(root: string): Promise<void> {
  const worker = join(root, "flows", "worker");
  await mkdir(worker, { recursive: true });
  await writeFile(join(root, "jig.ts"), [
    'import { defineJig } from "@jigging/jig";',
    'export default defineJig({ flows: ["./flows/worker"] });',
    "",
  ].join("\n"));
  await writeFile(
    join(worker, "FLOW.md"),
    metadata("agent-isolation", "Returns its input without an Agent capability."),
  );
  await writeFile(join(worker, "flow.ts"), bunWorkerProgram());
  await copyFlowSdk(worker);
}

async function writeAgentRouterProject(root: string): Promise<void> {
  const router = join(root, "flows", "ticket-router");
  const billing = join(root, "flows", "billing");
  const technical = join(root, "flows", "technical");
  await Promise.all([router, billing, technical, join(root, "bindings")]
    .map((path) => mkdir(path, { recursive: true })));
  await writeFile(join(root, "jig.ts"), [
    'import { defineJig, discover } from "@jigging/jig";',
    'export default defineJig({ flows: discover("flows"), bindings: discover("bindings") });',
    "",
  ].join("\n"));

  await mkdir(join(router, "contracts"));
  await writeFile(
    join(router, "contracts", "agent-run.capability.json"),
    await readFile(join(import.meta.dir, "..", "..", "..", "docs", "jig", "spec", "contracts", "agent-run.capability.json")),
  );
  await mkdir(join(router, "skills", "ticket-routing"), { recursive: true });
  await writeFile(
    join(router, "skills", "ticket-routing", "SKILL.md"),
    "# Ticket routing\n\nCopy the ticket's explicit `route` field exactly.\n",
  );
  await writeFile(join(router, "FLOW.md"), [
    "---",
    "name: ticket-router",
    "description: Uses one Agent choice before calling an exact child.",
    "uses:",
    "  agent:",
    "    contract: ./contracts/agent-run.capability.json",
    "---",
    "",
  ].join("\n"));
  await writeFile(join(router, "flow.ts"), agentRouterProgram());
  await copyFlowSdk(router);

  for (const [directory, route] of [[billing, "billing"], [technical, "technical"]] as const) {
    await writeFile(join(directory, "FLOW.md"), metadata(route, `Handles one ${route} ticket.`));
    await writeFile(join(directory, "flow.ts"), [
      '#!/usr/bin/env bun',
      'import { handle } from "./flow-sdk/index.ts";',
      `await handle(async (run) => ({ outcome: "done", output: { handled: ${JSON.stringify(route)}, input: run.input } }));`,
      "",
    ].join("\n"));
    await copyFlowSdk(directory);
  }
  await writeFile(join(root, "bindings", "ticket-router.ts"), [
    'import { defineBinding } from "@jigging/jig";',
    "export default defineBinding({",
    '  package: "./flows/ticket-router",',
    "  slots: {",
    '    billing: "./flows/billing",',
    '    technical: "./flows/technical",',
    "  },",
    "});",
    "",
  ].join("\n"));
}

function agentRouterProgram(): string {
  return [
    '#!/usr/bin/env bun',
    'import { handle } from "./flow-sdk/index.ts";',
    "const responseSchema = {",
    '  $schema: "https://flow.jig.md/schemas/schema-1.json",',
    '  type: "object", properties: { decision: {',
    '    type: "object", properties: {',
    '      route: { type: "string", enum: ["billing", "technical"] },',
    '      evidence: { type: "array", minItems: 1, maxItems: 1, items: {',
    '        type: "object", properties: {',
    '          source: { type: "string", enum: ["ticket"] },',
    '          sourceLine: { type: "integer" },',
    '          amount: { type: ["integer", "null"] },',
    '          ambiguity: { type: ["string", "null"] },',
    '        }, required: ["source", "sourceLine", "amount", "ambiguity"], additionalProperties: false,',
    '      } },',
    '    }, required: ["route", "evidence"], additionalProperties: false,',
    '  } }, required: ["decision"], additionalProperties: false,',
    "};",
    "await handle(async (run) => {",
    '  const input = run.input as { route: "billing" | "technical"; ticket: string };',
    "  const agent = await run.callEffect({",
    '    operationId: "choose-route", slot: "agent", method: "run",',
    "    input: {",
    '      instructions: `Return only JSON matching the response schema. Copy route exactly from this ticket; set evidence to one item with source ticket, sourceLine 1, amount null, and ambiguity null: ${JSON.stringify(input)}`,',
    '      skills: ["ticket-routing"], responseSchema,',
    "    },",
    '  }) as { outcome: string; structured?: { decision: {',
    '    route: "billing" | "technical";',
    '    evidence: [{ source: "ticket"; sourceLine: number; amount: number | null; ambiguity: string | null }];',
    '  } } };',
    '  if (agent.outcome !== "completed" || agent.structured === undefined) throw new Error("Agent did not choose");',
    '  const decision = agent.structured.decision;',
    "  const child = await run.callFlow({",
    '    operationId: "dispatch-route", slot: decision.route, input,',
    "  });",
    "  return { outcome: \"done\", output: {",
    "    route: decision.route, evidence: decision.evidence, child,",
    "    parentHasKey: process.env.OPENAI_API_KEY !== undefined,",
    "  } };",
    "});",
    "",
  ].join("\n");
}

function metadata(name: string, description: string): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n`;
}

function ticketSchema(kind?: "bug" | "question"): string {
  return JSON.stringify({
    $schema: "https://flow.jig.md/schemas/schema-1.json",
    type: "object",
    properties: {
      scenario: {
        enum: [
          "single",
          "sequential",
          "concurrent",
          "invalid-input",
          "invalid-result",
          "execution-failure",
          "recursive",
          "slow",
          "fence-uncertain",
        ],
      },
      kind: kind === undefined ? { enum: ["bug", "question"] } : { const: kind },
      ticket: { type: "string" },
      delayMs: { type: "number", minimum: 0, maximum: 25_000 },
    },
    required: kind === undefined ? ["scenario", "kind", "ticket"] : ["kind", "ticket"],
    additionalProperties: false,
  });
}

function routerProgram(): string {
  return [
    '#!/usr/bin/env bun',
    'import { handle } from "./flow-sdk/index.ts";',
    "await handle(async (context) => {",
    '  const input = context.input as { scenario: string; kind: "bug" | "question"; ticket: string };',
    '  await Bun.write(`${context.scratch}/parent-marker`, "parent");',
    "  const call = async (operationId: string, slot: string, childInput: unknown) => {",
    "    try {",
    "      const result = await context.callFlow({ operationId, slot, input: childInput as any });",
    '      return { status: "succeeded", result };',
    "    } catch (error) {",
    '      const code = typeof error === "object" && error !== null && "code" in error',
    '        ? String((error as { code: unknown }).code) : "UNKNOWN";',
    '      const message = error instanceof Error ? error.message : String(error);',
    '      return { status: "failed", code, message };',
    "    }",
    "  };",
    '  if (input.scenario === "sequential") {',
    "    const children = [",
    '      await context.callFlow({ operationId: "sequential:bug", slot: "bug", input: { kind: "bug", ticket: input.ticket } }),',
    '      await context.callFlow({ operationId: "sequential:question", slot: "question", input: { kind: "question", ticket: input.ticket } }),',
    "    ];",
    '    return { outcome: "done", output: { scenario: input.scenario, children } };',
    "  }",
    '  if (input.scenario === "concurrent") {',
    "    const concurrent = await Promise.all([",
    '      call("concurrent:a", "bug", { kind: "bug", ticket: input.ticket, delayMs: 750 }),',
    '      call("concurrent:b", "bug", { kind: "bug", ticket: input.ticket, delayMs: 750 }),',
    "    ]);",
    '    const after = await context.callFlow({ operationId: "concurrent:after", slot: "question", input: { kind: "question", ticket: input.ticket } });',
    '    return { outcome: "done", output: { scenario: input.scenario, concurrent, after } };',
    "  }",
    '  if (input.scenario === "invalid-input") {',
    '    const observed = await call("errors:input", "invalid-input", { allowed: false });',
    '    return { outcome: "done", output: { scenario: input.scenario, observed } };',
    "  }",
    '  if (input.scenario === "invalid-result") {',
    '    const observed = await call("errors:result", "invalid-result", {});',
    '    return { outcome: "done", output: { scenario: input.scenario, observed } };',
    "  }",
    '  if (input.scenario === "execution-failure") {',
    '    const observed = await call("errors:execution", "execution-failure", {});',
    '    return { outcome: "done", output: { scenario: input.scenario, observed } };',
    "  }",
    '  if (input.scenario === "fence-uncertain") {',
    '    const observed = await call("errors:fence", "bug", { kind: "bug", ticket: input.ticket });',
    '    return { outcome: "done", output: { scenario: input.scenario, observed } };',
    "  }",
    '  if (input.scenario === "recursive") {',
    '    const observed = await call("errors:recursive", "recursive", {});',
    '    return { outcome: "done", output: { scenario: input.scenario, observed } };',
    "  }",
    '  if (input.scenario === "slow") {',
    '    const child = await context.callFlow({ operationId: "slow:1", slot: "bug", input: { kind: "bug", ticket: input.ticket, delayMs: 20_000 } });',
    '    return { outcome: "done", output: { scenario: input.scenario, child } };',
    "  }",
    '  const route = input.kind === "bug" ? "bug" : "question";',
    "  const child = await context.callFlow({",
    '    operationId: "dispatch:1",',
    "    slot: route,",
    "    input,",
    "  });",
    '  return { outcome: "done", output: {',
    '    scenario: input.scenario, route, parentSettings: Object.keys(context.settings).sort(), child,',
    "  } };",
    "});",
    "",
  ].join("\n");
}

function childProgram(kind: "bug" | "question"): string {
  return [
    '#!/usr/bin/env bun',
    'import { handle } from "./flow-sdk/index.ts";',
    "await handle(async (context) => {",
    '  const input = context.input as { kind: string; ticket: string; delayMs?: number };',
    '  const marker = `${context.scratch}/parent-marker`;',
    "  const parentMarkerVisible = await Bun.file(marker).exists();",
    '  await Bun.write(marker, "child");',
    "  if (input.delayMs !== undefined) await Bun.sleep(input.delayMs);",
    `  return { outcome: "done", output: {`,
    `    handled: "${kind}", ticket: input.ticket,`,
    "    settings: Object.keys(context.settings).sort(),",
    "    attachments: Object.keys(context.attachments).sort(),",
    "    parentMarkerVisible,",
    "  } };",
    "});",
    "",
  ].join("\n");
}

function throwingChildProgram(message: string): string {
  return [
    '#!/usr/bin/env bun',
    'import { handle } from "./flow-sdk/index.ts";',
    `await handle(async () => { throw new Error(${JSON.stringify(message)}); });`,
    "",
  ].join("\n");
}

function invalidResultChildProgram(): string {
  return [
    '#!/usr/bin/env bun',
    'import { handle } from "./flow-sdk/index.ts";',
    'await handle(async () => ({ outcome: "done", output: { valid: false } }));',
    "",
  ].join("\n");
}

function recursiveChildProgram(): string {
  return [
    '#!/usr/bin/env bun',
    'import { handle } from "./flow-sdk/index.ts";',
    "await handle(async (context) => await context.callFlow({",
    '  operationId: "recursive:inner",',
    '  slot: "not-admitted",',
    "  input: {},",
    "}));",
    "",
  ].join("\n");
}

async function copyFlowSdk(directory: string): Promise<void> {
  const target = join(directory, "flow-sdk");
  await mkdir(target);
  for (const name of ["index.ts", "json.ts", "protocol.ts", "session.ts", "transport.ts", "types.ts"]) {
    await writeFile(
      join(target, name),
      await readFile(join(import.meta.dir, "..", "..", "flow-sdk", "src", name)),
    );
  }
}

function bunWorkerProgram(): string {
  return [
    "#!/usr/bin/env bun",
    'import { handle } from "./flow-sdk/index.ts";',
    "",
    "await handle(async (context) => {",
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

async function invokeRun(root: string, request: unknown): Promise<ForegroundRunResult> {
  return await invoke([
    "run",
    root,
    "--request",
    JSON.stringify(request),
  ]) as ForegroundRunResult;
}

function firstRun(result: ForegroundRunResult): ForegroundRunEntry {
  expect(result.kind).toBe("private-foreground-run/1");
  expect(result.runs).toHaveLength(1);
  return result.runs[0]!;
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

function inspectChildOwnerCount(root: string): number {
  return withStore(root, (database) => Number(
    database.query("SELECT count(*) AS count FROM root_child_owners").get().count,
  ));
}

function inspectRunOwnership(root: string, runId: string): {
  readonly childOwners: number;
  readonly terminals: number;
} {
  return withStore(root, (database) => ({
    childOwners: Number(database.query(
      "SELECT count(*) AS count FROM root_child_owners WHERE parent_run_id = ?1",
    ).get(runId).count),
    terminals: Number(database.query(
      "SELECT count(*) AS count FROM root_terminals WHERE run_id = ?1",
    ).get(runId).count),
  }));
}

async function expectNoChildResidue(root: string): Promise<void> {
  expect(inspectChildOwnerCount(root)).toBe(0);
  const [materializations, owners] = await Promise.all([
    directoryEntries(join(root, ".jig", "private-root-materializations")),
    directoryEntries(join(root, ".jig", "private-root-linux-owners")),
  ]);
  expect(materializations.filter((entry) => entry.startsWith("child-"))).toEqual([]);
  expect(owners.filter((entry) => entry.startsWith("c-") || entry.startsWith("a-"))).toEqual([]);
}

async function treeContains(root: string, needle: string): Promise<boolean> {
  const encoded = Buffer.from(needle);
  for (const relative of await readdir(root, { recursive: true })) {
    const path = join(root, relative);
    const information = await lstat(path);
    if (information.isFile() && Buffer.from(await readFile(path)).includes(encoded)) return true;
  }
  return false;
}

async function directoryEntries(path: string): Promise<string[]> {
  try { return await readdir(path); }
  catch (error) {
    if (error !== null && typeof error === "object" &&
        (error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
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

async function waitForChildSandbox(root: string, runId: string): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const child = withStore(root, (database) => database.query([
        "SELECT count(*) AS count FROM root_child_owners",
        "WHERE parent_run_id = ?1 AND sandbox_digest IS NOT NULL",
      ].join(" ")).get(runId));
      if (Number(child.count) === 1) return;
    } catch (error) {
      if ((error as { readonly code?: unknown }).code !== "SQLITE_BUSY") throw error;
    }
    await Bun.sleep(50);
  }
  throw new Error("child Flow did not reach the durable sandbox ownership boundary");
}

async function waitForTerminalStatus(
  administration: RootAdministration,
  receipt: StartRootRunReceipt,
  timeoutMs = 30_000,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = await administration.runStatus(receipt);
    if (status.state === "terminal") return status;
    await Bun.sleep(20);
  }
  throw new Error("root Run did not reach a terminal status");
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

interface WithheldChildFenceState {
  allowRecovery: boolean;
  childAdmits: number;
  recoverAttempts: number;
}

const withheldChildFenceStates = new WeakMap<WithheldChildFenceBackend, WithheldChildFenceState>();

class WithheldChildFenceBackend extends PrivateLinuxCgroupBackend {
  constructor(options: PrivateLinuxCgroupBackendOptions) {
    super(options);
    withheldChildFenceStates.set(this, {
      allowRecovery: false,
      childAdmits: 0,
      recoverAttempts: 0,
    });
  }

  override async seal(
    ...arguments_: Parameters<PrivateLinuxCgroupBackend["seal"]>
  ): Promise<PrivateLinuxSealedOwner> {
    const sealed = await super.seal(...arguments_);
    if (!sealed.identity.runId.startsWith("child-")) return sealed;
    return Object.freeze({
      identity: sealed.identity,
      admit: async (...admitArguments: Parameters<PrivateLinuxSealedOwner["admit"]>) => {
        const state = withheldState(this);
        state.childAdmits += 1;
        const component = await sealed.admit(...admitArguments);
        return Object.freeze({
          ...component,
          enforcement: component.enforcement.then(() => {
            throw new PrivateLinuxFenceUnconfirmedError(
              new Error("test withheld the confirmed child fence"),
            );
          }),
        });
      },
    });
  }

  override async recoverFence(
    owner: unknown,
  ): Promise<PrivateLinuxConfirmedEnforcementReceipt> {
    if (childOwner(owner)) {
      const state = withheldState(this);
      state.recoverAttempts += 1;
      if (!state.allowRecovery) {
        throw new PrivateLinuxFenceUnconfirmedError(
          new Error("test withheld the durable child fence"),
        );
      }
    }
    return await super.recoverFence(owner);
  }

  allowRecovery(): void {
    withheldState(this).allowRecovery = true;
  }

  childAdmits(): number {
    return withheldState(this).childAdmits;
  }

  async waitForRecoverAttempts(count: number): Promise<void> {
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      if (withheldState(this).recoverAttempts >= count) return;
      await Bun.sleep(20);
    }
    throw new Error("child fence recovery was not attempted");
  }
}

function withheldState(backend: WithheldChildFenceBackend): WithheldChildFenceState {
  const state = withheldChildFenceStates.get(backend);
  if (state === undefined) throw new Error("withheld child fence Backend state is absent");
  return state;
}

function childOwner(value: unknown): value is PrivateLinuxSealedOwnerIdentity {
  return value !== null && typeof value === "object" &&
    "runId" in value && typeof value.runId === "string" && value.runId.startsWith("child-");
}
