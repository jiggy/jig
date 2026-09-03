import { describe, expect, test } from "bun:test";
import { createRequire } from "node:module";
import { createServer, type Server } from "node:http";
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import type { RootAdministration, StartRootRunReceipt } from
  "../src/administration/root.js";
import { openPrivateInstalledBunHost } from "../src/internal/installed-bun-host.js";
import { openPrivateProjectSession } from "../src/internal/project-session-controller.js";
import type { PrivateInstalledBunLocation } from
  "../src/internal/installed-bun-support.js";
import { installedBunLocation } from "./fixtures/installed-bun-location.js";

const HOSTILE = process.env.JIG_LINUX_ROOTLESS_HOSTILE === "1";
const proofDescribe = HOSTILE ? describe.serial : describe.skip;
const nativeCodexPath = process.env.JIG_CODEX_PROOF_PATH;
const nativeCodexTest = HOSTILE && nativeCodexPath !== undefined && process.env.CODEX_HOME !== undefined
  ? test
  : test.skip;
const nativeCodexGatewayModel = process.env.JIG_CODEX_OPENROUTER_MODEL;
const nativeCodexGatewayTest = HOSTILE && nativeCodexPath !== undefined &&
    nativeCodexGatewayModel !== undefined && process.env.OPENROUTER_API_KEY !== undefined
  ? test
  : test.skip;
const nativeClaudePath = process.env.JIG_CLAUDE_PROOF_PATH;
const nativeClaudeGatewayModel = process.env.JIG_CLAUDE_OPENROUTER_MODEL;
const nativeClaudeGatewayTest = HOSTILE && nativeClaudePath !== undefined &&
    nativeClaudeGatewayModel !== undefined && process.env.OPENROUTER_API_KEY !== undefined
  ? test
  : test.skip;
const nativePiPath = process.env.JIG_PI_PROOF_PATH;
const nativePiGatewayModel = process.env.JIG_PI_OPENROUTER_MODEL;
const nativePiGatewayTest = HOSTILE && nativePiPath !== undefined &&
    nativePiGatewayModel !== undefined && process.env.OPENROUTER_API_KEY !== undefined
  ? test
  : test.skip;
const NATIVE_AGENT_TIMEOUT_MS = 120_000;
const NATIVE_AGENT_TEST_TIMEOUT_MS = 180_000;
const initialTemporaryState = new Set(
  (await readdir(tmpdir())).filter(rootlessTemporaryEntry),
);
const initialCgroups = new Set(await rootlessCgroups());

interface DispatchEvent {
  readonly scenario: string;
  readonly keyInEnvironment: boolean;
  readonly selectedSkill: boolean;
  readonly hiddenSkill: boolean;
}

proofDescribe("private contained Agent Run lifecycle", () => {
  nativeCodexTest("executes native Codex through ACP with the existing subscription", async () => {
    const root = await mkdtemp(join(tmpdir(), "jig-native-codex-project-"));
    let session: Awaited<ReturnType<typeof openPrivateProjectSession>> | undefined;
    try {
      await writeProject(root);
      session = await openPrivateProjectSession({
        directory: root,
        host: Object.freeze({
          ...await openPrivateInstalledBunHost(installedBunLocation, {
            CODEX_HOME: process.env.CODEX_HOME,
            CODEX_PATH: await realpath(nativeCodexPath!),
            JIG_AGENT_CLIENT: "codex",
          }),
          runTimeoutMs: NATIVE_AGENT_TIMEOUT_MS,
        }),
      });
      const plan = await session.plan({ lockMode: "update" });
      if (plan.state !== "applicable") throw new Error("native Codex fixture did not produce a Plan");
      await session.apply({ planDigest: plan.planDigest });

      expect(await runToTerminal(
        session.rootAdministration,
        "native-codex-subscription",
        "success",
        NATIVE_AGENT_TEST_TIMEOUT_MS,
      )).toMatchObject({
        state: "terminal",
        terminal: {
          status: "succeeded",
          outcome: "done",
          output: {
            status: "succeeded",
            parentHasKey: false,
            agent: {
              outcome: "completed",
              structured: {
                route: "technical",
                keyLocation: "stdin",
                selectedSkill: "present",
                hiddenSkill: "absent",
              },
            },
          },
        },
      });
      await expectNoAgentOwner(root);
      await session.close();
      session = undefined;
      await waitForCgroups(initialCgroups);
      await waitForTemporaryState(initialTemporaryState);
    } finally {
      await session?.close().catch(() => undefined);
      await rm(root, { recursive: true, force: true });
    }
  }, NATIVE_AGENT_TEST_TIMEOUT_MS);

  nativeCodexGatewayTest("executes native Codex through ACP with an explicit OpenRouter gateway", async () => {
    const root = await mkdtemp(join(tmpdir(), "jig-native-codex-gateway-project-"));
    let session: Awaited<ReturnType<typeof openPrivateProjectSession>> | undefined;
    try {
      await writeProject(root);
      session = await openPrivateProjectSession({
        directory: root,
        host: Object.freeze({
          ...await openPrivateInstalledBunHost(installedBunLocation, {
            CODEX_PATH: await realpath(nativeCodexPath!),
            JIG_AGENT_CLIENT: "codex",
            OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
            OPENROUTER_MODEL: nativeCodexGatewayModel,
          }),
          runTimeoutMs: NATIVE_AGENT_TIMEOUT_MS,
        }),
      });
      const plan = await session.plan({ lockMode: "update" });
      if (plan.state !== "applicable") throw new Error("native Codex fixture did not produce a Plan");
      await session.apply({ planDigest: plan.planDigest });

      const terminal = await runToTerminal(
        session.rootAdministration,
        "native-codex-openrouter",
        "gateway",
        NATIVE_AGENT_TEST_TIMEOUT_MS,
      );
      expect(terminal).toMatchObject({
        state: "terminal",
        terminal: {
          status: "succeeded",
          outcome: "done",
          output: {
            status: "succeeded",
            parentHasKey: false,
            agent: { outcome: "completed" },
          },
        },
      });
      const text = agentText(terminal);
      expect(text).toContain("READY");
      expect(text).not.toContain(process.env.OPENROUTER_API_KEY!);
      await expectNoAgentOwner(root);
      await session.close();
      session = undefined;
      await waitForCgroups(initialCgroups);
      await waitForTemporaryState(initialTemporaryState);
    } finally {
      await session?.close().catch(() => undefined);
      await rm(root, { recursive: true, force: true });
    }
  }, NATIVE_AGENT_TEST_TIMEOUT_MS);

  nativeClaudeGatewayTest("executes native Claude Code through ACP with an explicit OpenRouter gateway", async () => {
    const root = await mkdtemp(join(tmpdir(), "jig-native-claude-gateway-project-"));
    let session: Awaited<ReturnType<typeof openPrivateProjectSession>> | undefined;
    try {
      await writeProject(root);
      session = await openPrivateProjectSession({
        directory: root,
        host: Object.freeze({
          ...await openPrivateInstalledBunHost(installedBunLocation, {
            CLAUDE_PATH: await realpath(nativeClaudePath!),
            JIG_AGENT_CLIENT: "claude",
            OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
            OPENROUTER_MODEL: nativeClaudeGatewayModel,
          }),
          runTimeoutMs: NATIVE_AGENT_TIMEOUT_MS,
        }),
      });
      const plan = await session.plan({ lockMode: "update" });
      if (plan.state !== "applicable") throw new Error("native Claude fixture did not produce a Plan");
      await session.apply({ planDigest: plan.planDigest });

      const terminal = await runToTerminal(
        session.rootAdministration,
        "native-claude-openrouter",
        "gateway",
        NATIVE_AGENT_TEST_TIMEOUT_MS,
      );
      expect(terminal).toMatchObject({
        state: "terminal",
        terminal: {
          status: "succeeded",
          outcome: "done",
          output: {
            status: "succeeded",
            parentHasKey: false,
            agent: { outcome: "completed" },
          },
        },
      });
      const text = agentText(terminal);
      expect(text).toContain("READY");
      expect(text).not.toContain(process.env.OPENROUTER_API_KEY!);
      await expectNoAgentOwner(root);
      await session.close();
      session = undefined;
      await waitForCgroups(initialCgroups);
      await waitForTemporaryState(initialTemporaryState);
    } finally {
      await session?.close().catch(() => undefined);
      await rm(root, { recursive: true, force: true });
    }
  }, NATIVE_AGENT_TEST_TIMEOUT_MS);

  nativePiGatewayTest("executes native Pi through ACP with an explicit OpenRouter gateway", async () => {
    const root = await mkdtemp(join(tmpdir(), "jig-native-pi-gateway-project-"));
    let session: Awaited<ReturnType<typeof openPrivateProjectSession>> | undefined;
    try {
      await writeProject(root);
      session = await openPrivateProjectSession({
        directory: root,
        host: Object.freeze({
          ...await openPrivateInstalledBunHost(installedBunLocation, {
            JIG_AGENT_CLIENT: "pi",
            OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
            OPENROUTER_MODEL: nativePiGatewayModel,
            PI_PATH: await realpath(nativePiPath!),
          }),
          runTimeoutMs: NATIVE_AGENT_TIMEOUT_MS,
        }),
      });
      const plan = await session.plan({ lockMode: "update" });
      if (plan.state !== "applicable") throw new Error("native Pi fixture did not produce a Plan");
      await session.apply({ planDigest: plan.planDigest });

      const terminal = await runToTerminal(
        session.rootAdministration,
        "native-pi-openrouter",
        "gateway",
        NATIVE_AGENT_TEST_TIMEOUT_MS,
      );
      expect(terminal).toMatchObject({
        state: "terminal",
        terminal: {
          status: "succeeded",
          outcome: "done",
          output: {
            status: "succeeded",
            parentHasKey: false,
            agent: { outcome: "completed" },
          },
        },
      });
      const text = agentText(terminal);
      expect(text).toContain("READY");
      expect(text).not.toContain(process.env.OPENROUTER_API_KEY!);
      await expectNoAgentOwner(root);
      await session.close();
      session = undefined;
      await waitForCgroups(initialCgroups);
      await waitForTemporaryState(initialTemporaryState);
    } finally {
      await session?.close().catch(() => undefined);
      await rm(root, { recursive: true, force: true });
    }
  }, NATIVE_AGENT_TEST_TIMEOUT_MS);

  test("fences deterministic provider success, invalid output, cancellation, deadline, and loss", async () => {
    const root = await mkdtemp(join(tmpdir(), "jig-agent-lifecycle-project-"));
    const releaseRoot = await mkdtemp(join(tmpdir(), "jig-agent-lifecycle-release-"));
    const events: DispatchEvent[] = [];
    const server = await dispatchServer(events);
    const priorKey = process.env.OPENAI_API_KEY;
    const priorModel = process.env.OPENAI_MODEL;
    const priorOpenRouterKey = process.env.OPENROUTER_API_KEY;
    const priorOpenRouterModel = process.env.OPENROUTER_MODEL;
    let session: Awaited<ReturnType<typeof openPrivateProjectSession>> | undefined;
    try {
      const address = server.address();
      if (address === null || typeof address === "string") throw new Error("dispatch server has no port");
      const key = `http://127.0.0.1:${address.port}/dispatch?proof=transient`;
      const location = await writeInstalledFixture(releaseRoot);
      await writeProject(root);
      delete process.env.OPENROUTER_API_KEY;
      delete process.env.OPENROUTER_MODEL;
      process.env.OPENAI_API_KEY = key;
      process.env.OPENAI_MODEL = "provider/test-model";

      session = await openPrivateProjectSession({
        directory: root,
        host: await openPrivateInstalledBunHost(location),
      });
      const plan = await session.plan({ lockMode: "update" });
      if (plan.state !== "applicable") throw new Error("Agent fixture did not produce a Plan");
      await session.apply({ planDigest: plan.planDigest });

      const success = await runToTerminal(session.rootAdministration, "agent-success", "success");
      expect(success).toMatchObject({
        state: "terminal",
        terminal: {
          status: "succeeded",
          outcome: "done",
          output: {
            status: "succeeded",
            parentHasKey: false,
            agent: {
              outcome: "completed",
              structured: {
                route: "technical",
                keyLocation: "stdin",
                selectedSkill: "present",
                hiddenSkill: "absent",
              },
            },
          },
        },
      });
      expect(events).toEqual([{
        scenario: "success",
        keyInEnvironment: false,
        selectedSkill: true,
        hiddenSkill: false,
      }]);
      await expectNoAgentOwner(root);

      for (let index = 0; index < 2; index += 1) {
        expect(await runToTerminal(
          session.rootAdministration,
          `agent-repeat-${index}`,
          "success",
        )).toMatchObject({
          state: "terminal",
          terminal: { status: "succeeded", outcome: "done" },
        });
        await expectNoAgentOwner(root);
      }
      expect(events.filter(({ scenario }) => scenario === "success")).toHaveLength(3);

      for (const scenario of ["schema-invalid", "malformed"] as const) {
        expect(await runToTerminal(
          session.rootAdministration,
          `agent-${scenario}`,
          scenario,
        )).toMatchObject({
          state: "terminal",
          terminal: {
            status: "succeeded",
            outcome: "done",
            output: { status: "failed", code: "INVALID_RESULT" },
          },
        });
        await expectNoAgentOwner(root);
      }

      const dispatchesBeforeInvalidInput = events.length;
      expect(await runToTerminal(
        session.rootAdministration,
        "agent-schema-input-invalid",
        "schema-input-invalid",
      )).toMatchObject({
        state: "terminal",
        terminal: {
          status: "succeeded",
          outcome: "done",
          output: { status: "failed", code: "INVALID_INPUT" },
        },
      });
      expect(events).toHaveLength(dispatchesBeforeInvalidInput);
      await expectNoAgentOwner(root);

      await session.close();
      session = undefined;
      const deadlineHost = await openPrivateInstalledBunHost(location);
      session = await openPrivateProjectSession({
        directory: root,
        host: Object.freeze({ ...deadlineHost, runTimeoutMs: 1_500 }),
      });
      expect(await runToTerminal(
        session.rootAdministration,
        "agent-deadline",
        "slow",
        10_000,
      )).toMatchObject({
        state: "terminal",
        terminal: { status: "failed", code: "DEADLINE_EXCEEDED" },
      });
      await expectNoAgentOwner(root);

      await session.close();
      session = await openPrivateProjectSession({
        directory: root,
        host: await openPrivateInstalledBunHost(location),
      });
      const cancellation = await session.rootAdministration.startRun(runRequest(
        "agent-cancellation",
        "slow",
      ));
      await waitForAgentSandbox(root, cancellation.runId);
      await session.close();
      session = await openPrivateProjectSession({
        directory: root,
        host: await openPrivateInstalledBunHost(location),
      });
      expect(await session.rootAdministration.startRun(runRequest(
        "agent-cancellation",
        "slow",
      ))).toEqual(cancellation);
      expect(await waitForTerminal(session.rootAdministration, cancellation)).toMatchObject({
        state: "terminal",
        terminal: { status: "failed", code: "CANCELLED" },
      });
      await expectNoAgentOwner(root);

      await session.close();
      session = undefined;
      const recoveryBefore = events.filter(({ scenario }) => scenario === "recovery").length;
      const crashed = Bun.spawn([
        process.execPath,
        join(import.meta.dir, "fixtures", "agent-session-runner.ts"),
        root,
        location.releaseRoot,
        location.executablePath,
        "agent-coordinator-loss",
      ], {
        env: process.env,
        stdout: "pipe",
        stderr: "pipe",
      });
      const diagnostics = new Response(crashed.stderr).text();
      const receipt = JSON.parse(await firstLine(crashed.stdout)) as StartRootRunReceipt;
      await waitForAgentSandbox(root, receipt.runId).catch(async (error) => {
        crashed.kill("SIGKILL");
        await crashed.exited;
        throw new Error(`${String(error)}: ${await diagnostics}`);
      });
      await waitForEvents(events, "recovery", recoveryBefore + 1);
      crashed.kill("SIGKILL");
      expect(await crashed.exited).toBe(137);
      await waitForCgroups(initialCgroups);

      delete process.env.OPENAI_API_KEY;
      session = await openPrivateProjectSession({
        directory: root,
        host: await openPrivateInstalledBunHost(location),
      });
      expect(await session.rootAdministration.startRun(runRequest(
        "agent-coordinator-loss",
        "recovery",
      ))).toEqual(receipt);
      expect(await waitForTerminal(session.rootAdministration, receipt)).toMatchObject({
        state: "terminal",
        terminal: { status: "lost", code: "COORDINATOR_LOST" },
      });
      await Bun.sleep(250);
      expect(events.filter(({ scenario }) => scenario === "recovery"))
        .toHaveLength(recoveryBefore + 1);
      await expectNoAgentOwner(root);

      expect(await treeContains(root, key)).toBe(false);
      expect(await treeContains(releaseRoot, key)).toBe(false);
      await session.close();
      session = undefined;
      await waitForCgroups(initialCgroups);
      await waitForTemporaryState(initialTemporaryState);
    } finally {
      await session?.close().catch(() => undefined);
      if (priorKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = priorKey;
      if (priorModel === undefined) delete process.env.OPENAI_MODEL;
      else process.env.OPENAI_MODEL = priorModel;
      if (priorOpenRouterKey === undefined) delete process.env.OPENROUTER_API_KEY;
      else process.env.OPENROUTER_API_KEY = priorOpenRouterKey;
      if (priorOpenRouterModel === undefined) delete process.env.OPENROUTER_MODEL;
      else process.env.OPENROUTER_MODEL = priorOpenRouterModel;
      await closeServer(server);
      await Promise.all([
        rm(root, { recursive: true, force: true }),
        rm(releaseRoot, { recursive: true, force: true }),
      ]);
    }
  }, 180_000);
});

async function writeInstalledFixture(root: string): Promise<PrivateInstalledBunLocation> {
  const source = installedBunLocation.releaseRoot;
  const files = [
    "libexec/installed-cli.js",
    "libexec/linux-rootless-supervisor.js",
    "libexec/evaluator/project-evaluator-worker.js",
    "libexec/evaluator/project-evaluator-sdk.bundle.js",
    "libexec/evaluator/project-authoring-1.schema.json",
    "libexec/preparation/bun-native-preparation-worker.js",
  ];
  await Promise.all([
    "libexec/agent",
    "libexec/evaluator",
    "libexec/preparation",
    "node_modules/@oven/bun-linux-x64-baseline/bin",
  ].map((path) => mkdir(join(root, path), { recursive: true })));
  await Promise.all(files.map((path) => copyFile(join(source, path), join(root, path))));
  await writeFile(
    join(root, "libexec/agent/openai-responses-worker.js"),
    deterministicWorker(),
  );
  const executablePath = await realpath(installedBunLocation.executablePath);
  await symlink(
    executablePath,
    join(root, "node_modules/@oven/bun-linux-x64-baseline/bin/bun"),
  );
  return Object.freeze({
    releaseRoot: root,
    executablePath,
    installedCliPath: join(root, "libexec/installed-cli.js"),
  });
}

function deterministicWorker(): string {
  return [
    "const raw = await new Response(Bun.stdin.stream()).text();",
    "const request = JSON.parse(raw);",
    'const marker = (value) => request.instructions.includes(value);',
    'const scenarios = ["schema-invalid", "malformed", "recovery", "success", "slow"];',
    'const scenario = scenarios.find((value) => marker(`scenario:${value}`));',
    'if (scenario === undefined || typeof request.apiKey !== "string") throw new Error("invalid fixture request");',
    'const event = { scenario, keyInEnvironment: process.env.OPENAI_API_KEY !== undefined ||',
    '  process.env.OPENROUTER_API_KEY !== undefined,',
    '  selectedSkill: marker("SELECTED_SKILL_MARKER"), hiddenSkill: marker("HIDDEN_SKILL_MARKER") };',
    'const response = await fetch(request.apiKey, { method: "POST", body: JSON.stringify(event) });',
    'if (!response.ok) throw new Error("fixture observer rejected dispatch");',
    'if (scenario === "slow" || scenario === "recovery") await Bun.sleep(60_000);',
    'if (scenario === "malformed") { process.stdout.write("not-json"); process.exit(0); }',
    'const structured = { route: scenario === "schema-invalid" ? "invalid" : "technical",',
    '  keyLocation: event.keyInEnvironment ? "environment" : "stdin",',
    '  selectedSkill: event.selectedSkill ? "present" : "absent",',
    '  hiddenSkill: event.hiddenSkill ? "present" : "absent" };',
    'process.stdout.write(JSON.stringify({ protocol: "jig-private-openai-responses/1", status: "ok",',
    '  value: { outcome: "completed", text: JSON.stringify(structured), structured } }));',
    "",
  ].join("\n");
}

async function writeProject(root: string): Promise<void> {
  const flow = join(root, "flows", "router");
  await Promise.all([
    join(flow, "contracts"),
    join(flow, "skills", "selected"),
    join(flow, "skills", "hidden"),
    join(flow, "flow-sdk"),
  ].map((path) => mkdir(path, { recursive: true })));
  await writeFile(join(root, "jig.ts"), [
    'import { defineJig, discover } from "@jigging/jig";',
    'export default defineJig({ flows: discover("flows") });',
    "",
  ].join("\n"));
  await writeFile(join(flow, "FLOW.md"), [
    "---",
    "name: deterministic-agent-router",
    "description: Exercises one exact contained Agent effect.",
    "uses:",
    "  agent:",
    "    contract: ./contracts/agent-run.capability.json",
    "---",
    "",
  ].join("\n"));
  await writeFile(
    join(flow, "contracts", "agent-run.capability.json"),
    await readFile(join(import.meta.dir, "..", "..", "..", "docs", "jig", "spec", "contracts", "agent-run.capability.json")),
  );
  await writeFile(join(flow, "skills", "selected", "SKILL.md"), "SELECTED_SKILL_MARKER\n");
  await writeFile(join(flow, "skills", "hidden", "SKILL.md"), "HIDDEN_SKILL_MARKER\n");
  await writeFile(join(flow, "input.schema.json"), JSON.stringify({
    $schema: "https://flow.jig.md/schemas/schema-1.json",
    type: "object",
    properties: {
      scenario: {
        enum: [
          "success",
          "schema-invalid",
          "schema-input-invalid",
          "malformed",
          "slow",
          "recovery",
          "gateway",
        ],
      },
    },
    required: ["scenario"],
    additionalProperties: false,
  }));
  await writeFile(join(flow, "flow.ts"), flowProgram());
  for (const name of ["index.ts", "json.ts", "protocol.ts", "session.ts", "transport.ts", "types.ts"]) {
    await copyFile(
      join(import.meta.dir, "..", "..", "flow-sdk", "src", name),
      join(flow, "flow-sdk", name),
    );
  }
}

function flowProgram(): string {
  return [
    '#!/usr/bin/env bun',
    'import { handle } from "./flow-sdk/index.ts";',
    "const responseSchema = {",
    '  $schema: "https://flow.jig.md/schemas/schema-1.json", type: "object",',
    "  properties: {",
    '    route: { enum: ["technical"] }, keyLocation: { enum: ["stdin"] },',
    '    selectedSkill: { enum: ["present"] }, hiddenSkill: { enum: ["absent"] },',
    "  },",
    '  required: ["route", "keyLocation", "selectedSkill", "hiddenSkill"],',
    "  additionalProperties: false,",
    "};",
    "await handle(async (run) => {",
    "  const input = run.input as { scenario: string };",
    "  try {",
    "    const agent = await run.callEffect({",
    '      operationId: `agent:${input.scenario}`, slot: "agent", method: "run",',
    '      input: { instructions: input.scenario === "gateway"',
    '        ? "Reply with exactly READY and nothing else."',
    '        : `scenario:${input.scenario}`, skills: ["selected"],',
    '        ...(input.scenario === "gateway" ? {} : {',
    '          responseSchema: input.scenario === "schema-input-invalid"',
    '            ? { $schema: "https://flow.jig.md/schemas/schema-1.json", type: "unknown" }',
    '            : responseSchema,',
    '        }) },',
    "    });",
    '    return { outcome: "done", output: { status: "succeeded", agent,',
    "      parentHasKey: process.env.OPENAI_API_KEY !== undefined ||",
    "        process.env.OPENROUTER_API_KEY !== undefined } };",
    "  } catch (error) {",
    '    const code = typeof error === "object" && error !== null && "code" in error',
    '      ? String((error as { code: unknown }).code) : "UNKNOWN";',
    '    return { outcome: "done", output: { status: "failed", code } };',
    "  }",
    "});",
    "",
  ].join("\n");
}

function runRequest(submissionId: string, scenario: string) {
  return Object.freeze({
    submissionId,
    target: { kind: "flow" as const, path: "flows/router" },
    input: { scenario },
  });
}

async function runToTerminal(
  administration: RootAdministration,
  submissionId: string,
  scenario: string,
  timeoutMs = 30_000,
) {
  const receipt = await administration.startRun(runRequest(submissionId, scenario));
  return await waitForTerminal(administration, receipt, timeoutMs);
}

function agentText(terminal: Awaited<ReturnType<typeof waitForTerminal>>): string {
  const output = terminal.state === "terminal" && terminal.terminal.status === "succeeded"
    ? terminal.terminal.output
    : undefined;
  const agent = output !== null && typeof output === "object" && "agent" in output
    ? output.agent
    : undefined;
  if (typeof agent !== "object" || agent === null || !("text" in agent) ||
      typeof agent.text !== "string") {
    throw new Error("native Agent result omitted its text");
  }
  return agent.text;
}

async function waitForTerminal(
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
  const finalStatus = await administration.runStatus(receipt);
  if (finalStatus.state === "terminal") return finalStatus;
  throw new Error(`Agent fixture Run did not become terminal: ${JSON.stringify(finalStatus)}`);
}

async function waitForAgentSandbox(root: string, runId: string): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const count = withStore(root, (database) => Number(database.query([
        "SELECT count(*) AS count FROM root_child_owners",
        "WHERE parent_run_id = ?1 AND sandbox_digest IS NOT NULL",
      ].join(" ")).get(runId).count));
      if (count === 1) return;
    } catch (error) {
      if ((error as { readonly code?: unknown }).code !== "SQLITE_BUSY") throw error;
    }
    await Bun.sleep(20);
  }
  throw new Error("Agent fixture did not retain its sandbox owner");
}

async function expectNoAgentOwner(root: string): Promise<void> {
  expect(withStore(root, (database) => Number(
    database.query("SELECT count(*) AS count FROM root_child_owners").get().count,
  ))).toBe(0);
  const path = join(root, ".jig", "private-root-linux-owners");
  const values = await readdir(path).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [] as string[];
    throw error;
  });
  expect(values.filter((value) => value.startsWith("a-"))).toEqual([]);
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

async function dispatchServer(events: DispatchEvent[]): Promise<Server> {
  const server = createServer(async (request, response) => {
    try {
      if (request.method !== "POST" || !request.url?.startsWith("/dispatch?proof=transient")) {
        response.writeHead(404).end();
        return;
      }
      const text = await new Response(request as any).text();
      events.push(JSON.parse(text) as DispatchEvent);
      response.writeHead(204).end();
    } catch {
      response.writeHead(400).end();
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  return server;
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => server.close((error) => {
    if (error === undefined) resolve();
    else reject(error);
  }));
}

async function waitForEvents(
  events: readonly DispatchEvent[],
  scenario: string,
  count: number,
): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (events.filter((event) => event.scenario === scenario).length >= count) return;
    await Bun.sleep(20);
  }
  throw new Error(`Agent fixture did not report ${scenario} dispatch`);
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

async function rootlessCgroups(): Promise<string[]> {
  const delegated = process.env.AGENT_DELEGATED_CGROUP;
  if (delegated === undefined) {
    if (HOSTILE) throw new Error("Agent lifecycle proof has no delegated cgroup");
    return [];
  }
  return (await readdir(delegated)).filter((entry) => entry.startsWith("jig-run-")).sort();
}

async function waitForCgroups(expected: ReadonlySet<string>): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (sameMembers(await rootlessCgroups(), expected)) return;
    await Bun.sleep(20);
  }
  throw new Error("Agent lifecycle proof left cgroup residue");
}

function rootlessTemporaryEntry(entry: string): boolean {
  return entry.startsWith("jig-rootless-control-") ||
    entry.startsWith("jig-rootless-owner-") ||
    entry.startsWith("jig-rootless-devices-");
}

async function waitForTemporaryState(expected: ReadonlySet<string>): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const current = (await readdir(tmpdir())).filter(rootlessTemporaryEntry);
    if (sameMembers(current, expected)) return;
    await Bun.sleep(20);
  }
  throw new Error("Agent lifecycle proof left temporary owner residue");
}

function sameMembers(values: readonly string[], expected: ReadonlySet<string>): boolean {
  return values.every((value) => expected.has(value)) &&
    [...expected].every((value) => values.includes(value));
}

async function firstLine(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const text = new TextDecoder();
  let buffered = "";
  try {
    while (true) {
      const value = await reader.read();
      if (value.done) throw new Error("Agent coordinator fixture exited before its receipt");
      buffered += text.decode(value.value, { stream: true });
      const newline = buffered.indexOf("\n");
      if (newline !== -1) return buffered.slice(0, newline);
    }
  } finally {
    reader.releaseLock();
  }
}
