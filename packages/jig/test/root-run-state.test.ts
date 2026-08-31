import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";

import {
  createPrivateExternalSubmissionOrigin,
  createPrivateRootRunRequest,
  decodePrivateRootRunOrigin,
  encodePrivateRootRunOrigin,
  normalizePrivateRootRunIdentityInput,
  normalizePrivateRootRunOrigin,
  privateRootRunIdentityDigest,
  privateRootRunOriginDigest,
} from "../src/internal/root-run-state.js";

const encoder = new TextEncoder();

describe("private root Run origin state", () => {
  test("normalizes and canonically encodes one external submission origin", () => {
    const origin = createPrivateExternalSubmissionOrigin("ticket\0attempt\n🚀");
    expect(origin).toEqual({
      kind: "private-root-external-submission-origin/1",
      submissionId: "ticket\0attempt\n🚀",
    });
    expect(Object.isFrozen(origin)).toBeTrue();
    const bytes = encodePrivateRootRunOrigin(origin);
    expect(new TextDecoder().decode(bytes)).toBe(
      '{"kind":"private-root-external-submission-origin/1","submissionId":"ticket\\u0000attempt\\n🚀"}',
    );
    expect(decodePrivateRootRunOrigin(bytes)).toEqual(origin);
    expect(privateRootRunOriginDigest(origin)).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(privateRootRunOriginDigest(origin)).toBe(privateRootRunOriginDigest(structuredClone(origin)));
  });

  test("derives one origin-aware Run identity from closed normalized inputs", () => {
    const external = createPrivateExternalSubmissionOrigin("ticket-1");
    const input = normalizePrivateRootRunIdentityInput({
      project: { device: "0", inode: "18446744073709551615" },
      origin: external,
      requestDigest: digest("request"),
      coordinatorEpoch: 7,
    });
    expect(input).toEqual({
      project: { device: "0", inode: "18446744073709551615" },
      origin: external,
      requestDigest: digest("request"),
      coordinatorEpoch: 7,
    });
    expect(Object.isFrozen(input)).toBeTrue();
    expect(Object.isFrozen(input.project)).toBeTrue();
    expect(Object.isFrozen(input.origin)).toBeTrue();
    expect(privateRootRunOriginDigest(external)).toBe(
      "sha256:e6905118e2a055bc5b5e6ddf88f46772eb9ef564a22cd8de00ecc7a4def91cb0",
    );
    const runId = privateRootRunIdentityDigest(input);
    expect(runId).toBe("sha256:e5db2ee8d0d962d2a5ef0e9016ad9ddd8491ee0f481055889d4aff1bbe6dd24a");
    expect(privateRootRunIdentityDigest(structuredClone(input))).toBe(runId);

    for (const changed of [
      { ...input, project: { ...input.project, inode: "1" } },
      { ...input, origin: createPrivateExternalSubmissionOrigin("ticket-2") },
      { ...input, requestDigest: digest("other-request") },
      { ...input, coordinatorEpoch: 8 },
    ]) {
      expect(privateRootRunIdentityDigest(changed)).not.toBe(runId);
    }
  });

  test("constructs one origin-neutral root Run request without a submission ID", () => {
    const request = createPrivateRootRunRequest({
      target: { kind: "binding", id: "review" },
      input: { ticket: 1 },
      deadlineUnixMs: 12_345,
    });
    expect(request).toEqual({
      kind: "private-root-run-request/1",
      target: { kind: "binding", id: "review" },
      input: { ticket: 1 },
      deadlineUnixMs: 12_345,
    });
    expect(Object.hasOwn(request, "origin")).toBeFalse();
    expect(Object.hasOwn(request, "submissionId")).toBeFalse();
  });

  test("rejects open, noncanonical, or out-of-bound origins", () => {
    for (const invalid of [
      null,
      [],
      { kind: "private-root-external-submission-origin/1", submissionId: "", extra: false },
    ]) {
      expect(() => normalizePrivateRootRunOrigin(invalid)).toThrow();
    }
    expect(() => createPrivateExternalSubmissionOrigin("")).toThrow();
    expect(() => createPrivateExternalSubmissionOrigin("🚀".repeat(1025))).toThrow();
    expect(() => createPrivateExternalSubmissionOrigin("\ud800")).toThrow();
    expect(createPrivateExternalSubmissionOrigin("🚀".repeat(1024)).submissionId)
      .toHaveLength(2048);

    const canonical = encodePrivateRootRunOrigin(createPrivateExternalSubmissionOrigin("ticket"));
    expect(() => decodePrivateRootRunOrigin(encoder.encode(` ${new TextDecoder().decode(canonical)}`)))
      .toThrow("not canonical JSON/1");
    expect(() => decodePrivateRootRunOrigin(encoder.encode(
      '{"kind":"private-root-external-submission-origin/1","submissionId":"x","submissionId":"x"}',
    ))).toThrow("duplicate object member");
  });

  test("rejects malformed Run identity inputs before hashing", () => {
    const valid = {
      project: { device: "1", inode: "2" },
      origin: createPrivateExternalSubmissionOrigin("ticket"),
      requestDigest: digest("request"),
      coordinatorEpoch: 1,
    };
    for (const invalid of [
      { ...valid, extra: true },
      { ...valid, project: { ...valid.project, extra: true } },
      { ...valid, project: { ...valid.project, device: "01" } },
      { ...valid, project: { ...valid.project, inode: "18446744073709551616" } },
      { ...valid, requestDigest: `sha256:${"A".repeat(64)}` },
      { ...valid, coordinatorEpoch: 0 },
      { ...valid, coordinatorEpoch: Number.MAX_SAFE_INTEGER + 1 },
      { ...valid, origin: { kind: "private-root-external-submission-origin/1" } },
    ]) {
      expect(() => normalizePrivateRootRunIdentityInput(invalid)).toThrow();
      expect(() => privateRootRunIdentityDigest(invalid as never)).toThrow();
    }
  });
});

function digest(label: string): string {
  return `sha256:${createHash("sha256").update(label).digest("hex")}`;
}
