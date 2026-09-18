import { beforeAll, describe, expect, test } from 'bun:test'
import { parseChannelContract } from '../src/channel-contract.js'
import {
  type ParsedInvocationContract,
  parseInvocationContract,
} from '../src/invocation-contract.js'
import {
  AGENT_RUN_CONTRACT_DIGEST,
  AGENT_RUN_CONTRACT_ID,
  AGENT_RUN_CONTRACT_VERSION,
} from './fixtures/agent-contract.js'

const contractPath = new URL(
  '../../../docs/jig/spec/contracts/agent-run/contract.json',
  import.meta.url,
)
let contract: ParsedInvocationContract
async function channels(base: URL) {
  return new Map(
    await Promise.all(
      ['acp-public-updates.json', 'agent-commands.json', 'agent-replies.json'].map(
        async (name) =>
          [
            `contracts/${name}`,
            await Bun.file(new URL(`contracts/${name}`, base)).bytes(),
          ] as const,
      ),
    ),
  )
}

beforeAll(async () => {
  contract = parseInvocationContract(
    await Bun.file(contractPath).bytes(),
    'agent-run/contract.json',
    await channels(contractPath),
  )
})

describe('ordinary Agent Run contract', () => {
  test('accepts explicit session requests and final receipts without admitting them to turn commands', async () => {
    const reference = '013579ab-cdef-4567-89ab-0123456789ab'
    const input = contract.schemas.get('/input')!
    const result = contract.schemas.get('/result')!
    for (const session of [
      { retain: true },
      { retain: true, lifetime: 'run' },
      { restore: reference },
    ])
      input.validate({ instructions: 'Answer.', session })
    for (const session of [
      null,
      {},
      { retain: false },
      { retain: true, lifetime: 'forever' },
      { restore: reference, lifetime: 'run' },
      { restore: 'path' },
      { retain: true, restore: reference },
    ])
      expect(() => input.validate({ instructions: 'Answer.', session })).toThrow()
    for (const session of [
      { status: 'retained', reference },
      ...['not-cleanly-closed', 'missing-history', 'unsupported-history', 'capacity'].map(
        (reason) => ({ status: 'unavailable', reason }),
      ),
    ]) {
      result.validate({ outcome: 'done', output: { text: 'answer', session } })
      result.validate({ outcome: 'done', output: { turns: 1, session } })
    }
    for (const session of [
      null,
      {},
      { status: 'retained' },
      { status: 'unavailable' },
      { status: 'unavailable', reason: 'unknown' },
      { status: 'unavailable', reason: 'capacity', reference },
    ])
      expect(() =>
        result.validate({ outcome: 'done', output: { text: 'answer', session } }),
      ).toThrow()
    const commands = parseChannelContract(
      await Bun.file(new URL('contracts/agent-commands.json', contractPath)).bytes(),
    )
    expect(() =>
      commands.itemSchema.validate({
        type: 'prompt',
        turn: 1,
        input: { instructions: 'Continue.', session: { retain: true } },
      }),
    ).toThrow()
  })

  test('publishes and exact-matches the current Jig-owned descriptor', () => {
    expect(contract.descriptor.id).toBe(AGENT_RUN_CONTRACT_ID)
    expect(contract.descriptor.version).toBe(AGENT_RUN_CONTRACT_VERSION)
    expect(contract.digest).toBe(AGENT_RUN_CONTRACT_DIGEST)
    expect(contract.profile).toBe('single')
    expect(contract.descriptor.channels).toEqual({
      events: {
        direction: 'send',
        required: false,
        contract: './contracts/acp-public-updates.json',
      },
      commands: {
        direction: 'receive',
        required: false,
        delivery: 'direct',
        contract: './contracts/agent-commands.json',
      },
      replies: {
        direction: 'send',
        required: false,
        delivery: 'direct',
        contract: './contracts/agent-replies.json',
      },
    })
  })

  test('authored Agent consumers retain the complete exact optional channel contract', async () => {
    const profileBytes = await Bun.file(
      new URL('../../../docs/jig/spec/contracts/acp-public-updates.json', import.meta.url),
    ).bytes()
    const profile = parseChannelContract(profileBytes)
    expect(profile.descriptor.id).toBe('https://jig.md/contracts/acp-public-updates')
    profile.itemSchema.validate({
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: 'working' },
    })
    expect(() =>
      profile.itemSchema.validate({
        sessionUpdate: 'agent_thought_chunk',
        content: { type: 'text', text: 'private' },
      }),
    ).toThrow()
    const method = parseInvocationContract(
      await Bun.file(new URL('../../agent-method/FLOW.contract.json', import.meta.url)).bytes(),
      'FLOW.contract.json',
      await channels(new URL('../../agent-method/FLOW.contract.json', import.meta.url)),
    )
    expect(method.digest).toBe(contract.digest)
    const acp = new URL('../../agent-acp/FLOW.contract.json', import.meta.url)
    expect(
      parseInvocationContract(
        await Bun.file(acp).bytes(),
        'FLOW.contract.json',
        await channels(acp),
      ).digest,
    ).toBe(contract.digest)
    for (const flow of [
      'request-triage/flows/agent',
      'request-triage/flows/mixed',
      'tested-patch/flows/repair',
      'support-case/flows/assess',
      'incident-brief/flows/worker',
    ]) {
      const base = new URL(`../../../examples/${flow}/contracts/`, import.meta.url)
      const consumerContract = parseInvocationContract(
        await Bun.file(new URL('agent-run/contract.json', base)).bytes(),
        'agent-run/contract.json',
        await channels(new URL('agent-run/contract.json', base)),
      )
      expect(consumerContract.digest).toBe(contract.digest)
      expect(
        await Bun.file(new URL('agent-run/contracts/acp-public-updates.json', base)).bytes(),
      ).toEqual(profileBytes)
    }
  })
})
