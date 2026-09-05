import { describe, expect, test } from 'bun:test'

import { openPrivateInstalledBunHost } from '../src/internal/installed-bun-host.js'
import { openPrivateInstalledBunSupport } from '../src/internal/installed-bun-support.js'
import {
  openPrivateOpenAIAgentProvider,
  PRIVATE_OPENAI_DEFAULT_API,
  PRIVATE_OPENAI_DEFAULT_BASE_URL,
  privateOpenAIAgentCredential,
  requirePrivateOpenAIAgentProvider,
} from '../src/internal/openai-agent-provider.js'
import { AGENT_RUN_CONTRACT_DIGEST } from '../src/internal/private-agent-run.js'
import { installedBunLocation } from './fixtures/installed-bun-location.js'

describe('private OpenAI Agent provider', () => {
  test('uses the Responses API by default and keeps credentials out of identity', async () => {
    const support = await openPrivateInstalledBunSupport(installedBunLocation)
    expect(openPrivateOpenAIAgentProvider(support, {})).toBeUndefined()

    const first = openPrivateOpenAIAgentProvider(support, {
      OPENAI_API_KEY: 'test-secret-one',
      OPENAI_MODEL: 'provider/test-model',
    })!
    const rotated = openPrivateOpenAIAgentProvider(support, {
      OPENAI_API_KEY: 'test-secret-two',
      OPENAI_MODEL: 'provider/test-model',
    })!
    const differentModel = openPrivateOpenAIAgentProvider(support, {
      OPENAI_API_KEY: 'test-secret-one',
      OPENAI_MODEL: 'provider/other-model',
    })!

    expect(first.digest).toBe(rotated.digest)
    expect(first.digest).not.toBe(differentModel.digest)
    expect(first).toMatchObject({
      contractDigest: AGENT_RUN_CONTRACT_DIGEST,
      api: PRIVATE_OPENAI_DEFAULT_API,
      baseURL: PRIVATE_OPENAI_DEFAULT_BASE_URL,
      model: 'provider/test-model',
      workerDigest: support.agentWorkerDigest,
    })
    expect(privateOpenAIAgentCredential(first)).toBe('test-secret-one')
    expect(JSON.stringify(first)).not.toContain('test-secret')
    expect(() => requirePrivateOpenAIAgentProvider(Object.freeze({ ...first }))).toThrow(
      'Agent provider was not produced by the OpenAI host factory',
    )
  })

  test('makes the selected endpoint, model, and API exact identity', async () => {
    const support = await openPrivateInstalledBunSupport(installedBunLocation)
    const responses = openPrivateOpenAIAgentProvider(support, {
      OPENAI_API_KEY: 'test-secret',
      OPENAI_MODEL: 'provider/test-model',
      OPENAI_BASE_URL: 'https://gateway.example/v1',
      OPENAI_API: 'responses',
    })!
    const chat = openPrivateOpenAIAgentProvider(support, {
      OPENAI_API_KEY: 'test-secret',
      OPENAI_MODEL: 'provider/test-model',
      OPENAI_BASE_URL: 'https://gateway.example/v1',
      OPENAI_API: 'chat-completions',
    })!
    const otherEndpoint = openPrivateOpenAIAgentProvider(support, {
      OPENAI_API_KEY: 'test-secret',
      OPENAI_MODEL: 'provider/test-model',
      OPENAI_BASE_URL: 'https://other.example/v1',
      OPENAI_API: 'chat-completions',
    })!

    expect(chat).toMatchObject({
      api: 'chat-completions',
      baseURL: 'https://gateway.example/v1',
      model: 'provider/test-model',
    })
    expect(chat.digest).not.toBe(responses.digest)
    expect(chat.digest).not.toBe(otherEndpoint.digest)
  })

  test('selects the same generic configuration in the installed host', async () => {
    const host = await openPrivateInstalledBunHost(installedBunLocation, {
      OPENAI_API_KEY: 'gateway-secret',
      OPENAI_MODEL: 'gateway/model',
      OPENAI_BASE_URL: 'https://gateway.example/v1',
      OPENAI_API: 'chat-completions',
    })
    expect(host.agentProvider).toMatchObject({
      kind: 'private-openai-agent-provider/1',
      api: 'chat-completions',
      baseURL: 'https://gateway.example/v1',
      model: 'gateway/model',
    })
  })

  test('rejects malformed complete configuration', async () => {
    const support = await openPrivateInstalledBunSupport(installedBunLocation)
    expect(() =>
      openPrivateOpenAIAgentProvider(support, {
        OPENAI_API_KEY: '',
        OPENAI_MODEL: 'provider/test-model',
      }),
    ).toThrow('credential is invalid')
    expect(() =>
      openPrivateOpenAIAgentProvider(support, {
        OPENAI_API_KEY: 'test-secret',
        OPENAI_MODEL: 'invalid model',
      }),
    ).toThrow('model is invalid')
    expect(() =>
      openPrivateOpenAIAgentProvider(support, {
        OPENAI_API_KEY: 'test-secret',
        OPENAI_MODEL: 'provider/test-model',
        OPENAI_BASE_URL: 'http://provider.example/v1',
      }),
    ).toThrow('endpoint is invalid')
    expect(() =>
      openPrivateOpenAIAgentProvider(support, {
        OPENAI_API_KEY: 'test-secret',
        OPENAI_MODEL: 'provider/test-model',
        OPENAI_API: 'invented',
      }),
    ).toThrow('API is invalid')
  })

  test('treats incomplete configuration as unavailable', async () => {
    const support = await openPrivateInstalledBunSupport(installedBunLocation)
    expect(
      openPrivateOpenAIAgentProvider(support, {
        OPENAI_API_KEY: 'test-secret',
      }),
    ).toBeUndefined()
    expect(
      openPrivateOpenAIAgentProvider(support, {
        OPENAI_MODEL: 'provider/test-model',
        OPENAI_BASE_URL: 'https://gateway.example/v1',
        OPENAI_API: 'chat-completions',
      }),
    ).toBeUndefined()
  })
})
