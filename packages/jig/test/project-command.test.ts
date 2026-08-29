import { describe, expect, test } from "bun:test";

import {
  ProjectAdministrationError,
  type ProjectSession,
} from "../src/administration/project.js";
import type {
  RootAdministration,
  RootRunStatus,
} from "../src/administration/root.js";
import {
  executePrivateFiniteProjectCommand,
  type PrivateFiniteProjectCommandHost,
} from "../src/internal/project-command.js";

const digest = `sha256:${"a".repeat(64)}`;

describe("private finite project commands", () => {
  test("opens and closes exactly one session for plan and apply", async () => {
    const events: string[] = [];
    const session = fakeSession(events);
    const host = fakeHost(session, events);

    expect(await executePrivateFiniteProjectCommand({
      operation: "plan",
      directory: "/project",
      lockMode: "locked",
    }, host)).toEqual({ operation: "plan", result: { state: "unchanged" } });
    expect(events).toEqual(["acquire:/project", "plan:locked", "close"]);

    events.length = 0;
    const applyHost = fakeHost(fakeSession(events), events);
    expect(await executePrivateFiniteProjectCommand({
      operation: "apply",
      directory: "/project",
      planDigest: digest,
    }, applyHost)).toEqual({
      operation: "apply",
      result: { operation: "admission", planDigest: digest },
    });
    expect(events).toEqual(["acquire:/project", `apply:${digest}`, "close"]);
  });

  test("starts one normalized request and waits without a frontend deadline", async () => {
    const events: string[] = [];
    let observations = 0;
    const terminal: RootRunStatus = {
      state: "terminal",
      runId: digest,
      submissionId: "submission-1",
      target: { kind: "flow", path: "flows/work" },
      terminal: {
        status: "succeeded",
        outcome: "done",
        output: { ok: true },
        diagnostics: { stderr: "", stderrBytes: 0, stderrTruncated: false },
      },
    };
    const administration: RootAdministration = {
      async startRun(request) {
        events.push(`start:${request.submissionId}`);
        expect(Object.isFrozen(request)).toBeTrue();
        return { runId: digest };
      },
      async runStatus() {
        observations += 1;
        events.push("status");
        return observations === 1
          ? {
              state: "pending",
              runId: digest,
              submissionId: "submission-1",
              target: { kind: "flow", path: "flows/work" },
            }
          : terminal;
      },
    };
    const session = fakeSession(events, administration);
    const host = fakeHost(session, events, async () => { events.push("pause"); });
    const result = await executePrivateFiniteProjectCommand({
      operation: "run",
      directory: "/project",
      request: {
        submissionId: "submission-1",
        target: { kind: "flow", path: "./flows/work" },
        input: { task: "build" },
      },
    }, host);

    expect(result).toEqual({ operation: "run", result: terminal });
    expect(events).toEqual([
      "acquire:/project",
      "start:submission-1",
      "status",
      "pause",
      "status",
      "close",
    ]);
  });

  test("preserves operation then close failures even when the primary value is undefined", async () => {
    const session = fakeSession([], undefined, {
      plan: undefined,
      close: new Error("close failed"),
    });
    try {
      await executePrivateFiniteProjectCommand({
        operation: "plan",
        directory: "/project",
        lockMode: "update",
      }, fakeHost(session, []));
      throw new Error("expected command failure");
    } catch (error) {
      expect(error).toBeInstanceOf(AggregateError);
      expect((error as AggregateError).errors).toEqual([undefined, expect.any(Error)]);
    }
  });

  test("withholds success when close fails", async () => {
    const session = fakeSession([], undefined, { close: new Error("close failed") });
    await expect(executePrivateFiniteProjectCommand({
      operation: "plan",
      directory: "/project",
      lockMode: "update",
    }, fakeHost(session, []))).rejects.toThrow("close failed");
  });

  test("aborting a pending Run initiates close and rejects the finite command", async () => {
    const events: string[] = [];
    const controller = new AbortController();
    const administration: RootAdministration = {
      async startRun() { return { runId: digest }; },
      async runStatus() {
        return {
          state: "pending",
          runId: digest,
          submissionId: "submission-1",
          target: { kind: "flow", path: "flows/work" },
        };
      },
    };
    const session = fakeSession(events, administration);
    await expect(executePrivateFiniteProjectCommand({
      operation: "run",
      directory: "/project",
      request: {
        submissionId: "submission-1",
        target: { kind: "flow", path: "flows/work" },
        input: null,
      },
    }, fakeHost(session, events, async () => { controller.abort(); }), controller.signal))
      .rejects.toMatchObject({ code: "PROJECT_CLOSED" });
    expect(events.filter((event) => event === "close")).toHaveLength(1);
  });
});

function fakeHost(
  session: ProjectSession,
  events: string[],
  pause?: (milliseconds: number) => Promise<void>,
): PrivateFiniteProjectCommandHost {
  return {
    async acquire(directory) {
      events.push(`acquire:${directory}`);
      return session;
    },
    ...(pause === undefined ? {} : { pause }),
  };
}

function fakeSession(
  events: string[],
  rootAdministration: RootAdministration = {
    async startRun() { throw new Error("not used"); },
    async runStatus() { throw new Error("not used"); },
  },
  failures: { readonly plan?: unknown; readonly close?: unknown } = {},
): ProjectSession {
  let closure: Promise<void> | undefined;
  return {
    rootAdministration,
    async plan(request) {
      events.push(`plan:${request.lockMode}`);
      if (Object.hasOwn(failures, "plan")) throw failures.plan;
      return { state: "unchanged" };
    },
    async apply(request) {
      events.push(`apply:${request.planDigest}`);
      return { operation: "admission", planDigest: request.planDigest };
    },
    close() {
      closure ??= (async () => {
        events.push("close");
        if (Object.hasOwn(failures, "close")) throw failures.close;
      })();
      return closure;
    },
  };
}
