import { describe, expect, test } from "bun:test";

import {
  decodePrivateServiceMountAcknowledged,
  decodePrivateServiceMountBacking,
  decodePrivateServiceMountClosure,
  decodePrivateServiceMountFence,
  decodePrivateServiceMountGeneration,
  decodePrivateServiceMountPlan,
  decodePrivateServiceMountPrepared,
  decodePrivateServiceMountProvisional,
  decodePrivateServiceMountRelease,
  decodePrivateServiceMountSandbox,
  decodePrivateServiceInvocationAllocation,
  decodePrivateServiceInvocationClosure,
  decodePrivateServiceInvocationDispatch,
  decodePrivateServiceInvocationTerminal,
  decodePrivateServiceLeaseAllocation,
  decodePrivateServiceLeaseRelease,
  decodePrivateServiceMountAllocation,
  encodePrivateServiceMountAcknowledged,
  encodePrivateServiceMountBacking,
  encodePrivateServiceMountClosure,
  encodePrivateServiceMountFence,
  encodePrivateServiceMountGeneration,
  encodePrivateServiceMountPlan,
  encodePrivateServiceMountPrepared,
  encodePrivateServiceMountProvisional,
  encodePrivateServiceMountRelease,
  encodePrivateServiceMountSandbox,
  encodePrivateServiceInvocationAllocation,
  encodePrivateServiceInvocationClosure,
  encodePrivateServiceInvocationDispatch,
  encodePrivateServiceInvocationTerminal,
  encodePrivateServiceLeaseAllocation,
  encodePrivateServiceLeaseRelease,
  encodePrivateServiceMountAllocation,
  normalizePrivateServiceMountAcknowledged,
  normalizePrivateServiceMountBacking,
  normalizePrivateServiceMountClosure,
  normalizePrivateServiceMountFence,
  normalizePrivateServiceMountGeneration,
  normalizePrivateServiceMountPlan,
  normalizePrivateServiceMountPrepared,
  normalizePrivateServiceMountProvisional,
  normalizePrivateServiceMountRelease,
  normalizePrivateServiceMountSandbox,
  normalizePrivateServiceInvocationAllocation,
  normalizePrivateServiceInvocationClosure,
  normalizePrivateServiceInvocationDispatch,
  normalizePrivateServiceInvocationTerminal,
  normalizePrivateServiceLeaseAllocation,
  normalizePrivateServiceLeaseRelease,
  normalizePrivateServiceMountAllocation,
  privateServiceMountAcknowledgedDigest,
  privateServiceMountBackingDigest,
  privateServiceMountClosureDigest,
  privateServiceMountFenceDigest,
  privateServiceMountGenerationDigest,
  privateServiceMountPlanDigest,
  privateServiceMountPreparedDigest,
  privateServiceMountProvisionalDigest,
  privateServiceMountReleaseDigest,
  privateServiceMountSandboxDigest,
  privateServiceInvocationAllocationDigest,
  privateServiceInvocationClosureDigest,
  privateServiceInvocationDispatchDigest,
  privateServiceInvocationRequestDigest,
  privateServiceInvocationTerminalDigest,
  privateServiceLeaseAllocationDigest,
  privateServiceLeaseReleaseDigest,
  privateServiceMountAllocationDigest,
} from "../src/internal/private-service-state.js";
import { privateDomainDigest } from "../src/internal/identity.js";
import type { JsonValue } from "../src/json.js";

const encoder = new TextEncoder();
const id = (character: string): string => `sha256:${character.repeat(64)}`;
const diagnostics = Object.freeze({ stderr: "", stderrBytes: 0, stderrTruncated: false });

describe("private Service durable state", () => {
  test("canonically identifies one exact Mount allocation", () => {
    const allocation = mountAllocation();
    const normalized = normalizePrivateServiceMountAllocation(allocation);

    expect(normalized).toEqual(allocation);
    expect(Object.isFrozen(normalized)).toBeTrue();
    expect(Object.isFrozen(normalized.expectedExports)).toBeTrue();
    expect(decodePrivateServiceMountAllocation(
      encodePrivateServiceMountAllocation(normalized),
    )).toEqual(normalized);
    expect(privateServiceMountAllocationDigest(normalized)).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(privateServiceMountAllocationDigest({
      ...allocation,
      effectiveDeadlineUnixMs: allocation.effectiveDeadlineUnixMs + 1,
    })).not.toBe(privateServiceMountAllocationDigest(allocation));

    expect(() => normalizePrivateServiceMountAllocation({
      ...allocation,
      expectedExports: ["counter", "audit"],
    })).toThrow("unique and sorted");
    expect(() => normalizePrivateServiceMountAllocation({ ...allocation, ambientRuntime: "bun" }))
      .toThrow("contain exactly");
    expect(() => decodePrivateServiceMountAllocation(encoder.encode(
      ` ${new TextDecoder().decode(encodePrivateServiceMountAllocation(allocation))}`,
    ))).toThrow("not canonical JSON/1");
  });

  test("canonically links the exact Mount preparation and readiness chain", () => {
    const state = mountLifecycle();
    expect(decodePrivateServiceMountPlan(encodePrivateServiceMountPlan(state.plan))).toEqual(state.plan);
    expect(decodePrivateServiceMountBacking(encodePrivateServiceMountBacking(state.backing)))
      .toEqual(state.backing);
    expect(decodePrivateServiceMountSandbox(encodePrivateServiceMountSandbox(state.sandbox)))
      .toEqual(state.sandbox);
    expect(decodePrivateServiceMountPrepared(encodePrivateServiceMountPrepared(state.prepared)))
      .toEqual(state.prepared);
    expect(decodePrivateServiceMountGeneration(encodePrivateServiceMountGeneration(state.generation)))
      .toEqual(state.generation);
    expect(decodePrivateServiceMountAcknowledged(
      encodePrivateServiceMountAcknowledged(state.acknowledged),
    )).toEqual(state.acknowledged);

    expect(Object.isFrozen(state.plan.packageAllocation)).toBeTrue();
    expect(Object.isFrozen(state.sandbox.owner)).toBeTrue();
    expect(Object.isFrozen(state.prepared.prepared)).toBeTrue();
    expect(privateServiceMountPlanDigest(state.plan)).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(privateServiceMountBackingDigest(state.backing)).toBe(state.sandbox.backingDigest);
    expect(privateServiceMountSandboxDigest(state.sandbox)).toBe(state.prepared.sandboxDigest);
    expect(privateServiceMountPreparedDigest(state.prepared)).toBe(state.generation.preparedDigest);
    expect(privateServiceMountGenerationDigest(state.generation))
      .toBe(state.acknowledged.generationDigest);
    expect(privateServiceMountAcknowledgedDigest(state.acknowledged))
      .toBe(state.provisional.acknowledgedDigest);

    for (const [record, normalize] of [
      [state.plan, normalizePrivateServiceMountPlan],
      [state.backing, normalizePrivateServiceMountBacking],
      [state.sandbox, normalizePrivateServiceMountSandbox],
      [state.prepared, normalizePrivateServiceMountPrepared],
      [state.generation, normalizePrivateServiceMountGeneration],
      [state.acknowledged, normalizePrivateServiceMountAcknowledged],
      [state.provisional, normalizePrivateServiceMountProvisional],
      [state.fence, normalizePrivateServiceMountFence],
      [state.release, normalizePrivateServiceMountRelease],
      [state.closure, normalizePrivateServiceMountClosure],
    ] as const) {
      expect(() => (normalize as (value: unknown) => unknown)({ ...record, ambient: true }))
        .toThrow("must contain exactly");
    }

    expect(() => normalizePrivateServiceMountGeneration({
      ...state.generation,
      exports: ["z", "a"],
    })).toThrow("unique and sorted");
    expect(() => normalizePrivateServiceMountPrepared({
      ...state.prepared,
      prepared: { ...state.prepared.prepared, digest: id("f") },
    })).toThrow("prepared Linux owner identity is invalid");
  });

  test("makes Mount terminal classification and readiness evidence exact", () => {
    const state = mountLifecycle();
    const checkpoint = (
      classification: string,
      terminal: unknown,
      generationDigest: string | null = state.provisional.generationDigest,
      acknowledgedDigest: string | null = state.provisional.acknowledgedDigest,
    ) => normalizePrivateServiceMountProvisional({
      kind: "private-service-mount-provisional/1",
      mountId: state.allocation.mountId,
      allocationDigest: state.allocationDigest,
      generationDigest,
      acknowledgedDigest,
      classification,
      terminal,
    });
    const succeeded = { status: "succeeded", diagnostics };
    const failed = {
      status: "failed",
      code: "CHANNEL_LOST",
      message: "lost",
      diagnostics,
    };

    for (const classification of ["host-lifetime", "voluntary-exit"]) {
      expect(checkpoint(classification, succeeded).classification).toBe(classification);
      expect(() => checkpoint(classification, failed)).toThrow("requires acknowledged readiness");
      expect(() => checkpoint(classification, succeeded, null, null))
        .toThrow("requires acknowledged readiness");
    }
    for (const classification of [
      "startup-cancelled",
      "readiness-timeout",
      "provider-loss",
      "coordinator-loss",
    ]) {
      const acknowledged = classification === "startup-cancelled" || classification === "readiness-timeout"
        ? null
        : state.provisional.acknowledgedDigest;
      const classifiedFailure = {
        ...failed,
        code: classification === "startup-cancelled"
          ? "CANCELLED"
          : classification === "readiness-timeout"
            ? "DEADLINE_EXCEEDED"
            : classification === "coordinator-loss"
              ? "UNCERTAIN"
              : "CHANNEL_LOST",
      };
      expect(checkpoint(
        classification,
        classifiedFailure,
        state.provisional.generationDigest,
        acknowledged,
      ).classification)
        .toBe(classification);
      expect(() => checkpoint(
        classification,
        succeeded,
        state.provisional.generationDigest,
        acknowledged,
      )).toThrow("requires a failed terminal");
    }
    expect(() => checkpoint("provider-loss", failed, null, state.provisional.acknowledgedDigest))
      .toThrow("requires generation evidence");
    expect(() => checkpoint("startup-cancelled", failed))
      .toThrow("cannot follow acknowledged readiness");
    expect(() => checkpoint("startup-cancelled", failed, null, null))
      .toThrow("requires a CANCELLED failure");
    expect(() => checkpoint("readiness-timeout", failed, null, null))
      .toThrow("requires a DEADLINE_EXCEEDED failure");
    expect(() => checkpoint(
      "coordinator-loss",
      failed,
      state.provisional.generationDigest,
      state.provisional.acknowledgedDigest,
    )).toThrow("requires an UNCERTAIN failure");
    expect(decodePrivateServiceMountProvisional(
      encodePrivateServiceMountProvisional(state.provisional),
    )).toEqual(state.provisional);
    expect(privateServiceMountProvisionalDigest(state.provisional)).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  test("requires typed fencing, exhaustive release evidence, and final closure", () => {
    const state = mountLifecycle();
    expect(decodePrivateServiceMountFence(encodePrivateServiceMountFence(state.fence))).toEqual(state.fence);
    expect(decodePrivateServiceMountRelease(encodePrivateServiceMountRelease(state.release)))
      .toEqual(state.release);
    expect(decodePrivateServiceMountClosure(encodePrivateServiceMountClosure(state.closure)))
      .toEqual(state.closure);
    expect(privateServiceMountFenceDigest(state.fence)).toBe(state.release.fenceDigest);
    expect(privateServiceMountReleaseDigest(state.release)).toBe(state.closure.releaseDigest);
    expect(privateServiceMountClosureDigest(state.closure)).toMatch(/^sha256:[0-9a-f]{64}$/);

    const earlyProvisional = normalizePrivateServiceMountProvisional({
      kind: "private-service-mount-provisional/1",
      mountId: state.allocation.mountId,
      allocationDigest: state.allocationDigest,
      generationDigest: null,
      acknowledgedDigest: null,
      classification: "provider-loss",
      terminal: { status: "failed", code: "CHANNEL_LOST", message: "lost", diagnostics },
    });
    const cancellationFence = normalizePrivateServiceMountFence({
      ...state.fence,
      provisionalDigest: privateServiceMountProvisionalDigest(earlyProvisional),
      proof: { kind: "allocation-cancelled", cancellation: ownerCancellation() },
    });
    expect(cancellationFence.proof.kind).toBe("allocation-cancelled");
    expect(() => normalizePrivateServiceMountFence({
      ...state.fence,
      proof: { ...state.fence.proof, ambientCgroup: "/sys/fs/cgroup" },
    })).toThrow("must contain exactly");
    expect(() => normalizePrivateServiceMountFence({
      ...state.fence,
      proof: state.fence.proof.kind === "enforcement-confirmed"
        ? { ...state.fence.proof, receipt: { ...state.fence.proof.receipt, fenced: false } }
        : state.fence.proof,
    })).toThrow("enforcement receipt is invalid");

    expect(() => normalizePrivateServiceMountRelease({
      ...state.release,
      planDigest: null,
    })).toThrow("without a plan");
    expect(() => normalizePrivateServiceMountRelease({
      ...state.release,
      fenceDigest: null,
    })).toThrow("requires fence");
    expect(() => normalizePrivateServiceMountRelease({
      ...state.release,
      leaseReleases: [...state.release.leaseReleases].reverse(),
    })).toThrow("unique and sorted");
    expect(() => normalizePrivateServiceMountRelease({
      ...state.release,
      ownerRelease: { ...state.release.ownerRelease!, digest: id("f") },
    })).toThrow("receipt digest is invalid");

    const withoutPlan = normalizePrivateServiceMountRelease({
      kind: "private-service-mount-release/1",
      mountId: state.allocation.mountId,
      allocationDigest: state.allocationDigest,
      provisionalDigest: privateServiceMountProvisionalDigest(earlyProvisional),
      planDigest: null,
      backingDigest: null,
      fenceDigest: null,
      packageReleased: true,
      ownerRelease: null,
      leaseReleases: [],
    });
    expect(withoutPlan.planDigest).toBeNull();
  });

  test("pins one exact acknowledged generation in a canonical owner lease", () => {
    const allocation = leaseAllocation();
    const normalized = normalizePrivateServiceLeaseAllocation(allocation);
    expect(normalized).toEqual(allocation);
    expect(Object.isFrozen(normalized.contract)).toBeTrue();
    expect(decodePrivateServiceLeaseAllocation(
      encodePrivateServiceLeaseAllocation(normalized),
    )).toEqual(normalized);
    expect(privateServiceLeaseAllocationDigest(normalized)).toMatch(/^sha256:[0-9a-f]{64}$/);

    expect(() => normalizePrivateServiceLeaseAllocation({
      ...allocation,
      contract: { ...allocation.contract, version: "^1.0.0" },
    })).toThrow("version is invalid");
    expect(() => normalizePrivateServiceLeaseAllocation({
      ...allocation,
      providerExport: "Counter",
    })).toThrow("provider export is invalid");
  });

  test("closes one lease over a sorted complete invocation set", () => {
    const release = normalizePrivateServiceLeaseRelease({
      kind: "private-service-lease-release/1",
      ownerRunId: id("a"),
      slot: "counter",
      allocationDigest: id("b"),
      reason: "owner-closed",
      mountFenceDigest: null,
      invocations: [
        { operationId: "counter:1", closureDigest: id("c") },
        { operationId: "counter:2", closureDigest: id("d") },
      ],
    });
    expect(decodePrivateServiceLeaseRelease(encodePrivateServiceLeaseRelease(release))).toEqual(release);
    expect(privateServiceLeaseReleaseDigest(release)).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(() => normalizePrivateServiceLeaseRelease({
      ...release,
      invocations: [...release.invocations].reverse(),
    })).toThrow("unique, sorted operation IDs");
    expect(() => normalizePrivateServiceLeaseRelease({
      ...release,
      reason: "provider-lost",
    })).toThrow("requires Mount fence evidence");
    expect(() => normalizePrivateServiceLeaseRelease({
      ...release,
      mountFenceDigest: id("e"),
    })).toThrow("cannot carry Mount fence evidence");
  });

  test("separates caller replay equality from the host-owned invocation deadline", () => {
    const call = {
      operationId: "counter:1",
      slot: "counter",
      method: "next",
      input: { amount: 1 },
    };
    const requestDigest = privateServiceInvocationRequestDigest({
      slot: call.slot,
      method: call.method,
      input: call.input,
    });
    const allocation = invocationAllocation(call, requestDigest);
    const normalized = normalizePrivateServiceInvocationAllocation(allocation);

    expect(decodePrivateServiceInvocationAllocation(
      encodePrivateServiceInvocationAllocation(normalized),
    )).toEqual(normalized);
    expect(privateServiceInvocationAllocationDigest({
      ...allocation,
      deadlineUnixMs: allocation.deadlineUnixMs + 1,
    })).not.toBe(privateServiceInvocationAllocationDigest(allocation));
    expect(privateServiceInvocationRequestDigest({
      slot: call.slot,
      method: call.method,
      input: call.input,
    })).toBe(requestDigest);
    expect(() => normalizePrivateServiceInvocationAllocation({
      ...allocation,
      requestDigest: id("f"),
    })).toThrow("does not match");
  });

  test("binds dispatch, terminal observation, and operation closure without replay", () => {
    const allocationDigest = id("1");
    const dispatch = normalizePrivateServiceInvocationDispatch({
      kind: "private-service-invocation-dispatch/1",
      ownerRunId: id("a"),
      operationId: "counter:1",
      allocationDigest,
    });
    const dispatchDigest = privateServiceInvocationDispatchDigest(dispatch);
    const terminal = normalizePrivateServiceInvocationTerminal({
      kind: "private-service-invocation-terminal/1",
      ownerRunId: id("a"),
      operationId: "counter:1",
      allocationDigest,
      dispatchDigest,
      observation: {
        source: "provider-response",
        terminal: { status: "succeeded", value: 1 },
      },
    });
    const closure = normalizePrivateServiceInvocationClosure({
      kind: "private-service-invocation-closure/1",
      ownerRunId: id("a"),
      operationId: "counter:1",
      allocationDigest,
      dispatchDigest,
      terminalDigest: privateServiceInvocationTerminalDigest(terminal),
    });

    expect(decodePrivateServiceInvocationDispatch(
      encodePrivateServiceInvocationDispatch(dispatch),
    )).toEqual(dispatch);
    expect(decodePrivateServiceInvocationTerminal(
      encodePrivateServiceInvocationTerminal(terminal),
    )).toEqual(terminal);
    expect(decodePrivateServiceInvocationClosure(
      encodePrivateServiceInvocationClosure(closure),
    )).toEqual(closure);
    expect(privateServiceInvocationClosureDigest(closure)).toMatch(/^sha256:[0-9a-f]{64}$/);

    expect(() => normalizePrivateServiceInvocationTerminal({
      ...terminal,
      dispatchDigest: null,
      observation: {
        source: "host-prewrite",
        terminal: { status: "succeeded", value: 1 },
      },
    })).toThrow("requires a failed terminal");

    const prewrite = normalizePrivateServiceInvocationTerminal({
      ...terminal,
      dispatchDigest: null,
      observation: {
        source: "host-prewrite",
        terminal: { status: "failed", code: "UNAVAILABLE", message: "not dispatched" },
      },
    });
    expect(prewrite.dispatchDigest).toBeNull();

    // Dispatch admission is persisted before any request byte. Cancellation
    // may therefore remain host-prewrite even though that durable gate exists.
    expect(normalizePrivateServiceInvocationTerminal({
      ...prewrite,
      dispatchDigest,
    }).dispatchDigest).toBe(dispatchDigest);

    const dispatchedObservations = [
      {
        source: "provider-response",
        terminal: { status: "succeeded", value: 1 },
      },
      {
        source: "provider-loss",
        terminal: { status: "failed", code: "UNCERTAIN", message: "lost" },
      },
      {
        source: "cooperative-cancellation",
        terminal: { status: "failed", code: "CANCELLED", message: "cancelled" },
      },
      {
        source: "coordinator-loss",
        terminal: { status: "failed", code: "UNCERTAIN", message: "coordinator lost" },
      },
    ];
    for (const observation of dispatchedObservations) {
      expect(normalizePrivateServiceInvocationTerminal({
        ...terminal,
        observation,
      }).dispatchDigest).toBe(dispatchDigest);
      expect(() => normalizePrivateServiceInvocationTerminal({
        ...terminal,
        dispatchDigest: null,
        observation,
      })).toThrow("requires dispatch evidence");
    }
    expect(() => normalizePrivateServiceInvocationTerminal({
      ...terminal,
      observation: {
        source: "provider-loss",
        terminal: { status: "failed", code: "CHANNEL_LOST", message: "wrong classification" },
      },
    })).toThrow("requires an UNCERTAIN failure");
    expect(() => normalizePrivateServiceInvocationTerminal({
      ...terminal,
      observation: {
        source: "coordinator-loss",
        terminal: { status: "failed", code: "CHANNEL_LOST", message: "wrong classification" },
      },
    })).toThrow("requires an UNCERTAIN failure");
    expect(() => normalizePrivateServiceInvocationTerminal({
      ...terminal,
      observation: {
        source: "coordinator-loss",
        terminal: { status: "succeeded", value: 1 },
      },
    })).toThrow("requires an UNCERTAIN failure");
  });

  test("rejects accessor-bearing, proxied, and noncanonical state", () => {
    const allocation = mountAllocation();
    expect(() => normalizePrivateServiceMountAllocation(new Proxy(allocation, {})))
      .toThrow("ordinary object");
    expect(() => normalizePrivateServiceMountAllocation(Object.defineProperty(
      { ...allocation },
      "bindingId",
      { enumerable: true, get: () => "counter" },
    ))).toThrow("data properties");
    const call = {
      operationId: "counter:1",
      slot: "counter",
      method: "next",
      input: { nested: new Proxy({ value: 1 }, {}) },
    };
    expect(() => privateServiceInvocationRequestDigest({
      slot: call.slot,
      method: call.method,
      input: call.input,
    })).toThrow("ordinary JSON/1");

    const state = mountLifecycle();
    expect(() => normalizePrivateServiceMountPlan({
      ...state.plan,
      packageAllocation: new Proxy(state.plan.packageAllocation, {}),
    })).toThrow("ordinary JSON/1");
    expect(() => normalizePrivateServiceMountFence(Object.defineProperty(
      { ...state.fence },
      "proof",
      { enumerable: true, get: () => state.fence.proof },
    ))).toThrow("data properties");
  });

  test("rejects aggregate JSON/1 budgets before cloning hostile values", () => {
    const repeatedChunk = new Array(65_536).fill(null);
    const tooManyNodes = [repeatedChunk, repeatedChunk, repeatedChunk, repeatedChunk];
    expect(() => privateServiceInvocationRequestDigest({
      slot: "counter",
      method: "next",
      input: tooManyNodes,
    })).toThrow("maximum value nodes exceeded");

    const escapingChunk = "\\".repeat(6_000_000);
    expect(() => privateServiceInvocationRequestDigest({
      slot: "counter",
      method: "next",
      input: [escapingChunk, escapingChunk],
    })).toThrow("maximum encoded bytes exceeded");

    expect(() => privateServiceInvocationRequestDigest({
      slot: "counter",
      method: "next",
      input: { ["k".repeat(1_025)]: null },
    })).toThrow("member name exceeds its byte bound");

    const state = mountLifecycle();
    expect(() => normalizePrivateServiceMountPlan({
      ...state.plan,
      ownerAllocation: { ...state.plan.ownerAllocation, hostile: tooManyNodes },
    })).toThrow("maximum value nodes exceeded");
  });
});

function mountAllocation() {
  return {
    kind: "private-service-mount-allocation/1" as const,
    mountId: id("1"),
    coordinatorEpoch: 3,
    admissionDigest: id("2"),
    candidateRevision: 7,
    bindingId: "counter",
    requestDigest: id("3"),
    recipeDigest: id("4"),
    observationDigest: id("5"),
    expectedExports: ["counter"],
    effectiveDeadlineUnixMs: 1_800_000_000_000,
  };
}

function mountLifecycle() {
  const allocation = normalizePrivateServiceMountAllocation(mountAllocation());
  const allocationDigest = privateServiceMountAllocationDigest(allocation);
  const plan = normalizePrivateServiceMountPlan({
    kind: "private-service-mount-plan/1",
    mountId: allocation.mountId,
    allocationDigest,
    cancellationGraceMs: 1_000,
    packageAllocation: packageAllocation(allocationDigest),
    ownerAllocation: ownerAllocation(),
  });
  const backing = normalizePrivateServiceMountBacking({
    kind: "private-service-mount-backing/1",
    mountId: allocation.mountId,
    allocationDigest,
    planDigest: privateServiceMountPlanDigest(plan),
    lease: packageLease(plan.packageAllocation),
  });
  const owner = sealedOwner(plan.ownerAllocation, allocation.effectiveDeadlineUnixMs);
  const sandbox = normalizePrivateServiceMountSandbox({
    kind: "private-service-mount-sandbox/1",
    mountId: allocation.mountId,
    allocationDigest,
    backingDigest: privateServiceMountBackingDigest(backing),
    owner,
  });
  const preparedOwner = preparedOwnerIdentity(owner);
  const prepared = normalizePrivateServiceMountPrepared({
    kind: "private-service-mount-prepared/1",
    mountId: allocation.mountId,
    allocationDigest,
    sandboxDigest: privateServiceMountSandboxDigest(sandbox),
    prepared: preparedOwner,
  });
  const generation = normalizePrivateServiceMountGeneration({
    kind: "private-service-mount-generation/1",
    mountId: allocation.mountId,
    allocationDigest,
    preparedDigest: privateServiceMountPreparedDigest(prepared),
    generationId: id("7"),
    exports: allocation.expectedExports,
  });
  const acknowledged = normalizePrivateServiceMountAcknowledged({
    kind: "private-service-mount-acknowledged/1",
    mountId: allocation.mountId,
    allocationDigest,
    generationDigest: privateServiceMountGenerationDigest(generation),
  });
  const provisional = normalizePrivateServiceMountProvisional({
    kind: "private-service-mount-provisional/1",
    mountId: allocation.mountId,
    allocationDigest,
    generationDigest: privateServiceMountGenerationDigest(generation),
    acknowledgedDigest: privateServiceMountAcknowledgedDigest(acknowledged),
    classification: "voluntary-exit",
    terminal: { status: "succeeded", diagnostics },
  });
  const fence = normalizePrivateServiceMountFence({
    kind: "private-service-mount-fence/1",
    mountId: allocation.mountId,
    allocationDigest,
    provisionalDigest: privateServiceMountProvisionalDigest(provisional),
    planDigest: privateServiceMountPlanDigest(plan),
    proof: {
      kind: "enforcement-confirmed",
      sandboxDigest: privateServiceMountSandboxDigest(sandbox),
      receipt: enforcementReceipt(preparedOwner.digest),
    },
  });
  const release = normalizePrivateServiceMountRelease({
    kind: "private-service-mount-release/1",
    mountId: allocation.mountId,
    allocationDigest,
    provisionalDigest: privateServiceMountProvisionalDigest(provisional),
    planDigest: privateServiceMountPlanDigest(plan),
    backingDigest: privateServiceMountBackingDigest(backing),
    fenceDigest: privateServiceMountFenceDigest(fence),
    packageReleased: true,
    ownerRelease: ownerReleaseReceipt(plan.ownerAllocation.digest),
    leaseReleases: [
      { ownerRunId: id("a"), slot: "counter", releaseDigest: id("8") },
      { ownerRunId: id("b"), slot: "counter", releaseDigest: id("9") },
    ],
  });
  const closure = normalizePrivateServiceMountClosure({
    kind: "private-service-mount-closure/1",
    mountId: allocation.mountId,
    allocationDigest,
    provisionalDigest: privateServiceMountProvisionalDigest(provisional),
    releaseDigest: privateServiceMountReleaseDigest(release),
  });
  return Object.freeze({
    allocation,
    allocationDigest,
    plan,
    backing,
    sandbox,
    prepared,
    generation,
    acknowledged,
    provisional,
    fence,
    release,
    closure,
  });
}

function packageAllocation(ownerToken: string) {
  return {
    kind: "private-package-materialization-allocation/1" as const,
    parent: { path: "/tmp/jig/materializations", dev: "1", ino: "2" },
    name: "service-counter",
    path: "/tmp/jig/materializations/service-counter",
    packageDigest: id("6"),
    ownerToken,
  };
}

function packageLease(allocation: ReturnType<typeof packageAllocation>) {
  return {
    kind: "private-package-materialization-lease/1" as const,
    allocation,
    transaction: { path: allocation.path, dev: "3", ino: "4" },
    package: { path: `${allocation.path}/package`, dev: "5", ino: "6" },
  };
}

function ownerAllocation() {
  const fields = {
    kind: "private-linux-owner-state-allocation/1" as const,
    parent: "/tmp/jig/owners",
    parentDevice: "3",
    parentInode: "4",
    name: "service-counter",
    directory: "/tmp/jig/owners/service-counter",
    ownerToken: "a".repeat(64),
  };
  return {
    ...fields,
    digest: domainDigest("JIG-Private-Linux-Owner-State-Allocation/1", fields),
  };
}

function sealedOwner(allocation: ReturnType<typeof ownerAllocation>, deadlineUnixMs: number) {
  const nonce = "b".repeat(24);
  const runId = "service-counter";
  const parentName = `jig-run-${runId}-${nonce}`;
  const parentCgroup = `/sys/fs/cgroup/jig/${parentName}`;
  const fields = {
    kind: "private-linux-sealed-owner/1" as const,
    runId,
    nonce,
    ownerToken: "c".repeat(64),
    mechanismDigest: id("a"),
    sealedPlanDigest: id("b"),
    cgroupScope: "/sys/fs/cgroup/jig",
    cgroupScopeDevice: "7",
    cgroupScopeInode: "8",
    parentName,
    parentCgroup,
    supervisorCgroup: `${parentCgroup}/supervisor`,
    runCgroup: `${parentCgroup}/run`,
    privateDeviceDirectory: `/dev/.jig-${parentName}-devices`,
    deadlineUnixMs,
    cancellationGraceMs: 1_000,
    cleanupTimeoutMs: 5_000,
    trustedHelperPath: "/opt/jig/linux-cgroup-helper",
    trustedHelperDigest: id("c"),
    ownerStateParent: allocation.parent,
    ownerStateParentDevice: allocation.parentDevice,
    ownerStateParentInode: allocation.parentInode,
    ownerStateName: allocation.name,
    ownerStateDirectory: allocation.directory,
    ownerStateDevice: "9",
    ownerStateInode: "10",
    ownerStateAllocationDigest: allocation.digest,
  };
  return {
    ...fields,
    digest: domainDigest("JIG-Private-Linux-Sealed-Owner/1", fields),
  };
}

function preparedOwnerIdentity(owner: ReturnType<typeof sealedOwner>) {
  return {
    kind: "private-linux-prepared-owner/1" as const,
    digest: domainDigest("JIG-Private-Linux-Prepared-Owner/1", owner),
    owner,
  };
}

function ownerCancellation() {
  const allocation = ownerAllocation();
  const fields = {
    kind: "private-linux-owner-state-cancellation/1" as const,
    allocationDigest: allocation.digest,
    directoryDevice: "9",
    directoryInode: "10",
    state: "cancelled" as const,
  };
  return {
    ...fields,
    digest: domainDigest("JIG-Private-Linux-Owner-State-Cancellation/1", fields),
  };
}

function ownerReleaseReceipt(allocationDigest: string) {
  const fields = {
    kind: "private-linux-owner-state-release/1" as const,
    allocationDigest,
    directoryDevice: "9",
    directoryInode: "10",
    released: true as const,
  };
  return {
    ...fields,
    digest: domainDigest("JIG-Private-Linux-Owner-State-Release/1", fields),
  };
}

function enforcementReceipt(ownerDigest: string) {
  return {
    kind: "private-linux-confirmed-enforcement/1" as const,
    ownerDigest,
    stopReason: "payload_exit" as const,
    exitCode: 0,
    signal: null,
    fenced: true as const,
    evidence: {
      cpuStat: { usage_usec: 1 },
      memoryEvents: { oom: 0 },
      pidsEvents: { max: 0 },
    },
  };
}

function domainDigest(domain: string, value: object): string {
  return privateDomainDigest(domain, value as unknown as JsonValue);
}

function leaseAllocation() {
  return {
    kind: "private-service-lease-allocation/1" as const,
    ownerRunId: id("a"),
    coordinatorEpoch: 3,
    slot: "counter",
    mountId: id("1"),
    mountAllocationDigest: id("2"),
    generationId: id("3"),
    generationDigest: id("4"),
    acknowledgedDigest: id("5"),
    providerBinding: "counter-service",
    providerExport: "counter",
    contract: {
      id: "https://example.test/contracts/counter",
      version: "1.0.0",
      digest: id("6"),
    },
  };
}

function invocationAllocation(
  call: { readonly operationId: string; readonly slot: string; readonly method: string; readonly input: { amount: number } },
  requestDigest: string,
) {
  return {
    kind: "private-service-invocation-allocation/1" as const,
    ownerRunId: id("a"),
    coordinatorEpoch: 3,
    call,
    requestDigest,
    leaseDigest: id("b"),
    mountId: id("1"),
    generationId: id("3"),
    exportName: "counter",
    deadlineUnixMs: 1_800_000_000_000,
  };
}
