import { createHash, randomBytes } from 'node:crypto'
import {
  type AttemptErrorCode,
  type AttemptObservation,
  type AttemptReceipt,
  type CanonicalRequest,
  type Prepared,
  parseAttemptRequest,
} from '../attempt-contract.js'
import { attemptRequestDigest } from '../attempt-request-identity.js'
import { canonicalJson, decodeJson1, type JsonValue } from '../json.js'
import type { PrivateAttemptClock } from './attempt-clock.js'
import {
  type PrivateAttemptExportOwner,
  privateAttemptExportOwnerGone,
} from './attempt-export-owner.js'
import { type PrivateCapturedOutput, readPrivateCapturedOutput } from './captured-output.js'
import {
  type PrivateCapturedAttachment,
  privateAttachmentName,
  privateFilePath,
  sha256,
} from './file-input.js'
import { PRIVATE_FILE_LIMITS } from './file-input-policy.js'
import { privateDomainDigest } from './identity.js'
import { readPrivateCapturedInput } from './input-capture.js'
import {
  issuePrivateSubmissionTicket,
  openPrivateSubmissionTicket,
  type PrivateSubmissionTicketClaims,
} from './submission-ticket.js'

export const PRIVATE_ATTEMPT_VALIDITY_MS = 600_000
export const PRIVATE_ATTEMPT_RETENTION_MS = 172_800_000
const STORE_QUOTA = 4 * 1024 ** 3
const CONTROL_RESERVE = 32 * 1024 ** 2
const FINAL_CONTROL_MARGIN = 20 * 1024 ** 2
// Conservative row/index/page allowance, in addition to canonical request bytes.
const RECORD_HEADROOM = 64 * 1024
const BLOB_HEADROOM = 8192
const RESERVE_CHUNK = 1024 ** 2

/** One budget for retained bytes and still-outstanding reservations. Caller holds
 * the admission transaction. Retired but not yet deleted records still occupy it.
 * SQLite rollback journals require additional filesystem space; this logical
 * accounting does not promise writes through external ENOSPC or I/O failure. */
export function privateAttemptStorageBytes(db: AttemptDatabase): number {
  const records = attemptQuery<{ bytes: bigint }>(
    db,
    `
    SELECT coalesce(sum(input_bytes + length(request_bytes) + length(claims_bytes) +
      ?1 + coalesce(length(result_bytes), 0) + result_reserve +
      control_bytes + control_reserve), 0) AS bytes FROM prepared_attempts`,
    [RECORD_HEADROOM],
  )[0]!.bytes
  // Checkpoint record bytes and blob headroom already consume control_bytes;
  // only their payload bytes replace outstanding result reservation here.
  const blobs = attemptQuery<{ bytes: bigint }>(
    db,
    `
    SELECT coalesce(sum(
      CASE WHEN purpose IN ('checkpoint', 'checkpoint-record') THEN 0 ELSE ?1 END +
      CASE WHEN purpose IN ('input', 'checkpoint-record') THEN 0 ELSE length(content) END), 0)
      AS bytes FROM attempt_blobs`,
    [BLOB_HEADROOM],
  )[0]!.bytes
  const chunks = attemptQuery<{ count: bigint }>(
    db,
    'SELECT count(*) AS count FROM attempt_reservations',
  )[0]!.count
  const deliveries = attemptQuery<{ bytes: bigint }>(
    db,
    'SELECT coalesce(sum(?1 + ?2 + 3 * (length(CAST(destination AS BLOB)) + length(CAST(selection AS BLOB)))), 0) AS bytes FROM attempt_export_deliveries',
    [PRIVATE_EXPORT_DELIVERY_RESERVE, BLOB_HEADROOM],
  )[0]!.bytes
  const pins = attemptQuery<{ count: bigint }>(
    db,
    'SELECT count(*) AS count FROM attempt_export_pins',
  )[0]!.count
  return Number(
    records + blobs + chunks * BigInt(BLOB_HEADROOM) + deliveries + pins * BigInt(BLOB_HEADROOM),
  )
}
export const PRIVATE_EXPORT_DELIVERY_RESERVE = 1024 ** 2
export function reservePrivateAttemptExportMetadata(
  db: AttemptDatabase,
  delivery?: {
    readonly nonce: string
    readonly destination: string
    readonly selection: string
  },
): void {
  if (
    delivery !== undefined &&
    attemptQuery<{ count: bigint }>(
      db,
      'SELECT count(*) AS count FROM attempt_export_deliveries WHERE nonce = ?1',
      [delivery.nonce],
    )[0]!.count >= 64n
  )
    attemptRefuse('RESOURCE_EXHAUSTED', 'Export delivery capacity is exhausted.')
  // Reserve the bounded outcome BEFORE copying, plus the intent and its indexes.
  // Large operator strings must not disappear behind a fixed row allowance.
  requireStorage(
    db,
    BLOB_HEADROOM +
      (delivery === undefined
        ? 0
        : PRIVATE_EXPORT_DELIVERY_RESERVE +
          BLOB_HEADROOM +
          3 * (Buffer.byteLength(delivery.destination) + Buffer.byteLength(delivery.selection))),
  )
}
function requireStorage(db: AttemptDatabase, additional: number): void {
  if (privateAttemptStorageBytes(db) + additional > STORE_QUOTA)
    attemptRefuse('RESOURCE_EXHAUSTED', 'Protected attempt storage capacity is exhausted.')
}

function artifactMetadataReserve(request: CanonicalRequest): number {
  return (
    request.outputIntent.receive.length *
    (PRIVATE_FILE_LIMITS.entries * (PRIVATE_FILE_LIMITS.pathBytes * 6 + 256) +
      (PRIVATE_FILE_LIMITS.files + 1) * BLOB_HEADROOM)
  )
}

/** Charge serialized metadata growth and page/index overhead before its write.
 * Normal admission cannot spend the fencing/final-terminal margin. Cleanup
 * callers may consume that margin, but must still supply bounded evidence.
 * This is page reuse, not an exemption from rollback-journal I/O failures. */
export function consumePrivateAttemptControlReservation(
  db: AttemptDatabase,
  runId: string,
  bytes: number,
  cleanup = false,
): void {
  if (!Number.isSafeInteger(bytes) || bytes < 0)
    throw new Error('Invalid control reservation charge.')
  const row = attemptQuery<{ nonce: string; remaining: bigint; request_bytes: Uint8Array }>(
    db,
    'SELECT nonce, control_reserve AS remaining, request_bytes FROM prepared_attempts WHERE run_id = ?1',
    [runId],
  )[0]
  if (!row) return
  const protectedMargin = cleanup
    ? 0
    : FINAL_CONTROL_MARGIN +
      artifactMetadataReserve(decodeJson1(row.request_bytes) as unknown as CanonicalRequest)
  if (Number(row.remaining) - bytes < protectedMargin)
    attemptRefuse('RESOURCE_EXHAUSTED', 'Attempt control reservation is exhausted.')
  if (bytes === 0) return
  // Delete touched chunks before replacing the final remainder: SQLite would
  // otherwise allocate a replacement overflow chain before freeing its old one.
  // Every untouched control chunk and EVERY result chunk stays unchanged.
  const chunks = attemptQuery<{ part: bigint; bytes: bigint }>(
    db,
    'SELECT part, length(content) AS bytes FROM attempt_reservations WHERE nonce = ?1 AND purpose = ?2 ORDER BY part DESC LIMIT ?3',
    [row.nonce, 'control', Math.ceil(bytes / RESERVE_CHUNK) + 1],
  )
  let remaining = bytes
  for (const chunk of chunks) {
    if (remaining === 0) break
    attemptWrite(
      db,
      'DELETE FROM attempt_reservations WHERE nonce = ?1 AND purpose = ?2 AND part = ?3',
      [row.nonce, 'control', chunk.part],
    )
    const spent = Math.min(remaining, Number(chunk.bytes))
    remaining -= spent
    if (spent < Number(chunk.bytes))
      attemptWrite(db, 'INSERT INTO attempt_reservations VALUES (?1, ?2, ?3, zeroblob(?4))', [
        row.nonce,
        'control',
        chunk.part,
        Number(chunk.bytes) - spent,
      ])
  }
  if (remaining !== 0)
    attemptRefuse('UNAVAILABLE', 'Protected control reservation is inconsistent.')
  attemptWrite(
    db,
    'UPDATE prepared_attempts SET control_reserve = control_reserve - ?1, control_bytes = control_bytes + ?1 WHERE nonce = ?2',
    [bytes, row.nonce],
  )
}

/** Consume only in the transaction which replaces the reservation with terminal
 * records/artifacts. Rollback restores it; no intermediate commit can lose it.
 * Freed SQLite pages are reusable, but DELETE's rollback journal still needs
 * filesystem space for their original contents. */
export function consumePrivateAttemptReservation(db: AttemptDatabase, runId: string): void {
  attemptWrite(
    db,
    'DELETE FROM attempt_reservations WHERE nonce = (SELECT nonce FROM prepared_attempts WHERE run_id = ?1)',
    [runId],
  )
  attemptWrite(
    db,
    'UPDATE prepared_attempts SET result_reserve = 0, control_reserve = 0 WHERE run_id = ?1',
    [runId],
  )
}

function allocateReservation(
  db: AttemptDatabase,
  nonce: string,
  purpose: string,
  bytes: number,
): void {
  for (let part = 0, remaining = bytes; remaining > 0; part++) {
    const length = Math.min(remaining, RESERVE_CHUNK)
    attemptWrite(db, 'INSERT INTO attempt_reservations VALUES (?1, ?2, ?3, zeroblob(?4))', [
      nonce,
      purpose,
      part,
      length,
    ])
    remaining -= length
  }
}

/** Included in the admission database's exact schema, not a second job database. */
export const PRIVATE_ATTEMPT_SCHEMA = [
  [
    'attempt_blobs',
    'CREATE TABLE attempt_blobs (nonce TEXT NOT NULL REFERENCES prepared_attempts(nonce) ON DELETE CASCADE, purpose TEXT NOT NULL, name TEXT NOT NULL, path TEXT NOT NULL, digest TEXT NOT NULL, content BLOB NOT NULL, PRIMARY KEY (nonce, purpose, name, path)) STRICT',
  ],
  [
    'attempt_domain',
    'CREATE TABLE attempt_domain (singleton INTEGER PRIMARY KEY CHECK (singleton = 1), domain_id TEXT NOT NULL, key_bytes BLOB NOT NULL CHECK (length(key_bytes) = 32), issued_high_water INTEGER NOT NULL, retired_through INTEGER NOT NULL, clock_boot TEXT NOT NULL, clock_anchor INTEGER NOT NULL, wall_high_water INTEGER NOT NULL) STRICT',
  ],
  [
    'attempt_export_deliveries',
    "CREATE TABLE attempt_export_deliveries (delivery_id TEXT PRIMARY KEY, nonce TEXT NOT NULL REFERENCES prepared_attempts(nonce) ON DELETE CASCADE, destination TEXT NOT NULL, source TEXT NOT NULL CHECK (source IN ('final', 'checkpoint')), selection TEXT NOT NULL, pin_id TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('active', 'written', 'failed', 'unknown')), result_bytes BLOB CHECK (length(result_bytes) <= 1048576), UNIQUE (nonce, destination, source, selection)) STRICT",
  ],
  [
    'attempt_export_owners',
    'CREATE TABLE attempt_export_owners (pin_id TEXT PRIMARY KEY REFERENCES attempt_export_pins(pin_id) ON DELETE CASCADE, owner_bytes BLOB NOT NULL CHECK (length(owner_bytes) <= 1024)) STRICT',
  ],
  [
    'attempt_export_pins',
    'CREATE TABLE attempt_export_pins (pin_id TEXT PRIMARY KEY, nonce TEXT NOT NULL REFERENCES prepared_attempts(nonce), boot_id TEXT NOT NULL, deadline_ms INTEGER NOT NULL, released INTEGER NOT NULL CHECK (released IN (0, 1))) STRICT',
  ],
  [
    'attempt_reservations',
    "CREATE TABLE attempt_reservations (nonce TEXT NOT NULL REFERENCES prepared_attempts(nonce) ON DELETE CASCADE, purpose TEXT NOT NULL CHECK (purpose IN ('control', 'result')), part INTEGER NOT NULL CHECK (part >= 0), content BLOB NOT NULL CHECK (length(content) BETWEEN 1 AND 1048576), PRIMARY KEY (nonce, purpose, part)) STRICT",
  ],
  [
    'prepared_attempts',
    'CREATE TABLE prepared_attempts (nonce TEXT PRIMARY KEY, issued_ms INTEGER NOT NULL UNIQUE, claims_bytes BLOB NOT NULL, request_digest TEXT NOT NULL, request_bytes BLOB NOT NULL CHECK (length(request_bytes) BETWEEN 1 AND 1048576), input_bytes INTEGER NOT NULL, run_id TEXT UNIQUE REFERENCES root_runs(run_id), accepted_ms INTEGER, accepted_boot TEXT, deadline_monotonic_ms INTEGER, revoked INTEGER NOT NULL CHECK (revoked IN (0, 1)), retired INTEGER NOT NULL CHECK (retired IN (0, 1)), result_limit INTEGER NOT NULL, artifact_limit INTEGER NOT NULL, control_bytes INTEGER NOT NULL DEFAULT 0 CHECK (control_bytes >= 0), control_reserve INTEGER NOT NULL DEFAULT 0 CHECK (control_reserve >= 0), result_reserve INTEGER NOT NULL DEFAULT 0 CHECK (result_reserve >= 0), result_bytes BLOB, result_digest TEXT, CHECK ((run_id IS NULL) = (accepted_ms IS NULL)), CHECK ((run_id IS NULL) = (accepted_boot IS NULL)), CHECK ((run_id IS NULL) = (deadline_monotonic_ms IS NULL)), CHECK ((result_bytes IS NULL) = (result_digest IS NULL))) STRICT',
  ],
] as const

export interface AttemptDatabase {
  query<T>(sql: string): {
    safeIntegers(value: boolean): {
      get(...bindings: unknown[]): T | null
      all(...bindings: unknown[]): T[]
      run(...bindings: unknown[]): unknown
      finalize(): void
    }
  }
}
export function attemptQuery<T>(db: AttemptDatabase, sql: string, bindings: unknown[] = []): T[] {
  const query = db.query<T>(sql).safeIntegers(true)
  try {
    return query.all(...bindings)
  } finally {
    query.finalize()
  }
}
export function attemptWrite(db: AttemptDatabase, sql: string, bindings: unknown[] = []): void {
  const query = db.query<never>(sql).safeIntegers(true)
  try {
    query.run(...bindings)
  } finally {
    query.finalize()
  }
}
export class PrivateAttemptError extends Error {
  constructor(
    readonly code: AttemptErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'PrivateAttemptError'
  }
}
export function attemptRefuse(code: AttemptErrorCode, message: string): never {
  throw new PrivateAttemptError(code, message)
}
interface Domain {
  domain_id: string
  key_bytes: Uint8Array
  issued_high_water: bigint
  retired_through: bigint
  clock_boot: string
  clock_anchor: bigint
  wall_high_water: bigint
}
export interface PrivateAttemptRow {
  nonce: string
  issued_ms: bigint
  claims_bytes: Uint8Array
  request_digest: string
  request_bytes: Uint8Array
  input_bytes: bigint
  run_id: string | null
  accepted_ms: bigint | null
  revoked: bigint
  retired: bigint
  accepted_boot: string | null
  deadline_monotonic_ms: bigint | null
  result_limit: bigint
  artifact_limit: bigint
  result_bytes: Uint8Array | null
  result_digest: string | null
}
export interface PrivateAuthenticatedAttempt {
  readonly claims: PrivateSubmissionTicketClaims
  readonly row: PrivateAttemptRow | null
  readonly request?: CanonicalRequest
  readonly retired: boolean
}
function domain(db: AttemptDatabase): Domain | null {
  return attemptQuery<Domain>(db, 'SELECT * FROM attempt_domain WHERE singleton = 1')[0] ?? null
}
export function initializePrivateAttemptDomain(
  db: AttemptDatabase,
  clock: PrivateAttemptClock,
): void {
  if (domain(db) !== null) return
  attemptWrite(db, 'INSERT INTO attempt_domain VALUES (1, ?1, ?2, 0, 0, ?3, ?4, ?5)', [
    randomBytes(32).toString('hex'),
    randomBytes(32),
    clock.bootId,
    clock.monotonicMs,
    clock.unixMs,
  ])
}
export function privateAttemptRequest(value: CanonicalRequest): CanonicalRequest {
  const request = parseAttemptRequest('submit', {
    ticket: 'validation-only',
    request: value,
  }).request
  const files = request.files
    .map((file) => ({ ...file, port: privateAttachmentName(file.port) }))
    .sort((a, b) => (a.port < b.port ? -1 : a.port > b.port ? 1 : 0))
  if (new Set(files.map((file) => file.port)).size !== files.length)
    attemptRefuse('INVALID_REQUEST', 'Duplicate input port.')
  const receive = request.outputIntent.receive.map(privateAttachmentName).sort()
  if (new Set(receive).size !== receive.length)
    attemptRefuse('INVALID_REQUEST', 'Duplicate artifact-result name.')
  if (
    request.constraints.durationMs > 86_400_000 ||
    request.constraints.resultBytes > 1_048_576 ||
    request.constraints.artifactBytes > 268_435_456
  )
    attemptRefuse('RESOURCE_EXHAUSTED', 'Requested attempt bounds exceed the host limits.')
  const result = {
    ...request,
    files,
    outputIntent: { packet: request.outputIntent.packet, receive },
  }
  const bytes = canonicalJson(result as unknown as JsonValue)
  if (bytes.length > 1_048_576)
    attemptRefuse('RESOURCE_EXHAUSTED', 'Canonical request exceeds its bound.')
  return decodeJson1(bytes) as unknown as CanonicalRequest
}
export function privateAttemptRequestDigest(request: CanonicalRequest): string {
  return attemptRequestDigest(request)
}
export function privateAttemptManifestDigest(
  files: readonly { path: string; bytes: number; digest: string }[],
): string {
  return privateDomainDigest('JIG-Prepared-Attachment/1', files as unknown as JsonValue)
}
export function persistPrivatePreparedAttempt(
  db: AttemptDatabase,
  projectDigest: string,
  clock: PrivateAttemptClock,
  value: CanonicalRequest,
  captured: readonly PrivateCapturedAttachment[],
): Prepared {
  const request = privateAttemptRequest(value)
  initializePrivateAttemptDomain(db, clock)
  const identity = domain(db)!
  if (identity.clock_boot === clock.bootId && clock.monotonicMs < Number(identity.clock_anchor))
    attemptRefuse('UNAVAILABLE', 'Boot clock continuity is unavailable.')
  const count = attemptQuery<{ count: bigint }>(
    db,
    'SELECT count(*) AS count FROM prepared_attempts',
  )[0]!
  if (count.count >= 1024n)
    attemptRefuse('RESOURCE_EXHAUSTED', 'Attempt history capacity is exhausted.')
  const capturedPorts = new Set<string>()
  let inputBytes = 0
  const blobs: { name: string; path: string; contents: Uint8Array; digest: string }[] = []
  for (const attachment of captured) {
    const name = privateAttachmentName(attachment.name)
    if (capturedPorts.has(name)) attemptRefuse('INVALID_REQUEST', 'Duplicate captured port.')
    capturedPorts.add(name)
    const files = attachment.files
      .map((file) => {
        const path = privateFilePath(file.path)
        const contents = readPrivateCapturedInput(file.input)
        inputBytes += contents.length
        const digest = sha256(contents)
        blobs.push({ name, path, contents, digest })
        return { path, bytes: contents.length, digest }
      })
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    if (new Set(files.map((file) => file.path)).size !== files.length)
      attemptRefuse('INVALID_REQUEST', 'Duplicate captured path.')
    const expected = request.files.find((file) => file.port === name)
    if (
      !expected ||
      expected.bytes !== files.reduce((sum, file) => sum + file.bytes, 0) ||
      expected.manifestDigest !== privateAttemptManifestDigest(files)
    )
      attemptRefuse('REQUEST_CONFLICT', 'Captured inputs differ from the frozen request.')
  }
  if (capturedPorts.size !== request.files.length)
    attemptRefuse('REQUEST_CONFLICT', 'Captured inputs differ from the frozen request.')
  if (inputBytes > 268_435_456)
    attemptRefuse('RESOURCE_EXHAUSTED', 'Prepared input capacity is exhausted.')
  // Logical issuance time never regresses, even when the presentation clock does.
  const issuedUnixMs = Math.max(clock.unixMs, Number(identity.issued_high_water) + 1)
  const requestDigest = privateAttemptRequestDigest(request)
  const issued = issuePrivateSubmissionTicket(identity.key_bytes, {
    domainId: identity.domain_id,
    projectDigest,
    requestDigest,
    bootId: clock.bootId,
    issuedMonotonicMs: clock.monotonicMs,
    acceptBeforeMonotonicMs: clock.monotonicMs + PRIVATE_ATTEMPT_VALIDITY_MS,
    issuedUnixMs,
    retainUntilUnixMs: issuedUnixMs + PRIVATE_ATTEMPT_RETENTION_MS,
  })
  requireStorage(
    db,
    inputBytes +
      canonicalJson(request as unknown as JsonValue).length +
      canonicalJson(issued.claims as unknown as JsonValue).length +
      RECORD_HEADROOM +
      blobs.length * BLOB_HEADROOM,
  )
  attemptWrite(
    db,
    'UPDATE attempt_domain SET issued_high_water = ?1, wall_high_water = max(wall_high_water, ?2), clock_boot = ?3, clock_anchor = CASE WHEN clock_boot = ?3 THEN clock_anchor ELSE ?4 END WHERE singleton = 1',
    [issuedUnixMs, clock.unixMs, clock.bootId, clock.monotonicMs],
  )
  attemptWrite(
    db,
    'INSERT INTO prepared_attempts (nonce, issued_ms, claims_bytes, request_digest, request_bytes, input_bytes, revoked, retired, result_limit, artifact_limit) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, 0, ?7, ?8)',
    [
      issued.claims.ticketNonce,
      issuedUnixMs,
      canonicalJson(issued.claims as unknown as JsonValue),
      requestDigest,
      canonicalJson(request as unknown as JsonValue),
      inputBytes,
      request.constraints.resultBytes,
      request.constraints.artifactBytes,
    ],
  )
  for (const blob of blobs)
    attemptWrite(db, 'INSERT INTO attempt_blobs VALUES (?1, ?2, ?3, ?4, ?5, ?6)', [
      issued.claims.ticketNonce,
      'input',
      blob.name,
      blob.path,
      blob.digest,
      blob.contents,
    ])
  return {
    ticket: issued.ticket,
    requestDigest,
    submitBefore: new Date(clock.unixMs + PRIVATE_ATTEMPT_VALIDITY_MS).toISOString(),
    retainUntil: new Date(issued.claims.retainUntilUnixMs).toISOString(),
    canonicalRequest: request,
  }
}
export function authenticatePrivateAttempt(
  db: AttemptDatabase,
  projectDigest: string,
  ticket: string,
): PrivateAuthenticatedAttempt {
  const identity = domain(db)
  if (!identity) return attemptRefuse('IDENTITY_UNAVAILABLE', 'Attempt identity is unavailable.')
  let claims: PrivateSubmissionTicketClaims
  try {
    claims = openPrivateSubmissionTicket(identity.key_bytes, ticket, {
      domainId: identity.domain_id,
      projectDigest,
    })
  } catch {
    return attemptRefuse('TICKET_INVALID', 'Attempt ticket is invalid for this project.')
  }
  const row =
    attemptQuery<PrivateAttemptRow>(db, 'SELECT * FROM prepared_attempts WHERE nonce = ?1', [
      claims.ticketNonce,
    ])[0] ?? null
  if (!row) return { claims, row, retired: claims.issuedUnixMs <= Number(identity.retired_through) }
  if (
    !Buffer.from(row.claims_bytes).equals(canonicalJson(claims as unknown as JsonValue)) ||
    row.request_digest !== claims.requestDigest
  )
    return attemptRefuse('IDENTITY_UNAVAILABLE', 'Protected attempt identity is inconsistent.')
  const request = privateAttemptRequest(
    decodeJson1(row.request_bytes) as unknown as CanonicalRequest,
  )
  if (
    !Buffer.from(row.request_bytes).equals(canonicalJson(request as unknown as JsonValue)) ||
    privateAttemptRequestDigest(request) !== claims.requestDigest
  )
    return attemptRefuse('IDENTITY_UNAVAILABLE', 'Protected attempt request is inconsistent.')
  return { claims, row, request, retired: row.retired !== 0n }
}
export function requirePrivateAttemptMeaning(
  attempt: PrivateAuthenticatedAttempt,
  value: CanonicalRequest,
): void {
  const bytes = canonicalJson(privateAttemptRequest(value) as unknown as JsonValue)
  if (!attempt.row || !Buffer.from(attempt.row.request_bytes).equals(bytes))
    attemptRefuse(
      attempt.row ? 'REQUEST_CONFLICT' : 'IDENTITY_UNAVAILABLE',
      attempt.row
        ? 'Submission differs from the frozen request.'
        : 'Attempt identity is unavailable.',
    )
}
export function requirePrivateAttemptAcceptable(
  attempt: PrivateAuthenticatedAttempt,
  clock: PrivateAttemptClock,
): void {
  if (!attempt.row) attemptRefuse('IDENTITY_UNAVAILABLE', 'Attempt identity is unavailable.')
  if (attempt.row.run_id !== null) return
  if (
    attempt.retired ||
    attempt.row.revoked !== 0n ||
    clock.bootId !== attempt.claims.bootId ||
    clock.monotonicMs < attempt.claims.issuedMonotonicMs ||
    clock.monotonicMs >= attempt.claims.acceptBeforeMonotonicMs
  )
    attemptRefuse('TICKET_EXPIRED', 'Attempt is no longer open for acceptance.')
}
export function acceptPrivatePreparedAttempt(
  db: AttemptDatabase,
  attempt: PrivateAuthenticatedAttempt,
  runId: string,
  clock: PrivateAttemptClock,
): void {
  requirePrivateAttemptAcceptable(attempt, clock)
  const row = attempt.row!
  if (row.run_id !== null) return
  const active = attemptQuery<{ count: bigint }>(
    db,
    'SELECT count(*) AS count FROM prepared_attempts p WHERE p.run_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM root_terminals t WHERE t.run_id = p.run_id)',
  )[0]!.count
  if (active >= 8n) attemptRefuse('RESOURCE_EXHAUSTED', 'Accepted attempt capacity is exhausted.')
  const control = CONTROL_RESERVE + artifactMetadataReserve(attempt.request!)
  const result = Number(row.result_limit + row.artifact_limit)
  requireStorage(
    db,
    control +
      result +
      (Math.ceil(control / RESERVE_CHUNK) + Math.ceil(result / RESERVE_CHUNK)) * BLOB_HEADROOM,
  )
  // Real allocated control and result space, committed before the launch gate can be used.
  attemptWrite(
    db,
    'UPDATE prepared_attempts SET run_id = ?1, accepted_ms = ?2, control_reserve = ?3, result_reserve = ?4, accepted_boot = ?6, deadline_monotonic_ms = ?7 WHERE nonce = ?5 AND run_id IS NULL',
    [
      runId,
      clock.unixMs,
      control,
      result,
      row.nonce,
      clock.bootId,
      clock.monotonicMs + attempt.request!.constraints.durationMs,
    ],
  )
  allocateReservation(db, row.nonce, 'control', control)
  allocateReservation(db, row.nonce, 'result', result)
}
export function privateAttemptReceipt(attempt: PrivateAuthenticatedAttempt): AttemptReceipt {
  const row = attempt.row
  if (!row?.run_id || row.accepted_ms === null)
    return attemptRefuse('IDENTITY_UNAVAILABLE', 'Attempt has no accepted Run.')
  return {
    runId: row.run_id,
    requestDigest: row.request_digest,
    acceptedAt: new Date(Number(row.accepted_ms)).toISOString(),
    target: attempt.request!.target,
    approval: attempt.request!.expectedApproval,
    artifactResults: attempt.request!.outputIntent.receive.map((name) => ({
      name,
      availability: 'pending',
    })),
  }
}
export function readPrivateAttemptInputs(
  db: AttemptDatabase,
  attempt: PrivateAuthenticatedAttempt,
) {
  if (!attempt.row || !attempt.request) return []
  const blobs = attemptQuery<{ name: string; path: string; digest: string; content: Uint8Array }>(
    db,
    'SELECT name, path, digest, content FROM attempt_blobs WHERE nonce = ?1 AND purpose = ?2 ORDER BY name, path',
    [attempt.row.nonce, 'input'],
  )
  for (const blob of blobs)
    if (sha256(blob.content) !== blob.digest)
      attemptRefuse('IDENTITY_UNAVAILABLE', 'Protected input bytes are inconsistent.')
  return attempt.request.files.map((port) => {
    const files = blobs
      .filter((blob) => blob.name === port.port)
      .map((blob) => ({ path: blob.path, bytes: Buffer.from(blob.content) }))
    if (
      port.bytes !== files.reduce((sum, file) => sum + file.bytes.length, 0) ||
      port.manifestDigest !==
        privateAttemptManifestDigest(
          files.map((file) => ({
            path: file.path,
            bytes: file.bytes.length,
            digest: sha256(file.bytes),
          })),
        )
    )
      attemptRefuse('IDENTITY_UNAVAILABLE', 'Protected input manifest is inconsistent.')
    return { name: port.port, files }
  })
}
export function privateAttemptBaseObservation(
  attempt: PrivateAuthenticatedAttempt,
): AttemptObservation {
  if (!attempt.row)
    return {
      identity: attempt.retired ? 'retired' : 'unavailable',
      dispatch: 'possible',
      retained: 'unavailable',
      reason: 'IDENTITY_UNAVAILABLE',
    }
  if (attempt.row.run_id === null)
    return {
      identity: attempt.retired || attempt.row.revoked !== 0n ? 'retired' : 'prepared',
      dispatch: 'not-dispatched',
    }
  return {
    identity: 'accepted',
    receipt: privateAttemptReceipt(attempt),
    execution: 'accepted',
    dispatch: 'possible',
    cleanup: 'pending',
    retained: attempt.retired
      ? 'expired'
      : attempt.row.result_bytes === null
        ? 'unavailable'
        : 'available',
  }
}
export function privateAttemptResultDigest(bytes: Uint8Array): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`
}

/** Read-only availability policy. A reboot cannot prove elapsed time from the
 * previous boot: retain conservatively until a protected new-boot anchor has
 * itself covered the complete retention horizon. Clock loss hides bytes, not
 * independently validated execution or cleanup facts. */
export function privateAttemptRetentionState(
  db: AttemptDatabase,
  attempt: PrivateAuthenticatedAttempt,
  clock: PrivateAttemptClock | undefined,
): 'available' | 'expired' | 'unavailable' {
  if (attempt.retired) return 'expired'
  if (clock === undefined) return 'unavailable'
  const identity = domain(db)
  const anchor =
    clock.bootId === attempt.claims.bootId
      ? attempt.claims.issuedMonotonicMs
      : identity?.clock_boot === clock.bootId
        ? Number(identity.clock_anchor)
        : undefined
  if (anchor === undefined) return 'available'
  const elapsed = clock.monotonicMs - anchor
  if (elapsed < 0) return 'unavailable'
  return elapsed >= PRIVATE_ATTEMPT_RETENTION_MS ? 'expired' : 'available'
}

export function retainPrivateAttemptArtifacts(
  db: AttemptDatabase,
  runId: string,
  artifacts: Readonly<Record<string, PrivateCapturedOutput>>,
): void {
  const row = attemptQuery<PrivateAttemptRow>(
    db,
    'SELECT * FROM prepared_attempts WHERE run_id = ?1',
    [runId],
  )[0]
  if (!row) return
  const request = decodeJson1(row.request_bytes) as unknown as CanonicalRequest
  // Checkpoints and final selections spend the same accepted retained-artifact
  // allowance. Recheck inside terminal publication's transaction, not only in
  // the controller's earlier result admission.
  let total = Number(
    attemptQuery<{ bytes: bigint }>(
      db,
      "SELECT coalesce(sum(length(content)), 0) AS bytes FROM attempt_blobs WHERE nonce = ?1 AND purpose = 'checkpoint'",
      [row.nonce],
    )[0]!.bytes,
  )
  for (const [name, snapshot] of Object.entries(artifacts)) {
    if (!request.outputIntent.receive.includes(name)) continue
    const files = readPrivateCapturedOutput(snapshot)
    total += files.reduce((sum, file) => sum + file.contents.length, 0)
    if (total > Number(row.artifact_limit))
      attemptRefuse('RESOURCE_EXHAUSTED', 'Artifact result exceeds its reserved quota.')
    const manifest = canonicalJson({
      files: files.map((file) => ({ path: file.path, bytes: file.bytes, digest: file.digest })),
      directories: [...snapshot.directories],
    })
    const manifestDigest = privateAttemptResultDigest(manifest)
    const old = attemptQuery<{ digest: string }>(
      db,
      'SELECT digest FROM attempt_blobs WHERE nonce = ?1 AND purpose = ?2 AND name = ?3 AND path = ?4',
      [row.nonce, 'manifest', name, ''],
    )[0]
    if (old) {
      if (old.digest !== manifestDigest)
        attemptRefuse('REQUEST_CONFLICT', 'Retained artifact identity differs.')
      continue
    }
    attemptWrite(db, 'INSERT INTO attempt_blobs VALUES (?1, ?2, ?3, ?4, ?5, ?6)', [
      row.nonce,
      'manifest',
      name,
      '',
      manifestDigest,
      manifest,
    ])
    for (const file of files)
      attemptWrite(db, 'INSERT INTO attempt_blobs VALUES (?1, ?2, ?3, ?4, ?5, ?6)', [
        row.nonce,
        'artifact',
        name,
        file.path,
        file.digest,
        file.contents,
      ])
  }
}

export function retainedPrivateAttemptArtifacts(
  db: AttemptDatabase,
  attempt: PrivateAuthenticatedAttempt,
) {
  if (!attempt.row || !attempt.request) return []
  return attempt.request.outputIntent.receive.map((name) => {
    const manifest = attemptQuery<{ digest: string }>(
      db,
      'SELECT digest FROM attempt_blobs WHERE nonce = ?1 AND purpose = ?2 AND name = ?3 AND path = ?4',
      [attempt.row!.nonce, 'manifest', name, ''],
    )[0]
    return {
      name,
      ...(manifest ? { manifestDigest: manifest.digest } : {}),
      availability: attempt.retired
        ? ('expired' as const)
        : manifest
          ? ('available' as const)
          : ('unavailable' as const),
    }
  })
}

/** Retirement transaction, followed by a separately committed deletion transaction. */
export function retirePrivateAttempts(db: AttemptDatabase, clock: PrivateAttemptClock): void {
  reconcilePrivateAttemptExportOwners(db)
  const identity = domain(db)
  if (!identity) return
  if (clock.bootId !== identity.clock_boot) {
    attemptWrite(
      db,
      'UPDATE attempt_domain SET clock_boot = ?1, clock_anchor = ?2, wall_high_water = max(wall_high_water, ?3) WHERE singleton = 1',
      [clock.bootId, clock.monotonicMs, clock.unixMs],
    )
    return
  }
  if (clock.monotonicMs < Number(identity.clock_anchor)) return
  const rows = attemptQuery<PrivateAttemptRow>(
    db,
    'SELECT * FROM prepared_attempts ORDER BY issued_ms',
  )
  let through = Number(identity.retired_through)
  for (const row of rows) {
    const claims = decodeJson1(row.claims_bytes) as unknown as PrivateSubmissionTicketClaims
    const elapsed =
      claims.bootId === clock.bootId
        ? clock.monotonicMs - claims.issuedMonotonicMs
        : clock.monotonicMs - Number(identity.clock_anchor)
    const terminal =
      row.run_id === null
        ? null
        : attemptQuery<{ run_id: string }>(
            db,
            'SELECT run_id FROM root_terminals WHERE run_id = ?1',
            [row.run_id],
          )[0]
    const unresolved =
      row.run_id !== null &&
      (!terminal ||
        attemptQuery<{ count: bigint }>(
          db,
          'SELECT count(*) AS count FROM root_child_owners WHERE parent_run_id = ?1',
          [row.run_id],
        )[0]!.count !== 0n)
    const pinned =
      attemptQuery<{ count: bigint }>(
        db,
        'SELECT count(*) AS count FROM attempt_export_pins WHERE nonce = ?1 AND released = 0',
        [row.nonce],
      )[0]!.count !== 0n
    if (
      elapsed < PRIVATE_ATTEMPT_RETENTION_MS ||
      clock.unixMs < claims.retainUntilUnixMs ||
      unresolved ||
      pinned
    )
      break
    attemptWrite(db, 'UPDATE prepared_attempts SET retired = 1 WHERE nonce = ?1', [row.nonce])
    through = Number(row.issued_ms)
  }
  attemptWrite(
    db,
    'UPDATE attempt_domain SET retired_through = max(retired_through, ?1), wall_high_water = max(wall_high_water, ?2) WHERE singleton = 1',
    [through, clock.unixMs],
  )
}
/** Mutating maintenance only. Uncertain identity keeps its pin charged. */
export function reconcilePrivateAttemptExportOwners(db: AttemptDatabase): void {
  const owners = attemptQuery<{ pin_id: string; owner_bytes: Uint8Array }>(
    db,
    'SELECT o.pin_id, o.owner_bytes FROM attempt_export_owners o JOIN attempt_export_pins p ON p.pin_id = o.pin_id WHERE p.released = 0',
  )
  for (const owner of owners) {
    let identity: PrivateAttemptExportOwner
    try {
      identity = decodeJson1(owner.owner_bytes) as unknown as PrivateAttemptExportOwner
    } catch {
      continue
    }
    if (!privateAttemptExportOwnerGone(identity)) continue
    attemptWrite(
      db,
      "UPDATE attempt_export_deliveries SET status = 'unknown' WHERE pin_id = ?1 AND status = 'active'",
      [owner.pin_id],
    )
    attemptWrite(db, 'UPDATE attempt_export_pins SET released = 1 WHERE pin_id = ?1', [
      owner.pin_id,
    ])
  }
  attemptWrite(db, 'DELETE FROM attempt_export_pins WHERE released = 1')
}
export function deletePrivateRetiredAttempts(db: AttemptDatabase): void {
  // Rows from an early cancel stay until the domain watermark covers them.
  attemptWrite(db, 'DELETE FROM attempt_export_pins WHERE released = 1')
  const rows = attemptQuery<{ nonce: string; run_id: string | null }>(
    db,
    'SELECT nonce, run_id FROM prepared_attempts WHERE retired = 1 AND issued_ms <= (SELECT retired_through FROM attempt_domain WHERE singleton = 1) AND NOT EXISTS (SELECT 1 FROM attempt_export_pins p WHERE p.nonce = prepared_attempts.nonce)',
  )
  for (const row of rows) {
    if (row.run_id !== null) {
      const unresolved = attemptQuery<{ count: bigint }>(
        db,
        'SELECT count(*) AS count FROM root_child_owners WHERE parent_run_id = ?1',
        [row.run_id],
      )[0]!.count
      if (
        unresolved !== 0n ||
        attemptQuery(db, 'SELECT run_id FROM root_terminals WHERE run_id = ?1', [row.run_id])
          .length === 0
      )
        continue
    }
    attemptWrite(db, 'DELETE FROM prepared_attempts WHERE nonce = ?1', [row.nonce])
    if (row.run_id !== null) {
      // Original root history shares the ticket's retention, not a permanent
      // shadow ledger. Foreign keys prevent deletion of an outstanding loan.
      attemptWrite(db, 'DELETE FROM root_terminals WHERE run_id = ?1', [row.run_id])
      attemptWrite(db, 'DELETE FROM root_execution_lifecycles WHERE run_id = ?1', [row.run_id])
      attemptWrite(db, 'DELETE FROM root_spawn_intents WHERE run_id = ?1', [row.run_id])
      attemptWrite(db, 'DELETE FROM root_runs WHERE run_id = ?1', [row.run_id])
    }
  }
}
