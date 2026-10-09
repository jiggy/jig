import { afterEach, expect, test } from 'bun:test'
import { connect } from 'node:net'
import { PrivateWebDisplay } from '../src/cli-web.js'
import type { DisplaySnapshot } from '@jigging/display-model'

const displays: PrivateWebDisplay[] = []
afterEach(async () => {
  await Promise.all(displays.splice(0).map((display) => display.close()))
})
function snapshot(revision: number): DisplaySnapshot {
  return {
    kind: 'snapshot',
    revision,
    mode: 'live-run',
    rootSourceId: 'root-source',
    workspace: { target: 'binding:fixture', phase: 'live', hostStage: 'Waiting', elapsedMs: 0 },
    context: 'Flow reports are provisional',
    omissions: { calls: 0, journal: { flow: 0, host: 0, diagnostic: 0 } },
    views: [],
    calls: [],
    activities: [],
    journal: [],
    attention: [],
    artifacts: {
      generation: 'capture',
      sourceId: 'root-source',
      permittedAttachments: [],
      provenance: 'verified-delivery',
      phase: 'pending',
      files: [],
    },
  }
}
function fixture(overrides: Record<string, unknown> = {}) {
  let changed: (() => void) | undefined
  let subscriptions = 0
  let closes = 0
  let failures = 0
  let text = 'Waiting'
  const display = PrivateWebDisplay.prepare({
    assets: {
      '/': { body: '<!doctype html><title>Jig</title>', contentType: 'text/html; charset=utf-8' },
      '/assets/app.js': {
        body: '/* fixed bundled host UI */',
        contentType: 'text/javascript; charset=utf-8',
      },
      '/assets/app.css': {
        body: 'body { color: inherit }',
        contentType: 'text/css; charset=utf-8',
      },
    },
    subscribe(listener) {
      changed = listener
      subscriptions++
      return () => {
        changed = undefined
        subscriptions--
      }
    },
    onClose() {
      closes++
    },
    onFailure() {
      failures++
    },
    projection: {
      capture(revision) {
        const value = snapshot(revision)
        value.workspace.hostStage = text
        return value
      },
      incomplete(revision, reason, lastCompleteRevision) {
        const value = snapshot(revision)
        return {
          kind: 'incomplete',
          revision,
          mode: value.mode,
          rootSourceId: value.rootSourceId,
          reason,
          workspace: value.workspace,
          context: value.context,
          omissions: value.omissions,
          attention: [
            {
              id: 'cause',
              attribution: { provenance: 'host-observed', sourceLabel: 'Jig' },
              priority: 4,
              text: 'Known cause',
              transcriptCommitted: false,
            },
          ],
          diagnostics: [],
          ...(lastCompleteRevision === undefined ? {} : { lastCompleteRevision }),
        }
      },
      async preview(id) {
        if (id !== 'a'.repeat(64)) return undefined
        return {
          artifactId: id,
          captureGeneration: 'capture',
          provenance: 'verified-delivery',
          state: 'text',
          text: '<script>literal file</script>',
          bytes: 29,
          clipped: false,
        }
      },
      ...overrides,
    } as any,
  })
  displays.push(display)
  const capability = new URL(display.launchUrl).hash.slice('#cap='.length)
  const headers = { Authorization: `Bearer ${capability}` }
  return {
    display,
    headers,
    change(value: string) {
      text = value
      changed?.()
    },
    counts() {
      return { subscriptions, closes, failures }
    },
    async get(path: string, extra: Record<string, string> = {}) {
      return fetch(display.origin + path, {
        headers: { ...headers, ...extra },
        signal: AbortSignal.timeout(2000),
      })
    },
  }
}
async function raw(origin: string, request: string): Promise<string> {
  const url = new URL(origin)
  return new Promise((resolve, reject) => {
    let result = ''
    const socket = connect(Number(url.port), '127.0.0.1')
    const timeout = setTimeout(() => {
      socket.destroy()
      reject(new Error('raw response timed out'))
    }, 2000)
    // Keep the request side open until the server honors Connection: close.
    // A write-side FIN makes the Linux pin discard even valid responses.
    socket.on('connect', () => socket.write(request))
    socket.on('data', (bytes) => {
      result += bytes.toString()
      if (Buffer.byteLength(result) > 8192)
        socket.destroy(new Error('raw response exceeded fixture bound'))
    })
    socket.on('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    socket.on('close', () => {
      clearTimeout(timeout)
      resolve(result)
    })
  })
}

test('assets are required before binding and prepared listeners expose no run data', async () => {
  expect(() =>
    PrivateWebDisplay.prepare({ assets: {}, projection: {} as any, subscribe: () => () => {} }),
  ).toThrow('assets')
  const f = fixture()
  const prepared = await f.get('/api/snapshot')
  expect(prepared.status).toBe(503)
  expect(await prepared.text()).not.toContain('binding:fixture')
  expect(f.counts().subscriptions).toBe(0)
  f.display.activate()
  const shell = await f.get('/')
  expect(await shell.text()).toContain('<title>Jig</title>')
  expect(shell.headers.get('content-security-policy')).toContain("default-src 'none'")
  expect(shell.headers.get('cache-control')).toBe('no-store')
  expect(shell.headers.get('access-control-allow-origin')).toBeNull()
})

test('exact bearer, authority, origin, metadata and inert error responses guard APIs', async () => {
  const f = fixture()
  f.display.activate()
  for (const headers of [
    { Authorization: '' },
    { Authorization: 'Bearer ' + 'x'.repeat(43) },
    { Origin: 'http://elsewhere.invalid' },
    { Origin: 'null' },
    { 'Sec-Fetch-Site': 'cross-site' },
    { Host: 'localhost:' + new URL(f.display.origin).port },
  ]) {
    const denied = await f.get('/api/snapshot', headers)
    expect(denied.status).toBe(403)
    expect(await denied.text()).not.toContain('binding:fixture')
    expect(denied.headers.get('x-content-type-options')).toBe('nosniff')
  }
  const deniedQuery = await f.get('/api/snapshot?cap=not-a-token')
  expect(deniedQuery.status).toBe(403)
  expect(await deniedQuery.text()).not.toContain('not-a-token')
  for (const path of [
    '/api/artifacts/../preview',
    '/api/artifacts/%2fetc%2fpasswd/preview',
    '/api/artifacts/' + 'b'.repeat(64) + '/preview',
  ])
    expect((await f.get(path)).status).toBe(404)
  const notPreflight = await fetch(f.display.origin + '/api/snapshot', {
    method: 'OPTIONS',
    headers: f.headers,
  })
  expect(notPreflight.status).toBe(405)
  const uploaded = await fetch(f.display.origin + '/api/close', {
    method: 'POST',
    body: 'x',
    headers: { ...f.headers, Origin: f.display.origin },
  })
  expect(uploaded.status).toBe(400)
  expect(f.display.active).toBe(true)
})

test('duplicate Host fails closed; normalized absolute targets retain bearer and Origin checks', async () => {
  const f = fixture()
  f.display.activate()
  const authority = new URL(f.display.origin).host
  for (const hosts of [
    `Host: ${authority}\r\nHost: evil.invalid`,
    `Host: ${authority}\r\nHost: ${authority}`,
  ]) {
    const answer = await raw(
      f.display.origin,
      `GET /api/snapshot HTTP/1.1\r\n${hosts}\r\nAuthorization: ${f.headers.Authorization}\r\nConnection: close\r\n\r\n`,
    )
    expect(answer).toMatch(/^HTTP\/1\.1 [45]/)
    expect(answer).not.toContain('binding:fixture')
  }
  // Mac 1.4.2 rebuilds Request.url using Host. Linux 1.3.3 preserves the
  // absolute authority and rejects it. Both still require bearer and Origin.
  const normalized = await raw(
    f.display.origin,
    `GET http://evil.invalid/api/snapshot HTTP/1.1\r\nHost: ${authority}\r\nAuthorization: ${f.headers.Authorization}\r\nConnection: close\r\n\r\n`,
  )
  expect(normalized).toMatch(/^HTTP\/1\.1 (200|403)/)
  if (normalized.startsWith('HTTP/1.1 403')) expect(normalized).not.toContain('binding:fixture')
  for (const authorization of [
    '',
    `Authorization: ${f.headers.Authorization}\r\nOrigin: http://evil.invalid\r\n`,
  ]) {
    const answer = await raw(
      f.display.origin,
      `GET http://evil.invalid/api/snapshot HTTP/1.1\r\nHost: ${authority}\r\n${authorization}Connection: close\r\n\r\n`,
    )
    expect(answer).toMatch(/^HTTP\/1\.1 403/)
    expect(answer).not.toContain('binding:fixture')
  }
})

test('revision events name committed readable snapshots and reconnect does not replay work', async () => {
  const f = fixture()
  f.display.activate()
  const controller = new AbortController()
  const events = await fetch(f.display.origin + '/api/events', {
    headers: f.headers,
    signal: controller.signal,
  })
  const reader = events.body!.getReader()
  const first = new TextDecoder().decode((await reader.read()).value)
  const revision = Number(/data: ([0-9]+)/.exec(first)![1])
  expect(((await (await f.get('/api/snapshot')).json()) as any).revision).toBe(revision)
  f.change('Checking evidence')
  const next = new TextDecoder().decode((await reader.read()).value)
  const updated = Number(/data: ([0-9]+)/.exec(next)![1])
  const current = (await (await f.get('/api/snapshot')).json()) as any
  expect(current.revision).toBe(updated)
  expect(current.workspace.hostStage).toBe('Checking evidence')
  controller.abort()
  const reconnect = new AbortController()
  const resumed = await fetch(f.display.origin + '/api/events', {
    headers: f.headers,
    signal: reconnect.signal,
  })
  const resumedText = new TextDecoder().decode((await resumed.body!.getReader().read()).value)
  expect(resumedText).toContain(`data: ${updated}`)
  reconnect.abort()
  expect(((await (await f.get('/api/snapshot')).json()) as any).revision).toBe(updated)
})

test('streams are capped and forced close completes with open readers', async () => {
  const f = fixture()
  f.display.activate()
  const controllers: AbortController[] = []
  try {
    for (let i = 0; i < 4; i++) {
      const controller = new AbortController()
      controllers.push(controller)
      const events = await fetch(f.display.origin + '/api/events', {
        headers: f.headers,
        signal: controller.signal,
      })
      expect(events.status).toBe(200)
    }
    const extra = await f.get('/api/events')
    expect(extra.status).toBe(429)
    expect(extra.headers.get('retry-after')).toBe('1')
    await Promise.race([
      f.display.close(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('close hung')), 1000)),
    ])
    await f.display.closed()
    expect(f.counts()).toEqual({ subscriptions: 0, closes: 1, failures: 0 })
    await f.display.close()
    expect(f.counts().closes).toBe(1)
  } finally {
    for (const controller of controllers) controller.abort()
  }
})

test('closing never waits for an unfinished preview supplier or exposes its late bytes', async () => {
  let complete!: (value: unknown) => void
  const f = fixture({
    preview: () => new Promise((resolve) => (complete = resolve)),
  })
  f.display.activate()
  const pending = f.get('/api/artifacts/' + 'a'.repeat(64) + '/preview').then(
    async (response) => ({ status: response.status, body: await response.text() }),
    () => ({ status: 0, body: '' }),
  )
  while (!complete) await new Promise((resolve) => setTimeout(resolve, 1))
  await Promise.race([
    f.display.close(),
    new Promise((_, reject) => setTimeout(() => reject(new Error('preview shutdown hung')), 1000)),
  ])
  const answer = await pending
  expect([0, 410]).toContain(answer.status)
  expect(answer.body).not.toContain('late bytes')
  complete({ text: 'late bytes' })
  expect(f.counts()).toEqual({ subscriptions: 0, closes: 1, failures: 0 })
})

test('closing discards queued ordinary snapshot bytes for a reader that stops reading', async () => {
  const f = fixture({
    capture(revision: number) {
      const value = snapshot(revision)
      // Exercise the transport's legal encoded-body bound without allocating a
      // public model that bypasses its independent semantic field limits.
      value.context = 'x'.repeat(7 * 1024 * 1024)
      return value
    },
  })
  f.display.activate()
  const response = await f.get('/api/snapshot')
  expect(response.status).toBe(200)
  const reader = response.body!.getReader()
  expect((await reader.read()).value!.byteLength).toBeGreaterThan(0)
  try {
    await Promise.race([
      f.display.close(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('snapshot shutdown hung')), 1000),
      ),
    ])
    expect(f.counts()).toEqual({ subscriptions: 0, closes: 1, failures: 0 })
  } finally {
    await reader.cancel().catch(() => {})
  }
})

test('close requires authenticated exact-Origin intent and is presentation-only', async () => {
  const f = fixture()
  f.display.activate()
  const absent = await fetch(f.display.origin + '/api/close', {
    method: 'POST',
    headers: f.headers,
  })
  expect(absent.status).toBe(403)
  const accepted = await fetch(f.display.origin + '/api/close', {
    method: 'POST',
    headers: { ...f.headers, Origin: f.display.origin },
  })
  expect(accepted.status).toBe(200)
  expect(await accepted.json()).toEqual({ closed: true })
  await f.display.closed()
  expect(f.counts().closes).toBe(1)
})

test('projection overflow uses an independent current-cause envelope; private errors are withheld', async () => {
  const f = fixture({
    capture() {
      throw new Error('private runtime path and token')
    },
  })
  f.display.activate()
  const value = (await (await f.get('/api/snapshot')).json()) as any
  expect(value.kind).toBe('incomplete')
  expect(value.attention[0].text).toBe('Known cause')
  expect(JSON.stringify(value)).not.toContain('private runtime')
  const p = fixture({
    async preview() {
      throw new Error('private runtime path and token')
    },
  })
  p.display.activate()
  const denied = await p.get('/api/artifacts/' + 'a'.repeat(64) + '/preview')
  expect(denied.status).toBe(503)
  expect(await denied.text()).not.toContain('private runtime')
})

test('preview is literal and identity-bearing; concurrent suppliers are refused rather than queued', async () => {
  const f = fixture()
  f.display.activate()
  const value = (await (await f.get('/api/artifacts/' + 'a'.repeat(64) + '/preview')).json()) as any
  expect(value.artifactId).toBe('a'.repeat(64))
  expect(value.captureGeneration).toBe('capture')
  expect(value.text).toBe('<script>literal file</script>')
  let release!: (value: undefined) => void
  const slow = fixture({
    preview: () =>
      new Promise((resolve) => {
        release = resolve
      }),
  })
  slow.display.activate()
  const first = slow.get('/api/artifacts/' + 'a'.repeat(64) + '/preview')
  while (!release) await new Promise((resolve) => setTimeout(resolve, 1))
  const second = await slow.get('/api/artifacts/' + 'b'.repeat(64) + '/preview')
  expect(second.status).toBe(429)
  release(undefined)
  expect((await first).status).toBe(404)

  let complete!: (value: unknown) => void
  const closing = fixture({
    preview: () =>
      new Promise((resolve) => {
        complete = resolve
      }),
  })
  closing.display.activate()
  const pending = closing.get('/api/artifacts/' + 'a'.repeat(64) + '/preview')
  while (!complete) await new Promise((resolve) => setTimeout(resolve, 1))
  const accepted = await fetch(closing.display.origin + '/api/close', {
    method: 'POST',
    headers: { ...closing.headers, Origin: closing.display.origin },
  })
  expect(accepted.status).toBe(200)
  complete({
    artifactId: 'a'.repeat(64),
    text: 'late bytes',
    bytes: 10,
    clipped: false,
    state: 'text',
    captureGeneration: 'capture',
    provenance: 'verified-delivery',
  })
  expect((await pending).status).toBe(410)
})
