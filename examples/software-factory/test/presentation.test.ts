import { expect, test } from 'bun:test'
import { type JsonValue, OperationError } from '@jigging/flow'
import { batchJobs } from '../flows/factory/batch.ts'
import { factoryReport, jobPlan, jobReport, repairActivity } from '../flows/factory/presentation.ts'
import { observedChecks, readRepairProgress } from '../flows/repair/progress.ts'
import { repair } from '../flows/repair/repair.ts'
import { input, recorded, syntheticRepair } from './fixture.ts'

const job = {
  id: 'logs',
  label: 'HTTP log report',
  directory: 'logs',
  checks: 'logs',
  issue: 'Repair defects.',
  editPaths: ['src/parse.ts'],
}

test('labels are optional bounded names; activity explains work and reviewed limits', () => {
  expect(batchJobs({ jobs: [job] })[0]?.label).toBe('HTTP log report')
  for (const label of ['', ' ', 'line\nbreak', '\u001b[2J', 'x'.repeat(81)])
    expect(() => batchJobs({ jobs: [{ ...job, label }] })).toThrow()
  expect(repairActivity(job, 'proposal', 1, 2)).toBe(
    'HTTP log report: Asking the AI assistant for a proposed fix (1 of 2)',
  )
  expect(repairActivity({ id: 'timesheet' }, 'check', 2, 2)).toContain(
    'timesheet: Running tests against proposed fix 2 of 2',
  )
})

test('failure operation survives without telemetry and explains why no patch exists', async () => {
  for (const stage of ['baseline', 'proposal'] as const) {
    let failure: OperationError | undefined
    const cause =
      stage === 'proposal'
        ? 'Native ACP request failed during session/new; private client details were withheld.'
        : 'The existing test command could not start.'
    try {
      await repair({
        input,
        signal: new AbortController().signal,
        channels: {},
        call: async (call) => {
          if (stage === 'baseline' || call.slot === 'agent')
            throw new OperationError('EXECUTION_FAILED', cause)
          const request = call.input as {
            files: Record<string, string>
            args: string[]
            stdin: string
          }
          return {
            outcome: 'done',
            output: recorded(call.slot, request.files, request.args, request.stdin, false),
          }
        },
      })
    } catch (error) {
      expect(error).toBeInstanceOf(OperationError)
      failure = error as OperationError
    }
    expect(failure?.details).toMatchObject({
      failure: { stage, proposal: stage === 'proposal' ? 1 : 0 },
      attempts: [],
    })
    if (!failure) throw new Error('Expected a retained failure')
    const report = factoryReport(
      [
        {
          ...job,
          status: 'failed',
          stage: 'repair',
          code: failure.code,
          message: failure.message,
          details: failure.details,
        } as JsonValue,
      ],
      false,
    )
    expect(report).toContain('0 of 1 jobs produced a checked patch')
    expect(report).toContain(
      stage === 'proposal'
        ? 'Could not get a proposed fix from the AI assistant.'
        : 'Could not finish running the existing checks.',
    )
    expect(report).toContain('No verified patch is available.')
    expect(report).toContain(cause)
    expect(report).toContain('result.json')
    expect(report).not.toContain('Review files/logs/review.patch')
  }
})

test('retained successes, failures and conflicts remain separate from batch acceptance', () => {
  const report = factoryReport(
    [
      { ...job, status: 'settled', ready: true },
      { id: 'timesheet', status: 'failed', code: 'UNCERTAIN', message: 'Settlement unknown.' },
    ],
    true,
  )
  expect(report).toContain('1 of 2 jobs produced a checked patch')
  expect(report).toContain('Review files/logs/review.patch before applying it')
  expect(report).toContain('Confirm it has stopped before retrying')
  expect(report).toContain('The proposed patches conflict')
  expect(report).toContain('Changes have not been applied')
  expect(jobReport({ id: 'logs', status: 'unrouted' })).toContain('No repair started')
})

test('two maximum-length job labels and escaped causes still fit the terminal brief view', () => {
  for (const message of [
    '\u001b'.repeat(2000),
    '\\"'.repeat(2000),
    '\u202e'.repeat(2000),
    '😀'.repeat(2000),
  ]) {
    const jobs = batchJobs({
      jobs: [
        { ...job, label: '"'.repeat(80) },
        { ...job, id: 'timesheet', label: '\\'.repeat(80) },
      ],
    }).map((entry) => ({ ...entry, status: 'failed', code: 'UNCERTAIN', message }))
    const original = JSON.stringify(jobs)
    for (const filesConfirmed of [false, true]) {
      for (const conflicting of [false, true]) {
        const summary = factoryReport(jobs, conflicting, filesConfirmed)
        expect(JSON.stringify({ summary }).length).toBeLessThanOrEqual(2048)
        expect(summary.match(/No verified patch is available\./g)).toHaveLength(2)
        expect(summary).toContain('0 of 2 jobs produced a checked patch')
        expect(summary).toContain('full cause in retained job evidence')
        for (const entry of jobs) {
          const notice = jobReport(entry, filesConfirmed)
          expect([...notice].length).toBeLessThanOrEqual(4096)
          expect(notice).not.toContain('\u001b')
          expect(notice).not.toContain('\u202e')
          expect(new TextDecoder().decode(new TextEncoder().encode(notice))).toBe(notice)
          expect(notice).not.toContain('full cause in result.json')
        }
      }
    }
    expect(JSON.stringify(jobs)).toBe(original)
  }
})

test('partial failure summaries keep the original batch size and do not claim file delivery', () => {
  const summary = factoryReport([{ id: 'first', status: 'settled', ready: true }], false, false, 2)
  expect(summary).toContain('1 of 2 jobs produced a checked patch')
  expect(summary).toContain('Observed outcomes are available for 1 of 2 jobs')
  expect(summary).not.toContain('files/first/review.patch')
  expect(summary).not.toContain('Saved job summaries')
})

test('job goals and independently verified checks remain understandable without live updates', () => {
  const plan = jobPlan({ ...job, method: 'p2' }, input)
  expect(plan).toContain('Requested goal: "Reject fractional')
  expect(plan).toContain('with one correction if needed')
  expect(plan).toContain('4 independent CLI cases')
  const report = factoryReport(
    [
      {
        ...job,
        status: 'settled',
        ready: true,
        verification: {
          proposal: 1,
          changedPaths: ['src/parse.ts'],
          acceptanceCases: input.cases.map((c) => c.id),
        },
      },
    ],
    false,
  )
  expect(report).toContain('Requested goal: "Repair defects."')
  expect(report).toContain('4/4 independent acceptance cases passed (proposal 1)')
  expect(report).toContain('Changed files: "src/parse.ts"')
  expect(report).toContain('Review files/logs/review.patch')
  expect(report).not.toContain('goal achieved')
})

test('reported commands and expected rejection cases are facts, not shell instructions or generic failures', () => {
  const evaluation = {
    candidateDigest: 'synthetic',
    accepted: true,
    repositoryTestsPassed: true,
    acceptance: [{ id: 'reject-bad-minute', passed: true }],
    commands: [
      { invocation: ['bun', 'test', 'test/project.test.ts'] },
      { invocation: ['bun', 'src/cli.ts'], exitCode: 2 },
    ],
  }
  const text = observedChecks(evaluation as any, 1, 2)
  expect(text).toContain('1/1 passed')
  expect(text).toContain('Passing cases: "reject-bad-minute"')
  expect(text).toContain('independent factory verification')
  expect(text).not.toContain('command error')
  for (const malformed of [
    { phase: 'command', attempt: 0 },
    { phase: 'observed', attempt: 0, detail: 'x'.repeat(2049) },
    { phase: 'command', attempt: 0, detail: 'ok', authority: true },
  ])
    expect(() => readRepairProgress(malformed)).toThrow()
  expect(
    readRepairProgress({ phase: 'command', attempt: 0, detail: 'logical tests slot' }).phase,
  ).toBe('command')
})

test('blocking proposal causes remain visible when live updates are disabled', async () => {
  const rejected = await repair({
    input,
    settings: { maxProposals: 1 },
    signal: new AbortController().signal,
    channels: {},
    call: async (call) => {
      if (call.slot === 'agent')
        return {
          outcome: 'done',
          output: {
            text: 'A proposed change.',
            structured: {
              summary: 'A proposed change.',
              replacements: [{ path: 'README.md', content: 'Unapproved change.' }],
            },
          },
        }
      const request = call.input as { files: Record<string, string>; args: string[]; stdin: string }
      return {
        outcome: 'done',
        output: recorded(call.slot, request.files, request.args, request.stdin, false),
      }
    },
  })
  const checked = (await syntheticRepair(1, true)).result
  for (const [result, cause] of [
    [rejected, 'The proposal changes an unapproved file.'],
    [checked, 'mismatched acceptance cases:'],
  ] as const) {
    expect(result.outcome).toBe('blocked')
    const report = factoryReport(
      [{ ...job, status: 'settled', ready: false, result } as JsonValue],
      false,
    )
    expect(report).toContain(cause)
    expect(report).not.toContain('Review files/logs/review.patch')
    expect(JSON.stringify({ summary: report }).length).toBeLessThanOrEqual(2048)
  }
})
