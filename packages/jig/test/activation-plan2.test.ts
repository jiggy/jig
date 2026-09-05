import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";

import { canonicalJson, type JsonValue } from "../src/json.js";
import {
  createPrivateActivationPlanV2,
  decodePrivateActivationCandidateV5,
  decodePrivateActivationPlanV2,
  encodePrivateActivationCandidateV5,
  encodePrivateActivationPlanV2,
  privateActivationCandidateDigestV5,
  privateActivationPlanDigestV2,
} from "../src/internal/activation-admission.js";
import { privateDomainDigest } from "../src/internal/identity.js";
import {
  decodePrivateProjectLocalLock,
  privateProjectLocalLockDigest,
} from "../src/internal/project-local-lock.js";

const encoder = new TextEncoder();

describe("private Candidate/5", () => {
  test("separates observed semantics from canonical final activation meaning", () => {
    const artifact = candidateFixture();
    const encoded = encodePrivateActivationCandidateV5(artifact);

    expect(decodePrivateActivationCandidateV5(encoded)).toEqual(artifact);
    expect(privateActivationCandidateDigestV5(artifact)).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(artifact.candidate.kind).toBe("private-activation-candidate/5");
    expect(artifact.candidate.observedSemanticDigest).toBe(digest("observed-semantics"));
    expect(artifact.candidate.activationMeaningDigest).toBe(privateDomainDigest(
      "JIG-Private-Activation-Meaning/1",
      {
        observedSemanticDigest: artifact.candidate.observedSemanticDigest,
        targets: artifact.candidate.targets,
      } as unknown as JsonValue,
    ));
    expect(Object.isFrozen(artifact.candidate)).toBeTrue();
    expect(Object.isFrozen(artifact.candidate.targets)).toBeTrue();
  });

  test("pins one valid execution Package/1 in every ready target", () => {
    const first = readyCandidateFixture("prepared:first");
    const second = readyCandidateFixture("prepared:second");
    const encoded = encodePrivateActivationCandidateV5(first);
    const decoded = decodePrivateActivationCandidateV5(encoded);

    expect(decoded.candidate.targets[0]!.disposition).toEqual({
      state: "ready",
      recipeDigest: digest("ready-recipe"),
      observationDigest: digest("ready-observation"),
      executionPackage: {
        kind: "flow-package/1",
        digest: digest("prepared:first"),
      },
    });
    expect(privateActivationCandidateDigestV5(decoded)).toBe(
      privateActivationCandidateDigestV5(first),
    );
    expect(second.candidate.observedSemanticDigest).toBe(
      first.candidate.observedSemanticDigest,
    );
    expect(second.candidate.activationMeaningDigest).not.toBe(
      first.candidate.activationMeaningDigest,
    );
    expect(privateActivationCandidateDigestV5(second)).not.toBe(
      privateActivationCandidateDigestV5(first),
    );

    const missing = json(encoded.candidate);
    delete missing.targets[0].disposition.executionPackage;
    missing.activationMeaningDigest = activationMeaningDigest(
      missing.observedSemanticDigest,
      missing.targets,
    );
    expectInvalidCandidate(encoded, missing, "must contain exactly");

    const malformed = json(encoded.candidate);
    malformed.targets[0].disposition.executionPackage.digest = "not-a-digest";
    malformed.activationMeaningDigest = activationMeaningDigest(
      malformed.observedSemanticDigest,
      malformed.targets,
    );
    expectInvalidCandidate(encoded, malformed, "Package/1 artifact digest");
  });

  test("makes the exact Binding slot map part of request and Candidate identity", () => {
    const bug = slottedCandidateFixture({ work: { kind: "flow", path: "flows/bug" } });
    const question = slottedCandidateFixture({ work: { kind: "flow", path: "flows/question" } });
    const bugRequest = bug.candidate.targets.find(
      ({ request }) => request.target.kind === "binding",
    )!.request;
    const questionRequest = question.candidate.targets.find(
      ({ request }) => request.target.kind === "binding",
    )!.request;

    expect(bugRequest.flowSlots).toEqual({ work: { kind: "flow", path: "flows/bug" } });
    expect(Object.isFrozen(bugRequest.flowSlots)).toBeTrue();
    expect(questionRequest.digest).not.toBe(bugRequest.digest);
    expect(question.candidate.activationMeaningDigest).not.toBe(
      bug.candidate.activationMeaningDigest,
    );
    expect(privateActivationCandidateDigestV5(question)).not.toBe(
      privateActivationCandidateDigestV5(bug),
    );

    const encoded = encodePrivateActivationCandidateV5(bug);
    const mismatched = json(encoded.candidate);
    const binding = mismatched.targets.find(
      ({ request }: any) => request.target.kind === "binding",
    );
    binding.request.flowSlots = { work: { kind: "flow", path: "flows/question" } };
    binding.request.digest = requestDigest(binding.request);
    mismatched.activationMeaningDigest = activationMeaningDigest(
      mismatched.observedSemanticDigest,
      mismatched.targets,
    );
    expectInvalidCandidate(
      encoded,
      mismatched,
      "Binding configuration does not match its lock projection",
    );

    const direct = json(encoded.candidate);
    const directTarget = direct.targets.find(
      ({ request }: any) => request.target.kind === "flow" && request.packagePath === "flows/router",
    );
    directTarget.request.flowSlots = { work: { kind: "flow", path: "flows/bug" } };
    directTarget.request.digest = requestDigest(directTarget.request);
    direct.activationMeaningDigest = activationMeaningDigest(
      direct.observedSemanticDigest,
      direct.targets,
    );
    expectInvalidCandidate(encoded, direct, "direct Flow activation request must have empty configuration");
  });

  test("rejects an invalid kind and every uncommitted final meaning", () => {
    const valid = encodePrivateActivationCandidateV5(candidateFixture());
    const candidate = json(valid.candidate);

    expectInvalidCandidate(valid, {
      ...candidate,
      kind: "invalid-candidate-kind",
    }, "candidate/5 kind");
    const { observedSemanticDigest, ...withoutObserved } = candidate;
    expectInvalidCandidate(valid, {
      ...withoutObserved,
      semanticDigest: observedSemanticDigest,
    }, "must contain exactly");
    expectInvalidCandidate(valid, {
      ...candidate,
      activationMeaningDigest: digest("invented-meaning"),
    }, "activation meaning digest");
    expectInvalidCandidate(valid, {
      ...candidate,
      targets: [{
        ...candidate.targets[0],
        disposition: {
          state: "ready",
          recipeDigest: digest("new-recipe"),
          observationDigest: digest("planning-observation"),
          executionPackage: candidate.targets[0].request.package,
        },
      }],
    }, "activation meaning digest");
    expect(() => decodePrivateActivationCandidateV5({
      ...valid,
      candidate: encoder.encode(JSON.stringify(candidate, null, 2) + "\n"),
    })).toThrow("not in canonical");
  });

  test("uses locale-independent ordinal target ordering", () => {
    const artifact = candidateFixture(["flows/ä", "flows/z"]);
    expect(artifact.candidate.targets.map(({ request }) => request.packagePath)).toEqual([
      "flows/z",
      "flows/ä",
    ]);

    const encoded = encodePrivateActivationCandidateV5(artifact);
    const alternate = json(encoded.candidate);
    alternate.targets.reverse();
    expect(() => decodePrivateActivationCandidateV5({
      candidate: withLf(canonicalJson(alternate)),
      lock: encoded.lock,
    })).toThrow("not in canonical");
  });

  test("never traverses unbranded nested request values during object encoding", () => {
    const inert = candidateFixture();

    let requestTraps = 0;
    const requestProxy = new Proxy({}, {
      ownKeys() {
        requestTraps += 1;
        return [];
      },
    });
    const withRequestProxy = candidateObjectWithRequest(inert, requestProxy);
    expect(() => encodePrivateActivationCandidateV5(withRequestProxy)).toThrow(
      "candidate/5 was not built or strictly decoded",
    );
    expect(() => privateActivationCandidateDigestV5(withRequestProxy)).toThrow(
      "candidate/5 was not built or strictly decoded",
    );
    expect(requestTraps).toBe(0);

    let settingsGetterCalls = 0;
    const requestWithSettingsGetter = { ...inert.candidate.targets[0]!.request } as any;
    Object.defineProperty(requestWithSettingsGetter, "settings", {
      enumerable: true,
      get() {
        settingsGetterCalls += 1;
        return {};
      },
    });
    expect(() => encodePrivateActivationCandidateV5(
      candidateObjectWithRequest(inert, requestWithSettingsGetter),
    )).toThrow("candidate/5 was not built or strictly decoded");
    expect(settingsGetterCalls).toBe(0);

    let packageTraps = 0;
    const requestWithPackageProxy = {
      ...inert.candidate.targets[0]!.request,
      package: new Proxy({}, {
        ownKeys() {
          packageTraps += 1;
          return [];
        },
      }),
    };
    expect(() => encodePrivateActivationCandidateV5(
      candidateObjectWithRequest(inert, requestWithPackageProxy),
    )).toThrow("candidate/5 was not built or strictly decoded");
    expect(packageTraps).toBe(0);
  });
});

describe("private Plan/2", () => {
  test("derives one canonical proposal and Candidate/5 duplicated identities", () => {
    const candidate = candidateFixture();
    const plan = createPrivateActivationPlanV2({
      candidate,
      candidateRevision: 7,
      baseGeneration: digest("base-generation"),
      lockMode: "locked",
      observedLock: { state: "present", lock: candidate.lock },
      operation: "admission",
    });
    const bytes = encodePrivateActivationPlanV2(plan);

    expect(decodePrivateActivationPlanV2(bytes)).toEqual(plan);
    expect(plan).toMatchObject({
      kind: "private-activation-plan/2",
      candidateRevision: 7,
      candidateDigest: privateActivationCandidateDigestV5(candidate),
      captureDigest: candidate.candidate.captureDigest,
      resolutionInputDigest: candidate.candidate.resolutionInputDigest,
      planningObservationDigest: candidate.candidate.planningObservationDigest,
      observedSemanticDigest: candidate.candidate.observedSemanticDigest,
      activationMeaningDigest: candidate.candidate.activationMeaningDigest,
      operation: "admission",
      proposed: {
        lockDigest: candidate.candidate.lockDigest,
        lock: candidate.lock,
        targets: candidate.candidate.targets,
      },
    });
    expect(plan.observedLock).toEqual({
      state: "present",
      digest: privateProjectLocalLockDigest(candidate.lock),
      lock: candidate.lock,
    });
    expect(privateActivationPlanDigestV2(plan)).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(new TextDecoder().decode(bytes).endsWith("\n")).toBeTrue();
    expect(Object.isFrozen(plan)).toBeTrue();
    expect(Object.isFrozen(plan.proposed)).toBeTrue();
    expect(Object.isFrozen(plan.proposed.targets)).toBeTrue();
  });

  test("keeps lock repair closed and retains exact absent/present observations", () => {
    const candidate = candidateFixture();
    const repair = createPrivateActivationPlanV2({
      candidate,
      candidateRevision: 1,
      baseGeneration: digest("active-generation"),
      lockMode: "update",
      observedLock: { state: "absent" },
      operation: "lock-repair",
    });
    expect(repair.observedLock).toEqual({ state: "absent" });
    expect(repair.operation).toBe("lock-repair");

    expect(() => createPrivateActivationPlanV2({
      candidate,
      candidateRevision: 1,
      baseGeneration: digest("active-generation"),
      lockMode: "locked",
      observedLock: { state: "present", lock: candidate.lock },
      operation: "lock-repair",
    })).toThrow("lock repair requires update");
    expect(() => createPrivateActivationPlanV2({
      candidate,
      candidateRevision: 1,
      baseGeneration: null,
      lockMode: "update",
      observedLock: { state: "absent" },
      operation: "lock-repair",
    })).toThrow("active base generation");
    expect(() => createPrivateActivationPlanV2({
      candidate,
      candidateRevision: 1,
      baseGeneration: digest("active-generation"),
      lockMode: "update",
      observedLock: { state: "present", lock: candidate.lock },
      operation: "lock-repair",
    })).toThrow("absent or drifted visible lock");
    expect(() => createPrivateActivationPlanV2({
      candidate,
      candidateRevision: 1,
      baseGeneration: null,
      lockMode: "locked",
      observedLock: { state: "absent" },
      operation: "admission",
    })).toThrow("exact proposed lock observation");
  });

  test("reopens an exact slotted request through Candidate and Plan bytes", () => {
    const candidate = slottedCandidateFixture({
      question: { kind: "flow", path: "flows/question" },
      bug: { kind: "flow", path: "flows/bug" },
    });
    const reopenedCandidate = decodePrivateActivationCandidateV5(
      encodePrivateActivationCandidateV5(candidate),
    );
    const plan = createPrivateActivationPlanV2({
      candidate: reopenedCandidate,
      candidateRevision: 3,
      baseGeneration: null,
      lockMode: "update",
      observedLock: { state: "absent" },
      operation: "admission",
    });
    const reopenedPlan = decodePrivateActivationPlanV2(encodePrivateActivationPlanV2(plan));
    const request = reopenedPlan.proposed.targets.find(
      ({ request }) => request.target.kind === "binding",
    )!.request;

    expect(request.flowSlots).toEqual({
      bug: { kind: "flow", path: "flows/bug" },
      question: { kind: "flow", path: "flows/question" },
    });
    expect(Object.isFrozen(request.flowSlots)).toBeTrue();
    expect(reopenedPlan.proposed.lock.bindings.router!.slots).toEqual(request.flowSlots);
  });

  test("rejects mismatched embedded evidence and alternate encodings", () => {
    const candidate = candidateFixture();
    const plan = createPrivateActivationPlanV2({
      candidate,
      candidateRevision: 3,
      baseGeneration: null,
      lockMode: "update",
      observedLock: { state: "present", lock: candidate.lock },
      operation: "admission",
    });
    const bytes = encodePrivateActivationPlanV2(plan);
    const value = json(bytes);

    expectInvalidPlan({
      ...value,
      proposed: { ...value.proposed, lockDigest: digest("different-lock") },
    }, "proposed lock digest");
    expectInvalidPlan({
      ...value,
      observedLock: { ...value.observedLock, digest: digest("different-observation") },
    }, "observed lock digest");
    expectInvalidPlan({
      ...value,
      activationMeaningDigest: digest("different-meaning"),
    }, "meaning digest");
    expectInvalidPlan({
      ...value,
      resolutionInputDigest: digest("different-resolution-input"),
    }, "resolution input");
    expectInvalidPlan({
      ...value,
      operation: "inspect",
    }, "operation must be");
    expect(() => decodePrivateActivationPlanV2(bytes.subarray(0, bytes.length - 1)))
      .toThrow("not in canonical");
    expect(() => decodePrivateActivationPlanV2(
      encoder.encode(JSON.stringify(value, null, 2) + "\n"),
    )).toThrow("not in canonical");
    expect(() => decodePrivateActivationPlanV2(Buffer.from(bytes)))
      .toThrow("ordinary Uint8Array");

    let getterCalls = 0;
    const accessor = Object.defineProperty({
      candidate,
      candidateRevision: 3,
      baseGeneration: null,
      lockMode: "update",
      operation: "admission",
    }, "observedLock", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return { state: "absent" };
      },
    });
    expect(() => createPrivateActivationPlanV2(accessor as any)).toThrow(
      "observedLock must be an enumerable data property",
    );
    expect(getterCalls).toBe(0);

    const nestedAccessor = json(bytes);
    let nestedGetterCalls = 0;
    Object.defineProperty(nestedAccessor.proposed.lock.packages["flows/run"], "digest", {
      enumerable: true,
      get() {
        nestedGetterCalls += 1;
        return digest("run-package");
      },
    });
    expect(() => encodePrivateActivationPlanV2(nestedAccessor)).toThrow(
      "plan/2 was not built or strictly decoded",
    );
    expect(nestedGetterCalls).toBe(0);

    const nestedProxy = json(bytes);
    let nestedProxyTraps = 0;
    nestedProxy.proposed.lock.packages = new Proxy({}, {
      ownKeys() {
        nestedProxyTraps += 1;
        return [];
      },
    });
    expect(() => encodePrivateActivationPlanV2(nestedProxy)).toThrow(
      "plan/2 was not built or strictly decoded",
    );
    expect(nestedProxyTraps).toBe(0);

    for (const field of ["request", "settings", "package"] as const) {
      const nested = json(bytes);
      let traps = 0;
      const trap = new Proxy({}, {
        ownKeys() {
          traps += 1;
          return [];
        },
      });
      if (field === "request") {
        nested.proposed.targets[0].request = trap;
      } else {
        nested.proposed.targets[0].request[field] = trap;
      }
      expect(() => encodePrivateActivationPlanV2(nested)).toThrow(
        "plan/2 was not built or strictly decoded",
      );
      expect(() => privateActivationPlanDigestV2(nested)).toThrow(
        "plan/2 was not built or strictly decoded",
      );
      expect(traps).toBe(0);
    }
  });

  test("rejects an aggregate Plan that exceeds JSON/1 although each lock fits", () => {
    const candidate = candidateFixture(["flows/run"], 8_000);
    expect(() => createPrivateActivationPlanV2({
      candidate,
      candidateRevision: 1,
      baseGeneration: null,
      lockMode: "locked",
      observedLock: { state: "present", lock: candidate.lock },
      operation: "admission",
    })).toThrow("maximum encoded bytes exceeded");
  }, 30_000);
});

function candidateFixture(
  paths: readonly string[] = ["flows/run"],
  extraInertPackages = 0,
) {
  const orderedPaths = [...paths].sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
  const packages: Record<string, JsonValue> = Object.fromEntries(orderedPaths.map((path) => [path, {
    digest: digest(`package:${path}`),
    directRun: true,
    uses: {},
  }]));
  const pathTail = ["x".repeat(220), "y".repeat(240), "z".repeat(240), "w".repeat(240)];
  for (let index = 0; index < extraInertPackages; index += 1) {
    const path = `flows/${String(index).padStart(5, "0")}-${pathTail.join("/")}`;
    packages[path] = {
      digest: digest(`package:${path}`),
      directRun: false,
      uses: {},
    };
  }
  const lockBytes = withLf(canonicalJson({
    packages,
    bindings: {},
  }));
  const lock = decodePrivateProjectLocalLock(lockBytes);
  const captureDigest = digest("capture");
  const planningObservationDigest = digest("planning-observation");
  const observedSemanticDigest = digest("observed-semantics");
  const targets = orderedPaths.map((path) => ({
    request: activationRequest({
      target: { kind: "flow", path },
      mode: "run",
      packagePath: path,
      package: { kind: "flow-package/1", digest: digest(`package:${path}`) },
      entrypoint: { path: "flow.py", suffix: "py" },
      settings: {},
      attachments: {},
    }),
    disposition: {
      state: "unavailable",
      code: "RUNTIME_UNAVAILABLE",
      evidenceDigests: [digest(`runtime-evidence:${path}`)],
    },
  }));
  const activationMeaningDigest = privateDomainDigest(
    "JIG-Private-Activation-Meaning/1",
    { observedSemanticDigest, targets } as unknown as JsonValue,
  );
  return decodePrivateActivationCandidateV5({
    candidate: withLf(canonicalJson({
      kind: "private-activation-candidate/5",
      projectRoot: { device: "64768", inode: "123456" },
      captureDigest,
      observedSemanticDigest,
      activationMeaningDigest,
      resolutionInputDigest: privateDomainDigest(
        "JIG-Package-Project-Resolution-Input/1",
        { captureDigest, planningObservationDigest },
      ),
      planningObservationDigest,
      lockDigest: privateProjectLocalLockDigest(lock),
      declarationArtifact: {
        kind: "author-closure/1",
        closureDigest: digest("declaration-closure"),
        package: { kind: "flow-package/1", digest: digest("declarations") },
      },
      targets,
    })),
    lock: lockBytes,
  });
}

function readyCandidateFixture(executionPackage: string) {
  const unavailable = candidateFixture();
  const encoded = encodePrivateActivationCandidateV5(unavailable);
  const candidate = json(encoded.candidate);
  candidate.targets[0].disposition = {
    state: "ready",
    recipeDigest: digest("ready-recipe"),
    observationDigest: digest("ready-observation"),
    executionPackage: {
      kind: "flow-package/1",
      digest: digest(executionPackage),
    },
  };
  candidate.activationMeaningDigest = activationMeaningDigest(
    candidate.observedSemanticDigest,
    candidate.targets,
  );
  return decodePrivateActivationCandidateV5({
    candidate: withLf(canonicalJson(candidate)),
    lock: encoded.lock,
  });
}

function slottedCandidateFixture(slots: Readonly<Record<string, { readonly kind: "flow"; readonly path: string }>>) {
  const packages = {
    "flows/bug": {
      digest: digest("package:flows/bug"),
      directRun: true,
      uses: {},
    },
    "flows/question": {
      digest: digest("package:flows/question"),
      directRun: true,
      uses: {},
    },
    "flows/router": {
      digest: digest("package:flows/router"),
      directRun: true,
      uses: {},
    },
  };
  const lockBytes = withLf(canonicalJson({
    packages,
    bindings: {
      router: {
        packagePath: "flows/router",
        settings: { style: "brief" },
        slots,
      },
    },
  }));
  const lock = decodePrivateProjectLocalLock(lockBytes);
  const target = (path: keyof typeof packages) => ({
    request: activationRequest({
      target: { kind: "flow", path },
      mode: "run",
      packagePath: path,
      package: { kind: "flow-package/1", digest: packages[path].digest },
      entrypoint: { path: "flow.ts", suffix: "ts" },
      settings: {},
      attachments: {},
    }),
    disposition: {
      state: "unavailable",
      code: "RUNTIME_UNAVAILABLE",
      evidenceDigests: [digest(`runtime-evidence:${path}`)],
    },
  });
  const targets = [{
    request: activationRequest({
      target: { kind: "binding", id: "router" },
      mode: "run",
      packagePath: "flows/router",
      package: { kind: "flow-package/1", digest: packages["flows/router"].digest },
      entrypoint: { path: "flow.ts", suffix: "ts" },
      settings: { style: "brief" },
      flowSlots: slots,
      attachments: {},
    }),
    disposition: {
      state: "unavailable",
      code: "RUNTIME_UNAVAILABLE",
      evidenceDigests: [digest("runtime-evidence:binding:router")],
    },
  }, target("flows/bug"), target("flows/question"), target("flows/router")];
  const captureDigest = digest("slotted-capture");
  const planningObservationDigest = digest("slotted-planning");
  const observedSemanticDigest = digest("slotted-semantics");
  return decodePrivateActivationCandidateV5({
    candidate: withLf(canonicalJson({
      kind: "private-activation-candidate/5",
      projectRoot: { device: "64768", inode: "123456" },
      captureDigest,
      observedSemanticDigest,
      activationMeaningDigest: activationMeaningDigest(observedSemanticDigest, targets),
      resolutionInputDigest: privateDomainDigest(
        "JIG-Package-Project-Resolution-Input/1",
        { captureDigest, planningObservationDigest },
      ),
      planningObservationDigest,
      lockDigest: privateProjectLocalLockDigest(lock),
      declarationArtifact: {
        kind: "author-closure/1",
        closureDigest: digest("slotted-declaration-closure"),
        package: { kind: "flow-package/1", digest: digest("slotted-declarations") },
      },
      targets,
    })),
    lock: lockBytes,
  });
}

function activationMeaningDigest(observedSemanticDigest: string, targets: unknown): string {
  return privateDomainDigest(
    "JIG-Private-Activation-Meaning/1",
    { observedSemanticDigest, targets } as unknown as JsonValue,
  );
}

function expectInvalidCandidate(
  valid: { candidate: Uint8Array; lock: Uint8Array },
  candidate: unknown,
  message: string,
): void {
  expect(() => decodePrivateActivationCandidateV5({
    candidate: withLf(canonicalJson(candidate as JsonValue)),
    lock: valid.lock,
  })).toThrow(message);
}

function candidateObjectWithRequest(
  inert: ReturnType<typeof candidateFixture>,
  request: unknown,
): unknown {
  return {
    candidate: {
      ...inert.candidate,
      targets: [{ ...inert.candidate.targets[0]!, request }],
    },
    lock: inert.lock,
  };
}

function expectInvalidPlan(plan: unknown, message: string): void {
  expect(() => decodePrivateActivationPlanV2(withLf(canonicalJson(plan as JsonValue))))
    .toThrow(message);
}

function activationRequest(value: Record<string, unknown>): Record<string, unknown> {
  const request = { kind: "activation-request/4", capabilities: {}, flowSlots: {}, ...value };
  return {
    ...request,
    digest: privateDomainDigest("JIG-Activation-Request/4", request as unknown as JsonValue),
  };
}

function requestDigest(value: Record<string, unknown>): string {
  const { digest: _digest, ...content } = value;
  return privateDomainDigest("JIG-Activation-Request/4", content as unknown as JsonValue);
}

function withLf(body: Uint8Array): Uint8Array {
  const bytes = new Uint8Array(body.byteLength + 1);
  bytes.set(body);
  bytes[body.byteLength] = 0x0a;
  return bytes;
}

function json(bytes: Uint8Array): any {
  return JSON.parse(new TextDecoder().decode(bytes));
}

function digest(label: string): string {
  return `sha256:${createHash("sha256").update(label).digest("hex")}`;
}
