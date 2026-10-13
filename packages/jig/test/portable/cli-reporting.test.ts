import { expect, test } from 'bun:test'
import { PrivateCliReporting } from '../../src/cli-reporting.js'
import { PrivateRunModel, privateAttentionReceipt } from '../../src/cli-run-model.js'

function observer() {
  const model = new PrivateRunModel(),
    printed: string[] = [],
    changed: string[] = [],
    unavailable: string[] = []
  const updates = new PrivateCliReporting(
    (text) => {
      printed.push(text)
      return true
    },
    (text) => {
      if (text !== undefined) changed.push(text)
      return true
    },
    (text) => unavailable.push(text),
    () => false,
    model,
  )
  return { model, updates, printed, changed, unavailable }
}

function view(id: string, title: string, summary: string, landing = false) {
  return {
    kind: 'view' as const,
    id,
    title,
    summary,
    ...(landing ? { landing: true } : {}),
    sections: [],
  }
}

test('plain purpose appears once and settlement adds only changed retained root meaning', () => {
  const { updates, changed } = observer()
  const source = updates.open('progress', true)
  source.accept(view('child', 'Child placeholder', 'No answer yet'), 'separate-publisher')
  expect(changed).toHaveLength(0)
  source.accept(view('fallback', 'Work', 'Prepare the supplied internal brief'))
  source.accept(view('answers', 'Answers', 'Suggestions are awaiting human review', true))
  source.accept(view('child', 'Child placeholder', 'Still no answer'), 'separate-publisher')
  expect(changed).toEqual(['  Flow: Work\n    Prepare the supplied internal brief\n'])
  source.accept(view('answers', 'Answers', 'Both suggestions returned for human review', true))
  source.retire()
  const summary = updates.finalSummary()
  expect(summary).toContain('Flow / Answers: Observation ended')
  expect(summary).toContain('application reports remain provisional')
  expect(summary).toContain('Both suggestions returned for human review')
  expect(summary).not.toContain('No answer')
  expect(summary).not.toContain('Prepare the supplied internal brief')
})

test('unchanged root summary is not repeated and clean EOF never invents an outcome', () => {
  const { updates, changed } = observer()
  const source = updates.open('progress', true)
  source.accept(view('work', 'Work', 'Review the retained evidence', true))
  source.accept(view('work', 'Work', 'Review the retained evidence', true))
  source.retire()
  const summary = updates.finalSummary()
  expect(changed).toHaveLength(1)
  expect(summary).toContain('Observation ended')
  expect(summary).not.toContain('Review the retained evidence')
  expect(summary).not.toMatch(/succeeded|completed|done/)
})

test('refused first purpose remains available in the frozen settlement excerpt', () => {
  const model = new PrivateRunModel()
  const updates = new PrivateCliReporting(
    () => true,
    (text) => text === undefined,
    () => {},
    () => false,
    model,
  )
  const source = updates.open('progress', true)
  expect(
    source.accept(view('work', 'Work', 'Purpose not accepted by the writer', true)),
  ).toBeFalse()
  const summary = updates.finalSummary()
  expect(summary).toContain('Updates incomplete: presentation limit reached.')
  expect(summary).toContain('Purpose not accepted by the writer')
  expect(summary).toContain('application reports remain provisional')
})

test('root fallback keeps accepted order, retires without resurrection, and retains incomplete context', () => {
  const { model, updates } = observer()
  const source = updates.open('progress', true)
  source.accept(view('first', 'First', 'Initial first purpose'))
  source.accept(view('second', 'Second', 'Second retained purpose'))
  source.accept(view('first', 'First', 'Updated first purpose'))
  expect(updates.finalSummary()).toContain('Updated first purpose')
  source.accept(view('landing', 'Preferred', 'Preferred purpose', true))
  expect(updates.finalSummary()).toContain('Preferred purpose')
  source.accept({ kind: 'retire-view', id: 'landing' })
  expect(updates.finalSummary()).toContain('Updated first purpose')
  expect(updates.finalSummary()).not.toContain('Preferred purpose')
  source.accept({ kind: 'retire-view', id: 'first' })
  model.incomplete = 'Some call observations were omitted.'
  source.retire('Updates incomplete: channel lost.')
  const summary = updates.finalSummary()
  expect(summary).toContain('Flow / Second: Updates incomplete: channel lost.')
  expect(summary).toContain('Some call observations were omitted.')
  expect(summary).toContain('Second retained purpose')
  expect(summary).not.toContain('Updated first purpose')
})

test('retired root views and child-only observations never become a final plain summary', () => {
  const { updates } = observer()
  const source = updates.open('progress', true)
  source.accept(view('work', 'Work', 'Retired purpose', true))
  source.accept(view('child', 'Child', 'Retained child report'), 'child')
  source.accept({ kind: 'retire-view', id: 'work' })
  source.retire()
  expect(updates.finalSummary()).toBeUndefined()
})

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
