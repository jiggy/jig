import { createHmac, timingSafeEqual } from 'node:crypto'
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  openSync,
  readSync,
  realpathSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import {
  type PrivateMacosCoalitionControl,
  requirePrivateMacosCoalition,
} from './macos-process-controls.js'

const O_NOFOLLOW_ANY = 0x20000000
const O_CLOEXEC = 0x01000000
const handles = new WeakMap<object, PrivateMacosCoalitionControl['identity']>()
const tokenPattern = /^[0-9a-f]{64}$/

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

function signature(token: string, identity: PrivateMacosCoalitionControl['identity']): Buffer {
  if (!tokenPattern.test(token)) throw new TypeError('invalid macOS ownership token')
  return createHmac('sha256', Buffer.from(token, 'hex'))
    .update('jig-macos-owner\0')
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

export function readPrivateMacosOwner(directory: string, token: string): PrivateMacosRecoveryOwner {
  if (!tokenPattern.test(token)) throw new TypeError('invalid macOS ownership token')
  const parent = privateDirectory(directory)
  let fd: number | undefined
  try {
    fd = openSync(join(directory, 'owner.json'), constants.O_RDONLY | O_NOFOLLOW_ANY | O_CLOEXEC)
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
  } finally {
    if (fd !== undefined) closeSync(fd)
    closeSync(parent)
  }
}

export function requirePrivateMacosRecoveryOwner(
  value: unknown,
): PrivateMacosRecoveryOwner['identity'] {
  const identity = value !== null && typeof value === 'object' ? handles.get(value) : undefined
  if (identity === undefined) throw new TypeError('macOS recovery ownership is not authentic')
  return identity
}
