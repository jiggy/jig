import { randomBytes, timingSafeEqual } from 'node:crypto'
import type { WebAssets } from '@jigging/display-model'
import type {
  DisplayIncompleteSnapshot,
  DisplayPreviewReply,
  DisplaySnapshotEnvelope,
} from '@jigging/display-model'

const SNAPSHOT_BYTES = 8 * 1024 * 1024
const INCOMPLETE_BYTES = 2 * 1024 * 1024
const PREVIEW_BYTES = 512 * 1024
const REFRESH_MS = 200
const encoder = new TextEncoder()
type PrivateWebServer = {
  readonly port: number
  timeout(request: Request, seconds: number): void
  stop(closeActiveConnections: boolean): Promise<void> | void
}
// Only the basic server operations qualified on both installed Bun pins belong here.
const webRuntime = globalThis as unknown as {
  Bun: {
    serve(options: {
      hostname: string
      port: number
      development: boolean
      reusePort: boolean
      maxRequestBodySize: number
      idleTimeout: number
      fetch(request: Request): Promise<Response>
      error(): Response
    }): PrivateWebServer
  }
}
const policy = Object.freeze({
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'Content-Security-Policy':
    "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; object-src 'none'; frame-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
})

type Projection = {
  capture(revision: number): DisplaySnapshotEnvelope
  incomplete(
    revision: number,
    reason: string,
    lastCompleteRevision?: number,
  ): DisplayIncompleteSnapshot
  preview(id: string): Promise<DisplayPreviewReply | undefined>
}
export type PrivateWebDisplayOptions = {
  assets: WebAssets
  projection: Projection
  subscribe(listener: () => void): () => void
  onClose?: () => void
  onFailure?: () => void
}
type Subscriber = {
  controller: ReadableStreamDefaultController<Uint8Array>
  pending?: number | undefined
  blockedAt?: number | undefined
  blockedTimer?: ReturnType<typeof setTimeout> | undefined
  release(discard?: boolean): void
  send(revision?: number): void
}

function response(body: string, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(body, { status, headers: { ...policy, ...headers } })
}
function failure(error: string, status: number): Response {
  return response(JSON.stringify({ error }), status, {
    'Content-Type': 'application/json; charset=utf-8',
    ...(status === 429 ? { 'Retry-After': '1' } : {}),
  })
}

/** One local read-only presentation owner. It holds no Run or filesystem authority. */
export class PrivateWebDisplay {
  readonly #server: PrivateWebServer
  readonly #authorization: Buffer
  readonly #capability: string
  readonly origin: string
  #active = false
  #closing = false
  #closeRequested = false
  #closeTimer: ReturnType<typeof setTimeout> | undefined
  #closeTask: Promise<void> | undefined
  #revision = 0
  #lastCompleteRevision: number | undefined
  #encoded = ''
  #dirty = false
  #lastProduced = 0
  #production: ReturnType<typeof setTimeout> | undefined
  #heartbeat: ReturnType<typeof setInterval> | undefined
  #unsubscribe: (() => void) | undefined
  #subscribers = new Set<Subscriber>()
  #responses = new Set<() => void>()
  readonly #shutdown = new AbortController()
  #requests = 0
  #snapshots = 0
  #previews = 0
  #resolveClosed!: () => void
  readonly #closed = new Promise<void>((resolve) => (this.#resolveClosed = resolve))

  static prepare(options: PrivateWebDisplayOptions): PrivateWebDisplay {
    for (const path of ['/', '/assets/app.js', '/assets/app.css']) {
      if (!options.assets[path]?.body || !options.assets[path]?.contentType)
        throw new Error('Web display assets are unavailable')
    }
    if (
      Object.keys(options.assets).some(
        (path) => !['/', '/assets/app.js', '/assets/app.css'].includes(path),
      )
    )
      throw new Error('Web display assets are invalid')
    return new PrivateWebDisplay(options)
  }

  private constructor(readonly options: PrivateWebDisplayOptions) {
    this.#capability = randomBytes(32).toString('base64url')
    this.#authorization = Buffer.from(`Bearer ${this.#capability}`, 'ascii')
    this.#server = webRuntime.Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      development: false,
      reusePort: false,
      maxRequestBodySize: 1024,
      idleTimeout: 10,
      fetch: (request) => this.#handle(request),
      error: () => failure('unavailable', 500),
    })
    this.origin = `http://127.0.0.1:${this.#server.port}`
  }

  get active(): boolean {
    return this.#active && !this.#closing && !this.#closeRequested
  }
  /** The caller may publish this only through the intended terminal interaction. */
  get launchUrl(): string {
    return `${this.origin}/#cap=${this.#capability}`
  }
  closed(): Promise<void> {
    return this.#closed
  }

  activate(): void {
    if (this.#closing || this.#active) return
    this.#active = true
    try {
      this.#unsubscribe = this.options.subscribe(() => this.#changed())
    } catch {
      try {
        this.options.onFailure?.()
      } catch {}
      this.#closeQuietly()
      return
    }
    // Capture follows synchronous subscription: no mutation can fall between them.
    if (!this.#produce()) return
    this.#heartbeat = setInterval(() => {
      for (const subscriber of this.#subscribers) subscriber.send()
    }, 20_000)
    this.#heartbeat.unref()
  }

  refreshNow(): void {
    clearTimeout(this.#production)
    this.#production = undefined
    if (!this.active) return
    this.#dirty = true
    this.#produce()
  }

  #changed(): void {
    if (!this.active) return
    this.#dirty = true
    if (this.#production !== undefined) return
    const delay = Math.max(0, REFRESH_MS - (performance.now() - this.#lastProduced))
    this.#production = setTimeout(() => {
      this.#production = undefined
      if (this.#dirty && this.active) this.#produce()
    }, delay)
    this.#production.unref()
  }

  #produce(): boolean {
    if (!this.active) return false
    this.#dirty = false
    const revision = this.#revision + 1
    try {
      let value: DisplaySnapshotEnvelope
      let encoded: string
      try {
        value = this.options.projection.capture(revision)
        encoded = JSON.stringify(value)
        if (
          value.revision !== revision ||
          Buffer.byteLength(encoded) >
            (value.kind === 'snapshot' ? SNAPSHOT_BYTES : INCOMPLETE_BYTES)
        )
          throw new Error('Snapshot exceeds its presentation limit')
      } catch {
        value = this.options.projection.incomplete(
          revision,
          'Current presentation is incomplete. Current known causes remain available.',
          this.#lastCompleteRevision,
        )
        encoded = JSON.stringify(value)
        if (
          value.kind !== 'incomplete' ||
          value.revision !== revision ||
          Buffer.byteLength(encoded) > INCOMPLETE_BYTES
        )
          throw new Error('Incomplete presentation exceeds its limit')
      }
      // Commit readable bytes before advertising their revision.
      this.#encoded = encoded
      this.#revision = revision
      if (value.kind === 'snapshot') this.#lastCompleteRevision = revision
      this.#lastProduced = performance.now()
      for (const subscriber of this.#subscribers) subscriber.send(revision)
      return true
    } catch {
      try {
        this.options.onFailure?.()
      } catch {}
      this.#closeQuietly()
      return false
    }
  }

  #authorized(request: Request): boolean {
    const authorization = request.headers.get('authorization')
    if (!authorization || !/^Bearer [A-Za-z0-9_-]{43}$/.test(authorization)) return false
    const candidate = Buffer.from(authorization, 'ascii')
    return (
      candidate.length === this.#authorization.length &&
      timingSafeEqual(candidate, this.#authorization)
    )
  }

  async #handle(request: Request): Promise<Response> {
    try {
      if (Buffer.byteLength(request.url) > 2048) return failure('unavailable', 400)
      const url = new URL(request.url)
      if (
        url.origin !== this.origin ||
        request.headers.get('host') !== this.origin.slice('http://'.length) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash
      )
        return failure('unauthorized', 403)
      // These endpoints accept no uploaded bytes; avoid owning a trickling body reader.
      const length = request.headers.get('content-length')
      if (request.headers.has('transfer-encoding') || (length !== null && length !== '0'))
        return failure('unavailable', 400)
      if (this.#closing || this.#closeRequested) return failure('closed', 410)
      if (!this.#active) return failure('unavailable', 503)
      const asset = this.options.assets[url.pathname]
      if (asset) {
        if (request.method !== 'GET') return failure('unavailable', 405)
        if (this.#requests >= 8) return failure('capacity', 429)
        this.#requests++
        return this.#snapshotResponse(
          asset.body,
          request,
          () => this.#requests--,
          asset.contentType,
        )
      }
      if (!url.pathname.startsWith('/api/')) return failure('unavailable', 404)
      const origin = request.headers.get('origin')
      const site = request.headers.get('sec-fetch-site')
      if (
        (origin !== null && origin !== this.origin) ||
        (site !== null && site !== 'same-origin') ||
        !this.#authorized(request)
      )
        return failure('unauthorized', 403)
      if (url.pathname === '/api/events') {
        if (request.method !== 'GET') return failure('unavailable', 405)
        if (this.#subscribers.size >= 4) return failure('capacity', 429)
        this.#server.timeout(request, 0)
        return this.#events(request)
      }
      if (this.#requests >= 8) return failure('capacity', 429)
      this.#requests++
      let owned = true
      const release = () => {
        if (!owned) return
        owned = false
        this.#requests--
      }
      try {
        if (url.pathname === '/api/close') {
          if (request.method !== 'POST') return failure('unavailable', 405)
          if (origin !== this.origin) return failure('unauthorized', 403)
          // The response gets a finite drain opportunity; closing is command-wide.
          this.#closeRequested = true
          this.#closeTimer = setTimeout(() => this.#closeQuietly(), 25)
          return response('{"closed":true}', 200, {
            'Content-Type': 'application/json; charset=utf-8',
          })
        }
        if (request.method !== 'GET') return failure('unavailable', 405)
        if (url.pathname === '/api/snapshot') {
          if (this.#snapshots >= 2) return failure('capacity', 429)
          this.#snapshots++
          const body = this.#encoded
          owned = false
          return this.#snapshotResponse(body, request, () => {
            this.#snapshots--
            this.#requests--
          })
        }
        const match = /^\/api\/artifacts\/([a-f0-9]{64})\/preview$/.exec(url.pathname)
        if (!match) return failure('unavailable', 404)
        if (this.#previews >= 1) return failure('capacity', 429)
        this.#previews++
        try {
          const preview = await this.#preview(match[1]!)
          if (!this.active) return failure('closed', 410)
          if (!preview || preview.artifactId !== match[1]) return failure('unavailable', 404)
          const body = JSON.stringify(preview)
          if (Buffer.byteLength(body) > PREVIEW_BYTES) return failure('unavailable', 503)
          return response(body, 200, { 'Content-Type': 'application/json; charset=utf-8' })
        } catch {
          return failure('unavailable', 503)
        } finally {
          this.#previews--
        }
      } finally {
        release()
      }
    } catch {
      return failure('unavailable', 500)
    }
  }

  #preview(id: string): Promise<DisplayPreviewReply | undefined> {
    return new Promise((resolve, reject) => {
      let settled = false
      const finish = (work: () => void) => {
        if (settled) return
        settled = true
        this.#shutdown.signal.removeEventListener('abort', abort)
        work()
      }
      const abort = () => finish(() => resolve(undefined))
      this.#shutdown.signal.addEventListener('abort', abort, { once: true })
      if (this.#shutdown.signal.aborted) abort()
      else
        Promise.resolve()
          .then(() => this.options.projection.preview(id))
          .then(
            (value) => finish(() => resolve(value)),
            (error) => finish(() => reject(error)),
          )
    })
  }

  #snapshotResponse(
    body: string,
    request: Request,
    release: () => void,
    contentType = 'application/json; charset=utf-8',
  ): Response {
    let offset = 0
    let done = false
    const finish = () => {
      if (done) return
      done = true
      request.signal.removeEventListener('abort', abort)
      this.#responses.delete(abort)
      release()
    }
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined
    const abort = () => {
      if (done) return
      finish()
      try {
        // Discard queued bytes on cancellation/owner shutdown. Closing a stream
        // can retain its queue while a native response waits for a slow reader.
        controller?.error()
      } catch {}
    }
    const stream = new ReadableStream<Uint8Array>(
      {
        start: (value) => {
          controller = value
          this.#responses.add(abort)
          request.signal.addEventListener('abort', abort, { once: true })
          if (request.signal.aborted) abort()
        },
        pull(value) {
          if (done) return
          if (offset >= body.length) {
            finish()
            value.close()
            return
          }
          let end = Math.min(body.length, offset + 8192)
          // Do not split a UTF-16 surrogate pair across independent encodings.
          if (
            end < body.length &&
            body.charCodeAt(end - 1) >= 0xd800 &&
            body.charCodeAt(end - 1) <= 0xdbff
          )
            end--
          value.enqueue(encoder.encode(body.slice(offset, end)))
          offset = end
        },
        cancel: finish,
      },
      new ByteLengthQueuingStrategy({ highWaterMark: 1024 }),
    )
    return new Response(stream, { headers: { ...policy, 'Content-Type': contentType } })
  }

  #events(request: Request): Response {
    let subscriber: Subscriber
    let released = false
    let expiring = false
    const stream = new ReadableStream<Uint8Array>(
      {
        start: (controller) => {
          const release = (discard = true) => {
            if (released) return
            released = true
            clearTimeout(subscriber.blockedTimer)
            request.signal.removeEventListener('abort', abort)
            this.#subscribers.delete(subscriber)
            try {
              if (discard) controller.error()
              else controller.close()
            } catch {}
          }
          const abort = () => release(false)
          const expire = () => {
            if (released || expiring) return
            expiring = true
            subscriber.pending = undefined
            clearTimeout(subscriber.blockedTimer)
            subscriber.blockedTimer = undefined
            try {
              // Native transport cancellation owns queued bytes. Retain this
              // admission until its abort/cancel acknowledgment; expiry must
              // not create uncounted draining connections. The qualified pins
              // apply this idle timeout with coarse timer granularity.
              this.#server.timeout(request, 1)
            } catch {
              try {
                this.options.onFailure?.()
              } catch {}
              this.#closeQuietly()
            }
          }
          subscriber = {
            controller,
            release,
            send: (revision) => {
              if (released || expiring) return
              if (revision !== undefined) subscriber.pending = revision
              const bytes = encoder.encode(
                subscriber.pending === undefined
                  ? ': heartbeat\n\n'
                  : `event: revision\ndata: ${subscriber.pending}\n\n`,
              )
              if ((controller.desiredSize ?? 0) < bytes.byteLength) {
                subscriber.blockedAt ??= performance.now()
                subscriber.blockedTimer ??= setTimeout(expire, 30_000)
                return
              }
              subscriber.blockedAt = undefined
              clearTimeout(subscriber.blockedTimer)
              subscriber.blockedTimer = undefined
              subscriber.pending = undefined
              try {
                controller.enqueue(bytes)
              } catch {
                release()
              }
            },
          }
          this.#subscribers.add(subscriber)
          request.signal.addEventListener('abort', abort, { once: true })
          if (request.signal.aborted) release()
          // Registration and readable-revision capture are one synchronous step.
          else subscriber.send(this.#revision)
        },
        pull: () => {
          if (subscriber?.pending !== undefined) subscriber.send()
        },
        cancel: () => subscriber?.release(false),
      },
      new ByteLengthQueuingStrategy({ highWaterMark: 1024 }),
    )
    return new Response(stream, {
      headers: { ...policy, 'Content-Type': 'text/event-stream; charset=utf-8' },
    })
  }

  close(): Promise<void> {
    this.#closeTask ??= this.#dispose()
    return this.#closeTask
  }
  #closeQuietly(): void {
    void this.close().catch(() => {
      try {
        this.options.onFailure?.()
      } catch {}
    })
  }
  async #dispose(): Promise<void> {
    this.#closing = true
    this.#active = false
    // Initiate native connection cancellation before discarding response
    // queues. Reversing this order can hang graceful queues or produce an
    // unhandled stream rejection on the qualified Linux runtime.
    const stopped = (async () => this.#server.stop(true))()
    void stopped.catch(() => {})
    clearTimeout(this.#production)
    clearTimeout(this.#closeTimer)
    clearInterval(this.#heartbeat)
    try {
      this.#unsubscribe?.()
    } catch {
      try {
        this.options.onFailure?.()
      } catch {}
    }
    this.#unsubscribe = undefined
    this.#shutdown.abort()
    for (const subscriber of [...this.#subscribers]) subscriber.release()
    for (const cancel of [...this.#responses]) cancel()
    this.#encoded = ''
    this.#authorization.fill(0)
    try {
      this.options.onClose?.()
    } catch {}
    try {
      await stopped
    } finally {
      this.#resolveClosed()
    }
  }
}
