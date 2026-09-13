import { type ClientRequest, request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { canonicalJson, decodeJson1, type JsonValue } from '../json.js'
import { HTTP_LIMITS, httpRequestBody, normalizeHttpGrant } from './http-grants.js'
import type { HttpWorkerResult } from './private-http-request.js'

/** Trusted transport only: no authored imports, ambient credentials or retry policy. */
export async function requestGrantedHttp(value: unknown): Promise<HttpWorkerResult> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('invalid HTTP dispatch')
  const input = value as Record<string, unknown>
  if (Object.keys(input).some((key) => !['grant', 'body', 'bearer'].includes(key)))
    throw new TypeError('invalid HTTP dispatch')
  const grant = normalizeHttpGrant(input.grant)
  const bearer = input.bearer
  if (
    (bearer !== undefined &&
      (typeof bearer !== 'string' || !/^[\x21-\x7e]{1,8192}$/.test(bearer))) ||
    (grant.bearerEnv !== undefined) !== (bearer !== undefined)
  )
    throw new TypeError('invalid HTTP credential')
  if (input.body !== undefined && typeof input.body !== 'string')
    throw new TypeError('invalid HTTP body')
  const body = httpRequestBody(
    grant,
    input.body === undefined ? undefined : decodeJson1(Buffer.from(input.body as string)),
  )
  return new Promise((resolve) => {
    let settled = false
    let request: ClientRequest | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = (result: HttpWorkerResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      request?.destroy()
      resolve(result)
    }
    const headers: Record<string, string> = { connection: 'close', 'accept-encoding': 'identity' }
    if (body !== undefined) {
      headers['content-type'] = 'application/json'
      headers['content-length'] = String(Buffer.byteLength(body))
    }
    if (typeof bearer === 'string') headers.authorization = `Bearer ${bearer}`
    try {
      const send = grant.url.startsWith('https:') ? httpsRequest : httpRequest
      request = send(
        grant.url,
        { method: grant.method, headers, agent: false, maxHeaderSize: 16384 },
        (response) => {
          // Pinned Bun does not enforce Node's maxHeaderSize option. Validate
          // parsed fields too; the worker envelope bounds parser allocation.
          const headerBytes = response.rawHeaders.reduce(
            (total, field) => total + Buffer.byteLength(field) + 2,
            2,
          )
          if (headerBytes > 16384) {
            finish({ failure: 'RESOURCE_EXHAUSTED' })
            response.destroy()
            return
          }
          const chunks: Buffer[] = []
          let bytes = 0
          response.on('data', (chunk: Buffer) => {
            bytes += chunk.length
            if (bytes > grant.responseBytes) {
              finish({ failure: 'RESOURCE_EXHAUSTED' })
              response.destroy()
            } else chunks.push(Buffer.from(chunk))
          })
          response.on('error', () => finish({ failure: 'UNCERTAIN' }))
          response.on('aborted', () => finish({ failure: 'UNCERTAIN' }))
          response.on('end', () => {
            try {
              if (
                !response.complete ||
                !response.statusCode ||
                response.statusCode < 200 ||
                response.statusCode > 599 ||
                ![undefined, 'identity'].includes(response.headers['content-encoding'])
              )
                throw new Error()
              const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))
              if (typeof bearer === 'string' && text.includes(bearer)) throw new Error()
              finish({ response: { status: response.statusCode, body: text } })
            } catch {
              finish({ failure: 'INVALID_RESULT' })
            }
          })
          response.on('close', () => {
            if (!response.complete) finish({ failure: 'UNCERTAIN' })
          })
        },
      )
      request.on('error', () => finish({ failure: 'UNCERTAIN' }))
      request.on('upgrade', (_response, socket) => {
        socket.destroy()
        finish({ failure: 'INVALID_RESULT' })
      })
      timer = setTimeout(() => finish({ failure: 'UNCERTAIN' }), grant.timeoutMs)
      request.end(body)
    } catch {
      finish({ failure: 'UNCERTAIN' })
    }
  })
}

if (import.meta.main) {
  let result: HttpWorkerResult
  try {
    const chunks: Buffer[] = []
    let bytes = 0
    for await (const chunk of process.stdin) {
      bytes += chunk.length
      if (bytes > HTTP_LIMITS.requestBytes * 6 + 131072) throw new Error('HTTP input limit')
      chunks.push(Buffer.from(chunk))
    }
    result = await requestGrantedHttp(decodeJson1(Buffer.concat(chunks)))
  } catch {
    result = { failure: 'UNCERTAIN' }
  }
  process.stdout.write(canonicalJson(result as unknown as JsonValue))
}
