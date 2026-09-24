import { expect, test } from 'bun:test'
import { OperationError, type RunContext } from '@jigging/flow'
import { evaluate } from '../flows/repair/evidence.ts'
import { candidate, digest, parseInput, parseProposal } from '../flows/repair/policy.ts'
import { input, proposal, recorded, syntheticRepair } from './fixture.ts'

test('multi-file repair delegates Agent work and retains independent command evidence', async () => {
  const { result, agents, commands } = await syntheticRepair()
  expect(result.outcome).toBe('done')
  expect(agents).toBe(1)
  expect(commands).toBe(2 * (input.cases.length + 1))
  expect((result.output as any).attempts[0].candidateDigest).toBe(
    digest(candidate(input, proposal)),
  )
  expect(candidate(input, proposal)['test/project.test.ts']).toBe(
    input.files['test/project.test.ts'],
  )
})

test('successful progress publishes its final phase and closes the transferred writer', async () => {
  const phases: unknown[] = []
  let closed = false
  const progress = {
    direction: 'send' as const,
    send: async (phase: unknown) => {
      expect(closed).toBe(false)
      phases.push(phase)
    },
    close: async () => {
      closed = true
    },
  } as unknown as NonNullable<RunContext['channels']['progress']>
  const { result } = await syntheticRepair({ channels: { progress } })
  expect(result.outcome).toBe('done')
  expect(phases).toEqual([
    { phase: 'baseline', attempt: 0 },
    { phase: 'proposal', attempt: 1 },
    { phase: 'check', attempt: 1 },
    { phase: 'finished', attempt: 1 },
  ])
  expect(closed).toBe(true)
})
test('unsuccessful repairs retain both proposals against the original', async () => {
  const { result, agents } = await syntheticRepair({ success: false })
  expect(result.outcome).toBe('blocked')
  expect(agents).toBe(2)
  expect((result.output as any).attempts.map((a) => a.candidateDigest)).toEqual([
    digest(candidate(input, proposal)),
    digest(candidate(input, proposal)),
  ])
})
test('a non-reproduced defect does not call the Agent', async () => {
  expect(await syntheticRepair({ alreadyPasses: true })).toMatchObject({
    agents: 0,
    result: { outcome: 'blocked' },
  })
})
test('out-of-authority proposals get at most one correction and never execute', async () => {
  const result = await syntheticRepair({ invalid: true })
  expect(result).toMatchObject({
    agents: 2,
    commands: 1 + input.cases.length,
    result: { outcome: 'blocked' },
  })
  expect(
    (result.result.output as any).attempts.every((a) => a.invalidProposal && !a.evaluation),
  ).toBe(true)
})
test('cancellation, uncertainty and deadlines retain the first proposal without replay', async () => {
  for (const code of ['CANCELLED', 'UNCERTAIN', 'DEADLINE_EXCEEDED', 'UNAVAILABLE']) {
    try {
      await syntheticRepair({ failCommand: code })
      throw new Error('expected failure')
    } catch (error) {
      expect(error).toBeInstanceOf(OperationError)
      expect((error as OperationError).code).toBe(code)
      expect(((error as OperationError).details as any).attempts).toHaveLength(1)
      expect(((error as OperationError).details as any).attempts[0].evaluation).toBeUndefined()
    }
  }
})
test('project and replacement bounds reject traversal, test edits, duplicates and invalid Unicode', () => {
  expect(parseInput(input)).toEqual(input)
  for (const replacements of [
    [{ path: '../outside.ts', content: '' }],
    [{ path: 'test/project.test.ts', content: '' }],
    [proposal.replacements[0], proposal.replacements[0]],
    [{ path: 'src/parse.ts', content: '\ud800' }],
  ])
    expect(() => parseProposal({ ...proposal, replacements }, input)).toThrow()
  expect(() =>
    parseInput({ ...input, files: { ...input.files, 'src/../../secret': '' } }),
  ).toThrow()
  expect(() =>
    parseInput({ ...input, files: { ...input.files, 'src/large.ts': 'x'.repeat(65537) } }),
  ).toThrow()
})
test('candidate-reported pass flags cannot replace externally captured behavior', () => {
  const records = [
    recorded('tests', input.files, [], '', true),
    ...input.cases.map((c) => recorded('cli', input.files, c.args, c.stdin, false)),
  ]
  for (const r of records.slice(1)) r.stdout.text = '{"passed":true}\n'
  expect(evaluate(input, input.files, records)).toMatchObject({
    repositoryTestsPassed: true,
    accepted: false,
  })
  records[1]!.candidateDigest = 'sha256:' + '0'.repeat(64)
  expect(() => evaluate(input, input.files, records)).toThrow('identity')
})

// Both configurations use the same independent checks; only correction differs.
test('one proposal stops on failed checks while two proposals can correct them', async () => {
  for (const maxProposals of [1, 2]) {
    const { result, agents, commands } = await syntheticRepair({
      settings: { maxProposals },
      succeedsOn: 2,
    })
    expect(agents).toBe(maxProposals)
    expect(commands).toBe((maxProposals + 1) * (input.cases.length + 1))
    expect(result.outcome).toBe(maxProposals === 1 ? 'blocked' : 'done')
    expect((result.output as any).attempts[0].evaluation.accepted).toBe(false)
  }
  for (const maxProposals of [0, 3, '1', null])
    await expect(syntheticRepair({ settings: { maxProposals } })).rejects.toThrow('maxProposals')
})
