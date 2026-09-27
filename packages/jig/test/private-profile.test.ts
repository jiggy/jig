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

test('private profile preserves partial phases after forced process termination', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jig-profile-interrupted-'))
  try {
    const destination = join(directory, 'trace.jsonl')
    const module = join(import.meta.dir, '../src/internal/private-profile.ts')
    const child = Bun.spawn(
      [
        process.execPath,
        '-e',
        `import { PrivateProfileCapture } from ${JSON.stringify(module)};
        const capture = new PrivateProfileCapture(${JSON.stringify(destination)});
        const span = capture.start('root-fence');
        capture.end(span, 'returned');
        capture.start('root-package-release');
        process.kill(process.pid, 'SIGKILL');`,
      ],
      { stdout: 'ignore', stderr: 'pipe' },
    )
    const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()])
    expect(code, stderr).not.toBe(0)
    const records = (await readFile(destination, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    expect(records.slice(1)).toEqual([
      expect.objectContaining({ kind: 'start', phase: 'root-fence' }),
      expect.objectContaining({ kind: 'end', phase: 'root-fence', outcome: 'returned' }),
      expect.objectContaining({ kind: 'start', phase: 'root-package-release' }),
    ])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('private profile bounds total records, including mixed instants and spans', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jig-profile-bounded-'))
  try {
    const destination = join(directory, 'trace.jsonl')
    const capture = new PrivateProfileCapture(destination)
    for (let i = 0; i < 1024; i++) capture.instant('dependency-reuse')
    for (let i = 0; i < 600; i++) {
      const span = capture.start('root-owner-release')
      if (span) capture.end(span, 'returned')
    }
    capture.finish()
    const text = await readFile(destination, 'utf8')
    const records = text
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    expect(records).toHaveLength(1026)
    expect(records.at(-1)).toEqual({ kind: 'truncated', phaseLimit: 512 })
    expect(Buffer.byteLength(text)).toBeLessThan(1026 * 193)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('planning and native subphases remain bounded names understood by the installed profiler', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jig-profile-planning-'))
  try {
    const destination = join(directory, 'trace.jsonl')
    const profile = new PrivateProfileCapture(destination)
    const consumer = await readFile(
      join(import.meta.dir, '../../../scripts/profile-installed-startup.ts'),
      'utf8',
    )
    const phases = [
      'author-support-verification',
      'author-envelope-startup',
      'author-execution-settlement',
      'dependency-workspace-capture',
      'finite-acp-revalidation',
      'finite-acp-containment',
      'finite-acp-launch',
      'finite-acp-exchange',
      'finite-acp-release',
      'finite-acp-recovery',
      'root-package-release',
      'root-owner-release',
    ] as const
    for (const phase of phases) {
      const span = profile.start(phase)
      if (!span) throw new Error('Missing planning span')
      profile.end(span, 'returned')
      expect(consumer).toContain(`'${phase}'`)
    }
    profile.finish()
    const records = (await readFile(destination, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    expect(records.filter((record) => record.kind === 'end').map((record) => record.phase)).toEqual(
      phases,
    )
    expect(records.some((record) => record.kind === 'truncated')).toBe(false)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('active native profiling preserves returned values and the exact thrown failure', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jig-profile-native-'))
  try {
    const destination = join(directory, 'trace.jsonl')
    const module = join(import.meta.dir, '../src/internal/private-profile.ts')
    const child = Bun.spawn(
      [
        process.execPath,
        '-e',
        `import { privateProfileActivate, privateProfileFinish, privateProfileSpan } from ${JSON.stringify(module)};
        privateProfileActivate();
        const value = await privateProfileSpan('finite-acp-revalidation', async () => 17);
        if (value !== 17) throw new Error('Result changed');
        const failure = new Error('private content must never enter the trace');
        try {
          await privateProfileSpan('finite-acp-containment', async () => { throw failure });
          throw new Error('Failure disappeared');
        } catch (error) { if (error !== failure) throw error }
        privateProfileFinish();`,
      ],
      {
        env: { ...process.env, JIG_PRIVATE_PROFILE_FILE: destination },
        stdout: 'pipe',
        stderr: 'pipe',
      },
    )
    const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()])
    expect(code, stderr).toBe(0)
    const text = await readFile(destination, 'utf8')
    expect(text).not.toContain('private content')
    const records = text
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    expect(records.filter((record) => record.kind === 'end')).toEqual([
      expect.objectContaining({ phase: 'finite-acp-revalidation', outcome: 'returned' }),
      expect.objectContaining({ phase: 'finite-acp-containment', outcome: 'failed' }),
    ])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
