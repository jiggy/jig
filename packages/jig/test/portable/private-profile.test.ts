import { dirname as suiteDirname } from 'node:path'

const suiteTestRoot = suiteDirname(import.meta.dir)

import { expect, test } from 'bun:test'
import {
  mkdir,
  mkdtemp,
  open,
  readdir,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AttemptClientError, createAttemptClient } from '@jigging/jig/client'
import {
  normalizePrivateProfileFailure,
  PrivateProfileCapture,
  privateProfileFailure,
  privateProfileFailureSink,
  privateProfileInstant,
  privateProfileOperatorEnvironment,
  privateProfileSpan,
  privateProfileSyncSpan,
} from '../../src/internal/private-profile.js'
import { foundationCommands } from '../fixtures/host-foundation/materialize.js'
import { installedBunLocation } from '../fixtures/installed-bun-location.js'
import { mappedFilesCommandEnvironment } from '../installed-mapped-files.js'

test('private failure records accept only fixed own data and return fresh bounded records', () => {
  const record = { kind: 'failure', phase: 'child-flow-admission', cause: 'EAGAIN', timeMs: 1.25 }
  const normalized = normalizePrivateProfileFailure(record)
  expect(normalized).toEqual(record)
  expect(normalized).not.toBe(record)
  expect(Object.isFrozen(normalized)).toBe(true)
  expect(normalizePrivateProfileFailure(Object.assign(Object.create(null), record))).toEqual(record)
  for (const cause of [
    'ENOENT',
    'EAGAIN',
    'EMFILE',
    'ENFILE',
    'ENOMEM',
    'EXECUTION_PREPARATION_DEADLINE',
    'PROJECT_EVALUATOR_LAUNCH',
    'MACOS_GUARDIAN_STORAGE_VOLUME_ATTACH',
    'MACOS_GUARDIAN_STORAGE_RECOVERY_FILESYSTEM_BUSY',
    'OTHER',
  ]) {
    const value = normalizePrivateProfileFailure({ ...record, cause })
    expect(value?.cause).toBe(cause)
    expect(Buffer.byteLength(JSON.stringify(value))).toBeLessThanOrEqual(192)
  }
  for (const invalid of [
    null,
    [],
    'private token',
    { ...record, kind: 'start' },
    { ...record, phase: 'private-phase' },
    { ...record, phase: 'child-flow-admission/private' },
    { ...record, cause: 'SECRET_CANARY' },
    { ...record, cause: 'Error:EAGAIN' },
    { ...record, cause: 'MACOS_GUARDIAN_STORAGE_PRIVATE_TOKEN' },
    { ...record, cause: 'MACOS_GUARDIAN_STORAGE_VOLUME_ATTACH/private' },
    { ...record, cause: 'eagain' },
    { ...record, timeMs: -1 },
    { ...record, timeMs: Infinity },
    { ...record, timeMs: NaN },
    { ...record, timeMs: 86_400_001 },
    { ...record, timeMs: '1' },
    { ...record, message: 'private token' },
    { ...record, [Symbol('private')]: 'private token' },
    Object.assign(Object.create({ private: true }), record),
    Object.create(record),
    Object.defineProperty({ ...record }, 'cause', { value: 'EAGAIN', enumerable: false }),
  ])
    expect(normalizePrivateProfileFailure(invalid)).toBeUndefined()
  let reads = 0
  for (const key of Object.keys(record)) {
    const input = Object.defineProperty({ ...record }, key, {
      get() {
        reads++
        throw new Error('private getter')
      },
    })
    expect(normalizePrivateProfileFailure(input)).toBeUndefined()
  }
  const revoked = Proxy.revocable(record, {})
  revoked.revoke()
  expect(normalizePrivateProfileFailure(revoked.proxy)).toBeUndefined()
  expect(reads).toBe(0)
})

test('private failure observations drop names and unknown codes and share the original limits', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jig-profile-failure-'))
  try {
    const destination = join(directory, 'trace.jsonl')
    const capture = new PrivateProfileCapture(destination)
    const unreadable = Object.defineProperty([], '0', {
      get() {
        throw new Error('private getter')
      },
    })
    capture.failure('child-flow-admission', [
      'PrivateCanary:MACOS_GUARDIAN_STORAGE_VOLUME_ATTACH',
      'PrivateCanary:SECRET_CANARY',
      'PrivateCanary',
      'Error:EAGAIN',
    ])
    capture.failure('private-phase', ['Error:ENOENT'])
    capture.failure('project-plan', unreadable)
    capture.failure('project-apply', ['CheckError:PROJECT_EVALUATOR_LAUNCH'])
    capture.failure('child-flow-cleanup', ['Error:ENOMEM', 'Error:EMFILE', 'Error:ENFILE'])
    const span = capture.start('root-settlement')
    if (span === undefined) throw new Error('Failure observations exhausted span allocation')
    capture.end(span, 'returned')
    capture.finish()
    const text = await readFile(destination, 'utf8')
    const records = text
      .trimEnd()
      .split('\n')
      .map((line) => JSON.parse(line))
    const failures = records.filter((record) => record.kind === 'failure')
    expect(failures).toHaveLength(8)
    expect(failures.map((record) => record.cause)).toEqual([
      'MACOS_GUARDIAN_STORAGE_VOLUME_ATTACH',
      'OTHER',
      'OTHER',
      'EAGAIN',
      'OTHER',
      'PROJECT_EVALUATOR_LAUNCH',
      'ENOMEM',
      'EMFILE',
    ])
    expect(failures.every((record) => normalizePrivateProfileFailure(record) !== undefined)).toBe(
      true,
    )
    expect(records.some((record) => record.kind === 'end' && record.outcome === 'returned')).toBe(
      true,
    )
    expect(records.at(-1)).toEqual({ kind: 'truncated', phaseLimit: 512 })
    expect(text).not.toMatch(/PrivateCanary|SECRET_CANARY|private-phase|private getter/)
    expect((await stat(destination)).mode & 0o777).toBe(0o600)
    expect(
      text
        .trimEnd()
        .split('\n')
        .every((line) => Buffer.byteLength(line) <= 192),
    ).toBe(true)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('the active sink retains a real filesystem cause without replacing the original exception', async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'jig-profile-observed-failure-')))
  try {
    const destination = join(directory, 'trace.jsonl')
    const module = join(suiteTestRoot, '../src/internal/private-profile.ts')
    const observer = join(suiteTestRoot, '../src/internal/project-session-controller.ts')
    const absent = join(directory, 'private-missing-canary')
    const child = Bun.spawn(
      [
        process.execPath,
        '-e',
        `import assert from 'node:assert/strict';
      import {readFile} from 'node:fs/promises';
      import {privateProfileActivate,privateProfileFailureSink,privateProfileFinish} from ${JSON.stringify(module)};
      import {closedTestErrorCauses} from ${JSON.stringify(observer)};
      assert.equal(privateProfileFailureSink(),undefined);
      privateProfileActivate();
      const sink=privateProfileFailureSink();
      assert.equal(typeof sink,'function');
      assert.equal(process.env.JIG_PRIVATE_PROFILE_FILE,undefined);
      const original=await readFile(${JSON.stringify(absent)}).then(()=>undefined,error=>error);
      assert.equal(original.code,'ENOENT');
      try {throw original} catch(error) {
        sink('child-flow-admission',closedTestErrorCauses(error));
        assert.equal(error,original);
        assert.equal(error.code,'ENOENT');
      }
      privateProfileFinish();
      assert.equal(privateProfileFailureSink(),undefined);`,
      ],
      {
        env: { ...process.env, JIG_PRIVATE_PROFILE_FILE: destination },
        stdout: 'pipe',
        stderr: 'pipe',
      },
    )
    const [exit, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    expect(exit, `${stdout}\n${stderr}`).toBe(0)
    const text = await readFile(destination, 'utf8')
    const records = text
      .trimEnd()
      .split('\n')
      .map((line) => JSON.parse(line))
    expect(records.filter((record) => record.kind === 'failure')).toEqual([
      {
        kind: 'failure',
        phase: 'child-flow-admission',
        cause: 'ENOENT',
        timeMs: expect.any(Number),
      },
    ])
    expect(text).not.toContain(absent)
    expect(text).not.toMatch(/private-missing-canary|"name"|"message"|"path"/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('mapped Run profile selection uses real owned destinations and the existing exclusive writer', async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'jig-mapped-profile-')))
  try {
    const destination = join(directory, 'evidence')
    await mkdir(destination, { mode: 0o700 })
    const operator = {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      TMPDIR: tmpdir(),
      JIG_PACKAGE_SMOKE_DIAGNOSTIC_DIRECTORY: destination,
      JIG_PRIVATE_PROFILE_FILE: '/private/inherited-profile',
      OPENROUTER_API_KEY: 'secret-canary',
    }
    const ordinary = await mappedFilesCommandEnvironment(undefined, operator)
    expect(ordinary.JIG_PRIVATE_PROFILE_FILE).toBeUndefined()
    expect(ordinary.OPENROUTER_API_KEY).toBeUndefined()
    expect(ordinary.JIG_PACKAGE_SMOKE_DIAGNOSTIC_DIRECTORY).toBeUndefined()
    const leaf = await mappedFilesCommandEnvironment('leaf', operator)
    const composed = await mappedFilesCommandEnvironment('composed', operator)
    expect(leaf.JIG_PRIVATE_PROFILE_FILE).toBe(
      join(destination, 'installed-mapped-files-leaf-run-profile.txt'),
    )
    expect(composed.JIG_PRIVATE_PROFILE_FILE).toBe(
      join(destination, 'installed-mapped-files-composed-run-profile.txt'),
    )
    expect(leaf.OPENROUTER_API_KEY).toBeUndefined()
    expect(await readdir(destination)).toEqual([])
    const module = join(suiteTestRoot, '../src/internal/private-profile.ts')
    const code = `import { privateProfileActivate, privateProfileFailure, privateProfileFinish } from ${JSON.stringify(module)};
      privateProfileActivate();
      privateProfileFailure('child-flow-admission', ['PrivateCanary:EAGAIN']);
      privateProfileFinish();`
    const run = async (env: NodeJS.ProcessEnv) => {
      const child = Bun.spawn([process.execPath, '-e', code], {
        env,
        stdout: 'pipe',
        stderr: 'pipe',
      })
      const [exit, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ])
      expect(exit, `${stdout}\n${stderr}`).toBe(0)
      return stderr
    }
    for (const environment of [leaf, composed]) {
      await run(environment)
      const path = environment.JIG_PRIVATE_PROFILE_FILE
      if (path === undefined) throw new Error('Mapped Run profile destination was not selected')
      const text = await readFile(path, 'utf8')
      const records = text
        .trimEnd()
        .split('\n')
        .map((line) => JSON.parse(line))
      expect(records.filter((record) => record.kind === 'failure')).toEqual([
        {
          kind: 'failure',
          phase: 'child-flow-admission',
          cause: 'EAGAIN',
          timeMs: expect.any(Number),
        },
      ])
      expect((await stat(path)).mode & 0o777).toBe(0o600)
      expect(await run(environment)).toContain('profile capture could not be opened')
      expect(await readFile(path, 'utf8')).toBe(text)
    }
    const alias = join(directory, 'alias')
    await symlink(destination, alias)
    const unsafe = join(directory, 'unsafe')
    await mkdir(unsafe, { mode: 0o700 })
    const handle = await open(unsafe, 'r')
    try {
      await handle.chmod(0o777)
    } finally {
      await handle.close()
    }
    for (const selection of [
      undefined,
      'relative',
      join(directory, 'absent'),
      alias,
      unsafe,
      leaf.JIG_PRIVATE_PROFILE_FILE,
    ]) {
      const environment = await mappedFilesCommandEnvironment('leaf', {
        ...operator,
        JIG_PACKAGE_SMOKE_DIAGNOSTIC_DIRECTORY: selection,
      })
      expect(environment).toEqual(ordinary)
      expect(await run(environment)).toBe('')
    }
    expect((await readdir(destination)).sort()).toEqual([
      'installed-mapped-files-composed-run-profile.txt',
      'installed-mapped-files-leaf-run-profile.txt',
    ])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

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
  expect(privateProfileFailureSink()).toBeUndefined()
  const revoked = Proxy.revocable([], {})
  revoked.revoke()
  expect(() => privateProfileFailure('child-flow-admission', revoked.proxy)).not.toThrow()
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
    capture.failure('child-flow-admission', ['Error:EAGAIN'])
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
    expect(records.filter((record) => record.kind === 'failure')).toHaveLength(1)
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
