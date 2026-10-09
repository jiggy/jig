import { describe, expect, test } from 'bun:test'
import { guidedReviewAgentSetup } from '../src/cli-review-agent-setup.js'
import type { PrivateAgentReadinessReport } from '../src/internal/review-agent-setup.js'
import type { AcpGrant } from '../src/project/grants.js'

function report(policy: AcpGrant = { kind: 'acp', client: 'pi' }): PrivateAgentReadinessReport {
  return {
    projectIdentity: { device: '1', inode: '2' },
    readyTargets: 1,
    unavailableTargets: 2,
    complete: true,
    issues: [
      {
        target: { kind: 'binding', id: 'model' },
        declaration: 'bindings/model.ts',
        slot: 'native',
        client: policy.client,
        code: `PROJECT_ACP_${policy.client.toUpperCase()}_EXECUTABLE`,
        alternatives: ['codex', 'claude', 'codex'],
        grant: {
          path: 'custom-resources/interpreter.json',
          policy,
          bytes: Buffer.from(JSON.stringify(policy)),
          recipients: [
            { binding: 'model', declaration: 'bindings/model.ts', slot: 'native' },
            { binding: 'assistant', declaration: 'bindings/assistant.ts', slot: 'agent' },
          ],
        },
      },
    ],
  }
}

function interaction(answers: string[] = [], confirmations: boolean[] = []) {
  const writes: string[] = [],
    prompts: string[] = []
  return {
    writes,
    prompts,
    interactive: true,
    yes: false,
    write(text: string) {
      writes.push(text)
    },
    async answer(prompt: string) {
      prompts.push(prompt)
      return answers.shift() ?? ''
    },
    async confirm(prompt: string) {
      prompts.push(prompt)
      return confirmations.shift() ?? false
    },
  }
}

describe('guided review Agent setup', () => {
  test('uses exact captured custom path and confirms all recipients and policy before proposing a write', async () => {
    const value = report({ kind: 'acp', client: 'pi', maxTurns: 3 })
    const io = interaction(['2'], [true])
    const result = await guidedReviewAgentSetup(value, io)
    expect(result.kind).toBe('edit')
    if (result.kind !== 'edit') throw new Error('missing proposal')
    expect(result.proposal).toMatchObject({
      path: 'custom-resources/interpreter.json',
      projectIdentity: { device: '1', inode: '2' },
      previous: value.issues[0]!.grant!.policy,
      proposed: { kind: 'acp', client: 'codex', maxTurns: 3 },
    })
    expect(Buffer.from(result.proposal.expectedBytes)).toEqual(
      Buffer.from(value.issues[0]!.grant!.bytes),
    )
    expect(result.proposal.expectedBytes).not.toBe(value.issues[0]!.grant!.bytes)
    const printed = io.writes.join('')
    expect(printed).toContain('binding:model')
    expect(printed).toContain('binding:assistant')
    expect(printed).toContain('maxTurns: 3')
    expect(printed).toContain('retainSessions: (absent) -> (absent)')
    expect(printed).toContain('Model pin: (none) -> (none; operator configuration/default)')
    expect(io.prompts.at(-1)).toContain('Update "custom-resources/interpreter.json"')
    expect(printed).toContain('1. Use claude')
    expect(printed).toContain('2. Use codex')
  })

  test('keeping, invalid choices, declined source consent and cancel never return edits', async () => {
    for (const answer of ['', '3', '0', '5', 'anything']) {
      const io = interaction([answer], [true])
      expect(await guidedReviewAgentSetup(report(), io)).toEqual({ kind: 'keep' })
    }
    expect(await guidedReviewAgentSetup(report(), interaction(['2'], [false]))).toEqual({
      kind: 'keep',
    })
    expect(await guidedReviewAgentSetup(report(), interaction(['4']))).toEqual({ kind: 'cancel' })
  })

  test('noninteractive, --yes, inline, non-executable setup and incomplete report do not offer editing', async () => {
    for (const kind of ['noninteractive', 'yes', 'inline', 'model', 'incomplete']) {
      const value = report()
      const io = interaction(['2'], [true])
      const next =
        kind === 'inline' || kind === 'model'
          ? {
              ...value,
              issues: [
                {
                  ...value.issues[0]!,
                  ...(kind === 'inline' ? { grant: undefined } : { code: 'PROJECT_ACP_PI_MODEL' }),
                },
              ],
            }
          : kind === 'incomplete'
            ? { ...value, complete: false, issues: [] }
            : value
      if (kind === 'noninteractive') io.interactive = false
      if (kind === 'yes') io.yes = true
      expect(await guidedReviewAgentSetup(next, io)).toEqual({ kind: 'keep' })
      expect(io.prompts).toEqual([])
      if (kind === 'incomplete')
        expect(io.writes.join('')).toContain('edit their ACP grants directly')
    }
    expect(await guidedReviewAgentSetup(undefined, interaction())).toEqual({ kind: 'keep' })
  })

  test('pinned models need an explicit default choice or replacement', async () => {
    const value = report({ kind: 'acp', client: 'pi', model: 'prior-model', maxTurns: 2 })
    const reset = await guidedReviewAgentSetup(value, interaction(['2', '1'], [true]))
    expect(reset.kind).toBe('edit')
    if (reset.kind === 'edit')
      expect(reset.proposal.proposed).toEqual({ kind: 'acp', client: 'codex', maxTurns: 2 })
    const replace = await guidedReviewAgentSetup(
      value,
      interaction(['2', '2', 'codex-model'], [true]),
    )
    expect(replace.kind).toBe('edit')
    if (replace.kind === 'edit') expect(replace.proposal.proposed.model).toBe('codex-model')
    for (const answers of [
      ['2', ''],
      ['2', '3'],
      ['2', '2', ''],
      ['2', '2', 'bad model'],
    ])
      expect(await guidedReviewAgentSetup(value, interaction(answers, [true]))).toEqual({
        kind: 'keep',
      })
  })

  test('Codex session retention requires explicit removal before the final source confirmation', async () => {
    const value = report({ kind: 'acp', client: 'codex', maxTurns: 4, retainSessions: true })
    expect(await guidedReviewAgentSetup(value, interaction(['1'], [false, true]))).toEqual({
      kind: 'keep',
    })
    const io = interaction(['1'], [true, true])
    const result = await guidedReviewAgentSetup(value, io)
    expect(result.kind).toBe('edit')
    if (result.kind === 'edit')
      expect(result.proposal.proposed).toEqual({ kind: 'acp', client: 'claude', maxTurns: 4 })
    expect(io.prompts[1]).toContain('Remove retainSessions')
    expect(io.prompts[2]).toContain('Update')
    expect(io.writes.join('')).toContain('retainSessions: true -> (absent)')
  })

  test('shared identical setup issues prompt once; different captured bytes earn a fresh interaction', async () => {
    const value = report()
    const issue = value.issues[0]!
    const shared = {
      ...value,
      issues: [issue, { ...issue, target: { kind: 'binding' as const, id: 'other' } }],
    }
    const seen = new Set<string>()
    const io = interaction(['3'])
    expect(await guidedReviewAgentSetup(shared, io, seen)).toEqual({ kind: 'keep' })
    expect(io.prompts).toHaveLength(1)
    await guidedReviewAgentSetup(shared, io, seen)
    expect(io.prompts).toHaveLength(1)
    await guidedReviewAgentSetup(
      {
        ...value,
        issues: [
          {
            ...issue,
            grant: {
              ...issue.grant!,
              bytes: Buffer.from(' ' + JSON.stringify(issue.grant!.policy)),
            },
          },
        ],
      },
      io,
      seen,
    )
    expect(io.prompts).toHaveLength(2)
  })

  test('literal identities are escaped and cancellation after a prompt cannot produce a write', async () => {
    const value = report()
    const controller = new AbortController()
    const io = interaction(['2'], [true])
    const unsafe = {
      ...value,
      issues: [{ ...value.issues[0]!, declaration: 'fake\n\u001b[31mhost success' }],
    }
    await guidedReviewAgentSetup(unsafe, {
      ...io,
      signal: controller.signal,
      async answer() {
        controller.abort()
        return '2'
      },
    }).then(
      () => {
        throw new Error('expected cancellation')
      },
      () => undefined,
    )
    expect(io.writes.join('')).not.toContain('\u001b')
    expect(io.writes.join('')).toContain('fake\\n\\u001b[31mhost success')
  })
})
