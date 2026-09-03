import type { JsonValue } from "../json.js";
import {
  requirePrivateInstalledBunSupport,
  type PrivateInstalledBunSupport,
} from "./installed-bun-support.js";
import { privateDomainDigest } from "./identity.js";
import { AGENT_RUN_CONTRACT_DIGEST } from "./private-agent-run.js";

const OPENAI_API_KEY = "OPENAI_API_KEY";
const OPENAI_MODEL = "OPENAI_MODEL";
export const PRIVATE_OPENAI_BASE_URL = "https://api.openai.com/v1" as const;
const MAX_API_KEY_BYTES = 16_384;
const encoder = new TextEncoder();

export interface PrivateOpenAIAgentProvider {
  readonly kind: "private-openai-agent-provider/1";
  readonly digest: string;
  readonly contractDigest: typeof AGENT_RUN_CONTRACT_DIGEST;
  readonly baseURL: string;
  readonly model: string;
  readonly workerDigest: string;
}

export interface PrivateOpenAIAgentProviderConfiguration {
  readonly baseURL: string;
  readonly model: string;
  readonly apiKey: string;
}

const credentials = new WeakMap<PrivateOpenAIAgentProvider, string>();

/**
 * Select native OpenAI Responses from operator-owned host configuration.
 * The secret remains only in trusted host memory; the fixed endpoint and
 * explicit model are reviewed provider identity.
 */
export function openPrivateOpenAIAgentProvider(
  supportValue: PrivateInstalledBunSupport,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): PrivateOpenAIAgentProvider | undefined {
  const apiKey = environment[OPENAI_API_KEY];
  const model = environment[OPENAI_MODEL];
  if (apiKey === undefined || model === undefined) return undefined;
  return createPrivateOpenAIAgentProvider(supportValue, {
    apiKey,
    baseURL: PRIVATE_OPENAI_BASE_URL,
    model,
  });
}

/** Internal construction seam for fixed OpenAI-compatible endpoint flavors. */
export function createPrivateOpenAIAgentProvider(
  supportValue: PrivateInstalledBunSupport,
  configuration: PrivateOpenAIAgentProviderConfiguration,
): PrivateOpenAIAgentProvider {
  const support = requirePrivateInstalledBunSupport(supportValue);
  const { apiKey, baseURL, model } = configuration;
  requireConfiguration(configuration);
  const identity = Object.freeze({
    kind: "private-openai-agent-provider/1" as const,
    contractDigest: AGENT_RUN_CONTRACT_DIGEST,
    baseURL,
    model,
    workerDigest: support.agentWorkerDigest,
  });
  const provider = Object.freeze({
    ...identity,
    digest: privateDomainDigest(
      "JIG-Private-OpenAI-Agent-Provider/1",
      identity as unknown as JsonValue,
    ),
  });
  credentials.set(provider, apiKey);
  return provider;
}

export function requirePrivateOpenAIAgentProvider(
  value: unknown,
): PrivateOpenAIAgentProvider {
  if (value === null || typeof value !== "object" || !Object.isFrozen(value) ||
      !credentials.has(value as PrivateOpenAIAgentProvider)) {
    throw new TypeError("Agent provider was not produced by the OpenAI host factory");
  }
  return value as PrivateOpenAIAgentProvider;
}

/** Trusted controller-only credential projection. */
export function privateOpenAIAgentCredential(
  providerValue: PrivateOpenAIAgentProvider,
): string {
  const provider = requirePrivateOpenAIAgentProvider(providerValue);
  return credentials.get(provider)!;
}

function requireConfiguration(
  configuration: PrivateOpenAIAgentProviderConfiguration,
): void {
  const { apiKey, baseURL, model } = configuration;
  if (apiKey.trim().length === 0 || apiKey.includes("\0") ||
      encoder.encode(apiKey).byteLength > MAX_API_KEY_BYTES) {
    throw new Error("the OpenAI Agent provider credential is invalid");
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/.test(model)) {
    throw new Error("the OpenAI Agent provider model is invalid");
  }
  let endpoint: URL;
  try {
    endpoint = new URL(baseURL);
  } catch {
    throw new Error("the OpenAI Agent provider endpoint is invalid");
  }
  if (endpoint.protocol !== "https:" || endpoint.username !== "" ||
      endpoint.password !== "" || endpoint.search !== "" || endpoint.hash !== "") {
    throw new Error("the OpenAI Agent provider endpoint is invalid");
  }
}
