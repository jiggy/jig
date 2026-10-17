import type { AttemptReceipt, Prepared } from '../src/attempt-contract.js'
import type { preparePrivateCliRun } from '../src/cli-attempt-execution.js'
import { privateDomainDigest } from '../src/internal/identity.js'
import type { JsonValue } from '../src/json.js'

/** Private host preparation: immutable caller evidence, without dispatch or project I/O. */
export const prepareCliFixtureRun: typeof preparePrivateCliRun = async (input) => {
  const canonicalRequest = structuredClone({
    expectedApproval: input.expectedApproval ?? `sha256:${'b'.repeat(64)}`,
    target: input.target,
    input: input.input,
    files: input.captured.map(({ name, files }) => {
      const manifest = files
        .map(({ path, input }) => ({ path, bytes: input.bytes, digest: input.digest }))
        .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
      return {
        port: name,
        manifestDigest: privateDomainDigest('JIG-Prepared-Attachment/1', manifest),
        bytes: manifest.reduce((sum, file) => sum + file.bytes, 0),
      }
    }),
    constraints: {
      durationMs: input.durationMs,
      resultBytes: 1_048_576,
      artifactBytes: input.output ? 268_435_456 : 0,
    },
    outputIntent: { packet: input.output, receive: [] },
  })
  function freeze(value: unknown): void {
    if (value !== null && typeof value === 'object') {
      for (const child of Object.values(value)) freeze(child)
      Object.freeze(value)
    }
  }
  freeze(canonicalRequest)
  const requestDigest = privateDomainDigest('JIG-Prepared-Attempt-Request/1', canonicalRequest)
  return {
    ticket: `private-host-ticket:${requestDigest}`,
    requestDigest,
    submitBefore: '2099-01-01T00:00:00.000Z',
    retainUntil: '2099-01-02T00:00:00.000Z',
    canonicalRequest,
  }
}

export function cliFixtureAcceptance(
  request: { ticket: string; request: Prepared['canonicalRequest'] },
  runId: string,
): { role: 'owner'; receipt: AttemptReceipt } {
  const requestDigest = privateDomainDigest(
    'JIG-Prepared-Attempt-Request/1',
    request.request as unknown as JsonValue,
  )
  if (request.ticket !== `private-host-ticket:${requestDigest}`)
    throw new Error('submission did not preserve the host-issued ticket and frozen request')
  return {
    role: 'owner',
    receipt: {
      runId,
      requestDigest,
      acceptedAt: '2026-01-01T00:00:00.000Z',
      target: request.request.target,
      approval: request.request.expectedApproval,
      artifactResults: [],
    },
  }
}
