import { setTimeout as delay } from "node:timers/promises";

import {
  ProjectAdministrationError,
  type ProjectApplyReceipt,
  type ProjectSession,
  type ProjectPlanResult,
} from "../administration/project.js";
import {
  normalizeStartRootRunRequest,
  type RootAdministration,
  type RootRunStatus,
  type StartRootRunRequest,
} from "../administration/root.js";

export type PrivateFiniteProjectCommand =
  | {
      readonly operation: "plan";
      readonly directory: string;
      readonly lockMode: "update" | "locked";
    }
  | {
      readonly operation: "apply";
      readonly directory: string;
      readonly planDigest: string;
    }
  | {
      readonly operation: "run";
      readonly directory: string;
      readonly request: StartRootRunRequest;
    };

export type PrivateFiniteProjectCommandResult =
  | { readonly operation: "plan"; readonly result: ProjectPlanResult }
  | { readonly operation: "apply"; readonly result: ProjectApplyReceipt }
  | { readonly operation: "run"; readonly result: RootRunStatus };

export interface PrivateFiniteProjectCommandHost {
  acquire(directory: string): Promise<ProjectSession>;
  pause?(milliseconds: number): Promise<void>;
}

/**
 * Proof-independent finite command orchestration. Acquisition remains a
 * trusted-host responsibility and is deliberately not a public constructor.
 */
export async function executePrivateFiniteProjectCommand(
  command: PrivateFiniteProjectCommand,
  host: PrivateFiniteProjectCommandHost,
  signal?: AbortSignal,
): Promise<PrivateFiniteProjectCommandResult> {
  signal?.throwIfAborted();
  const normalized = command.operation === "run"
    ? { ...command, request: normalizeStartRootRunRequest(command.request) }
    : command;
  const session = await host.acquire(normalized.directory);
  const onAbort = () => { void session.close().catch(() => undefined); };
  signal?.addEventListener("abort", onAbort, { once: true });

  let failed = false;
  let failure: unknown;
  let result: PrivateFiniteProjectCommandResult | undefined;
  try {
    if (normalized.operation === "plan") {
      result = Object.freeze({
        operation: "plan" as const,
        result: await session.plan({ lockMode: normalized.lockMode }),
      });
    } else if (normalized.operation === "apply") {
      result = Object.freeze({
        operation: "apply" as const,
        result: await session.apply({ planDigest: normalized.planDigest }),
      });
    } else {
      const receipt = await session.rootAdministration.startRun(normalized.request);
      result = Object.freeze({
        operation: "run" as const,
        result: await waitForTerminal(
          session.rootAdministration,
          receipt.runId,
          host.pause ?? defaultPause,
          signal,
        ),
      });
    }
  } catch (error) {
    failed = true;
    failure = error;
  }

  let closeFailed = false;
  let closeFailure: unknown;
  try {
    await session.close();
  } catch (error) {
    closeFailed = true;
    closeFailure = error;
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }

  if (failed && closeFailed) {
    throw new AggregateError(
      [failure, closeFailure],
      "project command and project close both failed",
    );
  }
  if (failed) throw failure;
  if (closeFailed) throw closeFailure;
  return result!;
}

async function waitForTerminal(
  administration: RootAdministration,
  runId: string,
  pause: (milliseconds: number) => Promise<void>,
  signal?: AbortSignal,
): Promise<RootRunStatus> {
  while (true) {
    if (signal?.aborted) {
      throw new ProjectAdministrationError("PROJECT_CLOSED", "project command was interrupted");
    }
    const status = await administration.runStatus({ runId });
    if (status.state === "terminal") return status;
    await pause(10);
  }
}

async function defaultPause(milliseconds: number): Promise<void> {
  await delay(milliseconds);
}
