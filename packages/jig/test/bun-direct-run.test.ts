import { describe, expect, test } from "bun:test";

import type { JsonValue } from "../src/json.js";
import { planPrivateBunDirectRun } from "../src/internal/bun-direct-run.js";
import { privateDomainDigest } from "../src/internal/identity.js";
import { openPrivateInstalledBunSupport } from "../src/internal/installed-bun-support.js";
import {
  PrivateLinuxCgroupBackend,
  type PrivateLinuxBackendMechanismObservation,
} from "../src/internal/linux-rootless-backend.js";
import {
  restorePrivateActivationRequest,
  type PrivateActivationRequest,
} from "../src/project/package-resolution.js";
import { installedBunLocation } from "./fixtures/installed-bun-location.js";

describe("private Bun direct Run", () => {
  test("fixes the recipe envelope to the complete root Run timeout range", async () => {
    const installedSupport = await openPrivateInstalledBunSupport(installedBunLocation);
    const backend = new StaticMechanismBackend({
      bunPath: "/test/bun",
      bunHostLibraryPath: "/test/lib",
    });

    const recipe = await planPrivateBunDirectRun({
      request: activationRequest(),
      installedSupport,
      backend,
    });

    expect(recipe.wallClockCeilingMs).toBe(86_400_000);
  });
});

class StaticMechanismBackend extends PrivateLinuxCgroupBackend {
  override async observeMechanism(): Promise<PrivateLinuxBackendMechanismObservation> {
    return MECHANISM;
  }
}

const MECHANISM: PrivateLinuxBackendMechanismObservation = Object.freeze({
  support: Object.freeze({
    kind: "linux-rootless-cgroup-v2-bubblewrap-mechanism/1",
    digest: digest("mechanism"),
    trustedBubblewrapPath: "/test/bwrap",
    trustedBubblewrapDigest: digest("bubblewrap"),
    bubblewrapVersion: "test",
    trustedCoordinatorBunPath: "/test/bun",
    trustedCoordinatorBunDigest: digest("coordinator-bun"),
    trustedCoordinatorLibraryPath: "/test/lib",
    trustedSupervisorPath: "/test/supervisor",
    trustedSupervisorDigest: digest("supervisor"),
    cgroupVersion: 2,
    controllers: Object.freeze(["cpu", "memory", "pids"]),
    payloadUid: 1_000,
    payloadGid: 1_000,
    startupTimeoutMs: 1_000,
  }),
  authority: Object.freeze({
    bootId: "00000000-0000-0000-0000-000000000000",
    delegatedCgroup: "/test/cgroup",
    delegatedCgroupDevice: "1",
    delegatedCgroupInode: "2",
  }),
});

function activationRequest(): PrivateActivationRequest {
  const fields = Object.freeze({
    kind: "activation-request/3" as const,
    target: Object.freeze({ kind: "flow" as const, path: "flows/example" }),
    mode: "run" as const,
    packagePath: "flows/example",
    package: Object.freeze({
      kind: "flow-package/1" as const,
      digest: digest("package"),
    }),
    entrypoint: Object.freeze({ path: "flow.ts", suffix: "ts", selector: "bun" }),
    settings: Object.freeze({}),
    flowSlots: Object.freeze({}),
    attachments: Object.freeze({}),
  });
  return restorePrivateActivationRequest(Object.freeze({
    ...fields,
    digest: privateDomainDigest(
      "JIG-Activation-Request/3",
      fields as unknown as JsonValue,
    ),
  }));
}

function digest(label: string): string {
  return privateDomainDigest("JIG-Test-Bun-Direct/1", { label });
}
