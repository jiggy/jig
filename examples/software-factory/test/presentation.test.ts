import { expect, test } from 'bun:test'
import { type JsonValue, OperationError } from '@jigging/flow'
import { batchJobs } from '../flows/factory/batch.ts'
import { factoryReport, jobReport, repairActivity } from '../flows/factory/presentation.ts'
import { repair } from '../flows/repair/repair.ts'
import { input, recorded } from './fixture.ts'

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
  for (const message of ['\u001b'.repeat(120), '\\"'.repeat(120), '😀'.repeat(160)]) {
    const jobs = batchJobs({
      jobs: [
        { ...job, label: '"'.repeat(80) },
        { ...job, id: 'timesheet', label: '\\'.repeat(80) },
      ],
    }).map((entry) => ({ ...entry, status: 'failed', code: 'UNCERTAIN', message }))
    const original = JSON.stringify(jobs)
    const summary = factoryReport(jobs, true)
    expect(JSON.stringify({ summary }).length).toBeLessThanOrEqual(2048)
    expect(summary.match(/No verified patch is available\./g)).toHaveLength(2)
    expect(summary).toContain('0 of 2 jobs produced a checked patch')
    expect(summary).toContain('full cause in result.json')
    expect(JSON.stringify(jobs)).toBe(original)
  }
})
