import { canonicalJson, decodeJson1, type JsonValue } from '../json.js'
import { type PrivateCapturedOutput, readPrivateCapturedOutput } from './captured-output.js'
import { privateFilePath, sha256 } from './file-input.js'
import {
  type AttemptDatabase,
  attemptQuery,
  attemptRefuse,
  attemptWrite,
  consumePrivateAttemptControlReservation,
  type PrivateAttemptRow,
} from './prepared-attempt-store.js'
import {
  parseRunCheckpointInput,
  type RetainedRunCheckpoint,
  RUN_CHECKPOINT_LIMITS,
  type RunCheckpointIdentity,
} from './private-run-checkpoint.js'

function resizePrivateAttemptCheckpointReservation(
  db: AttemptDatabase,
  row: PrivateAttemptRow,
  previous: number,
  next: number,
): void {
  const delta = next - previous
  const current = Number(
    attemptQuery<{ bytes: bigint }>(
      db,
      'SELECT result_reserve AS bytes FROM prepared_attempts WHERE nonce = ?1',
      [row.nonce],
    )[0]!.bytes,
  )
  if (delta > current)
    attemptRefuse('RESOURCE_EXHAUSTED', 'Checkpoint artifact reservation is exhausted.')
  if (delta > 0) {
    const chunks = attemptQuery<{ part: bigint; bytes: bigint }>(
      db,
      "SELECT part, length(content) AS bytes FROM attempt_reservations WHERE nonce = ?1 AND purpose = 'result' ORDER BY part DESC",
      [row.nonce],
    )
    let remaining = delta
    for (const chunk of chunks) {
      if (remaining === 0) break
      attemptWrite(
        db,
        "DELETE FROM attempt_reservations WHERE nonce = ?1 AND purpose = 'result' AND part = ?2",
        [row.nonce, chunk.part],
      )
      const spent = Math.min(remaining, Number(chunk.bytes))
      remaining -= spent
      if (spent < Number(chunk.bytes))
        attemptWrite(
          db,
          "INSERT INTO attempt_reservations VALUES (?1, 'result', ?2, zeroblob(?3))",
          [row.nonce, chunk.part, Number(chunk.bytes) - spent],
        )
    }
    if (remaining !== 0) attemptRefuse('UNAVAILABLE', 'Checkpoint reservation is inconsistent.')
  } else if (delta < 0) {
    const last = attemptQuery<{ part: bigint; bytes: bigint }>(
      db,
      "SELECT part, length(content) AS bytes FROM attempt_reservations WHERE nonce = ?1 AND purpose = 'result' ORDER BY part DESC LIMIT 1",
      [row.nonce],
    )[0]
    let remaining = -delta
    if (last && last.bytes < 1048576n) {
      const restored = Math.min(remaining, 1048576 - Number(last.bytes))
      attemptWrite(
        db,
        "DELETE FROM attempt_reservations WHERE nonce = ?1 AND purpose = 'result' AND part = ?2",
        [row.nonce, last.part],
      )
      attemptWrite(db, "INSERT INTO attempt_reservations VALUES (?1, 'result', ?2, zeroblob(?3))", [
        row.nonce,
        last.part,
        Number(last.bytes) + restored,
      ])
      remaining -= restored
    }
    for (let index = last ? Number(last.part) + 1 : 0; remaining > 0; index++) {
      const bytes = Math.min(1048576, remaining)
      attemptWrite(db, "INSERT INTO attempt_reservations VALUES (?1, 'result', ?2, zeroblob(?3))", [
        row.nonce,
        index,
        bytes,
      ])
      remaining -= bytes
    }
  }
  attemptWrite(
    db,
    'UPDATE prepared_attempts SET result_reserve = result_reserve - ?1 WHERE nonce = ?2',
    [delta, row.nonce],
  )
}

/** Caller holds the original admission owner's transaction. No history or second owner. */
export function retainPrivateAttemptCheckpoint(
  db: AttemptDatabase,
  runId: string,
  identity: RunCheckpointIdentity,
  value: unknown,
  artifacts: Readonly<Record<string, PrivateCapturedOutput>> = {},
): RetainedRunCheckpoint {
  const row = attemptQuery<PrivateAttemptRow>(
    db,
    'SELECT * FROM prepared_attempts WHERE run_id = ?1',
    [runId],
  )[0]
  if (!row || row.retired !== 0n || identity.runId !== runId)
    return attemptRefuse('IDENTITY_UNAVAILABLE', 'Checkpoint attempt is unavailable.')
  if (attemptQuery(db, 'SELECT run_id FROM root_terminals WHERE run_id = ?1', [runId]).length !== 0)
    attemptRefuse('UNAVAILABLE', 'Checkpoint Run is terminal.')
  const input = parseRunCheckpointInput(value)
  const names = Object.keys(input.artifacts ?? {}).sort()
  if (names.join('\0') !== Object.keys(artifacts).sort().join('\0'))
    throw new TypeError('checkpoint associations require authentic held snapshots')
  const files: { path: string; contents: Uint8Array; digest: string }[] = Object.entries(
    input.files,
  ).map(([path, text]) => {
    const contents = Buffer.from(text)
    return { path, contents, digest: sha256(contents) }
  })
  const associations: Record<string, JsonValue> = {}
  for (const name of names) {
    const snapshot = artifacts[name]!
    const members = readPrivateCapturedOutput(snapshot)
    associations[name] = {
      reference: input.artifacts![name]!,
      directories: snapshot.directories.map((path) => privateFilePath(`artifacts/${name}/${path}`)),
      files: members.map((file) => ({ path: file.path, bytes: file.bytes, digest: file.digest })),
    }
    for (const file of members)
      files.push({
        path: privateFilePath(`artifacts/${name}/${file.path}`),
        contents: file.contents,
        digest: file.digest,
      })
  }
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  const directories = new Set(
    Object.values(associations).flatMap(
      (value) => (value as { directories: string[] }).directories,
    ),
  )
  for (const name of names) directories.add(`artifacts/${name}`)
  for (const path of [...files.map((file) => file.path), ...directories]) {
    const parts = path.split('/')
    for (let count = 1; count < parts.length; count++)
      directories.add(privateFilePath(parts.slice(0, count).join('/')))
  }
  if (directories.size + files.length > 256)
    attemptRefuse('RESOURCE_EXHAUSTED', 'Checkpoint exceeds its tree entry capacity.')
  const finalBytes = Number(
    attemptQuery<{ bytes: bigint }>(
      db,
      "SELECT coalesce(sum(length(content)), 0) AS bytes FROM attempt_blobs WHERE nonce = ?1 AND purpose = 'artifact'",
      [row.nonce],
    )[0]!.bytes,
  )
  if (
    files.length > RUN_CHECKPOINT_LIMITS.files ||
    files.reduce((sum, file) => sum + file.contents.length, 0) >
      Math.min(16 * 1024 ** 2, Number(row.artifact_limit) - finalBytes)
  )
    attemptRefuse('RESOURCE_EXHAUSTED', 'Checkpoint exceeds aggregate artifact capacity.')
  const record = {
    identity,
    ...input,
    associations,
    manifest: files.map((file) => ({
      path: file.path,
      bytes: file.contents.length,
      digest: file.digest,
    })),
  }
  const digest = sha256(canonicalJson(record as unknown as JsonValue))
  const latest = readPrivateAttemptCheckpoint(db, runId)
  if (
    latest &&
    !Buffer.from(canonicalJson(latest.identity as unknown as JsonValue)).equals(
      canonicalJson(identity as unknown as JsonValue),
    )
  )
    attemptRefuse('REQUEST_CONFLICT', 'Checkpoint identity differs from its accepted Run.')
  if (latest && input.sequence === latest.sequence) {
    if (latest.digest !== digest)
      attemptRefuse('REQUEST_CONFLICT', 'Checkpoint sequence differs from the accepted aggregate.')
    return latest
  }
  if (input.sequence !== (latest?.sequence ?? 0) + 1)
    attemptRefuse('REQUEST_CONFLICT', 'Checkpoint sequence must advance by one.')
  if (
    attemptQuery(db, 'SELECT pin_id FROM attempt_export_pins WHERE nonce = ?1 AND released = 0', [
      row.nonce,
    ]).length !== 0
  )
    attemptRefuse('UNAVAILABLE', 'Checkpoint replacement has an active export loan.')
  const retained = { ...record, digest }
  const bytes = canonicalJson(retained as unknown as JsonValue)
  const previous = Number(
    attemptQuery<{ bytes: bigint }>(
      db,
      "SELECT coalesce(sum(length(content)), 0) AS bytes FROM attempt_blobs WHERE nonce = ?1 AND purpose = 'checkpoint'",
      [row.nonce],
    )[0]!.bytes,
  )
  const next = files.reduce((sum, file) => sum + file.contents.length, 0)
  resizePrivateAttemptCheckpointReservation(db, row, previous, next)
  // Metadata spends the existing control allocation; never a per-save side budget.
  consumePrivateAttemptControlReservation(db, runId, bytes.length + (files.length + 1) * 8192)
  // Transaction rollback preserves the complete previous aggregate on any failure.
  attemptWrite(
    db,
    "DELETE FROM attempt_blobs WHERE nonce = ?1 AND purpose IN ('checkpoint', 'checkpoint-record')",
    [row.nonce],
  )
  attemptWrite(db, 'INSERT INTO attempt_blobs VALUES (?1, ?2, ?3, ?4, ?5, ?6)', [
    row.nonce,
    'checkpoint-record',
    '',
    '',
    sha256(bytes),
    bytes,
  ])
  for (const file of files)
    attemptWrite(db, 'INSERT INTO attempt_blobs VALUES (?1, ?2, ?3, ?4, ?5, ?6)', [
      row.nonce,
      'checkpoint',
      '',
      file.path,
      file.digest,
      file.contents,
    ])
  return retained
}

/** Pure lookup: never acquires a coordinator, launches recovery, or rewrites terminal facts. */
export function readPrivateAttemptCheckpoint(
  db: AttemptDatabase,
  runId: string,
): RetainedRunCheckpoint | undefined {
  const row = attemptQuery<{ content: Uint8Array; digest: string }>(
    db,
    `SELECT b.content, b.digest FROM attempt_blobs b JOIN prepared_attempts p ON p.nonce = b.nonce
     WHERE p.run_id = ?1 AND p.retired = 0 AND b.purpose = 'checkpoint-record'`,
    [runId],
  )[0]
  if (!row) return undefined
  if (sha256(row.content) !== row.digest)
    return attemptRefuse('UNAVAILABLE', 'Protected checkpoint metadata is inconsistent.')
  const record = decodeJson1(row.content) as unknown as RetainedRunCheckpoint
  parseRunCheckpointInput({
    sequence: record.sequence,
    evidence: record.evidence,
    files: record.files,
    ...(record.artifacts === undefined ? {} : { artifacts: record.artifacts }),
  })
  if (record.identity.runId !== runId)
    return attemptRefuse('UNAVAILABLE', 'Protected checkpoint Run differs.')
  const { digest, ...content } = record
  if (sha256(canonicalJson(content as unknown as JsonValue)) !== digest)
    return attemptRefuse('UNAVAILABLE', 'Protected checkpoint digest differs.')
  return record
}

/** Verified immutable byte copies; caller must hold an export pin across publication. */
export function readPrivateAttemptCheckpointFiles(db: AttemptDatabase, runId: string) {
  const record = readPrivateAttemptCheckpoint(db, runId)
  if (!record) return undefined
  const rows = attemptQuery<{ path: string; digest: string; content: Uint8Array }>(
    db,
    `SELECT b.path, b.digest, b.content FROM attempt_blobs b JOIN prepared_attempts p ON p.nonce = b.nonce
     WHERE p.run_id = ?1 AND b.purpose = 'checkpoint' ORDER BY b.path`,
    [runId],
  )
  if (rows.length !== record.manifest?.length)
    return attemptRefuse('UNAVAILABLE', 'Protected checkpoint files are unavailable.')
  const files = record.manifest.map((file) => {
    const row = rows.find((row) => row.path === file.path)
    if (
      !row ||
      row.digest !== file.digest ||
      row.content.length !== file.bytes ||
      sha256(row.content) !== file.digest
    )
      return attemptRefuse('UNAVAILABLE', 'Protected checkpoint bytes are inconsistent.')
    return {
      path: privateFilePath(file.path),
      bytes: Buffer.from(row.content),
      digest: file.digest,
    }
  })
  const directories = new Set(
    Object.values(record.associations ?? {}).flatMap(
      (value) => (value as { directories: string[] }).directories,
    ),
  )
  for (const name of Object.keys(record.associations ?? {})) directories.add(`artifacts/${name}`)
  for (const path of [...files.map((file) => file.path), ...directories]) {
    const parts = path.split('/')
    for (let count = 1; count < parts.length; count++)
      directories.add(parts.slice(0, count).join('/'))
  }
  return { record, files, directories: [...directories].sort() }
}
