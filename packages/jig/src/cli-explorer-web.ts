import { randomBytes, timingSafeEqual } from 'node:crypto'
import {
  DISPLAY_PROJECT_BYTE_LIMIT,
  DISPLAY_PROJECT_RUN_REQUEST_BYTE_LIMIT,
  validateDisplayProjectRun,
  validateDisplayProjectRunRequest,
  validateDisplayProjectSnapshot,
  type DisplayProjectRun,
  type DisplayProjectRunRequest,
  type DisplayProjectSnapshot,
  type WebAssets,
} from '@jigging/display-model'
import { decodeJson1 } from './json.js'
import { PRIVATE_EXPLORER_LIMITS } from './cli-explore-policy.js'
import { PrivateProjectProjectionError } from './cli-project-projection.js'

type Server = {
  readonly port: number
  timeout(request: Request, seconds: number): void
  stop(closeActiveConnections: boolean): Promise<void> | void
}
const runtime = globalThis as unknown as {
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
    }): Server
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
    "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; frame-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
})
const encoder = new TextEncoder()
const jsonType = 'application/json; charset=utf-8'
const assetPaths = ['/', '/assets/app.js', '/assets/app.css']

export type PrivateExplorerRunEvent =
  | Readonly<{ event: 'viewer'; url: string }>
  | Readonly<{ event: 'settled' }>
export type PrivateExplorerRunBridge = Readonly<{
  url: string
  capability: string
  close(): void
}>
export type PrivateWebExplorerOptions = Readonly<{
  assets: WebAssets
  project(targetId?: string): Promise<DisplayProjectSnapshot>
  session(requestId?: string): DisplayProjectRun | undefined
  run(request: DisplayProjectRunRequest): Promise<DisplayProjectRun>
  onClose(): void | Promise<void>
}>

function reply(body: string, status = 200, contentType = jsonType): Response {
  return new Response(body, { status, headers: { ...policy, 'Content-Type': contentType } })
}
function failure(reason: string, status: number, code?: string): Response {
  return reply(JSON.stringify({ reason, ...(code === undefined ? {} : { code }) }), status)
}
function authorized(request: Request, expected: Buffer): boolean {
  const header = request.headers.get('authorization')
  if (!header || !/^Bearer [A-Za-z0-9_-]{43}$/.test(header)) return false
  const actual = Buffer.from(header, 'ascii')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}
function empty(request: Request): boolean {
  const length = request.headers.get('content-length')
  return !request.headers.has('transfer-encoding') && (length === null || length === '0')
}

/** A project control capability is deliberately separate from every Run observer. */
export class PrivateWebExplorer {
  readonly #server: Server
  readonly #capability = randomBytes(32).toString('base64url')
  readonly #authorization = Buffer.from(`Bearer ${this.#capability}`, 'ascii')
  readonly origin: string
  #closing = false
  #requests = 0
  #projects = 0
  #submitting = false
  #handoffs = 0
  #bridge: { authorization: Buffer; event(value: PrivateExplorerRunEvent): void } | undefined
  #responses = new Set<() => void>()
  #bodies = new Set<() => void>()
  #bridgeBodies = new Set<() => void>()
  #closeTask: Promise<void> | undefined
  #resolveClosed!: () => void
  #rejectClosed!: (error: unknown) => void
  readonly #closed = new Promise<void>((resolve, reject) => {
    this.#resolveClosed = resolve
    this.#rejectClosed = reject
  })

  static prepare(options: PrivateWebExplorerOptions): PrivateWebExplorer {
    if (
      assetPaths.some(
        (path) => !options.assets[path]?.body || !options.assets[path]?.contentType,
      ) ||
      Object.keys(options.assets).some((path) => !assetPaths.includes(path))
    )
      throw new Error('Explorer assets are unavailable')
    return new PrivateWebExplorer(options)
  }

  private constructor(readonly options: PrivateWebExplorerOptions) {
    // The command still observes this rejection through closed().
    void this.#closed.catch(() => {})
    this.#server = runtime.Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      development: false,
      reusePort: false,
      maxRequestBodySize: DISPLAY_PROJECT_RUN_REQUEST_BYTE_LIMIT,
      idleTimeout: 10,
      fetch: (request) => this.#handle(request),
      error: () => failure('The explorer request is unavailable.', 500),
    })
    this.origin = `http://127.0.0.1:${this.#server.port}`
  }

  get launchUrl(): string {
    return `${this.origin}/explore#cap=${this.#capability}`
  }

  closed(): Promise<void> {
    return this.#closed
  }

  registerRunBridge(event: (value: PrivateExplorerRunEvent) => void): PrivateExplorerRunBridge {
    if (this.#closing || this.#bridge) throw new Error('Explorer Run bridge is unavailable')
    const capability = randomBytes(32).toString('base64url')
    const bridge = { authorization: Buffer.from(`Bearer ${capability}`, 'ascii'), event }
    this.#bridge = bridge
    return {
      url: `${this.origin}/internal/run`,
      capability,
      close: () => {
        bridge.authorization.fill(0)
        if (this.#bridge === bridge) this.#bridge = undefined
      },
    }
  }

  close(): Promise<void> {
    if (this.#closeTask) return this.#closeTask
    this.#closing = true
    for (const cancel of this.#bodies) cancel()
    for (const cancel of this.#responses) cancel()
    this.#closeTask = (async () => {
      try {
        // Keep the child-only settlement channel alive while the ordinary owner closes.
        await this.options.onClose()
      } finally {
        this.#bridge?.authorization.fill(0)
        this.#bridge = undefined
        this.#authorization.fill(0)
        for (const cancel of this.#bodies) cancel()
        for (const cancel of this.#bridgeBodies) cancel()
        for (const cancel of this.#responses) cancel()
        await this.#server.stop(true)
      }
    })()
    void this.#closeTask.then(this.#resolveClosed, this.#rejectClosed)
    return this.#closeTask
  }

  async #handle(request: Request): Promise<Response> {
    try {
      if (Buffer.byteLength(request.url) > 2048) return failure('Invalid explorer request.', 400)
      const url = new URL(request.url)
      if (
        url.origin !== this.origin ||
        request.headers.get('host') !== this.origin.slice('http://'.length) ||
        url.username ||
        url.password ||
        url.hash ||
        url.pathname.includes('%')
      )
        return failure('Explorer access was refused.', 403)
      const origin = request.headers.get('origin')
      const site = request.headers.get('sec-fetch-site')
      const asset =
        url.pathname === '/explore'
          ? this.options.assets['/']
          : assetPaths.includes(url.pathname) && url.pathname !== '/'
            ? this.options.assets[url.pathname]
            : undefined
      if (asset) {
        if (this.#closing) return failure('The explorer is closing.', 410)
        if (request.method !== 'GET' || url.search || !empty(request))
          return failure('Invalid explorer request.', 400)
        if (this.#requests >= PRIVATE_EXPLORER_LIMITS.httpRequests)
          return failure('The explorer is busy.', 429)
        this.#requests++
        return this.#stream(asset.body, asset.contentType, request, () => this.#requests--)
      }
      // Terminal-link navigation uses Sec-Fetch-Site:none. Fixed assets carry no authority.
      if ((origin !== null && origin !== this.origin) || (site !== null && site !== 'same-origin'))
        return failure('Explorer access was refused.', 403)
      if (url.pathname === '/internal/run') return await this.#child(request, url)
      if (this.#closing) return failure('The explorer is closing.', 410)
      if (!authorized(request, this.#authorization))
        return failure('Explorer access was refused.', 403)
      if (this.#requests >= PRIVATE_EXPLORER_LIMITS.httpRequests)
        return failure('The explorer is busy.', 429)
      this.#requests++
      let owned = true
      const release = () => {
        if (!owned) return
        owned = false
        this.#requests--
      }
      try {
        if (url.pathname === '/api/project' && request.method === 'GET') {
          const fields = [...url.searchParams.keys()]
          const target = url.searchParams.get('target')
          if (
            !empty(request) ||
            fields.length > 1 ||
            fields.some((field) => field !== 'target') ||
            (target !== null && !/^[A-Za-z0-9_-]{1,256}$/.test(target))
          )
            return failure('Invalid workflow selection.', 400)
          if (this.#projects >= PRIVATE_EXPLORER_LIMITS.projectResponses)
            return failure('The explorer is busy.', 429)
          this.#projects++
          try {
            let supplied: DisplayProjectSnapshot
            try {
              supplied = await this.options.project(target ?? undefined)
            } catch (error) {
              if (
                error instanceof PrivateProjectProjectionError &&
                ['PROJECT_CHANGED', 'TARGET_MISSING', 'PROJECT_UNREVIEWED'].includes(error.code)
              )
                return failure(
                  error.message,
                  error.code === 'TARGET_MISSING' ? 404 : 409,
                  error.code,
                )
              throw error
            }
            const project = validateDisplayProjectSnapshot(supplied)
            if (this.#closing) return failure('The explorer is closing.', 410)
            const body = JSON.stringify(project)
            if (Buffer.byteLength(body) > DISPLAY_PROJECT_BYTE_LIMIT)
              return failure('The approved project exceeds the exploration allowance.', 503)
            const result = this.#stream(body, jsonType, request, () => {
              this.#projects--
              this.#requests--
            })
            owned = false
            return result
          } finally {
            if (owned) this.#projects--
          }
        }
        if (url.pathname === '/api/run' && request.method === 'GET') {
          const fields = [...url.searchParams.keys()]
          const requestId = url.searchParams.get('requestId')
          if (
            !empty(request) ||
            fields.length > 1 ||
            fields.some((field) => field !== 'requestId') ||
            (requestId !== null && !/^[A-Za-z0-9_-]{1,128}$/.test(requestId))
          )
            return failure('Invalid explorer request.', 400)
          const state = this.options.session(requestId ?? undefined)
          if (requestId !== null && state === undefined)
            return failure(
              'No retained result is available for this request. This does not confirm that it did not start.',
              404,
              'REQUEST_UNKNOWN',
            )
          const run = validateDisplayProjectRun(state)
          if (requestId !== null && (run.state === 'idle' || run.requestId !== requestId))
            return failure('The retained request result is unavailable.', 503)
          return reply(JSON.stringify(run))
        }
        if (url.search) return failure('Invalid explorer request.', 400)
        if (url.pathname === '/api/run' && request.method === 'POST') {
          if (origin !== this.origin) return failure('Explorer access was refused.', 403)
          if (this.#submitting) return failure('A launch request is already being processed.', 409)
          this.#submitting = true
          try {
            let value: DisplayProjectRunRequest
            try {
              value = validateDisplayProjectRunRequest(
                await this.#body(request, DISPLAY_PROJECT_RUN_REQUEST_BYTE_LIMIT),
              )
            } catch {
              return failure('Supply one bounded JSON input and a current workflow selection.', 400)
            }
            if (this.#closing || request.signal.aborted)
              return failure('The explorer request ended.', 410)
            const state = await this.options.run(value)
            return reply(JSON.stringify(validateDisplayProjectRun(state)))
          } finally {
            this.#submitting = false
          }
        }
        if (url.pathname === '/api/close' && request.method === 'POST') {
          if (origin !== this.origin) return failure('Explorer access was refused.', 403)
          if (!empty(request)) return failure('Invalid explorer request.', 400)
          // Fence starts immediately, with a short opportunity to deliver the close reply.
          this.#closing = true
          setTimeout(() => void this.close().catch(() => {}), 25)
          return reply('{"closed":true}')
        }
        return failure('The explorer request is unavailable.', 404)
      } finally {
        if (owned) release()
      }
    } catch {
      return failure(
        'The explorer request could not complete. Check the terminal for details.',
        503,
      )
    }
  }

  async #child(request: Request, url: URL): Promise<Response> {
    const bridge = this.#bridge
    if (!bridge || !authorized(request, bridge.authorization))
      return failure('Run handoff was refused.', 403)
    if (request.method !== 'POST' || url.search) return failure('Invalid Run handoff.', 400)
    if (this.#handoffs >= 1) return failure('Run handoff is busy.', 429)
    this.#handoffs++
    try {
      const value = await this.#body(
        request,
        PRIVATE_EXPLORER_LIMITS.handoffBytes,
        this.#bridgeBodies,
      )
      if (this.#bridge !== bridge || !value || typeof value !== 'object' || Array.isArray(value))
        return failure('Run handoff was refused.', 403)
      const data = value as Record<string, unknown>
      let event: PrivateExplorerRunEvent
      if (data.event === 'settled' && Object.keys(data).length === 1) event = { event: 'settled' }
      else if (
        data.event === 'viewer' &&
        Object.keys(data).length === 2 &&
        typeof data.url === 'string'
      ) {
        // The shared status validator checks the exact numeric loopback viewer URL.
        validateDisplayProjectRun({
          state: 'running',
          requestId: 'handoff',
          targetId: 'handoff',
          viewerUrl: data.url,
        })
        event = { event: 'viewer', url: data.url }
      } else return failure('Invalid Run handoff.', 400)
      bridge.event(event)
      return reply('{"ok":true}')
    } catch {
      return failure('Invalid Run handoff.', 400)
    } finally {
      this.#handoffs--
    }
  }

  async #body(request: Request, limit: number, owners = this.#bodies): Promise<unknown> {
    if (
      !/^application\/json(?:;\s*charset=utf-8)?$/i.test(
        request.headers.get('content-type') ?? '',
      ) ||
      request.headers.has('content-encoding')
    )
      throw new Error('Invalid request encoding')
    const length = request.headers.get('content-length')
    if (length !== null && (!/^(0|[1-9][0-9]*)$/.test(length) || Number(length) > limit))
      throw new Error('Invalid request size')
    const reader = request.body?.getReader()
    if (!reader) throw new Error('Request body is missing')
    let cancelled = false
    const cancel = () => {
      cancelled = true
      void reader.cancel().catch(() => {})
    }
    owners.add(cancel)
    request.signal.addEventListener('abort', cancel, { once: true })
    const timer = setTimeout(cancel, PRIVATE_EXPLORER_LIMITS.bodyReadMs)
    const chunks: Uint8Array[] = []
    let size = 0
    try {
      if (request.signal.aborted) cancel()
      while (!cancelled) {
        const part = await reader.read()
        if (part.done) break
        size += part.value.byteLength
        if (size > limit) throw new Error('Request body exceeds its allowance')
        chunks.push(part.value)
      }
      if (cancelled || (length !== null && size !== Number(length)))
        throw new Error('Request body ended')
      const bytes = new Uint8Array(size)
      let offset = 0
      for (const chunk of chunks) {
        bytes.set(chunk, offset)
        offset += chunk.byteLength
      }
      return decodeJson1(bytes)
    } finally {
      clearTimeout(timer)
      owners.delete(cancel)
      request.signal.removeEventListener('abort', cancel)
      await reader.cancel().catch(() => {})
      reader.releaseLock()
    }
  }

  #stream(body: string, contentType: string, request: Request, release: () => void): Response {
    let offset = 0
    let done = false
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined
    const finish = () => {
      if (done) return
      done = true
      body = ''
      request.signal.removeEventListener('abort', abort)
      this.#responses.delete(abort)
      release()
    }
    const abort = () => {
      if (done) return
      finish()
      try {
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
}
