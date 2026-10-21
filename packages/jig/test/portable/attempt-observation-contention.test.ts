import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { chmod, mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AttemptClientError, createAttemptClient } from '@jigging/jig/client'
import { initializePrivateActivationState } from '../../src/internal/activation-admission-store.js'
import { installedBunLocation } from '../fixtures/installed-bun-location.js'

const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

async function events(path: string): Promise<Record<string, unknown>[]> {
  const text = await readFile(path, 'utf8').catch((error) => {
    if (error.code === 'ENOENT') return ''
    throw error
  })
  // A live producer may be in the middle of its last write.
  return text
    .slice(0, text.lastIndexOf('\n') + 1)
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

async function waitForBlockedRead(path: string): Promise<void> {
  const deadline = performance.now() + 2_500
  for (;;) {
    if (
      (await events(path)).some(
        (event) =>
          event.phase === 'result-open' && event.kind === 'end' && event.outcome === 'failed',
      )
    )
      return
    if (performance.now() >= deadline) throw Error('The real SQLite writer did not block the read')
    await Bun.sleep(10)
  }
}

async function holdWriter(database: string) {
  const child = Bun.spawn(
    [
      process.execPath,
      '--no-env-file',
      '--no-install',
      '--config=/dev/null',
      '-e',
      `import {constants,Database} from 'bun:sqlite';
const db=Database.open(${JSON.stringify(database)},
  constants.SQLITE_OPEN_READWRITE|constants.SQLITE_OPEN_NOFOLLOW);
try {
  db.exec('BEGIN EXCLUSIVE');
  console.log('locked');
  await new Response(Bun.stdin.stream()).text();
} finally {
  if(db.inTransaction) db.exec('ROLLBACK');
  db.close(true);
}`,
    ],
    { env: {}, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe', timeout: 5_000 },
  )
  const stderr = new Response(child.stderr).text()
  void stderr.catch(() => undefined)
  try {
    const reader = child.stdout.getReader()
    let line = ''
    try {
      while (!line.includes('\n')) {
        const next = await reader.read()
        if (next.done) throw Error('SQLite writer ended before acquiring its lock')
        line += new TextDecoder().decode(next.value)
        if (line.length > 32) throw Error('Unexpected writer readiness')
      }
    } finally {
      reader.releaseLock()
    }
    expect(line).toBe('locked\n')
    return {
      async release() {
        child.stdin.end()
        expect(await child.exited).toBe(0)
        expect(await stderr).toBe('')
      },
      async close() {
        child.kill('SIGKILL')
        await child.exited
        await stderr
      },
    }
  } catch (error) {
    child.kill('SIGKILL')
    await child.exited
    await stderr
    throw error
  }
}

test('installed result waits for real SQLite contention without dispatch or state repair', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'jig-observation-busy-')))
  const cancellation = new AbortController()
  let writer: Awaited<ReturnType<typeof holdWriter>> | undefined
  let pending: Promise<{ error?: unknown; value?: unknown }> | undefined
  try {
    await initializePrivateActivationState({ projectRoot: root })
    const database = join(root, '.jig/jig.sqlite3')
    const before = digest(await readFile(database))
    writer = await holdWriter(database)
    const trace = join(root, 'result.jsonl')
    const client = createAttemptClient({
      executable: join(installedBunLocation.releaseRoot, 'bin/jig'),
      cwd: root,
      env: { ...process.env, JIG_PRIVATE_PROFILE_FILE: trace },
      timeoutMs: 4_000,
    })
    let settled = false
    // Unissued request data: no prepared ticket, approval or native owner is fabricated.
    pending = client.result({ ticket: 'not-issued' }, { signal: cancellation.signal }).then(
      (value) => {
        settled = true
        return { value }
      },
      (error) => {
        settled = true
        return { error }
      },
    )
    await waitForBlockedRead(trace)
    expect(settled).toBeFalse()
    await writer.release()
    const outcome = await pending
    expect(outcome.error).toBeInstanceOf(AttemptClientError)
    expect(outcome.error).toMatchObject({ code: 'IDENTITY_UNAVAILABLE', uncertain: false })
    expect(
      (await events(trace)).some(
        (event) =>
          event.phase === 'result-open' && event.kind === 'end' && event.outcome === 'returned',
      ),
    ).toBeTrue()
    expect(digest(await readFile(database))).toBe(before)
  } finally {
    cancellation.abort()
    await pending
    await writer?.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('installed result does not retry or repair unsafe admission permissions', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'jig-observation-unsafe-')))
  try {
    await initializePrivateActivationState({ projectRoot: root })
    const state = join(root, '.jig')
    const database = join(state, 'jig.sqlite3')
    const before = digest(await readFile(database))
    const trace = join(root, 'result.jsonl')
    await chmod(state, 0o750)
    const client = createAttemptClient({
      executable: join(installedBunLocation.releaseRoot, 'bin/jig'),
      cwd: root,
      env: { ...process.env, JIG_PRIVATE_PROFILE_FILE: trace },
      timeoutMs: 4_000,
    })
    await expect(client.result({ ticket: 'not-issued' })).rejects.toMatchObject({
      code: 'INTERNAL',
      uncertain: false,
    })
    expect(
      (await events(trace)).filter(
        (event) => event.phase === 'result-open' && event.kind === 'start',
      ),
    ).toHaveLength(1)
    expect(digest(await readFile(database))).toBe(before)
  } finally {
    await chmod(join(root, '.jig'), 0o700)
    await rm(root, { recursive: true, force: true })
  }
})

test('caller cancellation stops an installed result waiting on a real SQLite writer', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'jig-observation-abort-')))
  const cancellation = new AbortController()
  let writer: Awaited<ReturnType<typeof holdWriter>> | undefined
  let pending: Promise<unknown> | undefined
  try {
    await initializePrivateActivationState({ projectRoot: root })
    const database = join(root, '.jig/jig.sqlite3')
    const before = digest(await readFile(database))
    writer = await holdWriter(database)
    const trace = join(root, 'result.jsonl')
    const client = createAttemptClient({
      executable: join(installedBunLocation.releaseRoot, 'bin/jig'),
      cwd: root,
      env: { ...process.env, JIG_PRIVATE_PROFILE_FILE: trace },
      timeoutMs: 4_000,
    })
    pending = client.result({ ticket: 'not-issued' }, { signal: cancellation.signal }).then(
      () => undefined,
      (error) => error,
    )
    await waitForBlockedRead(trace)
    cancellation.abort('private cancellation reason')
    const failure = await pending
    expect(failure).toBeInstanceOf(AttemptClientError)
    expect(failure).toMatchObject({ code: 'ABORTED' })
    expect(String(failure)).not.toContain('private cancellation reason')
    await writer.release()
    expect(digest(await readFile(database))).toBe(before)
  } finally {
    cancellation.abort()
    await pending
    await writer?.close()
    await rm(root, { recursive: true, force: true })
  }
})
