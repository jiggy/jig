import { describe, expect, test } from "bun:test";

import { requirePrivateBunLockPolicy } from "../src/internal/bun-native-lock-policy.js";
import {
  PRIVATE_BUN_PREPARATION_LIMITS,
  PRIVATE_BUN_PREPARED_MESSAGE_BYTES,
  PRIVATE_BUN_SOURCE_MESSAGE_BYTES,
  maximumPrivateBunFileMessageBytes,
  privateBunMessageFits,
} from "../src/internal/bun-native-preparation-protocol.js";

const INTEGRITY = "sha512-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==";

describe("private Bun preparation policy", () => {
  test.each([
    ["Git", ["value@git+https://github.com/example/value.git#abcdef", {}]],
    ["GitHub", ["value@github:example/value#abcdef", {}]],
    ["tarball", ["value@https://example.invalid/value.tgz", {}]],
    ["file", ["value@file:../value", {}]],
  ])("rejects a %s package source", (_label, resolution) => {
    expect(() => requirePrivateBunLockPolicy(lock({ value: resolution }))).toThrow(
      "unsupported Bun lock source",
    );
  });

  test("rejects a workspace graph and a custom registry", () => {
    expect(() => requirePrivateBunLockPolicy({
      ...lock({}),
      workspaces: { "": {}, packages: {} },
    })).toThrow("unsupported Bun lock source");
    expect(() => requirePrivateBunLockPolicy(lock({
      value: ["value@1.0.0", "https://packages.example.invalid", {}, INTEGRITY],
    }))).toThrow("unsupported Bun lock source");
  });

  test("accepts resolved default-registry provenance for an npm alias", () => {
    expect(() => requirePrivateBunLockPolicy({
      lockfileVersion: 1,
      workspaces: {
        "": { dependencies: { alias: "npm:value@1.0.0" } },
      },
      packages: {
        alias: ["value@1.0.0", "", {}, INTEGRITY],
      },
    })).not.toThrow();
  });

  test("derives line bounds which contain every admitted raw value", () => {
    expect(PRIVATE_BUN_SOURCE_MESSAGE_BYTES).toBe(
      maximumPrivateBunFileMessageBytes(
        "source",
        PRIVATE_BUN_PREPARATION_LIMITS.sourceFiles,
        PRIVATE_BUN_PREPARATION_LIMITS.sourceBytes,
      ),
    );
    expect(PRIVATE_BUN_PREPARED_MESSAGE_BYTES).toBe(
      maximumPrivateBunFileMessageBytes(
        "prepared",
        PRIVATE_BUN_PREPARATION_LIMITS.preparedFiles,
        PRIVATE_BUN_PREPARATION_LIMITS.preparedBytes,
      ),
    );
    expect(privateBunMessageFits(PRIVATE_BUN_PREPARED_MESSAGE_BYTES - 1, PRIVATE_BUN_PREPARED_MESSAGE_BYTES)).toBeTrue();
    expect(privateBunMessageFits(PRIVATE_BUN_PREPARED_MESSAGE_BYTES, PRIVATE_BUN_PREPARED_MESSAGE_BYTES)).toBeTrue();
    expect(privateBunMessageFits(PRIVATE_BUN_PREPARED_MESSAGE_BYTES + 1, PRIVATE_BUN_PREPARED_MESSAGE_BYTES)).toBeFalse();
  });
});

function lock(packages: Readonly<Record<string, unknown>>): object {
  return {
    lockfileVersion: 1,
    workspaces: { "": {} },
    packages,
  };
}
