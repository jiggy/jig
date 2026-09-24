import { execFile } from 'node:child_process'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { type BigIntStats, constants } from 'node:fs'
import { type FileHandle, open, realpath } from 'node:fs/promises'
import { dirname, join, posix } from 'node:path'
import {
  privateMacosDirectory,
  privateMacosFilesystem,
  privateMacosOpenAt,
  privateMacosStatAt,
  privateMacosUnlinkAt,
} from './macos-descriptor-files.js'
import { privateMacosCurrentProcessIdentity } from './macos-process-controls.js'

const OPEN_DIRECTORY = constants.O_RDONLY | constants.O_DIRECTORY | 0x20000000 | 0x01000000
const HEX = /^[0-9a-f]{64}$/
const INTEGER = /^(0|[1-9][0-9]{0,19})$/
const MIB = 1024 * 1024
const IMAGE = 'volume.dmg'
const INTENT = 'volume.json'
const IMAGE_RECORD = 'volume-image.json'

interface Identity {
  readonly device: string
  readonly inode: string
}
interface Allocation {
  readonly control: Identity
  readonly mount: Identity & { readonly path: string }
  readonly bytes: number
}
interface ImageIdentity extends Identity {
  readonly allocationMac: string
}

function identity(stat: BigIntStats): Identity {
  return { device: String(stat.dev), inode: String(stat.ino) }
}
function matches(stat: BigIntStats, value: Identity): boolean {
  return String(stat.dev) === value.device && String(stat.ino) === value.inode
}
function isIdentity(value: unknown): value is Identity {
  if (value === null || typeof value !== 'object') return false
  const raw = value as Identity
  return (
    typeof raw.device === 'string' &&
    INTEGER.test(raw.device) &&
    typeof raw.inode === 'string' &&
    INTEGER.test(raw.inode) &&
    raw.inode !== '0'
  )
}
function capacity(bytes: number): void {
  if (!Number.isSafeInteger(bytes) || bytes < 16 * MIB || bytes > 512 * MIB || bytes % MIB !== 0)
    throw new TypeError('macOS volume capacity is outside its finite profile')
}
function canonical(path: string): void {
  if (
    typeof path !== 'string' ||
    !path.startsWith('/') ||
    posix.normalize(path) !== path ||
    path === '/' ||
    Buffer.byteLength(path) > 900 ||
    [...path].some(
      (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    ) ||
    Buffer.from(path).toString('utf8') !== path
  )
    throw new TypeError('macOS volume requires a canonical private path')
}

async function privateDirectory(path: string): Promise<FileHandle> {
  privateMacosCurrentProcessIdentity()
  canonical(path)
  if ((await realpath(path)) !== path) throw new Error('macOS volume directory is aliased')
  const directory = await open(path, OPEN_DIRECTORY)
  try {
    const stat = await directory.stat({ bigint: true })
    if (
      !stat.isDirectory() ||
      stat.uid !== BigInt(process.getuid!()) ||
      (stat.mode & 0o777n) !== 0o700n
    )
      throw new Error('macOS volume directory is not private')
    return directory
  } catch (error) {
    await directory.close()
    throw error
  }
}

async function sameDirectory(path: string, expected: Identity): Promise<void> {
  const directory = await privateDirectory(path)
  try {
    if (!matches(await directory.stat({ bigint: true }), expected))
      throw new Error('macOS volume directory identity changed')
  } finally {
    await directory.close()
  }
}

function signature(token: string, name: string, value: unknown): Buffer {
  if (!HEX.test(token)) throw new TypeError('invalid macOS volume ownership token')
  return createHmac('sha256', Buffer.from(token, 'hex'))
    .update(`jig-macos-volume\0${name}\0`)
    .update(JSON.stringify(value))
    .digest()
}

async function writeRecord(
  parent: FileHandle,
  name: string,
  token: string,
  value: unknown,
): Promise<string> {
  const mac = signature(token, name, value).toString('hex')
  const file = await privateMacosOpenAt(
    parent.fd,
    name,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
  )
  try {
    await file.writeFile(`${JSON.stringify({ value, mac })}\n`)
    await file.sync()
    await parent.sync()
  } finally {
    await file.close()
  }
  return mac
}

async function readRecord(
  parent: FileHandle,
  name: string,
  token: string,
): Promise<{ value: unknown; mac: string }> {
  const file = await privateMacosOpenAt(parent.fd, name, constants.O_RDONLY | constants.O_NONBLOCK)
  try {
    const before = await file.stat({ bigint: true })
    if (
      !before.isFile() ||
      before.uid !== BigInt(process.getuid!()) ||
      (before.mode & 0o777n) !== 0o600n ||
      before.nlink !== 1n ||
      before.size < 1n ||
      before.size > 4096n
    )
      throw new Error('macOS volume journal is unsafe')
    const bytes = Buffer.alloc(Number(before.size) + 1)
    let count = 0
    while (count < bytes.length) {
      const read = await file.read(bytes, count, bytes.length - count, count)
      if (!read.bytesRead) break
      count += read.bytesRead
    }
    const after = await file.stat({ bigint: true })
    if (
      BigInt(count) !== before.size ||
      before.size !== after.size ||
      after.nlink !== 1n ||
      before.mtimeNs !== after.mtimeNs ||
      before.ctimeNs !== after.ctimeNs
    )
      throw new Error('macOS volume journal changed')
    const parsed = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, count)),
    )
    if (
      parsed === null ||
      typeof parsed !== 'object' ||
      Object.keys(parsed).sort().join() !== 'mac,value' ||
      typeof parsed.mac !== 'string' ||
      !HEX.test(parsed.mac) ||
      !timingSafeEqual(signature(token, name, parsed.value), Buffer.from(parsed.mac, 'hex'))
    )
      throw new Error('macOS volume ownership authentication failed')
    return parsed
  } finally {
    await file.close()
  }
}

/** Fixed system tools, bounded bytes and lifetime; never a shell or caller command. */
function systemTool(
  tool: '/usr/bin/hdiutil' | '/usr/bin/plutil',
  args: string[],
  input?: Buffer,
  signal?: AbortSignal,
): Promise<Buffer> {
  signal?.throwIfAborted()
  return new Promise((resolve, reject) => {
    const child = execFile(
      tool,
      args,
      {
        cwd: '/',
        env: { PATH: '/usr/bin:/bin', LC_ALL: 'C' },
        encoding: 'buffer',
        timeout: 30_000,
        killSignal: 'SIGKILL',
        maxBuffer: MIB,
        signal,
      },
      (error, stdout) => {
        if (error) reject(new Error('macOS volume system operation failed', { cause: error }))
        else resolve(stdout)
      },
    )
    child.stdin?.on('error', () => undefined)
    child.stdin?.end(input)
  })
}

async function information(signal?: AbortSignal): Promise<Record<string, unknown>[]> {
  const plist = await systemTool('/usr/bin/hdiutil', ['info', '-plist'], undefined, signal)
  const json = await systemTool(
    '/usr/bin/plutil',
    ['-convert', 'json', '-o', '-', '-'],
    plist,
    signal,
  )
  const parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(json))
  if (
    !Array.isArray(parsed?.images) ||
    parsed.images.length > 1024 ||
    parsed.images.some((value: unknown) => value === null || typeof value !== 'object')
  )
    throw new Error('macOS image inventory is invalid')
  return parsed.images
}

/** No saved disk number grants detach authority: derive it from the live exact image. */
async function attached(
  controlPath: string,
  allocation: Allocation,
  signal?: AbortSignal,
): Promise<string | undefined> {
  const imagePath = join(controlPath, IMAGE)
  const images = await information(signal)
  const candidates = images.filter((value) => value['image-path'] === imagePath)
  if (candidates.length === 0) return undefined
  const item = candidates[0]!
  const entities = item['system-entities']
  if (
    candidates.length !== 1 ||
    item['owner-uid'] !== process.getuid!() ||
    item.blocksize !== 512 ||
    item.blockcount !== allocation.bytes / 512 ||
    item['image-encrypted'] !== false ||
    !Array.isArray(entities) ||
    entities.length !== 1
  )
    throw new Error('macOS image attachment does not match its allocation')
  const entity = entities[0]
  if (
    entity === null ||
    typeof entity !== 'object' ||
    typeof entity['dev-entry'] !== 'string' ||
    !/^\/dev\/disk[1-9][0-9]{0,5}$/.test(entity['dev-entry']) ||
    (entity['mount-point'] !== undefined && entity['mount-point'] !== allocation.mount.path)
  )
    throw new Error('macOS volume device does not match its allocation')
  return entity['dev-entry']
}

async function imageFile(
  parent: FileHandle,
  bytes: number,
  expected?: ImageIdentity,
): Promise<FileHandle> {
  const image = await privateMacosOpenAt(
    parent.fd,
    IMAGE,
    constants.O_RDONLY | constants.O_NONBLOCK,
  )
  try {
    const stat = await image.stat({ bigint: true })
    if (
      !stat.isFile() ||
      stat.uid !== BigInt(process.getuid!()) ||
      stat.nlink !== 1n ||
      stat.size > BigInt(bytes) ||
      (expected !== undefined &&
        (!matches(stat, expected) ||
          stat.size !== BigInt(bytes) ||
          (stat.mode & 0o777n) !== 0o600n))
    )
      throw new Error('macOS volume backing identity changed')
    return image
  } catch (error) {
    await image.close()
    throw error
  }
}

function validateAllocation(value: unknown): Allocation {
  const raw = value as Allocation
  if (
    raw === null ||
    typeof raw !== 'object' ||
    Object.keys(raw).sort().join() !== 'bytes,control,mount' ||
    !isIdentity(raw.control) ||
    Object.keys(raw.control).sort().join() !== 'device,inode' ||
    !isIdentity(raw.mount) ||
    Object.keys(raw.mount).sort().join() !== 'device,inode,path'
  )
    throw new Error('invalid macOS volume allocation')
  canonical(raw.mount.path)
  capacity(raw.bytes)
  return raw
}

/**
 * Caller allocates both empty private directories and retains their outer owner.
 * The control directory must be outside every payload grant. Run this operation
 * under the finite guardian: its tools, as well as payloads, need crash fencing.
 * Journals precede attachment; any failure retains ownership for fenced recovery.
 */
export async function createPrivateMacosVolume(
  controlPath: string,
  token: string,
  mountPath: string,
  bytes: number,
): Promise<Readonly<{ path: string; directory: FileHandle; capacityBytes: number }>> {
  await allocatePrivateMacosVolume(controlPath, token, mountPath, bytes)
  return attachPrivateMacosVolume(controlPath, token)
}

/** Durable allocation only: no subprocess or mount, safe before guardian admission. */
export async function allocatePrivateMacosVolume(
  controlPath: string,
  token: string,
  mountPath: string,
  bytes: number,
): Promise<void> {
  capacity(bytes)
  if (!HEX.test(token)) throw new TypeError('invalid macOS volume ownership token')
  canonical(controlPath)
  canonical(mountPath)
  if (
    controlPath === mountPath ||
    controlPath.startsWith(`${mountPath}/`) ||
    mountPath.startsWith(`${controlPath}/`)
  )
    throw new Error('macOS volume data overlaps control')
  const parent = await privateDirectory(controlPath)
  try {
    for await (const _ of privateMacosDirectory(parent.fd))
      throw new Error('macOS volume control allocation is not empty')
    const mount = await privateDirectory(mountPath)
    let allocation: Allocation
    try {
      // Refuse an existing mount or nonempty allocation before creating any image.
      if (privateMacosFilesystem(mount.fd).mountpoint === mountPath)
        throw new Error('macOS volume destination is already mounted')
      for await (const _ of privateMacosDirectory(mount.fd))
        throw new Error('macOS volume destination is not empty')
      allocation = {
        control: identity(await parent.stat({ bigint: true })),
        mount: { ...identity(await mount.stat({ bigint: true })), path: mountPath },
        bytes,
      }
    } finally {
      await mount.close()
    }
    await writeRecord(parent, INTENT, token, allocation)
  } finally {
    await parent.close()
  }
}

/** Run only inside the admitted finite guardian; never retry a partial creation. */
export async function attachPrivateMacosVolume(
  controlPath: string,
  token: string,
  signal?: AbortSignal,
): Promise<Readonly<{ path: string; directory: FileHandle; capacityBytes: number }>> {
  const parent = await privateDirectory(controlPath)
  let mounted: FileHandle | undefined
  try {
    signal?.throwIfAborted()
    const intent = await readRecord(parent, INTENT, token)
    const allocation = validateAllocation(intent.value)
    const allocationMac = intent.mac
    const bytes = allocation.bytes,
      mountPath = allocation.mount.path
    if (!matches(await parent.stat({ bigint: true }), allocation.control))
      throw new Error('macOS volume control directory changed')
    // Refuse a replay before starting tools, including an incomplete image.
    for await (const entry of privateMacosDirectory(parent.fd))
      if (entry.name.toString('utf8') !== INTENT)
        throw new Error('macOS volume allocation has already been used')
    await sameDirectory(mountPath, allocation.mount)
    await sameDirectory(controlPath, allocation.control)
    await systemTool(
      '/usr/bin/hdiutil',
      [
        'create',
        '-sectors',
        String(bytes / 512),
        '-fs',
        'Case-sensitive HFS+',
        '-volname',
        'Jig',
        '-type',
        'UDIF',
        '-layout',
        'NONE',
        '-nospotlight',
        join(controlPath, IMAGE),
      ],
      undefined,
      signal,
    )
    const image = await imageFile(parent, bytes)
    let recordedImage: ImageIdentity
    try {
      await image.chmod(0o600)
      await image.sync()
      const stat = await image.stat({ bigint: true })
      if (stat.size !== BigInt(bytes)) throw new Error('macOS volume capacity changed')
      recordedImage = { ...identity(stat), allocationMac }
      await writeRecord(parent, IMAGE_RECORD, token, recordedImage)
    } finally {
      await image.close()
    }
    await sameDirectory(controlPath, allocation.control)
    await sameDirectory(mountPath, allocation.mount)
    // In-kernel fixed image: no per-image userspace helper or sparse growth.
    await systemTool(
      '/usr/bin/hdiutil',
      [
        'attach',
        '-kernel',
        '-nobrowse',
        '-noautoopen',
        '-noautofsck',
        '-owners',
        'on',
        '-mountpoint',
        mountPath,
        '-mount',
        'required',
        '-plist',
        join(controlPath, IMAGE),
      ],
      undefined,
      signal,
    )
    const device = await attached(controlPath, allocation, signal)
    const checkedImage = await imageFile(parent, bytes, recordedImage)
    await checkedImage.close()
    await sameDirectory(controlPath, allocation.control)
    mounted = await open(mountPath, OPEN_DIRECTORY)
    const filesystem = privateMacosFilesystem(mounted.fd)
    const stat = await mounted.stat({ bigint: true })
    if (
      device === undefined ||
      filesystem.device !== device ||
      filesystem.mountpoint !== mountPath ||
      filesystem.type !== 'hfs' ||
      filesystem.capacityBytes < 1n ||
      filesystem.capacityBytes > BigInt(bytes) ||
      filesystem.owner !== process.getuid!() ||
      (filesystem.flags & 0x00200001) !== 0 ||
      (filesystem.flags & 0x18) !== 0x18 ||
      stat.dev === BigInt(allocation.mount.device)
    )
      throw new Error('macOS volume mount enforcement is unavailable')
    await mounted.chmod(0o700)
    await mounted.sync()
    const result = Object.freeze({
      path: mountPath,
      directory: mounted,
      capacityBytes: Number(filesystem.capacityBytes),
    })
    mounted = undefined
    return result
  } finally {
    await mounted?.close()
    await parent.close()
  }
}

/**
 * Only after the complete allocation's tools and payloads are fenced and all
 * collector descriptors closed. Authentication authorizes this exact storage,
 * never process fencing. Keep journals until the enclosing owner is released.
 */
export async function recoverPrivateMacosVolume(
  controlPath: string,
  token: string,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted()
  const parent = await privateDirectory(controlPath)
  try {
    const intent = await readRecord(parent, INTENT, token)
    const allocation = validateAllocation(intent.value)
    if (!matches(await parent.stat({ bigint: true }), allocation.control))
      throw new Error('macOS volume control directory changed')
    let recordedImage: ImageIdentity | undefined
    try {
      const record = await readRecord(parent, IMAGE_RECORD, token)
      const value = record.value as ImageIdentity
      if (
        !isIdentity(value) ||
        Object.keys(value).sort().join() !== 'allocationMac,device,inode' ||
        value.allocationMac !== intent.mac
      )
        throw new Error('macOS volume backing journal is invalid')
      recordedImage = value
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    let image: FileHandle | undefined
    try {
      try {
        image = await imageFile(parent, allocation.bytes, recordedImage)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
      const device = await attached(controlPath, allocation, signal)
      if (device !== undefined) {
        if (recordedImage === undefined || image === undefined)
          throw new Error('macOS attached image has no authenticated backing')
        await sameDirectory(controlPath, allocation.control)
        if (!matches(privateMacosStatAt(parent.fd, IMAGE), recordedImage))
          throw new Error('macOS volume backing changed before detach')
        await systemTool('/usr/bin/hdiutil', ['detach', device], undefined, signal)
        if ((await attached(controlPath, allocation, signal)) !== undefined)
          throw new Error('macOS volume detachment is unconfirmed')
      }
      try {
        await sameDirectory(allocation.mount.path, allocation.mount)
        const mountParent = await open(dirname(allocation.mount.path), OPEN_DIRECTORY)
        try {
          const name = posix.basename(allocation.mount.path)
          if (!matches(privateMacosStatAt(mountParent.fd, name), allocation.mount))
            throw new Error('macOS volume mount allocation changed')
          privateMacosUnlinkAt(mountParent.fd, name, true)
          await mountParent.sync()
        } finally {
          await mountParent.close()
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
      if (image !== undefined) {
        const current = privateMacosStatAt(parent.fd, IMAGE)
        if (!matches(current, identity(await image.stat({ bigint: true }))))
          throw new Error('macOS volume backing changed before removal')
        privateMacosUnlinkAt(parent.fd, IMAGE)
        await parent.sync()
      }
    } finally {
      await image?.close()
    }
  } finally {
    await parent.close()
  }
}
