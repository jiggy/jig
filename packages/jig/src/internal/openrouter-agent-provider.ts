import type { JsonValue } from "../json.js";
import {
  requirePrivateInstalledBunSupport,
  type PrivateInstalledBunSupport,
} from "./installed-bun-support.js";
import { privateDomainDigest } from "./identity.js";
import {
  PRIVATE_OPENROUTER_RESPONSES_BASE_URL,
  PRIVATE_OPENROUTER_RESPONSES_MODEL,
} from "./openrouter-responses-protocol.js";
import { AGENT_RUN_CONTRACT_DIGEST } from "./private-agent-run.js";

const API_KEY = "OPENROUTER_API_KEY";
const MAX_API_KEY_BYTES = 16_384;
const encoder = new TextEncoder();

export interface PrivateOpenRouterAgentProvider {
  readonly kind: "private-openrouter-agent-provider/1";
  readonly digest: string;
  readonly contractDigest: typeof AGENT_RUN_CONTRACT_DIGEST;
  readonly baseURL: typeof PRIVATE_OPENROUTER_RESPONSES_BASE_URL;
  readonly model: typeof PRIVATE_OPENROUTER_RESPONSES_MODEL;
  readonly workerDigest: string;
}

const credentials = new WeakMap<PrivateOpenRouterAgentProvider, string>();

/**
 * Select the one fixed first-party Agent provider when its operator-owned
 * credential is present. The secret remains only in trusted host memory and
 * is deliberately absent from provider identity, Plans, locks, and storage.
 */
export function openPrivateOpenRouterAgentProvider(
  supportValue: PrivateInstalledBunSupport,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): PrivateOpenRouterAgentProvider | undefined {
  const support = requirePrivateInstalledBunSupport(supportValue);
  const apiKey = environment[API_KEY];
  if (apiKey === undefined) return undefined;
  if (apiKey.trim().length === 0 || apiKey.includes("\0") ||
      encoder.encode(apiKey).byteLength > MAX_API_KEY_BYTES) {
    throw new Error("the OpenRouter Agent provider credential is invalid");
  }
  const identity = Object.freeze({
    kind: "private-openrouter-agent-provider/1" as const,
    contractDigest: AGENT_RUN_CONTRACT_DIGEST,
    baseURL: PRIVATE_OPENROUTER_RESPONSES_BASE_URL,
    model: PRIVATE_OPENROUTER_RESPONSES_MODEL,
    workerDigest: support.agentWorkerDigest,
  });
  const provider = Object.freeze({
    ...identity,
    digest: privateDomainDigest(
      "JIG-Private-OpenRouter-Agent-Provider/1",
      identity as unknown as JsonValue,
    ),
  });
  credentials.set(provider, apiKey);
  return provider;
}

export function requirePrivateOpenRouterAgentProvider(
  value: unknown,
): PrivateOpenRouterAgentProvider {
  if (value === null || typeof value !== "object" || !Object.isFrozen(value) ||
      !credentials.has(value as PrivateOpenRouterAgentProvider)) {
    throw new TypeError("Agent provider was not produced by the fixed host factory");
  }
  return value as PrivateOpenRouterAgentProvider;
}

/** Trusted controller-only credential projection. */
export function privateOpenRouterAgentCredential(
  providerValue: PrivateOpenRouterAgentProvider,
): string {
  const provider = requirePrivateOpenRouterAgentProvider(providerValue);
  return credentials.get(provider)!;
}
