import { describe, expect, test } from "bun:test";

import {
  createPrivateRootJournalEffectsClosure,
  createPrivateJournalEvent,
  normalizePrivateRootJournalAppendAllocation,
  normalizePrivateRootJournalAppendClosure,
  normalizePrivateRootJournalEffectsClosure,
  privateEmptyHookSelectionDigest,
  privateJournalEventDigest,
  privateRootJournalAppendAllocationDigest,
  privateRootJournalAppendClosureDigest,
  privateRootJournalEffectsClosureDigest,
  privateRootJournalEffectTerminalDigest,
  type PrivateRootJournalAppendReceipt,
} from "../src/internal/root-journal-effect-state.js";

const runId = `sha256:${"1".repeat(64)}`;

describe("private root Journal effect state", () => {
  test("binds the sorted complete operation set into one parent closure", () => {
    const receipt = (operationId: string, digit: string) => ({
      allocation: { call: { operationId } },
      closureDigest: `sha256:${digit.repeat(64)}`,
    }) as unknown as PrivateRootJournalAppendReceipt;
    const closure = createPrivateRootJournalEffectsClosure({
      parentRunId: `sha256:${"a".repeat(64)}`,
      receipts: [receipt("publish-2", "2"), receipt("publish-1", "1")],
    });
    expect(closure.operations.map((operation) => operation.operationId)).toEqual(["publish-1", "publish-2"]);
    expect(privateRootJournalEffectsClosureDigest(closure)).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(privateRootJournalEffectsClosureDigest(createPrivateRootJournalEffectsClosure({
      parentRunId: `sha256:${"a".repeat(64)}`,
      receipts: [],
    }))).not.toBe(privateRootJournalEffectsClosureDigest(closure));
    expect(() => normalizePrivateRootJournalEffectsClosure({
      ...closure,
      operations: [closure.operations[0], closure.operations[0]],
    })).toThrow("unique and sorted");
  });

  test("normalizes one bounded publisher allocation and creates an authenticated Event", () => {
    const allocation = normalizePrivateRootJournalAppendAllocation({
      kind: "private-root-journal-append-allocation/1",
      parentRunId: runId,
      coordinatorEpoch: 3,
      publisherBinding: "publisher",
      eventTypes: ["https://example.test/events/document-created"],
      call: {
        operationId: "append:1",
        slot: "journal",
        method: "append",
        input: {
          type: "https://example.test/events/document-created",
          data: { documentId: "D-1" },
          subject: "D-1",
          occurredAtUnixMs: -1,
        },
      },
    });
    const event = createPrivateJournalEvent({
      allocation,
      journalPosition: 7,
      committedAtUnixMs: 1_787_000_000_000,
    });

    expect(event).toEqual({
      eventId: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      journalPosition: 7,
      type: "https://example.test/events/document-created",
      source: "binding:publisher",
      committedAtUnixMs: 1_787_000_000_000,
      data: { documentId: "D-1" },
      subject: "D-1",
      occurredAtUnixMs: -1,
      runId,
    });
    expect(privateRootJournalAppendAllocationDigest(allocation)).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(privateJournalEventDigest(event)).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(privateEmptyHookSelectionDigest(event)).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(privateRootJournalEffectTerminalDigest({ value: event })).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  test("rejects excess authority, protected types, and caller-stamped Event fields", () => {
    const base = {
      kind: "private-root-journal-append-allocation/1",
      parentRunId: runId,
      coordinatorEpoch: 1,
      publisherBinding: "publisher",
      eventTypes: ["https://example.test/events/allowed"],
      call: {
        operationId: "append:1",
        slot: "journal",
        method: "append",
        input: { type: "https://example.test/events/denied", data: null },
      },
    } as const;
    expect(() => createPrivateJournalEvent({
      allocation: normalizePrivateRootJournalAppendAllocation(base),
      journalPosition: 1,
      committedAtUnixMs: 1,
    })).toThrow("exceeds publisher authority");
    expect(() => normalizePrivateRootJournalAppendAllocation({
      ...base,
      eventTypes: ["https://jig.dev/events/root-completed"],
    })).toThrow("protected lifecycle namespace");
    expect(() => createPrivateJournalEvent({
      allocation: normalizePrivateRootJournalAppendAllocation({
        ...base,
        eventTypes: ["https://example.test/events/allowed"],
        call: {
          ...base.call,
          input: {
            type: "https://example.test/events/allowed",
            data: null,
            source: "forged",
          },
        },
      }),
      journalPosition: 1,
      committedAtUnixMs: 1,
    })).toThrow("unexpected members");
  });

  test("binds closure identity to Event, terminal, and Hook-selection evidence", () => {
    const closure = normalizePrivateRootJournalAppendClosure({
      kind: "private-root-journal-append-closure/1",
      parentRunId: runId,
      allocationDigest: `sha256:${"2".repeat(64)}`,
      eventDigest: `sha256:${"3".repeat(64)}`,
      terminalDigest: `sha256:${"4".repeat(64)}`,
      hookSelectionDigest: `sha256:${"5".repeat(64)}`,
    });
    expect(privateRootJournalAppendClosureDigest(closure)).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});
