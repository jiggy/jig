import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";

import {
  createPrivateActivationAdmission,
  decodePrivateActivationAdmission,
  encodePrivateActivationAdmission,
  privateActivationAdmissionDigest,
} from "../src/internal/activation-admission.js";

const encoder = new TextEncoder();

describe("private activation admission", () => {
  test("is one canonical generation record and idempotent receipt", () => {
    const admission = createPrivateActivationAdmission({
      baseGeneration: digest("base-generation"),
      planDigest: digest("plan"),
      candidateRevision: 7,
      candidateDigest: digest("candidate"),
      lockDigest: digest("lock"),
    });
    const bytes = encodePrivateActivationAdmission(admission);
    expect(new TextDecoder().decode(bytes)).toBe(
      '{"baseGeneration":"sha256:d7bb43beeee67aacf5f0ae376511b9a632f0dd0923a3c37a06e8edd607687b28","candidateDigest":"sha256:dda18a0e21ae47c53b4309434cbc02ae8bf764fa83a6defbb719431242722aa7","candidateRevision":7,"kind":"private-activation-admission/2","lockDigest":"sha256:0c030586945fe504b604ecc2e875c38ede400cd5cd73da9730302162e6b02c6f","planDigest":"sha256:64879f7d6b960a01909762d911a32d4582c20010c5641ee90278b644a9e3b525"}\n',
    );
    expect(privateActivationAdmissionDigest(admission)).toBe(
      "sha256:020cd152d0eb18b195fee49ad2097beaf3d91ec0311d02f47ac37e4f76cba1d6",
    );
    expect(decodePrivateActivationAdmission(bytes)).toEqual(admission);
    expect(Object.isFrozen(admission)).toBeTrue();
  });

  test("closes generation lineage, references, and canonical encoding", () => {
    const first = createPrivateActivationAdmission({
      baseGeneration: null,
      planDigest: digest("first-plan"),
      candidateRevision: 1,
      candidateDigest: digest("first-candidate"),
      lockDigest: digest("first-lock"),
    });
    expect(first.baseGeneration).toBeNull();
    expect(createPrivateActivationAdmission({
      ...first,
      baseGeneration: digest("prior-generation"),
    }).baseGeneration).toBe(digest("prior-generation"));
    expect(() => createPrivateActivationAdmission({
      ...first,
      candidateRevision: Number.MAX_SAFE_INTEGER + 1,
    })).toThrow("positive safe integer");
    expect(() => createPrivateActivationAdmission({ ...first, planDigest: "plan" }))
      .toThrow("plan digest");

    const bytes = encodePrivateActivationAdmission(first);
    expect(() => decodePrivateActivationAdmission(bytes.subarray(0, bytes.length - 1)))
      .toThrow("not in canonical");
    expect(() => decodePrivateActivationAdmission(encoder.encode(JSON.stringify(first, null, 2) + "\n")))
      .toThrow("not in canonical");
    expect(() => decodePrivateActivationAdmission(Buffer.from(bytes)))
      .toThrow("ordinary Uint8Array");
  });
});

function digest(label: string): string {
  return `sha256:${createHash("sha256").update(label).digest("hex")}`;
}
