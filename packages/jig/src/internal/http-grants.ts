import { canonicalJson } from '../json.js'
import {
  type HttpGrant,
  HttpGrantError,
  normalizeHttpGrant as normalizeHttpValue,
} from '../project/grants.js'
import { validateHttpPolicy } from '../project/grant-validation.js'
import type { InvocationSlots } from '../project/invocation-slots.js'
import { compileEmbeddedSchema } from '../schema/index.js'
import { HTTP_REQUEST_PROXY_ENV, normalizeHttpRequestProxy } from './http-request-proxy.js'
import { snapshotPrivateOrdinaryJson } from './private-ordinary-json.js'
export {
  type HttpGrant,
  HTTP_LIMITS,
  HTTP_MAX_LIMITS,
  HttpGrantError,
} from '../project/grants.js'

export interface PrivateHttpGrants {
  readonly kind: 'private-grant-credentials'
}
const secrets = new WeakMap<
  PrivateHttpGrants,
  {
    readonly environment: Readonly<Record<string, string | undefined>>
    readonly proxy: string | undefined
  }
>()

/** Only the private owner keeps environment bytes; public policy comes from admitted slots. */
export function openPrivateHttpGrants(
  environment: Readonly<Record<string, string | undefined>>,
): PrivateHttpGrants {
  const owner = Object.freeze({ kind: 'private-grant-credentials' as const })
  const { [HTTP_REQUEST_PROXY_ENV]: proxy, ...bearerEnvironment } = environment
  secrets.set(owner, { environment: Object.freeze(bearerEnvironment), proxy })
  return owner
}

export function httpCredential(
  owner: PrivateHttpGrants | undefined,
  grant: HttpGrant,
): string | undefined {
  if (grant.bearerEnv === undefined) return undefined
  const credential =
    owner === undefined ? undefined : secrets.get(owner)?.environment[grant.bearerEnv]
  if (credential === undefined || !/^[\x21-\x7e]{1,8192}$/.test(credential))
    throw new HttpGrantError()
  return credential
}

export function httpRequestProxy(
  owner: PrivateHttpGrants | undefined,
  grant: HttpGrant,
): string | undefined {
  if (owner === undefined || !grant.url.startsWith('https:')) return undefined
  return normalizeHttpRequestProxy(secrets.get(owner)?.proxy)
}

/** Check only credentials selected by this exact target; never dispatch or expose their values. */
export function selectHttpGrants(
  owner: PrivateHttpGrants | undefined,
  slots: InvocationSlots,
): Readonly<Record<string, HttpGrant>> {
  const selected: Record<string, HttpGrant> = Object.create(null)
  for (const [name, route] of Object.entries(slots)) {
    if (route.kind !== 'native' || route.grant?.kind !== 'http') continue
    const { kind: _, ...grant } = route.grant
    httpCredential(owner, grant)
    selected[name] = Object.freeze(grant)
  }
  return Object.freeze(selected)
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

export function normalizeHttpGrant(value: unknown): HttpGrant {
  const grant = normalizeHttpValue(value)
  validateHttpPolicy(grant)
  return grant
}
