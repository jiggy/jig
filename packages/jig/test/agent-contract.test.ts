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

beforeAll(async () => {
  contract = parseInvocationContract(
    await Bun.file(contractPath).bytes(),
    'agent-run/contract.json',
    new Map([
      [
        'contracts/acp-public-updates.json',
        await Bun.file(new URL('contracts/acp-public-updates.json', contractPath)).bytes(),
      ],
    ]),
  )
})

describe('ordinary Agent Run contract', () => {
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
      new Map([
        [
          'contracts/acp-public-updates.json',
          await Bun.file(
            new URL('../../agent-method/contracts/acp-public-updates.json', import.meta.url),
          ).bytes(),
        ],
      ]),
    )
    expect(method.digest).toBe(contract.digest)
    for (const flow of [
      'request-triage/flows/agent',
      'request-triage/flows/mixed',
      'tested-patch/flows/repair',
      'support-case/flows/assess',
    ]) {
      const base = new URL(`../../../examples/${flow}/contracts/`, import.meta.url)
      const consumerContract = parseInvocationContract(
        await Bun.file(new URL('agent-run/contract.json', base)).bytes(),
        'agent-run/contract.json',
        new Map([
          [
            'contracts/acp-public-updates.json',
            await Bun.file(new URL('agent-run/contracts/acp-public-updates.json', base)).bytes(),
          ],
        ]),
      )
      expect(consumerContract.digest).toBe(contract.digest)
      expect(
        await Bun.file(new URL('agent-run/contracts/acp-public-updates.json', base)).bytes(),
      ).toEqual(profileBytes)
    }
  })
})
