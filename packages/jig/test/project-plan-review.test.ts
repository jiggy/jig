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
        bindings: { review: { packagePath: "flows/old", attachments: {}, slots: {} } },
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
          bindings: { review: { packagePath: "flows/new", attachments: {}, slots: {} } },
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

  test("indexes changing-universe slot additions, removals, and referenced target revisions", () => {
    const digest = `sha256:${"a".repeat(64)}`;
    const revisedDigest = `sha256:${"c".repeat(64)}`;
    const review = reviewPlan("admission", `sha256:${"b".repeat(64)}`);
    const flowA = { kind: "flow" as const, path: "flows/a" };
    const flowB = { kind: "flow" as const, path: "flows/b" };
    const flowC = { kind: "flow" as const, path: "flows/c" };
    const currentLock = lockWithFlowCallSlot("candidates", [flowA, flowC]);
    const proposedLock = lockWithFlowCallSlot("project-run-targets", [flowA, flowB]);
    const currentTargets = [
      activationTarget(flowA, digest, { state: "ready", recipeDigest: "private-a-old" }),
      activationTarget(flowC, digest, { state: "ready", recipeDigest: "private-c" }),
    ];
    const proposedTargets = [
      activationTarget(flowA, revisedDigest, {
        state: "unavailable",
        code: "RUNTIME_UNAVAILABLE",
        evidenceDigests: ["private-a-evidence"],
      }),
      activationTarget(flowB, digest, { state: "ready", recipeDigest: "private-b" }),
    ];
    const text = renderPrivateProjectPlanReview({
      plan: {
        ...review,
        proposed: { ...review.proposed, lock: proposedLock, targets: proposedTargets },
      },
      baseCandidate: {
        lock: currentLock,
        candidate: { targets: currentTargets },
      },
    } as unknown as PrivateActivationReviewPlan).text;

    const value = JSON.parse(text.slice(text.indexOf("{")));
    expect(value.changes.flowCallSlots).toEqual({
      "dispatcher/work": {
        source: { current: "candidates", proposed: "project-run-targets" },
        targets: {
          added: ["flow:flows/b"],
          changed: ["flow:flows/a"],
          removed: ["flow:flows/c"],
        },
      },
    });
    expect(value.current.portablePolicy.bindings.dispatcher.slots.work.source).toBe("candidates");
    expect(value.proposed.portablePolicy.bindings.dispatcher.slots.work.source)
      .toBe("project-run-targets");
    expect(text).not.toContain("private-a-old");
    expect(text).not.toContain("private-a-evidence");
    expect(text).not.toContain("private-b");
    expect(text).not.toContain("private-c");
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
    const dynamicLock = lockWithFlowCallSlot("project-run-targets", [request.target], true);
    const plan = {
      ...base,
      proposed: {
        ...base.proposed,
        lock: dynamicLock,
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
        lock: dynamicLock,
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
    expect(value.changes.flowCallSlots).toEqual({
      "dispatcher/mirror": {
        source: {
          current: "project-run-targets",
          proposed: "project-run-targets",
        },
        targets: {
          added: [],
          changed: ["flow:flows/review"],
          removed: [],
        },
      },
      "dispatcher/work": {
        source: {
          current: "project-run-targets",
          proposed: "project-run-targets",
        },
        targets: {
          added: [],
          changed: ["flow:flows/review"],
          removed: [],
        },
      },
    });
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

function lockWithFlowCallSlot(
  source: "exact" | "candidates" | "project-run-targets",
  targets: readonly ({ readonly kind: "flow"; readonly path: string } |
    { readonly kind: "binding"; readonly id: string })[],
  repeat = false,
) {
  const slot = { kind: "flow-call" as const, source, targets };
  return {
    packages: {},
    bindings: {
      dispatcher: {
        packagePath: "flows/dispatcher",
        attachments: {},
        slots: {
          ...(repeat ? { mirror: slot } : {}),
          work: slot,
        },
      },
    },
    journalPublishers: {},
    hooks: {},
  };
}

function activationTarget(
  target: { readonly kind: "flow"; readonly path: string } |
    { readonly kind: "binding"; readonly id: string },
  packageDigest: string,
  disposition: Readonly<Record<string, unknown>>,
) {
  return {
    request: {
      target,
      mode: "run",
      packagePath: target.kind === "flow" ? target.path : `flows/${target.id}`,
      package: { digest: packageDigest },
      entrypoint: { path: "flow.ts", suffix: "ts" },
      settings: {},
      attachments: {},
      slots: {},
    },
    disposition,
  };
}
