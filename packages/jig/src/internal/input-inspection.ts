import { randomBytes } from 'node:crypto'
import type { PrivatePreview } from '../cli-run-model.js'
import type { PrivateCapturedAttachment } from './file-input.js'
import { privateImagePreview, privateImageSourceCandidate } from './image-preview.js'
import { PRIVATE_PREVIEW_LIMITS, privatePreviewStringBytes } from './image-preview-policy.js'
import { readPrivateCapturedInput } from './input-capture.js'
import { privatePresentationNow } from './root-run-timeout-policy.js'

type Entry = {
  attachment: string
  path: string
  bytes: Buffer
  state: 'text' | 'empty' | 'image' | 'non-text'
  text?: string
  clipped: boolean
}

/** Detached selected members of the original immutable input set. */
export class PrivateInputInspectionCapture {
  #generation = randomBytes(16).toString('hex')
  #source = new Map<string, PrivateCapturedAttachment['files'][number]>()
  #entries = new Map<string, Entry>()
  #images = new Map<string, NonNullable<PrivatePreview['image']>>()
  #imageBytes = 0
  #pending: Promise<PrivatePreview | undefined> | undefined
  readonly #cancel = new AbortController()
  #closed = false
  #close: Promise<void> | undefined

  constructor(
    attachments: readonly PrivateCapturedAttachment[],
    readonly changed = () => {},
  ) {
    for (const attachment of attachments)
      for (const file of attachment.files) this.#source.set(`${attachment.name}/${file.path}`, file)
  }
  get generation(): string {
    return this.#generation
  }
  get phase(): 'ready' | 'unavailable' {
    return this.#closed ? 'unavailable' : 'ready'
  }
  get files() {
    return [...this.#entries.values()].map((entry) => ({
      attachment: entry.attachment,
      path: entry.path,
      bytes: entry.bytes.length,
      state: entry.state,
      clipped: entry.clipped,
      downloadable: entry.bytes.length <= 16 * 1024 * 1024,
    }))
  }
  select(selection: readonly Readonly<{ attachment: string; path: string }>[]): void {
    if (this.#closed) return
    // Unavailable authored references cannot displace actual captured members.
    const keys = new Map(selection.map((item) => [`${item.attachment}/${item.path}`, item]))
    for (const key of keys.keys())
      if (!this.#entries.has(key) && !this.#source.has(key)) keys.delete(key)
    if (keys.size > 64) throw new TypeError('Selected input inspection exceeds its file limit')
    let bytes = 0
    const next = new Map<string, Entry>()
    try {
      for (const [key, item] of keys) {
        let entry = this.#entries.get(key)
        if (!entry) {
          const file = this.#source.get(key)
          if (!file) continue
          const content = readPrivateCapturedInput(file.input)
          const clipped = content.length > PRIVATE_PREVIEW_LIMITS.textBytes
          let text: string | undefined
          try {
            text = new TextDecoder('utf-8', { fatal: true }).decode(
              content.subarray(0, PRIVATE_PREVIEW_LIMITS.textBytes),
              { stream: clipped },
            )
          } catch {
            /* Binary input remains downloadable. */
          }
          entry = {
            attachment: item.attachment,
            path: item.path,
            bytes: content,
            state: privateImageSourceCandidate(content.subarray(0, 1024))
              ? 'image'
              : !content.length
                ? 'empty'
                : text !== undefined
                  ? 'text'
                  : 'non-text',
            ...(text === undefined ? {} : { text }),
            clipped,
          }
        }
        bytes += entry.bytes.length
        if (bytes > 64 * 1024 * 1024) {
          if (!this.#entries.has(key)) entry.bytes.fill(0)
          throw new TypeError('Selected input inspection exceeds its byte limit')
        }
        next.set(key, entry)
      }
    } catch (error) {
      for (const [key, entry] of next) if (!this.#entries.has(key)) entry.bytes.fill(0)
      throw error
    }
    let changed = next.size !== this.#entries.size
    for (const [key, entry] of this.#entries)
      if (!next.has(key)) {
        changed = true
        entry.bytes.fill(0)
        const image = this.#images.get(key)
        if (image) this.#imageBytes -= privatePreviewStringBytes(image.base64)
        this.#images.delete(key)
      }
    this.#entries = next
    if (changed) {
      this.#generation = randomBytes(16).toString('hex')
      this.changed()
    }
  }
  read(key: string): Uint8Array | undefined {
    const entry = this.#closed ? undefined : this.#entries.get(key)
    return entry ? new Uint8Array(entry.bytes) : undefined
  }
  preview(key: string): Promise<PrivatePreview | undefined> {
    const entry = this.#closed ? undefined : this.#entries.get(key)
    if (!entry) return Promise.resolve(undefined)
    const fallback =
      entry.text === undefined
        ? undefined
        : { text: entry.text, bytes: entry.bytes.length, clipped: entry.clipped }
    const image = this.#images.get(key)
    if (image) {
      this.#images.delete(key)
      this.#images.set(key, image)
      return Promise.resolve({ text: '', bytes: entry.bytes.length, clipped: false, image })
    }
    if (entry.state !== 'image' || this.#pending) return Promise.resolve(fallback)
    // The process owns this copy even when selection removes the retained member.
    const source = Buffer.from(entry.bytes)
    const task = (async () => {
      try {
        const image = await privateImagePreview(
          source,
          this.#cancel.signal,
          privatePresentationNow() + PRIVATE_PREVIEW_LIMITS.renderMs,
        )
        if (this.#closed || this.#entries.get(key) !== entry) return undefined
        if (!image) return fallback
        const charge = privatePreviewStringBytes(image.base64)
        while (this.#imageBytes + charge > 2 * 1024 * 1024 && this.#images.size) {
          const [oldKey, oldImage] = this.#images.entries().next().value!
          this.#images.delete(oldKey)
          this.#imageBytes -= privatePreviewStringBytes(oldImage.base64)
        }
        if (charge > 2 * 1024 * 1024) return fallback
        this.#images.set(key, image)
        this.#imageBytes += charge
        return { text: '', bytes: entry.bytes.length, clipped: false, image }
      } finally {
        source.fill(0)
      }
    })()
    this.#pending = task
    void task
      .finally(() => {
        if (this.#pending === task) this.#pending = undefined
      })
      .catch(() => {})
    return task
  }
  ready(): Promise<void> {
    return this.#pending?.then(() => undefined) ?? Promise.resolve()
  }
  retireSource(): void {
    this.#source.clear()
  }
  close(): Promise<void> {
    this.#close ??= (async () => {
      this.#closed = true
      this.#cancel.abort()
      try {
        await this.#pending
      } finally {
        this.#source.clear()
        for (const entry of this.#entries.values()) entry.bytes.fill(0)
        this.#entries.clear()
        this.#images.clear()
        this.#imageBytes = 0
      }
    })()
    return this.#close
  }
}
