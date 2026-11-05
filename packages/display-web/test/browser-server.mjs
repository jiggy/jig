import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { validateDisplaySnapshot } from '@jigging/display-model'
import { webAssets } from '../dist/assets.js'

/** A bounded real HTTP producer for the production browser assets. No request executes work. */
export async function startBrowserFixture(fixture) {
  const capability = 'browser-acceptance-fixture-capability-token-00'.slice(0, 43)
  const streams = new Set()
  const requests = []
  let closed = false
  const server = createServer((request, response) => {
    const asset = webAssets[request.url]
    if (request.method === 'GET' && asset) {
      response
        .writeHead(200, {
          'Content-Type': asset.contentType,
          'Content-Security-Policy':
            "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src data:; base-uri 'none'; frame-ancestors 'none'",
        })
        .end(asset.body)
      return
    }
    const authorized = request.headers.authorization === `Bearer ${capability}`
    requests.push({
      path: request.url,
      method: request.method,
      authorized,
      generation: request.headers['x-jig-capture-generation'],
    })
    if (!authorized) {
      response.writeHead(401).end()
      return
    }
    if (closed) {
      response.writeHead(410).end()
      return
    }
    if (request.url === '/api/snapshot' && request.method === 'GET') {
      response
        .writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
        .end(JSON.stringify(fixture.snapshot))
      return
    }
    if (request.url === '/api/events' && request.method === 'GET') {
      response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' })
      response.write(`event: revision\ndata: ${fixture.snapshot.revision}\n\n`)
      streams.add(response)
      response.on('close', () => streams.delete(response))
      return
    }
    if (request.url === '/api/close' && request.method === 'POST') {
      closed = true
      response.writeHead(204).end()
      for (const stream of streams) stream.end()
      return
    }
    const match = /^\/api\/artifacts\/([^/]+)\/(preview|download)$/.exec(request.url ?? '')
    const capture =
      match &&
      Object.values(fixture.captures).find((item) => item.id === decodeURIComponent(match[1]))
    if (request.method !== 'GET' || !capture) {
      response.writeHead(404).end()
      return
    }
    const generation = fixture.snapshot.artifacts?.generation
    if (!generation) {
      response.writeHead(409).end()
      return
    }
    if (match[2] === 'download') {
      if (request.headers['x-jig-capture-generation'] !== generation) {
        response.writeHead(409).end()
        return
      }
      response
        .writeHead(200, {
          'Content-Type': 'application/octet-stream',
          'X-Jig-Capture-Generation': generation,
        })
        .end(capture.bytes)
      return
    }
    response.writeHead(200, { 'Content-Type': 'application/json' }).end(
      JSON.stringify({
        artifactId: capture.id,
        captureGeneration: generation,
        provenance: 'verified-delivery',
        state: capture.image ? 'image' : 'text',
        ...(capture.image ? { image: capture.image } : { text: capture.text }),
        bytes: capture.bytes.length,
        clipped: false,
      }),
    )
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  return {
    url: `${origin}/#cap=${capability}`,
    origin,
    requests,
    update(next) {
      assert(next.revision > fixture.snapshot.revision)
      validateDisplaySnapshot(next)
      fixture.snapshot = next
      for (const stream of streams) stream.write(`event: revision\ndata: ${next.revision}\n\n`)
    },
    async close() {
      for (const stream of streams) stream.end()
      server.closeAllConnections()
      await new Promise((resolve) => server.close(resolve))
    },
  }
}
