import { randomBytes } from 'node:crypto'
import { closeSync, constants, fstatSync } from 'node:fs'
import { type FileHandle, statfs } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import type { JsonValue } from '../json.js'
import { canonicalJson } from '../json.js'
import {
  capturePrivateOutput,
  type PrivateCapturedOutput,
  readPrivateCapturedOutput,
} from './captured-output.js'
import {
  duplicatePrivateDirectoryDescriptor,
  mkdirPrivateFile,
  openPrivateFile,
  type PrivateChildLocation,
  privateChildLocation,
  publishPrivateDirectory,
  statPrivateChild,
} from './descriptor-files.js'
import type { PrivateExecutionOutput } from './execution-output.js'
import { removePrivateDeliveryStage, writePrivateDeliveryFile } from './file-delivery-storage.js'
import {
  PRIVATE_DIRECTORY_OPEN_FLAGS,
  PRIVATE_FILE_LIMITS,
  privateFilePath,
  privateOpenAt,
  privateOpenFileRoot,
  sha256,
} from './file-input.js'
import type {
  RetainedRunCheckpoint,
  RunCheckpointIdentity,
  RunCheckpointInput,
  RunCheckpointReceipt,
} from './private-run-checkpoint.js'

export interface PrivateDeliveryReceipt {
  readonly status: 'written' | 'failed' | 'unknown'
  readonly destination: string
  readonly source?: 'final' | 'checkpoint' | 'none'
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
  enableInspection?(): void
  preview?(path: string): Promise<{ text: string; bytes: number; clipped: boolean } | undefined>
  inspectionPreview?(
    path: string,
    options: PrivateDeliveryInspectionOptions,
  ): Promise<PrivateDeliveryInspectionPreview>
  /** Authority release, ACK and expected channel completion all precede resolution. */
  retire?(options: PrivateDeliveryInspectionOptions): Promise<void>
  readonly checkpoint?: RetainedRunCheckpoint | null | undefined
  prepare(directory: string, roots: readonly number[]): Promise<void>
  bindCheckpoint?(identity: RunCheckpointIdentity, project: string, epoch: number): Promise<void>
  saveCheckpoint?(input: RunCheckpointInput): Promise<RunCheckpointReceipt>
  publish(
    record: JsonValue,
    output: PrivateExecutionOutput | undefined,
    signal?: AbortSignal,
  ): Promise<PrivateDeliveryReceipt>
}

export interface PrivateDeliveryInspectionOptions {
  /** Epoch-referenced process-monotonic milliseconds, never a renewed allowance. */
  readonly deadline: number
  readonly signal?: AbortSignal
}
export type PrivateDeliveryInspectionPreview = Readonly<{
  state: 'text' | 'empty' | 'non-text' | 'unavailable'
  text?: string
  bytes: number
  clipped: boolean
}>

export type PrivateDeliveryOutput =
  | { readonly kind: 'linux-directory'; readonly fd: number }
  | { readonly kind: 'snapshot'; readonly capture: PrivateCapturedOutput }

/** Owned by the outer command, never the execution coordinator or Flow. */
export class PrivateFileDeliveryOwner {
  #parent: FileHandle | undefined
  #parentPath: string | undefined
  #leaf: string | undefined
  #destination: string | undefined
  #stage: { location: PrivateChildLocation; inode: bigint; device: bigint } | undefined
  #published = false
  #preparing = false
  #publishing = false
  #previewFiles: Map<string, Buffer> | undefined
  #retainPreview = false
  #close: Promise<void> | undefined
  #preparation: Promise<void> | undefined
  #publication: Promise<PrivateDeliveryReceipt> | undefined

  enableInspection(): void {
    if (!this.#publishing && !this.#close) this.#retainPreview = true
  }
  preview(path: string): { text: string; bytes: number; clipped: boolean } | undefined {
    const preview = this.inspectionPreview(path)
    return preview.text === undefined
      ? undefined
      : { text: preview.text, bytes: preview.bytes, clipped: preview.clipped }
  }
  inspectionPreview(path: string): PrivateDeliveryInspectionPreview {
    privateFilePath(path)
    const contents = this.#previewFiles?.get(path)
    if (!contents) return { state: 'unavailable', bytes: 0, clipped: false }
    const size = Math.min(65536, contents.length)
    let text: string | undefined
    for (let end = size; end >= Math.max(0, size - (contents.length > size ? 3 : 0)); end--) {
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(contents.subarray(0, end))
        break
      } catch {}
    }
    if (text === undefined) return { state: 'non-text', bytes: contents.length, clipped: false }
    return {
      state: contents.length === 0 ? 'empty' : 'text',
      text,
      bytes: contents.length,
      clipped: contents.length > size,
    }
  }

  constructor(
    readonly signal: AbortSignal,
    readonly onStaged?: () => Promise<void>,
  ) {}

  prepare(directory: string, sourceFds: readonly number[]): Promise<void> {
    if (this.#close || this.#preparing || this.#parent !== undefined)
      return Promise.reject(new Error('delivery destination unavailable'))
    this.#preparation = this.#prepare(directory, sourceFds)
    return this.#preparation
  }
  async #prepare(directory: string, sourceFds: readonly number[]): Promise<void> {
    if (this.#close || this.#preparing || this.#parent !== undefined)
      throw new TypeError('delivery destination already selected')
    this.#preparing = true
    let parent: FileHandle | undefined
    try {
      this.signal.throwIfAborted()
      const destination = resolve(directory),
        parentPath = dirname(destination),
        leaf = privateFilePath(basename(destination))
      if (destination === parentPath || leaf.includes('/'))
        throw new TypeError('output requires a new directory')
      const selected = privateOpenFileRoot(parentPath)
      try {
        parent = await duplicatePrivateDirectoryDescriptor(selected)
      } finally {
        closeSync(selected)
      }
      await requireAbsent(parent, leaf)
      if (!Array.isArray(sourceFds) || sourceFds.length > 8)
        throw new TypeError('invalid input roots')
      for (const fd of sourceFds) {
        if (!Number.isSafeInteger(fd) || fd < 0 || !fstatSync(fd).isDirectory())
          throw new TypeError('invalid input root')
        if (directoryContains(fd, parent.fd))
          throw new TypeError('output must be outside each input root')
      }
      this.#parent = parent
      parent = undefined
      this.#parentPath = parentPath
      this.#leaf = leaf
      this.#destination = destination
    } finally {
      await parent?.close()
      this.#preparing = false
    }
  }

  publish(
    record: JsonValue,
    output: PrivateDeliveryOutput | undefined,
    checkpoint?: RetainedRunCheckpoint,
    retainAfterCancellation = false,
    coordinatorLost?: AbortSignal,
  ): Promise<PrivateDeliveryReceipt> {
    if (this.#close || this.#publishing)
      return Promise.reject(new Error('delivery owner unavailable'))
    this.#publication = this.#publish(
      record,
      output,
      checkpoint,
      retainAfterCancellation,
      coordinatorLost,
    )
    return this.#publication
  }
  async #publish(
    record: JsonValue,
    output: PrivateDeliveryOutput | undefined,
    checkpoint?: RetainedRunCheckpoint,
    retainAfterCancellation = false,
    coordinatorLost?: AbortSignal,
  ): Promise<PrivateDeliveryReceipt> {
    if (
      this.#close ||
      this.#parent === undefined ||
      this.#leaf === undefined ||
      this.#destination === undefined ||
      this.#publishing
    )
      throw new Error('delivery has no available destination owner')
    this.#publishing = true
    const retainedDelivery =
      output === undefined &&
      (checkpoint !== undefined ||
        (retainAfterCancellation &&
          record !== null &&
          typeof record === 'object' &&
          !Array.isArray(record) &&
          !Object.hasOwn(record, 'cleanup')))
    const deadline = performance.now() + PRIVATE_FILE_LIMITS.deliveryMs
    let timedOut = false
    const checkTime = () => {
      // Retaining a settled record does not waive its sender's lifetime.
      // Recovery publishes separately only after independently confirmed fencing.
      coordinatorLost?.throwIfAborted()
      // Accepted progress or a settled terminal-only report can survive
      // execution cancellation. Ordinary final-file copying remains cancellable.
      if (!retainedDelivery) this.signal.throwIfAborted()
      if (performance.now() >= deadline) {
        timedOut = true
        throw new Error('file delivery deadline exceeded')
      }
    }
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
      if (output !== undefined) {
        if (rootRecord.status !== 'succeeded' || Object.hasOwn(rootRecord, 'cleanup'))
          throw new TypeError('files require a validated successful execution')
        if (output.kind === 'snapshot') files.push(...readPrivateCapturedOutput(output.capture))
        else {
          if (
            process.platform !== 'linux' ||
            !Number.isSafeInteger(output.fd) ||
            output.fd < 0 ||
            BigInt((await statfs(`/proc/self/fd/${output.fd}`)).type) !== 0x01021994n
          )
            throw new TypeError('output is not bounded anonymous storage')
          const captured = capturePrivateOutput(output.fd, this.signal)
          try {
            files.push(...readPrivateCapturedOutput(captured))
          } finally {
            captured.close()
          }
        }
      }
      if (checkpoint !== undefined && output === undefined) {
        if (rootRecord.runId !== checkpoint.identity.runId || Object.hasOwn(rootRecord, 'cleanup'))
          throw new TypeError('checkpoint publication requires its settled Run')
        for (const [path, text] of Object.entries(checkpoint.files)) {
          const contents = Buffer.from(text)
          files.push({ path, contents, bytes: contents.length, digest: sha256(contents) })
        }
      }
      checkTime()
      failure = 'DESTINATION_CHANGED'
      this.#verifyParent()
      await requireAbsent(this.#parent, this.#leaf)
      failure = 'WRITE_FAILED'
      const name = `.jig-delivery-${randomBytes(16).toString('hex')}`
      const location = privateChildLocation(this.#parent, name)
      // Record this exact allocation before yielding to coordinator activity.
      await mkdirPrivateFile(location)
      const info = await statPrivateChild(this.#parent, name)
      this.#stage = { location, inode: info.ino, device: info.dev }
      await this.onStaged?.()
      checkTime()
      let delivery: PrivateDeliveryReceipt
      const stage = await openPrivateFile(
        location,
        constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
      )
      try {
        const opened = await stage.stat({ bigint: true })
        if (opened.ino !== info.ino || opened.dev !== info.dev)
          throw new Error('delivery stage identity changed')
        await mkdirPrivateFile(privateChildLocation(stage, 'files'))
        for (const file of files) {
          checkTime()
          await writePrivateDeliveryFile(stage, `files/${file.path}`, file.contents, checkTime)
        }
        delivery = Object.freeze({
          status: 'written',
          destination: this.#destination,
          source: output !== undefined ? 'final' : checkpoint !== undefined ? 'checkpoint' : 'none',
          files: Object.freeze(files.map(({ path, bytes, digest }) => ({ path, bytes, digest }))),
        })
        const packet = canonicalJson({ ...rootRecord, delivery } as unknown as JsonValue)
        await writePrivateDeliveryFile(
          stage,
          'result.json',
          Buffer.concat([Buffer.from(packet), Buffer.from('\n')]),
          checkTime,
        )
      } finally {
        await stage.close()
      }
      checkTime()
      failure = 'DESTINATION_CHANGED'
      this.#verifyParent()
      const staged = await statPrivateChild(this.#parent, name)
      if (!staged.isDirectory() || staged.ino !== info.ino || staged.dev !== info.dev)
        throw new Error('delivery stage identity changed')
      await publishPrivateDirectory(this.#parent, name, this.#leaf)
      this.#published = true
      this.#stage = undefined
      if (this.#retainPreview) {
        // These are the exact fenced bytes used for verified publication. The
        // private presentation copy never reopens the mutable destination.
        if (files.length <= 64 && files.reduce((n, f) => n + f.bytes, 0) <= 16 * 1024 * 1024)
          this.#previewFiles = new Map(files.map((file) => [file.path, Buffer.from(file.contents)]))
      }
      return delivery
    } catch {
      let code: PrivateDeliveryReceipt['code'] =
        coordinatorLost?.aborted || (this.signal.aborted && !retainedDelivery)
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
      for (const file of files) file.contents.fill(0)
    }
  }

  close(): Promise<void> {
    this.#close ??= this.#closeOwned()
    return this.#close
  }
  async #closeOwned(): Promise<void> {
    // The same owner joins its original operations before consuming their held
    // references. Their execution/publication outcomes remain independent.
    await Promise.allSettled([this.#preparation, this.#publication])
    const previews = this.#previewFiles,
      parent = this.#parent,
      stage = this.#stage
    this.#previewFiles = undefined
    this.#parent = undefined
    this.#stage = undefined
    for (const bytes of previews?.values() ?? []) bytes.fill(0)
    const failures: unknown[] = []
    try {
      await this.#cleanupStage(stage, parent)
    } catch (error) {
      failures.push(error)
    }
    try {
      await parent?.close()
    } catch (error) {
      failures.push(error)
    }
    if (failures.length) throw new AggregateError(failures, 'delivery owner cleanup failed')
  }
  #verifyParent(): void {
    const current = privateOpenFileRoot(this.#parentPath!)
    try {
      const before = fstatSync(this.#parent!.fd, { bigint: true }),
        after = fstatSync(current, { bigint: true })
      if (before.dev !== after.dev || before.ino !== after.ino)
        throw new Error('destination parent changed')
    } finally {
      closeSync(current)
    }
  }
  async #cleanupStage(stage = this.#stage, parent = this.#parent): Promise<void> {
    if (stage === undefined || this.#published) return
    const info = await statPrivateChild(parent!, stage.location.name)
    if (!info.isDirectory() || info.ino !== stage.inode || info.dev !== stage.device)
      throw new Error('delivery cleanup identity changed')
    await removePrivateDeliveryStage(stage.location, stage)
    this.#stage = undefined
  }
}

async function requireAbsent(parent: FileHandle, leaf: string): Promise<void> {
  try {
    await statPrivateChild(parent, leaf)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  throw new Error('output destination already exists')
}
function directoryContains(root: number, candidate: number): boolean {
  const expected = fstatSync(root, { bigint: true })
  let current = privateOpenAt(candidate, '.', PRIVATE_DIRECTORY_OPEN_FLAGS, false)
  try {
    for (let depth = 0; depth < 256; depth++) {
      const info = fstatSync(current, { bigint: true })
      if (info.dev === expected.dev && info.ino === expected.ino) return true
      const next = privateOpenAt(current, '..', PRIVATE_DIRECTORY_OPEN_FLAGS, false)
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
