import { describe, expect, test } from 'bun:test'
import { createCipheriv } from 'node:crypto'
import { inspect } from 'node:util'
import {
  issuePrivateSubmissionTicket,
  openPrivateSubmissionTicket,
  type PrivateSubmissionTicketClaims,
  PrivateSubmissionTicketError,
  type PrivateSubmissionTicketErrorCode,
} from '../../src/internal/submission-ticket.js'
import { canonicalJson as canonicalBytes, type JsonValue } from '../../src/json.js'

const key = Buffer.alloc(32, 42)
const input = {
  domainId: 'a'.repeat(64),
  projectDigest: `sha256:${'b'.repeat(64)}`,
  requestDigest: `sha256:${'c'.repeat(64)}`,
  bootId: 'boot_1',
  issuedMonotonicMs: 100,
  acceptBeforeMonotonicMs: 600100,
  issuedUnixMs: 1700000000000,
  retainUntilUnixMs: 1700172800000,
} satisfies Omit<PrivateSubmissionTicketClaims, 'ticketNonce'>
const scope = { domainId: input.domainId, projectDigest: input.projectDigest }

function canonicalJson(value: JsonValue): string {
  return Buffer.from(canonicalBytes(value)).toString('utf8')
}

function refusal(operation: () => unknown, code: PrivateSubmissionTicketErrorCode): void {
  try {
    operation()
    throw new Error('Expected refusal')
  } catch (error) {
    expect(error).toBeInstanceOf(PrivateSubmissionTicketError)
    expect((error as PrivateSubmissionTicketError).code).toBe(code)
  }
}

// Independent encoder permits authenticated hostile plaintext, not an issuance seam.
function seal(text: string): string {
  const iv = Buffer.alloc(12, 9)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(Buffer.from('jig/private-submission-ticket/1'))
  const ciphertext = Buffer.concat([cipher.update(text), cipher.final()])
  return `jst1.${Buffer.concat([iv, ciphertext, cipher.getAuthTag()]).toString('base64url')}`
}

describe('private submission ticket codec', () => {
  test('exact immutable roundtrip, opaque payload, no key mutation or time policy', () => {
    const before = Buffer.from(key)
    const issued = issuePrivateSubmissionTicket(key, input)
    expect(issued.claims).toEqual({ ...input, ticketNonce: issued.claims.ticketNonce })
    expect(issued.claims.ticketNonce).toMatch(/^[0-9a-f]{64}$/)
    expect(openPrivateSubmissionTicket(key, issued.ticket, scope)).toEqual(issued.claims)
    expect(Object.isFrozen(issued)).toBe(true)
    expect(Object.isFrozen(issued.claims)).toBe(true)
    expect(Object.isFrozen(openPrivateSubmissionTicket(key, issued.ticket, scope))).toBe(true)
    expect(key).toEqual(before)
    expect(issued.ticket.length).toBeLessThanOrEqual(2048)
    const raw = Buffer.from(issued.ticket.slice(5), 'base64url').toString('utf8')
    for (const value of [input.domainId, input.projectDigest, input.requestDigest, input.bootId]) {
      expect(raw).not.toContain(value)
    }
    // These old wall hints remain authenticated facts, not automatic rejection.
    const old = issuePrivateSubmissionTicket(key, {
      ...input,
      issuedUnixMs: 0,
      retainUntilUnixMs: 600000,
    })
    expect(openPrivateSubmissionTicket(key, old.ticket, scope)).toEqual(old.claims)
  })

  test('fresh nonce and token on every issuance of identical meaning', () => {
    const issued = Array.from({ length: 128 }, () => issuePrivateSubmissionTicket(key, input))
    expect(new Set(issued.map(({ claims }) => claims.ticketNonce)).size).toBe(128)
    expect(new Set(issued.map(({ ticket }) => ticket)).size).toBe(128)
  })

  test('wrong key, issuance domain and project fail closed', () => {
    const { ticket } = issuePrivateSubmissionTicket(key, input)
    refusal(() => openPrivateSubmissionTicket(Buffer.alloc(32, 7), ticket, scope), 'INVALID_TICKET')
    refusal(
      () => openPrivateSubmissionTicket(key, ticket, { ...scope, domainId: 'd'.repeat(64) }),
      'SCOPE_MISMATCH',
    )
    refusal(
      () =>
        openPrivateSubmissionTicket(key, ticket, {
          ...scope,
          projectDigest: `sha256:${'d'.repeat(64)}`,
        }),
      'SCOPE_MISMATCH',
    )
  })

  test('every token byte is authenticated, including IV and tag', () => {
    const { ticket } = issuePrivateSubmissionTicket(key, input)
    const packed = Buffer.from(ticket.slice(5), 'base64url')
    for (let index = 0; index < packed.length; index += 1) {
      const changed = Buffer.from(packed)
      changed[index] = changed[index]! ^ 1
      refusal(
        () => openPrivateSubmissionTicket(key, `jst1.${changed.toString('base64url')}`, scope),
        'INVALID_TICKET',
      )
    }
  })

  test('malformed, truncated, oversized and noncanonical tokens reject', () => {
    const { ticket } = issuePrivateSubmissionTicket(key, input)
    for (const value of [
      null,
      {},
      1,
      '',
      'jst1.',
      'jst2.AAAA',
      'jst1.A',
      'jst1.AB',
      `${ticket}=`,
      `${ticket}\n`,
      `${ticket} `,
      'jst1.' + 'A'.repeat(2044),
      'jst1.' + '+/AA',
      'jst1.' + '_'.repeat(40),
    ]) {
      refusal(() => openPrivateSubmissionTicket(key, value, scope), 'INVALID_TICKET')
    }
    for (let length = 0; length < ticket.length; length += 1) {
      refusal(
        () => openPrivateSubmissionTicket(key, ticket.slice(0, length), scope),
        'INVALID_TICKET',
      )
    }
    const valid = seal(canonicalJson({ ...input, ticketNonce: 'e'.repeat(64) }))
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
    // Select a payload with spare base64 pad bits, then change only those bits.
    const padded = [
      valid,
      seal(' ' + canonicalJson({ ...input, ticketNonce: 'e'.repeat(64) })),
    ].find((value) => value.slice(5).length % 4 !== 0)!
    const last = alphabet.indexOf(padded.at(-1)!)
    const alias = padded.slice(0, -1) + alphabet[last | 1]
    expect(alias).not.toBe(padded)
    expect(Buffer.from(alias.slice(5), 'base64url')).toEqual(
      Buffer.from(padded.slice(5), 'base64url'),
    )
    refusal(() => openPrivateSubmissionTicket(key, alias, scope), 'INVALID_TICKET')
  })

  test('keys require exactly 256 bits and never coerce values', () => {
    for (const value of [null, 'secret', [], Buffer.alloc(0), Buffer.alloc(31), Buffer.alloc(33)]) {
      refusal(() => issuePrivateSubmissionTicket(value as Uint8Array, input), 'INVALID_KEY')
      refusal(() => openPrivateSubmissionTicket(value as Uint8Array, 'bad', scope), 'INVALID_KEY')
    }
  })

  test('closed ordinary claims reject unknown fields, accessors, proxies and invalid scalar types', () => {
    let reads = 0
    const accessor = Object.defineProperty({ ...input }, 'bootId', {
      enumerable: true,
      get() {
        reads += 1
        return 'secret'
      },
    })
    for (const value of [
      null,
      [],
      { ...input, unknown: true },
      { ...input, ticketNonce: 'e'.repeat(64) },
      Object.assign(Object.create({}), input),
      accessor,
      new Proxy(input, {}),
      { ...input, [Symbol('secret')]: true },
      { ...input, bootId: '' },
      { ...input, bootId: 'x'.repeat(129) },
      { ...input, domainId: 'A'.repeat(64) },
      { ...input, requestDigest: 'c'.repeat(64) },
      { ...input, projectDigest: 1 },
    ]) {
      refusal(() => issuePrivateSubmissionTicket(key, value as typeof input), 'INVALID_CLAIMS')
    }
    expect(reads).toBe(0)
    refusal(
      () => openPrivateSubmissionTicket(key, 'bad', { ...scope, unknown: true } as typeof scope),
      'INVALID_CLAIMS',
    )
  })

  test('integer, overflow and expiry ordering validation on issuance and authenticated decode', () => {
    const fields = [
      'issuedMonotonicMs',
      'acceptBeforeMonotonicMs',
      'issuedUnixMs',
      'retainUntilUnixMs',
    ]
    for (const field of fields) {
      for (const value of [-1, -0, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '100', null]) {
        const bad = { ...input, [field]: value }
        refusal(() => issuePrivateSubmissionTicket(key, bad as typeof input), 'INVALID_CLAIMS')
        if (typeof value !== 'number' || Number.isFinite(value)) {
          const text = JSON.stringify({ ...bad, ticketNonce: 'e'.repeat(64) }).replace(
            `"${field}":0,`,
            `"${field}":${Object.is(value, -0) ? '-0' : '0'},`,
          )
          refusal(() => openPrivateSubmissionTicket(key, seal(text), scope), 'INVALID_TICKET')
        }
      }
    }
    for (const bad of [
      { ...input, acceptBeforeMonotonicMs: input.issuedMonotonicMs },
      { ...input, acceptBeforeMonotonicMs: 99 },
      { ...input, retainUntilUnixMs: input.issuedUnixMs },
      { ...input, retainUntilUnixMs: input.issuedUnixMs + 599999 },
    ]) {
      refusal(() => issuePrivateSubmissionTicket(key, bad), 'INVALID_CLAIMS')
      refusal(
        () =>
          openPrivateSubmissionTicket(
            key,
            seal(JSON.stringify({ ...bad, ticketNonce: 'e'.repeat(64) })),
            scope,
          ),
        'INVALID_TICKET',
      )
    }
    const edge = issuePrivateSubmissionTicket(key, {
      ...input,
      issuedMonotonicMs: Number.MAX_SAFE_INTEGER - 1,
      acceptBeforeMonotonicMs: Number.MAX_SAFE_INTEGER,
      issuedUnixMs: Number.MAX_SAFE_INTEGER - 1,
      retainUntilUnixMs: Number.MAX_SAFE_INTEGER,
    })
    expect(openPrivateSubmissionTicket(key, edge.ticket, scope)).toEqual(edge.claims)
  })

  test('authenticated invalid JSON, unknown fields and noncanonical plaintext reject', () => {
    const claims = { ...input, ticketNonce: 'e'.repeat(64) }
    for (const text of [
      '{',
      'null',
      '[]',
      JSON.stringify({ ...claims, unknown: true }),
      JSON.stringify({ ...claims, ticketNonce: 'caller-key' }),
      JSON.stringify(claims),
      ` ${canonicalJson(claims)}`,
      canonicalJson(claims).replace('"bootId":', '"bootId":"duplicate","bootId":'),
    ]) {
      refusal(() => openPrivateSubmissionTicket(key, seal(text), scope), 'INVALID_TICKET')
    }
    expect(openPrivateSubmissionTicket(key, seal(canonicalJson(claims)), scope)).toEqual(claims)
  })

  test('errors never render supplied token, key, claims or raw crypto exceptions', () => {
    const canary = 'PRIVATE_CANARY_DO_NOT_RENDER'
    for (const operation of [
      () => openPrivateSubmissionTicket(key, canary, scope),
      () => issuePrivateSubmissionTicket(key, { ...input, bootId: canary + '!' }),
      () => issuePrivateSubmissionTicket(canary as unknown as Uint8Array, input),
    ]) {
      try {
        operation()
        throw new Error('Expected refusal')
      } catch (error) {
        expect(error).toBeInstanceOf(PrivateSubmissionTicketError)
        for (const rendering of [String(error), inspect(error), JSON.stringify(error)]) {
          expect(rendering).not.toContain(canary)
          expect(rendering).not.toContain(input.domainId)
          expect(rendering).not.toContain(key.toString('hex'))
        }
        expect((error as Error).cause).toBeUndefined()
      }
    }
    // No I/O or clock dependencies: repeated validation returns facts only.
    const { ticket, claims } = issuePrivateSubmissionTicket(key, input)
    for (let count = 0; count < 3; count += 1) {
      expect(openPrivateSubmissionTicket(key, ticket, scope)).toEqual(
        claims as unknown as JsonValue,
      )
    }
  })
})
