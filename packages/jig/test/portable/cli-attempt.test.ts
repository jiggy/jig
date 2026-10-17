import { expect, test } from 'bun:test'
import {
  privateCliAttemptOperation,
  privateCliCommandLifetimeMs,
  privateCliRequiresHost,
} from '../../src/cli.js'

test('attempt grammar classifies execution requirements without acquiring authority', () => {
  for (const operation of ['inspect', 'prepare', 'submit', 'lookup', 'cancel', 'result', 'export'] as const) {
    const args = ['attempt', operation, '--json']
    expect(privateCliAttemptOperation(args)).toBe(operation)
    expect(privateCliRequiresHost(args)).toBe(operation === 'submit')
    for (const invalid of [
      ['attempt', operation],
      ['attempt', operation, '--json', 'ticket-must-not-be-an-argument'],
      ['attempt', operation, '--json', '--json'],
      ['attempt', operation, '--input', '{}'],
      ['attempt', '--json', operation],
    ]) {
      expect(privateCliAttemptOperation(invalid)).toBeUndefined()
      expect(privateCliRequiresHost(invalid)).toBe(false)
    }
  }
  expect(privateCliRequiresHost(['attempt', 'retry', '--json'])).toBe(false)
  expect(privateCliCommandLifetimeMs(['attempt', 'submit', '--json'])).toBe(
    privateCliCommandLifetimeMs(['run', 'flow:flows/example', '--timeout', '24h']),
  )
  expect(privateCliCommandLifetimeMs(['attempt', 'lookup', '--json'])).toBe(300_000)
})
