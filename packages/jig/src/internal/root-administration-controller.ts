import {
  RootAdministrationError,
  normalizeRootRunStatusRequest,
  normalizeStartRootRunRequest,
  snapshotRootAdministrationJson,
  type RootAdministration,
  type RootRunStatus,
  type RootRunStatusRequest,
  type StartRootRunReceipt,
  type StartRootRunRequest,
} from "../administration/root.js";
import { CheckError } from "../diagnostics.js";
import {
  completePrivateRootRun,
  loadPrivateRootRun,
  openPrivateProjectCoordinator,
  submitPrivateRootRun,
  type PrivateProjectCoordinator,
  type PrivateRootRunLaunch,
  type PrivateRootRunSnapshot,
} from "./activation-admission-store.js";

const MAX_RUN_TIMEOUT_MS = 86_400_000;

export interface PrivateRootAdministrationController {
  readonly administration: RootAdministration;
  /** Wait for work already accepted by this controller and surface host failures. */
  drain(): Promise<void>;
  /** Revoke the authority, cancel active launches, drain, and release ownership. */
  dispose(): Promise<void>;
}

export interface PrivateRootLaunchExecutor {
  (launch: PrivateRootRunLaunch, signal: AbortSignal): Promise<PrivateRootRunSnapshot>;
}

/**
 * Open the one local root-Run controller for a project.
 *
 * The executor is a captured trusted-host mechanism, not a public extension
 * interface and never a value supplied by RootAdministration callers.
 */
export async function openPrivateRootAdministrationController(input: {
  readonly projectRoot: string;
  readonly packageStoreRoot: string;
  readonly runTimeoutMs: number;
  readonly execute: PrivateRootLaunchExecutor;
}): Promise<PrivateRootAdministrationController> {
  requireRunTimeout(input.runTimeoutMs);
  if (typeof input.execute !== "function") throw new TypeError("root Run executor is required");
  let coordinator: PrivateProjectCoordinator;
  try {
    coordinator = await openPrivateProjectCoordinator({ projectRoot: input.projectRoot });
  } catch (error) {
    throw administrationError(error, "open project coordinator");
  }
  try {
    return createController({ ...input, coordinator });
  } catch (error) {
    await coordinator.dispose();
    throw error;
  }
}

function createController(input: {
  readonly projectRoot: string;
  readonly packageStoreRoot: string;
  readonly runTimeoutMs: number;
  readonly execute: PrivateRootLaunchExecutor;
  readonly coordinator: PrivateProjectCoordinator;
}): PrivateRootAdministrationController {
  const cancellation = new AbortController();
  const submissions = new Set<Promise<void>>();
  const tasks = new Set<Promise<void>>();
  const failures: unknown[] = [];
  let closed = false;
  let disposal: Promise<void> | undefined;

  const administration: RootAdministration = Object.freeze({
    async startRun(value: StartRootRunRequest): Promise<StartRootRunReceipt> {
      requireOpen(closed);
      let markSettled!: () => void;
      const unsettled = new Promise<void>((resolve) => { markSettled = resolve; });
      submissions.add(unsettled);
      try {
        const request = normalizeStartRootRunRequest(value);
        const deadlineUnixMs = deadlineFromNow(input.runTimeoutMs);
        const submission = await retryPrivateBusy(() => submitPrivateRootRun({
          coordinator: input.coordinator,
          projectRoot: input.projectRoot,
          packageStoreRoot: input.packageStoreRoot,
          submissionId: request.submissionId,
          target: request.target,
          input: request.input,
          deadlineUnixMs,
        }));
        if (submission.launch !== undefined) schedule(submission.launch);
        return Object.freeze({ runId: submission.run.runId });
      } catch (error) {
        throw administrationError(error, "start root Run");
      } finally {
        submissions.delete(unsettled);
        markSettled();
      }
    },

    async runStatus(value: RootRunStatusRequest): Promise<RootRunStatus> {
      requireOpen(closed);
      const request = normalizeRootRunStatusRequest(value);
      try {
        return projectStatus(await retryPrivateBusy(() => loadPrivateRootRun({
          projectRoot: input.projectRoot,
          runId: request.runId,
        })));
      } catch (error) {
        throw administrationError(error, "read root Run status");
      }
    },
  });

  function schedule(launch: PrivateRootRunLaunch): void {
    let task: Promise<void>;
    task = settleLaunch(launch)
      .catch((error) => { failures.push(error); })
      .finally(() => { tasks.delete(task); });
    tasks.add(task);
  }

  async function settleLaunch(launch: PrivateRootRunLaunch): Promise<void> {
    try {
      const completed = await input.execute(launch, cancellation.signal);
      if (completed.runId !== launch.run.runId || completed.state !== "terminal") {
        throw new Error("trusted root Run executor returned no matching terminal");
      }
    } catch {
      const current = await retryPrivateBusy(() => loadPrivateRootRun({
        projectRoot: input.projectRoot,
        runId: launch.run.runId,
      }));
      if (current.state === "terminal") return;
      await retryPrivateBusy(() => completePrivateRootRun({
        projectRoot: input.projectRoot,
        launch,
        terminal: {
          status: "failed",
          code: cancellation.signal.aborted ? "CANCELLED" : "EXECUTION_FAILED",
          message: cancellation.signal.aborted
            ? "the root Run controller was closed"
            : "the trusted root Run executor failed before publishing a terminal",
          diagnostics: { stderr: "", stderrBytes: 0, stderrTruncated: false },
        },
      }));
    }
  }

  async function drain(): Promise<void> {
    while (submissions.size > 0) await Promise.all([...submissions]);
    while (tasks.size > 0) await Promise.all([...tasks]);
    if (failures.length > 0) {
      const captured = failures.splice(0, failures.length);
      throw new AggregateError(captured, "root Run controller did not settle cleanly");
    }
  }

  const controller: PrivateRootAdministrationController = Object.freeze({
    administration,
    drain,
    dispose(): Promise<void> {
      if (disposal !== undefined) return disposal;
      closed = true;
      cancellation.abort(new Error("root Run controller disposed"));
      disposal = disposeController(drain, input.coordinator);
      return disposal;
    },
  });
  return controller;
}

async function disposeController(
  drain: () => Promise<void>,
  coordinator: PrivateProjectCoordinator,
): Promise<void> {
  const failures: unknown[] = [];
  try { await drain(); } catch (error) { failures.push(error); }
  try { await coordinator.dispose(); } catch (error) { failures.push(error); }
  if (failures.length > 0) throw new AggregateError(failures, "root Run controller cleanup failed");
}

function projectStatus(run: PrivateRootRunSnapshot): RootRunStatus {
  const base = { runId: run.runId, submissionId: run.submissionId, target: run.target };
  const value = run.state === "spawn-intent"
    ? { ...base, state: "pending" as const }
    : { ...base, state: "terminal" as const, terminal: projectTerminal(run) };
  return snapshotRootAdministrationJson(value, "root Run status") as unknown as RootRunStatus;
}

function projectTerminal(run: PrivateRootRunSnapshot): unknown {
  const terminal = run.terminal;
  if (terminal === undefined) throw new Error("terminal root Run has no terminal record");
  if (terminal.status === "succeeded") {
    return {
      status: "succeeded",
      outcome: terminal.result.outcome,
      output: terminal.result.output,
      diagnostics: terminal.diagnostics,
    };
  }
  return terminal;
}

function requireRunTimeout(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_RUN_TIMEOUT_MS) {
    throw new TypeError(`root Run timeout must be between 1 and ${MAX_RUN_TIMEOUT_MS} milliseconds`);
  }
}

function deadlineFromNow(timeoutMs: number): number {
  const deadline = Date.now() + timeoutMs;
  if (!Number.isSafeInteger(deadline)) {
    throw new RootAdministrationError("UNAVAILABLE", "the host cannot represent a root Run deadline");
  }
  return deadline;
}

function requireOpen(closed: boolean): void {
  if (closed) throw new RootAdministrationError("PROJECT_CLOSED", "project authority is closed");
}

async function retryPrivateBusy<T>(action: () => Promise<T>): Promise<T> {
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    try {
      return await action();
    } catch (error) {
      if (!(error instanceof CheckError) || error.code !== "ADMISSION_STATE_BUSY" || attempt === 8) {
        throw error;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, attempt * 10));
    }
  }
  throw new Error("unreachable root administration retry state");
}

function administrationError(error: unknown, operation: string): RootAdministrationError {
  if (error instanceof RootAdministrationError) return error;
  if (error instanceof CheckError) {
    switch (error.code) {
      case "SUBMISSION_CONFLICT":
        return new RootAdministrationError("SUBMISSION_CONFLICT", error.message);
      case "RUN_MISSING":
        return new RootAdministrationError("RUN_NOT_FOUND", "root Run does not exist");
      case "COORDINATOR_BUSY":
      case "ADMISSION_STATE_BUSY":
        return new RootAdministrationError("PROJECT_BUSY", "project is temporarily busy");
      case "COORDINATOR_CLOSED":
        return new RootAdministrationError("PROJECT_CLOSED", "project authority is closed");
      case "ADMISSION_MISSING":
      case "STALE_PLAN":
        return new RootAdministrationError("UNAVAILABLE", "project has no usable active admission");
      default:
        if (error.kind === "unavailable") {
          return new RootAdministrationError("UNAVAILABLE", `${operation} is unavailable`);
        }
    }
  }
  return new RootAdministrationError("INTERNAL", `${operation} failed`);
}
