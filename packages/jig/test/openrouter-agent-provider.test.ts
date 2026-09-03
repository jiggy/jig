import { describe, expect, test } from "bun:test";

import { openPrivateInstalledBunSupport } from "../src/internal/installed-bun-support.js";
import {
  openPrivateOpenRouterAgentProvider,
  privateOpenRouterAgentCredential,
  requirePrivateOpenRouterAgentProvider,
} from "../src/internal/openrouter-agent-provider.js";
import {
  PRIVATE_OPENROUTER_RESPONSES_BASE_URL,
  PRIVATE_OPENROUTER_RESPONSES_MODEL,
} from "../src/internal/openrouter-responses-protocol.js";
import { AGENT_RUN_CONTRACT_DIGEST } from "../src/internal/private-agent-run.js";
import { installedBunLocation } from "./fixtures/installed-bun-location.js";

describe("fixed OpenRouter Agent provider", () => {
  test("keeps the credential out of its stable identity", async () => {
    const support = await openPrivateInstalledBunSupport(installedBunLocation);
    expect(openPrivateOpenRouterAgentProvider(support, {})).toBeUndefined();

    const first = openPrivateOpenRouterAgentProvider(support, {
      OPENROUTER_API_KEY: "test-secret-one",
    })!;
    const rotated = openPrivateOpenRouterAgentProvider(support, {
      OPENROUTER_API_KEY: "test-secret-two",
    })!;

    expect(first.digest).toBe(rotated.digest);
    expect(first).toMatchObject({
      contractDigest: AGENT_RUN_CONTRACT_DIGEST,
      baseURL: PRIVATE_OPENROUTER_RESPONSES_BASE_URL,
      model: PRIVATE_OPENROUTER_RESPONSES_MODEL,
      workerDigest: support.agentWorkerDigest,
    });
    expect(privateOpenRouterAgentCredential(first)).toBe("test-secret-one");
    expect(JSON.stringify(first)).not.toContain("test-secret");
    expect(() => requirePrivateOpenRouterAgentProvider(Object.freeze({ ...first }))).toThrow(
      "Agent provider was not produced by the fixed host factory",
    );
  });

  test("rejects malformed credentials", async () => {
    const support = await openPrivateInstalledBunSupport(installedBunLocation);
    expect(() => openPrivateOpenRouterAgentProvider(support, {
      OPENROUTER_API_KEY: "",
    })).toThrow("credential is invalid");
    expect(() => openPrivateOpenRouterAgentProvider(support, {
      OPENROUTER_API_KEY: "   ",
    })).toThrow("credential is invalid");
    expect(() => openPrivateOpenRouterAgentProvider(support, {
      OPENROUTER_API_KEY: `bad\0key`,
    })).toThrow("credential is invalid");
  });
});
