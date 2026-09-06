import { closeSync, fstatSync, lstatSync, mkdirSync, opendirSync } from 'node:fs'
import { mkdir, open, rm, statfs } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import { randomBytes } from 'node:crypto'
import type { JsonValue } from '../json.js'
import { canonicalJson } from '../json.js'
import {
  PRIVATE_FILE_LIMITS,
  privateFilePath,
  privateOpenAt,
  privateOpenFileRoot,
  privatePublishDirectory,
  privateReadRegularFile,
  sha256,
} from './linux-file-input.js'

export interface PrivateDeliveryReceipt {
  readonly status: 'written' | 'failed' | 'unknown'
  readonly destination: string
  readonly files?: readonly {
    readonly path: string
    readonly bytes: number
    readonly digest: string
  }[]
  readonly code?:
    | 'CANCELLED'
    | 'INVALID_FILES'
    | 'DESTINATION_CHANGED'
    | 'WRITE_FAILED'
    | 'CLEANUP_FAILED'
    | 'CHANNEL_LOST'
    | 'DEADLINE_EXCEEDED'
}
export interface PrivateDeliveryConnection {
  prepare(directory: string, roots: readonly number[]): Promise<void>
  publish(
    record: JsonValue,
    outputFd: number | undefined,
    signal?: AbortSignal,
  ): Promise<PrivateDeliveryReceipt>
}

/** Owned by the outer command, never the execution coordinator or Flow. */
export class PrivateFileDeliveryOwner {
  #parent: number | undefined
  #parentPath: string | undefined
  #leaf: string | undefined
  #destination: string | undefined
  #stage: { name: string; inode: bigint; device: bigint } | undefined
  #published = false
  #preparing = false
  #publishing = false

  constructor(
    readonly signal: AbortSignal,
    readonly onStaged?: () => Promise<void>,
  ) {}

  async prepare(directory: string, sourcePid: number, sourceFds: readonly number[]): Promise<void> {
    if (this.#preparing || this.#parent !== undefined)
      throw new TypeError('delivery destination already selected')
    this.#preparing = true
    let parent: number | undefined
    try {
      this.signal.throwIfAborted()
      const destination = resolve(directory),
        parentPath = dirname(destination),
        leaf = privateFilePath(basename(destination))
      if (destination === parentPath || leaf.includes('/'))
        throw new TypeError('output requires a new directory')
      parent = privateOpenFileRoot(parentPath)
      requireAbsent(parent, leaf)
      if (
        !Number.isSafeInteger(sourcePid) ||
        sourcePid < 1 ||
        !Array.isArray(sourceFds) ||
        sourceFds.length > 8
      )
        throw new TypeError('invalid input roots')
      for (const fd of sourceFds) {
        if (!Number.isSafeInteger(fd) || fd < 0) throw new TypeError('invalid input root')
        const source = await open(`/proc/${sourcePid}/fd/${fd}`, 0x10000)
        try {
          if (!(await source.stat()).isDirectory() || directoryContains(source.fd, parent))
            throw new TypeError('output must be outside each input root')
        } finally {
          await source.close()
        }
      }
      this.#parent = parent
      parent = undefined
      this.#parentPath = parentPath
      this.#leaf = leaf
      this.#destination = destination
    } finally {
      if (parent !== undefined) closeSync(parent)
      this.#preparing = false
    }
  }

  async publish(
    record: JsonValue,
    sourcePid: number,
    outputFd: number | undefined,
  ): Promise<PrivateDeliveryReceipt> {
    if (
      this.#parent === undefined ||
      this.#leaf === undefined ||
      this.#destination === undefined ||
      this.#publishing
    )
      throw new Error('delivery has no available destination owner')
    this.#publishing = true
    const deadline = performance.now() + PRIVATE_FILE_LIMITS.deliveryMs
    let timedOut = false
    const checkTime = () => {
      this.signal.throwIfAborted()
      if (performance.now() >= deadline) {
        timedOut = true
        throw new Error('file delivery deadline exceeded')
      }
    }
    let output: Awaited<ReturnType<typeof open>> | undefined
    let failure: PrivateDeliveryReceipt['code'] = 'INVALID_FILES'
    const files: { path: string; bytes: number; digest: string; contents: Buffer }[] = []
    try {
      checkTime()
      const rootRecord = record as Record<string, JsonValue>
      if (
        record === null ||
        typeof record !== 'object' ||
        Array.isArray(record) ||
        !['succeeded', 'failed', 'lost'].includes(String(rootRecord.status)) ||
        Object.hasOwn(rootRecord, 'delivery')
      )
        throw new TypeError('invalid execution record')
      if (outputFd !== undefined) {
        if (
          rootRecord.status !== 'succeeded' ||
          !Number.isSafeInteger(outputFd) ||
          outputFd < 0 ||
          !Number.isSafeInteger(sourcePid) ||
          sourcePid < 1
        )
          throw new TypeError('files require a validated successful execution')
        output = await open(`/proc/${sourcePid}/fd/${outputFd}`, 0x10000)
        if (BigInt((await statfs(`/proc/self/fd/${output.fd}`)).type) !== 0x01021994n)
          throw new TypeError('output is not bounded anonymous storage')
        let entries = 0,
          bytes = 0
        const walk = (relative: string) => {
          checkTime()
          const fd =
            relative === ''
              ? output!.fd
              : privateOpenAt(output!.fd, privateFilePath(relative), 0x10000)
          const directory = opendirSync(`/proc/self/fd/${fd}`)
          try {
            for (;;) {
              checkTime()
              const entry = directory.readSync()
              if (entry === null) break
              if (++entries > PRIVATE_FILE_LIMITS.entries)
                throw new TypeError('output entry limit exceeded')
              const path = privateFilePath(
                relative === '' ? entry.name : `${relative}/${entry.name}`,
              )
              if (entry.isDirectory()) walk(path)
              else {
                if (
                  files.length >= PRIVATE_FILE_LIMITS.files ||
                  files.some((file) => file.path === path)
                )
                  throw new TypeError('output file limit exceeded')
                const contents = privateReadRegularFile(output!.fd, path, 16 * 1024 * 1024 - bytes)
                bytes += contents.length
                files.push({ path, bytes: contents.length, digest: sha256(contents), contents })
              }
            }
          } finally {
            directory.closeSync()
            if (fd !== output!.fd) closeSync(fd)
          }
        }
        walk('')
        files.sort((a, b) => (a.path < b.path ? -1 : 1))
        await output.close()
        output = undefined
      }
      checkTime()
      failure = 'DESTINATION_CHANGED'
      this.#verifyParent()
      requireAbsent(this.#parent, this.#leaf)
      failure = 'WRITE_FAILED'
      const name = `.jig-delivery-${randomBytes(16).toString('hex')}`
      const stagePath = `/proc/self/fd/${this.#parent}/${name}`
      // This independent owner records its exact allocation before handing
      // control back to the coordinator. The Flow never sees this directory.
      mkdirSync(stagePath, { mode: 0o700 })
      const info = lstatSync(stagePath, { bigint: true })
      this.#stage = { name, inode: info.ino, device: info.dev }
      await this.onStaged?.()
      checkTime()
      await mkdir(`${stagePath}/files`, { mode: 0o700 })
      for (const file of files) {
        checkTime()
        const destination = `${stagePath}/files/${file.path}`
        await mkdir(dirname(destination), { recursive: true, mode: 0o700 })
        const handle = await open(destination, 'wx', 0o600)
        try {
          await handle.writeFile(file.contents)
        } finally {
          await handle.close()
        }
      }
      const delivery: PrivateDeliveryReceipt = Object.freeze({
        status: 'written',
        destination: this.#destination,
        files: Object.freeze(files.map(({ path, bytes, digest }) => ({ path, bytes, digest }))),
      })
      const packet = canonicalJson({ ...rootRecord, delivery } as unknown as JsonValue)
      const result = await open(`${stagePath}/result.json`, 'wx', 0o600)
      try {
        await result.writeFile(packet)
        await result.writeFile('\n')
      } finally {
        await result.close()
      }
      checkTime()
      failure = 'DESTINATION_CHANGED'
      this.#verifyParent()
      privatePublishDirectory(this.#parent, name, this.#leaf)
      this.#published = true
      this.#stage = undefined
      return delivery
    } catch {
      let code: PrivateDeliveryReceipt['code'] = this.signal.aborted
        ? 'CANCELLED'
        : timedOut
          ? 'DEADLINE_EXCEEDED'
          : failure
      try {
        await this.#cleanupStage()
      } catch {
        code = 'CLEANUP_FAILED'
      }
      return Object.freeze({ status: 'failed', destination: this.#destination, code })
    } finally {
      await output?.close()
    }
  }

  async close(): Promise<void> {
    await this.#cleanupStage()
    if (this.#parent !== undefined) {
      closeSync(this.#parent)
      this.#parent = undefined
    }
  }
  #verifyParent(): void {
    const current = privateOpenFileRoot(this.#parentPath!)
    try {
      const before = fstatSync(this.#parent!, { bigint: true }),
        after = fstatSync(current, { bigint: true })
      if (before.dev !== after.dev || before.ino !== after.ino)
        throw new Error('destination parent changed')
    } finally {
      closeSync(current)
    }
  }
  async #cleanupStage(): Promise<void> {
    if (this.#stage === undefined || this.#published) return
    const path = `/proc/self/fd/${this.#parent}/${this.#stage.name}`
    const info = lstatSync(path, { bigint: true })
    if (!info.isDirectory() || info.ino !== this.#stage.inode || info.dev !== this.#stage.device)
      throw new Error('delivery cleanup identity changed')
    await rm(path, { recursive: true })
    this.#stage = undefined
  }
}

function requireAbsent(parent: number, leaf: string): void {
  try {
    lstatSync(`/proc/self/fd/${parent}/${leaf}`)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  throw new Error('output destination already exists')
}
function directoryContains(root: number, candidate: number): boolean {
  const expected = fstatSync(root, { bigint: true })
  let current = privateOpenAt(candidate, '.', 0x200000 | 0x10000, false)
  try {
    for (let depth = 0; depth < 256; depth++) {
      const info = fstatSync(current, { bigint: true })
      if (info.dev === expected.dev && info.ino === expected.ino) return true
      const next = privateOpenAt(current, '..', 0x200000 | 0x10000, false)
      const parent = fstatSync(next, { bigint: true })
      closeSync(current)
      current = next
      if (parent.dev === info.dev && parent.ino === info.ino) return false
    }
    throw new Error('output ancestry exceeds limit')
  } finally {
    closeSync(current)
  }
}
