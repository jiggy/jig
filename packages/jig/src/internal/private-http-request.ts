import { type JsonObject, type JsonValue } from '../json.js'
import { type HttpGrant, httpRequestBody, normalizeHttpGrant } from './http-grants.js'
import { snapshotPrivateOrdinaryJson } from './private-ordinary-json.js'

export const HTTP_REQUEST_CONTRACT_ID = 'https://jig.md/contracts/http-request'
export const HTTP_REQUEST_CONTRACT_VERSION = '1.0.0'
export const HTTP_REQUEST_CONTRACT_DIGEST =
  'sha256:08a5f03724125edf863c4592c3558b7cda097e9cf7501f4d8c60dcbf6502bb0d'
export interface PreparedHttpRequest {
  readonly grant: HttpGrant
  readonly body?: string
}
export interface HttpResponse {
  readonly status: number
  readonly body: string
}
export type HttpWorkerResult =
  | { readonly response: HttpResponse }
  | { readonly failure: 'UNCERTAIN' | 'RESOURCE_EXHAUSTED' | 'INVALID_RESULT' }

export function parseHttpRequest(value: unknown, policy: HttpGrant): PreparedHttpRequest {
  const input = object(value)
  if (Object.keys(input).some((key) => key !== 'body'))
    throw new TypeError('HTTP input accepts only an optional JSON body')
  const grant = normalizeHttpGrant(policy)
  const body = httpRequestBody(grant, input.body)
  return { grant, ...(body === undefined ? {} : { body }) }
}

export function parseHttpWorkerResult(value: unknown, grant: HttpGrant): HttpWorkerResult {
  const result = object(value)
  if (Object.keys(result).length !== 1) throw new TypeError('invalid HTTP worker result')
  if (
    typeof result.failure === 'string' &&
    ['UNCERTAIN', 'RESOURCE_EXHAUSTED', 'INVALID_RESULT'].includes(result.failure)
  )
    return { failure: result.failure as 'UNCERTAIN' | 'RESOURCE_EXHAUSTED' | 'INVALID_RESULT' }
  const response = object(result.response)
  if (
    Object.keys(response).length !== 2 ||
    typeof response.status !== 'number' ||
    !Number.isInteger(response.status) ||
    response.status < 200 ||
    response.status > 599 ||
    typeof response.body !== 'string' ||
    Buffer.byteLength(response.body) > grant.responseBytes
  )
    throw new TypeError('invalid HTTP response')
  return { response: { status: response.status, body: response.body } }
}

function object(value: unknown): JsonObject {
  const result: JsonValue = snapshotPrivateOrdinaryJson(
    value,
    'HTTP request',
    () => new TypeError('invalid HTTP request'),
  )
  if (result === null || typeof result !== 'object' || Array.isArray(result))
    throw new TypeError('invalid HTTP object')
  return result as JsonObject
}
