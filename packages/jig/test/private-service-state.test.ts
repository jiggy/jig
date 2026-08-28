import { describe, expect, test } from "bun:test";

import {
  decodePrivateServiceInvocationAllocation,
  decodePrivateServiceInvocationClosure,
  decodePrivateServiceInvocationDispatch,
  decodePrivateServiceInvocationTerminal,
  decodePrivateServiceLeaseAllocation,
  decodePrivateServiceLeaseRelease,
  decodePrivateServiceMountAllocation,
  decodePrivateServiceMountCheckpoint,
  encodePrivateServiceInvocationAllocation,
  encodePrivateServiceInvocationClosure,
  encodePrivateServiceInvocationDispatch,
  encodePrivateServiceInvocationTerminal,
  encodePrivateServiceLeaseAllocation,
  encodePrivateServiceLeaseRelease,
  encodePrivateServiceMountAllocation,
  encodePrivateServiceMountCheckpoint,
  normalizePrivateServiceInvocationAllocation,
  normalizePrivateServiceInvocationClosure,
  normalizePrivateServiceInvocationDispatch,
  normalizePrivateServiceInvocationTerminal,
  normalizePrivateServiceLeaseAllocation,
  normalizePrivateServiceLeaseRelease,
  normalizePrivateServiceMountAllocation,
  normalizePrivateServiceMountCheckpoint,
  privateServiceInvocationAllocationDigest,
  privateServiceInvocationClosureDigest,
  privateServiceInvocationDispatchDigest,
  privateServiceInvocationRequestDigest,
  privateServiceInvocationTerminalDigest,
  privateServiceLeaseAllocationDigest,
  privateServiceLeaseReleaseDigest,
  privateServiceMountAllocationDigest,
  privateServiceMountCheckpointDigest,
} from "../src/internal/private-service-state.js";

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

  test("admits only the three readiness checkpoints already earned by the Host gates", () => {
    const base = {
      mountId: id("1"),
      allocationDigest: id("2"),
    };
    const generation = normalizePrivateServiceMountCheckpoint({
      kind: "private-service-mount-generation/1",
      ...base,
      value: { generationId: id("3"), exports: ["counter"] },
    }, "generation");
    const acknowledged = normalizePrivateServiceMountCheckpoint({
      kind: "private-service-mount-acknowledged/1",
      ...base,
      value: { generationDigest: privateServiceMountCheckpointDigest("generation", generation) },
    }, "acknowledged");
    const provisional = normalizePrivateServiceMountCheckpoint({
      kind: "private-service-mount-provisional/1",
      ...base,
      value: {
        classification: "voluntary-exit",
        terminal: { status: "succeeded", diagnostics },
      },
    }, "provisional");

    for (const [name, checkpoint] of [
      ["generation", generation],
      ["acknowledged", acknowledged],
      ["provisional", provisional],
    ] as const) {
      expect(decodePrivateServiceMountCheckpoint(
        encodePrivateServiceMountCheckpoint(checkpoint, name),
        name,
      )).toEqual(checkpoint);
      expect(privateServiceMountCheckpointDigest(name, checkpoint)).toMatch(/^sha256:[0-9a-f]{64}$/);
    }

    expect(() => normalizePrivateServiceMountCheckpoint({
      ...generation,
      value: { generationId: id("3"), exports: ["z", "a"] },
    }, "generation")).toThrow("unique and sorted");
    expect(() => normalizePrivateServiceMountCheckpoint({
      ...provisional,
      value: {
        classification: "provider-loss",
        terminal: { status: "succeeded", diagnostics },
      },
    }, "provisional")).toThrow("requires a failed terminal");

    expect(() => normalizePrivateServiceMountCheckpoint({
      kind: "private-service-mount-release/1",
      ...base,
      value: {},
    }, "release" as never)).toThrow("checkpoint name is invalid");
  });

  test("makes every Mount terminal classification exact", () => {
    const base = { mountId: id("1"), allocationDigest: id("2") };
    const checkpoint = (
      classification: string,
      terminal: unknown,
    ) => normalizePrivateServiceMountCheckpoint({
      kind: "private-service-mount-provisional/1",
      ...base,
      value: { classification, terminal },
    }, "provisional");
    const succeeded = { status: "succeeded", diagnostics };
    const failed = {
      status: "failed",
      code: "CHANNEL_LOST",
      message: "lost",
      diagnostics,
    };

    for (const classification of ["host-lifetime", "voluntary-exit"]) {
      expect(checkpoint(classification, succeeded).value).toEqual({ classification, terminal: succeeded });
      expect(() => checkpoint(classification, failed)).toThrow("requires a succeeded terminal");
    }
    for (const classification of [
      "startup-cancelled",
      "readiness-timeout",
      "provider-loss",
      "coordinator-loss",
    ]) {
      expect(checkpoint(classification, failed).value).toEqual({ classification, terminal: failed });
      expect(() => checkpoint(classification, succeeded)).toThrow("requires a failed terminal");
    }
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
        terminal: { status: "failed", code: "CHANNEL_LOST", message: "lost" },
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
