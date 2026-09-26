import { createHmac, timingSafeEqual } from 'node:crypto'
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, posix } from 'node:path'
import {
  privateMacosDirectory,
  privateMacosStatAt,
  privateMacosUnlinkAt,
} from './macos-descriptor-files.js'
import {
  type PrivateMacosCoalitionControl,
  requirePrivateMacosCoalition,
} from './macos-process-controls.js'

const O_NOFOLLOW_ANY = 0x20000000
const O_CLOEXEC = 0x01000000
const handles = new WeakMap<object, PrivateMacosCoalitionControl['identity']>()
const tokenPattern = /^[0-9a-f]{64}$/

export function privateMacosStorageRecoveryToken(token: string): string {
  if (!tokenPattern.test(token)) throw new TypeError('invalid macOS ownership token')
  return createHmac('sha256', Buffer.from(token, 'hex'))
    .update('jig-macos-storage-recovery')
    .digest('hex')
}

/** After authenticated fencing, job removal and socket cleanup, reuse only this
 * fixed private recovery slot. No old journal is erased while a job can run. */
export function resetPrivateMacosRecoveryState(directory: string): void {
  if (!directory.endsWith('/recovery')) throw new Error('invalid macOS recovery slot')
  const fd = privateDirectory(directory)
  try {
    const entries = privateMacosDirectory(fd)
    const names: string[] = []
    try {
      for (;;) {
        const entry = entries.readSync()
        if (entry === null) break
        const name = new TextDecoder('utf-8', { fatal: true }).decode(entry.name)
        if (!['owner.json', 'sockets.json', 'guardian.plist'].includes(name))
          throw new Error('macOS recovery slot contains unexpected state')
        const info = privateMacosStatAt(fd, name)
        if (
          !info.isFile() ||
          info.uid !== BigInt(process.getuid!()) ||
          info.nlink !== 1n ||
          (info.mode & 0o777n) !== 0o600n ||
          info.size > 16_384n
        )
          throw new Error('macOS recovery slot is unsafe')
        names.push(name)
      }
    } finally {
      entries.closeSync()
    }
    for (const name of names) privateMacosUnlinkAt(fd, name)
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}

/** Minted only by authenticating a protected durable journal, never by decoding JSON. */
export interface PrivateMacosRecoveryOwner {
  readonly identity: PrivateMacosCoalitionControl['identity']
}

function privateDirectory(path: string): number {
  if (process.platform !== 'darwin' || !path.startsWith('/') || realpathSync(path) !== path)
    throw new Error('macOS ownership requires a canonical protected directory')
  const fd = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY | O_NOFOLLOW_ANY | O_CLOEXEC)
  const stat = fstatSync(fd)
  if (!stat.isDirectory() || stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0) {
    closeSync(fd)
    throw new Error('macOS ownership directory is not private')
  }
  return fd
}

export function requirePrivateMacosOwnerDirectory(path: string): void {
  closeSync(privateDirectory(path))
}

function signature(token: string, identity: unknown, domain = 'jig-macos-owner'): Buffer {
  if (!tokenPattern.test(token)) throw new TypeError('invalid macOS ownership token')
  return createHmac('sha256', Buffer.from(token, 'hex'))
    .update(`${domain}\0`)
    .update(JSON.stringify(identity))
    .digest()
}

/** Caller keeps this directory outside every sandbox grant and the token in protected admission state. */
export function recordPrivateMacosOwner(
  directory: string,
  token: string,
  control: PrivateMacosCoalitionControl,
): PrivateMacosRecoveryOwner {
  const owner = requirePrivateMacosCoalition(control)
  if (!owner.empty()) throw new Error('macOS ownership must be durable before creating descendants')
  const identity = owner.identity
  const mac = signature(token, identity).toString('hex')
  const parent = privateDirectory(directory)
  let fd: number | undefined
  try {
    fd = openSync(
      join(directory, 'owner.json'),
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | O_NOFOLLOW_ANY | O_CLOEXEC,
      0o600,
    )
    writeFileSync(fd, `${JSON.stringify({ identity, mac })}\n`)
    fsyncSync(fd)
    fsyncSync(parent)
  } finally {
    if (fd !== undefined) closeSync(fd)
    closeSync(parent)
  }
  return readPrivateMacosOwner(directory, token)
}

function readRecord(
  directory: string,
  name: 'owner.json' | 'sockets.json',
): Record<string, unknown> {
  const parent = privateDirectory(directory)
  let fd: number | undefined
  try {
    fd = openSync(join(directory, name), constants.O_RDONLY | O_NOFOLLOW_ANY | O_CLOEXEC)
    const before = fstatSync(fd, { bigint: true })
    if (
      !before.isFile() ||
      before.uid !== BigInt(process.getuid?.() ?? -1) ||
      (before.mode & 0o177n) !== 0n ||
      before.nlink !== 1n ||
      before.size < 1n ||
      before.size > 1024n
    )
      throw new Error('macOS ownership journal is unsafe')
    const buffer = Buffer.alloc(1025)
    let count = 0
    while (count < buffer.length) {
      const read = readSync(fd, buffer, count, buffer.length - count, count)
      if (read === 0) break
      count += read
    }
    if (BigInt(count) !== before.size) throw new Error('macOS ownership journal size changed')
    const bytes = buffer.subarray(0, count)
    const after = fstatSync(fd, { bigint: true })
    if (
      before.size !== after.size ||
      before.mtimeNs !== after.mtimeNs ||
      before.ctimeNs !== after.ctimeNs ||
      after.nlink !== 1n
    )
      throw new Error('macOS ownership journal changed')
    const record = JSON.parse(bytes.toString('utf8')) as Record<string, unknown>
    if (
      record === null ||
      typeof record !== 'object' ||
      Object.keys(record).sort().join() !== 'identity,mac'
    )
      throw new Error('invalid macOS ownership journal')
    return record
  } finally {
    if (fd !== undefined) closeSync(fd)
    closeSync(parent)
  }
}

export function readPrivateMacosOwner(directory: string, token: string): PrivateMacosRecoveryOwner {
  if (!tokenPattern.test(token)) throw new TypeError('invalid macOS ownership token')
  const record = readRecord(directory, 'owner.json')
  const raw = record.identity as Record<string, unknown>
  if (
    raw === null ||
    typeof raw !== 'object' ||
    Object.keys(raw).sort().join() !== 'bootId,coalition,guardianPid,guardianVersion' ||
    typeof raw.bootId !== 'string' ||
    !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(raw.bootId) ||
    typeof raw.coalition !== 'string' ||
    !/^[1-9][0-9]{0,19}$/.test(raw.coalition) ||
    BigInt(raw.coalition) > 0xffffffffffffffffn ||
    !Number.isSafeInteger(raw.guardianPid) ||
    (raw.guardianPid as number) <= 1 ||
    (raw.guardianPid as number) > 0x7fffffff ||
    !Number.isSafeInteger(raw.guardianVersion) ||
    (raw.guardianVersion as number) < 0 ||
    (raw.guardianVersion as number) > 0xffffffff ||
    typeof record.mac !== 'string' ||
    !tokenPattern.test(record.mac)
  )
    throw new Error('invalid macOS ownership identity')
  const identity = Object.freeze({
    bootId: raw.bootId,
    coalition: raw.coalition,
    guardianPid: raw.guardianPid as number,
    guardianVersion: raw.guardianVersion as number,
  })
  if (!timingSafeEqual(signature(token, identity), Buffer.from(record.mac, 'hex')))
    throw new Error('macOS ownership authentication failed')
  const handle = Object.freeze({ identity })
  handles.set(handle, identity)
  return handle
}

export function requirePrivateMacosRecoveryOwner(
  value: unknown,
): PrivateMacosRecoveryOwner['identity'] {
  const identity = value !== null && typeof value === 'object' ? handles.get(value) : undefined
  if (identity === undefined) throw new TypeError('macOS recovery ownership is not authentic')
  return identity
}

/** Bind ephemeral control paths to their allocation before registering the job. */
export function recordPrivateMacosSockets(
  ownerDirectory: string,
  token: string,
  directory: string,
): void {
  const sockets = privateDirectory(directory)
  const parent = privateDirectory(ownerDirectory)
  let fd: number | undefined
  try {
    if (!/^\/private\/tmp\/jig-native-[A-Za-z0-9]{6}$/.test(directory))
      throw new Error('invalid macOS control allocation')
    const stat = fstatSync(sockets, { bigint: true })
    const identity = { directory, device: String(stat.dev), inode: String(stat.ino) }
    const mac = signature(token, identity, 'jig-macos-sockets').toString('hex')
    fd = openSync(
      join(ownerDirectory, 'sockets.json'),
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | O_NOFOLLOW_ANY | O_CLOEXEC,
      0o600,
    )
    writeFileSync(fd, `${JSON.stringify({ identity, mac })}\n`)
    fsyncSync(fd)
    fsyncSync(parent)
  } finally {
    if (fd !== undefined) closeSync(fd)
    closeSync(parent)
    closeSync(sockets)
  }
}

/** Call only after kernel fencing; remove exact socket names, never a decoded tree recursively. */
export function removePrivateMacosSockets(ownerDirectory: string, token: string): void {
  const record = readRecord(ownerDirectory, 'sockets.json')
  const raw = record.identity as Record<string, unknown>
  if (
    raw === null ||
    typeof raw !== 'object' ||
    Object.keys(raw).sort().join() !== 'device,directory,inode' ||
    typeof raw.directory !== 'string' ||
    !/^\/private\/tmp\/jig-native-[A-Za-z0-9]{6}$/.test(raw.directory) ||
    typeof raw.device !== 'string' ||
    !/^[0-9]{1,20}$/.test(raw.device) ||
    typeof raw.inode !== 'string' ||
    !/^[1-9][0-9]{0,19}$/.test(raw.inode) ||
    typeof record.mac !== 'string' ||
    !tokenPattern.test(record.mac)
  )
    throw new Error('invalid macOS control allocation')
  const identity = { directory: raw.directory, device: raw.device, inode: raw.inode }
  if (
    !timingSafeEqual(
      signature(token, identity, 'jig-macos-sockets'),
      Buffer.from(record.mac, 'hex'),
    )
  )
    throw new Error('macOS control allocation authentication failed')
  let fd: number
  try {
    fd = privateDirectory(identity.directory)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  try {
    const stat = fstatSync(fd, { bigint: true })
    if (String(stat.dev) !== identity.device || String(stat.ino) !== identity.inode)
      throw new Error('macOS control allocation identity changed')
    for (const name of ['c', 'c.in', 'c.out', 'c.err', 'fd-output', 'fd-inputs']) {
      const path = join(identity.directory, name)
      try {
        const entry = lstatSync(path)
        if (!entry.isSocket() || entry.uid !== process.getuid?.() || entry.nlink !== 1)
          throw new Error('macOS control allocation contains an unexpected entry')
        unlinkSync(path)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    }
    rmdirSync(identity.directory)
  } finally {
    closeSync(fd)
  }
}

/** Retire only fixed guardian journals after the caller has independently proved
 * job removal, coalition fencing and storage cleanup. A missing owner journal is
 * accepted only for setup that failed before the guardian recorded descendants. */
export function releasePrivateMacosGuardianRecords(directory: string, token: string): void {
  let fd: number
  try {
    fd = privateDirectory(directory)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  let identity: Readonly<{ device: string; inode: string }>
  try {
    const info = fstatSync(fd, { bigint: true })
    identity = Object.freeze({ device: String(info.dev), inode: String(info.ino) })
    const entries = privateMacosDirectory(fd)
    const names: string[] = []
    try {
      for (;;) {
        const entry = entries.readSync()
        if (entry === null) break
        names.push(new TextDecoder('utf-8', { fatal: true }).decode(entry.name))
      }
    } finally {
      entries.closeSync()
    }
    if (!names.every((name) => ['owner.json', 'sockets.json', 'guardian.plist'].includes(name)))
      throw new Error('macOS guardian contains unexpected state')
    if (names.includes('owner.json')) readPrivateMacosOwner(directory, token)
    if (names.includes('sockets.json')) {
      removePrivateMacosSockets(directory, token)
      privateMacosUnlinkAt(fd, 'sockets.json')
    }
    if (names.includes('guardian.plist')) {
      const plist = privateMacosStatAt(fd, 'guardian.plist')
      if (
        !plist.isFile() ||
        plist.uid !== BigInt(process.getuid!()) ||
        plist.nlink !== 1n ||
        (plist.mode & 0o777n) !== 0o600n ||
        plist.size < 1n ||
        plist.size > 16_384n
      )
        throw new Error('macOS guardian launch record is unsafe')
      privateMacosUnlinkAt(fd, 'guardian.plist')
    }
    if (names.includes('owner.json')) privateMacosUnlinkAt(fd, 'owner.json')
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  const parent = privateDirectory(dirname(directory))
  try {
    const name = posix.basename(directory)
    const current = privateMacosStatAt(parent, name)
    if (String(current.dev) !== identity!.device || String(current.ino) !== identity!.inode)
      throw new Error('macOS guardian directory changed before release')
    privateMacosUnlinkAt(parent, name, true)
    fsyncSync(parent)
  } finally {
    closeSync(parent)
  }
}
