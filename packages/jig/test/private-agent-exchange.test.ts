import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import {
  AGENT_EXCHANGE_CONTRACT_DIGEST,
  AGENT_EXCHANGE_CONTRACT_ID,
  AGENT_EXCHANGE_CONTRACT_VERSION,
  assertAgentExchangeContract,
  assertAgentProviderPrompt,
  parseAgentExchangeInput,
  projectAgentExchangeResult,
} from '../src/internal/private-agent-exchange.js'
import { parseInvocationContract } from '../src/invocation-contract.js'
import {
  defaultInvocationSlots,
  isHostOnlyInvocationId,
  normalizeInvocationSlots,
  resolveInvocationSlots,
} from '../src/project/invocation-slots.js'

const identity = {
  id: AGENT_EXCHANGE_CONTRACT_ID,
  version: AGENT_EXCHANGE_CONTRACT_VERSION,
  digest: AGENT_EXCHANGE_CONTRACT_DIGEST,
}
const schema = {
  $schema: 'https://flow.jig.md/schemas/schema-1.json',
  type: 'object',
  properties: { answer: { type: 'string' } },
  required: ['answer'],
  additionalProperties: false,
} as const

describe('bounded native Agent Exchange', () => {
  test('keeps host execution and retention evidence non-substitutable', () => {
    for (const name of ['http-request', 'project-command', 'run-checkpoint']) {
      const contract = {
        id: `https://jig.md/contracts/${name}`,
        version: '1.0.0',
        digest: `sha256:${'0'.repeat(64)}`,
      }
      expect(isHostOnlyInvocationId(contract.id)).toBe(true)
      expect(() =>
        normalizeInvocationSlots({
          effect: { kind: 'flow', target: { kind: 'flow', path: 'flows/fake' }, contract },
        }),
      ).toThrow('host evidence interfaces')
    }
    expect(isHostOnlyInvocationId('https://jig.md/contracts/agent-run')).toBe(false)
    expect(isHostOnlyInvocationId('https://jig.md/contracts/agent-exchange')).toBe(false)
  })
  test('matches the published descriptor and the complete ordinary method bundle', async () => {
    const bases = [
      new URL('../../../docs/jig/spec/contracts/agent-exchange/', import.meta.url),
      new URL('../../agent-method/contracts/agent-exchange/', import.meta.url),
    ]
    const records = await Promise.all(
      bases.map(async (base) => {
        const bytes = await readFile(new URL('contract.json', base))
        const channel = await readFile(new URL('contracts/acp-public-updates.json', base))
        const contract = parseInvocationContract(
          bytes,
          'contract.json',
          new Map([['contracts/acp-public-updates.json', channel]]),
        )
        expect(contract.digest).toBe(identity.digest)
        expect(() => assertAgentExchangeContract(contract)).not.toThrow()
        contract.schemas.get('/input')!.validate({ prompt: 'Hello', responseSchema: schema })
        for (const stop of ['end-turn', 'refusal', 'limit'])
          contract.schemas
            .get('/result')!
            .validate(projectAgentExchangeResult({ text: 'answer', stop }))
        return { bytes, channel }
      }),
    )
    expect(records[0]).toEqual(records[1])
  })

  test('pins the native default while permitting an explicitly selected Flow implementation', () => {
    expect(defaultInvocationSlots({ model: identity })).toEqual({
      model: { kind: 'native', native: 'agent-exchange', contract: identity },
    })
    expect(() =>
      defaultInvocationSlots({ model: { ...identity, digest: `sha256:${'0'.repeat(64)}` } }),
    ).toThrow()
    expect(
      resolveInvocationSlots(
        { model: identity },
        {
          model: { kind: 'flow', path: 'flows/pretender' },
        },
      ),
    ).toMatchObject({
      model: {
        kind: 'flow',
        target: { kind: 'flow', path: 'flows/pretender' },
        contract: identity,
      },
    })
  })

  test('snapshots a complete prompt and supported schema without interpreting it', () => {
    const input = { prompt: '  exact prompt\n', responseSchema: structuredClone(schema) }
    const accepted = parseAgentExchangeInput(input)
    input.prompt = 'changed'
    input.responseSchema.properties.answer.type = 'invalid' as 'string'
    expect(accepted).toEqual({ prompt: '  exact prompt\n', responseSchema: schema })
    expect(Object.isFrozen(accepted)).toBe(true)
    expect(Object.isFrozen(accepted.responseSchema)).toBe(true)
  })

  test('host checks reject extra powers even if callers bypass the method', () => {
    for (const field of [
      'apiKey',
      'model',
      'baseURL',
      'maxTokens',
      'tools',
      'sessionId',
      'permissions',
    ])
      expect(() => parseAgentExchangeInput({ prompt: 'work', [field]: 'forged' })).toThrow()
    for (const input of [
      null,
      [],
      {},
      { prompt: '' },
      { prompt: 1 },
      { prompt: 'work', responseSchema: null },
      { prompt: 'work', responseSchema: { ...schema, additionalProperties: true } },
      { prompt: 'work', responseSchema: { ...schema, required: [] } },
    ])
      expect(() => parseAgentExchangeInput(input)).toThrow()
    let read = false
    expect(() =>
      parseAgentExchangeInput({
        get prompt() {
          read = true
          return 'work'
        },
      }),
    ).toThrow()
    expect(read).toBe(false)
  })

  test('bounds UTF-8 and schema bytes rather than only character counts', () => {
    expect(() => parseAgentExchangeInput({ prompt: '🙂'.repeat(262145) })).toThrow(
      expect.objectContaining({ code: 'RESOURCE_EXHAUSTED' }),
    )
    expect(() =>
      parseAgentExchangeInput({
        prompt: 'work',
        responseSchema: {
          ...schema,
          description: 'x'.repeat(256 * 1024),
        },
      }),
    ).toThrow(expect.objectContaining({ code: 'RESOURCE_EXHAUSTED' }))
  })

  test('native control-looking text is rejected independently of method rendering', () => {
    for (const prompt of [
      '/compact',
      '/autocompact on',
      '/session',
      '/model different-model',
      '/goal do more',
      '/logout',
      ' \n/changelog',
      '\u2003/export anything',
      '/unknown',
    ])
      for (const client of ['pi', 'anthropic-claude-code', 'openai-codex'])
        expect(() => assertAgentProviderPrompt(client, prompt)).toThrow(
          expect.objectContaining({ code: 'INVALID_INPUT' }),
        )
    for (const client of ['pi', 'anthropic-claude-code', 'openai-codex'])
      expect(() => assertAgentProviderPrompt(client, 'Explain /compact')).not.toThrow()
    expect(() => assertAgentProviderPrompt(undefined, '/literal API prompt')).not.toThrow()
  })

  test('returns transport facts without manufacturing an interpreted result', () => {
    expect(projectAgentExchangeResult({ text: 'not JSON', stop: 'end-turn' })).toEqual({
      outcome: 'done',
      output: { text: 'not JSON', stop: 'end-turn' },
    })
    for (const result of [
      { outcome: 'done', text: 'answer' },
      { text: 'answer', stop: 'cancelled' },
      { text: 'answer', stop: 'end-turn', structured: { approved: true } },
      { text: 'answer', stop: 'end-turn', apiKey: 'secret' },
      { text: '\ud800', stop: 'end-turn' },
      { text: '\\'.repeat(8 * 1024 * 1024), stop: 'end-turn' },
    ])
      expect(() => projectAgentExchangeResult(result)).toThrow()
  })
})
