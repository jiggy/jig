import type {
  DisplayPreviewReply,
  DisplaySnapshot,
  DisplaySnapshotEnvelope,
} from '@jigging/display-model'
import { validateDisplaySnapshot, validDisplayImage } from '@jigging/display-model'

const SNAPSHOT_BYTES = 16 * 1024 * 1024
const PREVIEW_BYTES = 1 * 1024 * 1024
export type PrivateBrowserConnection =
  | 'connecting'
  | 'current'
  | 'disconnected'
  | 'unauthorized'
  | 'closed'
export type PrivateBrowserPreviewIntent = Readonly<{
  artifactId: string
  captureGeneration: string
  signature: string
}>
export type PrivateBrowserPreview = Readonly<{
  intent: PrivateBrowserPreviewIntent
  phase: 'loading' | 'ready' | 'unavailable'
  reply?: DisplayPreviewReply
}>

export function privateBrowserCapability(fragment: string): string | undefined {
  return /^#cap=([A-Za-z0-9_-]{43})$/.exec(fragment)?.[1]
}

/** Incremental ASCII SSE parser. Only one latest revision and bounded partial text. */
export class PrivateRevisionReader {
  #partial = ''
  #event = ''
  #data = ''
  #eventBytes = 0
  push(chunk: string): number | undefined {
    let highest: number | undefined
    let start = 0
    for (let index = 0; index < chunk.length; index++) {
      const code = chunk.charCodeAt(index)
      if (code > 127 || (code < 32 && code !== 10 && code !== 13))
        throw new Error('Invalid observation stream')
      if (code !== 10) continue
      const line = this.#partial + chunk.slice(start, index)
      if (line.length > 2048) throw new Error('Observation stream capacity reached')
      this.#partial = ''
      start = index + 1
      const revision = this.#line(line.endsWith('\r') ? line.slice(0, -1) : line)
      if (revision !== undefined) highest = Math.max(highest ?? 0, revision)
    }
    if (this.#eventBytes + this.#partial.length + chunk.length - start > 2048)
      throw new Error('Observation stream capacity reached')
    this.#partial += chunk.slice(start)
    return highest
  }
  #line(line: string): number | undefined {
    this.#eventBytes += line.length + 1
    if (this.#eventBytes > 512) throw new Error('Observation event capacity reached')
    if (!line) {
      let revision: number | undefined
      if (this.#event || this.#data) {
        if (this.#event !== 'revision' || !/^[1-9][0-9]{0,15}$/.test(this.#data))
          throw new Error('Invalid observation revision')
        revision = Number(this.#data)
        if (!Number.isSafeInteger(revision)) throw new Error('Invalid observation revision')
      }
      this.#event = ''
      this.#data = ''
      this.#eventBytes = 0
      return revision
    }
    if (line.startsWith(':')) return
    if (line.startsWith('event: ') && !this.#event) this.#event = line.slice(7)
    else if (line.startsWith('data: ') && !this.#data) this.#data = line.slice(6)
    else throw new Error('Invalid observation stream')
    return undefined
  }
}

async function boundedJson(
  response: Response,
  maximum: number,
  signal: AbortSignal,
): Promise<{ value: unknown; bytes: number }> {
  const reader = response.body?.getReader()
  if (!reader) throw new Error('Response unavailable')
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let text = ''
  let bytes = 0
  try {
    while (true) {
      const item = await reader.read()
      if (signal.aborted) throw new Error('Response superseded')
      if (item.done) break
      bytes += item.value.byteLength
      if (bytes > maximum) throw new Error('Response capacity reached')
      text += decoder.decode(item.value, { stream: true })
    }
    text += decoder.decode()
    return { value: JSON.parse(text), bytes }
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

type ClientOptions = Readonly<{
  fetch?: typeof fetch
  schedule?: (callback: () => void, milliseconds: number) => unknown
  cancel?: (handle: unknown) => void
  random?: () => number
}>

/** One browser's observation owner. It never submits/retries execution. */
export class PrivateBrowserClient {
  body: DisplaySnapshot | undefined
  current: DisplaySnapshotEnvelope | undefined
  connection: PrivateBrowserConnection = 'connecting'
  preview: PrivateBrowserPreview | undefined
  synchronizedAt = 0
  #capability: string | undefined
  #fetch: typeof fetch
  #schedule: NonNullable<ClientOptions['schedule']>
  #cancel: NonNullable<ClientOptions['cancel']>
  #random: () => number
  #changed: () => void
  #generation = 0
  #selectionGeneration = 0
  #highest = 0
  #stream: AbortController | undefined
  #snapshot: AbortController | undefined
  #previewRequest: AbortController | undefined
  #intent: PrivateBrowserPreviewIntent | undefined
  #mediaIntents: readonly PrivateBrowserPreviewIntent[] = []
  #mediaRequest: AbortController | undefined
  #mediaGeneration = 0
  #mediaSettled = new Set<string>()
  #mediaCache = new Map<string, { reply: DisplayPreviewReply; charge: number }>()
  #mediaBytes = 0
  #downloadRequest: AbortController | undefined
  #retry: unknown
  #retrying = false
  #attempt = 0
  #closed = false
  constructor(capability: string, changed: () => void, options: ClientOptions = {}) {
    this.#capability = capability
    this.#changed = changed
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis)
    this.#schedule = options.schedule ?? ((callback, ms) => setTimeout(callback, ms))
    this.#cancel =
      options.cancel ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>))
    this.#random = options.random ?? Math.random
  }
  get generation(): number {
    return this.#generation
  }
  get bodyStale(): boolean {
    return this.current?.kind === 'incomplete'
  }
  get referencesEnabled(): boolean {
    return this.observationFresh && !this.bodyStale && !!this.body
  }
  get observationFresh(): boolean {
    return (
      !this.#closed &&
      this.connection === 'current' &&
      (this.current?.revision ?? 0) >= this.#highest
    )
  }
  start(): void {
    if (this.#closed) return
    void this.#connect()
    void this.#capture()
  }
  #headers(): Record<string, string> {
    return { Authorization: `Bearer ${this.#capability}` }
  }
  #retryLater(retryAfter?: string | null): void {
    if (this.#closed || this.#retrying) return
    this.#retrying = true
    const supplied = retryAfter && /^[0-9]{1,2}$/.test(retryAfter) ? Number(retryAfter) : 0
    const delay = Math.min(
      15000,
      Math.max(
        1000,
        supplied * 1000,
        Math.min(15000, 1000 * 2 ** Math.min(this.#attempt++, 4)) + this.#random() * 250,
      ),
    )
    this.#retry = this.#schedule(() => {
      this.#retrying = false
      this.#retry = undefined
      if (this.#closed) return
      void this.#connect()
      void this.#capture()
      void this.#loadPreview()
      void this.#loadMedia()
    }, delay)
  }
  #terminal(status: number): boolean {
    if (status !== 401 && status !== 403 && status !== 410) return false
    this.connection = status === 410 ? 'closed' : 'unauthorized'
    this.stop()
    return true
  }
  #lost(): void {
    if (this.#closed) return
    this.#generation++
    this.#snapshot?.abort()
    this.#previewRequest?.abort()
    this.#mediaRequest?.abort()
    this.#downloadRequest?.abort()
    if (this.#intent) this.preview = { intent: this.#intent, phase: 'loading' }
    this.connection = 'disconnected'
    this.#changed()
    this.#retryLater()
  }
  async #connect(): Promise<void> {
    if (this.#closed || this.#stream || this.#retrying) return
    const controller = new AbortController()
    this.#stream = controller
    const generation = this.#generation
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
    try {
      const response = await this.#fetch('/api/events', {
        headers: this.#headers(),
        signal: controller.signal,
        credentials: 'omit',
        cache: 'no-store',
      })
      if (this.#closed || generation !== this.#generation) return
      if (this.#terminal(response.status)) return
      if (!response.ok) {
        this.#retryLater(response.headers.get('Retry-After'))
        throw new Error('Observation unavailable')
      }
      reader = response.body?.getReader()
      if (!reader) throw new Error('Observation unavailable')
      const decoder = new TextDecoder('utf-8', { fatal: true })
      const parser = new PrivateRevisionReader()
      while (true) {
        const item = await reader.read()
        if (this.#closed || controller.signal.aborted || generation !== this.#generation) return
        if (item.done) throw new Error('Observation disconnected')
        const revision = parser.push(decoder.decode(item.value, { stream: true }))
        if (revision !== undefined) {
          this.#highest = Math.max(this.#highest, revision)
          if ((this.current?.revision ?? 0) < this.#highest || this.connection !== 'current') {
            if (this.#intent) this.preview = { intent: this.#intent, phase: 'loading' }
            this.#changed()
            void this.#capture()
          }
        }
      }
    } catch {
      if (!this.#closed && !controller.signal.aborted && generation === this.#generation)
        this.#lost()
    } finally {
      await reader?.cancel().catch(() => {})
      reader?.releaseLock()
      if (this.#stream === controller) this.#stream = undefined
    }
  }
  async #capture(): Promise<void> {
    if (this.#closed || this.#snapshot || this.#retrying) return
    const controller = new AbortController()
    this.#snapshot = controller
    const generation = this.#generation
    try {
      const response = await this.#fetch('/api/snapshot', {
        headers: this.#headers(),
        signal: controller.signal,
        credentials: 'omit',
        cache: 'no-store',
      })
      if (this.#closed || generation !== this.#generation) return
      if (this.#terminal(response.status)) return
      if (!response.ok) {
        this.#retryLater(response.headers.get('Retry-After'))
        throw new Error('Snapshot unavailable')
      }
      const incoming = await boundedJson(response, SNAPSHOT_BYTES, controller.signal)
      const value = validateDisplaySnapshot(incoming.value)
      if (this.#closed || controller.signal.aborted || generation !== this.#generation) return
      if (
        !value ||
        (value.kind !== 'snapshot' && value.kind !== 'incomplete') ||
        !Number.isSafeInteger(value.revision) ||
        value.revision < 1
      )
        throw new Error('Snapshot unavailable')
      if (value.kind === 'incomplete' && incoming.bytes > 2 * 1024 * 1024)
        throw new Error('Snapshot capacity reached')
      if (value.revision > (this.current?.revision ?? 0)) {
        this.current = value
        if (value.kind === 'snapshot') this.body = value
      }
      if (value.revision < this.#highest) {
        // A readable response behind a notification is synchronization, not
        // connection loss. Freshness still fences every reference/preview.
        this.connection = 'current'
        this.#retryLater()
      } else {
        this.connection = 'current'
        this.synchronizedAt = Date.now()
        this.#attempt = 0
      }
      if (this.bodyStale) this.setPreview(undefined)
      const captures = new Set([this.body?.artifacts.generation, this.body?.inputs?.generation])
      for (const [key, entry] of this.#mediaCache)
        if (!captures.has(entry.reply.captureGeneration)) {
          this.#mediaCache.delete(key)
          this.#mediaBytes -= entry.charge
        }
      this.#changed()
    } catch {
      if (!this.#closed && !controller.signal.aborted && generation === this.#generation) {
        this.connection = 'disconnected'
        this.#changed()
        this.#retryLater()
      }
    } finally {
      if (this.#snapshot === controller) this.#snapshot = undefined
      if (!this.#closed && !this.#retrying && this.connection === 'current') {
        void this.#loadPreview()
        void this.#loadMedia()
      }
      if (!this.#closed && !this.#retrying && (this.current?.revision ?? 0) < this.#highest)
        void this.#capture()
    }
  }
  setPreview(intent: PrivateBrowserPreviewIntent | undefined): void {
    if (this.#closed) return
    if (JSON.stringify(intent) === JSON.stringify(this.#intent)) return
    this.#selectionGeneration++
    this.#intent = intent
    this.#previewRequest?.abort()
    this.#mediaRequest?.abort()
    this.preview = intent ? { intent, phase: 'loading' } : undefined
    this.#changed()
    void this.#loadPreview()
  }
  async #loadPreview(): Promise<void> {
    const intent = this.#intent
    if (
      this.#closed ||
      !intent ||
      !this.referencesEnabled ||
      this.#previewRequest ||
      this.#mediaRequest ||
      this.#retrying ||
      this.preview?.phase !== 'loading'
    )
      return
    const controller = new AbortController()
    this.#previewRequest = controller
    const generation = this.#generation
    const selection = this.#selectionGeneration
    try {
      if (
        typeof intent.artifactId !== 'string' ||
        !intent.artifactId ||
        intent.artifactId.length > 512 ||
        [...intent.artifactId].length > 256
      )
        throw new Error('Preview unavailable')
      const response = await this.#fetch(
        `/api/artifacts/${encodeURIComponent(intent.artifactId)}/preview`,
        {
          headers: this.#headers(),
          signal: controller.signal,
          credentials: 'omit',
          cache: 'no-store',
        },
      )
      if (
        this.#closed ||
        generation !== this.#generation ||
        selection !== this.#selectionGeneration
      )
        return
      if (this.#terminal(response.status)) return
      if (response.status === 429) {
        this.#retryLater(response.headers.get('Retry-After'))
        return
      }
      if (!response.ok) throw new Error('Preview unavailable')
      const reply = (await boundedJson(response, PREVIEW_BYTES, controller.signal))
        .value as DisplayPreviewReply
      if (
        this.#closed ||
        controller.signal.aborted ||
        generation !== this.#generation ||
        selection !== this.#selectionGeneration ||
        this.#intent !== intent ||
        !this.referencesEnabled
      )
        return
      if (
        reply.artifactId !== intent.artifactId ||
        reply.captureGeneration !== intent.captureGeneration ||
        reply.provenance !== this.#captureFor(intent)?.provenance ||
        !['text', 'empty', 'image', 'non-text', 'unavailable'].includes(reply.state) ||
        !Number.isSafeInteger(reply.bytes) ||
        reply.bytes < 0 ||
        typeof reply.clipped !== 'boolean' ||
        (reply.state === 'image' ? !validDisplayImage(reply.image) : reply.image !== undefined) ||
        (reply.state === 'text' && typeof reply.text !== 'string') ||
        (reply.text !== undefined &&
          (typeof reply.text !== 'string' || new TextEncoder().encode(reply.text).length > 65536))
      )
        throw new Error('Preview unavailable')
      this.preview = { intent, phase: 'ready', reply }
      this.#changed()
    } catch {
      if (
        !this.#closed &&
        !controller.signal.aborted &&
        generation === this.#generation &&
        selection === this.#selectionGeneration
      ) {
        this.preview = { intent, phase: 'unavailable' }
        this.#changed()
      }
    } finally {
      if (this.#previewRequest === controller) this.#previewRequest = undefined
      if (!this.#closed && selection !== this.#selectionGeneration) void this.#loadPreview()
      void this.#loadMedia()
    }
  }
  #mediaKey(intent: PrivateBrowserPreviewIntent): string {
    return JSON.stringify([intent.captureGeneration, intent.artifactId, intent.signature])
  }
  #captureFor(intent: PrivateBrowserPreviewIntent) {
    return [this.body?.artifacts, this.body?.inputs].find(
      (capture) =>
        capture?.generation === intent.captureGeneration &&
        capture.files.some((file) => file.id === intent.artifactId),
    )
  }
  /** The viewer supplies only currently visible media. One transport request runs at a time. */
  setMedia(intents: readonly PrivateBrowserPreviewIntent[]): void {
    if (this.#closed) return
    const selected = intents.slice(0, 24)
    if (JSON.stringify(selected) === JSON.stringify(this.#mediaIntents)) return
    this.#mediaGeneration++
    this.#mediaIntents = selected
    // Cache eviction cannot restart an intent that remains visible.
    this.#mediaSettled = new Set(
      selected
        .map((intent) => this.#mediaKey(intent))
        .filter((key) => this.#mediaSettled.has(key) || this.#mediaCache.has(key)),
    )
    this.#mediaRequest?.abort()
    void this.#loadMedia()
  }
  mediaPreview(intent: PrivateBrowserPreviewIntent): DisplayPreviewReply | undefined {
    if (!this.referencesEnabled || !this.#captureFor(intent)) return undefined
    const key = this.#mediaKey(intent)
    const entry = this.#mediaCache.get(key)
    if (!entry) return undefined
    this.#mediaCache.delete(key)
    this.#mediaCache.set(key, entry)
    return entry.reply
  }
  async #loadMedia(): Promise<void> {
    if (
      this.#closed ||
      !this.referencesEnabled ||
      this.#retrying ||
      this.#previewRequest ||
      this.#mediaRequest ||
      this.preview?.phase === 'loading'
    )
      return
    const intent = this.#mediaIntents.find(
      (item) => this.#captureFor(item) && !this.#mediaSettled.has(this.#mediaKey(item)),
    )
    if (!intent) return
    const controller = new AbortController()
    this.#mediaRequest = controller
    const generation = this.#generation
    const selection = this.#mediaGeneration
    try {
      const response = await this.#fetch(
        `/api/artifacts/${encodeURIComponent(intent.artifactId)}/preview`,
        {
          headers: this.#headers(),
          signal: controller.signal,
          credentials: 'omit',
          cache: 'no-store',
        },
      )
      if (this.#closed || this.#terminal(response.status)) return
      if (response.status === 429) {
        this.#retryLater(response.headers.get('Retry-After'))
        return
      }
      if (!response.ok) throw new Error('Preview unavailable')
      const reply = (await boundedJson(response, PREVIEW_BYTES, controller.signal))
        .value as DisplayPreviewReply
      if (
        controller.signal.aborted ||
        this.#closed ||
        generation !== this.#generation ||
        selection !== this.#mediaGeneration ||
        !this.referencesEnabled
      )
        return
      if (
        reply.artifactId !== intent.artifactId ||
        reply.captureGeneration !== intent.captureGeneration ||
        reply.provenance !== this.#captureFor(intent)?.provenance ||
        !['text', 'empty', 'image', 'non-text', 'unavailable'].includes(reply.state) ||
        !Number.isSafeInteger(reply.bytes) ||
        reply.bytes < 0 ||
        typeof reply.clipped !== 'boolean' ||
        (reply.state === 'image' ? !validDisplayImage(reply.image) : reply.image !== undefined) ||
        (reply.state === 'text' && typeof reply.text !== 'string') ||
        (reply.text !== undefined &&
          (typeof reply.text !== 'string' || new TextEncoder().encode(reply.text).length > 65536))
      )
        throw new Error('Preview unavailable')
      this.#mediaSettled.add(this.#mediaKey(intent))
      this.#rememberMedia(intent, reply)
    } catch {
      if (
        !controller.signal.aborted &&
        !this.#closed &&
        generation === this.#generation &&
        selection === this.#mediaGeneration
      ) {
        const capture = this.#captureFor(intent)
        if (capture) {
          this.#mediaSettled.add(this.#mediaKey(intent))
          this.#rememberMedia(intent, {
            artifactId: intent.artifactId,
            captureGeneration: intent.captureGeneration,
            provenance: capture.provenance,
            state: 'unavailable',
            bytes: 0,
            clipped: false,
          })
        }
      }
    } finally {
      if (this.#mediaRequest === controller) this.#mediaRequest = undefined
      void this.#loadPreview()
      void this.#loadMedia()
    }
  }
  #rememberMedia(intent: PrivateBrowserPreviewIntent, reply: DisplayPreviewReply): void {
    const charge = JSON.stringify(reply).length * 2 + 512
    if (charge > PREVIEW_BYTES * 2 + 512) return
    const key = this.#mediaKey(intent)
    const previous = this.#mediaCache.get(key)
    if (previous) {
      this.#mediaCache.delete(key)
      this.#mediaBytes -= previous.charge
    }
    while (
      (this.#mediaBytes + charge > 8 * 1024 * 1024 || this.#mediaCache.size >= 64) &&
      this.#mediaCache.size
    ) {
      const [oldKey, old] = this.#mediaCache.entries().next().value!
      this.#mediaCache.delete(oldKey)
      this.#mediaBytes -= old.charge
    }
    this.#mediaCache.set(key, { reply, charge })
    this.#mediaBytes += charge
    this.#changed()
  }
  /** Return complete captured bytes. Clipped previews never provide download content. */
  async download(intent: PrivateBrowserPreviewIntent): Promise<Uint8Array | undefined> {
    const capture = this.#captureFor(intent)
    const file = capture?.files.find((file) => file.id === intent.artifactId)
    if (this.#closed || !this.referencesEnabled || this.#downloadRequest || !file?.downloadable)
      return undefined
    const controller = new AbortController()
    this.#downloadRequest = controller
    const generation = this.#generation
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
    const chunks: Uint8Array[] = []
    try {
      const response = await this.#fetch(
        `/api/artifacts/${encodeURIComponent(intent.artifactId)}/download`,
        {
          headers: { ...this.#headers(), 'X-Jig-Capture-Generation': intent.captureGeneration },
          signal: controller.signal,
          credentials: 'omit',
          cache: 'no-store',
        },
      )
      if (
        this.#terminal(response.status) ||
        !response.ok ||
        response.headers.get('X-Jig-Capture-Generation') !== intent.captureGeneration
      )
        return undefined
      reader = response.body?.getReader()
      if (!reader) return undefined
      let length = 0
      while (true) {
        const item = await reader.read()
        if (
          controller.signal.aborted ||
          this.#closed ||
          generation !== this.#generation ||
          !this.referencesEnabled ||
          !this.#captureFor(intent)
        )
          return undefined
        if (item.done) break
        length += item.value.length
        if (length > 16 * 1024 * 1024 || length > file.bytes) return undefined
        chunks.push(item.value)
      }
      if (length !== file.bytes) return undefined
      const result = new Uint8Array(length)
      let offset = 0
      for (const chunk of chunks) {
        result.set(chunk, offset)
        offset += chunk.length
      }
      return result
    } catch {
      return undefined
    } finally {
      await reader?.cancel().catch(() => {})
      reader?.releaseLock()
      if (this.#downloadRequest === controller) this.#downloadRequest = undefined
    }
  }
  async closeInspection(): Promise<boolean> {
    if (this.#closed) return this.connection === 'closed'
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10000)
    try {
      const response = await this.#fetch('/api/close', {
        method: 'POST',
        headers: this.#headers(),
        signal: controller.signal,
        credentials: 'omit',
        cache: 'no-store',
      })
      if (!response.ok && response.status !== 410) return false
      this.connection = 'closed'
      this.stop()
      return true
    } catch {
      return false
    } finally {
      clearTimeout(timeout)
    }
  }
  stop(): void {
    this.#closed = true
    this.#generation++
    this.#selectionGeneration++
    this.#stream?.abort()
    this.#snapshot?.abort()
    this.#previewRequest?.abort()
    this.#mediaRequest?.abort()
    this.#downloadRequest?.abort()
    this.#mediaIntents = []
    this.#mediaSettled.clear()
    this.#mediaCache.clear()
    this.#mediaBytes = 0
    if (this.#retrying) this.#cancel(this.#retry)
    this.#retrying = false
    this.#retry = undefined
    this.#intent = undefined
    this.preview = undefined
    this.#capability = undefined
    this.body = undefined
    this.current = undefined
    this.#changed()
  }
}
