import { canonicalJson, type JsonObject } from '../json.js'
import { snapshotJsonObject } from './author-value.js'
import type { SchemaValue } from '../schema/types.js'
import { normalizeProjectCommand, type ProjectCommand } from './commands.js'

export const HTTP_LIMITS = Object.freeze({
  requestBytes: 262144,
  responseBytes: 1048576,
  timeoutMs: 60000,
})
/** Explicit reviewed ceilings; omitted fields retain the smaller defaults above. */
export const HTTP_MAX_LIMITS = Object.freeze({
  requestBytes: 8_388_608,
  responseBytes: 12_582_912,
  timeoutMs: HTTP_LIMITS.timeoutMs,
})
export interface HttpGrant {
  readonly url: string
  readonly method: 'GET' | 'POST'
  readonly bearerEnv?: string
  readonly requestBytes: number
  readonly responseBytes: number
  readonly timeoutMs: number
  readonly bodySchema?: SchemaValue
}

export class HttpGrantError extends Error {
  constructor() {
    super('configure a valid HTTP grant and its selected bearer environment variable')
    this.name = 'HttpGrantError'
  }
}

export function normalizeHttpGrant(value: unknown): HttpGrant {
  const item = snapshotJsonObject(value, 'HTTP grant')
  if (
    !item ||
    Array.isArray(item) ||
    typeof item !== 'object' ||
    Object.keys(item).some(
      (key) =>
        ![
          'url',
          'method',
          'bearerEnv',
          'requestBytes',
          'responseBytes',
          'timeoutMs',
          'bodySchema',
        ].includes(key),
    ) ||
    typeof item.url !== 'string' ||
    item.url.length > 2048 ||
    typeof item.method !== 'string' ||
    !['GET', 'POST'].includes(item.method)
  )
    throw new HttpGrantError()
  if (
    item.bearerEnv !== undefined &&
    (typeof item.bearerEnv !== 'string' ||
      !/^[A-Z][A-Z0-9_]{0,127}$/.test(item.bearerEnv) ||
      item.bearerEnv.includes('\n'))
  )
    throw new HttpGrantError()
  const bound = (key: 'requestBytes' | 'responseBytes' | 'timeoutMs') => {
    const value = Object.hasOwn(item, key) ? item[key] : HTTP_LIMITS[key]
    if (
      typeof value !== 'number' ||
      !Number.isSafeInteger(value) ||
      value < 1 ||
      value > HTTP_MAX_LIMITS[key]
    )
      throw new HttpGrantError()
    return value
  }
  if (item.bodySchema !== undefined) {
    if (item.method !== 'POST' || canonicalJson(item.bodySchema).length > 16384)
      throw new HttpGrantError()
  }
  return Object.freeze({
    url: item.url,
    method: item.method as 'GET' | 'POST',
    ...(item.bearerEnv === undefined ? {} : { bearerEnv: item.bearerEnv as string }),
    requestBytes: bound('requestBytes'),
    responseBytes: bound('responseBytes'),
    timeoutMs: bound('timeoutMs'),
    ...(item.bodySchema === undefined ? {} : { bodySchema: item.bodySchema as SchemaValue }),
  })
}

export type HttpGrantInput = Omit<HttpGrant, 'requestBytes' | 'responseBytes' | 'timeoutMs'> &
  Partial<Pick<HttpGrant, 'requestBytes' | 'responseBytes' | 'timeoutMs'>>
export type GrantInput =
  | ({ readonly kind: 'http' } & HttpGrantInput)
  | ({ readonly kind: 'command' } & ProjectCommand)
  | AcpGrant
export type GrantPolicy =
  | ({ readonly kind: 'http' } & HttpGrant)
  | ({ readonly kind: 'command' } & ProjectCommand)
  | AcpGrant
export interface AcpGrant {
  readonly kind: 'acp'
  readonly client: 'codex' | 'claude' | 'pi'
  readonly model?: string
}
export interface GrantedSlot {
  readonly kind: 'grant'
  readonly policy: GrantPolicy
  readonly name?: string
}

/** A declaration is policy data, never an active handle or permission by itself. */
export function normalizeGrant(value: unknown): GrantPolicy {
  const item = snapshotJsonObject(value, 'grant')
  if (item === null || typeof item !== 'object' || Array.isArray(item))
    throw new TypeError('grant must be an object')
  const { kind, ...policy } = item as JsonObject
  if (kind === 'http') return Object.freeze({ kind, ...normalizeHttpGrant(policy) })
  if (kind === 'command') return Object.freeze({ kind, ...normalizeProjectCommand(policy) })
  if (kind === 'acp') {
    if (
      Object.keys(policy).some((key) => key !== 'client' && key !== 'model') ||
      !['codex', 'claude', 'pi'].includes(policy.client as string) ||
      ('model' in policy &&
        (typeof policy.model !== 'string' ||
          !/^[A-Za-z0-9][A-Za-z0-9._:/+-]{0,255}(?![\s\S])/.test(policy.model)))
    )
      throw new TypeError(
        'ACP grant requires a supported native client and optional model identifier',
      )
    return Object.freeze({
      kind,
      client: policy.client as AcpGrant['client'],
      ...('model' in policy ? { model: policy.model as string } : {}),
    })
  }
  throw new TypeError('grant kind must be http, command, or acp')
}

export function grantName(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length > 64 ||
    value.includes('\n') ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)
  )
    throw new TypeError('grant name must be a LocalName')
  return value
}
