import { canonicalJson, type JsonObject, type JsonValue } from '../json.js'
import { type HttpGrant, httpRequestBody, normalizeHttpGrant } from './http-grants.js'
import { snapshotPrivateOrdinaryJson } from './private-ordinary-json.js'

export const HTTP_REQUEST_CONTRACT_ID = 'https://jig.md/contracts/http-request'
export const HTTP_REQUEST_CONTRACT_VERSION = '1.0.0'
export const HTTP_REQUEST_CONTRACT_DIGEST =
  'sha256:2738827364016ec63be3ffbf47265869cfce9daa6be4ce1f6ff865a732a3196d'
export interface PreparedHttpRequest {
  readonly grant: HttpGrant
  readonly body?: string
  readonly response?: 'json'
}
export interface HttpResponse {
  readonly status: number
  readonly body: JsonValue
}

/** Validate the complete private envelope before allocating or dispatching work. */
export function encodeHttpWorkerInput(request: PreparedHttpRequest, bearer?: string): Uint8Array {
  return canonicalJson({
    grant: request.grant as unknown as JsonValue,
    ...(request.body === undefined ? {} : { body: request.body }),
    ...(request.response === undefined ? {} : { response: request.response }),
    ...(bearer === undefined ? {} : { bearer }),
  })
}
export type HttpWorkerResult =
  | { readonly response: HttpResponse; readonly bodyBytes: number }
  | { readonly failure: 'UNCERTAIN' | 'RESOURCE_EXHAUSTED' | 'INVALID_RESULT' }

export function parseHttpRequest(value: unknown, policy: HttpGrant): PreparedHttpRequest {
  const input = object(value)
  if (
    Object.keys(input).some((key) => key !== 'body' && key !== 'response') ||
    (Object.hasOwn(input, 'response') && input.response !== 'json')
  )
    throw new TypeError('HTTP input accepts an optional JSON body and response: json')
  const grant = normalizeHttpGrant(policy)
  const body = httpRequestBody(grant, input.body)
  return {
    grant,
    ...(body === undefined ? {} : { body }),
    ...(input.response === 'json' ? { response: 'json' as const } : {}),
  }
}

export function parseHttpWorkerResult(
  value: unknown,
  grant: HttpGrant,
  mode?: 'json',
): HttpWorkerResult {
  const result = object(value)
  if (
    Object.keys(result).length === 1 &&
    typeof result.failure === 'string' &&
    ['UNCERTAIN', 'RESOURCE_EXHAUSTED', 'INVALID_RESULT'].includes(result.failure)
  )
    return { failure: result.failure as 'UNCERTAIN' | 'RESOURCE_EXHAUSTED' | 'INVALID_RESULT' }
  const response = object(result.response)
  if (
    Object.keys(result).length !== 2 ||
    typeof result.bodyBytes !== 'number' ||
    !Number.isSafeInteger(result.bodyBytes) ||
    result.bodyBytes < 0 ||
    result.bodyBytes > grant.responseBytes ||
    Object.keys(response).length !== 2 ||
    typeof response.status !== 'number' ||
    !Number.isInteger(response.status) ||
    response.status < 200 ||
    response.status > 599 ||
    !Object.hasOwn(response, 'body') ||
    (mode === undefined &&
      (typeof response.body !== 'string' || Buffer.byteLength(response.body) !== result.bodyBytes))
  )
    throw new TypeError('invalid HTTP response')
  return {
    response: { status: response.status, body: response.body! },
    bodyBytes: result.bodyBytes,
  }
}

/** Includes decoded JSON strings/keys, not just a raw unescaped HTTP body. */
export function httpCredentialEcho(value: JsonValue, credential: string): boolean {
  if (typeof value === 'string') return value.includes(credential)
  if (value === null || typeof value !== 'object') return false
  return Object.entries(value).some(
    ([key, item]) => key.includes(credential) || httpCredentialEcho(item, credential),
  )
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
