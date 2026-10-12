import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { test } from 'node:test'
import { promisify } from 'node:util'

const execute = promisify(execFile)
const installer = new URL('./install-macos-test-clients.ts', import.meta.url).href
const bytes = Buffer.from('pinned client archive fixture')

async function fixture(algorithm, respond, scenario) {
  let requests = 0
  const server = createServer((request, response) => respond(++requests, request, response))
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const archive = {
    name: 'pi',
    url: `http://127.0.0.1:${server.address().port}/archive`,
    algorithm,
    digest: createHash(algorithm)
      .update(bytes)
      .digest(algorithm === 'sha512' ? 'base64' : 'hex'),
  }
  const run = (override = {}) =>
    execute(
      'bun',
      [
        '-e',
        `const { downloadClientArchive } = await import(${JSON.stringify(installer)});
const bytes = await downloadClientArchive(${JSON.stringify({ ...archive, ...override })});
console.log(bytes.toString('hex'));`,
      ],
      { timeout: 15000, maxBuffer: 16384 },
    )
  try {
    await scenario({ run, requests: () => requests })
  } finally {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
}

test('both archive digest formats accept exact bytes without retry output', async () => {
  for (const algorithm of ['sha256', 'sha512']) {
    await fixture(
      algorithm,
      (_count, _request, response) => response.end(bytes),
      async ({ run, requests }) => {
        const result = await run()
        assert.equal(result.stdout.trim(), bytes.toString('hex'))
        assert.equal(result.stderr, '')
        assert.equal(requests(), 1)
      },
    )
  }
})

test('temporary HTTP failures retry the same archive and keep diagnostics off stdout', async () => {
  await fixture(
    'sha256',
    (count, _request, response) => {
      if (count < 3) response.writeHead(count === 1 ? 503 : 429).end('unavailable')
      else response.end(bytes)
    },
    async ({ run, requests }) => {
      const result = await run()
      assert.equal(result.stdout.trim(), bytes.toString('hex'))
      assert.match(result.stderr, /attempt 1\/3; HTTP 503/)
      assert.match(result.stderr, /attempt 2\/3; HTTP 429/)
      assert.equal(requests(), 3)
    },
  )
})

test('connection loss and incomplete bodies cannot become verified archives', async () => {
  await fixture(
    'sha256',
    (count, request, response) => {
      if (count === 1) request.socket.destroy()
      else if (count === 2)
        response.writeHead(200, { 'Content-Length': bytes.length + 10 }).end(bytes)
      else response.end(bytes)
    },
    async ({ run, requests }) => {
      const result = await run()
      assert.equal(result.stdout.trim(), bytes.toString('hex'))
      assert.match(result.stderr, /network or response body failure/)
      assert.equal(requests(), 3)
    },
  )
})

test('persistent HTTP failure stops after three attempts and reports the status', async () => {
  await fixture(
    'sha256',
    (_count, _request, response) => response.writeHead(403).end('refused'),
    async ({ run, requests }) => {
      await assert.rejects(run(), (error) => {
        assert.equal(error.code, 1)
        assert.equal(error.stdout, '')
        assert.match(error.stderr, /client download failed: pi \(attempt 3\/3; HTTP 403\)/)
        return true
      })
      assert.equal(requests(), 3)
    },
  )
})

test('changed archive identity refuses immediately without acquisition retries', async () => {
  await fixture(
    'sha256',
    (_count, _request, response) => response.end(bytes),
    async ({ run, requests }) => {
      await assert.rejects(run({ digest: '0'.repeat(64) }), (error) => {
        assert.equal(error.stdout, '')
        assert.match(error.stderr, /client archive identity changed: pi/)
        assert.doesNotMatch(error.stderr, /retrying/)
        return true
      })
      assert.equal(requests(), 1)
    },
  )
})
