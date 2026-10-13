import { dirname as suiteDirname } from 'node:path'
const suiteTestRoot = suiteDirname(import.meta.dir)
import { beforeAll, expect, test } from 'bun:test'
import { resolve } from 'node:path'
type Result = {
  scenario: string
  display: string
  code: number
  events: string[]
  retires: number
  previews: number
  sessionCloses: number
  fileCloses: number
  captureCloses: number
  capturedInputFiles: number
  capturedInputRootClosed: boolean
  presentationDeadline?: number
  observedDeadline?: number
  transportUnretired: boolean
  output: string
  error: string
}
let results: Result[]
function run(scenario: string, display = 'plain'): Result {
  const result = results.find((item) => item.scenario === scenario && item.display === display)
  if (result === undefined) throw new Error('missing controlled case')
  return result
}
beforeAll(async () => {
  const child = Bun.spawn(
    [
      process.execPath,
      '--no-env-file',
      '--no-install',
      '--config=/dev/null',
      resolve(suiteTestRoot, 'fixtures/cli-delivery-retirement.ts'),
      'all',
    ],
    { stdout: 'pipe', stderr: 'pipe', stdin: 'ignore' },
  )
  // This owns only the test fixture, not any product execution/cleanup clock.
  const stop = setTimeout(() => child.kill(), 20_000)
  try {
    const [output, error, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    expect(error).toBe('')
    expect(code).toBe(0)
    results = JSON.parse(output)
  } finally {
    clearTimeout(stop)
    child.kill()
    await child.exited
  }
}, 25_000)
for (const display of ['plain', 'json', 'tui', 'web']) {
  test(`known settled ${display} retires before local close and final output`, () => {
    const result = run('success', display)
    expect(result.code).toBe(0)
    expect(result.retires).toBe(1)
    expect(result.previews).toBe(['tui', 'web'].includes(display) ? 1 : 0)
    expect(result.fileCloses).toBe(1)
    expect(result.captureCloses).toBe(1)
    expect(result.events.indexOf('project-close')).toBeLessThan(result.events.indexOf('publish'))
    expect(result.events.indexOf('publish')).toBeLessThan(result.events.indexOf('retire'))
    expect(result.events.indexOf('spent-channel-joined')).toBeLessThan(
      result.events.indexOf('files-close'),
    )
    expect(result.events.indexOf('files-close')).toBeLessThan(result.events.indexOf('stdout'))
    expect(JSON.parse(result.output)).toMatchObject({
      status: 'succeeded',
      outcome: 'domain-blocked',
      output: { evidence: 'original result' },
      delivery: { status: 'written' },
    })
  })

  for (const scenario of [
    'project-close-failure',
    'observation-close-failure',
    'observation-failure',
    'blocked-setup',
  ]) {
    test(`${display} ${scenario} keeps its original transport without a first retire`, () => {
      const result = run(scenario, display)
      expect(result.code).not.toBe(0)
      expect(result.retires).toBe(0)
      expect(result.previews).toBe(0)
      expect(result.transportUnretired).toBe(true)
      expect(result.events).toContain('acquire')
      expect(result.events).toContain('workspace-close')
      expect(result.fileCloses).toBe(1)
      expect(result.captureCloses).toBe(1)
      if (scenario === 'project-close-failure') {
        expect(JSON.parse(result.output)).toMatchObject({
          status: 'succeeded',
          cleanup: { code: 'PROJECT_CLOSE_FAILED' },
        })
        expect(result.error).toContain('JIG_CLEANUP_FAILED')
      } else {
        expect(result.output).toBe('')
        expect(result.events).not.toContain('display-settle')
      }
    })
  }
}
for (const display of ['plain', 'web']) {
  for (const scenario of ['record-only', 'failed', 'lost', 'invalid-files', 'cancelled']) {
    test(`confirmed ${display} ${scenario} spends authority while preserving its own decision`, () => {
      const result = run(scenario, display)
      expect(result.retires).toBe(1)
      expect(result.previews).toBe(0)
      const record = JSON.parse(result.output)
      expect(record.status).toBe(
        scenario === 'failed' || scenario === 'lost' ? scenario : 'succeeded',
      )
      expect(result.code).toBe(
        scenario === 'failed'
          ? 1
          : ['lost', 'invalid-files', 'cancelled'].includes(scenario)
            ? 2
            : 0,
      )
      if (scenario === 'record-only') expect(record.delivery).toBeUndefined()
      if (scenario === 'invalid-files') expect(record.delivery.code).toBe('INVALID_FILES')
      if (scenario === 'cancelled') expect(record.command.status).toBe('interrupted')
    })
  }

  test(`${display} absence of delivery closes locally while a missing retire interface refuses success`, async () => {
    const absent = run('no-delivery', display)
    expect(absent.code).toBe(0)
    expect(absent.fileCloses).toBe(1)
    const missing = run('missing-retire', display)
    expect(missing.code).toBe(2)
    expect(missing.error).toContain(
      display === 'web' ? 'JIG_INSPECTION_CLEANUP_FAILED' : 'JIG_DELIVERY_CLEANUP_FAILED',
    )
    expect(JSON.parse(missing.output).delivery.status).toBe('written')
  })
}
for (const scenario of ['capture-close-failure', 'retire-and-capture-failure']) {
  test(`${scenario} reports local failure separately and never resets the first failed close`, () => {
    const result = run(scenario)
    expect(result.code).toBe(2)
    expect(result.retires).toBe(1)
    expect(result.fileCloses).toBe(1)
    expect(result.captureCloses).toBe(1)
    expect(result.error.match(/Diagnostic code: JIG_RUN_CLEANUP_FAILED/g)).toHaveLength(1)
    if (scenario === 'retire-and-capture-failure') {
      expect(result.error.match(/Diagnostic code: JIG_DELIVERY_CLEANUP_FAILED/g)).toHaveLength(1)
      expect(result.error).toContain('controlled primary report failure')
    } else expect(result.error).not.toContain('JIG_DELIVERY_CLEANUP_FAILED')
  })
}
test('unknown local-close failure retains the primary observation error and original loss path', () => {
  const result = run('primary-and-close-failure')
  expect(result.code).toBe(2)
  expect(result.retires).toBe(0)
  expect(result.captureCloses).toBe(1)
  expect(result.error).toContain('controlled primary observation failure')
  expect(result.error).toContain('JIG_RUN_CLEANUP_FAILED')
  expect(result.transportUnretired).toBe(true)
  expect(result.output).toBe('')
})
test('a later report error joins timely completed retirement without another operation', () => {
  const result = run('late-report-failure')
  expect(result.code).toBe(2)
  expect(result.retires).toBe(1)
  expect(result.fileCloses).toBe(1)
  expect(result.captureCloses).toBe(1)
  expect(result.error).toContain('controlled primary report failure')
  expect(result.error).not.toContain('JIG_DELIVERY_CLEANUP_FAILED')
})
test('finalization preserves the genuine presentation minimum and refuses an expired end', () => {
  const tight = run('tight-deadline')
  expect(tight.code).toBe(0)
  expect(tight.observedDeadline).toBe(tight.presentationDeadline)
  const expired = run('expired-deadline')
  expect(expired.code).toBe(2)
  expect(expired.observedDeadline).toBe(expired.presentationDeadline)
  expect(expired.error).toContain('JIG_DELIVERY_CLEANUP_FAILED')
})
for (const display of ['plain', 'web']) {
  for (const output of ['snapshot', 'linux-directory']) {
    for (const fault of ['observation-failure', 'project-close-failure']) {
      test(`${display} unsettled ${output} after ${fault} uses only its enclosing end and releases captures`, () => {
        const result = run(`pending-${output}-${fault}`, display)
        expect(result.code).toBe(2)
        expect(result.retires).toBe(0)
        expect(result.previews).toBe(0)
        expect(result.observedDeadline).toBeUndefined()
        expect(result.captureCloses).toBe(1)
        expect(result.capturedInputFiles).toBe(1)
        expect(result.capturedInputRootClosed).toBe(true)
        expect(result.fileCloses).toBe(1)
        expect(result.transportUnretired).toBe(true)
        expect(result.error).toContain('JIG_RUN_CLEANUP_FAILED')
        if (fault === 'observation-failure') {
          expect(result.error).toContain('controlled primary observation failure')
          expect(result.output).toBe('')
        } else {
          expect(result.error).toContain('JIG_CLEANUP_FAILED')
          expect(JSON.parse(result.output).cleanup.code).toBe('PROJECT_CLOSE_FAILED')
        }
      })
    }
  }
}
