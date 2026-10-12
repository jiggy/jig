import { randomBytes } from 'node:crypto'
import type {
  PrivateDeliveryConnection,
  PrivateDeliveryInspectionOptions,
  PrivateDeliveryInspectionPreview,
  PrivateDeliveryReceipt,
} from './file-delivery.js'
import { PRIVATE_FILE_LIMITS, privateFilePath } from './file-input.js'
import { privatePresentationNow } from './root-run-timeout-policy.js'

export const PRIVATE_INSPECTION_COMPLETION_MS = 20_000
export const PRIVATE_INSPECTION_PREVIEW_MS = 10_000
const PREVIEW_BYTES = 64 * 1024
const TEXT_BYTES = 4 * 1024 * 1024

/** Kept separate from the already known execution and publication records. */
export class PrivateDeliveryInspectionError extends Error {
  constructor(
    readonly code: 'DEADLINE_EXCEEDED' | 'CANCELLED' | 'RETIREMENT_FAILED' | 'INVALID_CAPTURE',
  ) {
    super(`Delivery inspection cleanup could not be confirmed (${code}).`)
    this.name = 'PrivateDeliveryInspectionError'
  }
}

export function privateBoundInspection<T>(
  operation: Promise<T>,
  options: PrivateDeliveryInspectionOptions,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let finished = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = (work: () => void) => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', abort)
      work()
    }
    const abort = () => finish(() => reject(new PrivateDeliveryInspectionError('CANCELLED')))
    const expired = () =>
      finish(() => reject(new PrivateDeliveryInspectionError('DEADLINE_EXCEEDED')))
    // Attach both handlers before a synchronously expired/cancelled bound. Late
    // results stay observed, but can never establish success here.
    operation.then(
      (value) => {
        if (privatePresentationNow() >= options.deadline) expired()
        else if (options.signal?.aborted) abort()
        else finish(() => resolve(value))
      },
      (error) => finish(() => reject(error)),
    )
    if (!Number.isSafeInteger(options.deadline) || privatePresentationNow() >= options.deadline)
      expired()
    else {
      timer = setTimeout(expired, options.deadline - privatePresentationNow())
      options.signal?.addEventListener('abort', abort, { once: true })
      if (options.signal?.aborted) abort()
    }
  })
}

/** One completion allowance for every join, including repeated finally paths. */
export class PrivateDeliveryCompletion {
  #deadline: number | undefined
  readonly #joins = new WeakMap<Promise<unknown>, Promise<unknown>>()
  readonly #pending = new Set<() => void>()
  constructor(
    readonly inheritedDeadline?: number,
    readonly allowanceMs = PRIVATE_INSPECTION_COMPLETION_MS,
  ) {}
  start(requestedDeadline?: number): number {
    const deadline = Math.min(
      this.#deadline ?? privatePresentationNow() + this.allowanceMs,
      this.inheritedDeadline ?? Infinity,
      requestedDeadline ?? Infinity,
    )
    const tightened = this.#deadline !== undefined && deadline < this.#deadline
    this.#deadline = deadline
    if (tightened) for (const observe of this.#pending) observe()
    return deadline
  }
  join<T>(operation: Promise<T>): Promise<T> {
    const existing = this.#joins.get(operation)
    if (existing) return existing as Promise<T>
    this.start()
    const joined = new Promise<T>((resolve, reject) => {
      let settled = false
      let timer: ReturnType<typeof setTimeout> | undefined
      const finish = (work: () => void) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        this.#pending.delete(observe)
        work()
      }
      const expired = () =>
        finish(() => reject(new PrivateDeliveryInspectionError('DEADLINE_EXCEEDED')))
      const observe = () => {
        // A later authenticated retire may tighten a legacy exit join that is
        // already pending. Reschedule this join's one timer directly; completed
        // results remain immutable and never acquire another timer owner.
        clearTimeout(timer)
        const remaining = this.#deadline! - privatePresentationNow()
        if (remaining <= 0) expired()
        else timer = setTimeout(expired, remaining)
      }
      // Observe original operation failure even when the bound already expired.
      operation.then(
        (value) => {
          if (privatePresentationNow() >= this.#deadline!) expired()
          else finish(() => resolve(value))
        },
        (error) => finish(() => reject(error)),
      )
      this.#pending.add(observe)
      observe()
    })
    this.#joins.set(operation, joined)
    return joined
  }
}

/** An irreversible fence and one exact, failure-preserving resource close. */
export class PrivateDeliveryAuthorityRetirement {
  #retiring = false
  #close: Promise<void> | undefined
  #retire: Promise<void> | undefined
  constructor(readonly release: () => Promise<void>) {}
  get retiring(): boolean {
    return this.#retiring
  }
  fence(): void {
    this.#retiring = true
  }
  close(): Promise<void> {
    this.#retiring = true
    this.#close ??= Promise.resolve().then(this.release)
    return this.#close
  }
  retire(options: PrivateDeliveryInspectionOptions): Promise<void> {
    this.#retiring = true
    this.#retire ??= privateBoundInspection(this.close(), options)
    return this.#retire
  }
}

export interface PrivateDeliveryInspectionCapture {
  readonly generation: string
  readonly files: readonly Readonly<{
    path: string
    bytes: number
    state: PrivateDeliveryInspectionPreview['state']
    clipped: boolean
  }>[]
  preview(path: string): PrivateDeliveryInspectionPreview | undefined
  close(): void
}

/** Transfer only receipt-selected excerpts, then spend the authenticated channel. */
export async function privateCaptureDeliveryInspection(
  delivery: PrivateDeliveryConnection | undefined,
  receipt: PrivateDeliveryReceipt | undefined,
  options: { readonly presentationDeadline?: number; readonly signal?: AbortSignal } = {},
): Promise<PrivateDeliveryInspectionCapture> {
  const started = privatePresentationNow()
  const deadline = Math.min(
    started + PRIVATE_INSPECTION_COMPLETION_MS,
    options.presentationDeadline ?? Infinity,
  )
  const previewDeadline =
    started +
    Math.min(PRIVATE_INSPECTION_PREVIEW_MS, Math.max(0, Math.floor((deadline - started) / 2)))
  const bound = { deadline, ...(options.signal === undefined ? {} : { signal: options.signal }) }
  const previews = new Map<string, PrivateDeliveryInspectionPreview>()
  let files: PrivateDeliveryInspectionCapture['files'] = []
  let captureFailure: unknown
  try {
    const manifest = receipt?.status === 'written' ? (receipt.files ?? []) : []
    if (manifest.length > 64) throw new PrivateDeliveryInspectionError('INVALID_CAPTURE')
    let bytes = 0
    const paths = new Set<string>()
    for (const file of manifest) {
      privateFilePath(file.path)
      if (paths.has(file.path) || !Number.isSafeInteger(file.bytes) || file.bytes < 0)
        throw new PrivateDeliveryInspectionError('INVALID_CAPTURE')
      paths.add(file.path)
      bytes += file.bytes
      if (bytes > PRIVATE_FILE_LIMITS.bytes)
        throw new PrivateDeliveryInspectionError('INVALID_CAPTURE')
      previews.set(
        file.path,
        Object.freeze({ state: 'unavailable', bytes: file.bytes, clipped: false }),
      )
    }
    let retained = 0
    for (const file of manifest) {
      if (
        !delivery?.inspectionPreview ||
        privatePresentationNow() >= previewDeadline ||
        options.signal?.aborted
      )
        break
      try {
        // The RPC keeps the total bound so a preview-cutoff reply can be drained
        // before the serialized retirement request. Its late text is discarded.
        const preview = await privateBoundInspection(delivery.inspectionPreview(file.path, bound), {
          ...bound,
          deadline: previewDeadline,
        })
        const size = preview.text === undefined ? 0 : Buffer.byteLength(preview.text)
        if (
          (preview.state !== 'unavailable' && preview.bytes !== file.bytes) ||
          size > PREVIEW_BYTES ||
          retained + size > TEXT_BYTES ||
          !['text', 'empty', 'non-text', 'unavailable'].includes(preview.state) ||
          typeof preview.clipped !== 'boolean' ||
          (preview.state === 'text' || preview.state === 'empty') !==
            (typeof preview.text === 'string') ||
          (preview.state === 'empty' &&
            (preview.bytes !== 0 || preview.text !== '' || preview.clipped))
        )
          throw new PrivateDeliveryInspectionError('INVALID_CAPTURE')
        retained += size
        previews.set(file.path, Object.freeze({ ...preview, bytes: file.bytes }))
      } catch (error) {
        if (error instanceof PrivateDeliveryInspectionError && error.code === 'INVALID_CAPTURE')
          throw error
        // Honest unavailable metadata replaces a failed excerpt; publication
        // truth is unchanged. The shared retirement deadline is never reset.
        if (privatePresentationNow() >= previewDeadline || options.signal?.aborted) break
      }
    }
    files = Object.freeze(
      [...previews].map(([path, preview]) =>
        Object.freeze({
          path,
          bytes: preview.bytes,
          state: preview.state,
          clipped: preview.clipped,
        }),
      ),
    )
  } catch (error) {
    captureFailure =
      error instanceof PrivateDeliveryInspectionError
        ? error
        : new PrivateDeliveryInspectionError('INVALID_CAPTURE')
  }
  try {
    if (delivery !== undefined) {
      if (!delivery.retire) throw new PrivateDeliveryInspectionError('RETIREMENT_FAILED')
      await privateBoundInspection(delivery.retire(bound), bound)
    }
    if (captureFailure) throw captureFailure
  } catch (error) {
    previews.clear()
    throw error instanceof PrivateDeliveryInspectionError
      ? error
      : new PrivateDeliveryInspectionError('RETIREMENT_FAILED')
  }
  let closed = false
  return Object.freeze({
    generation: randomBytes(16).toString('hex'),
    files,
    preview(path: string) {
      return closed ? undefined : previews.get(path)
    },
    close() {
      closed = true
      previews.clear()
    },
  })
}
