import {
  requirePrivateAcpAgentProvider,
  type PrivateAcpAgentProvider,
} from "./acp-agent-provider.js";
import {
  requirePrivateOpenAIAgentProvider,
  type PrivateOpenAIAgentProvider,
} from "./openai-agent-provider.js";

export type PrivateAgentProvider = PrivateOpenAIAgentProvider | PrivateAcpAgentProvider;

export function requirePrivateAgentProvider(value: unknown): PrivateAgentProvider {
  if (value !== null && typeof value === "object" &&
      (value as { readonly kind?: unknown }).kind === "private-acp-agent-provider/1") {
    return requirePrivateAcpAgentProvider(value);
  }
  return requirePrivateOpenAIAgentProvider(value);
}
