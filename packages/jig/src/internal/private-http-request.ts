import { type JsonObject, type JsonValue } from '../json.js'
import { type HttpGrant, httpRequestBody, normalizeHttpGrant } from './http-grants.js'
import { snapshotPrivateOrdinaryJson } from './private-ordinary-json.js'

export const HTTP_REQUEST_CONTRACT_ID = 'https://jig.md/contracts/http-request'
export const HTTP_REQUEST_CONTRACT_VERSION = '1.0.0'
export const HTTP_REQUEST_CONTRACT_DIGEST =
  'sha256:6f7ce64345c424e09b0cd74e59d98391a3f93bb7d43e204a0fc5261b831b6b2d'
export interface PreparedHttpRequest {
  readonly resource: string
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

export function parseHttpRequest(
  value: unknown,
  grants: Readonly<Record<string, HttpGrant>>,
): PreparedHttpRequest {
  const input = object(value)
  if (
    Object.keys(input).some((key) => !['resource', 'body'].includes(key)) ||
    typeof input.resource !== 'string' ||
    !Object.hasOwn(grants, input.resource)
  )
    throw new TypeError('select an admitted HTTP resource and an optional JSON body')
  const grant = normalizeHttpGrant(grants[input.resource])
  const body = httpRequestBody(grant, input.body)
  return { resource: input.resource, grant, ...(body === undefined ? {} : { body }) }
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
