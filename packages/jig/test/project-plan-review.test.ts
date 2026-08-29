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
          packages: {
            "flows/review": {
              digest,
              mode: "run",
              directRun: false,
              attachments: { source: "read" },
              uses: {},
              provides: {},
            },
          },
          bindings: {
            review: {
              packagePath: "flows/review",
              attachments: { source: { source: "workspace", access: "read" } },
              slots: {},
            },
          },
          journalPublishers: {},
          hooks: {},
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
            slots: {},
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
    expect(rendered.text).toContain('"generationEffect": "create"');
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
    expect(Object.isFrozen(rendered)).toBe(true);
  });

  test("distinguishes generation replacement from lock-only repair", () => {
    const admission = reviewPlan("admission", `sha256:${"b".repeat(64)}`);
    const repair = reviewPlan("lock-repair", `sha256:${"b".repeat(64)}`);

    expect(renderPrivateProjectPlanReview({ plan: admission, baseCandidate: null } as PrivateActivationReviewPlan).text)
      .toContain('"generationEffect": "replace"');
    expect(renderPrivateProjectPlanReview({ plan: repair, baseCandidate: null } as PrivateActivationReviewPlan).text)
      .toContain('"generationEffect": "unchanged"');
  });

  test("shows current and proposed state with explicit additions, removals, and changes", () => {
    const digest = `sha256:${"a".repeat(64)}`;
    const plan = reviewPlan("admission", `sha256:${"b".repeat(64)}`);
    const current = {
      lock: {
        packages: { "flows/old": { digest, mode: "run" } },
        bindings: { review: { packagePath: "flows/old" } },
        journalPublishers: {},
        hooks: {},
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
            slots: {},
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
          packages: { "flows/new": { digest, mode: "run" } },
          bindings: { review: { packagePath: "flows/new" } },
          journalPublishers: {},
          hooks: {},
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
            slots: {},
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

  test("marks private target-evidence changes without exposing that evidence", () => {
    const digest = `sha256:${"a".repeat(64)}`;
    const request = {
      target: { kind: "flow", path: "flows/review" },
      mode: "run",
      packagePath: "flows/review",
      package: { digest },
      entrypoint: { path: "flow.ts", suffix: "ts" },
      settings: {},
      attachments: {},
      slots: {},
    };
    const base = reviewPlan("admission", `sha256:${"b".repeat(64)}`);
    const plan = {
      ...base,
      proposed: {
        ...base.proposed,
        targets: [{
          request,
          disposition: {
            state: "ready",
            recipeDigest: "private-new-recipe",
            observationDigest: "private-new-observation",
          },
        }],
      },
    };
    const text = renderPrivateProjectPlanReview({
      plan,
      baseCandidate: {
        lock: { packages: {}, bindings: {}, journalPublishers: {}, hooks: {} },
        candidate: {
          targets: [{
            request,
            disposition: {
              state: "ready",
              recipeDigest: "private-old-recipe",
              observationDigest: "private-old-observation",
            },
          }],
        },
      },
    } as unknown as PrivateActivationReviewPlan).text;

    const value = JSON.parse(text.slice(text.indexOf("{")));
    expect(value.changes.targets.changed).toEqual(["flow:flows/review"]);
    for (const sentinel of [
      "private-old-recipe",
      "private-new-recipe",
      "private-old-observation",
      "private-new-observation",
    ]) expect(text).not.toContain(sentinel);
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
      lock: { packages: {}, bindings: {}, journalPublishers: {}, hooks: {} },
      targets: [],
    },
  } as unknown as PrivateActivationReviewPlan["plan"];
}
