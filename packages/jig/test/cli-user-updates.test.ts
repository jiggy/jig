import { expect, test } from 'bun:test'
import { PrivateRunModel, privateAttentionReceipt } from '../src/cli-run-model.js'
import { PrivateCliUserUpdates } from '../src/cli-user-updates.js'

function observer() {
  const model = new PrivateRunModel(),
    printed: string[] = [],
    unavailable: string[] = []
  const updates = new PrivateCliUserUpdates(
    (text) => {
      printed.push(text)
      return true
    },
    () => true,
    (text) => unavailable.push(text),
    () => false,
    model,
  )
  return { model, updates, printed, unavailable }
}

test('accepted notices retain literal text and actual publisher without parsing relayed jobs', () => {
  const { model, updates, printed } = observer()
  model.observeCall({
    publisher: 'root',
    operationId: 'child',
    childPublisher: 'worker-instance',
    slot: 'review',
    state: 'active',
    time: 1,
  })
  const source = updates.open('progress', true)
  expect(
    source.accept(
      { kind: 'notice', text: '[job: invented] Full first line\nLiteral next line' },
      'root',
    ),
  ).toBe(true)
  expect(source.accept({ kind: 'notice', text: 'Worker claim' }, 'worker-instance')).toBe(true)
  expect(model.journal.map((entry) => entry.publisher)).toEqual(['root', 'worker-instance'])
  expect(model.journal[0]).toMatchObject({
    kind: 'flow',
    source: 'Flow',
    importance: 'info',
    text: '[job: invented] Full first line\nLiteral next line',
  })
  expect(model.journal[1]?.source).toContain('review')
  expect(printed).toHaveLength(2)
  source.retire()
  expect(model.journal).toHaveLength(2)
})

test('warnings/errors use one uncommitted exact escaped cause receipt', () => {
  const { model, updates, printed } = observer()
  const source = updates.open('progress')
  expect(
    source.accept({
      kind: 'notice',
      severity: 'error',
      text: 'Specific cause\nControl \u001b and bidi \u202e',
    }),
  ).toBe(true)
  expect(printed).toHaveLength(0)
  expect(model.journal).toHaveLength(1)
  expect(model.attention).toHaveLength(1)
  const report = model.attention[0]!
  expect(report.committed).toBe(false)
  const receipt = privateAttentionReceipt(report)
  expect(receipt).toContain('Flow update [progress]-reported error')
  expect(receipt).toContain('    Control \\u001b and bidi \\u202e')
  expect(receipt).not.toContain('\u001b')
  expect(report.bytes).toBe(Buffer.byteLength(receipt))
  source.retire('Updates incomplete: channel ended')
  expect(model.attention[0]).toBe(report)
})

test('notice quota rejects before history mutation and preserves the last complete view', () => {
  const { model, updates, unavailable } = observer(),
    source = updates.open('progress')
  source.accept({
    kind: 'view',
    id: 'evidence',
    title: 'Evidence',
    summary: 'Complete accepted snapshot',
    sections: [],
  })
  for (let index = 0; index < 128; index++)
    expect(source.accept({ kind: 'notice', text: `Information ${index}` })).toBe(true)
  expect(source.accept({ kind: 'notice', text: 'Beyond quota' })).toBe(false)
  expect(model.journal).toHaveLength(128)
  expect(model.journal.at(-1)?.text).toBe('Information 127')
  expect(model.views.values().next().value?.value.summary).toBe('Complete accepted snapshot')
  expect(model.views.values().next().value?.ended).toContain('limit')
  expect(unavailable).toHaveLength(1)
  expect(source.accept({ kind: 'notice', text: 'Late callback' })).toBe(false)
  expect(model.journal).toHaveLength(128)
})

test('clear and clean EOF remove current work without creating completion history', () => {
  const { model, updates } = observer(),
    source = updates.open('progress')
  source.accept({
    kind: 'activity',
    id: 'work',
    label: 'Reviewing',
    detail: 'Current literal action',
  })
  expect(model.activities.size).toBe(1)
  source.accept({ kind: 'clear', id: 'work' })
  expect(model.activities.size).toBe(0)
  expect(model.journal).toHaveLength(0)
  source.accept({ kind: 'activity', id: 'again', label: 'Still reviewing' })
  source.retire()
  expect(model.activities.size).toBe(0)
  expect(model.journal).toHaveLength(0)
})

test('typed host and diagnostic journal updates retain stable identity and actual path', () => {
  const model = new PrivateRunModel()
  expect(model.addHostEntry('capture', 'Capturing inputs')).toBe(true)
  const first = model.journal[0]!
  expect(model.addHostEntry('capture', 'Captured current inputs')).toBe(true)
  expect(model.journal).toHaveLength(1)
  expect(model.journal[0]?.sequence).toBe(first.sequence)
  expect(model.addDiagnostic('line one\n', ['root-operation', 'worker-operation'])).toBe(true)
  expect(model.addDiagnostic('line two', ['root-operation', 'worker-operation'], true)).toBe(true)
  expect(model.journal).toHaveLength(2)
  expect(model.journal[1]).toMatchObject({
    kind: 'diagnostic',
    text: 'line one\nline two',
    operationsPath: ['root-operation', 'worker-operation'],
    clipped: true,
  })
  expect(model.journal[1]?.publisher).toBeUndefined()
  expect(model.journal[1]?.key).toContain('worker-operation')
})

test('journal byte/count overflow preserves retained evidence and only discloses omission', () => {
  const model = new PrivateRunModel()
  for (let index = 0; index < 64; index++)
    expect(model.addHostEntry(String(index), `Host ${index}`)).toBe(true)
  expect(model.addHostEntry('overflow', 'Unretained host')).toBe(false)
  expect(model.journal.filter((e) => e.kind === 'host')).toHaveLength(64)
  expect(model.journalOmitted.host).toBe(1)
  const text = '\u001b'.repeat(10000)
  expect(model.addDiagnostic(text, [])).toBe(true)
  const diagnostic = model.journal.at(-1)
  expect(model.addDiagnostic(text, [])).toBe(false)
  expect(model.journal.at(-1)).toBe(diagnostic)
  expect(model.journalOmitted.diagnostic).toBe(1)
  expect(model.stopped).toBe(false)
  expect(model.calls.size).toBe(0)
})
