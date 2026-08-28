import {
  RootAdministrationError,
  type StartRootRunRequest,
} from "../src/administration/root.js";
import {
  ProjectAdministrationError,
  type ProjectSession,
} from "../src/administration/project.js";
import { openPrivateProjectSession } from "../src/internal/project-session-controller.js";
import { openAgentSandboxProofHost } from "./private-proof-host.js";

// Proof-host dogfood only. This file is intentionally outside src/, exports no
// API, and must not become a shortcut around a future reviewed control plane.
async function plan(projectPath: string): Promise<object> {
  return await withProjectSession(projectPath, async (session) => {
    return { kind: "private-foreground-plan/1", ...await session.plan({ lockMode: "update" }) };
  });
}

async function apply(input: {
  readonly projectPath: string;
  readonly planDigest: string;
}): Promise<object> {
  return await withProjectSession(input.projectPath, async (session) => {
    return {
      kind: "private-foreground-apply/1",
      ...await session.apply({ planDigest: input.planDigest }),
    };
  });
}

async function run(input: {
  readonly projectPath: string;
  readonly requests: readonly StartRootRunRequest[];
}): Promise<object> {
  return await withProjectSession(input.projectPath, async (session) => {
    const runs = [];
    for (const request of input.requests) {
      const receipt = await session.rootAdministration.startRun(request);
      runs.push({
        submissionId: request.submissionId,
        receipt,
        status: await waitForTerminal(session.rootAdministration, receipt.runId),
      });
    }
    return {
      kind: "private-foreground-run/1",
      runs,
    };
  });
}

async function withProjectSession<Value>(
  directory: string,
  use: (session: ProjectSession) => Promise<Value>,
): Promise<Value> {
  const session = await openPrivateProjectSession({
    directory,
    host: await openAgentSandboxProofHost(),
  });
  let operationFailed = false;
  let operationFailure: unknown;
  let value: Value | undefined;
  try { value = await use(session); }
  catch (error) {
    operationFailed = true;
    operationFailure = error;
  }
  try { await session.close(); }
  catch (closeFailure) {
    if (operationFailed) {
      throw new AggregateError(
        [operationFailure, closeFailure],
        "private foreground operation and project close both failed",
      );
    }
    throw closeFailure;
  }
  if (operationFailed) throw operationFailure;
  return value as Value;
}

async function waitForTerminal(
  administration: import("../src/administration/root.js").RootAdministration,
  runId: string,
): Promise<import("../src/administration/root.js").RootRunStatus> {
  const deadline = Date.now() + 70_000;
  while (Date.now() < deadline) {
    const status = await administration.runStatus({ runId });
    if (status.state === "terminal") return status;
    await Bun.sleep(10);
  }
  throw new RootAdministrationError(
    "UNAVAILABLE",
    "root Run did not reach a terminal state within the finite command window",
  );
}

function parseApplyArguments(values: readonly string[]): {
  readonly projectPath: string;
  readonly planDigest: string;
} {
  const projectPath = values[0];
  if (projectPath === undefined) invalidUsage("apply requires <project-root>");
  let planDigest: string | undefined;
  let approved = false;
  for (let index = 1; index < values.length; index += 1) {
    const flag = values[index];
    if (flag === "--yes") {
      if (approved) invalidUsage("--yes was supplied more than once");
      approved = true;
      continue;
    }
    const value = values[index + 1];
    if (value === undefined) invalidUsage(`${flag} requires a value`);
    index += 1;
    if (flag === "--plan") {
      if (planDigest !== undefined) invalidUsage("--plan was supplied more than once");
      planDigest = value;
    } else {
      invalidUsage(`unknown apply argument ${flag}`);
    }
  }
  if (!approved) invalidUsage("apply requires explicit --yes approval");
  if (planDigest === undefined) {
    invalidUsage("apply requires the reviewed --plan");
  }
  return { projectPath, planDigest };
}

function parseRunArguments(values: readonly string[]): {
  readonly projectPath: string;
  readonly requests: readonly StartRootRunRequest[];
} {
  const projectPath = values[0];
  if (projectPath === undefined) invalidUsage("run requires <project-root>");
  const requests: StartRootRunRequest[] = [];
  for (let index = 1; index < values.length; index += 1) {
    const flag = values[index];
    const value = values[index + 1];
    if (value === undefined) invalidUsage(`${flag} requires a value`);
    index += 1;
    if (flag === "--request") {
      try { requests.push(JSON.parse(value) as StartRootRunRequest); }
      catch { invalidUsage("--request must contain valid JSON"); }
    } else {
      invalidUsage(`unknown run argument ${flag}`);
    }
  }
  return { projectPath, requests };
}

async function main(values: readonly string[]): Promise<object> {
  const [command, ...rest] = values;
  if (command === "plan") {
    if (rest.length !== 1) invalidUsage("usage: private-foreground plan <project-root>");
    return await plan(rest[0]!);
  }
  if (command === "apply") return await apply(parseApplyArguments(rest));
  if (command === "run") return await run(parseRunArguments(rest));
  invalidUsage(
    "usage: private-foreground <plan <project-root> | " +
      "apply <project-root> --plan <digest> --yes | " +
      "run <project-root> --request <json>...>",
  );
}

if (import.meta.main) {
  try {
    process.stdout.write(`${JSON.stringify(await main(process.argv.slice(2)))}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify(foregroundError(error))}\n`);
    process.exitCode = 1;
  }
}

function invalidUsage(message: string): never {
  throw new ProjectAdministrationError("INVALID_REQUEST", message);
}

function foregroundError(error: unknown): Readonly<{ code: string; message: string }> {
  if (error instanceof ProjectAdministrationError || error instanceof RootAdministrationError) {
    const value = error.toJSON();
    return Object.freeze({ code: value.code, message: value.message });
  }
  return Object.freeze({ code: "INTERNAL", message: "private foreground operation failed" });
}
