import { constants, Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CanonicalRequest } from '../../src/attempt-contract.js'
import {
  readPrivateAttemptCheckpoint,
  readPrivateAttemptCheckpointFiles,
  retainPrivateAttemptCheckpoint,
} from '../../src/internal/attempt-checkpoint-store.js'
import { capturePrivateRetainedOutput } from '../../src/internal/captured-output.js'
import { closePrivateExecutionOutput } from '../../src/internal/execution-output.js'
import { sha256 } from '../../src/internal/file-input.js'
import { capturePrivateInput } from '../../src/internal/input-capture.js'
import {
  acceptPrivatePreparedAttempt,
  attemptQuery,
  attemptWrite,
  authenticatePrivateAttempt,
  consumePrivateAttemptControlReservation,
  consumePrivateAttemptReservation,
  deletePrivateRetiredAttempts,
  PRIVATE_ATTEMPT_RETENTION_MS,
  PRIVATE_ATTEMPT_SCHEMA,
  persistPrivatePreparedAttempt,
  privateAttemptBaseObservation,
  privateAttemptManifestDigest,
  privateAttemptRetentionState,
  privateAttemptStorageBytes,
  readPrivateAttemptInputs,
  requirePrivateAttemptAcceptable,
  requirePrivateAttemptMeaning,
  retainPrivateAttemptArtifacts,
  retirePrivateAttempts,
} from '../../src/internal/prepared-attempt-store.js'

const project = `sha256:${'a'.repeat(64)}`
const clock = { bootId: 'boot-one', monotonicMs: 50_000, unixMs: 1_800_000_000_000 }
const request: CanonicalRequest = {
  expectedApproval: `sha256:${'b'.repeat(64)}`,
  target: 'flow:flows/run',
  input: { value: 1 },
  files: [],
  constraints: { durationMs: 30_000, resultBytes: 1024, artifactBytes: 0 },
  outputIntent: { packet: true, receive: [] },
}
function fixture(filename = ':memory:') {
  const db = Database.open(
    filename,
    constants.SQLITE_OPEN_READWRITE | constants.SQLITE_OPEN_CREATE | constants.SQLITE_OPEN_NOFOLLOW,
  )
  db.exec('PRAGMA foreign_keys = ON')
  db.exec('PRAGMA journal_mode = DELETE')
  db.exec('PRAGMA synchronous = EXTRA')
  // Avoid cache-spill fsync timing dominating this page-capacity proof. The
  // rollback journal, durable synchronization and fixed page ceiling are real.
  db.exec('PRAGMA cache_size = -65536')
  db.exec('CREATE TABLE root_runs (run_id TEXT PRIMARY KEY)')
  db.exec('CREATE TABLE root_terminals (run_id TEXT PRIMARY KEY, terminal_bytes BLOB)')
  db.exec('CREATE TABLE root_child_owners (parent_run_id TEXT)')
  for (const [, sql] of PRIVATE_ATTEMPT_SCHEMA) db.exec(sql)
  const prepare = () => persistPrivatePreparedAttempt(db, project, clock, request, [])
  return { db, prepare, close: () => db.close(true) }
}
function transaction(db: Database, operation: () => void): void {
  db.exec('BEGIN IMMEDIATE')
  try {
    operation()
    db.exec('COMMIT')
  } catch (error) {
    if (db.inTransaction) db.exec('ROLLBACK')
    throw error
  }
}
describe('protected prepared-attempt records', () => {
  test('accepted checkpoint survives closing and reopening the original EXTRA-synced SQLite owner', () => {
    const directory = realpathSync(mkdtempSync(join(tmpdir(), 'jig-checkpoint-reopen-')))
    const filename = join(directory, 'admission.sqlite')
    const { db, close } = fixture(filename)
    const runId = `sha256:${'e'.repeat(64)}`
    let expected = ''
    try {
      const prepared = persistPrivatePreparedAttempt(
        db,
        project,
        clock,
        { ...request, constraints: { ...request.constraints, artifactBytes: 8 } },
        [],
      )
      attemptWrite(db, 'INSERT INTO root_runs VALUES (?1)', [runId])
      const attempt = authenticatePrivateAttempt(db, project, prepared.ticket)
      transaction(db, () => acceptPrivatePreparedAttempt(db, attempt, runId, clock))
      transaction(db, () => {
        expected = retainPrivateAttemptCheckpoint(
          db,
          runId,
          { runId, method: null, input: null },
          { sequence: 1, evidence: { saved: true }, files: { 'saved.txt': 'accepted' } },
        ).digest
      })
    } finally {
      close()
    }
    const reopened = Database.open(
      filename,
      constants.SQLITE_OPEN_READONLY | constants.SQLITE_OPEN_NOFOLLOW,
    )
    try {
      expect(readPrivateAttemptCheckpoint(reopened, runId)?.digest).toBe(expected)
      expect(readPrivateAttemptCheckpointFiles(reopened, runId)?.files[0]?.bytes.toString()).toBe(
        'accepted',
      )
    } finally {
      reopened.close(true)
      rmSync(directory, { recursive: true, force: true })
    }
  })

  test('checkpoint copies authentic associated binary bytes before source retirement and rejects live loans', async () => {
    const { db, close } = fixture()
    const runId = `sha256:${'d'.repeat(64)}`
    const bytes = Buffer.from([0, 255, 128])
    const snapshot = capturePrivateRetainedOutput({
      files: [{ path: 'binary.bin', bytes, digest: sha256(bytes) }],
      directories: ['empty'],
    })
    try {
      const prepared = persistPrivatePreparedAttempt(
        db,
        project,
        clock,
        { ...request, constraints: { ...request.constraints, artifactBytes: 3 } },
        [],
      )
      attemptWrite(db, 'INSERT INTO root_runs VALUES (?1)', [runId])
      const attempt = authenticatePrivateAttempt(db, project, prepared.ticket)
      transaction(db, () => acceptPrivatePreparedAttempt(db, attempt, runId, clock))
      const identity = { runId, method: null, input: null }
      const value = {
        sequence: 1,
        evidence: null,
        files: {},
        artifacts: { candidate: 'held-reference' },
      }
      transaction(db, () =>
        retainPrivateAttemptCheckpoint(db, runId, identity, value, { candidate: snapshot }),
      )
      await closePrivateExecutionOutput({ kind: 'snapshot', ready: Promise.resolve(snapshot) })
      const retained = readPrivateAttemptCheckpointFiles(db, runId)!
      expect(retained.files).toEqual([
        { path: 'artifacts/candidate/binary.bin', bytes, digest: sha256(bytes) },
      ])
      expect(retained.directories).toEqual([
        'artifacts',
        'artifacts/candidate',
        'artifacts/candidate/empty',
      ])
      attemptWrite(db, 'INSERT INTO attempt_export_pins VALUES (?1, ?2, ?3, ?4, 0)', [
        'pin',
        attempt.row!.nonce,
        clock.bootId,
        clock.monotonicMs + 1000,
      ])
      expect(() =>
        transaction(db, () =>
          retainPrivateAttemptCheckpoint(db, runId, identity, {
            sequence: 2,
            evidence: null,
            files: {},
          }),
        ),
      ).toThrow('loan')
      attemptWrite(db, 'UPDATE attempt_export_pins SET released = 1')
      expect(() =>
        transaction(db, () =>
          retainPrivateAttemptCheckpoint(db, runId, identity, {
            sequence: 2,
            evidence: null,
            files: { text: 'four' },
          }),
        ),
      ).toThrow('capacity')
      expect(readPrivateAttemptCheckpoint(db, runId)?.sequence).toBe(1)
      attemptWrite(db, "UPDATE attempt_blobs SET content = ?1 WHERE purpose = 'checkpoint'", [
        Buffer.from('bad'),
      ])
      expect(() => readPrivateAttemptCheckpointFiles(db, runId)).toThrow('inconsistent')
      expect(readPrivateAttemptCheckpoint(db, runId)?.sequence).toBe(1)
    } finally {
      await closePrivateExecutionOutput({ kind: 'snapshot', ready: Promise.resolve(snapshot) })
      close()
    }
  })

  test('checkpoint replacement shares the original reservation and preserves committed bytes after rollback', () => {
    const { db, close } = fixture()
    const runId = `sha256:${'c'.repeat(64)}`
    try {
      const prepared = persistPrivatePreparedAttempt(
        db,
        project,
        clock,
        { ...request, constraints: { ...request.constraints, artifactBytes: 1024 } },
        [],
      )
      attemptWrite(db, 'INSERT INTO root_runs VALUES (?1)', [runId])
      const attempt = authenticatePrivateAttempt(db, project, prepared.ticket)
      transaction(db, () => acceptPrivatePreparedAttempt(db, attempt, runId, clock))
      const identity = { runId, method: null, input: null }
      const first = { sequence: 1, evidence: { complete: false }, files: { 'work/one.txt': 'one' } }
      let digest = ''
      const storage = privateAttemptStorageBytes(db)
      transaction(db, () => {
        digest = retainPrivateAttemptCheckpoint(db, runId, identity, first).digest
      })
      expect(privateAttemptStorageBytes(db)).toBeLessThanOrEqual(storage)
      const reserve = attemptQuery<{ result_reserve: bigint }>(
        db,
        'SELECT result_reserve FROM prepared_attempts',
      )[0]!.result_reserve
      expect(reserve).toBe(2045n)
      transaction(db, () => {
        expect(retainPrivateAttemptCheckpoint(db, runId, identity, first).digest).toBe(digest)
      })
      expect(() =>
        transaction(db, () => {
          retainPrivateAttemptCheckpoint(db, runId, identity, {
            ...first,
            sequence: 2,
            files: { 'work/two.txt': 'second' },
          })
          throw new Error('interrupted before commit')
        }),
      ).toThrow('interrupted')
      expect(readPrivateAttemptCheckpoint(db, runId)?.digest).toBe(digest)
      expect(readPrivateAttemptCheckpointFiles(db, runId)?.files[0]?.bytes.toString()).toBe('one')
      expect(() =>
        transaction(db, () =>
          retainPrivateAttemptCheckpoint(db, runId, identity, {
            ...first,
            evidence: { complete: true },
          }),
        ),
      ).toThrow('differs')
      transaction(db, () =>
        retainPrivateAttemptCheckpoint(db, runId, identity, {
          sequence: 2,
          evidence: null,
          files: {},
        }),
      )
      expect(readPrivateAttemptCheckpointFiles(db, runId)?.files).toEqual([])
      expect(
        attemptQuery<{ result_reserve: bigint }>(
          db,
          'SELECT result_reserve FROM prepared_attempts',
        )[0]!.result_reserve,
      ).toBe(2048n)
      expect(privateAttemptStorageBytes(db)).toBeLessThanOrEqual(storage)
      expect(
        attemptQuery<{ count: bigint }>(
          db,
          "SELECT count(*) AS count FROM attempt_reservations WHERE purpose = 'result'",
        )[0]!.count,
      ).toBe(1n)
      attemptWrite(
        db,
        "UPDATE attempt_blobs SET content = ?1 WHERE purpose = 'checkpoint-record'",
        [Buffer.from('{}')],
      )
      expect(() => readPrivateAttemptCheckpoint(db, runId)).toThrow('inconsistent')
    } finally {
      close()
    }
  })

  test('freezes complete canonical meaning and rejects each changed constraint', () => {
    const { db, prepare, close } = fixture()
    try {
      const prepared = prepare()
      const original = authenticatePrivateAttempt(db, project, prepared.ticket)
      expect(privateAttemptBaseObservation(original)).toEqual({
        identity: 'prepared',
        dispatch: 'not-dispatched',
      })
      requirePrivateAttemptMeaning(original, structuredClone(request))
      for (const changed of [
        { ...request, expectedApproval: `sha256:${'c'.repeat(64)}` },
        { ...request, target: 'flow:flows/other' },
        { ...request, input: { value: 2 } },
        {
          ...request,
          files: [{ port: 'source', bytes: 0, manifestDigest: privateAttemptManifestDigest([]) }],
        },
        { ...request, constraints: { ...request.constraints, durationMs: 40_000 } },
        { ...request, constraints: { ...request.constraints, resultBytes: 1000 } },
        { ...request, constraints: { ...request.constraints, artifactBytes: 1 } },
        { ...request, outputIntent: { packet: false, receive: [] } },
      ])
        expect(() => requirePrivateAttemptMeaning(original, changed)).toThrow('frozen request')
    } finally {
      close()
    }
  })
  test('observes retention expiry without collection and never derives it from wall time', () => {
    const { db, prepare, close } = fixture()
    try {
      const attempt = authenticatePrivateAttempt(db, project, prepare().ticket)
      expect(privateAttemptRetentionState(db, attempt, undefined)).toBe('unavailable')
      expect(
        privateAttemptRetentionState(db, attempt, { ...clock, monotonicMs: clock.monotonicMs - 1 }),
      ).toBe('unavailable')
      expect(
        privateAttemptRetentionState(db, attempt, { ...clock, unixMs: clock.unixMs + 10 ** 12 }),
      ).toBe('available')
      expect(
        privateAttemptRetentionState(db, attempt, {
          ...clock,
          unixMs: 0,
          monotonicMs: clock.monotonicMs + PRIVATE_ATTEMPT_RETENTION_MS,
        }),
      ).toBe('expired')
      expect(
        attemptQuery<{ retired: bigint }>(db, 'SELECT retired FROM prepared_attempts')[0]!.retired,
      ).toBe(0n)
      const nextBoot = { ...clock, bootId: 'boot-two', monotonicMs: 1000 }
      expect(privateAttemptRetentionState(db, attempt, nextBoot)).toBe('available')
      transaction(db, () => retirePrivateAttempts(db, nextBoot))
      expect(
        privateAttemptRetentionState(db, attempt, {
          ...nextBoot,
          monotonicMs: nextBoot.monotonicMs + PRIVATE_ATTEMPT_RETENTION_MS - 1,
        }),
      ).toBe('available')
      expect(
        privateAttemptRetentionState(db, attempt, {
          ...nextBoot,
          monotonicMs: nextBoot.monotonicMs + PRIVATE_ATTEMPT_RETENTION_MS,
        }),
      ).toBe('expired')
    } finally {
      close()
    }
  })

  test('checkpoint and final artifacts share the accepted aggregate allowance atomically', async () => {
    const { db, close } = fixture()
    const runId = `sha256:${'9'.repeat(64)}`
    const bytes = Buffer.from('four')
    const snapshot = capturePrivateRetainedOutput({
      files: [{ path: 'final.txt', bytes, digest: sha256(bytes) }],
      directories: [],
    })
    try {
      const prepared = persistPrivatePreparedAttempt(
        db,
        project,
        clock,
        {
          ...request,
          constraints: { ...request.constraints, artifactBytes: 6 },
          outputIntent: { packet: true, receive: ['final'] },
        },
        [],
      )
      attemptWrite(db, 'INSERT INTO root_runs VALUES (?1)', [runId])
      const attempt = authenticatePrivateAttempt(db, project, prepared.ticket)
      transaction(db, () => acceptPrivatePreparedAttempt(db, attempt, runId, clock))
      transaction(db, () =>
        retainPrivateAttemptCheckpoint(
          db,
          runId,
          { runId, method: null, input: null },
          { sequence: 1, evidence: null, files: { 'saved.txt': 'one' } },
        ),
      )
      expect(() =>
        transaction(db, () => retainPrivateAttemptArtifacts(db, runId, { final: snapshot })),
      ).toThrow('quota')
      expect(
        attemptQuery(
          db,
          "SELECT name FROM attempt_blobs WHERE purpose IN ('artifact', 'manifest')",
        ),
      ).toEqual([])
      expect(readPrivateAttemptCheckpointFiles(db, runId)?.files[0]?.bytes.toString()).toBe('one')
      transaction(db, () =>
        retainPrivateAttemptCheckpoint(
          db,
          runId,
          { runId, method: null, input: null },
          { sequence: 2, evidence: null, files: { 'saved.txt': 'ok' } },
        ),
      )
      transaction(db, () => retainPrivateAttemptArtifacts(db, runId, { final: snapshot }))
      expect(attemptQuery(db, "SELECT path FROM attempt_blobs WHERE purpose = 'artifact'")).toEqual(
        [{ path: 'final.txt' }],
      )
    } finally {
      await closePrivateExecutionOutput({ kind: 'snapshot', ready: Promise.resolve(snapshot) })
      close()
    }
  })

  test('authenticates project and existing record before permitting allocation', () => {
    const { db, prepare, close } = fixture()
    try {
      const prepared = prepare()
      expect(() =>
        authenticatePrivateAttempt(db, `sha256:${'f'.repeat(64)}`, prepared.ticket),
      ).toThrow()
      expect(() => authenticatePrivateAttempt(db, project, prepared.ticket + 'A')).toThrow()
      attemptWrite(db, 'DELETE FROM prepared_attempts')
      const missing = authenticatePrivateAttempt(db, project, prepared.ticket)
      expect(privateAttemptBaseObservation(missing).identity).toBe('unavailable')
      expect(() => requirePrivateAttemptAcceptable(missing, clock)).toThrow('unavailable')
      expect(attemptQuery(db, 'SELECT * FROM root_runs')).toHaveLength(0)
    } finally {
      close()
    }
  })
  test('acceptance uses boot elapsed time, not presentation time', () => {
    const { db, prepare, close } = fixture()
    try {
      const attempt = authenticatePrivateAttempt(db, project, prepare().ticket)
      requirePrivateAttemptAcceptable(attempt, { ...clock, unixMs: clock.unixMs + 10 ** 9 })
      requirePrivateAttemptAcceptable(attempt, {
        ...clock,
        unixMs: 0,
        monotonicMs: clock.monotonicMs + 599_999,
      })
      for (const changed of [
        { ...clock, monotonicMs: clock.monotonicMs + 600_000 },
        { ...clock, monotonicMs: clock.monotonicMs - 1 },
        { ...clock, bootId: 'boot-two' },
      ])
        expect(() => requirePrivateAttemptAcceptable(attempt, changed)).toThrow('no longer open')
    } finally {
      close()
    }
  })
  test('acceptance reserves actual control/result space and retained duplicate survives expiry', () => {
    const { db, prepare, close } = fixture()
    try {
      const prepared = prepare()
      attemptWrite(db, 'INSERT INTO root_runs VALUES (?1)', ['original-run'])
      acceptPrivatePreparedAttempt(
        db,
        authenticatePrivateAttempt(db, project, prepared.ticket),
        'original-run',
        clock,
      )
      const accepted = authenticatePrivateAttempt(db, project, prepared.ticket)
      expect(privateAttemptBaseObservation(accepted).receipt?.runId).toBe('original-run')
      requirePrivateAttemptAcceptable(accepted, {
        ...clock,
        bootId: 'another-boot',
        monotonicMs: 999_999_999,
      })
      const sizes = attemptQuery<{ control: bigint; result: bigint; deadline: bigint }>(
        db,
        'SELECT control_reserve AS control, result_reserve AS result, deadline_monotonic_ms AS deadline FROM prepared_attempts',
      )[0]!
      expect(sizes).toEqual({ control: 33_554_432n, result: 1024n, deadline: 80_000n })
    } finally {
      close()
    }
  })
  test('persists authentic captured bytes and detects changed stored input', () => {
    const { db, close } = fixture()
    const contents = Buffer.from('original bytes')
    const input = capturePrivateInput(contents)
    try {
      const frozen = {
        ...request,
        files: [
          {
            port: 'source',
            bytes: contents.length,
            manifestDigest: privateAttemptManifestDigest([
              { path: 'input.txt', bytes: contents.length, digest: sha256(contents) },
            ]),
          },
        ],
      }
      const prepared = persistPrivatePreparedAttempt(db, project, clock, frozen, [
        { name: 'source', rootFd: -1, files: [{ path: 'input.txt', input }] },
      ])
      contents.fill(0)
      const attempt = authenticatePrivateAttempt(db, project, prepared.ticket)
      expect(readPrivateAttemptInputs(db, attempt)[0]!.files[0]!.bytes.toString()).toBe(
        'original bytes',
      )
      attemptWrite(db, 'UPDATE attempt_blobs SET content = ?1', [Buffer.from('changed bytes!')])
      expect(() => readPrivateAttemptInputs(db, attempt)).toThrow('inconsistent')
    } finally {
      input.close()
      close()
    }
  })
  test('commits irreversible retirement before deletion and never recreates missing identity', () => {
    const { db, prepare, close } = fixture()
    try {
      const prepared = prepare()
      const expired = {
        ...clock,
        monotonicMs: clock.monotonicMs + PRIVATE_ATTEMPT_RETENTION_MS,
        unixMs: clock.unixMs + PRIVATE_ATTEMPT_RETENTION_MS,
      }
      retirePrivateAttempts(db, expired)
      expect(authenticatePrivateAttempt(db, project, prepared.ticket).row).not.toBeNull()
      expect(
        privateAttemptBaseObservation(authenticatePrivateAttempt(db, project, prepared.ticket))
          .identity,
      ).toBe('retired')
      deletePrivateRetiredAttempts(db)
      const retired = authenticatePrivateAttempt(db, project, prepared.ticket)
      expect(retired.row).toBeNull()
      expect(privateAttemptBaseObservation(retired).identity).toBe('retired')
      expect(() => requirePrivateAttemptAcceptable(retired, clock)).toThrow()
    } finally {
      close()
    }
  })
  test('reboot retention requires a full new monotonic window and active owners block GC', () => {
    const { db, prepare, close } = fixture()
    try {
      const prepared = prepare()
      const reboot = {
        ...clock,
        bootId: 'boot-two',
        monotonicMs: 1,
        unixMs: clock.unixMs + PRIVATE_ATTEMPT_RETENTION_MS * 3,
      }
      retirePrivateAttempts(db, reboot)
      retirePrivateAttempts(db, { ...reboot, monotonicMs: PRIVATE_ATTEMPT_RETENTION_MS })
      expect(authenticatePrivateAttempt(db, project, prepared.ticket).retired).toBeFalse()
      attemptWrite(db, 'INSERT INTO root_runs VALUES (?1)', ['active'])
      acceptPrivatePreparedAttempt(
        db,
        authenticatePrivateAttempt(db, project, prepared.ticket),
        'active',
        clock,
      )
      retirePrivateAttempts(db, { ...reboot, monotonicMs: PRIVATE_ATTEMPT_RETENTION_MS + 2 })
      deletePrivateRetiredAttempts(db)
      expect(authenticatePrivateAttempt(db, project, prepared.ticket).row?.run_id).toBe('active')
    } finally {
      close()
    }
  })
  test('preparation and acceptance share retained bytes, outstanding reservations and metadata headroom', () => {
    const { db, prepare, close } = fixture()
    try {
      const first = prepare()
      const second = prepare()
      const baseline = privateAttemptStorageBytes(db)
      // Synthetic logical occupancy avoids allocating 4 GiB in a unit test.
      attemptWrite(db, 'UPDATE prepared_attempts SET input_bytes = ?1 WHERE nonce = ?2', [
        4 * 1024 ** 3 - baseline - 1024,
        authenticatePrivateAttempt(db, project, first.ticket).row!.nonce,
      ])
      expect(() => prepare()).toThrow('storage capacity')
      attemptWrite(db, 'INSERT INTO root_runs VALUES (?1)', ['blocked'])
      expect(() =>
        acceptPrivatePreparedAttempt(
          db,
          authenticatePrivateAttempt(db, project, second.ticket),
          'blocked',
          clock,
        ),
      ).toThrow('storage capacity')
      expect(authenticatePrivateAttempt(db, project, second.ticket).row!.run_id).toBeNull()
      expect(attemptQuery(db, 'SELECT * FROM prepared_attempts')).toHaveLength(2)
    } finally {
      close()
    }
  })
  test('control consumption is transactional, charged once, and protects final cleanup from new work', () => {
    const { db, prepare, close } = fixture()
    try {
      const prepared = prepare()
      attemptWrite(db, 'INSERT INTO root_runs VALUES (?1)', ['control'])
      acceptPrivatePreparedAttempt(
        db,
        authenticatePrivateAttempt(db, project, prepared.ticket),
        'control',
        clock,
      )
      const before = privateAttemptStorageBytes(db)
      db.exec('BEGIN IMMEDIATE')
      consumePrivateAttemptControlReservation(db, 'control', 12 * 1024 ** 2)
      expect(privateAttemptStorageBytes(db)).toBe(before - 12 * 8192)
      expect(() => consumePrivateAttemptControlReservation(db, 'control', 1)).toThrow(
        'control reservation',
      )
      consumePrivateAttemptControlReservation(db, 'control', 4096, true)
      db.exec('ROLLBACK')
      expect(privateAttemptStorageBytes(db)).toBe(before)
      expect(
        attemptQuery<{ bytes: bigint }>(
          db,
          'SELECT control_bytes AS bytes FROM prepared_attempts',
        )[0]!.bytes,
      ).toBe(0n)
      db.exec('BEGIN IMMEDIATE')
      consumePrivateAttemptControlReservation(db, 'control', 8192, true)
      consumePrivateAttemptReservation(db, 'control')
      db.exec('COMMIT')
      expect(privateAttemptStorageBytes(db)).toBe(before - 33_554_432 - 1024 + 8192 - 33 * 8192)
    } finally {
      close()
    }
  })
  test('SQLite page exhaustion before acceptance rolls back the original allocation and reserves', () => {
    const directory = realpathSync(mkdtempSync(join(tmpdir(), 'jig-ticket-full-')))
    const { db, prepare, close } = fixture(join(directory, 'state.sqlite3'))
    try {
      const prepared = prepare()
      const pages = attemptQuery<{ page_count: bigint }>(db, 'PRAGMA page_count')[0]!.page_count
      db.exec(`PRAGMA max_page_count = ${pages}`)
      expect(() =>
        transaction(db, () => {
          attemptWrite(db, 'INSERT INTO root_runs VALUES (?1)', ['no-dispatch'])
          acceptPrivatePreparedAttempt(
            db,
            authenticatePrivateAttempt(db, project, prepared.ticket),
            'no-dispatch',
            clock,
          )
        }),
      ).toThrow('full')
      expect(authenticatePrivateAttempt(db, project, prepared.ticket).row!.run_id).toBeNull()
      expect(attemptQuery(db, 'SELECT * FROM root_runs')).toHaveLength(0)
      expect(
        attemptQuery(db, 'SELECT * FROM prepared_attempts WHERE control_reserve != 0'),
      ).toHaveLength(0)
      expect(attemptQuery(db, 'SELECT * FROM attempt_reservations')).toHaveLength(0)
    } finally {
      close()
      rmSync(directory, { recursive: true, force: true })
    }
  }, 30_000)
  test('consumed reservation admits retained artifacts at a fixed SQLite page ceiling without duplicate capacity', () => {
    const directory = realpathSync(mkdtempSync(join(tmpdir(), 'jig-ticket-pages-')))
    const { db, close } = fixture(join(directory, 'state.sqlite3'))
    const contents = Buffer.alloc(4 * 1024 ** 2, 42)
    const snapshot = capturePrivateRetainedOutput({
      files: [{ path: 'result.bin', bytes: contents, digest: sha256(contents) }],
      directories: [],
    })
    try {
      const frozen = {
        ...request,
        outputIntent: { packet: true, receive: ['result'] },
        constraints: { ...request.constraints, artifactBytes: contents.length },
      }
      const prepared = persistPrivatePreparedAttempt(db, project, clock, frozen, [])
      transaction(db, () => {
        attemptWrite(db, 'INSERT INTO root_runs VALUES (?1)', ['retained'])
        acceptPrivatePreparedAttempt(
          db,
          authenticatePrivateAttempt(db, project, prepared.ticket),
          'retained',
          clock,
        )
      })
      const pages = attemptQuery<{ page_count: bigint }>(db, 'PRAGMA page_count')[0]!.page_count
      db.exec(`PRAGMA max_page_count = ${pages}`)
      attemptWrite(db, 'INSERT INTO root_child_owners VALUES (?1)', ['retained'])
      expect(() =>
        transaction(db, () => retainPrivateAttemptArtifacts(db, 'retained', { result: snapshot })),
      ).toThrow('full')
      expect(attemptQuery(db, "SELECT * FROM attempt_blobs WHERE purpose != 'input'")).toHaveLength(
        0,
      )
      expect(authenticatePrivateAttempt(db, project, prepared.ticket).row!.run_id).toBe('retained')
      expect(attemptQuery(db, 'SELECT * FROM root_runs')).toHaveLength(1)
      expect(attemptQuery(db, 'SELECT * FROM root_terminals')).toHaveLength(0)
      expect(attemptQuery(db, 'SELECT * FROM root_child_owners')).toHaveLength(1)
      attemptWrite(db, 'DELETE FROM root_child_owners')
      const before = privateAttemptStorageBytes(db)
      transaction(db, () => {
        consumePrivateAttemptControlReservation(db, 'retained', 8192, true)
        consumePrivateAttemptReservation(db, 'retained')
        retainPrivateAttemptArtifacts(db, 'retained', { result: snapshot })
        attemptWrite(db, 'INSERT INTO root_terminals VALUES (?1, ?2)', [
          'retained',
          Buffer.from('terminal'),
        ])
      })
      expect(attemptQuery(db, 'SELECT * FROM root_terminals')).toHaveLength(1)
      expect(
        attemptQuery(
          db,
          'SELECT * FROM prepared_attempts WHERE control_reserve != 0 OR result_reserve != 0',
        ),
      ).toHaveLength(0)
      expect(attemptQuery(db, 'SELECT * FROM attempt_reservations')).toHaveLength(0)
      expect(
        attemptQuery<{ content: Uint8Array }>(
          db,
          "SELECT content FROM attempt_blobs WHERE purpose = 'artifact'",
        )[0]!.content,
      ).toEqual(contents)
      expect(privateAttemptStorageBytes(db)).toBeLessThan(before)
      expect(attemptQuery(db, 'PRAGMA journal_mode')).toEqual([{ journal_mode: 'delete' }])
      expect(attemptQuery(db, 'PRAGMA synchronous')).toEqual([{ synchronous: 3n }])
    } finally {
      snapshot.close()
      close()
      rmSync(directory, { recursive: true, force: true })
    }
  }, 30_000)
  test('64 KiB metadata growth rewrites only its touched 1 MiB control chunk, never the result reserve', () => {
    const { db, prepare, close } = fixture()
    try {
      const prepared = prepare()
      attemptWrite(db, 'INSERT INTO root_runs VALUES (?1)', ['chunked'])
      acceptPrivatePreparedAttempt(
        db,
        authenticatePrivateAttempt(db, project, prepared.ticket),
        'chunked',
        clock,
      )
      db.exec('CREATE TABLE chunk_writes (purpose TEXT, bytes INTEGER)')
      db.exec(
        'CREATE TRIGGER reserve_delete AFTER DELETE ON attempt_reservations BEGIN INSERT INTO chunk_writes VALUES (old.purpose, length(old.content)); END',
      )
      db.exec(
        'CREATE TRIGGER reserve_insert AFTER INSERT ON attempt_reservations BEGIN INSERT INTO chunk_writes VALUES (new.purpose, length(new.content)); END',
      )
      db.exec(
        'CREATE TRIGGER reserve_update AFTER UPDATE ON attempt_reservations BEGIN INSERT INTO chunk_writes VALUES (new.purpose, length(new.content)); END',
      )
      const before = privateAttemptStorageBytes(db)
      transaction(db, () => consumePrivateAttemptControlReservation(db, 'chunked', 64 * 1024))
      expect(attemptQuery(db, 'SELECT purpose, bytes FROM chunk_writes')).toEqual([
        { purpose: 'control', bytes: 1_048_576n },
        { purpose: 'control', bytes: 983_040n },
      ])
      expect(attemptQuery(db, 'SELECT count(*) AS count FROM attempt_reservations')).toEqual([
        { count: 33n },
      ])
      expect(privateAttemptStorageBytes(db)).toBe(before)
      const row = attemptQuery<{ remaining: bigint; consumed: bigint }>(
        db,
        'SELECT control_reserve AS remaining, control_bytes AS consumed FROM prepared_attempts',
      )[0]!
      expect(row).toEqual({ remaining: 33_488_896n, consumed: 65_536n })
    } finally {
      close()
    }
  })
})
