import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { types as utilTypes } from 'node:util'

import { canonicalJson, decodeJson1, type JsonObject } from '../json.js'

/** Package-private authenticated facts, not authorization or acceptance evidence. */
export type PrivateSubmissionTicketClaims = Readonly<{
  domainId: string
  projectDigest: string
  requestDigest: string
  ticketNonce: string
  bootId: string
  issuedMonotonicMs: number
  acceptBeforeMonotonicMs: number
  issuedUnixMs: number
  retainUntilUnixMs: number
}>

export type PrivateSubmissionTicketErrorCode =
  | 'INVALID_KEY'
  | 'INVALID_CLAIMS'
  | 'INVALID_TICKET'
  | 'SCOPE_MISMATCH'

export class PrivateSubmissionTicketError extends Error {
  constructor(readonly code: PrivateSubmissionTicketErrorCode) {
    super(`Submission ticket refused: ${code}.`)
    this.name = 'PrivateSubmissionTicketError'
  }
}

const fields = [
  'domainId',
  'projectDigest',
  'requestDigest',
  'ticketNonce',
  'bootId',
  'issuedMonotonicMs',
  'acceptBeforeMonotonicMs',
  'issuedUnixMs',
  'retainUntilUnixMs',
] as const
const prefix = 'jst1.'
const aad = Buffer.from('jig/private-submission-ticket/1', 'ascii')
const maxTokenBytes = 2048
const hexIdentity = /^[0-9a-f]{64}$/
const digest = /^sha256:[0-9a-f]{64}$/

function refuse(code: PrivateSubmissionTicketErrorCode): never {
  throw new PrivateSubmissionTicketError(code)
}

function keyBytes(key: Uint8Array): Buffer {
  try {
    if (utilTypes.isProxy(key) || !(key instanceof Uint8Array) || key.byteLength !== 32) {
      return refuse('INVALID_KEY')
    }
    return Buffer.from(key)
  } catch {
    return refuse('INVALID_KEY')
  }
}

// Read only own enumerable data descriptors, never accessors, proxies or toJSON.
// The flat, closed shape bounds validation before canonicalization.
function closed(value: unknown, names: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || utilTypes.isProxy(value)) {
    return refuse('INVALID_CLAIMS')
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return refuse('INVALID_CLAIMS')
  const keys = Reflect.ownKeys(value)
  if (
    keys.length !== names.length ||
    keys.some((key) => typeof key !== 'string' || !names.includes(key))
  ) {
    return refuse('INVALID_CLAIMS')
  }
  const result: Record<string, unknown> = Object.create(null)
  for (const name of names) {
    const descriptor = Object.getOwnPropertyDescriptor(value, name)
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor))
      return refuse('INVALID_CLAIMS')
    result[name] = descriptor.value
  }
  return result
}

function matches(value: unknown, pattern: RegExp, maxLength: number): value is string {
  return typeof value === 'string' && value.length <= maxLength && pattern.test(value)
}

function claimsFrom(value: unknown): PrivateSubmissionTicketClaims {
  const claims = closed(value, fields)
  if (
    !matches(claims.domainId, hexIdentity, 64) ||
    !matches(claims.ticketNonce, hexIdentity, 64) ||
    !matches(claims.projectDigest, digest, 71) ||
    !matches(claims.requestDigest, digest, 71) ||
    !matches(claims.bootId, /^[A-Za-z0-9_-]{1,128}$/, 128)
  )
    return refuse('INVALID_CLAIMS')
  for (const name of fields.slice(5)) {
    const number = claims[name]
    if (
      typeof number !== 'number' ||
      !Number.isSafeInteger(number) ||
      number < 0 ||
      Object.is(number, -0)
    ) {
      return refuse('INVALID_CLAIMS')
    }
  }
  const result = claims as unknown as PrivateSubmissionTicketClaims
  const validity = result.acceptBeforeMonotonicMs - result.issuedMonotonicMs
  const retention = result.retainUntilUnixMs - result.issuedUnixMs
  if (validity <= 0 || retention < validity) return refuse('INVALID_CLAIMS')
  return Object.freeze(result)
}

export function issuePrivateSubmissionTicket(
  key: Uint8Array,
  input: Omit<PrivateSubmissionTicketClaims, 'ticketNonce'>,
): Readonly<{ ticket: string; claims: PrivateSubmissionTicketClaims }> {
  const bytes = keyBytes(key)
  try {
    const supplied = closed(
      input,
      fields.filter((name) => name !== 'ticketNonce'),
    )
    const claims = claimsFrom({ ...supplied, ticketNonce: randomBytes(32).toString('hex') })
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', bytes, iv)
    cipher.setAAD(aad)
    const ciphertext = Buffer.concat([
      cipher.update(canonicalJson(claims as unknown as JsonObject)),
      cipher.final(),
    ])
    const ticket =
      prefix + Buffer.concat([iv, ciphertext, cipher.getAuthTag()]).toString('base64url')
    if (ticket.length > maxTokenBytes) return refuse('INVALID_CLAIMS')
    return Object.freeze({ ticket, claims })
  } catch {
    return refuse('INVALID_CLAIMS')
  } finally {
    bytes.fill(0)
  }
}

/**
 * Authenticates and binds scope only. The store must separately require an
 * existing record and enforce authorization, boot/clock continuity, acceptance,
 * retirement and retained history. No timestamp can resurrect missing state.
 */
export function openPrivateSubmissionTicket(
  key: Uint8Array,
  ticket: unknown,
  expected: Readonly<{ domainId: string; projectDigest: string }>,
): PrivateSubmissionTicketClaims {
  const bytes = keyBytes(key)
  try {
    const scope = closed(expected, ['domainId', 'projectDigest'])
    if (!matches(scope.domainId, hexIdentity, 64) || !matches(scope.projectDigest, digest, 71)) {
      return refuse('INVALID_CLAIMS')
    }
    if (typeof ticket !== 'string' || ticket.length > maxTokenBytes || !ticket.startsWith(prefix)) {
      return refuse('INVALID_TICKET')
    }
    const encoded = ticket.slice(prefix.length)
    if (!/^[A-Za-z0-9_-]+$/.test(encoded)) return refuse('INVALID_TICKET')
    const packed = Buffer.from(encoded, 'base64url')
    if (packed.length <= 28 || packed.toString('base64url') !== encoded)
      return refuse('INVALID_TICKET')
    let claims: PrivateSubmissionTicketClaims
    try {
      const decipher = createDecipheriv('aes-256-gcm', bytes, packed.subarray(0, 12))
      decipher.setAAD(aad)
      decipher.setAuthTag(packed.subarray(-16))
      // Do not decode or expose update's unauthenticated plaintext before final.
      const plaintext = Buffer.concat([decipher.update(packed.subarray(12, -16)), decipher.final()])
      const value = decodeJson1(plaintext)
      claims = claimsFrom(value)
      if (!plaintext.equals(canonicalJson(value))) return refuse('INVALID_TICKET')
    } catch {
      return refuse('INVALID_TICKET')
    }
    if (claims.domainId !== scope.domainId || claims.projectDigest !== scope.projectDigest) {
      return refuse('SCOPE_MISMATCH')
    }
    return claims
  } finally {
    bytes.fill(0)
  }
}
