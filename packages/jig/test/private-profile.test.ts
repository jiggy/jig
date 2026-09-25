import { expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  PrivateProfileCapture,
  privateProfileInstant,
  privateProfileOperatorEnvironment,
  privateProfileSpan,
} from '../src/internal/private-profile.js'

test('private profile records bounded fixed-name spans without replacing its destination', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jig-profile-test-'))
  const destination = join(directory, 'trace.jsonl')
  try {
    const profile = new PrivateProfileCapture(destination)
    const completed = profile.start('author-configuration-evaluation')
    if (completed === undefined) throw new Error('profile span was unexpectedly unavailable')
    profile.end(completed, 'returned')
    const failed = profile.start('dependency-preparation')
    if (failed === undefined) throw new Error('profile span was unexpectedly unavailable')
    profile.end(failed, 'failed')
    profile.instant('dependency-reuse')
    profile.finish()

    const lines = (await readFile(destination, 'utf8')).trimEnd().split('\n')
    const records = lines.map((line) => JSON.parse(line))
    expect(records[0]).toMatchObject({
      kind: 'header',
      protocol: 'jig-startup-profile/1',
    })
    expect(records.slice(1)).toEqual([
      {
        kind: 'start',
        spanId: 1,
        phase: 'author-configuration-evaluation',
        timeMs: expect.any(Number),
      },
      {
        kind: 'end',
        spanId: 1,
        phase: 'author-configuration-evaluation',
        timeMs: expect.any(Number),
        outcome: 'returned',
      },
      { kind: 'start', spanId: 2, phase: 'dependency-preparation', timeMs: expect.any(Number) },
      {
        kind: 'end',
        spanId: 2,
        phase: 'dependency-preparation',
        timeMs: expect.any(Number),
        outcome: 'failed',
      },
      { kind: 'instant', phase: 'dependency-reuse', timeMs: expect.any(Number) },
    ])
    expect((await stat(destination)).mode & 0o777).toBe(0o600)
    const operatorEnvironment = privateProfileOperatorEnvironment({
      JIG_PRIVATE_PROFILE_FILE: destination,
      OPENROUTER_API_KEY: 'do-not-copy',
    })
    expect(operatorEnvironment).toEqual({ OPENROUTER_API_KEY: 'do-not-copy' })
    expect(() => new PrivateProfileCapture(destination)).toThrow()
    expect(await readFile(destination, 'utf8')).toBe(`${lines.join('\n')}\n`)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('inactive profiling preserves the operation result and failure behavior', async () => {
  let calls = 0
  const value = await privateProfileSpan('flow-execution', async () => {
    calls++
    return 'ordinary result'
  })
  expect(value).toBe('ordinary result')
  expect(calls).toBe(1)
  privateProfileInstant('dependency-reuse')

  const failure = new Error('ordinary failure')
  await expect(
    privateProfileSpan('flow-execution', async () => {
      throw failure
    }),
  ).rejects.toBe(failure)
})
