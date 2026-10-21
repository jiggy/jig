import { createHash } from 'node:crypto'
import type { CanonicalRequest } from './attempt-contract.js'
import { canonicalJson, type JsonValue } from './json.js'

/** Shared inert request identity, not ticket authentication or execution authority. */
export function attemptRequestDigest(request: CanonicalRequest): string {
  const meaning = {
    ...request,
    files: [...request.files].sort((a, b) => (a.port < b.port ? -1 : a.port > b.port ? 1 : 0)),
    outputIntent: { ...request.outputIntent, receive: [...request.outputIntent.receive].sort() },
  }
  return `sha256:${createHash('sha256')
    .update('JIG-Prepared-Attempt-Request/1\0', 'ascii')
    .update(canonicalJson(meaning as unknown as JsonValue))
    .digest('hex')}`
}
