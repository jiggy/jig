import { compileEmbeddedSchema } from '../schema/index.js'
import { HttpGrantError, type GrantPolicy, type HttpGrant } from './grants.js'

/** Host validation: authoring helpers have no URL constructor or schema I/O in their guest realm. */
export function validateHttpPolicy(grant: HttpGrant): void {
  let url: URL
  try {
    url = new URL(grant.url)
  } catch {
    throw new HttpGrantError()
  }
  if (
    url.href !== grant.url ||
    url.username ||
    url.password ||
    url.href.includes('#') ||
    (url.protocol !== 'https:' &&
      !(url.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(url.hostname)))
  )
    throw new HttpGrantError()
  if (grant.bodySchema !== undefined)
    compileEmbeddedSchema(grant.bodySchema, { path: 'HTTP grant bodySchema' })
}

export function validateGrantPolicy(policy: GrantPolicy): void {
  if (policy.kind === 'http') validateHttpPolicy(policy)
}
