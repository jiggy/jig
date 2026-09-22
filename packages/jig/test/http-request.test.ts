import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import {
  HTTP_LIMITS,
  HTTP_MAX_LIMITS,
  httpCredential,
  normalizeHttpGrant,
  openPrivateHttpGrants,
  selectHttpGrants,
} from '../src/internal/http-grants.js'
import { requestGrantedHttp } from '../src/internal/http-request-worker.js'
import {
  HTTP_REQUEST_CONTRACT_DIGEST,
  parseHttpRequest,
  parseHttpWorkerResult,
  encodeHttpWorkerInput,
} from '../src/internal/private-http-request.js'
import { parseInvocationContract } from '../src/invocation-contract.js'
import { normalizeGrant } from '../src/project/grants.js'
import { resolveInvocationSlots } from '../src/project/invocation-slots.js'
import { canonicalJson } from '../src/json.js'
import { defineBinding } from '../src/project/author.js'
import { compileSchemaFile } from '../src/schema/index.js'
import { untrustedCertificate, untrustedKey } from './http-tls-fixture.js'

describe('delegated HTTP policy and trusted transport', () => {
  test('the ordinary Agent package carries the exact canonical HTTP descriptor', async () => {
    expect(
      await readFile(
        new URL('../../agent-method/contracts/http-request/contract.json', import.meta.url),
        'utf8',
      ),
    ).toBe(
      await readFile(
        new URL('../../../docs/jig/spec/contracts/http-request/contract.json', import.meta.url),
        'utf8',
      ),
    )
  })
  test('normalizes inert Binding selections and the exact invocation companion', async () => {
    const binding = defineBinding({
      package: 'flows/read',
      slots: { source: { kind: 'http', url: 'https://example.org/', method: 'GET' } },
    })
    const schema = compileSchemaFile(
      await readFile(
        new URL('../../../docs/jig/spec/machine/project-authoring-1.schema.json', import.meta.url),
      ),
    )
    schema.validate(binding)
    schema.validate(
      defineBinding({
        package: 'flows/read',
        slots: {
          source: { kind: 'http', url: 'https://example.org/', method: 'POST', ...HTTP_MAX_LIMITS },
        },
      }),
    )
    for (const source of [null, [], 'https://example.org/', '../secret'])
      expect(() =>
        defineBinding({ package: 'flows/read', slots: { source: source as never } }),
      ).toThrow()
    const contract = parseInvocationContract(
      await readFile(
        new URL('../../../docs/jig/spec/contracts/http-request/contract.json', import.meta.url),
      ),
    )
    expect(contract.digest).toBe(HTTP_REQUEST_CONTRACT_DIGEST)
    contract.schemas.get('/input')!.validate({})
    contract.schemas
      .get('/result')!
      .validate({ outcome: 'done', output: { status: 403, body: 'denied' } })
  })
  test('requires operator grants, keeps secrets out of identities, and rejects additional request powers', () => {
    const policy = {
      url: 'https://example.org/api',
      method: 'POST',
      bearerEnv: 'TEST_TOKEN',
      bodySchema: {
        type: 'object',
        properties: { text: { type: 'string' } },
        required: ['text'],
        additionalProperties: false,
      },
    }
    const first = openPrivateHttpGrants({ TEST_TOKEN: 'first-private-token' })
    const rotated = openPrivateHttpGrants({ TEST_TOKEN: 'rotated-private-token' })
    const route = (value: unknown) =>
      resolveInvocationSlots(
        {
          api: {
            id: 'https://jig.md/contracts/http-request',
            version: '1.0.0',
            digest: HTTP_REQUEST_CONTRACT_DIGEST,
          },
        },
        { api: { kind: 'grant', policy: normalizeGrant(value) } },
      )
    const slots = route({ kind: 'http', ...policy })
    const selected = selectHttpGrants(first, slots)
    expect(JSON.stringify(first)).not.toContain('first-private-token')
    expect(httpCredential(first, selected.api!)).toBe('first-private-token')
    expect(canonicalJson(selected)).toEqual(canonicalJson(selectHttpGrants(rotated, slots)))
    expect(() => selectHttpGrants(openPrivateHttpGrants({}), slots)).toThrow()
    expect(() => selectHttpGrants(undefined, slots)).toThrow()
    expect(() => selectHttpGrants({ kind: 'private-grant-credentials' }, slots)).toThrow()
    expect(parseHttpRequest({ body: { text: 'hello' } }, selected.api!).body).toBe(
      '{"text":"hello"}',
    )
    for (const input of [
      { body: { text: 'hello', tools: [] } },
      { body: { text: 'hello' }, url: 'https://elsewhere.org/' },
      { body: { text: 'hello' }, headers: { authorization: 'secret' } },
      { method: 'GET' },
      { resource: 'service' },
    ])
      expect(() => parseHttpRequest(input, selected.api!)).toThrow()
    expect(
      canonicalJson(selectHttpGrants(first, route({ kind: 'http', ...policy, timeoutMs: 1000 }))),
    ).not.toEqual(canonicalJson(selected))
  })
  test('bounds and closes policy, accepts neither ambient network nor malformed destinations', () => {
    const base = { url: 'https://example.org/', method: 'GET' }
    for (const value of [
      { ...base, url: 'http://example.org/' },
      { ...base, url: 'https://user:secret@example.org/' },
      { ...base, url: 'https://example.org/#fragment' },
      { ...base, url: 'https://EXAMPLE.org/' },
      { ...base, redirects: true },
      { ...base, method: 'CONNECT' },
      { ...base, method: ['GET'] },
      { ...base, bearerEnv: 'a\nb' },
      { ...base, timeoutMs: HTTP_LIMITS.timeoutMs + 1 },
      { ...base, bodySchema: {} },
      { ...base, responseBytes: 0 },
      { ...base, responseBytes: HTTP_MAX_LIMITS.responseBytes + 1 },
      { ...base, requestBytes: HTTP_MAX_LIMITS.requestBytes + 1 },
      { ...base, responseBytes: null },
      { ...base, requestBytes: null },
      { ...base, timeoutMs: null },
      { ...base, url: 'https://example.org/#' },
    ])
      expect(() => normalizeHttpGrant(value)).toThrow()
    expect(() => parseHttpRequest({ body: null }, normalizeHttpGrant(base))).toThrow()
    expect(normalizeHttpGrant(base)).toEqual({ ...base, ...HTTP_LIMITS })
    expect(normalizeHttpGrant({ ...base, ...HTTP_MAX_LIMITS })).toEqual({
      ...base,
      ...HTTP_MAX_LIMITS,
    })
  })

  test('larger requests require an explicit grant; JSON response decoding avoids string wrapping', async () => {
    let dispatched = 0
    const content = 'x'.repeat(2 * 1024 * 1024)
    const payload = { prompt: 'p'.repeat(400_000) }
    await endpoint(
      async (request, response) => {
        dispatched++
        const chunks: Buffer[] = []
        for await (const chunk of request) chunks.push(Buffer.from(chunk))
        expect(JSON.parse(Buffer.concat(chunks).toString())).toEqual(payload)
        response.end(JSON.stringify({ content }))
      },
      async (url) => {
        const defaults = normalizeHttpGrant({ url: `${url}/`, method: 'POST' })
        await expect(
          requestGrantedHttp({ grant: defaults, body: JSON.stringify(payload), response: 'json' }),
        ).rejects.toThrow('exceeds its grant')
        expect(dispatched).toBe(0)
        const grant = normalizeHttpGrant({
          ...defaults,
          requestBytes: 500_000,
          responseBytes: 3 * 1024 * 1024,
        })
        const request = parseHttpRequest({ body: payload, response: 'json' }, grant)
        const result = await requestGrantedHttp(
          JSON.parse(Buffer.from(encodeHttpWorkerInput(request)).toString()),
        )
        expect(result).toEqual({
          response: { status: 200, body: { content } },
          bodyBytes: Buffer.byteLength(JSON.stringify({ content })),
        })
        expect(parseHttpWorkerResult(result, grant, 'json')).toEqual(result)
        expect(() => parseHttpWorkerResult(result, grant)).toThrow()
        expect(dispatched).toBe(1)
        expect(
          await requestGrantedHttp({
            grant: { ...grant, responseBytes: HTTP_LIMITS.responseBytes },
            body: JSON.stringify(payload),
            response: 'json',
          }),
        ).toEqual({ failure: 'RESOURCE_EXHAUSTED' })
        expect(dispatched).toBe(2)
      },
    )
  })

  test('JSON mode is explicit, strict and bounded, including decoded credential echoes', async () => {
    const cases = [
      '{"x":1,"x":2}',
      '{"x":9007199254740992}',
      'not JSON',
      '"\\ud800"',
      '{"token":"\\u0073ecret-token"}',
    ]
    let next = 0
    await endpoint(
      (_request, response) => response.end(cases[next++]!),
      async (url) => {
        const grant = normalizeHttpGrant({ url: `${url}/`, method: 'GET', bearerEnv: 'TOKEN' })
        for (const _ of cases)
          expect(
            await requestGrantedHttp({ grant, bearer: 'secret-token', response: 'json' }),
          ).toEqual({ failure: 'INVALID_RESULT' })
        for (const response of ['text', 'auto', null, true])
          expect(() => parseHttpRequest({ response }, grant)).toThrow()
      },
    )
  })

  test('complete private envelopes remain bounded even within a raw body grant', () => {
    const grant = normalizeHttpGrant({
      url: 'https://example.org/',
      method: 'POST',
      ...HTTP_MAX_LIMITS,
    })
    const request = parseHttpRequest({ body: { text: '\\'.repeat(4_194_290) } }, grant)
    expect(Buffer.byteLength(request.body!)).toBeLessThanOrEqual(grant.requestBytes)
    expect(() => encodeHttpWorkerInput(request)).toThrow('maximum encoded bytes')
  })

  test('JSON response mode carries an exact 8 MiB string; text mode retains JSON/1 string bounds', async () => {
    const text = 'x'.repeat(8_388_608)
    await endpoint(
      (_request, response) => response.end(JSON.stringify({ text })),
      async (url) => {
        const grant = normalizeHttpGrant({
          url: `${url}/`,
          method: 'GET',
          responseBytes: HTTP_MAX_LIMITS.responseBytes,
        })
        const result = await requestGrantedHttp({ grant, response: 'json' })
        expect('response' in result && (result.response.body as { text: string }).text.length).toBe(
          text.length,
        )
        expect(await requestGrantedHttp({ grant })).toEqual({ failure: 'RESOURCE_EXHAUSTED' })
      },
    )
  })
  test('sends exactly one authorized request with JSON and bearer, reports HTTP rejection as a response', async () => {
    const seen: unknown[] = []
    await endpoint(
      async (request, response) => {
        const chunks = []
        for await (const chunk of request) chunks.push(Buffer.from(chunk))
        seen.push({
          method: request.method,
          path: request.url,
          authorization: request.headers.authorization,
          body: Buffer.concat(chunks).toString(),
        })
        response.writeHead(403)
        response.end('service denied')
      },
      async (url) => {
        const grant = normalizeHttpGrant({
          url: `${url}/exact?scope=read`,
          method: 'POST',
          bearerEnv: 'TOKEN',
        })
        expect(
          await requestGrantedHttp({
            grant,
            bearer: 'private-test-token',
            body: '{"text":"hello"}',
          }),
        ).toEqual({ response: { status: 403, body: 'service denied' }, bodyBytes: 14 })
        expect(seen).toEqual([
          {
            method: 'POST',
            path: '/exact?scope=read',
            authorization: 'Bearer private-test-token',
            body: '{"text":"hello"}',
          },
        ])
      },
    )
  })
  test('does not follow redirects and rejects oversized, compressed, invalid UTF-8 and literal credential echoes', async () => {
    const seen: string[] = []
    await endpoint(
      (request, response) => {
        seen.push(request.url!)
        if (request.url === '/redirect') {
          response.writeHead(302, { location: '/forbidden' })
          response.end('moved')
        } else if (request.url === '/big') response.end('x'.repeat(128))
        else if (request.url === '/utf8') response.end(Buffer.from([0xff]))
        else if (request.url === '/headers') {
          response.writeHead(200, { 'x-large': 'x'.repeat(32768) })
          response.end('bounded')
        } else if (request.url === '/compressed') {
          response.writeHead(200, { 'content-encoding': 'gzip' })
          response.end('not plain text')
        } else response.end('private-test-token')
      },
      async (url) => {
        const call = (path: string) =>
          requestGrantedHttp({
            grant: normalizeHttpGrant({
              url: url + path,
              method: 'GET',
              responseBytes: 64,
              bearerEnv: 'TOKEN',
            }),
            bearer: 'private-test-token',
          })
        expect(await call('/redirect')).toEqual({
          response: { status: 302, body: 'moved' },
          bodyBytes: 5,
        })
        expect(await call('/big')).toEqual({ failure: 'RESOURCE_EXHAUSTED' })
        expect(await call('/utf8')).toEqual({ failure: 'INVALID_RESULT' })
        expect(await call('/headers')).toEqual({ failure: 'RESOURCE_EXHAUSTED' })
        expect(await call('/compressed')).toEqual({ failure: 'INVALID_RESULT' })
        expect(await call('/echo')).toEqual({ failure: 'INVALID_RESULT' })
        expect(seen).toEqual(['/redirect', '/big', '/utf8', '/headers', '/compressed', '/echo'])
      },
    )
  })
  test('settles deadlines and dropped sockets without retrying', async () => {
    let requests = 0
    await endpoint(
      (request, response) => {
        requests++
        if (request.url === '/drop') response.destroy()
      },
      async (url) => {
        for (const path of ['/wait', '/drop'])
          expect(
            await requestGrantedHttp({
              grant: normalizeHttpGrant({ url: url + path, method: 'GET', timeoutMs: 100 }),
            }),
          ).toEqual({ failure: 'UNCERTAIN' })
        expect(requests).toBe(2)
      },
    )
  })
  test('validates collected worker output independently', () => {
    const grant = normalizeHttpGrant({
      url: 'https://example.org/',
      method: 'GET',
      responseBytes: 4,
    })
    for (const value of [
      { response: { status: 99, body: '' } },
      { response: { status: 200, body: '12345' } },
      { response: { status: 200, body: '', headers: {} } },
      { failure: 'anything' },
      { failure: ['UNCERTAIN'] },
    ])
      expect(() => parseHttpWorkerResult(value, grant)).toThrow()
  })
  test('does not disable TLS verification for an operator-selected endpoint', async () => {
    let requests = 0
    const server = createHttpsServer(
      { key: untrustedKey, cert: untrustedCertificate },
      (_request, response) => {
        requests++
        response.end('must not arrive')
      },
    )
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('missing TLS endpoint')
    try {
      const result = await requestGrantedHttp({
        grant: normalizeHttpGrant({
          url: `https://127.0.0.1:${address.port}/`,
          method: 'GET',
          timeoutMs: 1000,
        }),
      })
      expect(result).toEqual({ failure: 'UNCERTAIN' })
      expect(requests).toBe(0)
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
})

async function endpoint(
  handler: (request: IncomingMessage, response: ServerResponse) => unknown,
  use: (url: string) => Promise<void>,
) {
  const server = createServer(handler)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('missing endpoint')
  try {
    await use(`http://127.0.0.1:${address.port}`)
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) =>
      server.close((error) =>
        error && (error as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING'
          ? reject(error)
          : resolve(),
      ),
    )
  }
}
