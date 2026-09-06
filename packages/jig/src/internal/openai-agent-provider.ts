import type { JsonValue } from '../json.js'
import { privateDomainDigest } from './identity.js'
import {
  type PrivateInstalledBunSupport,
  requirePrivateInstalledBunSupport,
} from './installed-bun-support.js'
import { PRIVATE_OPENAI_APIS, type PrivateOpenAIApi } from './openai-agent-protocol.js'
import { AGENT_RUN_CONTRACT_DIGEST } from './private-agent-run.js'

const OPENAI_API_KEY = 'OPENAI_API_KEY'
const OPENAI_MODEL = 'OPENAI_MODEL'
const OPENAI_BASE_URL = 'OPENAI_BASE_URL'
const OPENAI_API = 'OPENAI_API'
export const PRIVATE_OPENAI_DEFAULT_BASE_URL = 'https://api.openai.com/v1' as const
export const PRIVATE_OPENAI_DEFAULT_API = 'responses' as const
const MAX_API_KEY_BYTES = 16_384
const MAX_BASE_URL_CHARACTERS = 4_096
const encoder = new TextEncoder()

export interface PrivateOpenAIAgentProvider {
  readonly kind: 'private-openai-agent-provider/1'
  readonly digest: string
  readonly contractDigest: typeof AGENT_RUN_CONTRACT_DIGEST
  readonly api: PrivateOpenAIApi
  readonly baseURL: string
  readonly model: string
  readonly workerDigest: string
}

export interface PrivateOpenAIAgentProviderConfiguration {
  readonly api: PrivateOpenAIApi
  readonly baseURL: string
  readonly model: string
  readonly apiKey: string
}

const credentials = new WeakMap<PrivateOpenAIAgentProvider, string>()

export class PrivateAgentConfigurationError extends Error {
  constructor(
    readonly field: 'OPENAI_API_KEY' | 'OPENAI_MODEL' | 'OPENAI_BASE_URL' | 'OPENAI_API',
    message: string,
  ) {
    super(message)
  }
}

/**
 * Select one OpenAI-SDK API from operator-owned host configuration.
 * The secret remains only in trusted host memory; the API, endpoint, and
 * explicit model are reviewed provider identity.
 */
export function openPrivateOpenAIAgentProvider(
  supportValue: PrivateInstalledBunSupport,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): PrivateOpenAIAgentProvider | undefined {
  const apiKey = environment[OPENAI_API_KEY]
  const model = environment[OPENAI_MODEL]
  if (apiKey === undefined || model === undefined) return undefined
  const api = environment[OPENAI_API] ?? PRIVATE_OPENAI_DEFAULT_API
  return createPrivateOpenAIAgentProvider(supportValue, {
    api: requireApi(api),
    apiKey,
    baseURL: environment[OPENAI_BASE_URL] ?? PRIVATE_OPENAI_DEFAULT_BASE_URL,
    model,
  })
}

/** Internal construction seam for one exact OpenAI-SDK endpoint selection. */
export function createPrivateOpenAIAgentProvider(
  supportValue: PrivateInstalledBunSupport,
  configuration: PrivateOpenAIAgentProviderConfiguration,
): PrivateOpenAIAgentProvider {
  const support = requirePrivateInstalledBunSupport(supportValue)
  const { api, apiKey, baseURL, model } = configuration
  requireConfiguration(configuration)
  const identity = Object.freeze({
    kind: 'private-openai-agent-provider/1' as const,
    contractDigest: AGENT_RUN_CONTRACT_DIGEST,
    api,
    baseURL,
    model,
    workerDigest: support.agentWorkerDigest,
  })
  const provider = Object.freeze({
    ...identity,
    digest: privateDomainDigest(
      'JIG-Private-OpenAI-Agent-Provider/1',
      identity as unknown as JsonValue,
    ),
  })
  credentials.set(provider, apiKey)
  return provider
}

export function requirePrivateOpenAIAgentProvider(value: unknown): PrivateOpenAIAgentProvider {
  if (
    value === null ||
    typeof value !== 'object' ||
    !Object.isFrozen(value) ||
    !credentials.has(value as PrivateOpenAIAgentProvider)
  ) {
    throw new TypeError('Agent provider was not produced by the OpenAI host factory')
  }
  return value as PrivateOpenAIAgentProvider
}

/** Trusted controller-only credential projection. */
export function privateOpenAIAgentCredential(providerValue: PrivateOpenAIAgentProvider): string {
  const provider = requirePrivateOpenAIAgentProvider(providerValue)
  return credentials.get(provider)!
}

function requireConfiguration(configuration: PrivateOpenAIAgentProviderConfiguration): void {
  const { api, apiKey, baseURL, model } = configuration
  requireApi(api)
  if (
    apiKey.trim().length === 0 ||
    apiKey.includes('\0') ||
    encoder.encode(apiKey).byteLength > MAX_API_KEY_BYTES
  ) {
    throw new PrivateAgentConfigurationError(
      'OPENAI_API_KEY',
      'the OpenAI Agent provider credential is invalid',
    )
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/.test(model)) {
    throw new PrivateAgentConfigurationError(
      'OPENAI_MODEL',
      'the OpenAI Agent provider model is invalid',
    )
  }
  if (
    typeof baseURL !== 'string' ||
    baseURL.length === 0 ||
    baseURL.length > MAX_BASE_URL_CHARACTERS
  ) {
    throw new PrivateAgentConfigurationError(
      'OPENAI_BASE_URL',
      'the OpenAI Agent provider endpoint is invalid',
    )
  }
  let endpoint: URL
  try {
    endpoint = new URL(baseURL)
  } catch {
    throw new PrivateAgentConfigurationError(
      'OPENAI_BASE_URL',
      'the OpenAI Agent provider endpoint is invalid',
    )
  }
  if (
    endpoint.protocol !== 'https:' ||
    endpoint.username !== '' ||
    endpoint.password !== '' ||
    endpoint.search !== '' ||
    endpoint.hash !== ''
  ) {
    throw new PrivateAgentConfigurationError(
      'OPENAI_BASE_URL',
      'the OpenAI Agent provider endpoint is invalid',
    )
  }
}

function requireApi(value: string): PrivateOpenAIApi {
  if (!(PRIVATE_OPENAI_APIS as readonly string[]).includes(value)) {
    throw new PrivateAgentConfigurationError(
      'OPENAI_API',
      'the OpenAI Agent provider API is invalid',
    )
  }
  return value as PrivateOpenAIApi
}
