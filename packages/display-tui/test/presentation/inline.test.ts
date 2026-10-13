import { expect, test } from 'bun:test'
import { type DisplaySnapshot, displayViewKey } from '@jigging/display-model'
import { createInlineDisplay } from '../../src/inline.js'
import { createInlineOwner } from '../../src/inline-owner.js'
import { terminalWidth } from '../../src/presentation/text.js'
import { rowRecordKey, ViewerModel } from '../../src/presentation/viewer-model.js'
import { snapshot } from '../fixtures.js'

function view(id: string, summary: string, landing = false): DisplaySnapshot['views'][number] {
  return {
    id,
    sourceId: 'root',
    sourceLabel: 'Flow',
    updatedAt: 1,
    value: {
      kind: 'view',
      id,
      title: id,
      summary,
      ...(landing ? { landing: true } : {}),
      sections: [],
    },
  }
}
const text = (display: ReturnType<typeof createInlineDisplay>, columns = 120, rows = 24) =>
  display.frame({ columns, rows, color: false }).lines.join('\n')

test('compact inline selects root meaning without recursively copying reports, facts or row details', () => {
  const value = snapshot()
  value.workspace = {
    target: 'binding:brief',
    phase: 'live',
    hostStage: 'Waiting for the result',
    elapsedMs: 41000,
  }
  value.views = [
    view('first', 'Fallback purpose'),
    view('landing', 'Requested internal work', true),
  ]
  value.views[1]!.value.sections = [
    {
      blocks: [
        { kind: 'facts', items: [{ label: 'Private detail field', value: 'FIELD_MUST_NOT_DUMP' }] },
        { kind: 'report', text: 'REPORT_MUST_NOT_DUMP' },
        {
          kind: 'collection',
          id: 'rows',
          title: 'Records',
          columns: [{ key: 'name', label: 'Name', type: 'text' }],
          rows: [
            {
              id: 'one',
              cells: { name: 'ROW_MUST_NOT_DUMP' },
              details: [{ kind: 'report', text: 'DETAIL_MUST_NOT_DUMP' }],
            },
          ],
        },
        { kind: 'progress', label: 'Reviewed records', completed: 1, total: 3, unit: 'records' },
      ],
    },
  ]
  const display = createInlineDisplay({ snapshot: value })
  try {
    const rendered = text(display)
    expect(rendered).toContain('binding:brief · Running · 41s')
    expect(rendered).toContain('Waiting for the result')
    expect(rendered).toContain('Requested internal work')
    expect(rendered).toContain('Reviewed records: 1 / 3 records')
    expect(rendered).not.toContain('MUST_NOT_DUMP')
    expect(rendered).not.toContain('Fallback purpose')
    expect(rendered).not.toContain('open terminal inspection')
    display.update({ ...value, revision: 2, views: [value.views[0]!] })
    expect(text(display)).toContain('Fallback purpose')
    expect(text(display)).not.toContain('Requested internal work')
  } finally {
    display.dispose()
  }
})

test('only same-publisher operation IDs join activities; unassociated and same-ID peer activities remain visible', () => {
  const value = snapshot()
  value.calls = [
    {
      id: 'root-call',
      sourceId: 'root',
      sourceLabel: 'Flow',
      childSourceId: 'child',
      operationId: 'same',
      slot: 'worker',
      intent: 'Prepare the brief',
      state: 'returned',
      firstObservedAt: 1,
      observedAt: 2,
    },
    {
      id: 'child-call',
      sourceId: 'child',
      sourceLabel: 'Flow / worker',
      parentId: 'root-call',
      operationId: 'same',
      slot: 'native',
      intent: 'Request an answer',
      state: 'active',
      firstObservedAt: 1,
      observedAt: 2,
    },
  ]
  value.activities = [
    {
      id: 'root-activity',
      sourceId: 'root',
      sourceLabel: 'Flow',
      value: {
        kind: 'activity',
        id: 'same',
        operationId: 'same',
        label: 'Checking returned suggestions',
      },
    },
    {
      id: 'child-activity',
      sourceId: 'child',
      sourceLabel: 'Flow / worker',
      value: {
        kind: 'activity',
        id: 'same',
        operationId: 'same',
        label: 'Waiting for model response',
      },
    },
    {
      id: 'unassociated',
      sourceId: 'other',
      sourceLabel: 'Separate producer',
      value: {
        kind: 'activity',
        id: 'same',
        label: 'Sorting supplied documents',
        progress: { completed: 7, unit: 'documents' },
      },
    },
  ]
  const display = createInlineDisplay({ snapshot: value })
  try {
    const rendered = text(display)
    expect(rendered).toContain('Prepare the brief — returned')
    expect(rendered).toContain('Flow / Prepare the brief: Checking returned suggestions')
    expect(rendered).toContain('Flow / worker / Request an answer: Waiting for model response')
    expect(rendered).toContain('Separate producer: Sorting supplied documents (7 documents)')
    expect(rendered).toContain('Call relationship unavailable')
    expect(rendered).not.toContain('%')
    expect(rendered).not.toContain('succeeded')
  } finally {
    display.dispose()
  }
})

test('attention, stale disclosure and overflow survive compact frames without payload controls', () => {
  const value = snapshot()
  value.views = [view('purpose', 'Claiming done does not establish success', true)]
  value.calls = Array.from({ length: 7 }, (_, index) => ({
    id: `call-${index}`,
    sourceId: 'root',
    sourceLabel: 'Flow',
    operationId: `call-${index}`,
    slot: 'worker',
    intent: `Branch ${index}`,
    state: 'active',
    firstObservedAt: 1,
    observedAt: 2,
  }))
  value.activities = Array.from({ length: 6 }, (_, index) => ({
    id: `activity-${index}`,
    sourceId: 'root',
    sourceLabel: 'Flow',
    value: {
      kind: 'activity' as const,
      id: `activity-${index}`,
      label: `Current activity ${index}`,
    },
  }))
  value.omissions.calls = 2
  value.attention = [
    {
      id: 'cause',
      attribution: { provenance: 'host-observed', sourceLabel: 'Host' },
      priority: 4,
      text: 'Blocking cause\u001b[777A',
      transcriptCommitted: true,
    },
    {
      id: 'other-cause',
      attribution: {
        provenance: 'accepted-source',
        sourceId: 'root',
        sourceLabel: 'Flow',
        relation: 'root',
        ancestryIncomplete: false,
      },
      priority: 2,
      text: 'A separate reported failure',
      transcriptCommitted: true,
    },
  ]
  const display = createInlineDisplay({ snapshot: value })
  try {
    const wide = text(display)
    expect(wide).toContain('Blocking cause\\u001b')
    expect(wide).toContain('3 branches/issues hidden')
    expect(wide).toContain('2 activities hidden')
    expect(wide).toContain('2 call observations omitted')
    expect(wide).toContain('1 other attention reports')
    expect(wide.indexOf('2 call observations omitted')).toBeLessThan(
      wide.indexOf('3 branches/issues hidden'),
    )
    display.update({
      kind: 'incomplete',
      revision: 2,
      rootSourceId: 'root',
      mode: value.mode,
      reason: 'Current observation unavailable',
      workspace: value.workspace,
      context: value.context,
      omissions: value.omissions,
      attention: value.attention,
      diagnostics: [],
    })
    for (const columns of [18, 40, 80, 120]) {
      const frame = display.frame({ columns, rows: 4, color: false }).lines
      expect(frame.length).toBeLessThanOrEqual(4)
      expect(frame.join('\n')).toContain('Stale')
      expect(frame.join('\n')).toContain(
        columns < 45 ? 'Calls omitted: 2' : '2 call observations omitted',
      )
      expect(frame.join('\n')).toContain(
        columns < 45 ? 'Attention +1' : '1 other attention reports',
      )
      expect(frame.join('\n')).not.toContain('7 calls omitted')
      expect(frame.join('\n')).toContain('…')
      for (const line of frame) {
        // biome-ignore lint/suspicious/noControlCharactersInRegex: Plain frames must contain no terminal control bytes.
        expect(line).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/)
        expect(terminalWidth(line)).toBeLessThan(columns)
      }
    }
    const narrow = text(display, 40, 24)
    expect(narrow).toContain('Calls omitted: 2')
    expect(narrow).toContain('Attention +1')
    expect(narrow).toContain('calls hidden')
    expect(narrow).not.toContain('7 calls omitted')
    expect(narrow).toContain('…')
    display.update({
      ...value,
      revision: 3,
      omissions: { ...value.omissions, calls: Number.MAX_SAFE_INTEGER },
    })
    const hugeCount = text(display, 18, 4)
    expect(hugeCount).toContain('Calls omitted:')
    expect(hugeCount).not.toContain('9007199254740991')
  } finally {
    display.dispose()
  }
})

test('private viewer handoff retains selected filtered context without dumping the collection', () => {
  const value = snapshot()
  value.views = [view('work', 'Review supplied records', true)]
  value.views[0]!.value.sections = [
    {
      blocks: [
        {
          kind: 'collection',
          id: 'records',
          title: 'Documents',
          columns: [{ key: 'name', label: 'Name', type: 'text' }],
          rows: ['alpha', 'beta', 'zebra', 'zoo'].map((name) => ({
            id: name,
            cells: { name },
            details: [
              { kind: 'report' as const, text: `Requested goal for ${name}` },
              { kind: 'report' as const, text: 'DEEP_EVIDENCE_MUST_NOT_DUMP' },
            ],
          })),
        },
      ],
    },
  ]
  const model = new ViewerModel(value)
  model.select(displayViewKey('work'))
  model.cycleCollection()
  model.selectRecord(rowRecordKey('records', 'zebra'))
  model.sortRows()
  model.filterRows('a')
  const display = createInlineOwner(model)
  try {
    const rendered = text(display)
    expect(rendered).toContain('local filter a')
    expect(rendered).toContain('local sort name')
    expect(rendered).toContain('Name: zebra')
    expect(rendered).toContain('Requested goal for zebra')
    expect(rendered).not.toContain('Name: alpha')
    expect(rendered).not.toContain('Name: beta')
    expect(rendered).not.toContain('zoo')
    expect(rendered).not.toContain('DEEP_EVIDENCE_MUST_NOT_DUMP')
  } finally {
    display.dispose()
  }
})

test('no-view inline remains useful and preserves settled fact provenance', () => {
  const value = snapshot()
  value.workspace.hostStage = 'Awaiting the remote response'
  const display = createInlineDisplay({ snapshot: value })
  try {
    expect(text(display)).toContain('Awaiting the remote response')
    display.update({
      ...value,
      revision: 2,
      workspace: {
        ...value.workspace,
        phase: 'settled',
        facts: {
          execution: { value: 'succeeded', provenance: 'application-reported', clipped: true },
          application: { value: 'done', provenance: 'application-reported' },
          cleanup: { value: 'complete', provenance: 'host-observed' },
          delivery: { value: 'written', provenance: 'recorded-claim' },
        },
      },
    })
    const rendered = text(display)
    expect(rendered).toContain('Reported execution [clipped] succeeded')
    expect(rendered).toContain('Reported application (literal outcome): done')
    expect(rendered).toContain('Cleanup complete')
    expect(rendered).toContain('Recorded delivery written')
  } finally {
    display.dispose()
  }
})

test('standalone inline honors empty and one/two-row physical viewports', () => {
  const value = snapshot()
  value.attention = [
    {
      id: 'cause',
      attribution: { provenance: 'host-observed', sourceLabel: 'Host' },
      priority: 4,
      text: 'Blocked',
      transcriptCommitted: true,
    },
  ]
  const display = createInlineDisplay({ snapshot: value })
  try {
    for (const rows of [-1, 0])
      expect(display.frame({ columns: 80, rows, color: false })).toEqual({ lines: [] })
    for (const rows of [1, 2]) {
      const frame = display.frame({ columns: 80, rows, color: false }).lines
      expect(frame.length).toBeLessThanOrEqual(rows)
      expect(frame.join('\n')).toContain('Blocked')
    }
    expect(display.frame({ columns: 0, rows: 8, color: false })).toEqual({ lines: [] })
  } finally {
    display.dispose()
  }
})
