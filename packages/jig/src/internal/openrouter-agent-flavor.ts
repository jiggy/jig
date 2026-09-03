import {
  createPrivateOpenAIAgentProvider,
  type PrivateOpenAIAgentProvider,
} from "./openai-agent-provider.js";
import type { PrivateInstalledBunSupport } from "./installed-bun-support.js";

const API_KEY = "OPENROUTER_API_KEY";
const MODEL = "OPENROUTER_MODEL";
export const PRIVATE_OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1" as const;

/** Optional OpenRouter configuration for the OpenAI Responses implementation. */
export function openPrivateOpenRouterAgentFlavor(
  support: PrivateInstalledBunSupport,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): PrivateOpenAIAgentProvider | undefined {
  const apiKey = environment[API_KEY];
  const model = environment[MODEL];
  if (apiKey === undefined || model === undefined) return undefined;
  return createPrivateOpenAIAgentProvider(support, {
    apiKey,
    baseURL: PRIVATE_OPENROUTER_BASE_URL,
    model,
  });
}
