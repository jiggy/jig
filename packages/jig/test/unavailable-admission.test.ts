import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";

import { canonicalJson, type JsonValue } from "../src/json.js";
import { privateDomainDigest } from "../src/internal/identity.js";
import {
  decodePrivateProjectLocalLock,
  privateProjectLocalLockDigest,
} from "../src/internal/project-local-lock.js";
import {
  decodePrivateUnavailableCandidate,
  encodePrivateUnavailableCandidate,
  privateUnavailableCandidateDigest,
  requirePrivateCreatedUnavailableCandidate,
} from "../src/internal/unavailable-admission.js";

const encoder = new TextEncoder();

describe("private unavailable admission candidate", () => {
  test("has one canonical restart representation and external identity", () => {
    const bytes = fixture();
    const artifact = decodePrivateUnavailableCandidate(bytes);

    expect(encodePrivateUnavailableCandidate(artifact)).toEqual(bytes);
    expect(privateUnavailableCandidateDigest(artifact)).toBe(
      "sha256:e893ffacf24d02996c3ba99e66cf515e094e36c97aeb37ffdb45f2c1a50afd1e",
    );
    expect(Object.isFrozen(artifact)).toBeTrue();
    expect(Object.isFrozen(artifact.candidate)).toBeTrue();
    expect(Object.isFrozen(artifact.candidate.target.disposition.evidenceDigests)).toBeTrue();
    expect(() => requirePrivateCreatedUnavailableCandidate(artifact)).toThrow(
      "was not built from a retained project",
    );
  });

  test("ties the exact lock, resolution input, declaration source, and target", () => {
    const valid = fixture();
    const candidate = decodeJson(valid.candidate);

    expectInvalid(valid, { ...candidate, lockDigest: digest("other-lock") }, "lock digest");
    expectInvalid(valid, {
      ...candidate,
      resolutionInputDigest: digest("other-resolution-input"),
    }, "resolution input digest");
    expectInvalid(valid, {
      ...candidate,
      declarationArtifact: {
        ...candidate.declarationArtifact as object,
        kind: "flow-package/1",
      },
    }, "author-closure/1");
    expectInvalid(valid, {
      ...candidate,
      target: {
        ...candidate.target as object,
        identity: { kind: "flow", path: "flows/missing" },
      },
    }, "same single activation target");

    const nonDirectLock = decodeJson(valid.lock);
    (nonDirectLock.packages as any)["flows/run"].directRun = false;
    expect(() => decodePrivateUnavailableCandidate({
      candidate: candidateBytes({
        ...candidate,
        lockDigest: privateProjectLocalLockDigest(decodePrivateProjectLocalLock(lockBytes(nonDirectLock))),
      }),
      lock: lockBytes(nonDirectLock),
    })).toThrow("same single activation target");

    const extraDirect = decodeJson(valid.lock);
    extraDirect.packages["flows/other"] = {
      ...extraDirect.packages["flows/run"],
      digest: digest("other-package"),
    };
    expectLockTargetMismatch(valid, candidate, extraDirect);

    const extraBinding = decodeJson(valid.lock);
    extraBinding.bindings.other = {
      packagePath: "flows/run",
      attachments: {},
      slots: {},
    };
    expectLockTargetMismatch(valid, candidate, extraBinding);

    expectInvalid(valid, {
      ...candidate,
      target: {
        ...candidate.target as object,
        disposition: {
          ...(candidate.target as any).disposition,
          code: "DEPENDENCY_UNAVAILABLE",
        },
      },
    }, "cannot represent dependency unavailability");

    const binding = bindingFixture();
    expect(decodePrivateUnavailableCandidate(binding).candidate.target.identity).toEqual({
      kind: "binding",
      id: "run",
    });
  });

  test("cannot spell READY, planned work, recipes, or admission authority", () => {
    const valid = fixture();
    const candidate = decodeJson(valid.candidate);

    for (const [field, value] of [
      ["admissible", true],
      ["ready", true],
      ["recipe", { command: ["python"] }],
      ["backend", { kind: "bubblewrap" }],
    ] as const) {
      expectInvalid(valid, { ...candidate, [field]: value }, "must contain exactly");
    }

    expectInvalid(valid, {
      ...candidate,
      target: {
        ...candidate.target as object,
        disposition: {
          state: "planned",
          observation: { digest: digest("recipe") },
        },
      },
    }, "must contain exactly");
  });

  test("rejects alternate spelling and malformed closed values", () => {
    const valid = fixture();
    const candidate = decodeJson(valid.candidate);

    expect(() => decodePrivateUnavailableCandidate({
      ...valid,
      candidate: valid.candidate.subarray(0, valid.candidate.length - 1),
    })).toThrow("not in canonical");
    expect(() => decodePrivateUnavailableCandidate({
      ...valid,
      candidate: encoder.encode(JSON.stringify(candidate, null, 2) + "\n"),
    })).toThrow("not in canonical");
    expect(() => decodePrivateUnavailableCandidate({
      ...valid,
      candidate: Uint8Array.from([0xef, 0xbb, 0xbf, ...valid.candidate]),
    })).toThrow("BOM is not allowed");
    expect(() => decodePrivateUnavailableCandidate({
      ...valid,
      candidate: encoder.encode(validString(valid.candidate).replace(
        '"kind":"private-unavailable-candidate/1"',
        '"kind":"private-unavailable-candidate/1","kind":"private-unavailable-candidate/1"',
      )),
    })).toThrow("duplicate object member");

    expectInvalid(valid, {
      ...candidate,
      projectRoot: { device: "18446744073709551616", inode: "1" },
    }, "unsigned 64-bit");
    expectInvalid(valid, {
      ...candidate,
      projectRoot: { device: "064768", inode: "1" },
    }, "unsigned 64-bit");
    expectInvalid(valid, {
      ...candidate,
      declarationArtifact: {
        ...(candidate.declarationArtifact as object),
        package: { kind: "flow-package/1", digest: `sha256:${"A".repeat(64)}` },
      },
    }, "64 lowercase hexadecimal");
    expectInvalid(valid, {
      ...candidate,
      target: {
        ...candidate.target as object,
        disposition: {
          ...(candidate.target as any).disposition,
          evidenceDigests: [],
        },
      },
    }, "requires evidence");
    expectInvalid(valid, {
      ...candidate,
      target: {
        ...candidate.target as object,
        disposition: {
          ...(candidate.target as any).disposition,
          evidenceDigests: [digest("evidence"), digest("evidence")],
        },
      },
    }, "duplicate evidence");

    const reversed = [digest("z"), digest("a")].sort().reverse();
    expectInvalid(valid, {
      ...candidate,
      target: {
        ...candidate.target as object,
        disposition: {
          ...(candidate.target as any).disposition,
          evidenceDigests: reversed,
        },
      },
    }, "not in canonical");

    let getterCalls = 0;
    const accessor = Object.defineProperty({ lock: valid.lock }, "candidate", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return valid.candidate;
      },
    });
    expect(() => decodePrivateUnavailableCandidate(accessor)).toThrow(
      "candidate encoding.candidate must be an enumerable data property",
    );
    expect(getterCalls).toBe(0);

    let proxyTraps = 0;
    const proxy = new Proxy({}, {
      ownKeys() {
        proxyTraps += 1;
        return [];
      },
    });
    expect(() => decodePrivateUnavailableCandidate(proxy)).toThrow("must not be a Proxy");
    expect(proxyTraps).toBe(0);
  });
});

function fixture() {
  const packageDigest = digest("run-package");
  const lock = {
    kind: "private-package-project-lock/1",
    packages: {
      "flows/run": {
        digest: packageDigest,
        mode: "run",
        directRun: true,
        attachments: {},
        uses: {},
        provides: {},
      },
    },
    bindings: {},
  };
  const canonicalLock = lockBytes(lock);
  const decodedLock = decodePrivateProjectLocalLock(canonicalLock);
  const captureDigest = digest("capture");
  const planningObservationDigest = digest("planning");
  const candidate = {
    kind: "private-unavailable-candidate/1",
    projectRoot: { device: "64768", inode: "123456" },
    captureDigest,
    semanticDigest: digest("semantics"),
    resolutionInputDigest: privateDomainDigest(
      "JIG-Package-Project-Resolution-Input/1",
      { captureDigest, planningObservationDigest },
    ),
    planningObservationDigest,
    lockDigest: privateProjectLocalLockDigest(decodedLock),
    declarationArtifact: {
      kind: "author-closure/1",
      closureDigest: digest("closure"),
      package: { kind: "flow-package/1", digest: digest("declarations") },
    },
    target: {
      identity: { kind: "flow", path: "flows/run" },
      requestDigest: digest("request"),
      disposition: {
        state: "unavailable",
        code: "RUNTIME_UNAVAILABLE",
        evidenceDigests: [digest("evidence")],
      },
    },
  };
  return Object.freeze({ candidate: candidateBytes(candidate), lock: canonicalLock });
}

function expectInvalid(
  valid: ReturnType<typeof fixture>,
  candidate: unknown,
  message: string,
): void {
  expect(() => decodePrivateUnavailableCandidate({
    ...valid,
    candidate: candidateBytes(candidate),
  })).toThrow(message);
}

function expectLockTargetMismatch(
  valid: ReturnType<typeof fixture>,
  candidate: any,
  lock: any,
): void {
  const lockEncoding = lockBytes(lock);
  const lockValue = decodePrivateProjectLocalLock(lockEncoding);
  expect(() => decodePrivateUnavailableCandidate({
    candidate: candidateBytes({
      ...candidate,
      lockDigest: privateProjectLocalLockDigest(lockValue),
    }),
    lock: lockEncoding,
  })).toThrow("same single activation target");
}

function bindingFixture() {
  const lock = {
    kind: "private-package-project-lock/1",
    packages: {
      "flows/run": {
        digest: digest("binding-package"),
        mode: "run",
        directRun: false,
        attachments: {},
        uses: {},
        provides: {},
      },
    },
    bindings: {
      run: { packagePath: "flows/run", attachments: {}, slots: {} },
    },
  };
  const lockEncoding = lockBytes(lock);
  const lockValue = decodePrivateProjectLocalLock(lockEncoding);
  const captureDigest = digest("binding-capture");
  const planningObservationDigest = digest("binding-planning");
  return {
    candidate: candidateBytes({
      kind: "private-unavailable-candidate/1",
      projectRoot: { device: "64768", inode: "654321" },
      captureDigest,
      semanticDigest: digest("binding-semantics"),
      resolutionInputDigest: privateDomainDigest(
        "JIG-Package-Project-Resolution-Input/1",
        { captureDigest, planningObservationDigest },
      ),
      planningObservationDigest,
      lockDigest: privateProjectLocalLockDigest(lockValue),
      declarationArtifact: {
        kind: "author-closure/1",
        closureDigest: digest("binding-closure"),
        package: { kind: "flow-package/1", digest: digest("binding-declarations") },
      },
      target: {
        identity: { kind: "binding", id: "run" },
        requestDigest: digest("binding-request"),
        disposition: {
          state: "unavailable",
          code: "RUNTIME_UNAVAILABLE",
          evidenceDigests: [digest("binding-evidence")],
        },
      },
    }),
    lock: lockEncoding,
  };
}

function candidateBytes(value: unknown): Uint8Array {
  return withLf(canonicalJson(value as JsonValue));
}

function lockBytes(value: unknown): Uint8Array {
  return withLf(canonicalJson(value as JsonValue));
}

function withLf(body: Uint8Array): Uint8Array {
  const bytes = new Uint8Array(body.byteLength + 1);
  bytes.set(body);
  bytes[body.byteLength] = 0x0a;
  return bytes;
}

function decodeJson(bytes: Uint8Array): any {
  return JSON.parse(validString(bytes));
}

function validString(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

function digest(label: string): string {
  return `sha256:${createHash("sha256").update(label).digest("hex")}`;
}
