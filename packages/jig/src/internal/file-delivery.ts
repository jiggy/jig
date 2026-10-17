import { createHash, randomBytes } from 'node:crypto'
import { closeSync, constants, fstatSync } from 'node:fs'
import { type FileHandle, statfs } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import type { DisplayImagePreview } from '@jigging/display-model'
import type { JsonValue } from '../json.js'
import { privateCanonicalJsonChunks, privateUtf8StringChunks } from './canonical-json-stream.js'
import {
  inspectPrivateOutput,
  type PrivateCapturedOutput,
  privateOutputFileChunks,
  requirePrivateCapturedOutput,
} from './captured-output.js'
import { privateDescriptorByteChunks } from './descriptor-byte-stream.js'
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
import { removePrivateDeliveryStage, writePrivateDeliveryStream } from './file-delivery-storage.js'
import {
  PRIVATE_DIRECTORY_OPEN_FLAGS,
  PRIVATE_FILE_LIMITS,
  privateFilePath,
  privateOpenAt,
  privateOpenFileRoot,
} from './file-input.js'
import { PRIVATE_CAPTURE_CHUNK_BYTES } from './file-input-policy.js'
import { privateImagePreview, privateImageSourceCandidate } from './image-preview.js'
import { PRIVATE_PREVIEW_LIMITS, privatePreviewStringBytes } from './image-preview-policy.js'
import type {
  RetainedRunCheckpoint,
  RunCheckpointIdentity,
  RunCheckpointInput,
  RunCheckpointReceipt,
} from './private-run-checkpoint.js'
import { privatePresentationNow } from './root-run-timeout-policy.js'

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
  exportAttempt?(
    request: import('./attempt-export-copier.js').PrivateAttemptExportRequest,
    signal?: AbortSignal,
  ): Promise<import('../attempt-contract.js').AttemptResults['export']>
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
  /** Earlier decoder cutoff; the RPC still has until deadline to drain its reply. */
  readonly previewDeadline?: number
  readonly signal?: AbortSignal
}
export type PrivateDeliveryInspectionPreview = Readonly<{
  state: 'text' | 'empty' | 'image' | 'non-text' | 'unavailable'
  text?: string
  image?: DisplayImagePreview
  bytes: number
  clipped: boolean
}>

export type PrivateDeliveryOutput =
  | { readonly kind: 'linux-directory'; readonly fd: number }
  | { readonly kind: 'snapshot'; readonly capture: PrivateCapturedOutput }

// Reserve all text prefixes before image extras. Both share one content budget.
interface PreviewFile {
  readonly contents: Buffer
  readonly bytes: number
}
interface DeliveryFile {
  readonly path: string
  readonly bytes: number
  readonly digest: string
  chunks(): Generator<Uint8Array>
}

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
  #previewFiles: Map<string, PreviewFile> | undefined
  readonly #previewCharges = new Map<PreviewFile, number>()
  #inspectionBytes = 0
  #retainPreview = false
  #close: Promise<void> | undefined
  #preparation: Promise<void> | undefined
  #publication: Promise<PrivateDeliveryReceipt> | undefined
  readonly #previewCancellation = new AbortController()
  readonly #previewJobs = new Set<Promise<PrivateDeliveryInspectionPreview>>()

  enableInspection(): void {
    if (!this.#publishing && !this.#close) this.#retainPreview = true
  }
  preview(path: string): { text: string; bytes: number; clipped: boolean } | undefined {
    privateFilePath(path)
    const file = this.#close ? undefined : this.#previewFiles?.get(path)
    const preview = file ? this.#textPreview(file) : { text: undefined, bytes: 0, clipped: false }
    return preview.text === undefined
      ? undefined
      : { text: preview.text, bytes: preview.bytes, clipped: preview.clipped }
  }
  inspectionPreview(path: string, deadline?: number): Promise<PrivateDeliveryInspectionPreview> {
    privateFilePath(path)
    const file = this.#close ? undefined : this.#previewFiles?.get(path)
    if (!file) return Promise.resolve({ state: 'unavailable', bytes: 0, clipped: false })
    const job = this.#inspectionPreview(file, deadline)
    this.#previewJobs.add(job)
    void job.finally(() => this.#previewJobs.delete(job)).catch(() => {})
    return job
  }
  async #inspectionPreview(
    file: PreviewFile,
    deadline?: number,
  ): Promise<PrivateDeliveryInspectionPreview> {
    const { contents, bytes } = file
    const image =
      contents.length === bytes
        ? await privateImagePreview(contents, this.#previewCancellation.signal, deadline)
        : undefined
    if (this.#previewCancellation.signal.aborted)
      return { state: 'unavailable', bytes, clipped: false }
    if (image) {
      // Keep every text fallback available. Repeated requests cannot spend a
      // reservation twice or release an image already returned to the caller.
      const reserved = this.#previewCharges.get(file) ?? 0
      const charge = privatePreviewStringBytes(image.base64)
      const extra = Math.max(0, charge - reserved)
      if (this.#inspectionBytes + extra <= PRIVATE_PREVIEW_LIMITS.retainedBytes) {
        this.#previewCharges.set(file, Math.max(reserved, charge))
        this.#inspectionBytes += extra
        return { state: 'image', image, bytes, clipped: false }
      }
    }
    return this.#textPreview(file)
  }
  #textPreview({ contents, bytes }: PreviewFile): PrivateDeliveryInspectionPreview {
    const size = Math.min(PRIVATE_PREVIEW_LIMITS.textBytes, contents.length)
    let text: string | undefined
    for (let end = size; end >= Math.max(0, size - (bytes > size ? 3 : 0)); end--) {
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(contents.subarray(0, end))
        break
      } catch {}
    }
    if (text === undefined) return { state: 'non-text', bytes, clipped: contents.length < bytes }
    return {
      state: bytes === 0 ? 'empty' : 'text',
      text,
      bytes,
      clipped: bytes > size,
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
    phaseDeadline?: number,
    checkpointCapture?: PrivateCapturedOutput,
  ): Promise<PrivateDeliveryReceipt> {
    if (this.#close || this.#publishing)
      return Promise.reject(new Error('delivery owner unavailable'))
    this.#publication = this.#publish(
      record,
      output,
      checkpoint,
      retainAfterCancellation,
      coordinatorLost,
      phaseDeadline,
      checkpointCapture,
    )
    return this.#publication
  }
  async #publish(
    record: JsonValue,
    output: PrivateDeliveryOutput | undefined,
    checkpoint?: RetainedRunCheckpoint,
    retainAfterCancellation = false,
    coordinatorLost?: AbortSignal,
    phaseDeadline?: number,
    checkpointCapture?: PrivateCapturedOutput,
  ): Promise<PrivateDeliveryReceipt> {
    if (
      this.#close ||
      this.#parent === undefined ||
      this.#leaf === undefined ||
      this.#destination === undefined ||
      this.#publishing
    )
      throw new Error('delivery has no available destination owner')
    if (phaseDeadline !== undefined && !Number.isSafeInteger(phaseDeadline))
      throw new TypeError('file delivery requires an absolute phase deadline')
    this.#publishing = true
    const retainedDelivery =
      output === undefined &&
      (checkpoint !== undefined ||
        (retainAfterCancellation &&
          record !== null &&
          typeof record === 'object' &&
          !Array.isArray(record) &&
          !Object.hasOwn(record, 'cleanup')))
    // Native settlement and packet streaming share the caller's original end.
    // Entering this writer cannot renew time already spent authenticating it.
    const deadline = Math.min(
      privatePresentationNow() + PRIVATE_FILE_LIMITS.deliveryMs,
      phaseDeadline ?? Infinity,
    )
    let timedOut = false
    const checkTime = () => {
      // Retaining a settled record does not waive its sender's lifetime.
      // Recovery publishes separately only after independently confirmed fencing.
      coordinatorLost?.throwIfAborted()
      // Accepted progress or a settled terminal-only report can survive
      // execution cancellation. Ordinary final-file copying remains cancellable.
      if (!retainedDelivery) this.signal.throwIfAborted()
      if (privatePresentationNow() >= deadline) {
        timedOut = true
        throw new Error('file delivery deadline exceeded')
      }
    }
    let failure: PrivateDeliveryReceipt['code'] = 'INVALID_FILES'
    const files: DeliveryFile[] = []
    const previews = new Map<string, PreviewFile>()
    let previewBytes = 0
    let keptPreviews = false
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
        if (output.kind === 'snapshot') {
          const capture = requirePrivateCapturedOutput(output.capture)
          files.push(
            ...capture.files.map((file) => ({
              ...file,
              chunks: () => privateDescriptorByteChunks(capture.fd, file.bytes, file.offset),
            })),
          )
        } else {
          if (!Number.isSafeInteger(output.fd) || output.fd < 0)
            throw new TypeError('invalid output directory descriptor')
          if (
            process.platform !== 'linux' ||
            BigInt((await statfs(`/proc/self/fd/${output.fd}`)).type) !== 0x01021994n
          )
            throw new TypeError('output is not bounded anonymous storage')
          const manifest = inspectPrivateOutput(output.fd, this.signal)
          const directory = output.fd
          files.push(
            ...manifest.files.map((file) => ({
              ...file,
              chunks: () => privateOutputFileChunks(directory, file, checkTime),
            })),
          )
        }
      }
      if (checkpoint !== undefined && output === undefined) {
        if (rootRecord.runId !== checkpoint.identity.runId || Object.hasOwn(rootRecord, 'cleanup'))
          throw new TypeError('checkpoint publication requires its settled Run')
        if (checkpointCapture !== undefined) {
          const capture = requirePrivateCapturedOutput(checkpointCapture)
          const manifest = checkpoint.manifest
          if (
            manifest === undefined ||
            capture.files.length !== manifest.length ||
            capture.files.some((file, index) => {
              const retained = manifest[index]!
              return (
                file.path !== retained.path ||
                file.bytes !== retained.bytes ||
                file.digest !== retained.digest
              )
            })
          )
            throw new TypeError('checkpoint snapshot differs from retained manifest')
          files.push(
            ...capture.files.map((file) => ({
              ...file,
              chunks: () => privateDescriptorByteChunks(capture.fd, file.bytes, file.offset),
            })),
          )
        } else if (
          checkpoint.artifacts !== undefined &&
          Object.keys(checkpoint.artifacts).length !== 0
        ) {
          throw new TypeError('associated checkpoint bytes unavailable')
        } else
          for (const [path, text] of Object.entries(checkpoint.files)) {
            files.push({
              path,
              bytes: Buffer.byteLength(text),
              digest: `sha256:${createHash('sha256').update(text).digest('hex')}`,
              chunks: () => privateUtf8StringChunks(text),
            })
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
      previewBytes = files.reduce(
        (sum, file) => sum + Math.min(file.bytes, PRIVATE_PREVIEW_LIMITS.textBytes),
        0,
      )
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
          let preview: Buffer | undefined
          const retainPreview = this.#retainPreview
          let copied = 0
          const hash = createHash('sha256')
          function* verifiedChunks() {
            for (const chunk of file.chunks()) {
              checkTime()
              hash.update(chunk)
              if (retainPreview && preview === undefined) {
                const prefixBytes = Math.min(file.bytes, PRIVATE_PREVIEW_LIMITS.textBytes)
                const extraBytes = file.bytes - prefixBytes
                const keepImage =
                  file.bytes <= PRIVATE_PREVIEW_LIMITS.sourceBytes &&
                  privateImageSourceCandidate(
                    Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength),
                  ) &&
                  previewBytes + extraBytes <= PRIVATE_PREVIEW_LIMITS.retainedBytes
                preview = Buffer.alloc(prefixBytes + (keepImage ? extraBytes : 0))
                if (keepImage) previewBytes += extraBytes
              }
              if (preview && copied < preview.length)
                preview.set(
                  chunk.subarray(0, Math.min(chunk.length, preview.length - copied)),
                  copied,
                )
              copied += chunk.length
              yield chunk
            }
            if (copied !== file.bytes || `sha256:${hash.digest('hex')}` !== file.digest)
              throw new Error('delivery source changed after validation')
          }
          try {
            await writePrivateDeliveryStream(
              stage,
              `files/${file.path}`,
              verifiedChunks(),
              checkTime,
            )
            if (this.#retainPreview && preview === undefined) preview = Buffer.alloc(0)
            if (preview) {
              previews.set(file.path, { contents: preview, bytes: file.bytes })
            }
          } catch (error) {
            preview?.fill(0)
            throw error
          }
        }
        delivery = Object.freeze({
          status: 'written',
          destination: this.#destination,
          source: output !== undefined ? 'final' : checkpoint !== undefined ? 'checkpoint' : 'none',
          files: Object.freeze(files.map(({ path, bytes, digest }) => ({ path, bytes, digest }))),
        })
        await writePrivateDeliveryStream(
          stage,
          'result.json',
          privateCanonicalJsonChunks({ ...rootRecord, delivery } as unknown as JsonValue, true),
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
        this.#previewFiles = previews
        for (const file of previews.values()) {
          const charge = privatePreviewStringBytes(this.#textPreview(file).text ?? '')
          this.#previewCharges.set(file, charge)
          this.#inspectionBytes += charge
        }
      }
      keptPreviews = this.#retainPreview
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
      if (!keptPreviews) for (const preview of previews.values()) preview.contents.fill(0)
    }
  }

  close(): Promise<void> {
    this.#close ??= this.#closeOwned()
    return this.#close
  }
  async #closeOwned(): Promise<void> {
    this.#previewCancellation.abort()
    // The same owner joins its original operations before consuming their held
    // references. Their execution/publication outcomes remain independent.
    await Promise.allSettled([this.#preparation, this.#publication])
    const previewResults = await Promise.allSettled(this.#previewJobs)
    const previews = this.#previewFiles,
      parent = this.#parent,
      stage = this.#stage
    this.#previewFiles = undefined
    this.#previewCharges.clear()
    this.#inspectionBytes = 0
    this.#parent = undefined
    this.#stage = undefined
    for (const preview of previews?.values() ?? []) preview.contents.fill(0)
    const failures: unknown[] = previewResults.flatMap((result) =>
      result.status === 'rejected' ? [result.reason] : [],
    )
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
