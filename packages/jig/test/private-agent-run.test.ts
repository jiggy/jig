import { beforeAll, describe, expect, test } from 'bun:test'
import { parseChannelContract } from '../src/channel-contract.js'
import {
  AGENT_RUN_CONTRACT_DIGEST,
  AGENT_RUN_CONTRACT_ID,
  AGENT_RUN_CONTRACT_VERSION,
  assertAgentRunContract,
  parseAgentRunInput,
  parseAgentRunResult,
} from '../src/internal/private-agent-run.js'
import {
  type ParsedInvocationContract,
  parseInvocationContract,
} from '../src/invocation-contract.js'
import { SCHEMA_1_URI } from '../src/schema/index.js'

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

describe('private Agent Run contract', () => {
  test('accepts explicit caller Skill bytes without resolving names or inventing provenance', () => {
    const skills = [
      { name: 'caller-choice', files: [{ path: 'SKILL.md', text: 'Exact café\r\n' }] },
    ]
    const prepared = parseAgentRunInput(contract, { instructions: 'Work.', skills })
    skills[0]!.files[0]!.text = 'changed'
    expect(prepared.input.skills?.[0]?.files[0]?.text).toBe('Exact café\r\n')
    expect(Object.isFrozen(prepared.input.skills?.[0]?.files[0])).toBe(true)
    for (const invalid of [
      null,
      ['name'],
      [{ name: '../escape', files: [] }],
      [{ name: 'valid', files: [] }],
      [{ name: 'valid', files: [{ path: '../SKILL.md', text: 'bad' }] }],
    ])
      expect(() =>
        parseAgentRunInput(contract, { instructions: 'Work.', skills: invalid }),
      ).toThrow()
  })

  test('publishes and exact-matches the current Jig-owned descriptor', () => {
    expect(contract.descriptor.id).toBe(AGENT_RUN_CONTRACT_ID)
    expect(contract.descriptor.version).toBe(AGENT_RUN_CONTRACT_VERSION)
    expect(contract.digest).toBe(AGENT_RUN_CONTRACT_DIGEST)
    expect(contract.profile).toBe('single')
    expect(() => assertAgentRunContract(contract)).not.toThrow()
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
      'support-case/flows/assess',
      'request-triage/flows/agent',
      'request-triage/flows/mixed',
      'tested-patch/flows/repair',
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

  test('authored assessment schemas satisfy the Agent structured-output profile', async () => {
    for (const file of [
      'request-triage/flows/agent/queue.schema.json',
      'request-triage/flows/mixed/queue.schema.json',
      'support-case/flows/assess/proposal.schema.json',
    ]) {
      const responseSchema = await Bun.file(new URL(`../../../examples/${file}`, import.meta.url)).json()
      expect(() => parseAgentRunInput(contract, {
        instructions: 'Assess the supplied synthetic request.', responseSchema,
      })).not.toThrow()
    }
  })

  test('snapshots one valid input and treats omitted skills as none', () => {
    const source = { instructions: 'Do the bounded work.' }
    const prepared = parseAgentRunInput(contract, source)
    source.instructions = 'changed afterward'

    expect(prepared.input).toEqual({ instructions: 'Do the bounded work.' })
    expect(Object.isFrozen(prepared)).toBe(true)
    expect(Object.isFrozen(prepared.input)).toBe(true)
    expect(
      parseAgentRunResult(contract, prepared, {
        outcome: 'blocked',
        output: { text: 'No suitable action.' },
      }),
    ).toEqual({ outcome: 'blocked', output: { text: 'No suitable action.' } })
  })

  test('requires recursive responseSchema results and validates their structured value', () => {
    const prepared = parseAgentRunInput(contract, {
      instructions: 'Return bounded evidence.',
      responseSchema: {
        $schema: SCHEMA_1_URI,
        type: 'object',
        properties: {
          assessment: {
            type: 'object',
            properties: {
              status: { type: 'string', enum: ['clear', 'ambiguous'] },
              amount: { type: ['integer', 'null'] },
              note: { type: ['string', 'null'] },
              sources: {
                type: 'array',
                minItems: 0,
                maxItems: 2,
                items: {
                  type: 'object',
                  properties: {
                    page: { type: 'integer' },
                    excerpt: { type: 'string' },
                  },
                  required: ['page', 'excerpt'],
                  additionalProperties: false,
                },
              },
            },
            required: ['status', 'amount', 'note', 'sources'],
            additionalProperties: false,
          },
        },
        required: ['assessment'],
        additionalProperties: false,
      },
    })

    expect(() =>
      parseAgentRunResult(contract, prepared, {
        outcome: 'done',
        output: { text: 'missing' },
      }),
    ).toThrow(expect.objectContaining({ code: 'AGENT_RUN_STRUCTURED_REQUIRED' }))
    expect(() =>
      parseAgentRunResult(contract, prepared, {
        outcome: 'done',
        output: {
          text: 'invalid',
          structured: {
            assessment: {
              status: 'clear',
              amount: 1_500,
              note: null,
              sources: [{ page: 1 }],
            },
          },
        },
      }),
    ).toThrow(expect.objectContaining({ code: 'AGENT_RUN_STRUCTURED_INVALID' }))
    expect(
      parseAgentRunResult(contract, prepared, {
        outcome: 'done',
        output: {
          text: 'valid',
          structured: {
            assessment: {
              status: 'clear',
              amount: 1_500,
              note: null,
              sources: [{ page: 1, excerpt: 'base pay' }],
            },
          },
        },
      }),
    ).toEqual({
      outcome: 'done',
      output: {
        text: 'valid',
        structured: {
          assessment: {
            status: 'clear',
            amount: 1_500,
            note: null,
            sources: [{ page: 1, excerpt: 'base pay' }],
          },
        },
      },
    })
    expect(
      parseAgentRunResult(contract, prepared, {
        outcome: 'limit',
        output: { text: 'output limit reached' },
      }),
    ).toEqual({ outcome: 'limit', output: { text: 'output limit reached' } })
  })

  test('rejects malformed values and an invalid response Schema/1 root', () => {
    expect(() => parseAgentRunInput(contract, { instructions: '' })).toThrow(
      expect.objectContaining({ code: 'AGENT_RUN_INPUT_INVALID' }),
    )
    expect(() =>
      parseAgentRunInput(contract, {
        instructions: 'invalid schema',
        responseSchema: { type: 'object' },
      }),
    ).toThrow(expect.objectContaining({ code: 'INVALID_INPUT' }))

    const prepared = parseAgentRunInput(contract, { instructions: 'check output' })
    expect(() =>
      parseAgentRunResult(contract, prepared, {
        outcome: 'invented',
        output: { text: 'invalid' },
      }),
    ).toThrow(expect.objectContaining({ code: 'AGENT_RUN_RESULT_INVALID' }))

    const accessor = Object.defineProperty({}, 'instructions', {
      enumerable: true,
      get: () => 'hidden getter',
    })
    expect(() => parseAgentRunInput(contract, accessor)).toThrow(
      expect.objectContaining({ code: 'AGENT_RUN_JSON_INVALID' }),
    )
  })

  test('reparses exact descriptor bytes instead of trusting caller schema state', () => {
    const schemas = new Map(contract.schemas)
    schemas.set('/input', { path: 'forged', schemaPointer: '', validate() {} })
    const forgedSchemas = { ...contract, schemas } as ParsedInvocationContract
    expect(() => parseAgentRunInput(forgedSchemas, { instructions: 3 })).toThrow(
      expect.objectContaining({ code: 'AGENT_RUN_INPUT_INVALID' }),
    )

    const changed = {
      ...contract,
      descriptor: { ...contract.descriptor, version: '1.0.1' },
    } as ParsedInvocationContract
    expect(() => assertAgentRunContract(changed)).toThrow(
      expect.objectContaining({ code: 'AGENT_RUN_CONTRACT_MISMATCH' }),
    )

    const oldDomain = {
      ...contract,
      descriptor: { ...contract.descriptor, id: 'https://jig.dev/contracts/agent-run' },
    } as ParsedInvocationContract
    expect(() => assertAgentRunContract(oldDomain)).toThrow(
      expect.objectContaining({ code: 'AGENT_RUN_CONTRACT_MISMATCH' }),
    )
  })

  test('rejects a forged prepared-input object', () => {
    expect(() =>
      parseAgentRunResult(
        contract,
        { input: { instructions: 'forged' } },
        { outcome: 'done', output: { text: 'not admitted' } },
      ),
    ).toThrow(expect.objectContaining({ code: 'AGENT_RUN_INPUT_UNPREPARED' }))
  })
})
