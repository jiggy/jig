import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";

import { canonicalJson, type JsonValue } from "../src/json.js";
import { privateDomainDigest } from "../src/internal/identity.js";
import {
  decodePrivateProjectLocalLock,
  privateProjectLocalLockDigest,
} from "../src/internal/project-local-lock.js";
import {
  createPrivateActivationAdmission,
  createPrivateActivationPlan,
  decodePrivateActivationAdmission,
  decodePrivateActivationPlan,
  decodePrivateActivationCandidate,
  encodePrivateActivationAdmission,
  encodePrivateActivationCandidate,
  encodePrivateActivationPlan,
  privateActivationAdmissionDigest,
  privateActivationCandidateDigest,
  privateActivationPlanDigest,
  requirePrivateCreatedActivationCandidate,
} from "../src/internal/activation-admission.js";

const encoder = new TextEncoder();

describe("private activation admission candidate", () => {
  test("has one canonical restart representation and external identity", () => {
    const bytes = fixture();
    const artifact = decodePrivateActivationCandidate(bytes);

    expect(encodePrivateActivationCandidate(artifact)).toEqual(bytes);
    expect(privateActivationCandidateDigest(artifact)).toBe(
      "sha256:81eb31892bc0679c9ac762655b39907c6de8586f5c824753ab8c77c0ef2a82d7",
    );
    expect(Object.isFrozen(artifact)).toBeTrue();
    expect(Object.isFrozen(artifact.candidate)).toBeTrue();
    expect(Object.isFrozen(artifact.candidate.target.disposition.evidenceDigests)).toBeTrue();
    expect(() => requirePrivateCreatedActivationCandidate(artifact)).toThrow(
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
    expect(() => decodePrivateActivationCandidate({
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
    expect(decodePrivateActivationCandidate(binding).candidate.target.identity).toEqual({
      kind: "binding",
      id: "run",
    });
  });

  test("represents READY only as closed recipe and observation identities", () => {
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

    const ready = {
      ...candidate,
      target: {
        ...candidate.target as object,
        disposition: {
          state: "ready",
          recipeDigest: digest("recipe"),
          observationDigest: digest("observation"),
        },
      },
    };
    expect(decodePrivateActivationCandidate({
      ...valid,
      candidate: candidateBytes(ready),
    }).candidate.target.disposition).toEqual({
      state: "ready",
      recipeDigest: digest("recipe"),
      observationDigest: digest("observation"),
    });
    expectInvalid(valid, {
      ...ready,
      target: {
        ...ready.target,
        disposition: { state: "ready", recipeDigest: digest("recipe") },
      },
    }, "must contain exactly");
  });

  test("rejects alternate spelling and malformed closed values", () => {
    const valid = fixture();
    const candidate = decodeJson(valid.candidate);

    expect(() => decodePrivateActivationCandidate({
      ...valid,
      candidate: valid.candidate.subarray(0, valid.candidate.length - 1),
    })).toThrow("not in canonical");
    expect(() => decodePrivateActivationCandidate({
      ...valid,
      candidate: encoder.encode(JSON.stringify(candidate, null, 2) + "\n"),
    })).toThrow("not in canonical");
    expect(() => decodePrivateActivationCandidate({
      ...valid,
      candidate: Uint8Array.from([0xef, 0xbb, 0xbf, ...valid.candidate]),
    })).toThrow("BOM is not allowed");
    expect(() => decodePrivateActivationCandidate({
      ...valid,
      candidate: encoder.encode(validString(valid.candidate).replace(
        '"kind":"private-activation-candidate/1"',
        '"kind":"private-activation-candidate/1","kind":"private-activation-candidate/1"',
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
    expect(() => decodePrivateActivationCandidate(accessor)).toThrow(
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
    expect(() => decodePrivateActivationCandidate(proxy)).toThrow("must not be a Proxy");
    expect(proxyTraps).toBe(0);
  });
});

describe("private activation review plan", () => {
  test("has one canonical review representation and identity", () => {
    const plan = createPrivateActivationPlan({
      candidateDigest: digest("candidate"),
      candidateRevision: 7,
      baseGeneration: digest("base-generation"),
      lockMode: "update",
      observedLock: { state: "present", digest: digest("visible-lock") },
    });
    const bytes = encodePrivateActivationPlan(plan);
    expect(new TextDecoder().decode(bytes)).toBe(
      '{"baseGeneration":"sha256:d7bb43beeee67aacf5f0ae376511b9a632f0dd0923a3c37a06e8edd607687b28","candidateDigest":"sha256:dda18a0e21ae47c53b4309434cbc02ae8bf764fa83a6defbb719431242722aa7","candidateRevision":7,"kind":"private-activation-plan/1","lockMode":"update","observedLock":{"digest":"sha256:9aefe3acf56aead5d1e689677c1655dfb7218b2ccabc3bd88322cbfe3ebaa11a","state":"present"}}\n',
    );
    expect(privateActivationPlanDigest(plan)).toBe(
      "sha256:342bcaceb5b61cd3b421cab586fcf89665233791c21dfd94be4cd643ef72a1c8",
    );
    expect(decodePrivateActivationPlan(bytes)).toEqual(plan);
    expect(Object.isFrozen(plan)).toBeTrue();
    expect(Object.isFrozen(plan.observedLock)).toBeTrue();
  });

  test("closes revisions, lock modes, observations, and alternate spelling", () => {
    const candidateDigest = digest("candidate");
    const plan = createPrivateActivationPlan({
      candidateDigest,
      candidateRevision: 1,
      baseGeneration: null,
      lockMode: "locked",
      observedLock: { state: "absent" },
    });
    expect(plan).toEqual({
      kind: "private-activation-plan/1",
      candidateDigest,
      candidateRevision: 1,
      baseGeneration: null,
      lockMode: "locked",
      observedLock: { state: "absent" },
    });
    for (const revision of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => createPrivateActivationPlan({ ...plan, candidateRevision: revision } as any)).toThrow(
        "positive safe integer",
      );
    }
    expect(() => createPrivateActivationPlan({ ...plan, lockMode: "merge" } as any)).toThrow(
      "update or locked",
    );
    expect(() => createPrivateActivationPlan({
      ...plan,
      observedLock: { state: "absent", digest: digest("extra") } as any,
    })).toThrow("must contain exactly");
    expect(() => createPrivateActivationPlan({
      ...plan,
      observedLock: { state: "present" } as any,
    })).toThrow("must contain exactly");
    expect(() => createPrivateActivationPlan({
      ...plan,
      baseGeneration: "latest",
    })).toThrow("base generation digest");

    const bytes = encodePrivateActivationPlan(plan);
    expect(() => decodePrivateActivationPlan(bytes.subarray(0, bytes.length - 1))).toThrow(
      "not in canonical",
    );
    expect(() => decodePrivateActivationPlan(encoder.encode(JSON.stringify(plan, null, 2) + "\n"))).toThrow(
      "not in canonical",
    );
    expect(() => decodePrivateActivationPlan(Buffer.from(bytes))).toThrow("ordinary Uint8Array");
  });
});

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
      '{"baseGeneration":"sha256:d7bb43beeee67aacf5f0ae376511b9a632f0dd0923a3c37a06e8edd607687b28","candidateDigest":"sha256:dda18a0e21ae47c53b4309434cbc02ae8bf764fa83a6defbb719431242722aa7","candidateRevision":7,"kind":"private-activation-admission/1","lockDigest":"sha256:0c030586945fe504b604ecc2e875c38ede400cd5cd73da9730302162e6b02c6f","planDigest":"sha256:64879f7d6b960a01909762d911a32d4582c20010c5641ee90278b644a9e3b525"}\n',
    );
    expect(privateActivationAdmissionDigest(admission)).toBe(
      "sha256:a7f0a1115724f67009eb877b36708411b03b2d5b6e5757e6ef80fbb4d39d59e5",
    );
    expect(decodePrivateActivationAdmission(bytes)).toEqual(admission);
    expect(Object.isFrozen(admission)).toBeTrue();
  });

  test("closes generation lineage, references, and alternate spelling", () => {
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
    expect(() => createPrivateActivationAdmission({
      ...first,
      planDigest: "plan",
    })).toThrow("plan digest");

    const bytes = encodePrivateActivationAdmission(first);
    expect(() => decodePrivateActivationAdmission(bytes.subarray(0, bytes.length - 1))).toThrow(
      "not in canonical",
    );
    expect(() => decodePrivateActivationAdmission(encoder.encode(JSON.stringify(first, null, 2) + "\n")))
      .toThrow("not in canonical");
    expect(() => decodePrivateActivationAdmission(Buffer.from(bytes))).toThrow("ordinary Uint8Array");
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
    kind: "private-activation-candidate/1",
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
  expect(() => decodePrivateActivationCandidate({
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
  expect(() => decodePrivateActivationCandidate({
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
      kind: "private-activation-candidate/1",
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
