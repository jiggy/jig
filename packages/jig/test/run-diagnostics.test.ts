import { expect, test } from 'bun:test'
import { PrivateRunDiagnostics } from '../src/internal/run-diagnostics.js'

test('diagnostics retain independent UTF-8 streams with host call-path attribution', () => {
  const record = new PrivateRunDiagnostics()
  const euro = new TextEncoder().encode('€')
  expect(record.record(euro.slice(0, 1), ['worker', 'agent'])).toBe('')
  expect(record.record(new TextEncoder().encode('other'), ['other'])).toBe('other')
  expect(record.record(euro.slice(1), ['worker', 'agent'])).toBe('€')
  expect(record.snapshot()).toEqual({
    entries: [
      { operations: ['worker', 'agent'], stderr: '€', stderrBytes: 3, stderrTruncated: false },
      { operations: ['other'], stderr: 'other', stderrBytes: 5, stderrTruncated: false },
    ],
    truncated: false,
  })
})

test('diagnostic bounds are aggregate, with explicit byte and invocation truncation', () => {
  const record = new PrivateRunDiagnostics()
  record.record(new Uint8Array(64 * 1024).fill(65), ['first'])
  record.record(new Uint8Array([66]), ['second'])
  for (let i = 0; i < 40; i++) record.record(new Uint8Array([67]), [`call-${i}`])
  const snapshot = record.snapshot()
  expect(snapshot.entries).toHaveLength(32)
  expect(snapshot.truncated).toBeTrue()
  expect(snapshot.entries[0]!.stderr.length).toBe(64 * 1024)
  expect(snapshot.entries[1]).toMatchObject({ stderr: '', stderrBytes: 1, stderrTruncated: true })
})
