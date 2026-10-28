import { createHash, randomUUID } from 'node:crypto'
import { type BigIntStats, constants } from 'node:fs'
import { type FileHandle, realpath } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import type { Reference } from '@jigging/reporting'
import {
  canonicalReportingMessage,
  type DisplayBundle,
  type DisplayPublicationView,
  validateDisplayBundle,
  validateReportingMessage,
} from '@jigging/reporting/validation'
import {
  mkdirPrivateFile,
  openPrivateFile,
  privateChildLocation,
  statPrivateFile,
} from './descriptor-files.js'
import { privatePresentationNow } from './root-run-timeout-policy.js'

const DATABASE = 'display.sqlite3'
const APPLICATION_ID = 0x4a494744
const SCHEMA_VERSION = 1
const DIGEST = /^sha256:[0-9a-f]{64}$/
export const PRIVATE_DISPLAY_ARCHIVE_LIMITS = Object.freeze({
  requests: 1024,
  targets: 4096,
  evidenceItems: 4096,
  evidenceBytes: 64 * 1024 * 1024,
  evidenceFileBytes: 16 * 1024 * 1024,
  storeBytes: 256 * 1024 * 1024,
  readViews: 32,
  readBytes: 6 * 1024 * 1024,
  receiptBytes: 8 * 1024 * 1024,
})

export class PrivateDisplayArchiveError extends Error {
  constructor(
    readonly code:
      | 'INVALID'
      | 'UNSAFE_STORE'
      | 'CLOSED'
      | 'EXPIRED'
      | 'CONFLICT'
      | 'MISMATCH'
      | 'CAPACITY'
      | 'EVIDENCE_UNAVAILABLE'
      | 'DEADLINE',
    message: string,
  ) {
    super(message)
    this.name = 'PrivateDisplayArchiveError'
  }
}

export type PrivateDisplaySource = Readonly<{ runId: string; sourceId: string; callId?: string }>
export type PrivateDisplayBinding =
  | Readonly<{ reference: Reference; state: 'retained'; targetId: string; content: Uint8Array }>
  | Readonly<{ reference: Reference; state: 'unavailable'; reason: string }>
export type PrivateDisplayEvidence =
  | Readonly<{
      reference: Reference
      state: 'retained'
      targetId: string
      digest: string
      bytes: number
    }>
  | Readonly<{ reference: Reference; state: 'unavailable'; reason: string }>
export type PrivateDisplayReceipt = Readonly<{
  kind: 'display-receipt'
  generation: string
  requestId: string
  edition: string
  publicationDigest: string
  capturedBundleDigest: string
  source: PrivateDisplaySource
  targets: readonly Readonly<{ definitionId: string; instanceKey: string; revision: string }>[]
  evidence: readonly PrivateDisplayEvidence[]
}>
export type PrivateRetainedDisplayView = Readonly<{
  publication: DisplayPublicationView
  revision: string
  edition: string
  source: PrivateDisplaySource
  requestId: string
}>
export type PrivateDisplayArchiveCommit = Readonly<{
  bundle: DisplayBundle
  capturedBundleDigest: string
  source: PrivateDisplaySource
  bindings: readonly PrivateDisplayBinding[]
  /** Epoch-referenced monotonic presentation time, never a renewable allowance. */
  deadline?: number
}>
export type PrivateDisplayViewSelection = Readonly<{
  definitionId?: string
  instanceKey?: string
  limit?: number
}>
export interface PrivateDisplayArchive {
  state(): Promise<
    Readonly<{
      generation: string
      requests: number
      targets: number
      heads: readonly Readonly<{
        definitionId: string
        instanceKey: string
        revision: string
        retained: boolean
      }>[]
    }>
  >
  commit(input: PrivateDisplayArchiveCommit): Promise<PrivateDisplayReceipt>
  receipt(
    requestId: string,
    expectedGeneration?: string,
  ): Promise<PrivateDisplayReceipt | undefined>
  views(options?: PrivateDisplayViewSelection): Promise<readonly PrivateRetainedDisplayView[]>
  evidence(
    definitionId: string,
    instanceKey: string,
    revision: string,
    reference: Reference,
  ): Promise<Readonly<{ evidence: PrivateDisplayEvidence; content?: Uint8Array }> | undefined>
  remove(definitionId: string, instanceKey: string, expectedRevision: string): Promise<void>
  reset(expectedGeneration: string): Promise<string>
  close(): Promise<void>
}

interface SqliteDatabase {
  readonly inTransaction: boolean
  exec(sql: string): void
  query<T>(sql: string): {
    all(...values: unknown[]): T[]
    run(...values: unknown[]): unknown
    finalize(): void
  }
  close(throwOnError?: boolean): void
}
interface SqliteModule {
  Database: { open(path: string, flags: number): SqliteDatabase }
  constants: Record<string, number>
}
// SQLite waits synchronously. Owners sharing one inode must not block each
// other's event loop while the first owner awaits an identity check.
const queues = new Map<string, { tail: Promise<unknown>; owners: number }>()
const SCHEMA = [
  'CREATE TABLE display_meta (singleton INTEGER PRIMARY KEY CHECK (singleton = 1), generation TEXT NOT NULL, serial INTEGER NOT NULL) STRICT',
  'CREATE TABLE display_requests (request_id TEXT PRIMARY KEY, publication_digest TEXT NOT NULL, receipt TEXT NOT NULL) STRICT',
  'CREATE TABLE display_views (target_key TEXT PRIMARY KEY, definition_id TEXT NOT NULL, instance_key TEXT NOT NULL, revision TEXT NOT NULL, request_id TEXT NOT NULL, value TEXT, FOREIGN KEY (request_id) REFERENCES display_requests(request_id)) STRICT',
  'CREATE TABLE display_bindings (request_id TEXT NOT NULL, reference_key TEXT NOT NULL, value TEXT NOT NULL, digest TEXT, PRIMARY KEY (request_id, reference_key), FOREIGN KEY (request_id) REFERENCES display_requests(request_id)) STRICT',
  'CREATE TABLE display_blobs (digest TEXT PRIMARY KEY, content BLOB NOT NULL) STRICT',
] as const

/** Acquire presentation storage only. Decoded bundle data never grants file authority. */
export async function openPrivateDisplayArchive(
  directoryPath: string,
  options: Readonly<{ create?: boolean }> = {},
): Promise<PrivateDisplayArchive> {
  const requested = resolve(directoryPath)
  if (options.create) {
    try {
      await mkdirPrivateFile(requested, 0o700)
    } catch (error) {
      if (!hasCode(error, 'EEXIST')) throw error
    }
  }
  const directory = await openPrivateFile(
    requested,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  )
  let database: SqliteDatabase | undefined
  try {
    const directoryIdentity = await directory.stat({ bigint: true })
    requireDirectory(directoryIdentity)
    if (!sameIdentity(await statPrivateFile(requested), directoryIdentity)) unsafe()
    const databaseLocation = privateChildLocation(directory, DATABASE)
    if (options.create) {
      let file: FileHandle | undefined
      try {
        file = await openPrivateFile(
          databaseLocation,
          constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
          0o600,
        )
        await file.sync()
        await directory.sync()
      } catch (error) {
        if (!hasCode(error, 'EEXIST')) throw error
      } finally {
        await file?.close()
      }
    }
    const databaseIdentity = await statPrivateFile(databaseLocation)
    requireFile(databaseIdentity, directoryIdentity.dev)
    const visibleDirectory = process.platform === 'darwin' ? await realpath(requested) : requested
    const visibleDatabase = join(visibleDirectory, DATABASE)
    const verify = async () => {
      requireDirectory(await statPrivateFile(requested))
      if (!sameIdentity(await statPrivateFile(requested), directoryIdentity)) unsafe()
      const current = await statPrivateFile(databaseLocation)
      requireFile(current, directoryIdentity.dev)
      if (!sameIdentity(current, databaseIdentity)) unsafe()
      if (!sameIdentity(await statPrivateFile(visibleDirectory), directoryIdentity)) unsafe()
      if (!sameIdentity(await statPrivateFile(visibleDatabase), databaseIdentity)) unsafe()
      for (const suffix of ['-journal', '-wal', '-shm']) {
        try {
          const sidecar = await statPrivateFile(
            privateChildLocation(directory, `${DATABASE}${suffix}`),
          )
          if (suffix !== '-journal') unsafe()
          requireFile(sidecar, directoryIdentity.dev)
        } catch (error) {
          if (!hasCode(error, 'ENOENT')) throw error
        }
      }
    }
    await verify()
    const sqlite = createRequire(import.meta.url)('bun:sqlite') as SqliteModule
    const flag = (name: string) => {
      const value = sqlite.constants[name]
      if (!Number.isInteger(value) || value === 0) unsafe()
      return value!
    }
    database = sqlite.Database.open(
      visibleDatabase,
      flag('SQLITE_OPEN_READWRITE') | flag('SQLITE_OPEN_NOFOLLOW'),
    )
    await verify()
    configure(database)
    initialize(database, options.create === true)
    await verify()
    return owner(database, directory, verify, `${directoryIdentity.dev}:${directoryIdentity.ino}`)
  } catch (error) {
    const failures: unknown[] = [error]
    try {
      database?.close(true)
    } catch (failure) {
      failures.push(failure)
    }
    try {
      await directory.close()
    } catch (failure) {
      failures.push(failure)
    }
    if (failures.length > 1)
      throw new AggregateError(failures, 'Display storage acquisition cleanup failed.')
    throw error
  }
}

function owner(
  database: SqliteDatabase,
  directory: FileHandle,
  verify: () => Promise<void>,
  identity: string,
): PrivateDisplayArchive {
  let closing = false
  const queue = queues.get(identity) ?? { tail: Promise.resolve(), owners: 0 }
  queue.owners++
  queues.set(identity, queue)
  let closeTask: Promise<void> | undefined
  const operation = <T>(write: boolean, action: () => T, deadline?: number): Promise<T> => {
    if (closing)
      return Promise.reject(new PrivateDisplayArchiveError('CLOSED', 'Display storage is closed.'))
    const result = queue.tail.then(async () => {
      checkDeadline(deadline)
      await verify()
      checkDeadline(deadline)
      database.exec(write ? 'BEGIN IMMEDIATE' : 'BEGIN')
      try {
        // Recheck after SQLite's bounded lock wait and before any material is read or written.
        checkDeadline(deadline)
        await verify()
        checkDeadline(deadline)
        const value = action()
        await verify()
        checkDeadline(deadline)
        database.exec('COMMIT')
        // Acceptance remains a fact if time expires after the synchronous COMMIT.
        return value
      } catch (error) {
        if (database.inTransaction) {
          try {
            database.exec('ROLLBACK')
          } catch (rollback) {
            throw new AggregateError([error, rollback], 'Display transaction cleanup failed.')
          }
        }
        throw error
      }
    })
    queue.tail = result.catch(() => undefined)
    return result
  }
  return Object.freeze({
    state() {
      return operation(false, () => {
        const state = meta(database)
        const rows = query<{
          target_key: string
          definition_id: string
          instance_key: string
          revision: string
          retained: number
        }>(
          database,
          'SELECT target_key, definition_id, instance_key, revision, value IS NOT NULL AS retained FROM display_views ORDER BY target_key LIMIT 4097',
        )
        if (rows.length > PRIVATE_DISPLAY_ARCHIVE_LIMITS.targets) unsafe()
        let keys: string[]
        try {
          keys = rows.map((row) => targetKey(row.definition_id, row.instance_key))
        } catch {
          return unsafe()
        }
        if (
          new Set(keys).size !== rows.length ||
          rows.some((row, index) => row.target_key !== keys[index])
        )
          unsafe()
        return Object.freeze({
          generation: state.generation,
          requests: count(database, 'display_requests'),
          targets: rows.length,
          heads: Object.freeze(
            rows.map((row) =>
              Object.freeze({
                definitionId: text(row.definition_id, 64),
                instanceKey: text(row.instance_key, 64),
                revision: revision(row.revision, state.generation, state.serial),
                retained: row.retained === 1,
              }),
            ),
          ),
        })
      })
    },
    commit(input: PrivateDisplayArchiveCommit) {
      let normalized: NormalizedCommit
      try {
        normalized = normalizeCommit(input)
      } catch (error) {
        return Promise.reject(error)
      }
      return operation(true, () => commit(database, normalized), input.deadline).finally(() => {
        for (const bytes of normalized.content.values()) bytes.fill(0)
      })
    },
    receipt(requestId: string, expectedGeneration?: string) {
      const request = text(requestId, 128)
      const generation =
        expectedGeneration === undefined ? undefined : text(expectedGeneration, 128)
      return operation(false, () => {
        if (generation !== undefined && generation !== meta(database).generation)
          fail('EXPIRED', 'The archive generation changed.')
        return receipt(database, request)
      })
    },
    views(options: PrivateDisplayViewSelection = {}) {
      const limit = options.limit ?? PRIVATE_DISPLAY_ARCHIVE_LIMITS.readViews
      if (
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        limit > PRIVATE_DISPLAY_ARCHIVE_LIMITS.readViews
      )
        return Promise.reject(
          new PrivateDisplayArchiveError('INVALID', 'Invalid display read limit.'),
        )
      const definition =
        options.definitionId === undefined ? undefined : text(options.definitionId, 64)
      const instance = options.instanceKey === undefined ? undefined : text(options.instanceKey, 64)
      if (instance !== undefined && definition === undefined)
        return Promise.reject(
          new PrivateDisplayArchiveError('INVALID', 'Instance selection requires a definition.'),
        )
      return operation(false, () => {
        const state = meta(database)
        const conditions = ['value IS NOT NULL']
        const bindings: unknown[] = []
        if (definition !== undefined) {
          bindings.push(definition)
          conditions.push(`definition_id = ?${bindings.length}`)
        }
        if (instance !== undefined) {
          bindings.push(instance)
          conditions.push(`instance_key = ?${bindings.length}`)
        }
        bindings.push(limit)
        const rows = query<{
          target_key: string
          definition_id: string
          instance_key: string
          revision: string
          request_id: string
          bytes: number
        }>(
          database,
          `SELECT target_key, definition_id, instance_key, revision, request_id, length(CAST(value AS BLOB)) AS bytes FROM display_views WHERE ${conditions.join(' AND ')} ORDER BY target_key LIMIT ?${bindings.length}`,
          bindings,
        )
        const values: PrivateRetainedDisplayView[] = []
        let bytes = 0
        for (const row of rows) {
          if (
            !Number.isSafeInteger(row.bytes) ||
            row.bytes < 1 ||
            row.bytes > PRIVATE_DISPLAY_ARCHIVE_LIMITS.readBytes
          )
            unsafe()
          if (bytes + row.bytes > PRIVATE_DISPLAY_ARCHIVE_LIMITS.readBytes) break
          const payload = query<{ value: string }>(
            database,
            'SELECT value FROM display_views WHERE target_key = ?1',
            [row.target_key],
          )[0]
          if (
            !payload ||
            typeof payload.value !== 'string' ||
            Buffer.byteLength(payload.value) !== row.bytes
          )
            unsafe()
          values.push(readRetainedView(payload.value, row, state.generation, state.serial))
          bytes += row.bytes
        }
        return Object.freeze(values)
      })
    },
    evidence(
      definitionId: string,
      instanceKey: string,
      expectedRevision: string,
      reference: Reference,
    ) {
      const key = targetKey(definitionId, instanceKey)
      const referenceKey = canonicalReportingMessage(reference)
      return operation(false, () => {
        const view = query<{ revision: string; request_id: string }>(
          database,
          'SELECT revision, request_id FROM display_views WHERE target_key = ?1 AND value IS NOT NULL',
          [key],
        )[0]
        if (!view || view.revision !== expectedRevision) return undefined
        const metadata = query<{
          value_bytes: number
          bytes: number | null
          digest: string | null
        }>(
          database,
          'SELECT length(CAST(b.value AS BLOB)) AS value_bytes, length(f.content) AS bytes, b.digest FROM display_bindings b LEFT JOIN display_blobs f ON f.digest = b.digest WHERE b.request_id = ?1 AND b.reference_key = ?2',
          [view.request_id, referenceKey],
        )[0]
        if (!metadata) return undefined
        if (
          !Number.isSafeInteger(metadata.value_bytes) ||
          metadata.value_bytes < 1 ||
          metadata.value_bytes > 4096 ||
          (metadata.digest === null
            ? metadata.bytes !== null
            : !DIGEST.test(metadata.digest) ||
              metadata.bytes === null ||
              !Number.isSafeInteger(metadata.bytes) ||
              metadata.bytes < 0 ||
              metadata.bytes > PRIVATE_DISPLAY_ARCHIVE_LIMITS.evidenceFileBytes)
        )
          unsafe()
        const binding = query<{ value: string; content: Uint8Array | null }>(
          database,
          'SELECT b.value, f.content FROM display_bindings b LEFT JOIN display_blobs f ON f.digest = b.digest WHERE b.request_id = ?1 AND b.reference_key = ?2',
          [view.request_id, referenceKey],
        )[0]
        if (!binding || Buffer.byteLength(binding.value) !== metadata.value_bytes) unsafe()
        try {
          const evidence = readEvidence(JSON.parse(binding.value))
          if (
            canonicalReportingMessage(evidence) !== binding.value ||
            canonicalReportingMessage(evidence.reference) !== referenceKey ||
            (evidence.state === 'retained'
              ? evidence.digest !== metadata.digest ||
                evidence.bytes !== metadata.bytes ||
                !(binding.content instanceof Uint8Array) ||
                binding.content.byteLength !== evidence.bytes ||
                hash(binding.content) !== evidence.digest
              : metadata.digest !== null || binding.content !== null)
          )
            unsafe()
          return Object.freeze({
            evidence,
            ...(binding.content === null ? {} : { content: Uint8Array.from(binding.content) }),
          })
        } catch {
          return fail('UNSAFE_STORE', 'A retained evidence binding failed validation.')
        }
      })
    },
    remove(definitionId: string, instanceKey: string, expectedRevision: string) {
      const key = targetKey(definitionId, instanceKey)
      const expected = text(expectedRevision, 128)
      return operation(true, () => {
        const row = query<{ revision: string }>(
          database,
          'SELECT revision FROM display_views WHERE target_key = ?1',
          [key],
        )[0]
        if (!row || row.revision !== expected)
          fail('CONFLICT', 'A retained view changed before removal.')
        const next = nextRevision(database)
        run(
          database,
          'UPDATE display_views SET value = NULL, revision = ?1 WHERE target_key = ?2',
          [next, key],
        )
        collect(database)
      })
    },
    reset(expectedGeneration: string) {
      const expected = text(expectedGeneration, 128)
      return operation(true, () => {
        if (meta(database).generation !== expected)
          fail('EXPIRED', 'The archive generation changed before reset.')
        for (const table of [
          'display_bindings',
          'display_views',
          'display_blobs',
          'display_requests',
        ])
          database.exec(`DELETE FROM ${table}`)
        const generation = randomUUID()
        run(database, 'UPDATE display_meta SET generation = ?1, serial = 0 WHERE singleton = 1', [
          generation,
        ])
        return generation
      })
    },
    close() {
      closing = true
      closeTask ??= queue.tail.then(async () => {
        const failures: unknown[] = []
        try {
          await verify()
        } catch (error) {
          failures.push(error)
        }
        try {
          database.close(true)
        } catch (error) {
          failures.push(error)
        }
        try {
          await directory.close()
        } catch (error) {
          failures.push(error)
        }
        if (--queue.owners === 0 && queues.get(identity) === queue) queues.delete(identity)
        if (failures.length) throw new AggregateError(failures, 'Display storage cleanup failed.')
      })
      return closeTask
    },
  })
}

type NormalizedCommit = Readonly<{
  bundle: DisplayBundle
  capturedBundleDigest: string
  source: PrivateDisplaySource
  evidence: readonly PrivateDisplayEvidence[]
  content: Map<string, Uint8Array>
  digest: string
  deadline?: number
}>
function normalizeCommit(input: PrivateDisplayArchiveCommit): NormalizedCommit {
  checkDeadline(input.deadline)
  const bundle = validateDisplayBundle(input.bundle)
  if (!DIGEST.test(input.capturedBundleDigest))
    fail('INVALID', 'The captured bundle digest is invalid.')
  const source = readSource(input.source)
  const references = new Map<string, Reference>()
  for (const publication of bundle.views)
    walkReferences(publication.view, (reference) =>
      references.set(canonicalReportingMessage(reference), reference),
    )
  if (references.size > PRIVATE_DISPLAY_ARCHIVE_LIMITS.evidenceItems)
    fail('CAPACITY', 'Display reference count exceeds its limit.')
  for (const required of bundle.requiredEvidence ?? [])
    if (!references.has(canonicalReportingMessage(required)))
      fail('INVALID', 'Required evidence must occur in a published view.')
  if (
    !Array.isArray(input.bindings) ||
    input.bindings.length > PRIVATE_DISPLAY_ARCHIVE_LIMITS.evidenceItems
  )
    fail('CAPACITY', 'Display evidence count exceeds its limit.')
  const bindings = new Map<string, PrivateDisplayBinding>()
  for (const binding of input.bindings) {
    const key = canonicalReportingMessage(binding.reference)
    if (!references.has(key) || bindings.has(key))
      fail('INVALID', 'Display evidence binding is unknown or duplicated.')
    bindings.set(key, binding)
  }
  const content = new Map<string, Uint8Array>()
  let total = 0
  try {
    const evidence = [...references]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, reference]): PrivateDisplayEvidence => {
        const binding = bindings.get(key)
        if (!binding || binding.state === 'unavailable')
          return Object.freeze({
            reference,
            state: 'unavailable',
            reason: binding ? text(binding.reason) : 'Not retained by the originating source.',
          })
        if (binding.state !== 'retained' || !(binding.content instanceof Uint8Array))
          fail('INVALID', 'Retained evidence requires captured bytes.')
        total += binding.content.byteLength
        if (
          binding.content.byteLength > PRIVATE_DISPLAY_ARCHIVE_LIMITS.evidenceFileBytes ||
          total > PRIVATE_DISPLAY_ARCHIVE_LIMITS.evidenceBytes
        )
          fail('CAPACITY', 'Display evidence bytes exceed their limit.')
        const bytes = Uint8Array.from(binding.content)
        const digest = hash(bytes)
        if (content.has(digest)) bytes.fill(0)
        else content.set(digest, bytes)
        return Object.freeze({
          reference,
          state: 'retained',
          targetId: text(binding.targetId),
          digest,
          bytes: bytes.byteLength,
        })
      })
    const required = new Set((bundle.requiredEvidence ?? []).map(canonicalReportingMessage))
    if (
      evidence.some(
        (item) =>
          item.state === 'unavailable' && required.has(canonicalReportingMessage(item.reference)),
      )
    )
      fail('EVIDENCE_UNAVAILABLE', 'Required display evidence could not be retained.')
    return Object.freeze({
      bundle,
      capturedBundleDigest: input.capturedBundleDigest,
      source,
      evidence: Object.freeze(evidence),
      content,
      digest: hash(
        canonicalReportingMessage({
          bundle,
          evidence: evidence.map((item) =>
            item.state === 'retained'
              ? {
                  reference: item.reference,
                  state: item.state,
                  digest: item.digest,
                  bytes: item.bytes,
                }
              : item,
          ),
        }),
      ),
      ...(input.deadline === undefined ? {} : { deadline: input.deadline }),
    })
  } catch (error) {
    for (const bytes of content.values()) bytes.fill(0)
    throw error
  }
}

function commit(database: SqliteDatabase, input: NormalizedCommit): PrivateDisplayReceipt {
  checkDeadline(input.deadline)
  const state = meta(database)
  if (input.bundle.generation !== state.generation)
    fail('EXPIRED', 'The publication context has expired.')
  const previous = receipt(database, input.bundle.requestId)
  if (previous) {
    if (previous.publicationDigest !== input.digest)
      fail('MISMATCH', 'The publication request was already used for different material.')
    return previous
  }
  if (count(database, 'display_requests') >= PRIVATE_DISPLAY_ARCHIVE_LIMITS.requests)
    fail(
      'CAPACITY',
      'Display receipt capacity is exhausted. Reset explicitly before new publication.',
    )
  const targets = input.bundle.views.map((publication) => {
    const target = publication.view.target
    const key = targetKey(target.definitionId, target.instanceKey)
    const existing = query<{ revision: string }>(
      database,
      'SELECT revision FROM display_views WHERE target_key = ?1',
      [key],
    )[0]
    if (existing) revision(existing.revision, state.generation, state.serial)
    if ((existing?.revision ?? null) !== publication.expectedRevision)
      fail('CONFLICT', 'A retained view changed before publication.')
    return { publication, target, key, exists: existing !== undefined }
  })
  if (
    count(database, 'display_views') + targets.filter((target) => !target.exists).length >
    PRIVATE_DISPLAY_ARCHIVE_LIMITS.targets
  )
    fail('CAPACITY', 'Display target capacity is exhausted.')
  checkDeadline(input.deadline)
  const newRevision = nextRevision(database)
  const result: PrivateDisplayReceipt = Object.freeze({
    kind: 'display-receipt',
    generation: state.generation,
    requestId: input.bundle.requestId,
    edition: input.bundle.edition,
    publicationDigest: input.digest,
    capturedBundleDigest: input.capturedBundleDigest,
    source: input.source,
    targets: Object.freeze(
      targets.map(({ target }) =>
        Object.freeze({
          definitionId: target.definitionId,
          instanceKey: target.instanceKey,
          revision: newRevision,
        }),
      ),
    ),
    evidence: input.evidence,
  })
  const encoded = canonicalReportingMessage(result)
  if (Buffer.byteLength(encoded) > PRIVATE_DISPLAY_ARCHIVE_LIMITS.receiptBytes)
    fail('CAPACITY', 'Display receipt exceeds its byte limit.')
  const write = (sql: string, values: unknown[]) => {
    checkDeadline(input.deadline)
    run(database, sql, values)
  }
  write(
    'INSERT INTO display_requests(request_id, publication_digest, receipt) VALUES (?1, ?2, ?3)',
    [input.bundle.requestId, input.digest, encoded],
  )
  for (const [digest, bytes] of input.content) {
    const existing = query<{ bytes: number }>(
      database,
      'SELECT length(content) AS bytes FROM display_blobs WHERE digest = ?1',
      [digest],
    )[0]
    if (existing) {
      if (existing.bytes !== bytes.byteLength) unsafe()
      const stored = query<{ content: Uint8Array }>(
        database,
        'SELECT content FROM display_blobs WHERE digest = ?1',
        [digest],
      )[0]?.content
      if (
        !(stored instanceof Uint8Array) ||
        stored.byteLength !== bytes.byteLength ||
        hash(stored) !== digest
      )
        unsafe()
    }
    write(
      'INSERT INTO display_blobs(digest, content) VALUES (?1, ?2) ON CONFLICT (digest) DO NOTHING',
      [digest, bytes],
    )
  }
  for (const evidence of input.evidence)
    write(
      'INSERT INTO display_bindings(request_id, reference_key, value, digest) VALUES (?1, ?2, ?3, ?4)',
      [
        input.bundle.requestId,
        canonicalReportingMessage(evidence.reference),
        canonicalReportingMessage(evidence),
        evidence.state === 'retained' ? evidence.digest : null,
      ],
    )
  for (const { publication, target, key } of targets) {
    const value: PrivateRetainedDisplayView = {
      publication,
      revision: newRevision,
      edition: input.bundle.edition,
      source: input.source,
      requestId: input.bundle.requestId,
    }
    write(
      'INSERT INTO display_views(target_key, definition_id, instance_key, revision, request_id, value) VALUES (?1, ?2, ?3, ?4, ?5, ?6) ON CONFLICT (target_key) DO UPDATE SET revision = excluded.revision, request_id = excluded.request_id, value = excluded.value',
      [
        key,
        target.definitionId,
        target.instanceKey,
        newRevision,
        input.bundle.requestId,
        canonicalReportingMessage(value),
      ],
    )
  }
  collect(database, input.deadline)
  if (storageBytes(database) > PRIVATE_DISPLAY_ARCHIVE_LIMITS.storeBytes)
    fail('CAPACITY', 'Display archive logical storage is exhausted.')
  return result
}

function configure(database: SqliteDatabase): void {
  database.exec(
    'PRAGMA busy_timeout=100; PRAGMA synchronous=EXTRA; PRAGMA foreign_keys=ON; PRAGMA trusted_schema=OFF',
  )
  const journal = query<{ journal_mode: string }>(database, 'PRAGMA journal_mode')[0]
  if (
    journal?.journal_mode !== 'delete' ||
    pragma(database, 'synchronous') !== 3 ||
    pragma(database, 'foreign_keys') !== 1 ||
    pragma(database, 'trusted_schema') !== 0 ||
    pragma(database, 'busy_timeout') !== 100
  )
    fail('UNSAFE_STORE', 'Display storage requires the exact SQLite durability profile.')
}
function initialize(database: SqliteDatabase, create: boolean): void {
  database.exec('BEGIN IMMEDIATE')
  try {
    let actual = query<{ type: string; name: string; tbl_name: string; sql: string }>(
      database,
      "SELECT type, name, tbl_name, sql FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*' ORDER BY name",
    )
    if (
      create &&
      pragma(database, 'application_id') === 0 &&
      pragma(database, 'user_version') === 0 &&
      actual.length === 0
    ) {
      for (const sql of SCHEMA) database.exec(sql)
      run(database, 'INSERT INTO display_meta(singleton, generation, serial) VALUES (1, ?1, 0)', [
        randomUUID(),
      ])
      database.exec(
        `PRAGMA application_id=${APPLICATION_ID}; PRAGMA user_version=${SCHEMA_VERSION}`,
      )
      actual = query(
        database,
        "SELECT type, name, tbl_name, sql FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*' ORDER BY name",
      )
    }
    const expected = SCHEMA.map((sql) => ({
      type: 'table',
      name: sql.split(' ')[2]!,
      tbl_name: sql.split(' ')[2]!,
      sql,
    })).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    if (
      pragma(database, 'application_id') !== APPLICATION_ID ||
      pragma(database, 'user_version') !== SCHEMA_VERSION ||
      canonicalReportingMessage(actual) !== canonicalReportingMessage(expected) ||
      query(database, 'PRAGMA foreign_key_check').length !== 0
    )
      fail('UNSAFE_STORE', 'Display storage has an unsupported schema.')
    meta(database)
    database.exec('COMMIT')
  } catch (error) {
    if (database.inTransaction) database.exec('ROLLBACK')
    throw error
  }
}
function meta(database: SqliteDatabase): { generation: string; serial: number } {
  const value = query<{ generation: string; serial: number }>(
    database,
    'SELECT generation, serial FROM display_meta WHERE singleton = 1',
  )[0]
  if (!value || !Number.isSafeInteger(value.serial) || value.serial < 0) unsafe()
  try {
    text(value.generation, 128)
  } catch {
    return unsafe()
  }
  return value
}
function nextRevision(database: SqliteDatabase): string {
  const state = meta(database)
  if (state.serial >= Number.MAX_SAFE_INTEGER)
    fail('CAPACITY', 'Display revision capacity is exhausted.')
  run(database, 'UPDATE display_meta SET serial = serial + 1 WHERE singleton = 1', [])
  return `${state.generation}:${state.serial + 1}`
}
function receipt(database: SqliteDatabase, requestId: string): PrivateDisplayReceipt | undefined {
  const metadata = query<{ bytes: number }>(
    database,
    'SELECT length(CAST(receipt AS BLOB)) AS bytes FROM display_requests WHERE request_id = ?1',
    [requestId],
  )[0]
  if (!metadata) return undefined
  if (
    !Number.isSafeInteger(metadata.bytes) ||
    metadata.bytes < 1 ||
    metadata.bytes > PRIVATE_DISPLAY_ARCHIVE_LIMITS.receiptBytes
  )
    unsafe()
  const row = query<{ receipt: string; publication_digest: string }>(
    database,
    'SELECT receipt, publication_digest FROM display_requests WHERE request_id = ?1',
    [requestId],
  )[0]
  if (!row || typeof row.receipt !== 'string' || Buffer.byteLength(row.receipt) !== metadata.bytes)
    unsafe()
  try {
    const record = closedRecord(JSON.parse(row.receipt), [
      'kind',
      'generation',
      'requestId',
      'edition',
      'publicationDigest',
      'capturedBundleDigest',
      'source',
      'targets',
      'evidence',
    ])
    if (record.kind !== 'display-receipt') unsafe()
    const state = meta(database)
    const generation = text(record.generation, 128)
    const targets = boundedArray(record.targets, 32, 1).map((input) => {
      const target = closedRecord(input, ['definitionId', 'instanceKey', 'revision'])
      return Object.freeze({
        definitionId: text(target.definitionId, 64),
        instanceKey: text(target.instanceKey, 64),
        revision: revision(target.revision, generation, state.serial),
      })
    })
    if (
      new Set(targets.map((target) => targetKey(target.definitionId, target.instanceKey))).size !==
        targets.length ||
      new Set(targets.map((target) => target.revision)).size !== 1
    )
      unsafe()
    const evidence = boundedArray(
      record.evidence,
      PRIVATE_DISPLAY_ARCHIVE_LIMITS.evidenceItems,
    ).map(readEvidence)
    if (
      new Set(evidence.map((item) => canonicalReportingMessage(item.reference))).size !==
        evidence.length ||
      evidence.reduce((bytes, item) => bytes + (item.state === 'retained' ? item.bytes : 0), 0) >
        PRIVATE_DISPLAY_ARCHIVE_LIMITS.evidenceBytes
    )
      unsafe()
    const value: PrivateDisplayReceipt = Object.freeze({
      kind: 'display-receipt',
      generation,
      requestId: text(record.requestId, 128),
      edition: text(record.edition, 128),
      publicationDigest: readDigest(record.publicationDigest),
      capturedBundleDigest: readDigest(record.capturedBundleDigest),
      source: readSource(record.source),
      targets: Object.freeze(targets),
      evidence: Object.freeze(evidence),
    })
    if (
      value.requestId !== requestId ||
      value.generation !== meta(database).generation ||
      value.publicationDigest !== row.publication_digest ||
      canonicalReportingMessage(value) !== row.receipt
    )
      unsafe()
    return value
  } catch {
    return fail('UNSAFE_STORE', 'A retained display receipt failed its data validation.')
  }
}
function readEvidence(input: unknown): PrivateDisplayEvidence {
  const item = closedRecord(input, ['reference', 'state', 'reason', 'targetId', 'digest', 'bytes'])
  const view = validateReportingMessage({
    kind: 'view',
    id: 'evidence',
    title: 'Evidence',
    summary: 'Retained evidence.',
    sections: [{ blocks: [{ kind: 'report', text: 'Evidence.', references: [item.reference] }] }],
  })
  const block = view.kind === 'view' ? view.sections[0]?.blocks[0] : undefined
  const reference = block?.kind === 'report' ? block.references?.[0] : undefined
  if (!reference) unsafe()
  if (item.state === 'unavailable') {
    closedRecord(input, ['reference', 'state', 'reason'])
    return Object.freeze({ reference, state: 'unavailable', reason: text(item.reason) })
  }
  if (item.state !== 'retained') unsafe()
  closedRecord(input, ['reference', 'state', 'targetId', 'digest', 'bytes'])
  if (
    typeof item.bytes !== 'number' ||
    !Number.isSafeInteger(item.bytes) ||
    item.bytes < 0 ||
    item.bytes > PRIVATE_DISPLAY_ARCHIVE_LIMITS.evidenceFileBytes
  )
    unsafe()
  return Object.freeze({
    reference,
    state: 'retained',
    targetId: text(item.targetId),
    digest: readDigest(item.digest),
    bytes: item.bytes,
  })
}
function readSource(input: unknown): PrivateDisplaySource {
  const source = closedRecord(input, ['runId', 'sourceId', 'callId'])
  return Object.freeze({
    runId: text(source.runId),
    sourceId: text(source.sourceId),
    ...(Object.hasOwn(source, 'callId') ? { callId: text(source.callId) } : {}),
  })
}
function readRetainedView(
  input: string,
  metadata: {
    target_key: string
    definition_id: string
    instance_key: string
    revision: string
    request_id: string
  },
  generation: string,
  serial: number,
): PrivateRetainedDisplayView {
  try {
    const value = closedRecord(JSON.parse(input), [
      'publication',
      'revision',
      'edition',
      'source',
      'requestId',
    ])
    const bundle = validateDisplayBundle({
      kind: 'display-bundle',
      generation,
      requestId: value.requestId,
      edition: value.edition,
      views: [value.publication],
    })
    const publication = bundle.views[0]
    if (
      !publication ||
      publication.view.target.definitionId !== metadata.definition_id ||
      publication.view.target.instanceKey !== metadata.instance_key ||
      metadata.target_key !== targetKey(metadata.definition_id, metadata.instance_key) ||
      value.revision !== metadata.revision ||
      bundle.requestId !== metadata.request_id
    )
      unsafe()
    const result = Object.freeze({
      publication,
      revision: revision(value.revision, generation, serial),
      edition: bundle.edition,
      requestId: bundle.requestId,
      source: readSource(value.source),
    })
    if (canonicalReportingMessage(result) !== input) unsafe()
    return result
  } catch {
    return fail('UNSAFE_STORE', 'A retained display view failed its data validation.')
  }
}
function collect(database: SqliteDatabase, deadline?: number): void {
  checkDeadline(deadline)
  database.exec(
    'DELETE FROM display_bindings WHERE request_id NOT IN (SELECT request_id FROM display_views WHERE value IS NOT NULL)',
  )
  checkDeadline(deadline)
  database.exec(
    'DELETE FROM display_blobs WHERE digest NOT IN (SELECT digest FROM display_bindings WHERE digest IS NOT NULL)',
  )
}
function storageBytes(database: SqliteDatabase): number {
  const value = query<{ bytes: number }>(
    database,
    `SELECT
    (SELECT coalesce(sum(length(CAST(receipt AS BLOB)) + 1024), 0) FROM display_requests) +
    (SELECT coalesce(sum(coalesce(length(CAST(value AS BLOB)), 0) + 1024), 0) FROM display_views) +
    (SELECT coalesce(sum(length(CAST(value AS BLOB)) + 512), 0) FROM display_bindings) +
    (SELECT coalesce(sum(length(content) + 512), 0) FROM display_blobs) AS bytes`,
  )[0]?.bytes
  if (!Number.isSafeInteger(value) || value === undefined || value < 0) unsafe()
  return value
}
function walkReferences(value: unknown, visit: (reference: Reference) => void): void {
  if (Array.isArray(value)) for (const item of value) walkReferences(item, visit)
  else if (value !== null && typeof value === 'object') {
    const object = value as Record<string, unknown>
    if (['artifact', 'input-artifact', 'call', 'record'].includes(String(object.kind)))
      visit(value as Reference)
    else for (const item of Object.values(object)) walkReferences(item, visit)
  }
}
function closedRecord(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    ![null, Object.prototype].includes(Object.getPrototypeOf(value)) ||
    Reflect.ownKeys(value).some(
      (key) =>
        typeof key !== 'string' ||
        !fields.includes(key) ||
        !Object.getOwnPropertyDescriptor(value, key)?.enumerable ||
        !('value' in Object.getOwnPropertyDescriptor(value, key)!),
    )
  )
    unsafe()
  return value as Record<string, unknown>
}
function boundedArray(value: unknown, maximum: number, minimum = 0): unknown[] {
  if (
    !Array.isArray(value) ||
    value.length < minimum ||
    value.length > maximum ||
    Reflect.ownKeys(value).length !== value.length + 1
  )
    unsafe()
  return value
}
function text(value: unknown, maximum = 256): string {
  if (
    typeof value !== 'string' ||
    !value ||
    [...value].length > maximum ||
    /[\r\n\u2028\u2029]/u.test(value) ||
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)
  )
    fail('INVALID', 'Display identity or evidence text is invalid.')
  return value
}
function readDigest(value: unknown): string {
  if (typeof value !== 'string' || !DIGEST.test(value)) unsafe()
  return value
}
function revision(value: unknown, generation: string, maximum = Number.MAX_SAFE_INTEGER): string {
  const candidate = text(value, 128)
  const suffix = candidate.slice(generation.length + 1)
  if (
    !candidate.startsWith(`${generation}:`) ||
    !/^[1-9][0-9]*$/.test(suffix) ||
    !Number.isSafeInteger(Number(suffix)) ||
    Number(suffix) > maximum
  )
    unsafe()
  return candidate
}
function targetKey(definitionId: string, instanceKey: string): string {
  return JSON.stringify([text(definitionId, 64), text(instanceKey, 64)])
}
function hash(value: string | Uint8Array): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`
}
function query<T>(database: SqliteDatabase, sql: string, values: unknown[] = []): T[] {
  const statement = database.query<T>(sql)
  try {
    return statement.all(...values)
  } finally {
    statement.finalize()
  }
}
function run(database: SqliteDatabase, sql: string, values: unknown[]): void {
  const statement = database.query<never>(sql)
  try {
    statement.run(...values)
  } finally {
    statement.finalize()
  }
}
function count(database: SqliteDatabase, table: 'display_requests' | 'display_views'): number {
  const value = query<{ count: number }>(database, `SELECT count(*) AS count FROM ${table}`)[0]
    ?.count
  if (
    !Number.isSafeInteger(value) ||
    value === undefined ||
    value < 0 ||
    value >
      (table === 'display_requests'
        ? PRIVATE_DISPLAY_ARCHIVE_LIMITS.requests
        : PRIVATE_DISPLAY_ARCHIVE_LIMITS.targets)
  )
    unsafe()
  return value
}
function pragma(database: SqliteDatabase, name: string): number | undefined {
  const row = query<Record<string, number>>(database, `PRAGMA ${name}`)[0]
  return row && Object.values(row)[0]
}
function sameIdentity(a: BigIntStats, b: BigIntStats): boolean {
  return a.dev === b.dev && a.ino === b.ino
}
function requireDirectory(value: BigIntStats): void {
  if (
    !value.isDirectory() ||
    value.isSymbolicLink() ||
    value.uid !== BigInt(process.geteuid?.() ?? -1) ||
    (value.mode & 0o7777n) !== 0o700n
  )
    unsafe()
}
function requireFile(value: BigIntStats, device: bigint): void {
  if (
    !value.isFile() ||
    value.isSymbolicLink() ||
    value.nlink !== 1n ||
    value.uid !== BigInt(process.geteuid?.() ?? -1) ||
    (value.mode & 0o7777n) !== 0o600n ||
    value.dev !== device
  )
    unsafe()
}
function hasCode(error: unknown, code: string): boolean {
  return error !== null && typeof error === 'object' && 'code' in error && error.code === code
}
function checkDeadline(deadline?: number): void {
  if (deadline === undefined) return
  if (!Number.isSafeInteger(deadline) || deadline < 0)
    fail('INVALID', 'The display publication deadline is invalid.')
  if (privatePresentationNow() >= deadline)
    fail('DEADLINE', 'The display publication deadline has elapsed.')
}
function unsafe(): never {
  return fail('UNSAFE_STORE', 'Display storage has unsafe or changed data or filesystem identity.')
}
function fail(code: PrivateDisplayArchiveError['code'], message: string): never {
  throw new PrivateDisplayArchiveError(code, message)
}
