import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { connect } from 'node:net'
import { webAssets } from '@jigging/display-web/assets'
import { PrivateExploreSession } from '../../src/cli-explore.js'
import { PrivateWebExplorer, type PrivateExplorerRunEvent } from '../../src/cli-explorer-web.js'

const owners: { root: string; server: PrivateWebExplorer }[] = []
afterEach(async () => {
  for (const owner of owners.splice(0)) {
    await owner.server.close()
    await rm(owner.root, { recursive: true, force: true })
  }
})

async function explorer() {
  const root = await mkdtemp(join(tmpdir(), 'jig-explorer-http-'))
  const session = new PrivateExploreSession({ projectRoot: root, timeoutMs: 1000 })
  const server = PrivateWebExplorer.prepare({
    assets: webAssets,
    project: (targetId) => session.project(targetId),
    session: (requestId) =>
      requestId === undefined ? session.snapshot() : session.requestSnapshot(requestId),
    run: (request) => session.run(request),
    onClose: () => session.close(),
  })
  session.bindBridge((event) => server.registerRunBridge(event))
  owners.push({ root, server })
  const capability = new URL(server.launchUrl).hash.slice('#cap='.length)
  const headers = { Authorization: `Bearer ${capability}` }
  const postHeaders = { ...headers, Origin: server.origin, 'Content-Type': 'application/json' }
  const get = (path: string, extra: Record<string, string> = {}) =>
    fetch(server.origin + path, {
      headers: { ...headers, ...extra },
      signal: AbortSignal.timeout(2000),
    })
  const post = (path: string, body: string, extra: Record<string, string> = {}) =>
    fetch(server.origin + path, {
      method: 'POST',
      headers: { ...postHeaders, ...extra },
      body,
      signal: AbortSignal.timeout(2000),
    })
  return { root, session, server, headers, postHeaders, get, post }
}

test('explorer serves the real fixed assets and reads an unreviewed project without creating state', async () => {
  const owner = await explorer()
  const html = await owner.get('/explore', { 'Sec-Fetch-Site': 'none' })
  expect(html.status).toBe(200)
  expect(await html.text()).toBe(webAssets['/']!.body)
  expect(html.headers.get('content-security-policy')).toContain("frame-ancestors 'none'")
  expect(html.headers.get('cache-control')).toBe('no-store')
  for (let index = 0; index < 10; index++) {
    const response = await owner.get('/api/project')
    expect(response.status).toBe(200)
    const project = await response.json()
    expect(project.state).toBe('unreviewed')
    expect(project.targets).toEqual([])
    expect(project).not.toHaveProperty('workspace')
  }
  expect(await readdir(owner.root)).toEqual([])
  const status = await owner.get('/api/run')
  expect(await status.json()).toEqual({ state: 'idle' })
})

test('browser launch requires its capability and exact explicit Origin before reading input', async () => {
  const owner = await explorer()
  const body = JSON.stringify({ requestId: 'first', revision: 'none', targetId: 'none', input: {} })
  const bad = [
    { Authorization: `Bearer ${'x'.repeat(43)}` },
    { Origin: 'https://example.com' },
    { 'Sec-Fetch-Site': 'cross-site' },
    { Host: 'localhost:' + new URL(owner.server.origin).port },
  ]
  for (const extra of bad) {
    const response = await owner.post('/api/run', body, extra)
    expect(response.status).toBe(403)
    await response.body?.cancel()
  }
  const missingOrigin = await fetch(owner.server.origin + '/api/run', {
    method: 'POST',
    headers: { ...owner.headers, 'Content-Type': 'application/json' },
    body,
  })
  expect(missingOrigin.status).toBe(403)
  await missingOrigin.body?.cancel()
  expect(owner.session.snapshot()).toEqual({ state: 'idle' })
  expect(await readdir(owner.root)).toEqual([])
})

test('strict JSON and route validation refuse ambiguous input before real selection', async () => {
  const owner = await explorer()
  for (const body of [
    '{"requestId":"one","revision":"none","targetId":"none","input":{"x":1,"x":2}}',
    '{"requestId":"one","revision":"none","targetId":"none","input":1e999}',
    '{"requestId":"one","revision":"none","targetId":"none"}',
    '{"requestId":"one","revision":"none","targetId":"none","input":{},"argv":["run"]}',
  ]) {
    const response = await owner.post('/api/run', body)
    expect(response.status).toBe(400)
    expect(await response.text()).not.toContain('argv')
  }
  for (const path of [
    '/api/project?target=a&target=b',
    '/api/project?path=private',
    '/api/run?retry=1',
    '/api/run?requestId=',
    '/api/run?requestId=one&requestId=two',
  ]) {
    const response = await owner.get(path)
    expect(response.status).toBe(400)
    await response.body?.cancel()
  }
  expect(owner.session.snapshot()).toEqual({ state: 'idle' })
  expect(await readdir(owner.root)).toEqual([])
})

test('actual unreviewed selection refuses launch and repeated request identities never acquire state', async () => {
  const owner = await explorer()
  const request = { requestId: 'one', revision: 'none', targetId: 'none', input: null }
  const first = await owner.post('/api/run', JSON.stringify(request))
  const refusal = await first.json()
  expect(first.status).toBe(200)
  expect(refusal.state).toBe('refused')
  expect(refusal.reason).toContain('jig review')
  const again = await owner.post('/api/run', JSON.stringify(request))
  expect(await again.json()).toEqual(refusal)
  const conflict = await owner.post('/api/run', JSON.stringify({ ...request, input: 'changed' }))
  expect((await conflict.json()).reason).toContain('different input')
  expect(owner.session.snapshot()).toEqual(refusal)
  const later = await owner.post('/api/run', JSON.stringify({ ...request, requestId: 'two' }))
  const current = await later.json()
  expect(current.requestId).toBe('two')
  const retained = await owner.get('/api/run?requestId=one')
  expect(retained.status).toBe(200)
  expect(await retained.json()).toEqual(refusal)
  const global = await owner.get('/api/run')
  expect(await global.json()).toEqual(current)
  const unknown = await owner.get('/api/run?requestId=missing')
  expect(unknown.status).toBe(404)
  expect((await unknown.json()).code).toBe('REQUEST_UNKNOWN')
  expect(await readdir(owner.root)).toEqual([])
})

test('a disconnected partial upload releases launch admission without dispatching input', async () => {
  const owner = await explorer()
  const url = new URL(owner.server.origin)
  const socket = connect({ host: '127.0.0.1', port: Number(url.port) })
  const connected = new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve)
    socket.once('error', reject)
  })
  try {
    await connected
    socket.write(
      [
        'POST /api/run HTTP/1.1',
        `Host: ${url.host}`,
        `Authorization: ${owner.headers.Authorization}`,
        `Origin: ${owner.server.origin}`,
        'Content-Type: application/json',
        'Transfer-Encoding: chunked',
        '',
        '1',
        '{',
        '',
      ].join('\r\n'),
    )
    const statusUntil = async (wanted: number) => {
      const end = performance.now() + 4000
      while (performance.now() < end) {
        // Invalid input cannot dispatch even if this probe arrives before the partial reader.
        const response = await owner.post('/api/run', 'invalid')
        const status = response.status
        await response.body?.cancel()
        if (status === wanted) return
        expect([400, 409]).toContain(status)
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      throw new Error('Partial upload did not release its bounded admission')
    }
    await statusUntil(409)
    socket.destroy()
    await statusUntil(400)
    expect(owner.session.snapshot()).toEqual({ state: 'idle' })
    expect(await readdir(owner.root)).toEqual([])
  } finally {
    socket.destroy()
  }
}, 12_000)

test('child handoff and project control capabilities cannot authorize each other', async () => {
  const owner = await explorer()
  // This receiver records real HTTP protocol events, not execution or cleanup receipts.
  const events: PrivateExplorerRunEvent[] = []
  const bridge = owner.server.registerRunBridge((event) => events.push(event))
  const wrong = await owner.post('/internal/run', '{"event":"settled"}')
  expect(wrong.status).toBe(403)
  await wrong.body?.cancel()
  const observerControl = await owner.get('/api/project', {
    Authorization: `Bearer ${bridge.capability}`,
  })
  expect(observerControl.status).toBe(403)
  await observerControl.body?.cancel()
  const headers = {
    Authorization: `Bearer ${bridge.capability}`,
    'Content-Type': 'application/json',
  }
  const invalid = await fetch(bridge.url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ event: 'viewer', url: 'https://example.com/#cap=secret' }),
  })
  expect(invalid.status).toBe(400)
  await invalid.body?.cancel()
  const url = `http://127.0.0.1:12345/#cap=${'a'.repeat(43)}`
  const accepted = await fetch(bridge.url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ event: 'viewer', url }),
  })
  expect(accepted.status).toBe(200)
  await accepted.body?.cancel()
  expect(events).toEqual([{ event: 'viewer', url }])
  bridge.close()
  const retired = await fetch(bridge.url, { method: 'POST', headers, body: '{"event":"settled"}' })
  expect(retired.status).toBe(403)
  await retired.body?.cancel()
})

test('explicit explorer Close retires the actual idle owner and listener', async () => {
  const owner = await explorer()
  const response = await owner.post('/api/close', '')
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ closed: true })
  await owner.server.closed()
  await expect(owner.get('/api/project')).rejects.toThrow()
  expect(await readdir(owner.root)).toEqual([])
})
