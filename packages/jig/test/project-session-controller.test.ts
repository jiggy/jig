import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ProjectAdministrationError } from "../src/administration/project.js";
import { CheckError } from "../src/diagnostics.js";
import {
  openPrivateProjectSession,
  projectError,
  type PrivateProjectSessionHost,
} from "../src/internal/project-session-controller.js";

const missingPlan = `sha256:${"0".repeat(64)}`;

describe("private finite project session", () => {
  test("revokes every escaped authority and releases the owner exactly once", async () => {
    const root = await mkdtemp(join(tmpdir(), "jig-project-session-"));
    try {
      const session = await openPrivateProjectSession({ directory: root, host: inertHost() });
      const administration = session.rootAdministration;
      const closing = session.close();
      expect(session.close()).toBe(closing);
      await closing;

      await expect(session.plan({ lockMode: "update" })).rejects.toMatchObject({
        code: "PROJECT_CLOSED",
      });
      await expect(session.apply({ planDigest: missingPlan })).rejects.toMatchObject({
        code: "PROJECT_CLOSED",
      });
      await expect(administration.startRun({
        submissionId: "after-close",
        target: { kind: "flow", path: "flows/worker" },
        input: null,
      })).rejects.toMatchObject({ code: "PROJECT_CLOSED" });
      await expect(administration.runStatus({ runId: missingPlan })).rejects.toMatchObject({
        code: "PROJECT_CLOSED",
      });

      const reopened = await openPrivateProjectSession({ directory: root, host: inertHost() });
      await reopened.close();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("preserves an accepted apply error while close waits", async () => {
    const root = await mkdtemp(join(tmpdir(), "jig-project-session-"));
    try {
      const session = await openPrivateProjectSession({ directory: root, host: inertHost() });
      const applying = session.apply({ planDigest: missingPlan });
      const closing = session.close();

      await expect(applying).rejects.toMatchObject({ code: "PLAN_NOT_FOUND" });
      await closing;
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  for (const method of ["startRun", "runStatus"] as const) {
    test(`${method} identity loss revokes the complete session`, async () => {
      const root = await mkdtemp(join(tmpdir(), "jig-project-session-"));
      const moved = `${root}-moved`;
      let session: Awaited<ReturnType<typeof openPrivateProjectSession>> | undefined;
      try {
        session = await openPrivateProjectSession({ directory: root, host: inertHost() });
        const administration = session.rootAdministration;
        await rename(root, moved);
        await mkdir(root);

        const operation = method === "startRun"
          ? administration.startRun({
              submissionId: "identity-loss",
              target: { kind: "flow", path: "flows/worker" },
              input: null,
            })
          : administration.runStatus({ runId: missingPlan });
        await expect(operation).rejects.toMatchObject({ code: "PROJECT_CLOSED" });
        await expect(session.plan({ lockMode: "update" })).rejects.toMatchObject({
          code: "PROJECT_CLOSED",
        });
        await expect(session.close()).rejects.toMatchObject({ code: "UNAVAILABLE" });
        await expect(administration.runStatus({ runId: missingPlan })).rejects.toMatchObject({
          code: "PROJECT_CLOSED",
        });
      } finally {
        await session?.close().catch(() => undefined);
        await rm(root, { recursive: true, force: true });
        await rm(moved, { recursive: true, force: true });
      }
    });
  }

  test("maps acquisition failures to closed sanitized values", async () => {
    const root = join(tmpdir(), `jig-missing-${randomUUID()}`);
    const failure = await openPrivateProjectSession({ directory: root, host: inertHost() })
      .then(() => undefined, (error) => error);
    expect(failure).toBeInstanceOf(ProjectAdministrationError);
    expect(failure).toMatchObject({
      code: "PROJECT_NOT_FOUND",
      message: "project directory is unavailable",
    });
    expect(JSON.stringify(failure)).not.toContain(root);
  });

  test("accepts only bounded project-relative invalid-candidate diagnostics", () => {
    const diagnostic = Object.freeze({
      code: "METADATA_DELIMITER",
      path: "flows/bad/FLOW.md",
      pointer: "",
    });
    const failure = new ProjectAdministrationError(
      "INVALID_CANDIDATE",
      "project candidate is invalid",
      diagnostic,
    );
    expect(failure.diagnostic).toEqual(diagnostic);
    expect(Object.isFrozen(failure.diagnostic)).toBeTrue();
    expect(failure.toJSON()).toEqual({
      code: "INVALID_CANDIDATE",
      message: "project candidate is invalid",
      diagnostic,
    });

    expect(() => new ProjectAdministrationError(
      "INVALID_CANDIDATE",
      "project candidate is invalid",
      { ...diagnostic, path: ".jig/private" },
    )).toThrow("project diagnostic path is invalid");
    expect(() => new ProjectAdministrationError(
      "UNAVAILABLE",
      "project is unavailable",
      diagnostic,
    )).toThrow("project diagnostic requires INVALID_CANDIDATE");
    expect(() => new ProjectAdministrationError(
      "INVALID_CANDIDATE",
      "project candidate is invalid",
      { ...diagnostic, code: "not-stable" },
    )).toThrow("project diagnostic code is invalid");
    expect(() => new ProjectAdministrationError(
      "INVALID_CANDIDATE",
      "project candidate is invalid",
      { ...diagnostic, pointer: "/bad~2pointer" },
    )).toThrow("project diagnostic pointer is invalid");
    const accessor = Object.create(null) as Record<string, unknown>;
    Object.defineProperties(accessor, {
      code: { enumerable: true, get: () => "METADATA_DELIMITER" },
      path: { enumerable: true, value: "flows/bad/FLOW.md" },
    });
    expect(() => new ProjectAdministrationError(
      "INVALID_CANDIDATE",
      "project candidate is invalid",
      accessor as never,
    )).toThrow("project diagnostic is invalid");
    expect(() => new ProjectAdministrationError(
      "INVALID_CANDIDATE",
      "project candidate is invalid",
      new Proxy(diagnostic, {}) as never,
    )).toThrow("project diagnostic is invalid");
  });

  test("admits only source diagnostic code families and closes private state codes", () => {
    const privateFailure = new CheckError(
      "invalid",
      "ADMISSION_STATE_CORRUPT",
      "private admission detail",
      "flows/apparently-public",
    );
    expect(projectError(privateFailure, "plan").toJSON()).toEqual({
      code: "INTERNAL",
      message: "plan failed",
    });

    const protectedFailure = new CheckError(
      "invalid",
      "METADATA_DELIMITER",
      "protected detail",
      ".jig/activation.sqlite",
    );
    expect(projectError(protectedFailure, "plan").toJSON()).toEqual({
      code: "INVALID_CANDIDATE",
      message: "project candidate is invalid",
    });

    const sourceFailure = new CheckError(
      "invalid",
      "METADATA_DELIMITER",
      "project-controlled text which must not cross the boundary",
      "flows/bad/FLOW.md",
    );
    expect(projectError(sourceFailure, "plan").toJSON()).toEqual({
      code: "INVALID_CANDIDATE",
      message: "project candidate is invalid",
      diagnostic: {
        code: "METADATA_DELIMITER",
        path: "flows/bad/FLOW.md",
      },
    });

    const slotFailure = new CheckError(
      "invalid",
      "PROJECT_BINDING_SLOT_MISSING",
      "project-controlled slot detail",
      "bindings/router.ts",
      "/slots/work",
    );
    expect(projectError(slotFailure, "plan").toJSON()).toEqual({
      code: "INVALID_CANDIDATE",
      message: "project candidate is invalid",
      diagnostic: {
        code: "PROJECT_BINDING_SLOT_MISSING",
        path: "bindings/router.ts",
        pointer: "/slots/work",
      },
    });
  });
});

function inertHost(): PrivateProjectSessionHost {
  return Object.freeze({
    backend: Object.freeze({}) as never,
    installedBunSupport: Object.freeze({}) as never,
    runTimeoutMs: 1_000,
  });
}
