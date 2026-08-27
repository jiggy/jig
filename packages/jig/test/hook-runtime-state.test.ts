import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";

import {
  decodePrivateHookMeaning,
  decodePrivateHookRevision,
  decodePrivateHookSelectionSet,
  encodePrivateHookMeaning,
  encodePrivateHookRevision,
  encodePrivateHookSelectionSet,
  normalizePrivateHookMeaning,
  normalizePrivateHookRevision,
  normalizePrivateHookSelectionSet,
  privateHookMeaningDigest,
  privateHookRevisionDigest,
  privateHookSelectionSetDigest,
  privateHookTargetDispositionDigest,
} from "../src/internal/hook-runtime-state.js";
import { JSON_1_LIMITS } from "../src/json.js";
import { PRIVATE_CANONICAL_JOURNAL_CONTRACT } from "../src/project/package-project.js";

const encoder = new TextEncoder();
const eventType = "https://example.org/events/work-created";

describe("private Hook runtime state", () => {
  test("normalizes and canonically round-trips one exact Hook meaning", () => {
    const meaning = normalizePrivateHookMeaning(meaningValue());
    expect(meaning).toEqual({
      kind: "private-hook-meaning/1",
      hookId: "on-work",
      relationDigest: digest("relation"),
      journalAuthority: {
        publisherBinding: "work-publisher",
        source: "binding:work-publisher",
        contract: PRIVATE_CANONICAL_JOURNAL_CONTRACT,
        type: eventType,
      },
      target: {
        identity: { kind: "binding", id: "worker" },
        requestDigest: digest("request"),
        dispositionDigest: readyDispositionDigest(),
      },
    });
    expect(Object.isFrozen(meaning)).toBeTrue();
    expect(Object.isFrozen(meaning.journalAuthority)).toBeTrue();
    expect(Object.isFrozen(meaning.journalAuthority.contract)).toBeTrue();
    expect(Object.isFrozen(meaning.target)).toBeTrue();
    expect(Object.isFrozen(meaning.target.identity)).toBeTrue();

    const encoded = encodePrivateHookMeaning(meaning);
    expect(decodePrivateHookMeaning(encoded)).toEqual(meaning);
    expect(privateHookMeaningDigest(meaning)).toBe(privateHookMeaningDigest(structuredClone(meaning)));
    expect(privateHookMeaningDigest(meaning)).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  test("uses only the selected Journal authority slice in executable meaning", () => {
    const narrowPublisher = {
      id: "work-publisher",
      source: "binding:work-publisher",
      contract: PRIVATE_CANONICAL_JOURNAL_CONTRACT,
      eventTypes: [eventType],
    };
    const broaderPublisher = {
      ...narrowPublisher,
      eventTypes: [eventType, "https://example.org/events/unrelated"],
    };
    const narrow = meaningFromPublisher(narrowPublisher);
    const broader = meaningFromPublisher(broaderPublisher);
    expect(privateHookMeaningDigest(narrow)).toBe(privateHookMeaningDigest(broader));

    const baseDigest = privateHookMeaningDigest(narrow);
    for (const changed of [
      meaningValue({ type: "https://example.org/events/changed" }),
      meaningValue({ target: { kind: "binding", id: "other-worker" } }),
      meaningValue({ requestDigest: digest("changed-request") }),
      meaningValue({ dispositionDigest: privateHookTargetDispositionDigest({
        state: "ready",
        recipeDigest: digest("changed-recipe"),
        observationDigest: digest("observation"),
      }) }),
      meaningValue({ relationDigest: digest("changed-relation") }),
    ]) {
      expect(privateHookMeaningDigest(changed)).not.toBe(baseDigest);
    }
  });

  test("identifies closed target dispositions without claiming admission authenticity", () => {
    const ready = {
      state: "ready",
      recipeDigest: digest("recipe"),
      observationDigest: digest("observation"),
    } as const;
    expect(privateHookTargetDispositionDigest(ready)).toBe(readyDispositionDigest());
    expect(privateHookTargetDispositionDigest({ ...ready, recipeDigest: digest("other") }))
      .not.toBe(readyDispositionDigest());

    const evidenceDigests = [digest("evidence-a"), digest("evidence-b")]
      .sort(compareStrings);
    const unavailable = {
      state: "unavailable",
      code: "RUNTIME_UNAVAILABLE",
      evidenceDigests,
    } as const;
    expect(privateHookTargetDispositionDigest(unavailable)).toBe(
      privateHookTargetDispositionDigest(structuredClone(unavailable)),
    );
    expect(privateHookTargetDispositionDigest({
      ...unavailable,
      code: "SANDBOX_UNAVAILABLE",
    })).not.toBe(privateHookTargetDispositionDigest(unavailable));
    expect(() => privateHookTargetDispositionDigest({
      ...unavailable,
      evidenceDigests: [...evidenceDigests].reverse(),
    })).toThrow("unique and sorted");
  });

  test("derives an immutable revision from meaning and exact opening evidence", () => {
    const meaning = normalizePrivateHookMeaning(meaningValue());
    const revision = normalizePrivateHookRevision(revisionValue(meaning));
    expect(revision).toEqual({
      kind: "private-hook-revision/1",
      meaning,
      meaningDigest: privateHookMeaningDigest(meaning),
      openingAdmissionDigest: digest("admission"),
      openingCandidateRevision: 7,
      openingCandidateDigest: digest("candidate"),
      startPosition: 13,
    });
    expect(Object.isFrozen(revision)).toBeTrue();
    expect(Object.isFrozen(revision.meaning)).toBeTrue();
    expect(Object.hasOwn(revision, "endPosition")).toBeFalse();
    expect(decodePrivateHookRevision(encodePrivateHookRevision(revision))).toEqual(revision);

    const revisionDigest = privateHookRevisionDigest(revision);
    expect(revisionDigest).not.toBe(privateHookMeaningDigest(meaning));
    for (const changed of [
      { ...revision, openingAdmissionDigest: digest("other-admission") },
      { ...revision, openingCandidateRevision: 8 },
      { ...revision, openingCandidateDigest: digest("other-candidate") },
      { ...revision, startPosition: 14 },
    ]) {
      expect(privateHookRevisionDigest(changed)).not.toBe(revisionDigest);
      expect(privateHookMeaningDigest(changed.meaning)).toBe(revision.meaningDigest);
    }
  });

  test("rejects revision digest drift and any mutable interval end", () => {
    const meaning = normalizePrivateHookMeaning(meaningValue());
    expect(() => normalizePrivateHookRevision({
      ...revisionValue(meaning),
      meaningDigest: digest("wrong-meaning"),
    })).toThrow("does not match");
    expect(() => normalizePrivateHookRevision({
      ...revisionValue(meaning),
      endPosition: 20,
    })).toThrow("must contain exactly");
  });

  test("normalizes ordered Hook selections and binds them to one Event", () => {
    const set = normalizePrivateHookSelectionSet({
      kind: "private-hook-selection-set/1",
      eventId: digest("event"),
      entries: [
        { hookId: "audit", hookRevisionDigest: digest("audit-revision"), runId: digest("audit-run") },
        { hookId: "on-work", hookRevisionDigest: digest("work-revision"), runId: digest("work-run") },
      ],
    });
    expect(Object.isFrozen(set)).toBeTrue();
    expect(Object.isFrozen(set.entries)).toBeTrue();
    expect(set.entries.every(Object.isFrozen)).toBeTrue();
    expect(decodePrivateHookSelectionSet(encodePrivateHookSelectionSet(set))).toEqual(set);
    expect(privateHookSelectionSetDigest(set)).toBe(
      privateHookSelectionSetDigest(structuredClone(set)),
    );

    const empty = normalizePrivateHookSelectionSet({
      kind: "private-hook-selection-set/1",
      eventId: digest("event"),
      entries: [],
    });
    expect(decodePrivateHookSelectionSet(encodePrivateHookSelectionSet(empty))).toEqual(empty);
    expect(privateHookSelectionSetDigest(empty)).not.toBe(privateHookSelectionSetDigest(set));
    expect(privateHookSelectionSetDigest({ ...empty, eventId: digest("other-event") }))
      .not.toBe(privateHookSelectionSetDigest(empty));
  });

  test("rejects unordered, duplicate, or unbounded selections", () => {
    const first = { hookId: "audit", hookRevisionDigest: digest("a-revision"), runId: digest("a-run") };
    const second = { hookId: "on-work", hookRevisionDigest: digest("b-revision"), runId: digest("b-run") };
    const value = (entries: unknown[]) => ({
      kind: "private-hook-selection-set/1",
      eventId: digest("event"),
      entries,
    });
    expect(() => normalizePrivateHookSelectionSet(value([second, first])))
      .toThrow("unique, sorted Hook IDs");
    expect(() => normalizePrivateHookSelectionSet(value([first, { ...second, hookId: "audit" }])))
      .toThrow("unique, sorted Hook IDs");
    expect(() => normalizePrivateHookSelectionSet(value([first, {
      ...second,
      hookRevisionDigest: first.hookRevisionDigest,
    }]))).toThrow("duplicate revision");
    expect(() => normalizePrivateHookSelectionSet(value([first, {
      ...second,
      runId: first.runId,
    }]))).toThrow("duplicate derived Run");
    expect(() => normalizePrivateHookSelectionSet(value(
      new Array(JSON_1_LIMITS.containerEntries + 1),
    ))).toThrow("exceed their bound");
  });

  test("enforces closed shapes, finite fields, and canonical bytes", () => {
    const meaning = meaningValue();
    for (const invalid of [
      { ...meaning, extra: true },
      { ...meaning, hookId: "Invalid" },
      { ...meaning, hookId: "a".repeat(65) },
      { ...meaning, journalAuthority: { ...meaning.journalAuthority, source: "binding:other" } },
      { ...meaning, journalAuthority: {
        ...meaning.journalAuthority,
        contract: { ...PRIVATE_CANONICAL_JOURNAL_CONTRACT, version: "2.0.0" },
      } },
      { ...meaning, journalAuthority: { ...meaning.journalAuthority, type: "https://jig.dev/events/private" } },
      { ...meaning, target: { ...meaning.target, identity: { kind: "flow", path: ".jig/private" } } },
      { ...meaning, target: { ...meaning.target, requestDigest: `sha256:${"A".repeat(64)}` } },
    ]) {
      expect(() => normalizePrivateHookMeaning(invalid)).toThrow();
    }
    expect(() => normalizePrivateHookRevision({ ...revisionValue(), startPosition: 0 })).toThrow();
    expect(() => normalizePrivateHookRevision({
      ...revisionValue(),
      openingCandidateRevision: Number.MAX_SAFE_INTEGER + 1,
    })).toThrow();

    const canonical = encodePrivateHookMeaning(meaning);
    expect(() => decodePrivateHookMeaning(encoder.encode(
      ` ${new TextDecoder().decode(canonical)}`,
    ))).toThrow("not canonical JSON/1");
    expect(() => decodePrivateHookMeaning(encoder.encode(
      '{"hookId":"on-work","hookId":"on-work"}',
    ))).toThrow("duplicate object member");
    expect(() => normalizePrivateHookMeaning(new Proxy(meaning, {}))).toThrow("ordinary object");
    expect(() => normalizePrivateHookMeaning(Object.defineProperty(
      { ...meaning },
      "hookId",
      { enumerable: true, get: () => "on-work" },
    ))).toThrow("data properties");
  });

  test("rejects nested proxies and proxied bytes before invoking their traps", () => {
    const identity = trappingProxy({ kind: "binding", id: "worker" });
    expect(() => normalizePrivateHookMeaning({
      ...meaningValue(),
      target: {
        ...meaningValue().target,
        identity,
      },
    })).toThrow("ordinary object");

    const evidence = trappingProxy([digest("evidence")]);
    expect(() => privateHookTargetDispositionDigest({
      state: "unavailable",
      code: "RUNTIME_UNAVAILABLE",
      evidenceDigests: evidence,
    })).toThrow("ordinary array");

    const entries = trappingProxy([]);
    expect(() => normalizePrivateHookSelectionSet({
      kind: "private-hook-selection-set/1",
      eventId: digest("event"),
      entries,
    })).toThrow("ordinary array");

    const encoded = encodePrivateHookMeaning(meaningValue());
    const bytes = trappingProxy(encoded) as unknown as Uint8Array;
    expect(() => decodePrivateHookMeaning(bytes)).toThrow("ordinary Uint8Array");
  });
});

function meaningFromPublisher(publisher: {
  readonly id: string;
  readonly source: string;
  readonly contract: typeof PRIVATE_CANONICAL_JOURNAL_CONTRACT;
  readonly eventTypes: readonly string[];
}) {
  if (!publisher.eventTypes.includes(eventType)) throw new Error("test publisher lacks selected type");
  return meaningValue({
    publisherBinding: publisher.id,
    source: publisher.source,
    type: eventType,
  });
}

function meaningValue(overrides: {
  readonly relationDigest?: string;
  readonly publisherBinding?: string;
  readonly source?: string;
  readonly type?: string;
  readonly target?: { readonly kind: "binding"; readonly id: string };
  readonly requestDigest?: string;
  readonly dispositionDigest?: string;
} = {}) {
  const publisherBinding = overrides.publisherBinding ?? "work-publisher";
  return {
    kind: "private-hook-meaning/1",
    hookId: "on-work",
    relationDigest: overrides.relationDigest ?? digest("relation"),
    journalAuthority: {
      publisherBinding,
      source: overrides.source ?? `binding:${publisherBinding}`,
      contract: PRIVATE_CANONICAL_JOURNAL_CONTRACT,
      type: overrides.type ?? eventType,
    },
    target: {
      identity: overrides.target ?? { kind: "binding" as const, id: "worker" },
      requestDigest: overrides.requestDigest ?? digest("request"),
      dispositionDigest: overrides.dispositionDigest ?? readyDispositionDigest(),
    },
  };
}

function revisionValue(meaning = normalizePrivateHookMeaning(meaningValue())) {
  return {
    kind: "private-hook-revision/1",
    meaning,
    meaningDigest: privateHookMeaningDigest(meaning),
    openingAdmissionDigest: digest("admission"),
    openingCandidateRevision: 7,
    openingCandidateDigest: digest("candidate"),
    startPosition: 13,
  };
}

function readyDispositionDigest(): string {
  return privateHookTargetDispositionDigest({
    state: "ready",
    recipeDigest: digest("recipe"),
    observationDigest: digest("observation"),
  });
}

function digest(label: string): string {
  return `sha256:${createHash("sha256").update(label).digest("hex")}`;
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function trappingProxy<T extends object>(target: T): T {
  const trapped = () => {
    throw new Error("proxy trap was invoked");
  };
  return new Proxy(target, {
    get: trapped,
    getOwnPropertyDescriptor: trapped,
    getPrototypeOf: trapped,
    has: trapped,
    ownKeys: trapped,
  });
}
