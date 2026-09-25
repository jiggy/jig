import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { constants } from 'node:fs'
import { type FileHandle, open, realpath } from 'node:fs/promises'
import { join, posix } from 'node:path'
import { canonicalJson, type JsonObject, type JsonValue } from '../json.js'
import {
  mkdirPrivateFile,
  openPrivateChild,
  privateChildLocation,
  privateDirectoryEntries,
  rmdirPrivateFile,
  statPrivateChild,
  unlinkPrivateFile,
} from './descriptor-files.js'
import { privateDomainDigest } from './identity.js'
import { privateMacosRenameAt } from './macos-descriptor-files.js'
import {
  acquirePrivateMacosOwnerLock,
  type PrivateMacosOwnerLock,
  requirePrivateMacosOwnerLock,
} from './macos-owner-lock.js'

const DIRECTORY = constants.O_RDONLY | constants.O_DIRECTORY | 0x20000000 | 0x01000000
const MAX_RECORD_BYTES = 65_536
const NAME = /^[a-z0-9][a-z0-9-]{0,63}$/
const DIGEST = /^sha256:[0-9a-f]{64}$/
const NUMBER = /^(?:0|[1-9][0-9]*)$/
export interface PrivateMacosOwnerStateAllocationIdentity {
  readonly kind: 'private-macos-owner-state-allocation/1'
  readonly digest: string
  readonly parent: string
  readonly parentDevice: string
  readonly parentInode: string
  readonly name: string
  readonly directory: string
  readonly directoryDevice: string
  readonly directoryInode: string
  readonly controlDevice: string
  readonly controlInode: string
  readonly lockDevice: string
  readonly lockInode: string
  readonly ownerToken: string
}
export interface PrivateMacosBackendState {
  readonly kind: 'private-macos-backend-state/1'
  readonly allocationDigest: string
  readonly directoryDevice: string
  readonly directoryInode: string
  readonly lockDevice: string
  readonly lockInode: string
  readonly phase: 'allocated' | 'sealed' | 'active' | 'finished' | 'cancelled'
  readonly sealed: JsonObject | null
  readonly final: JsonObject | null
}
export interface PrivateMacosOwnerStateCancellation {
  readonly kind: 'private-macos-owner-state-cancellation/1'
  readonly digest: string
  readonly allocationDigest: string
  readonly directoryDevice: string
  readonly directoryInode: string
  readonly state: 'cancelled'
}
export interface PrivateMacosOwnerStateReleaseReceipt {
  readonly kind: 'private-macos-owner-state-release/1'
  readonly digest: string
  readonly allocationDigest: string
  readonly directoryDevice: string
  readonly directoryInode: string
  readonly released: true
}
function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).sort().join() !== [...keys].sort().join()
  )
    throw new TypeError('invalid native owner record')
  return value as Record<string, unknown>
}
const jsonObject = (value: unknown): value is JsonObject =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
const encoded = (value: unknown) => Buffer.from(canonicalJson(value as JsonValue))
function signature(token: string, value: unknown): Buffer {
  return createHmac('sha256', Buffer.from(token, 'hex'))
    .update('jig-macos-backend-state\0')
    .update(encoded(value))
    .digest()
}
function releaseSignature(token: string, value: unknown): Buffer {
  return createHmac('sha256', Buffer.from(token, 'hex'))
    .update('jig-macos-backend-release\0')
    .update(encoded(value))
    .digest()
}
const releaseName = (allocation: PrivateMacosOwnerStateAllocationIdentity) =>
  `.${allocation.name}.release`
function privateDirectory(info: Awaited<ReturnType<FileHandle['stat']>>) {
  if (
    !info.isDirectory() ||
    BigInt(info.nlink) === 0n ||
    BigInt(info.uid) !== BigInt(process.getuid!()) ||
    (BigInt(info.mode) & 0o077n) !== 0n
  )
    throw new Error('native execution state is not private')
}
export async function planPrivateMacosOwnerStateAllocation(location: {
  readonly parent: string
  readonly name: string
}): Promise<PrivateMacosOwnerStateAllocationIdentity> {
  if (
    !NAME.test(location.name) ||
    !location.parent.startsWith('/') ||
    (await realpath(location.parent)) !== location.parent
  )
    throw new TypeError('native execution allocation requires a canonical private parent')
  const parent = await open(location.parent, DIRECTORY)
  let root: FileHandle | undefined,
    control: FileHandle | undefined,
    lock: PrivateMacosOwnerLock | undefined,
    created = false
  let handlesClosed = false
  const closeHandles = async () => {
    if (handlesClosed) return
    handlesClosed = true
    const results = await Promise.allSettled([
      lock?.close(),
      control?.close(),
      root?.close(),
      parent.close(),
    ])
    const errors = results
      .filter((result) => result.status === 'rejected')
      .map((result) => result.reason)
    if (errors.length) throw new AggregateError(errors, 'native allocation closure failed')
  }
  try {
    const info = await parent.stat({ bigint: true })
    privateDirectory(info)
    try {
      await statPrivateChild(parent, `.${location.name}.release`)
      throw new Error('native execution allocation release is incomplete')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    await mkdirPrivateFile(privateChildLocation(parent, location.name))
    created = true
    root = await openPrivateChild(parent, location.name, DIRECTORY)
    const rootInfo = await root.stat({ bigint: true })
    privateDirectory(rootInfo)
    await mkdirPrivateFile(privateChildLocation(root, 'control'))
    control = await openPrivateChild(root, 'control', DIRECTORY)
    const controlInfo = await control.stat({ bigint: true })
    privateDirectory(controlInfo)
    lock = await acquirePrivateMacosOwnerLock(control)
    const fields = {
      kind: 'private-macos-owner-state-allocation/1' as const,
      parent: location.parent,
      parentDevice: String(info.dev),
      parentInode: String(info.ino),
      name: location.name,
      directory: join(location.parent, location.name),
      directoryDevice: String(rootInfo.dev),
      directoryInode: String(rootInfo.ino),
      controlDevice: String(controlInfo.dev),
      controlInode: String(controlInfo.ino),
      lockDevice: lock.identity.device,
      lockInode: lock.identity.inode,
      ownerToken: randomBytes(32).toString('hex'),
    }
    const allocation = Object.freeze({
      ...fields,
      digest: privateDomainDigest('JIG-Macos-Owner-Allocation/1', fields),
    })
    await closeHandles()
    return allocation
  } catch (error) {
    if (created) {
      const cleanup = async () => {
        await lock?.close()
        lock = undefined
        await control?.close()
        control = undefined
        await root?.close()
        root = undefined
        const reopened = await openPrivateChild(parent, location.name, DIRECTORY)
        try {
          const entries = []
          for await (const entry of privateDirectoryEntries(reopened)) entries.push(entry.name)
          if (entries.every((name) => ['control'].includes(name))) {
            if (entries.includes('control')) {
              const nested = await openPrivateChild(reopened, 'control', DIRECTORY)
              try {
                const names = []
                for await (const entry of privateDirectoryEntries(nested)) names.push(entry.name)
                if (!names.every((name) => name === 'coordinator.lock')) return
                if (names.includes('coordinator.lock'))
                  await unlinkPrivateFile(privateChildLocation(nested, 'coordinator.lock'))
              } finally {
                await nested.close()
              }
              await rmdirPrivateFile(privateChildLocation(reopened, 'control'))
            }
          } else return
        } finally {
          await reopened.close()
        }
        await rmdirPrivateFile(privateChildLocation(parent, location.name))
      }
      await cleanup().catch(() => undefined)
    }
    try {
      await closeHandles()
    } catch (closeError) {
      throw new AggregateError([error, closeError], 'native allocation failed')
    }
    throw error
  }
}
export function normalizePrivateMacosOwnerStateAllocationIdentity(
  value: unknown,
): PrivateMacosOwnerStateAllocationIdentity {
  const record = object(value, [
    'kind',
    'digest',
    'parent',
    'parentDevice',
    'parentInode',
    'name',
    'directory',
    'directoryDevice',
    'directoryInode',
    'controlDevice',
    'controlInode',
    'lockDevice',
    'lockInode',
    'ownerToken',
  ])
  if (
    record.kind !== 'private-macos-owner-state-allocation/1' ||
    typeof record.digest !== 'string' ||
    !DIGEST.test(record.digest) ||
    typeof record.parent !== 'string' ||
    !record.parent.startsWith('/') ||
    posix.normalize(record.parent) !== record.parent ||
    record.parent.includes('\0') ||
    typeof record.parentDevice !== 'string' ||
    !NUMBER.test(record.parentDevice) ||
    typeof record.parentInode !== 'string' ||
    !NUMBER.test(record.parentInode) ||
    typeof record.name !== 'string' ||
    !NAME.test(record.name) ||
    record.directory !== join(record.parent, record.name) ||
    typeof record.directoryDevice !== 'string' ||
    !NUMBER.test(record.directoryDevice) ||
    typeof record.directoryInode !== 'string' ||
    !NUMBER.test(record.directoryInode) ||
    typeof record.controlDevice !== 'string' ||
    !NUMBER.test(record.controlDevice) ||
    typeof record.controlInode !== 'string' ||
    !NUMBER.test(record.controlInode) ||
    typeof record.lockDevice !== 'string' ||
    !NUMBER.test(record.lockDevice) ||
    typeof record.lockInode !== 'string' ||
    !NUMBER.test(record.lockInode) ||
    typeof record.ownerToken !== 'string' ||
    !/^[0-9a-f]{64}$/.test(record.ownerToken)
  )
    throw new TypeError('invalid native owner allocation')
  const { digest, ...fields } = record
  if (digest !== privateDomainDigest('JIG-Macos-Owner-Allocation/1', fields as JsonObject))
    throw new TypeError('native allocation digest changed')
  return Object.freeze({ ...record }) as unknown as PrivateMacosOwnerStateAllocationIdentity
}

/** Hold this transaction through guardian admission/settlement, or through recovery.
 * Backend receipt validators own the meaning of sealed/final records; neither
 * their JSON nor a digest can substitute for this live exclusive transaction. */
export async function openPrivateMacosBackendState(
  value: PrivateMacosOwnerStateAllocationIdentity,
) {
  const allocation = normalizePrivateMacosOwnerStateAllocationIdentity(value)
  const parent = await open(allocation.parent, DIRECTORY)
  let root: FileHandle | undefined,
    control: FileHandle | undefined,
    lock: PrivateMacosOwnerLock | undefined
  let closed = false
  const close = async () => {
    if (closed) return
    closed = true
    const results = await Promise.allSettled([
      lock?.close(),
      control?.close(),
      root?.close(),
      parent.close(),
    ])
    const errors = results
      .filter((result) => result.status === 'rejected')
      .map((result) => result.reason)
    if (errors.length) throw new AggregateError(errors, 'native execution state closure failed')
  }
  try {
    const parentInfo = await parent.stat({ bigint: true })
    privateDirectory(parentInfo)
    if (
      String(parentInfo.dev) !== allocation.parentDevice ||
      String(parentInfo.ino) !== allocation.parentInode
    )
      throw new Error('native execution parent changed')
    root = await openPrivateChild(parent, allocation.name, DIRECTORY)
    const rootInfo = await root.stat({ bigint: true })
    privateDirectory(rootInfo)
    if (
      String(rootInfo.dev) !== allocation.directoryDevice ||
      String(rootInfo.ino) !== allocation.directoryInode
    )
      throw new Error('native execution allocation changed')
    control = await openPrivateChild(root, 'control', DIRECTORY)
    const controlInfo = await control.stat({ bigint: true })
    privateDirectory(controlInfo)
    if (
      String(controlInfo.dev) !== allocation.controlDevice ||
      String(controlInfo.ino) !== allocation.controlInode
    )
      throw new Error('native execution control changed')
    lock = await acquirePrivateMacosOwnerLock(control)
    if (
      lock.identity.device !== allocation.lockDevice ||
      lock.identity.inode !== allocation.lockInode
    )
      throw new Error('native execution lock changed')
    const fixed = {
      kind: 'private-macos-backend-state/1' as const,
      allocationDigest: allocation.digest,
      directoryDevice: String(rootInfo.dev),
      directoryInode: String(rootInfo.ino),
      lockDevice: lock.identity.device,
      lockInode: lock.identity.inode,
    }
    const verify = async () => {
      if (closed) throw new Error('native execution state is closed')
      await requirePrivateMacosOwnerLock(lock!)
      const named = await statPrivateChild(parent, allocation.name),
        held = await root!.stat({ bigint: true }),
        namedControl = await statPrivateChild(root!, 'control')
      privateDirectory(named)
      if (
        named.dev !== rootInfo.dev ||
        named.ino !== rootInfo.ino ||
        held.dev !== rootInfo.dev ||
        held.ino !== rootInfo.ino ||
        namedControl.dev !== controlInfo.dev ||
        namedControl.ino !== controlInfo.ino
      )
        throw new Error('native execution allocation changed')
    }
    const readFile = async (name: string): Promise<Buffer | undefined> => {
      let file: FileHandle
      try {
        file = await openPrivateChild(control!, name, constants.O_RDONLY)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
        throw error
      }
      try {
        const before = await file.stat({ bigint: true })
        if (
          !before.isFile() ||
          before.uid !== BigInt(process.getuid!()) ||
          before.nlink !== 1n ||
          (before.mode & 0o7777n) !== 0o600n ||
          before.size > BigInt(MAX_RECORD_BYTES)
        )
          throw new Error('native execution record is unsafe')
        const bytes = Buffer.alloc(Number(before.size))
        for (let offset = 0; offset < bytes.length; ) {
          const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset)
          if (!bytesRead) throw new Error('native execution record ended early')
          offset += bytesRead
        }
        const after = await file.stat({ bigint: true })
        if (
          before.size !== after.size ||
          before.mtimeNs !== after.mtimeNs ||
          before.ctimeNs !== after.ctimeNs ||
          after.nlink !== 1n
        )
          throw new Error('native execution record changed')
        return bytes
      } finally {
        await file.close()
      }
    }
    const read = async (): Promise<PrivateMacosBackendState | undefined> => {
      await verify()
      const bytes = await readFile('state.json')
      if (bytes === undefined) return undefined
      const envelope = object(JSON.parse(bytes.toString('utf8')), ['record', 'mac'])
      const state = object(envelope.record, [...Object.keys(fixed), 'phase', 'sealed', 'final'])
      if (
        typeof envelope.mac !== 'string' ||
        !/^[0-9a-f]{64}$/.test(envelope.mac) ||
        !timingSafeEqual(
          signature(allocation.ownerToken, state),
          Buffer.from(envelope.mac, 'hex'),
        ) ||
        Object.entries(fixed).some(([key, value]) => state[key] !== value) ||
        !['allocated', 'sealed', 'active', 'finished', 'cancelled'].includes(String(state.phase)) ||
        (state.sealed !== null && !jsonObject(state.sealed)) ||
        (state.final !== null && !jsonObject(state.final)) ||
        (['sealed', 'active', 'finished'].includes(String(state.phase)) && state.sealed === null) ||
        (state.phase === 'allocated' && state.sealed !== null) ||
        (state.phase === 'finished') !== (state.final !== null)
      )
        throw new Error('native execution record authentication failed')
      return Object.freeze(state) as unknown as PrivateMacosBackendState
    }
    const discardPending = async () => {
      if ((await readFile('state.pending')) !== undefined)
        await unlinkPrivateFile(privateChildLocation(control!, 'state.pending'))
    }
    const write = async (state: PrivateMacosBackendState) => {
      await verify()
      const bytes = encoded({
        record: state,
        mac: signature(allocation.ownerToken, state).toString('hex'),
      })
      if (bytes.length > MAX_RECORD_BYTES)
        throw new TypeError('native execution record exceeds its bound')
      const file = await openPrivateChild(
        control!,
        'state.pending',
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
      )
      try {
        await file.writeFile(bytes)
        await file.sync()
      } finally {
        await file.close()
      }
      await verify()
      privateMacosRenameAt(control!.fd, 'state.pending', control!.fd, 'state.json')
      await control!.sync()
    }
    const beginRelease = async (receipt: PrivateMacosOwnerStateReleaseReceipt) => {
      await verify()
      const marker = encoded({
        receipt,
        mac: releaseSignature(allocation.ownerToken, receipt).toString('hex'),
      })
      let existing = await readFileFrom(root!, 'release.json')
      if (existing === undefined) {
        const file = await openPrivateChild(
          root!,
          'release.json',
          constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
        )
        try {
          await file.writeFile(marker)
          await file.sync()
        } finally {
          await file.close()
        }
        await root!.sync()
        existing = marker
      }
      if (!existing.equals(marker)) throw new Error('native execution release marker conflicts')
      privateMacosRenameAt(parent.fd, allocation.name, parent.fd, releaseName(allocation), true)
      await parent.sync()
    }
    const current = await read()
    if (current === undefined) {
      for await (const entry of privateDirectoryEntries(root))
        if (entry.name !== 'control')
          throw new Error('uninitialized native owner contains unexpected state')
      for await (const entry of privateDirectoryEntries(control))
        if (!['coordinator.lock', 'state.pending'].includes(entry.name))
          throw new Error('uninitialized native control contains unexpected state')
    }
    // A pending write never authorizes dispatch. Under the exclusive lock it
    // belongs to an interrupted transaction, so recovery retains the last commit.
    await discardPending()
    if (current === undefined)
      await write({ ...fixed, phase: 'allocated', sealed: null, final: null })
    let changing = false
    const change = async (
      operation: 'seal' | 'admit' | 'cancel' | 'finish',
      payload?: JsonObject,
    ) => {
      if (changing) throw new Error('native execution state change already in progress')
      if (payload !== undefined)
        payload = JSON.parse(encoded(payload).toString('utf8')) as JsonObject
      changing = true
      try {
        const current = (await read())!
        if (operation === 'seal' && current.phase === 'allocated' && jsonObject(payload))
          await write({ ...current, phase: 'sealed', sealed: payload })
        else if (operation === 'admit' && current.phase === 'sealed')
          await write({ ...current, phase: 'active' })
        else if (operation === 'cancel' && ['allocated', 'sealed'].includes(current.phase))
          await write({ ...current, phase: 'cancelled' })
        else if (operation === 'finish' && current.phase === 'active' && jsonObject(payload))
          await write({ ...current, phase: 'finished', final: payload })
        else if (operation === 'cancel' && current.phase === 'cancelled') return
        else if (
          operation === 'finish' &&
          current.phase === 'finished' &&
          encoded(current.final).equals(encoded(payload))
        )
          return
        else throw new Error('native execution state transition is not permitted')
      } finally {
        changing = false
      }
    }
    return Object.freeze({
      allocation,
      controlPath: join(allocation.directory, 'control'),
      guardianDirectory: join(allocation.directory, 'control/guardian'),
      dataPath: join(allocation.directory, 'data'),
      close,
      async read() {
        const state = await read()
        if (state === undefined) throw new Error('native execution record disappeared')
        return state
      },
      seal: (owner: JsonObject) => change('seal', owner),
      admit: () => change('admit'),
      cancel: () => change('cancel'),
      finish: (receipt: JsonObject) => change('finish', receipt),
      beginRelease,
    })
  } catch (error) {
    await close()
    throw error
  }
}

async function readFileFrom(parent: FileHandle, name: string): Promise<Buffer | undefined> {
  let file: FileHandle
  try {
    file = await openPrivateChild(parent, name, constants.O_RDONLY)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
  try {
    const before = await file.stat({ bigint: true })
    if (
      !before.isFile() ||
      before.uid !== BigInt(process.getuid!()) ||
      before.nlink !== 1n ||
      (before.mode & 0o7777n) !== 0o600n ||
      before.size > BigInt(MAX_RECORD_BYTES)
    )
      throw new Error('native execution record is unsafe')
    const bytes = Buffer.alloc(Number(before.size))
    for (let offset = 0; offset < bytes.length; ) {
      const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset)
      if (!bytesRead) throw new Error('native execution record ended early')
      offset += bytesRead
    }
    const after = await file.stat({ bigint: true })
    if (
      before.size !== after.size ||
      before.mtimeNs !== after.mtimeNs ||
      before.ctimeNs !== after.ctimeNs ||
      after.nlink !== 1n
    )
      throw new Error('native execution record changed')
    return bytes
  } finally {
    await file.close()
  }
}

function cancellationFor(
  allocation: PrivateMacosOwnerStateAllocationIdentity,
): PrivateMacosOwnerStateCancellation {
  const fields = {
    kind: 'private-macos-owner-state-cancellation/1' as const,
    allocationDigest: allocation.digest,
    directoryDevice: allocation.directoryDevice,
    directoryInode: allocation.directoryInode,
    state: 'cancelled' as const,
  }
  return Object.freeze({
    ...fields,
    digest: privateDomainDigest('JIG-Macos-Owner-Cancellation/1', fields),
  })
}

export function normalizePrivateMacosOwnerStateCancellation(
  value: unknown,
): PrivateMacosOwnerStateCancellation {
  const record = object(value, [
    'kind',
    'digest',
    'allocationDigest',
    'directoryDevice',
    'directoryInode',
    'state',
  ])
  const fields = {
    kind: record.kind,
    allocationDigest: record.allocationDigest,
    directoryDevice: record.directoryDevice,
    directoryInode: record.directoryInode,
    state: record.state,
  }
  if (
    record.kind !== 'private-macos-owner-state-cancellation/1' ||
    record.state !== 'cancelled' ||
    typeof record.digest !== 'string' ||
    !DIGEST.test(record.digest) ||
    typeof record.allocationDigest !== 'string' ||
    !DIGEST.test(record.allocationDigest) ||
    typeof record.directoryDevice !== 'string' ||
    !NUMBER.test(record.directoryDevice) ||
    typeof record.directoryInode !== 'string' ||
    !NUMBER.test(record.directoryInode) ||
    record.digest !== privateDomainDigest('JIG-Macos-Owner-Cancellation/1', fields as JsonObject)
  )
    throw new TypeError('invalid native owner cancellation')
  return Object.freeze({
    ...fields,
    kind: 'private-macos-owner-state-cancellation/1' as const,
    state: 'cancelled' as const,
    digest: record.digest,
  }) as PrivateMacosOwnerStateCancellation
}

function releaseFor(
  allocation: PrivateMacosOwnerStateAllocationIdentity,
): PrivateMacosOwnerStateReleaseReceipt {
  const fields = {
    kind: 'private-macos-owner-state-release/1' as const,
    allocationDigest: allocation.digest,
    directoryDevice: allocation.directoryDevice,
    directoryInode: allocation.directoryInode,
    released: true as const,
  }
  return Object.freeze({
    ...fields,
    digest: privateDomainDigest('JIG-Macos-Owner-Release/1', fields),
  })
}

export function normalizePrivateMacosOwnerStateReleaseReceipt(
  value: unknown,
): PrivateMacosOwnerStateReleaseReceipt {
  const record = object(value, [
    'kind',
    'digest',
    'allocationDigest',
    'directoryDevice',
    'directoryInode',
    'released',
  ])
  const fields = {
    kind: record.kind,
    allocationDigest: record.allocationDigest,
    directoryDevice: record.directoryDevice,
    directoryInode: record.directoryInode,
    released: record.released,
  }
  if (
    record.kind !== 'private-macos-owner-state-release/1' ||
    record.released !== true ||
    typeof record.digest !== 'string' ||
    !DIGEST.test(record.digest) ||
    typeof record.allocationDigest !== 'string' ||
    !DIGEST.test(record.allocationDigest) ||
    typeof record.directoryDevice !== 'string' ||
    !NUMBER.test(record.directoryDevice) ||
    typeof record.directoryInode !== 'string' ||
    !NUMBER.test(record.directoryInode) ||
    record.digest !== privateDomainDigest('JIG-Macos-Owner-Release/1', fields as JsonObject)
  )
    throw new TypeError('invalid native owner release receipt')
  return Object.freeze({
    ...fields,
    kind: 'private-macos-owner-state-release/1' as const,
    released: true as const,
    digest: record.digest,
  }) as PrivateMacosOwnerStateReleaseReceipt
}

export async function cancelPrivateMacosOwnerStateAllocation(
  value: unknown,
): Promise<PrivateMacosOwnerStateCancellation> {
  const allocation = normalizePrivateMacosOwnerStateAllocationIdentity(value)
  const state = await openPrivateMacosBackendState(allocation)
  try {
    await state.cancel()
    if ((await state.read()).phase !== 'cancelled')
      throw new Error('native execution cancellation is unconfirmed')
    return cancellationFor(allocation)
  } finally {
    await state.close()
  }
}

export async function releasePrivateMacosOwnerState(
  value: unknown,
  proof: PrivateMacosOwnerStateCancellation | JsonObject,
): Promise<PrivateMacosOwnerStateReleaseReceipt> {
  const allocation = normalizePrivateMacosOwnerStateAllocationIdentity(value)
  const receipt = releaseFor(allocation)
  const parent = await open(allocation.parent, DIRECTORY)
  try {
    const info = await parent.stat({ bigint: true })
    privateDirectory(info)
    if (String(info.dev) !== allocation.parentDevice || String(info.ino) !== allocation.parentInode)
      throw new Error('native execution parent changed')
    let original = true
    try {
      await statPrivateChild(parent, allocation.name)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      original = false
    }
    if (original) {
      const state = await openPrivateMacosBackendState(allocation)
      try {
        const current = await state.read()
        if (current.phase === 'cancelled') {
          const cancellation = normalizePrivateMacosOwnerStateCancellation(proof)
          if (
            cancellation.allocationDigest !== allocation.digest ||
            cancellation.directoryDevice !== allocation.directoryDevice ||
            cancellation.directoryInode !== allocation.directoryInode
          )
            throw new TypeError('native cancellation does not match allocation')
        } else if (
          current.phase !== 'finished' ||
          current.final === null ||
          !jsonObject(proof) ||
          !encoded(current.final).equals(encoded(proof))
        ) {
          throw new Error('native execution owner is not releasable')
        }
        await state.beginRelease(receipt)
      } finally {
        await state.close()
      }
    }
    await cleanupRelease(parent, allocation, receipt)
    return receipt
  } finally {
    await parent.close()
  }
}

async function cleanupRelease(
  parent: FileHandle,
  allocation: PrivateMacosOwnerStateAllocationIdentity,
  receipt: PrivateMacosOwnerStateReleaseReceipt,
) {
  let root: FileHandle
  try {
    root = await openPrivateChild(parent, releaseName(allocation), DIRECTORY)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  try {
    const info = await root.stat({ bigint: true })
    privateDirectory(info)
    if (
      String(info.dev) !== allocation.directoryDevice ||
      String(info.ino) !== allocation.directoryInode
    )
      throw new Error('native release allocation changed')
    const rootEntries = []
    for await (const entry of privateDirectoryEntries(root)) rootEntries.push(entry.name)
    const marker = await readFileFrom(root, 'release.json')
    if (marker === undefined) {
      if (rootEntries.length !== 0) throw new Error('native release marker disappeared')
    } else {
      const envelope = object(JSON.parse(marker.toString('utf8')), ['receipt', 'mac'])
      const recorded = normalizePrivateMacosOwnerStateReleaseReceipt(envelope.receipt)
      if (
        !encoded(recorded).equals(encoded(receipt)) ||
        typeof envelope.mac !== 'string' ||
        !/^[0-9a-f]{64}$/.test(envelope.mac) ||
        !timingSafeEqual(
          releaseSignature(allocation.ownerToken, recorded),
          Buffer.from(envelope.mac, 'hex'),
        )
      )
        throw new Error('native release marker authentication failed')
      if (!rootEntries.every((name) => ['control', 'release.json'].includes(name)))
        throw new Error('native release contains unexpected state')
      if (rootEntries.includes('control')) {
        const control = await openPrivateChild(root, 'control', DIRECTORY)
        try {
          const controlInfo = await control.stat({ bigint: true })
          privateDirectory(controlInfo)
          if (
            String(controlInfo.dev) !== allocation.controlDevice ||
            String(controlInfo.ino) !== allocation.controlInode
          )
            throw new Error('native release control changed')
          const names = []
          for await (const entry of privateDirectoryEntries(control)) names.push(entry.name)
          if (!names.every((name) => ['coordinator.lock', 'state.json'].includes(name)))
            throw new Error('native release control contains unexpected state')
          for (const name of names) await unlinkPrivateFile(privateChildLocation(control, name))
        } finally {
          await control.close()
        }
        await rmdirPrivateFile(privateChildLocation(root, 'control'))
      }
      await unlinkPrivateFile(privateChildLocation(root, 'release.json'))
      await root.sync()
    }
  } finally {
    await root.close()
  }
  await rmdirPrivateFile(privateChildLocation(parent, releaseName(allocation)))
  await parent.sync()
}
