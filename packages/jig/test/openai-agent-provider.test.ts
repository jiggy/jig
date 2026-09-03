import { describe, expect, test } from "bun:test";

import { openPrivateInstalledBunHost } from "../src/internal/installed-bun-host.js";
import { openPrivateInstalledBunSupport } from "../src/internal/installed-bun-support.js";
import {
  openPrivateOpenAIAgentProvider,
  PRIVATE_OPENAI_BASE_URL,
  privateOpenAIAgentCredential,
  requirePrivateOpenAIAgentProvider,
} from "../src/internal/openai-agent-provider.js";
import {
  openPrivateOpenRouterAgentFlavor,
  PRIVATE_OPENROUTER_BASE_URL,
} from "../src/internal/openrouter-agent-flavor.js";
import { AGENT_RUN_CONTRACT_DIGEST } from "../src/internal/private-agent-run.js";
import { installedBunLocation } from "./fixtures/installed-bun-location.js";

describe("private OpenAI Agent provider", () => {
  test("uses native OpenAI configuration with no default model", async () => {
    const support = await openPrivateInstalledBunSupport(installedBunLocation);
    expect(openPrivateOpenAIAgentProvider(support, {})).toBeUndefined();

    const first = openPrivateOpenAIAgentProvider(support, {
      OPENAI_API_KEY: "test-secret-one",
      OPENAI_MODEL: "provider/test-model",
    })!;
    const rotated = openPrivateOpenAIAgentProvider(support, {
      OPENAI_API_KEY: "test-secret-two",
      OPENAI_MODEL: "provider/test-model",
    })!;
    const differentModel = openPrivateOpenAIAgentProvider(support, {
      OPENAI_API_KEY: "test-secret-one",
      OPENAI_MODEL: "provider/other-model",
    })!;

    expect(first.digest).toBe(rotated.digest);
    expect(first.digest).not.toBe(differentModel.digest);
    expect(first).toMatchObject({
      contractDigest: AGENT_RUN_CONTRACT_DIGEST,
      baseURL: PRIVATE_OPENAI_BASE_URL,
      model: "provider/test-model",
      workerDigest: support.agentWorkerDigest,
    });
    expect(privateOpenAIAgentCredential(first)).toBe("test-secret-one");
    expect(JSON.stringify(first)).not.toContain("test-secret");
    expect(() => requirePrivateOpenAIAgentProvider(Object.freeze({ ...first }))).toThrow(
      "Agent provider was not produced by the OpenAI host factory",
    );
  });

  test("accepts OpenRouter only as an optional OpenAI-compatible flavor", async () => {
    const support = await openPrivateInstalledBunSupport(installedBunLocation);
    const openRouter = openPrivateOpenRouterAgentFlavor(support, {
      OPENROUTER_API_KEY: "test-secret",
      OPENROUTER_MODEL: "provider/test-model",
    })!;
    const native = openPrivateOpenAIAgentProvider(support, {
      OPENAI_API_KEY: "test-secret",
      OPENAI_MODEL: "provider/test-model",
    })!;

    expect(openRouter).toMatchObject({
      baseURL: PRIVATE_OPENROUTER_BASE_URL,
      model: "provider/test-model",
    });
    expect(openRouter.digest).not.toBe(native.digest);
  });

  test("selects exactly one configured host flavor", async () => {
    const native = await openPrivateInstalledBunHost(installedBunLocation, {
      OPENAI_API_KEY: "native-secret",
      OPENAI_MODEL: "native-model",
    });
    const openRouter = await openPrivateInstalledBunHost(installedBunLocation, {
      OPENROUTER_API_KEY: "router-secret",
      OPENROUTER_MODEL: "router/model",
    });
    const nativeWithIncompleteFlavor = await openPrivateInstalledBunHost(
      installedBunLocation,
      {
        OPENAI_API_KEY: "native-secret",
        OPENAI_MODEL: "native-model",
        OPENROUTER_API_KEY: "unused-partial-secret",
      },
    );
    const openRouterWithIncompleteNative = await openPrivateInstalledBunHost(
      installedBunLocation,
      {
        OPENAI_API_KEY: "unused-partial-secret",
        OPENROUTER_API_KEY: "router-secret",
        OPENROUTER_MODEL: "router/model",
      },
    );
    expect(native.agentProvider?.baseURL).toBe(PRIVATE_OPENAI_BASE_URL);
    expect(openRouter.agentProvider?.baseURL).toBe(PRIVATE_OPENROUTER_BASE_URL);
    expect(nativeWithIncompleteFlavor.agentProvider?.baseURL).toBe(PRIVATE_OPENAI_BASE_URL);
    expect(openRouterWithIncompleteNative.agentProvider?.baseURL)
      .toBe(PRIVATE_OPENROUTER_BASE_URL);
    const ambiguous = await openPrivateInstalledBunHost(installedBunLocation, {
      OPENAI_API_KEY: "native-secret",
      OPENAI_MODEL: "native-model",
      OPENROUTER_API_KEY: "router-secret",
      OPENROUTER_MODEL: "router/model",
    });
    expect(ambiguous.agentProvider).toBeUndefined();
  });

  test("rejects malformed complete configuration", async () => {
    const support = await openPrivateInstalledBunSupport(installedBunLocation);
    expect(() => openPrivateOpenAIAgentProvider(support, {
      OPENAI_API_KEY: "",
      OPENAI_MODEL: "provider/test-model",
    })).toThrow("credential is invalid");
    expect(() => openPrivateOpenAIAgentProvider(support, {
      OPENAI_API_KEY: "   ",
      OPENAI_MODEL: "provider/test-model",
    })).toThrow("credential is invalid");
    expect(() => openPrivateOpenAIAgentProvider(support, {
      OPENAI_API_KEY: `bad\0key`,
      OPENAI_MODEL: "provider/test-model",
    })).toThrow("credential is invalid");
    expect(() => openPrivateOpenAIAgentProvider(support, {
      OPENAI_API_KEY: "test-secret",
      OPENAI_MODEL: "invalid model",
    })).toThrow("model is invalid");
  });

  test("treats incomplete configuration as unavailable", async () => {
    const support = await openPrivateInstalledBunSupport(installedBunLocation);
    expect(openPrivateOpenAIAgentProvider(support, {
      OPENAI_API_KEY: "test-secret",
    })).toBeUndefined();
    expect(openPrivateOpenAIAgentProvider(support, {
      OPENAI_MODEL: "provider/test-model",
    })).toBeUndefined();
    expect(openPrivateOpenRouterAgentFlavor(support, {
      OPENROUTER_API_KEY: "test-secret",
    })).toBeUndefined();
    expect(openPrivateOpenRouterAgentFlavor(support, {
      OPENROUTER_MODEL: "provider/test-model",
    })).toBeUndefined();
  });
});
