import { describe, expect, test } from "bun:test";

import type { PrivateActivationReviewPlan } from "../src/internal/activation-admission-store.js";
import { renderPrivateProjectPlanReview } from "../src/internal/project-plan-review.js";

describe("private project Plan review", () => {
  test("renders complete portable policy while omitting private host identities", () => {
    const digest = `sha256:${"a".repeat(64)}`;
    const plan = {
      operation: "admission",
      baseGeneration: null,
      lockMode: "update",
      observedLock: { state: "absent" },
      proposed: {
        lockDigest: digest,
        lock: {
          kind: "private-package-project-lock/4",
          packages: {
            "flows/review": {
              digest,
              directRun: false,
              attachments: { source: "read" },
            },
          },
          bindings: {
            review: {
              packagePath: "flows/review",
              settings: {},
              attachments: { source: { source: "workspace", access: "read" } },
            },
          },
        },
        targets: [{
          request: {
            target: { kind: "binding", id: "review" },
            mode: "run",
            packagePath: "flows/review",
            package: { digest },
            entrypoint: { path: "flow.ts", suffix: "ts" },
            settings: {
              style: "focused",
              hidden: "\u202e\u200bline\n\t\u0000é😀",
              "\u202ekey": "value",
            },
            attachments: { source: { source: "workspace", access: "read" } },
            digest: `sha256:${"b".repeat(64)}`,
          },
          disposition: {
            state: "ready",
            recipeDigest: "private-recipe-sentinel",
            observationDigest: "private-observation-sentinel",
          },
        }],
      },
    } as unknown as PrivateActivationReviewPlan["plan"];
    const rendered = renderPrivateProjectPlanReview({ plan, baseCandidate: null } as PrivateActivationReviewPlan);

    expect(rendered.mediaType).toBe("text/plain; charset=utf-8");
    expect(rendered.text).toContain('"packagePath": "flows/review"');
    expect(rendered.text).toContain('"settings": {');
    expect(rendered.text).toContain('"style": "focused"');
    expect(rendered.text).toContain(
      '"hidden": "\\u202e\\u200bline\\n\\t\\u0000\\u00e9\\ud83d\\ude00"',
    );
    expect(rendered.text).toContain('"\\u202ekey": "value"');
    expect(rendered.text).not.toContain("\u202e");
    expect(rendered.text).not.toContain("\u200b");
    expect(rendered.text).not.toContain("é");
    expect([...rendered.text].every((value) => {
      const code = value.codePointAt(0)!;
      return code === 0x0a || code >= 0x20 && code <= 0x7e;
    })).toBe(true);
    expect(rendered.text).toContain('"access": "read"');
    expect(rendered.text).toContain('"state": "ready"');
    expect(rendered.text).not.toContain("private-recipe-sentinel");
    expect(rendered.text).not.toContain("private-observation-sentinel");
    expect(rendered.text).not.toContain("recipeDigest");
    expect(rendered.text).not.toContain("observationDigest");
    expect(rendered.text).not.toContain(digest);
    expect(rendered.text).not.toContain("digest");
    expect(rendered.text).not.toContain('"operation"');
    expect(rendered.text).not.toContain("lockMode");
    expect(Object.isFrozen(rendered)).toBe(true);
  });

  test("does not expose admission operation or generation state", () => {
    const admission = reviewPlan("admission", `sha256:${"b".repeat(64)}`);
    const repair = reviewPlan("lock-repair", `sha256:${"b".repeat(64)}`);

    const admissionText = renderPrivateProjectPlanReview({
      plan: admission,
      baseCandidate: null,
    } as PrivateActivationReviewPlan).text;
    const repairText = renderPrivateProjectPlanReview({
      plan: repair,
      baseCandidate: null,
    } as PrivateActivationReviewPlan).text;
    expect(admissionText).toBe(repairText);
    expect(admissionText).not.toContain("admission");
    expect(admissionText).not.toContain("lock-repair");
    expect(admissionText).not.toContain("generation");
  });

  test("shows current and proposed state with explicit additions, removals, and changes", () => {
    const digest = `sha256:${"a".repeat(64)}`;
    const plan = reviewPlan("admission", `sha256:${"b".repeat(64)}`);
    const current = {
      lock: {
        kind: "private-package-project-lock/4",
        packages: { "flows/old": { digest, directRun: false, attachments: {} } },
        bindings: { review: { packagePath: "flows/old", settings: {}, attachments: {} } },
      },
      candidate: {
        targets: [{
          request: {
            target: { kind: "binding", id: "review" },
            mode: "run",
            packagePath: "flows/old",
            package: { digest },
            entrypoint: { path: "flow.ts", suffix: "ts" },
            settings: {},
            attachments: {},
          },
          disposition: { state: "ready" },
        }],
      },
    };
    const proposed = {
      ...plan,
      proposed: {
        ...plan.proposed,
        lock: {
          kind: "private-package-project-lock/4",
          packages: { "flows/new": { digest, directRun: false, attachments: {} } },
          bindings: { review: { packagePath: "flows/new", settings: {}, attachments: {} } },
        },
        targets: [{
          request: {
            target: { kind: "binding", id: "review" },
            mode: "run",
            packagePath: "flows/new",
            package: { digest },
            entrypoint: { path: "flow.ts", suffix: "ts" },
            settings: {},
            attachments: {},
          },
          disposition: { state: "unavailable", code: "RUNTIME_UNAVAILABLE" },
        }],
      },
    };
    const text = renderPrivateProjectPlanReview({
      plan: proposed,
      baseCandidate: current,
    } as unknown as PrivateActivationReviewPlan).text;

    expect(text).toContain('"current": {');
    expect(text).toContain('"proposed": {');
    const value = JSON.parse(text.slice(text.indexOf("{")));
    expect(value.changes.packages).toEqual({
      added: ["flows/new"],
      changed: [],
      removed: ["flows/old"],
    });
    expect(value.changes.targets.changed).toEqual(["binding:review"]);
  });

  test("fails before allocating a review larger than its public envelope", () => {
    const plan = reviewPlan("admission", `sha256:${"b".repeat(64)}`);
    expect(() => renderPrivateProjectPlanReview({ plan, baseCandidate: null } as PrivateActivationReviewPlan, 64))
      .toThrow(expect.objectContaining({
        code: "UNAVAILABLE",
        message: "project plan review exceeds the supported display size",
      }));
  });
});

function reviewPlan(
  operation: "admission" | "lock-repair",
  baseGeneration: string,
): PrivateActivationReviewPlan["plan"] {
  const digest = `sha256:${"a".repeat(64)}`;
  return {
    operation,
    baseGeneration,
    lockMode: "update",
    observedLock: { state: "absent" },
    proposed: {
      lockDigest: digest,
      lock: { kind: "private-package-project-lock/4", packages: {}, bindings: {} },
      targets: [],
    },
  } as unknown as PrivateActivationReviewPlan["plan"];
}
