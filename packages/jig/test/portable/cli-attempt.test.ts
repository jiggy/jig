import { expect, test } from 'bun:test'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  privateCliAttemptOperation,
  privateCliCommandLifetimeMs,
  privateCliRequiresHost,
} from '../../src/cli.js'
import { settleTestCommand } from '../fixtures/bounded-command.js'

test('ordinary source Run refuses missing approval without claiming approval changed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jig-unreviewed-run-'))
  const evidence = await mkdtemp(join(tmpdir(), 'jig-unreviewed-evidence-'))
  try {
    const child = Bun.spawn(
      [
        process.execPath,
        join(import.meta.dir, '../../src/cli.ts'),
        'run',
        'flow:flows/hello',
        '--input',
        '{}',
      ],
      { cwd: root, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' },
    )
    const result = await settleTestCommand(child, { evidence: join(evidence, 'run') })
    expect(result.code, result.stderr + result.stdout).toBe(2)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('Diagnostic code: ADMISSION_MISSING')
    expect(result.stderr).toContain('No Flow was started')
    expect(result.stderr).not.toContain('APPROVAL_CHANGED')
    expect(await readdir(root)).toEqual([])
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(evidence, { recursive: true, force: true })
  }
})

test('attempt grammar classifies execution requirements without acquiring authority', () => {
  for (const operation of [
    'inspect',
    'prepare',
    'submit',
    'lookup',
    'cancel',
    'result',
    'export',
  ] as const) {
    const args = ['attempt', operation, '--json']
    expect(privateCliAttemptOperation(args)).toBe(operation)
    expect(privateCliRequiresHost(args)).toBe(operation === 'submit')
    for (const invalid of [
      ['attempt', operation],
      ['attempt', operation, '--json', 'ticket-must-not-be-an-argument'],
      ['attempt', operation, '--json', '--json'],
      ['attempt', operation, '--input', '{}'],
      ['attempt', '--json', operation],
    ]) {
      expect(privateCliAttemptOperation(invalid)).toBeUndefined()
      expect(privateCliRequiresHost(invalid)).toBe(false)
    }
  }
  expect(privateCliRequiresHost(['attempt', 'retry', '--json'])).toBe(false)
  expect(privateCliCommandLifetimeMs(['attempt', 'submit', '--json'])).toBe(
    privateCliCommandLifetimeMs(['run', 'flow:flows/example', '--timeout', '24h']),
  )
  expect(privateCliCommandLifetimeMs(['attempt', 'lookup', '--json'])).toBe(300_000)
})
