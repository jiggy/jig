import { Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'
import { spawn } from 'node:child_process'
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises'
import type { Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Duplex } from 'node:stream'
import type {
  AttemptObservation,
  AttemptResults,
  CanonicalRequest,
} from '../../src/attempt-contract.js'
import {
  completePrivateAttemptExportDelivery,
  initializePrivateActivationState,
  inspectPrivateAttempt,
  reconcilePrivateAttemptExportDelivery,
  releasePrivateAttemptExport,
} from '../../src/internal/activation-admission-store.js'
import { readPrivateAttemptClock } from '../../src/internal/attempt-clock.js'
import { copyPrivateAttemptExport } from '../../src/internal/attempt-export-copier.js'
import {
  type PrivateAttemptExportOwner,
  parsePrivateExportProcessStat,
  privateAttemptExportOwner,
  privateAttemptExportOwnerGone,
} from '../../src/internal/attempt-export-owner.js'
import { privateFileDeliveryConnection } from '../../src/internal/file-command.js'
import { PrivateFileDeliveryOwner } from '../../src/internal/file-delivery.js'
import { sha256 } from '../../src/internal/file-input.js'
import { privateDomainDigest } from '../../src/internal/identity.js'
import {
  attemptQuery,
  attemptWrite,
  authenticatePrivateAttempt,
  deletePrivateRetiredAttempts,
  persistPrivatePreparedAttempt,
  privateAttemptStorageBytes,
  reconcilePrivateAttemptExportOwners,
  reservePrivateAttemptExportMetadata,
  retirePrivateAttempts,
} from '../../src/internal/prepared-attempt-store.js'
import { canonicalJson, type JsonValue } from '../../src/json.js'

const digest = `sha256:${'a'.repeat(64)}`
const request: CanonicalRequest = {
  expectedApproval: digest,
  target: 'flow:flows/example',
  input: null,
  files: [],
  constraints: { durationMs: 1000, resultBytes: 1024, artifactBytes: 0 },
  outputIntent: { packet: true, receive: [] },
}
const written: AttemptResults['export'] = {
  destination: '/operator/packet',
  manifestDigest: digest,
  source: 'final',
}
function maintain(db: Database) {
  db.exec('BEGIN IMMEDIATE')
  try {
    reconcilePrivateAttemptExportOwners(db)
    db.exec('COMMIT')
  } catch (error) {
    if (db.inTransaction) db.exec('ROLLBACK')
    throw error
  }
}
async function ledger() {
  const root = await mkdtemp(join(tmpdir(), 'jig-export-ledger-'))
  await initializePrivateActivationState({ projectRoot: root })
  const database = join(root, '.jig', 'jig.sqlite3')
  const db = new Database(database)
  db.exec('PRAGMA foreign_keys = ON; PRAGMA synchronous = EXTRA')
  const information = await stat(root, { bigint: true })
  const project = privateDomainDigest('JIG-Prepared-Attempt-Project/1', {
    device: String(information.dev),
    inode: String(information.ino),
  })
  const clock = await readPrivateAttemptClock()
  db.exec('BEGIN IMMEDIATE')
  const prepared = persistPrivatePreparedAttempt(db, project, clock, request, [])
  db.exec('COMMIT')
  const nonce = authenticatePrivateAttempt(db, project, prepared.ticket).row!.nonce
  function pin(id: string, owner: PrivateAttemptExportOwner, destination = `/operator/${id}`) {
    const ownTransaction = !db.inTransaction
    if (ownTransaction) db.exec('BEGIN IMMEDIATE')
    attemptWrite(db, 'INSERT INTO attempt_export_pins VALUES (?1, ?2, ?3, ?4, 0)', [
      id,
      nonce,
      owner.bootId,
      clock.monotonicMs - 1,
    ])
    attemptWrite(db, 'INSERT INTO attempt_export_owners VALUES (?1, ?2)', [
      id,
      canonicalJson(owner as unknown as JsonValue),
    ])
    attemptWrite(
      db,
      "INSERT INTO attempt_export_deliveries VALUES (?1, ?2, ?3, 'final', '', ?1, 'active', NULL)",
      [id, nonce, destination],
    )
    if (ownTransaction) db.exec('COMMIT')
  }
  return {
    root,
    db,
    database,
    prepared,
    nonce,
    clock,
    pin,
    async close() {
      db.close(true)
      await rm(root, { recursive: true, force: true })
    },
  }
}

test('protected written evidence reconciles lost ACK without reading or overwriting the packet', async () => {
  const fixture = await ledger()
  try {
    fixture.pin('written', privateAttemptExportOwner(), written.destination)
    const scope = {
      projectRoot: fixture.root,
      ticket: fixture.prepared.ticket,
      destination: written.destination,
    }
    await expect(reconcilePrivateAttemptExportDelivery(scope)).rejects.toThrow('still owned')
    await completePrivateAttemptExportDelivery({
      projectRoot: fixture.root,
      pinId: 'written',
      status: 'written',
      result: written,
    })
    // The original caller never receives an ACK. A new operation returns the
    // protected original receipt; the destination does not even exist here.
    expect(await reconcilePrivateAttemptExportDelivery(scope)).toEqual(written)
    expect(
      await reconcilePrivateAttemptExportDelivery({ ...scope, destination: '/operator/new' }),
    ).toBeUndefined()
    expect(
      await reconcilePrivateAttemptExportDelivery({ ...scope, artifactResult: 'different' }),
    ).toBeUndefined()
    await expect(
      reconcilePrivateAttemptExportDelivery({ ...scope, ticket: fixture.prepared.ticket + 'x' }),
    ).rejects.toMatchObject({ code: 'TICKET_INVALID' })
    await completePrivateAttemptExportDelivery({
      projectRoot: fixture.root,
      pinId: 'written',
      status: 'unknown',
    })
    expect(await reconcilePrivateAttemptExportDelivery(scope)).toEqual(written)
    await releasePrivateAttemptExport({ projectRoot: fixture.root, pinId: 'written' })
    expect(await reconcilePrivateAttemptExportDelivery(scope)).toEqual(written)
    expect(attemptQuery(fixture.db, 'SELECT pin_id FROM attempt_export_pins')).toHaveLength(0)
  } finally {
    await fixture.close()
  }
}, 30_000)

test('expiry, reused PID generations and malformed identity never release a live copier pin; lookup is read-only', async () => {
  const fixture = await ledger()
  try {
    const owner = privateAttemptExportOwner()
    fixture.pin('live', owner)
    fixture.pin('reused', { ...owner, generation: String(BigInt(owner.generation) + 1n) })
    fixture.pin('uncertain', { ...owner, bootId: 'unverifiable' })
    await expect(
      completePrivateAttemptExportDelivery({
        projectRoot: fixture.root,
        pinId: 'reused',
        status: 'failed',
      }),
    ).rejects.toMatchObject({ code: 'IDENTITY_UNAVAILABLE' })
    const before = await readFile(fixture.database)
    await inspectPrivateAttempt({ projectRoot: fixture.root, ticket: fixture.prepared.ticket })
    expect(await readFile(fixture.database)).toEqual(before)
    maintain(fixture.db)
    expect(
      attemptQuery(fixture.db, 'SELECT pin_id FROM attempt_export_pins WHERE released = 0'),
    ).toHaveLength(3)
    expect(privateAttemptExportOwnerGone(owner)).toBeFalse()
    expect(privateAttemptExportOwnerGone({ ...owner, generation: 'invalid' })).toBeFalse()
  } finally {
    await fixture.close()
  }
}, 30_000)

test('actual copy-only process death retires all eight pins and preserves unknown publication independently', async () => {
  const fixture = await ledger()
  const helper = new URL('../../src/internal/attempt-export-owner.ts', import.meta.url).pathname
  const child = spawn(
    process.execPath,
    [
      '--eval',
      `import {privateAttemptExportOwner} from ${JSON.stringify(helper)}; console.log(JSON.stringify(privateAttemptExportOwner())); setInterval(()=>{},1000);`,
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  )
  const exited = new Promise<void>((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', () => resolve())
  })
  try {
    const owner = await new Promise<PrivateAttemptExportOwner>((resolve, reject) => {
      let text = ''
      const timer = setTimeout(() => reject(new Error('copy owner readiness timed out')), 5000)
      child.stdout.on('data', (bytes) => {
        text += bytes.toString()
        if (text.includes('\n')) {
          clearTimeout(timer)
          resolve(JSON.parse(text.trim()))
        }
      })
      child.once('error', reject)
    })
    fixture.db.exec('BEGIN IMMEDIATE')
    for (let index = 0; index < 8; index++) fixture.pin(`pin-${index}`, owner)
    fixture.db.exec('COMMIT')
    maintain(fixture.db)
    expect(attemptQuery(fixture.db, 'SELECT pin_id FROM attempt_export_pins')).toHaveLength(8)
    child.kill('SIGKILL')
    await exited
    expect(child.signalCode).toBe('SIGKILL')
    maintain(fixture.db)
    expect(attemptQuery(fixture.db, 'SELECT pin_id FROM attempt_export_pins')).toHaveLength(0)
    expect(
      attemptQuery(
        fixture.db,
        "SELECT status FROM attempt_export_deliveries WHERE status = 'unknown'",
      ),
    ).toHaveLength(8)
    await expect(
      reconcilePrivateAttemptExportDelivery({
        projectRoot: fixture.root,
        ticket: fixture.prepared.ticket,
        destination: '/operator/pin-0',
      }),
    ).rejects.toThrow('unknown')
  } finally {
    child.kill('SIGKILL')
    await exited
    await fixture.close()
  }
}, 30_000)

test('delivery metadata and pin headroom share protected storage accounting', async () => {
  const fixture = await ledger()
  try {
    const before = privateAttemptStorageBytes(fixture.db)
    const delivery = { nonce: fixture.nonce, destination: '/operator/charged', selection: '' }
    reservePrivateAttemptExportMetadata(fixture.db, delivery)
    fixture.pin('charged', privateAttemptExportOwner())
    expect(privateAttemptStorageBytes(fixture.db) - before).toBe(
      1024 ** 2 + 2 * 8192 + 3 * Buffer.byteLength(delivery.destination),
    )
    fixture.db.query('UPDATE prepared_attempts SET control_bytes = ?1').run(4 * 1024 ** 3)
    expect(() => reservePrivateAttemptExportMetadata(fixture.db, delivery)).toThrow('capacity')
    expect(
      attemptQuery(fixture.db, 'SELECT delivery_id FROM attempt_export_deliveries'),
    ).toHaveLength(1)
  } finally {
    await fixture.close()
  }
}, 30_000)

test('64 retained deliveries bound each Run, and ticket history GC removes the delivery ledger', async () => {
  const fixture = await ledger()
  try {
    fixture.db.exec('BEGIN IMMEDIATE')
    for (let index = 0; index < 64; index++)
      attemptWrite(
        fixture.db,
        "INSERT INTO attempt_export_deliveries VALUES (?1, ?2, ?3, 'final', '', 'spent', 'unknown', NULL)",
        [`delivery-${index}`, fixture.nonce, `/operator/${index}`],
      )
    fixture.db.exec('COMMIT')
    expect(() =>
      reservePrivateAttemptExportMetadata(fixture.db, {
        nonce: fixture.nonce,
        destination: '/operator/new',
        selection: '',
      }),
    ).toThrow('capacity')
    fixture.db.exec('BEGIN IMMEDIATE')
    retirePrivateAttempts(fixture.db, {
      ...fixture.clock,
      monotonicMs: fixture.clock.monotonicMs + 172_800_001,
      unixMs: fixture.clock.unixMs + 172_800_001,
    })
    fixture.db.exec('COMMIT')
    expect(
      attemptQuery(fixture.db, 'SELECT delivery_id FROM attempt_export_deliveries'),
    ).toHaveLength(64)
    fixture.db.exec('BEGIN IMMEDIATE')
    deletePrivateRetiredAttempts(fixture.db)
    fixture.db.exec('COMMIT')
    expect(
      attemptQuery(fixture.db, 'SELECT delivery_id FROM attempt_export_deliveries'),
    ).toHaveLength(0)
  } finally {
    await fixture.close()
  }
}, 30_000)

test('proc stat parsing uses field 22 after the complete parenthesized process name', () => {
  const fields = ['S', ...Array(49).fill('0')]
  fields[19] = '12345'
  expect(parsePrivateExportProcessStat(`42 (odd ) name\n) ${fields.join(' ')}\n`, 42)).toBe('12345')
  expect(() => parsePrivateExportProcessStat(`43 (wrong) ${fields.join(' ')}\n`, 42)).toThrow()
  expect(() => parsePrivateExportProcessStat('42 (short) S 0\n', 42)).toThrow()
})

function injectedStore(
  source: 'final' | 'checkpoint',
  status: 'succeeded' | 'failed' | 'lost' = 'succeeded',
) {
  const bytes = Buffer.from([0, 255, 128])
  const observation: AttemptObservation = {
    identity: 'accepted',
    dispatch: 'confirmed',
    cleanup: 'confirmed',
    receipt: {
      runId: digest,
      requestDigest: digest,
      acceptedAt: new Date().toISOString(),
      target: request.target,
      approval: digest,
      artifactResults: [],
    },
    terminal:
      status === 'succeeded'
        ? {
            status,
            resultDigest: digest,
            outcome: 'done',
            diagnostics: { stderr: '', stderrBytes: 0, stderrTruncated: false },
          }
        : status === 'failed'
          ? {
              status,
              code: 'EXECUTION_FAILED',
              message: 'known failure',
              diagnostics: { stderr: '', stderrBytes: 0, stderrTruncated: false },
            }
          : { status, code: 'COORDINATOR_LOST', message: 'known loss' },
  }
  let result: AttemptResults['export'] | undefined
  let acquired = 0,
    released = 0
  const outcomes: string[] = []
  const store = {
    async reconcile() {
      return result
    },
    async acquire() {
      acquired++
      const clock = await readPrivateAttemptClock()
      return {
        pinId: 'owned-pin',
        bootId: clock.bootId,
        deadlineMonotonicMs: clock.monotonicMs + 300_000,
        artifacts:
          source === 'final'
            ? {
                report: {
                  manifestDigest: digest,
                  files: [{ path: 'binary.bin', bytes, digest: sha256(bytes) }],
                  directories: ['empty'],
                },
              }
            : {},
        ...(source === 'checkpoint'
          ? {
              checkpoint: {
                record: {
                  sequence: 1,
                  digest,
                  evidence: { progress: true },
                  files: {},
                  manifest: [{ path: 'binary.bin', bytes: bytes.length, digest: sha256(bytes) }],
                  identity: { runId: digest, method: null, input: null },
                },
                files: [{ path: 'binary.bin', bytes, digest: sha256(bytes) }],
                directories: ['empty'],
              },
            }
          : {}),
        observation,
        output: { accepted: true },
      }
    },
    async complete(input: { status: string; result?: AttemptResults['export'] }) {
      outcomes.push(input.status)
      result = input.result
    },
    async release() {
      released++
    },
  }
  return {
    store: store as Parameters<typeof copyPrivateAttemptExport>[3],
    outcomes,
    counts: () => ({ acquired, released }),
  }
}

for (const source of ['final', 'checkpoint'] as const) {
  for (const status of source === 'final'
    ? (['succeeded'] as const)
    : (['failed', 'lost'] as const)) {
    test(`whole ${source} copier preserves ${status}, immutable binary bytes and no-replace publication`, async () => {
      const root = await mkdtemp(join(tmpdir(), 'jig-export-copy-'))
      const injected = injectedStore(source, status)
      const input = {
        projectRoot: root,
        ticket: 'private-test-ticket',
        destination: './packet',
        source,
      }
      try {
        const owner = new PrivateFileDeliveryOwner(new AbortController().signal)
        const result = await copyPrivateAttemptExport(input, owner, undefined, injected.store)
        expect(result.source).toBe(source)
        expect(result.destination).toBe(join(root, 'packet'))
        const packet = JSON.parse(await readFile(join(root, 'packet/result.json'), 'utf8'))
        expect(packet.status).toBe(status)
        expect(
          await readFile(
            join(root, `packet/files/${source === 'final' ? 'report/' : ''}binary.bin`),
          ),
        ).toEqual(Buffer.from([0, 255, 128]))
        expect(injected.outcomes).toEqual(['written'])
        expect(injected.counts()).toEqual({ acquired: 1, released: 1 })
        // Reconcile an ACK lost after protected commit. No second acquire,
        // capture or publication, even though the first owner is already closed.
        expect(await copyPrivateAttemptExport(input, owner, undefined, injected.store)).toEqual(
          result,
        )
        expect(injected.counts()).toEqual({ acquired: 1, released: 1 })
        const collision = injectedStore(source, status)
        await expect(
          copyPrivateAttemptExport(
            input,
            new PrivateFileDeliveryOwner(new AbortController().signal),
            undefined,
            collision.store,
          ),
        ).rejects.toThrow()
        expect(collision.outcomes).toEqual(['failed'])
        expect(collision.counts().released).toBe(1)
        expect((await readdir(root)).sort()).toEqual(['packet'])
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    })
  }
}

test('received outer abort records failed export and retires its pin without starting a destination', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jig-export-abort-'))
  const injected = injectedStore('final')
  const controller = new AbortController()
  const acquire = injected.store!.acquire
  injected.store!.acquire = async (input) => {
    const pin = await acquire(input)
    controller.abort()
    return pin
  }
  try {
    await expect(
      copyPrivateAttemptExport(
        {
          projectRoot: root,
          ticket: 'private',
          destination: 'packet',
        },
        new PrivateFileDeliveryOwner(controller.signal),
        controller.signal,
        injected.store,
      ),
    ).rejects.toThrow()
    expect(injected.outcomes).toEqual(['failed'])
    expect(injected.counts().released).toBe(1)
    expect(await readdir(root)).toEqual([])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('expired copy allocation does not publish, but original owner still explicitly retires its pin', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jig-export-expired-'))
  const injected = injectedStore('final')
  const acquire = injected.store!.acquire
  injected.store!.acquire = async (input) => {
    const pin = await acquire(input)
    return { ...pin, deadlineMonotonicMs: pin.deadlineMonotonicMs - 300_001 }
  }
  try {
    await expect(
      copyPrivateAttemptExport(
        {
          projectRoot: root,
          ticket: 'private',
          destination: 'packet',
        },
        new PrivateFileDeliveryOwner(new AbortController().signal),
        undefined,
        injected.store,
      ),
    ).rejects.toThrow()
    expect(injected.outcomes).toEqual(['failed'])
    expect(injected.counts().released).toBe(1)
    expect(await readdir(root)).toEqual([])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

class ExportSocket extends Duplex {
  readonly requests: Record<string, JsonValue>[] = []
  _read() {}
  _write(bytes: Buffer, _: string, done: () => void) {
    const value = JSON.parse(bytes.toString())
    this.requests.push(value)
    if (value.type === 'export-attempt')
      queueMicrotask(() =>
        this.push(Buffer.concat([canonicalJson({ ok: true, result: written }), Buffer.from('\n')])),
      )
    done()
  }
}
test('private unary export transport carries selection and abort without local descriptor or pin shortcuts', async () => {
  const socket = new ExportSocket()
  const connection = privateFileDeliveryConnection(socket as unknown as Socket, {
    platform: 'linux',
    socket: `jig-file-owner-${'0'.repeat(32)}`,
    token: '1'.repeat(64),
  })
  const controller = new AbortController()
  try {
    const operation = connection.exportAttempt!(
      {
        projectRoot: '/operator/project',
        ticket: 'private-ticket',
        destination: '/operator/packet',
        source: 'checkpoint',
      },
      controller.signal,
    )
    controller.abort()
    expect(await operation).toEqual(written)
    expect(socket.requests.map((value) => value.type)).toEqual(['export-attempt', 'cancel'])
    expect(socket.requests[0]!.input).toEqual({
      projectRoot: '/operator/project',
      ticket: 'private-ticket',
      destination: '/operator/packet',
      source: 'checkpoint',
    })
    expect(socket.requests[0]).not.toHaveProperty('output')
    expect(socket.requests[0]).not.toHaveProperty('pinId')
  } finally {
    connection.close()
    socket.destroy()
  }
})
