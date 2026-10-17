import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { privateCliCommandLifetimeMs } from '../../src/cli.js'
import { PrivateCliProgress } from '../../src/cli-progress.js'
import {
  PRIVATE_PRESENTATION_CLOSE_RESERVE_MS,
  PRIVATE_PRESENTATION_DEADLINE_ENV,
  privateConstrainPresentationDeadline,
  privatePresentationDeadline,
  privatePresentationNow,
  privateRootlessCommandLifetime,
} from '../../src/internal/root-run-timeout-policy.js'
import { privateRunDisplay } from '../../src/run-arguments.js'
import { settleTestCommand } from '../fixtures/bounded-command.js'

test('operator-only notices never enter browser observation data', async () => {
  const chunks: string[] = []
  const progress = new PrivateCliProgress(false, text => { chunks.push(text) }, undefined)
  try {
    progress.notice('Output: "/private/operator/evidence"\n', 'info', false)
    await progress.flush()
    expect(chunks.join('')).toContain('/private/operator/evidence')
    expect(progress.model.journal).toEqual([])
  } finally {
    progress.close()
  }
})

test('only effective interactive TUI selection omits the default command envelope', () => {
  const args = ['run', 'flow:flows/work', '--display', 'tui']
  expect(privateCliCommandLifetimeMs(args, true)).toBeNull()
  expect(privateCliCommandLifetimeMs([...args, '--timeout', '1ms'], true)).toBeNull()
  expect(privateCliCommandLifetimeMs(args, false)).toBe(330_000)
  for (const machine of [['--json'], ['--receive', 'events']])
    expect(privateCliCommandLifetimeMs([...args, ...machine], true)).toBe(330_000)
  for (const display of ['auto', 'plain'])
    expect(privateCliCommandLifetimeMs(['run', 'flow:flows/work', '--display', display], true)).toBe(330_000)
  expect(privateCliCommandLifetimeMs(['review'], true)).toBe(300_000)
  for (const input of [false, true])
    for (const output of [false, true]) {
      expect(privateRunDisplay('auto', input, output)).toBe(input && output ? 'tui' : 'auto')
      for (const display of ['tui', 'plain', 'web'] as const)
        expect(privateRunDisplay(display, input, output)).toBe(display)
    }
})

describe('private presentation deadline values', () => {
  test('expired bounds keep their meaning across actual Bun reexecution', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jig-presentation-clock-'))
    let passed = false
    try {
      const deadline = privateConstrainPresentationDeadline({}, PRIVATE_PRESENTATION_CLOSE_RESERVE_MS + 75)
      await Bun.sleep(150)
      const module = new URL('../../src/internal/root-run-timeout-policy.ts', import.meta.url).href
      const child = Bun.spawn([
        process.execPath, '--no-env-file', '--no-install', '--config=/dev/null', '--eval',
        `import {privatePresentationNow,privatePresentationDeadline,privateConstrainPresentationDeadline} from ${JSON.stringify(module)};
console.log(JSON.stringify({now:privatePresentationNow(),inherited:privatePresentationDeadline(process.env),constrained:privateConstrainPresentationDeadline(process.env,60000)}));`,
      ], {
        env: { [PRIVATE_PRESENTATION_DEADLINE_ENV]: String(deadline) },
        stdin: 'ignore', stdout: 'pipe', stderr: 'pipe',
      })
      const result = await settleTestCommand(child, { evidence: join(root, 'child'), timeoutMs: 5_000 })
      expect(result.code).toBe(0)
      expect(result.stderr).toBe('')
      const observation = JSON.parse(result.stdout)
      expect(observation.inherited).toBe(deadline)
      expect(observation.constrained).toBe(deadline)
      expect(observation.now).toBeGreaterThan(deadline)
      passed = true
    } finally {
      if (passed) await rm(root, { recursive: true, force: true })
      else console.error(`Presentation clock evidence retained at ${root}`)
    }
  })
  test('enclosing timers preserve the earliest bound instead of restarting it', () => {
    expect(PRIVATE_PRESENTATION_CLOSE_RESERVE_MS).toBe(45_000)
    const first = privateConstrainPresentationDeadline({}, 330_000, 1_000)
    expect(first).toBe(286_000)
    const environment = { [PRIVATE_PRESENTATION_DEADLINE_ENV]: String(first) }
    expect(privateConstrainPresentationDeadline(environment, 330_000, 90_000)).toBe(first)
    expect(privateConstrainPresentationDeadline(environment, 60_000, 100_000)).toBe(115_000)
    expect(privateConstrainPresentationDeadline(environment, 30_000, 100_000)).toBe(85_000)
    expect(privateRootlessCommandLifetime(30_000)).toBe(330_000)
  })
  test('invalid private values confer no presentation allowance', () => {
    for (const text of ['', '-1', '1.5', 'NaN', 'Infinity', '01', '9007199254740992', ' 1'])
      expect(privatePresentationDeadline({ [PRIVATE_PRESENTATION_DEADLINE_ENV]: text })).toBeUndefined()
  })
  test('the real host clock is monotonic and shorter file bounds dominate delegation', () => {
    expect(privatePresentationNow()).toBeLessThanOrEqual(privatePresentationNow())
    const file = privateConstrainPresentationDeadline({}, 120_000, 100_000)
    expect(file).toBe(175_000)
    expect(privateConstrainPresentationDeadline(
      { [PRIVATE_PRESENTATION_DEADLINE_ENV]: String(file) }, 330_000, 130_000,
    )).toBe(file)
  })
})
