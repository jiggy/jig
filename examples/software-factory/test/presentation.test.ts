import { expect, test } from 'bun:test'
import { batchJobs } from '../flows/factory/batch.ts'
import { factoryReport, jobPlan, jobReport, repairActivity } from '../flows/factory/presentation.ts'
import { observedChecks, readRepairProgress } from '../flows/repair/progress.ts'
import { input } from './fixture.ts'

const job = {
  id: 'logs',
  label: 'HTTP log report',
  directory: 'logs',
  checks: 'logs',
  issue: 'Repair defects.',
  editPaths: ['src/parse.ts'],
}

test('labels are bounded names and activity explains reviewed limits', () => {
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

test('report projections distinguish successes, failures, conflicts and unrouted jobs', () => {
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

test('maximum labels and escaped causes fit brief views without mutating data', () => {
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
    for (const filesConfirmed of [false, true])
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
    expect(JSON.stringify(jobs)).toBe(original)
  }
})

test('partial summaries retain original batch size without claiming delivery', () => {
  const summary = factoryReport([{ id: 'first', status: 'settled', ready: true }], false, false, 2)
  expect(summary).toContain('1 of 2 jobs produced a checked patch')
  expect(summary).toContain('Observed outcomes are available for 1 of 2 jobs')
  expect(summary).not.toContain('files/first/review.patch')
  expect(summary).not.toContain('Saved job summaries')
})

test('failure projections explain baseline and proposal causes without advertising a patch', () => {
  for (const stage of ['baseline', 'proposal'] as const) {
    const message = stage === 'baseline' ? 'The existing checks could not start.' : 'No proposal.'
    const report = factoryReport(
      [
        {
          ...job,
          status: 'failed',
          stage: 'repair',
          code: 'EXECUTION_FAILED',
          message,
          details: { failure: { stage, proposal: stage === 'proposal' ? 1 : 0 }, attempts: [] },
        },
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
    expect(report).toContain(message)
    expect(report).toContain('result.json')
    expect(report).not.toContain('Review files/logs/review.patch')
  }
})

test('goal and verification projections explain review without claiming goal achievement', () => {
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

test('check projections distinguish expected rejection exits and validate progress data', () => {
  const text = observedChecks(
    {
      candidateDigest: 'ordinary-domain-data',
      accepted: true,
      repositoryTestsPassed: true,
      acceptance: [{ id: 'reject-bad-minute', passed: true }],
      commands: [
        { invocation: ['bun', 'test', 'test/project.test.ts'] },
        { invocation: ['bun', 'src/cli.ts'], exitCode: 2 },
      ],
    } as any,
    1,
    2,
  )
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
