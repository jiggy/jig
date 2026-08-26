import { describe, expect, test } from "bun:test";

import { canonicalJson, type JsonValue } from "../src/json.js";
import { privateDomainDigest } from "../src/internal/identity.js";
import {
  decodePrivatePythonExactPlanningIntent,
  encodePrivatePythonExactPlanningIntent,
  planPrivatePythonExactRunIntent,
} from "../src/internal/python-nix-run.js";

describe("private exact Python planning intent", () => {
  test("strictly reconstructs the one fixed request without minting host provenance", async () => {
    const bytes = planningIntent("flows/example", `sha256:${"a".repeat(64)}`);
    const decoded = decodePrivatePythonExactPlanningIntent(bytes);
    expect(decoded).toEqual({
      kind: "python-exact-planning-intent/1",
      requestDigest: requestDigest("flows/example", `sha256:${"a".repeat(64)}`),
      packagePath: "flows/example",
      package: { kind: "flow-package/1", digest: `sha256:${"a".repeat(64)}` },
    });
    expect(Object.isFrozen(decoded)).toBe(true);
    expect(() => encodePrivatePythonExactPlanningIntent({ ...decoded } as never)).toThrow(
      "activation request was not produced from a linked package project",
    );
    await expect(planPrivatePythonExactRunIntent({
      storeRoot: "/unused",
      request: bytes,
      runtime: {} as never,
      backend: {} as never,
      policyDigest: `sha256:${"b".repeat(64)}`,
      sandboxLimits: {
        memoryBytes: 1,
        pids: 1,
        cpuQuotaMicros: 1,
        cpuPeriodMicros: 1,
        wallClockMs: 1,
        cleanupTimeoutMs: 1,
      },
      runHostLimits: {
        cancellationGraceMs: 0,
        stdoutBytes: 16 * 1024 * 1024 + 1,
        stderrBytes: 0,
        capturedStderrBytes: 0,
      },
    })).rejects.toThrow("Python runtime was not produced by the private Nix observer");
  });

  test("rejects alternate encodings and changed request meaning", () => {
    const bytes = planningIntent("flows/example", `sha256:${"a".repeat(64)}`);
    expect(() => decodePrivatePythonExactPlanningIntent(
      Buffer.concat([Buffer.from(" "), Buffer.from(bytes)]),
    )).toThrow("not canonically encoded");

    const changed = Buffer.from(bytes);
    const offset = changed.indexOf(Buffer.from("requestDigest"));
    const digestOffset = changed.indexOf(Buffer.from("sha256:"), offset) + "sha256:".length;
    changed[digestOffset] = changed[digestOffset] === 0x30 ? 0x31 : 0x30;
    expect(() => decodePrivatePythonExactPlanningIntent(changed)).toThrow(
      "request digest does not match",
    );

    const unknown = JSON.parse(Buffer.from(bytes.subarray(0, -1)).toString("utf8")) as Record<string, JsonValue>;
    unknown.extra = true;
    expect(() => decodePrivatePythonExactPlanningIntent(withLf(canonicalJson(unknown)))).toThrow(
      "unknown or missing fields",
    );
  });
});

function planningIntent(packagePath: string, digest: string): Uint8Array {
  return withLf(canonicalJson({
    kind: "python-exact-planning-intent/1",
    requestDigest: requestDigest(packagePath, digest),
    packagePath,
    package: { kind: "flow-package/1", digest },
  }));
}

function requestDigest(packagePath: string, digest: string): string {
  return privateDomainDigest("JIG-Activation-Request/1", {
    kind: "activation-request/1",
    target: { kind: "flow", path: packagePath },
    mode: "run",
    packagePath,
    package: { kind: "flow-package/1", digest },
    entrypoint: { path: "flow.py", suffix: "py" },
    settings: {},
    attachments: {},
    slots: {},
  });
}

function withLf(value: Uint8Array): Uint8Array {
  const result = new Uint8Array(value.byteLength + 1);
  result.set(value);
  result[result.length - 1] = 0x0a;
  return result;
}
