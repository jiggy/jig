import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { test } from 'node:test'
import { checkNpmIdentity } from './npm-auth.mjs'

test('real HTTP exchange checks each package and retains only status', async () => {
  const paths = []
  const server = createServer((request, response) => {
    paths.push(request.url)
    response.setHeader('content-type', 'application/json')
    if (request.url.startsWith('/identity')) {
      assert.equal(request.headers.authorization, 'Bearer runner-private')
      assert.equal(
        new URL(request.url, 'http://localhost').searchParams.get('audience'),
        'npm:127.0.0.1',
      )
      response.end(JSON.stringify({ value: 'private-id-token' }))
    } else {
      assert.equal(request.method, 'POST')
      assert.equal(request.headers.authorization, 'Bearer private-id-token')
      if (request.url.endsWith('jig')) {
        response.writeHead(403)
        response.end('{"message":"private-refusal"}')
      } else response.end('{"token":"private-npm-token"}')
    }
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const endpoint = `http://127.0.0.1:${server.address().port}`
  try {
    const results = await checkNpmIdentity({
      requestUrl: endpoint + '/identity',
      requestToken: 'runner-private',
      registry: endpoint,
      names: ['@jigging/agent-method', '@jigging/jig'],
    })
    assert.deepEqual(results, [
      { name: '@jigging/agent-method', accepted: true, status: 200 },
      { name: '@jigging/jig', accepted: false, status: 403 },
    ])
    assert.ok(paths.includes('/-/npm/v1/oidc/token/exchange/package/@jigging%2fagent-method'))
    assert.doesNotMatch(JSON.stringify(results), /private/)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test('missing exchange tokens and oversized identity responses cannot pass', async () => {
  let oversized = false
  const server = createServer((request, response) => {
    response.setHeader('content-type', 'application/json')
    if (request.url.startsWith('/identity'))
      response.end(JSON.stringify({ value: oversized ? 'x'.repeat(32769) : 'id' }))
    else response.end('{}')
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const endpoint = `http://127.0.0.1:${server.address().port}`
  const options = {
    requestUrl: endpoint + '/identity',
    requestToken: 'local',
    registry: endpoint,
    names: ['@jigging/jig'],
  }
  try {
    assert.equal((await checkNpmIdentity(options))[0].accepted, false)
    oversized = true
    await assert.rejects(checkNpmIdentity(options), /exceeds its bound/)
  } finally {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
})
