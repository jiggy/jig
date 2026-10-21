import { expect } from 'bun:test'
import type { PrivateAcpAgentRuntime } from '../src/internal/acp-agent-provider.js'
import { PrivateFiniteAcpPolicyError } from '../src/internal/finite-acp-policy.js'
import { assertPrivateFiniteAcpPublicOutput } from '../src/internal/finite-acp-resource.js'
import type { JsonValue } from '../src/json.js'

/** Pure projection checks. Native resource termination requires the host suite. */
export function rejectsCredentialOutput(selected: PrivateAcpAgentRuntime, secret: string): void {
  const patterns = selected.secretBytes()
  try {
    const values: JsonValue[] = [
      { content: { type: 'text', text: `prefix ${secret} suffix` } },
      { messageId: secret },
      { entries: [{ content: secret, priority: 'high', status: 'pending' }] },
      { sessionId: secret },
      { future: [{ nested: { [secret]: 'value' } }] },
    ]
    for (const value of values) {
      let error: unknown
      try {
        assertPrivateFiniteAcpPublicOutput(value, patterns)
      } catch (caught) {
        error = caught
      }
      expect(error).toBeInstanceOf(PrivateFiniteAcpPolicyError)
      expect((error as Error).message).toBe('Native ACP output contained a private credential')
      expect(String(error)).not.toContain(secret)
    }
    expect(() =>
      assertPrivateFiniteAcpPublicOutput({ text: 'ordinary answer' }, patterns),
    ).not.toThrow()
  } finally {
    for (const pattern of patterns) pattern.fill(0)
  }
}
