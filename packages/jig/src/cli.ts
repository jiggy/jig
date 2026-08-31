#!/usr/bin/env bun

import { randomBytes } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { setTimeout as delay } from "node:timers/promises";

import {
  ProjectAdministrationError,
  type ProjectSession,
} from "./administration/project.js";
import {
  RootAdministrationError,
  type RootAdministration,
  type RootRunStatus,
  type RootRunTerminal,
} from "./administration/root.js";
import { BareInitError, initializeBareProject } from "./bare-init.js";
import { canonicalJson, decodeJson1, type JsonValue } from "./json.js";
import { bindingRef, flowRef, type RunTargetRef } from "./project/author.js";

const HELP = `Usage:
  jig init --bare <directory>
  jig check [project] [--yes]
  jig run <flow:path|binding:id> [--input JSON]`;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/** Private injection seam until the installed host owns project acquisition. */
export interface PrivateCliCommandHost {
  acquire(project: string): Promise<ProjectSession>;
  pause?(milliseconds: number): Promise<void>;
}

export interface PrivateCliOptions {
  readonly host?: PrivateCliCommandHost;
  readonly currentDirectory?: string;
  readonly signal?: AbortSignal;
  readonly interactive?: boolean;
  readonly confirm?: (prompt: string, signal?: AbortSignal) => Promise<boolean>;
  readonly writeOutput?: (text: string) => void;
  readonly writeError?: (text: string) => void;
  readonly createSubmissionId?: () => string;
}

interface CliRuntime {
  readonly host: PrivateCliCommandHost;
  readonly currentDirectory: string;
  readonly signal?: AbortSignal;
  readonly interactive: boolean;
  readonly confirm: (prompt: string, signal?: AbortSignal) => Promise<boolean>;
  readonly writeOutput: (text: string) => void;
  readonly writeError: (text: string) => void;
  readonly createSubmissionId: () => string;
}

class CliDiagnostic extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly exitCode: 1 | 2,
  ) {
    super(message);
    this.name = "CliDiagnostic";
  }
}

export async function main(
  arguments_: readonly string[] = process.argv.slice(2),
  options: PrivateCliOptions = {},
): Promise<number> {
  const runtime = cliRuntime(options);
  if (arguments_.length === 1 && (arguments_[0] === "--help" || arguments_[0] === "-h")) {
    runtime.writeOutput(`${HELP}\n`);
    return 0;
  }

  try {
    if (arguments_[0] === "init") return await executeInit(arguments_, runtime);
    if (arguments_[0] === "check") return await executeCheck(arguments_, runtime);
    if (arguments_[0] === "run") return await executeRun(arguments_, runtime);
    runtime.writeError(`${HELP}\n`);
    return 2;
  } catch (error) {
    if (runtime.signal?.aborted) {
      runtime.writeError(renderDiagnostic("JIG_COMMAND_INTERRUPTED", "the command was interrupted"));
      return 2;
    }
    return renderFailure(error, runtime);
  }
}

async function executeInit(arguments_: readonly string[], runtime: CliRuntime): Promise<number> {
  if (arguments_.length !== 3 || arguments_[1] !== "--bare") {
    runtime.writeError(`${HELP}\n`);
    return 2;
  }
  try {
    await initializeBareProject(arguments_[2]!);
    runtime.writeOutput("created bare Jig project\n");
    return 0;
  } catch (error) {
    if (error instanceof BareInitError) {
      runtime.writeError(renderDiagnostic(error.code, error.message));
      return error.kind === "invalid" ? 1 : 2;
    }
    throw error;
  }
}

async function executeCheck(arguments_: readonly string[], runtime: CliRuntime): Promise<number> {
  const parsed = parseCheck(arguments_, runtime.currentDirectory);
  return await withProjectSession(parsed.project, runtime, async (session) => {
    const plan = await session.plan({ lockMode: "update" });
    if (plan.state === "unchanged") {
      runtime.writeOutput("project is ready\n");
      return 0;
    }

    runtime.writeOutput(plan.review.text.endsWith("\n") ? plan.review.text : `${plan.review.text}\n`);
    if (!parsed.yes) {
      if (!runtime.interactive) {
        throw new CliDiagnostic(
          "JIG_APPROVAL_REQUIRED",
          "project changes require confirmation; rerun with --yes",
          2,
        );
      }
      const accepted = await runtime.confirm("Apply these project changes? [y/N] ", runtime.signal);
      if (!accepted) {
        runtime.writeError(renderDiagnostic("JIG_CHANGES_DECLINED", "project changes were not applied"));
        return 1;
      }
    }

    runtime.signal?.throwIfAborted();
    await session.apply({ planDigest: plan.planDigest });
    runtime.writeOutput("project is ready\n");
    return 0;
  });
}

async function executeRun(arguments_: readonly string[], runtime: CliRuntime): Promise<number> {
  const parsed = parseRun(arguments_);
  const status = await withProjectSession(runtime.currentDirectory, runtime, async (session) => {
    const receipt = await session.rootAdministration.startRun({
      submissionId: runtime.createSubmissionId(),
      target: parsed.target,
      input: parsed.input,
    });
    return await waitForTerminal(
      session.rootAdministration,
      receipt.runId,
      runtime.host.pause ?? defaultPause,
      runtime.signal,
    );
  });
  runtime.writeOutput(`${textDecoder.decode(canonicalJson(publicTerminal(status.terminal)))}\n`);
  return status.terminal.status === "succeeded" ? 0 : status.terminal.status === "failed" ? 1 : 2;
}

function parseCheck(
  arguments_: readonly string[],
  currentDirectory: string,
): { readonly project: string; readonly yes: boolean } {
  if (arguments_.length === 1) return { project: currentDirectory, yes: false };
  if (arguments_.length === 2 && arguments_[1] === "--yes") {
    return { project: currentDirectory, yes: true };
  }
  if (arguments_.length === 2 && !arguments_[1]!.startsWith("-")) {
    return { project: arguments_[1]!, yes: false };
  }
  if (arguments_.length === 3 && !arguments_[1]!.startsWith("-") && arguments_[2] === "--yes") {
    return { project: arguments_[1]!, yes: true };
  }
  throw new CliDiagnostic("JIG_USAGE", HELP, 2);
}

function parseRun(
  arguments_: readonly string[],
): { readonly target: RunTargetRef; readonly input: JsonValue } {
  if (arguments_.length !== 2 && arguments_.length !== 4 ||
      arguments_.length === 4 && arguments_[2] !== "--input") {
    throw new CliDiagnostic("JIG_USAGE", HELP, 2);
  }
  const target = parseTarget(arguments_[1]!);
  if (arguments_.length === 2) return { target, input: {} };
  try {
    return { target, input: decodeJson1(textEncoder.encode(arguments_[3]!)) };
  } catch {
    throw new CliDiagnostic("JIG_RUN_INPUT_INVALID", "--input must be FLOW JSON/1", 1);
  }
}

function parseTarget(value: string): RunTargetRef {
  try {
    if (value.startsWith("flow:")) return flowRef(value.slice("flow:".length));
    if (value.startsWith("binding:")) return bindingRef(value.slice("binding:".length));
  } catch {
    // The public diagnostic intentionally does not repeat project-controlled input.
  }
  throw new CliDiagnostic(
    "JIG_RUN_TARGET_INVALID",
    "the target must be flow:<path> or binding:<id>",
    1,
  );
}

async function withProjectSession<T>(
  project: string,
  runtime: CliRuntime,
  operation: (session: ProjectSession) => Promise<T>,
): Promise<T> {
  runtime.signal?.throwIfAborted();
  const session = await runtime.host.acquire(project);
  let closePromise: Promise<void> | undefined;
  const close = () => closePromise ??= session.close();
  const onAbort = () => { void close().catch(() => undefined); };
  runtime.signal?.addEventListener("abort", onAbort, { once: true });

  let completed = false;
  let result: T | undefined;
  let failure: unknown;
  try {
    runtime.signal?.throwIfAborted();
    result = await operation(session);
    completed = true;
  } catch (error) {
    failure = error;
  }

  let closeFailed = false;
  let closeFailure: unknown;
  try {
    await close();
  } catch (error) {
    closeFailed = true;
    closeFailure = error;
  } finally {
    runtime.signal?.removeEventListener("abort", onAbort);
  }

  if (!completed && closeFailed) {
    throw new AggregateError([failure, closeFailure], "project command and close both failed");
  }
  if (!completed) throw failure;
  if (closeFailed) throw closeFailure;
  return result as T;
}

async function waitForTerminal(
  administration: RootAdministration,
  runId: string,
  pause: (milliseconds: number) => Promise<void>,
  signal?: AbortSignal,
): Promise<Extract<RootRunStatus, { readonly state: "terminal" }>> {
  while (true) {
    signal?.throwIfAborted();
    const status = await administration.runStatus({ runId });
    if (status.state === "terminal") return status;
    await pause(10);
  }
}

function publicTerminal(terminal: RootRunTerminal): JsonValue {
  if (terminal.status === "succeeded") {
    return {
      status: terminal.status,
      outcome: terminal.outcome,
      output: terminal.output,
      diagnostics: terminal.diagnostics,
    } as unknown as JsonValue;
  }
  if (terminal.status === "failed") {
    return {
      status: terminal.status,
      code: terminal.code,
      message: terminal.message,
      ...(terminal.details === undefined ? {} : { details: terminal.details }),
      diagnostics: terminal.diagnostics,
    } as unknown as JsonValue;
  }
  return {
    status: terminal.status,
    code: terminal.code,
    message: terminal.message,
  };
}

function cliRuntime(options: PrivateCliOptions): CliRuntime {
  return {
    host: options.host ?? unavailableHost,
    currentDirectory: options.currentDirectory ?? process.cwd(),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    interactive: options.interactive ?? (process.stdin.isTTY === true && process.stdout.isTTY === true),
    confirm: options.confirm ?? terminalConfirmation,
    writeOutput: options.writeOutput ?? ((text) => { process.stdout.write(text); }),
    writeError: options.writeError ?? ((text) => { process.stderr.write(text); }),
    createSubmissionId: options.createSubmissionId ?? (() => `jig-cli-${randomBytes(16).toString("hex")}`),
  };
}

const unavailableHost: PrivateCliCommandHost = {
  async acquire() {
    throw new ProjectAdministrationError("UNAVAILABLE", "the installed Jig host is unavailable");
  },
};

async function terminalConfirmation(prompt: string, signal?: AbortSignal): Promise<boolean> {
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = signal === undefined
      ? await terminal.question(prompt)
      : await terminal.question(prompt, { signal });
    return /^(?:y|yes)$/i.test(answer.trim());
  } finally {
    terminal.close();
  }
}

async function defaultPause(milliseconds: number): Promise<void> {
  await delay(milliseconds);
}

function renderFailure(error: unknown, runtime: CliRuntime): 1 | 2 {
  if (error instanceof CliDiagnostic) {
    runtime.writeError(error.code === "JIG_USAGE" ? `${error.message}\n` : renderDiagnostic(error.code, error.message));
    return error.exitCode;
  }
  if (error instanceof ProjectAdministrationError) {
    const projected = projectError(error.code);
    runtime.writeError(renderDiagnostic(error.code, projected.message));
    return projected.exitCode;
  }
  if (error instanceof RootAdministrationError) {
    const projected = rootError(error.code);
    runtime.writeError(renderDiagnostic(error.code, projected.message));
    return projected.exitCode;
  }
  runtime.writeError(renderDiagnostic("JIG_COMMAND_UNAVAILABLE", "the command could not be completed"));
  return 2;
}

function projectError(code: ProjectAdministrationError["code"]): {
  readonly message: string;
  readonly exitCode: 1 | 2;
} {
  const invalid = code === "INVALID_REQUEST" || code === "PROJECT_NOT_FOUND" ||
    code === "PROJECT_UNSAFE" || code === "INVALID_CANDIDATE" || code === "LOCK_MISMATCH" ||
    code === "PLAN_NOT_FOUND" || code === "STALE_PLAN";
  const messages: Record<ProjectAdministrationError["code"], string> = {
    INVALID_REQUEST: "the project request is invalid",
    PROJECT_NOT_FOUND: "the project was not found",
    PROJECT_UNSAFE: "the project cannot be opened safely",
    INVALID_CANDIDATE: "the project definition is invalid",
    LOCK_MISMATCH: "the project lock does not match the reviewed state",
    PLAN_NOT_FOUND: "the reviewed project changes are no longer available",
    STALE_PLAN: "the project changed before its review could be applied",
    PROJECT_BUSY: "the project is already in use",
    PROJECT_CLOSED: "the project session is closed",
    UNAVAILABLE: "the project command is unavailable",
    INTERNAL: "the project command failed",
  };
  return { message: messages[code], exitCode: invalid ? 1 : 2 };
}

function rootError(code: RootAdministrationError["code"]): {
  readonly message: string;
  readonly exitCode: 1 | 2;
} {
  const invalid = code === "INVALID_REQUEST" || code === "SUBMISSION_CONFLICT" || code === "RUN_NOT_FOUND";
  const messages: Record<RootAdministrationError["code"], string> = {
    INVALID_REQUEST: "the Run request is invalid",
    SUBMISSION_CONFLICT: "the Run could not be submitted",
    RUN_NOT_FOUND: "the Run was not found",
    PROJECT_BUSY: "the project is already in use",
    PROJECT_CLOSED: "the project session is closed",
    UNAVAILABLE: "the Run command is unavailable",
    INTERNAL: "the Run command failed",
  };
  return { message: messages[code], exitCode: invalid ? 1 : 2 };
}

function renderDiagnostic(code: string, message: string): string {
  return `${code}: ${message}\n`;
}

if (import.meta.main) {
  const controller = new AbortController();
  const interrupt = () => { controller.abort(); };
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  try {
    process.exitCode = await main(process.argv.slice(2), { signal: controller.signal });
  } finally {
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", interrupt);
  }
}
