import { canonicalJson, decodeJson1, type JsonObject, type JsonValue } from '../json.js'
import { httpResourceName, normalizeHttpSelections } from '../project/http.js'
import { compileEmbeddedSchema, type SchemaValue } from '../schema/index.js'
import { privateDomainDigest } from './identity.js'
import { snapshotPrivateOrdinaryJson } from './private-ordinary-json.js'

export const HTTP_LIMITS = Object.freeze({
  requestBytes: 262144,
  responseBytes: 1048576,
  timeoutMs: 60000,
  grants: 32,
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
export interface PrivateHttpGrants {
  readonly grants: Readonly<Record<string, HttpGrant>>
}
const secrets = new WeakMap<PrivateHttpGrants, Readonly<Record<string, string>>>()

export class HttpGrantError extends Error {
  constructor() {
    super('configure valid JIG_HTTP_GRANTS and the selected bearer environment variables')
    this.name = 'HttpGrantError'
  }
}

export function normalizeHttpGrant(value: unknown): HttpGrant {
  const item = snapshotPrivateOrdinaryJson(
    value,
    'HTTP grant',
    () => new HttpGrantError(),
  ) as JsonObject
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
  const url = new URL(item.url)
  if (
    url.href !== item.url ||
    url.username ||
    url.password ||
    url.href.includes('#') ||
    (url.protocol !== 'https:' &&
      !(url.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(url.hostname)))
  )
    throw new HttpGrantError()
  if (
    item.bearerEnv !== undefined &&
    (typeof item.bearerEnv !== 'string' || !/^[A-Z][A-Z0-9_]{0,127}$/.test(item.bearerEnv))
  )
    throw new HttpGrantError()
  const bound = (key: 'requestBytes' | 'responseBytes' | 'timeoutMs') => {
    const value = Object.hasOwn(item, key) ? item[key] : HTTP_LIMITS[key]
    if (
      typeof value !== 'number' ||
      !Number.isSafeInteger(value) ||
      value < 1 ||
      value > HTTP_LIMITS[key]
    )
      throw new HttpGrantError()
    return value
  }
  if (item.bodySchema !== undefined) {
    if (item.method !== 'POST' || canonicalJson(item.bodySchema).length > 16384)
      throw new HttpGrantError()
    compileEmbeddedSchema(item.bodySchema, { path: 'HTTP grant bodySchema' })
  }
  return Object.freeze({
    url: url.href,
    method: item.method as 'GET' | 'POST',
    ...(item.bearerEnv === undefined ? {} : { bearerEnv: item.bearerEnv as string }),
    requestBytes: bound('requestBytes'),
    responseBytes: bound('responseBytes'),
    timeoutMs: bound('timeoutMs'),
    ...(item.bodySchema === undefined ? {} : { bodySchema: item.bodySchema as SchemaValue }),
  })
}

/** Snapshot operator policy and keep credential bytes outside serializable identities. */
export function openPrivateHttpGrants(
  environment: Readonly<Record<string, string | undefined>>,
): PrivateHttpGrants {
  try {
    const raw = environment.JIG_HTTP_GRANTS ?? '{}'
    if (Buffer.byteLength(raw) > 131072) throw new HttpGrantError()
    const values = decodeJson1(Buffer.from(raw)) as JsonObject
    if (
      !values ||
      Array.isArray(values) ||
      typeof values !== 'object' ||
      Object.keys(values).length > HTTP_LIMITS.grants
    )
      throw new HttpGrantError()
    const grants: Record<string, HttpGrant> = Object.create(null)
    const credentials: Record<string, string> = Object.create(null)
    for (const [name, value] of Object.entries(values)) {
      if (!httpResourceName(name)) throw new HttpGrantError()
      const grant = normalizeHttpGrant(value)
      grants[name] = grant
      if (grant.bearerEnv !== undefined) {
        const secret = environment[grant.bearerEnv]
        // Missing credentials deny this resource without disabling unrelated projects.
        if (secret !== undefined) {
          if (!/^[\x21-\x7e]{1,8192}$/.test(secret)) throw new HttpGrantError()
          credentials[name] = secret
        }
      }
    }
    const owner = Object.freeze({ grants: Object.freeze(grants) })
    secrets.set(owner, Object.freeze(credentials))
    return owner
  } catch {
    throw new HttpGrantError()
  }
}

export function selectHttpGrants(
  owner: PrivateHttpGrants | undefined,
  value: unknown,
): Readonly<Record<string, HttpGrant>> {
  const names = normalizeHttpSelections(value)
  if (Object.keys(names).length && (owner === undefined || !secrets.has(owner)))
    throw new HttpGrantError()
  const selected: Record<string, HttpGrant> = Object.create(null)
  for (const [local, name] of Object.entries(names)) {
    const grant = owner!.grants[name]
    if (
      grant === undefined ||
      (grant.bearerEnv !== undefined && secrets.get(owner!)![name] === undefined)
    )
      throw new HttpGrantError()
    selected[local] = grant
  }
  return Object.freeze(selected)
}

export function httpCredential(owner: PrivateHttpGrants, name: string): string | undefined {
  if (!secrets.has(owner) || !Object.hasOwn(owner.grants, name)) throw new HttpGrantError()
  const credential = secrets.get(owner)![name]
  if (owner.grants[name]!.bearerEnv !== undefined && credential === undefined)
    throw new HttpGrantError()
  return credential
}

export function httpGrantDigest(grants: Readonly<Record<string, HttpGrant>>): string {
  return privateDomainDigest('JIG-HTTP-Grants/1', grants as unknown as JsonValue)
}

export function httpRequestBody(grant: HttpGrant, value: unknown): string | undefined {
  if (value === undefined) {
    if (grant.method === 'POST') throw new TypeError('POST requires a JSON body')
    return undefined
  }
  if (grant.method !== 'POST') throw new TypeError('GET does not accept a body')
  const body = snapshotPrivateOrdinaryJson(value, 'HTTP body', (message) => new TypeError(message))
  const bytes = canonicalJson(body)
  if (bytes.length > grant.requestBytes) throw new TypeError('HTTP request exceeds its grant')
  if (grant.bodySchema !== undefined)
    compileEmbeddedSchema(grant.bodySchema, { path: 'HTTP grant bodySchema' }).validate(
      body,
      'INVALID_INPUT',
    )
  return Buffer.from(bytes).toString('utf8')
}
