import { dirname as suiteDirname } from 'node:path'

const suiteTestRoot = suiteDirname(import.meta.dir)

import { expect, test } from 'bun:test'
import { mkdtemp, readdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AttemptClientError, createAttemptClient } from '@jigging/jig/client'
import {
  PrivateProfileCapture,
  privateProfileInstant,
  privateProfileOperatorEnvironment,
  privateProfileSpan,
  privateProfileSyncSpan,
} from '../../src/internal/private-profile.js'
import { foundationCommands } from '../fixtures/host-foundation/materialize.js'
import { installedBunLocation } from '../fixtures/installed-bun-location.js'

test('installed public result records an observational refusal without creating project state', async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'jig-result-profile-control-')))
  try {
    const destination = join(directory, 'trace.jsonl')
    const client = createAttemptClient({
      executable: join(installedBunLocation.releaseRoot, 'bin/jig'),
      cwd: directory,
      env: { ...process.env, JIG_PRIVATE_PROFILE_FILE: destination },
    })
    let failure: unknown
    try {
      // Unissued ordinary request data, not a fabricated prepared capability.
      await client.result({ ticket: 'not-issued' })
    } catch (error) {
      failure = error
    }
    expect(failure).toBeInstanceOf(AttemptClientError)
    expect(failure).toMatchObject({ code: 'INTERNAL', operation: 'result', uncertain: false })
    const events = (await readFile(destination, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    expect(events.filter((event) => event.phase)).toEqual([
      expect.objectContaining({ kind: 'start', phase: 'result-open' }),
      expect.objectContaining({ kind: 'end', phase: 'result-open', outcome: 'failed' }),
    ])
    expect(await readdir(directory)).toEqual(['trace.jsonl'])
    expect((await stat(destination)).mode & 0o777).toBe(0o600)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

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
  const synchronous = Object.freeze({ value: 17 })
  expect(privateProfileSyncSpan('result-authenticate', () => synchronous)).toBe(synchronous)
  try {
    privateProfileSyncSpan('result-observe', () => {
      throw failure
    })
    throw new Error('Synchronous failure disappeared')
  } catch (error) {
    expect(error).toBe(failure)
  }
})
test('private profile preserves partial phases after forced process termination', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jig-profile-interrupted-'))
  try {
    const destination = join(directory, 'trace.jsonl')
    const module = join(suiteTestRoot, '../src/internal/private-profile.ts')
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
      join(suiteTestRoot, '../../../scripts/profile-installed-startup.ts'),
      'utf8',
    )
    const phases = [
      'author-support-verification',
      'author-envelope-startup',
      'author-execution-settlement',
      'dependency-workspace-capture',
      'project-evaluation-review',
      'finite-acp-revalidation',
      'finite-acp-containment',
      'finite-acp-launch',
      'finite-acp-exchange',
      'finite-acp-release',
      'finite-acp-recovery',
      'contained-effect-planning',
      'contained-effect-allocation',
      'contained-effect-sealing',
      'contained-effect-launch',
      'contained-effect-collection',
      'contained-effect-settlement',
      'macos-guardian-preparation',
      'macos-guardian-admission',
      'root-package-release',
      'root-owner-release',
      'result-open',
      'result-authenticate',
      'result-retention',
      'result-observe',
      'result-checkpoint',
      'result-finish',
      'result-dispose',
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
    const module = join(suiteTestRoot, '../src/internal/private-profile.ts')
    const child = Bun.spawn(
      [
        process.execPath,
        '-e',
        `import { privateProfileActivate, privateProfileFinish, privateProfileSpan, privateProfileSyncSpan } from ${JSON.stringify(module)};
        privateProfileActivate();
        const value = await privateProfileSpan('finite-acp-revalidation', async () => 17);
        if (value !== 17) throw new Error('Result changed');
        const failure = new Error('private content must never enter the trace');
        try {
          await privateProfileSpan('finite-acp-containment', async () => { throw failure });
          throw new Error('Failure disappeared');
        } catch (error) { if (error !== failure) throw error }
        const guardian = Object.freeze({ prepared: true });
        const prepared = await privateProfileSpan('macos-guardian-preparation', async () => guardian);
        if (prepared !== guardian) throw new Error('Prepared value changed');
        try {
          await privateProfileSpan('macos-guardian-admission', async () => { throw failure });
          throw new Error('Admission failure disappeared');
        } catch (error) { if (error !== failure) throw error }
        const observed = privateProfileSyncSpan('result-authenticate', () => guardian);
        if (observed !== guardian) throw new Error('Synchronous value changed');
        try {
          privateProfileSyncSpan('result-observe', () => { throw failure });
          throw new Error('Synchronous failure disappeared');
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
      expect.objectContaining({ phase: 'macos-guardian-preparation', outcome: 'returned' }),
      expect.objectContaining({ phase: 'macos-guardian-admission', outcome: 'failed' }),
      expect.objectContaining({ phase: 'result-authenticate', outcome: 'returned' }),
      expect.objectContaining({ phase: 'result-observe', outcome: 'failed' }),
    ])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('foundation command failures project only bounded fixed result phase facts', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jig-profile-summary-'))
  try {
    const command = foundationCommands(join(directory, 'commands'))
    async function failureMessage(line: string): Promise<string> {
      try {
        await command(
          [process.execPath, '-e', `console.error(${JSON.stringify(line)}); process.exit(7)`],
          directory,
        )
      } catch (error) {
        expect(error).toBeInstanceOf(Error)
        return (error as Error).message
      }
      throw new Error('Nonzero child exit was not rejected')
    }
    const phases = [
      'result-open',
      'result-authenticate',
      'result-retention',
      'result-observe',
      'result-checkpoint',
      'result-finish',
      'result-dispose',
    ]
    const records = phases.flatMap((phase) => [
      { phase, kind: 'start', timeMs: 0, pid: 1234, path: '/private/trace' },
      { phase, kind: 'end', timeMs: 1, outcome: 'failed', error: 'private exception payload' },
    ])
    const message = await failureMessage(`Foundation result phases: ${JSON.stringify(records)}`)
    expect(message).toContain('Installed foundation command 1 failed')
    expect(message).toContain('result phases: [{"phase":"result-open","kind":"start","timeMs":0}')
    expect(message).toContain('"phase":"result-dispose","kind":"end","timeMs":1,"outcome":"failed"')
    for (const privateValue of ['pid', '/private/trace', 'private exception payload', '"error"'])
      expect(message).not.toContain(privateValue)

    for (const invalid of [
      [...records, records[0]],
      [{ phase: 'private-phase', kind: 'start', timeMs: 0 }],
      [{ phase: 'result-open', kind: 'header', timeMs: 0 }],
      [{ phase: 'result-open', kind: 'start', timeMs: 86_400_001 }],
      [{ phase: 'result-open', kind: 'end', timeMs: 0, outcome: 'private-outcome' }],
      [null],
    ]) {
      const rejected = await failureMessage(`Foundation result phases: ${JSON.stringify(invalid)}`)
      expect(rejected).toContain('failed')
      expect(rejected).not.toContain('result phases:')
    }
    for (const invalidLine of [
      'Foundation result phases: [not JSON]',
      'prefix Foundation result phases: []',
      `Foundation result phases: [${' '.repeat(4097)}]`,
    ]) {
      const rejected = await failureMessage(invalidLine)
      expect(rejected).not.toContain('result phases:')
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('foundation run opt-in bridges real child profile phases without private fields', async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'jig-run-profile-summary-')))
  try {
    const module = join(suiteTestRoot, '../src/internal/private-profile.ts')
    const evidence = join(directory, 'commands')
    const destination = join(evidence, '001.run.jsonl')
    await writeFile(
      join(directory, 'run-profile.ts'),
      `import assert from 'node:assert/strict';
      import { appendFileSync } from 'node:fs';
      assert.equal(process.env.JIG_PRIVATE_PROFILE_FILE, undefined);
      assert.equal(process.env.JIG_FOUNDATION_RUN_PROFILE_FILE, ${JSON.stringify(destination)});
      const destination = process.env.JIG_FOUNDATION_RUN_PROFILE_FILE;
      process.env.JIG_PRIVATE_PROFILE_FILE = destination;
      const { privateProfileActivate, privateProfileFinish, privateProfileSpan } =
        await import(${JSON.stringify(module)});
      privateProfileActivate();
      await privateProfileSpan('root-submission-persistence', async () => 17);
      await privateProfileSpan('macos-guardian-preparation', async () => 17);
      try {
        await privateProfileSpan('flow-execution', async () => {
          throw new Error('private run exception payload');
        });
      } catch {}
      privateProfileFinish();
      appendFileSync(destination, JSON.stringify({
        kind: 'instant', phase: 'flow-execution', timeMs: 1,
        pid: 12345, path: '/private/run-profile-path', error: 'private run exception payload'
      }) + '\\n');
      console.log('private run stdout preserved');
      console.error('Diagnostic code: INTERNAL');
      console.error('private run stderr preserved');
      process.exit(7);`,
    )
    const command = foundationCommands(evidence)
    let failure: unknown
    try {
      // Exercise the fixture bridge and genuine profiler, not native execution.
      await command([process.execPath, 'run-profile.ts'], directory, undefined, 'run')
    } catch (error) {
      failure = error
    }
    expect(failure).toBeInstanceOf(Error)
    expect(failure).toMatchObject({ actual: 7, expected: 0 })
    const message = (failure as Error).message
    expect(message).toContain('Installed foundation command 1 failed (INTERNAL)')
    const projection = JSON.parse(/run phases: (\{.*\}); see /.exec(message)![1]!)
    expect(projection).toEqual({
      status: 'captured',
      events: [
        { phase: 'root-submission-persistence', kind: 'start', timeMs: expect.any(Number) },
        {
          phase: 'root-submission-persistence',
          kind: 'end',
          timeMs: expect.any(Number),
          outcome: 'returned',
        },
        { phase: 'macos-guardian-preparation', kind: 'start', timeMs: expect.any(Number) },
        {
          phase: 'macos-guardian-preparation',
          kind: 'end',
          timeMs: expect.any(Number),
          outcome: 'returned',
        },
        { phase: 'flow-execution', kind: 'start', timeMs: expect.any(Number) },
        { phase: 'flow-execution', kind: 'end', timeMs: expect.any(Number), outcome: 'failed' },
        { phase: 'flow-execution', kind: 'instant', timeMs: 1 },
      ],
    })
    for (const value of [
      '"header"',
      'jig-startup-profile/1',
      '"pid"',
      '"path"',
      '/private/run-profile-path',
      destination,
      'private run exception payload',
      '"error"',
      'private run stdout preserved',
      'private run stderr preserved',
    ])
      expect(message).not.toContain(value)
    expect((await stat(destination)).mode & 0o777).toBe(0o600)
    const files = await readdir(evidence)
    const transcripts = await Promise.all(
      files
        .filter((name) => name !== '001.run.jsonl')
        .map((name) => readFile(join(evidence, name), 'utf8')),
    )
    expect(transcripts.join('\n')).toContain('private run stdout preserved')
    expect(transcripts.join('\n')).toContain('private run stderr preserved')

    const control = await command(
      [
        process.execPath,
        '-e',
        `import assert from 'node:assert/strict';
        assert.equal(process.env.JIG_PRIVATE_PROFILE_FILE, undefined);
        assert.equal(process.env.JIG_FOUNDATION_RUN_PROFILE_FILE, undefined);`,
      ],
      directory,
    )
    expect(control.code).toBe(0)
    expect(await readdir(evidence)).not.toContain('002.run.jsonl')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('foundation review failures retain real child profile phases without private fields', async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'jig-review-profile-summary-')))
  try {
    const module = join(suiteTestRoot, '../src/internal/private-profile.ts')
    await writeFile(
      join(directory, 'review'),
      `import { appendFileSync } from 'node:fs';
      import { privateProfileActivate, privateProfileFinish, privateProfileSpan }
        from ${JSON.stringify(module)};
      const destination = process.env.JIG_PRIVATE_PROFILE_FILE;
      privateProfileActivate();
      await privateProfileSpan('project-evaluation-review', async () =>
        privateProfileSpan('dependency-preparation', async () => 17));
      try {
        await privateProfileSpan('project-planning', async () => {
          throw new Error('private exception payload');
        });
      } catch {}
      privateProfileFinish();
      appendFileSync(destination, JSON.stringify({
        kind: 'instant', phase: 'dependency-reuse', timeMs: 1,
        pid: 12345, path: '/private/profile-path', error: 'private exception payload'
      }) + '\\n');
      console.log('private stdout preserved');
      console.error('Diagnostic code: INTERNAL');
      console.error('private stderr preserved');
      process.exit(7);`,
    )
    const evidence = join(directory, 'commands')
    let failure: unknown
    try {
      await foundationCommands(evidence)([process.execPath, 'review'], directory)
    } catch (error) {
      failure = error
    }
    expect(failure).toBeInstanceOf(Error)
    expect(failure).toMatchObject({ actual: 7, expected: 0 })
    const message = (failure as Error).message
    expect(message).toContain('Installed foundation command 1 failed (INTERNAL)')
    expect(message).toContain('review phases: {"status":"captured"')
    const projection = JSON.parse(/review phases: (\{.*\}); see /.exec(message)![1]!)
    expect(projection.events).toEqual([
      { phase: 'project-evaluation-review', kind: 'start', timeMs: expect.any(Number) },
      {
        phase: 'dependency-preparation',
        kind: 'start',
        timeMs: expect.any(Number),
      },
      {
        phase: 'dependency-preparation',
        kind: 'end',
        timeMs: expect.any(Number),
        outcome: 'returned',
      },
      {
        phase: 'project-evaluation-review',
        kind: 'end',
        timeMs: expect.any(Number),
        outcome: 'returned',
      },
      { phase: 'project-planning', kind: 'start', timeMs: expect.any(Number) },
      { phase: 'project-planning', kind: 'end', timeMs: expect.any(Number), outcome: 'failed' },
      { phase: 'dependency-reuse', kind: 'instant', timeMs: 1 },
    ])
    for (const value of [
      '"pid"',
      '/private/profile-path',
      'private exception payload',
      '"error"',
      'private stdout preserved',
      'private stderr preserved',
    ])
      expect(message).not.toContain(value)
    const files = await readdir(evidence)
    expect(files).toContain('001.review.jsonl')
    expect((await stat(join(evidence, '001.review.jsonl'))).mode & 0o777).toBe(0o600)
    const transcripts = await Promise.all(
      files
        .filter((name) => name !== '001.review.jsonl')
        .map((name) => readFile(join(evidence, name), 'utf8')),
    )
    expect(transcripts.join('\n')).toContain('private stdout preserved')
    expect(transcripts.join('\n')).toContain('private stderr preserved')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
