import { expect, test } from 'bun:test'
import { formatProgress } from '../fixtures/repair-batch/flows/monitor/monitor.ts'

// Application-library checks only; native coverage gaps are recorded in
// .tmp/host-foundation/mock-removal-repair-monitoring.md.
const presentations = [
  {
    record: { phase: 'baseline', attempt: 0 },
    compact: 'baseline',
    descriptive: 'Reproducing the defect with the fixed checks.',
  },
  ...[1, 2].flatMap((attempt) => [
    {
      record: { phase: 'proposal', attempt },
      compact: `proposal ${attempt}`,
      descriptive: `Requesting repair proposal ${attempt} of 2.`,
    },
    {
      record: { phase: 'check', attempt },
      compact: `check ${attempt}`,
      descriptive: `Checking candidate ${attempt} against the unchanged acceptance cases.`,
    },
  ]),
  ...[0, 1, 2].map((attempt) => ({
    record: { phase: 'finished', attempt },
    compact: 'finished',
    descriptive: 'Repair method finished; the execution result determines its outcome.',
  })),
]

for (const { record, compact, descriptive } of presentations) {
  test(`formats ${record.phase} attempt ${record.attempt} without changing phase evidence`, () => {
    const value = Object.freeze(record)
    expect(formatProgress(value, 'compact')).toEqual({ phase: record.phase, text: compact })
    expect(formatProgress(value, 'descriptive')).toEqual({
      phase: record.phase,
      text: descriptive,
    })
    expect(Object.keys(value).sort()).toEqual(['attempt', 'phase'])
    for (const style of ['compact', 'descriptive'] as const) {
      const formatted = formatProgress(value, style)
      expect(Object.keys(formatted).sort()).toEqual(['phase', 'text'])
      expect(Array.from(formatted.text).length).toBeLessThanOrEqual(256)
    }
  })
}

const invalidRecords = [
  { name: 'null', value: null },
  { name: 'array', value: [] },
  { name: 'string', value: 'baseline' },
  { name: 'number', value: 0 },
  { name: 'missing fields', value: {} },
  { name: 'missing attempt', value: { phase: 'baseline' } },
  { name: 'missing phase', value: { attempt: 0 } },
  { name: 'baseline with an attempt', value: { phase: 'baseline', attempt: 1 } },
  { name: 'proposal without an attempt', value: { phase: 'proposal', attempt: 0 } },
  { name: 'check without an attempt', value: { phase: 'check', attempt: 0 } },
  { name: 'attempt above the limit', value: { phase: 'finished', attempt: 3 } },
  { name: 'negative attempt', value: { phase: 'finished', attempt: -1 } },
  { name: 'fractional attempt', value: { phase: 'check', attempt: 1.5 } },
  { name: 'text attempt', value: { phase: 'check', attempt: '1' } },
  { name: 'unknown phase', value: { phase: 'invented', attempt: 0 } },
  { name: 'non-text phase', value: { phase: 1, attempt: 1 } },
  {
    name: 'unrelated source data',
    value: { phase: 'check', attempt: 1, source: 'private text' },
  },
]

for (const { name, value } of invalidRecords) {
  test(`rejects ${name} rather than formatting invalid phase evidence`, () => {
    for (const style of ['compact', 'descriptive'] as const)
      expect(() => formatProgress(value, style)).toThrow('Invalid repair phase')
  })
}
