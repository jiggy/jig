import { describe, expect, test } from "bun:test";

import type { JsonValue } from "../src/json.js";
import { planPrivateBunDirectRun } from "../src/internal/bun-direct-run.js";
import { privateDomainDigest } from "../src/internal/identity.js";
import { openPrivateInstalledBunHost } from "../src/internal/installed-bun-host.js";
import { openPrivateInstalledBunSupport } from "../src/internal/installed-bun-support.js";
import { openPrivateOpenAIAgentProvider } from "../src/internal/openai-agent-provider.js";
import {
  AGENT_RUN_CONTRACT_DIGEST,
  AGENT_RUN_CONTRACT_ID,
  AGENT_RUN_CONTRACT_VERSION,
} from "../src/internal/private-agent-run.js";
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

  test("requires an authenticated Agent provider without identifying its credential", async () => {
    const installedSupport = await openPrivateInstalledBunSupport(installedBunLocation);
    const backend = new StaticMechanismBackend({
      bunPath: "/test/bun",
      bunHostLibraryPath: "/test/lib",
    });
    const request = activationRequest(true);

    await expect(planPrivateBunDirectRun({
      request,
      installedSupport,
      backend,
    })).rejects.toMatchObject({
      kind: "unavailable",
      code: "PROJECT_AGENT_UNAVAILABLE",
      path: `${request.packagePath}/FLOW.md`,
    });

    const firstProvider = openPrivateOpenAIAgentProvider(installedSupport, {
      OPENAI_API_KEY: "first-secret",
      OPENAI_MODEL: "provider/test-model",
    })!;
    const rotatedProvider = openPrivateOpenAIAgentProvider(installedSupport, {
      OPENAI_API_KEY: "rotated-secret",
      OPENAI_MODEL: "provider/test-model",
    })!;
    const differentModelProvider = openPrivateOpenAIAgentProvider(installedSupport, {
      OPENAI_API_KEY: "first-secret",
      OPENAI_MODEL: "provider/other-model",
    })!;
    const differentApiProvider = openPrivateOpenAIAgentProvider(installedSupport, {
      OPENAI_API_KEY: "first-secret",
      OPENAI_MODEL: "provider/test-model",
      OPENAI_BASE_URL: "https://gateway.example/v1",
      OPENAI_API: "chat-completions",
    })!;
    const first = await planPrivateBunDirectRun({
      request,
      installedSupport,
      backend,
      agentProvider: firstProvider,
    });
    const rotated = await planPrivateBunDirectRun({
      request,
      installedSupport,
      backend,
      agentProvider: rotatedProvider,
    });
    const differentModel = await planPrivateBunDirectRun({
      request,
      installedSupport,
      backend,
      agentProvider: differentModelProvider,
    });
    const differentApi = await planPrivateBunDirectRun({
      request,
      installedSupport,
      backend,
      agentProvider: differentApiProvider,
    });

    expect(first.digest).toBe(rotated.digest);
    expect(first.observation.digest).toBe(rotated.observation.digest);
    expect(first.digest).not.toBe(differentModel.digest);
    expect(first.observation.digest).not.toBe(differentModel.observation.digest);
    expect(first.digest).not.toBe(differentApi.digest);
    expect(first.observation.digest).not.toBe(differentApi.observation.digest);
    expect(first.agentProvider).toBe(firstProvider);
    expect(JSON.stringify(first.observation)).not.toContain("secret");
  });

  test("keeps unavailable Agent configuration scoped to Agent-bearing recipes", async () => {
    const backend = new StaticMechanismBackend({
      bunPath: "/test/bun",
      bunHostLibraryPath: "/test/lib",
    });
    const environments = [
      { JIG_AGENT_CLIENT: "unknown" },
      { JIG_AGENT_CLIENT: "codex" },
      { OPENAI_API_KEY: "test-secret", OPENAI_MODEL: "invalid model" },
      {
        OPENAI_API_KEY: "test-secret",
        OPENAI_MODEL: "provider/test-model",
        OPENAI_API: "invented",
      },
    ] as const;

    for (const environment of environments) {
      const host = await openPrivateInstalledBunHost(installedBunLocation, environment);
      expect(host.agentProvider).toBeUndefined();
      await expect(planPrivateBunDirectRun({
        request: activationRequest(),
        installedSupport: host.installedBunSupport,
        backend,
        agentProvider: host.agentProvider,
      })).resolves.toMatchObject({ request: { capabilities: {} } });
      await expect(planPrivateBunDirectRun({
        request: activationRequest(true),
        installedSupport: host.installedBunSupport,
        backend,
        agentProvider: host.agentProvider,
      })).rejects.toMatchObject({ code: "PROJECT_AGENT_UNAVAILABLE" });
    }
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

function activationRequest(agent = false): PrivateActivationRequest {
  const fields = Object.freeze({
    kind: "activation-request/4" as const,
    target: Object.freeze({ kind: "flow" as const, path: "flows/example" }),
    mode: "run" as const,
    packagePath: "flows/example",
    package: Object.freeze({
      kind: "flow-package/1" as const,
      digest: digest("package"),
    }),
    entrypoint: Object.freeze({ path: "flow.ts", suffix: "ts", selector: "bun" }),
    settings: Object.freeze({}),
    capabilities: agent
      ? Object.freeze({
          agent: Object.freeze({
            id: AGENT_RUN_CONTRACT_ID,
            version: AGENT_RUN_CONTRACT_VERSION,
            digest: AGENT_RUN_CONTRACT_DIGEST,
          }),
        })
      : Object.freeze({}),
    flowSlots: Object.freeze({}),
    attachments: Object.freeze({}),
  });
  return restorePrivateActivationRequest(Object.freeze({
    ...fields,
    digest: privateDomainDigest(
      "JIG-Activation-Request/4",
      fields as unknown as JsonValue,
    ),
  }));
}

function digest(label: string): string {
  return privateDomainDigest("JIG-Test-Bun-Direct/1", { label });
}
