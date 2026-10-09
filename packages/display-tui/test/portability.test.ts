import { expect, test } from 'bun:test'
import { displayViewKey, type DisplaySnapshotEnvelope } from '@jigging/display-model'
import { createTui, prepareTui } from '../src/index.js'
import { createInlineDisplay } from '../src/inline.js'
import { ViewerModel } from '../src/viewer-model.js'
import { viewerDetailParts } from '../src/projection.js'
import { terminalWidth } from '../src/text.js'
import { snapshot } from './fixtures.js'

function reports() {
  const value = snapshot()
  value.views = [
    {
      id: 'report',
      sourceId: value.rootSourceId,
      sourceLabel: 'Supplied source',
      updatedAt: 1,
      value: {
        kind: 'view',
        id: 'report',
        title: 'Supplied report',
        landing: true,
        summary: 'Retained body',
        sections: [{ blocks: [{ kind: 'report', text: 'Retained evidence' }] }],
      },
    },
  ]
  return value
}

test('public stale disclosure survives sticky attention, compact layouts and full-cause inspection', async () => {
  for (const replacement of ['incomplete', 'malformed'] as const) {
    const value = reports()
    value.attention = [
      {
        id: 'cause',
        attribution: { provenance: 'host-observed', sourceLabel: 'Host' },
        priority: 4,
        text: 'Blocking cause',
        transcriptCommitted: false,
      },
    ]
    const display = await createTui(await prepareTui(), { snapshot: value })
    try {
      expect((await display.frame({ columns: 100, rows: 28, color: false })).text).toContain(
        'Retained evidence',
      )
      const incomplete: DisplaySnapshotEnvelope = {
        kind: 'incomplete',
        revision: 2,
        lastCompleteRevision: 1,
        rootSourceId: value.rootSourceId,
        mode: value.mode,
        reason: 'Current body unavailable',
        workspace: value.workspace,
        context: value.context,
        omissions: value.omissions,
        attention: value.attention,
        diagnostics: [],
      }
      display.update(
        replacement === 'incomplete'
          ? incomplete
          : ({ ...value, revision: 2, views: [{}] } as unknown as DisplaySnapshotEnvelope),
      )
      const frame = (await display.frame({ columns: 100, rows: 28, color: false })).text
      expect(frame).toContain('Retained evidence')
      expect(frame).toContain('Stale observations')
      expect(frame).toContain('Blocking cause')
      expect(frame).toContain('q inline')
      const tiny = (await display.frame({ columns: 18, rows: 4, color: false })).text
      expect(tiny).toContain('Stale')
      expect(tiny).toContain('q inline')
      display.input(Buffer.from('!'))
      const cause = (await display.frame({ columns: 40, rows: 8, color: false })).text
      expect(cause).toContain('Stale observations')
      expect(cause).toContain('Blocking cause')
      expect(cause).toContain('q inline')
    } finally {
      display.dispose()
    }
  }
})

test('inline paging keeps a stale marker before retained body without attention', () => {
  for (const replacement of ['incomplete', 'malformed'] as const) {
    const value = reports()
    const display = createInlineDisplay({ snapshot: value })
    try {
      display.update(
        replacement === 'incomplete'
          ? {
              kind: 'incomplete',
              revision: 2,
              lastCompleteRevision: 1,
              rootSourceId: value.rootSourceId,
              mode: value.mode,
              reason: 'Current body unavailable',
              workspace: value.workspace,
              context: value.context,
              omissions: value.omissions,
              attention: [],
              diagnostics: [],
            }
          : ({ ...value, revision: 2, views: [{}] } as unknown as DisplaySnapshotEnvelope),
      )
      for (const rows of [3, 4, 5, 8]) {
        const frame = display.frame({ columns: 20, rows, color: false }).lines
        expect(frame.length).toBeLessThanOrEqual(rows)
        expect(frame.join('\n')).toContain('Stale observations')
      }
    } finally {
      display.dispose()
    }
  }
})

test('missing parents retain uncertain calls, causes and descendants in public native and inline projections', async () => {
  const value = snapshot()
  value.omissions.calls = 1
  value.calls = [
    {
      id: 'child',
      sourceId: 'source-child',
      sourceLabel: 'Supplied child',
      parentId: 'omitted',
      operationId: 'child-op',
      slot: 'Unattached invocation',
      state: 'uncertain',
      firstObservedAt: 1,
      observedAt: 2,
      cause: 'Known omission cause',
    },
    {
      id: 'grandchild',
      sourceId: 'source-grandchild',
      sourceLabel: 'Supplied descendant',
      parentId: 'child',
      operationId: 'grandchild-op',
      slot: 'Visible descendant',
      state: 'failed',
      firstObservedAt: 1,
      observedAt: 2,
      cause: 'Descendant cause',
    },
  ]
  const inline = createInlineDisplay({ snapshot: value })
  const inlineText = inline.frame({ columns: 120, rows: 24, color: false }).lines.join('\n')
  expect(inlineText).toContain('Unattached invocation')
  expect(inlineText).toContain('Known omission cause')
  expect(inlineText).toContain('Visible descendant')
  expect(inlineText).toContain('relationship incomplete')
  const display = await createTui(await prepareTui(), { snapshot: value })
  try {
    display.input(Buffer.from('v\u001b[H\r'))
    const frame = (await display.frame({ columns: 160, rows: 36, color: false })).text
    expect(frame).toContain('Unattached invocation')
    expect(frame).toContain('Known omission cause')
    expect(frame).toContain('Visible descendant')
    expect(frame).toContain('Enclosing invocation unavailable; relationship')
    expect(frame).toContain('incomplete.')
  } finally {
    display.dispose()
    inline.dispose()
  }
})

test('opaque view IDs keep all public application and builtin destinations independently reachable', async () => {
  const value = snapshot()
  const ids = ['files', 'overview', 'activity', displayViewKey('files'), ' ']
  value.views = ids.map((id, index) => ({
    id,
    sourceId: value.rootSourceId,
    sourceLabel: 'Producer',
    updatedAt: 1,
    value: {
      kind: 'view',
      id: `portable-${index}`,
      title: `Application ${index}`,
      summary: `Literal application ${index}`,
      sections: [],
    },
  }))
  value.artifacts.files = [
    { id: 'inventory-file', path: 'inventory.txt', bytes: 0, state: 'empty', clipped: false },
  ]
  const display = await createTui(await prepareTui(), { snapshot: value })
  try {
    display.input(Buffer.from('v\u001b[H\r'))
    const viewport = { columns: 100, rows: 28, color: false }
    expect((await display.frame(viewport)).text).toContain('[Execution]')
    display.input(Buffer.from('\t'))
    expect((await display.frame(viewport)).text).toContain('[Activity]')
    display.input(Buffer.from('\t'))
    expect((await display.frame(viewport)).text).toContain('inventory.txt')
    for (let index = 0; index < ids.length; index++) {
      display.input(Buffer.from('\t'))
      expect((await display.frame(viewport)).text).toContain(`Literal application ${index}`)
    }
    display.input(Buffer.from('\t'))
    expect((await display.frame(viewport)).text).toContain('[Execution]')
  } finally {
    display.dispose()
  }
})

test('handoff transfers chosen application state and fences native, input and preview effects', async () => {
  const value = reports()
  value.artifacts.permittedAttachments = ['output']
  value.artifacts.files = [
    { id: 'capture-file', path: 'report.txt', bytes: 4, state: 'text', clipped: false },
  ]
  value.views.push({
    id: 'child-view',
    sourceId: 'child-source',
    sourceLabel: 'Supplied child',
    updatedAt: 1,
    value: {
      kind: 'view',
      id: 'child-view',
      title: 'Chosen child',
      summary: 'Child observations',
      sections: [
        {
          blocks: [
            {
              kind: 'collection',
              id: 'records',
              title: 'Supplied rows',
              columns: [
                { key: 'name', label: 'Name', type: 'text' },
                { key: 'file', label: 'Evidence', type: 'reference' },
              ],
              rows: ['zebra', 'alpha', 'beta', 'zoo'].map((name) => ({
                id: name,
                cells: {
                  name,
                  file:
                    name === 'zebra'
                      ? { kind: 'artifact' as const, attachment: 'output', path: 'report.txt' }
                      : null,
                },
              })),
            },
          ],
        },
      ],
    },
  })
  value.artifacts.sourceId = 'child-source'
  let complete!: (value: any) => void,
    reads = 0,
    changes = 0
  const display = await createTui(await prepareTui(), {
    snapshot: value,
    onChange: () => changes++,
    preview: () => {
      reads++
      return new Promise((resolve) => {
        complete = resolve
      })
    },
  })
  display.input(Buffer.from('\tcs/a\r'))
  await display.frame({ columns: 140, rows: 36, color: false })
  expect(reads).toBe(1)
  display.input(Buffer.from('\u001b'))
  const inline = display.handoffInline()!
  expect(inline).toBeDefined()
  expect(display.handoffInline()).toBeUndefined()
  display.dispose()
  const count = changes
  complete({
    artifactId: 'capture-file',
    captureGeneration: 'fixture-capture',
    provenance: 'verified-delivery',
    state: 'text',
    text: 'Late preview',
    bytes: 12,
    clipped: false,
  })
  await new Promise((resolve) => setTimeout(resolve, 40))
  expect(changes).toBe(count)
  expect(reads).toBe(1)
  display.input(Buffer.from('?\u0003'))
  expect(await display.frame({ columns: 100, rows: 28, color: false })).toEqual({ text: '' })
  let frame = inline.frame({ columns: 120, rows: 24, color: false }).lines.join('\n')
  expect(frame).toContain('Chosen child')
  expect(frame).toContain('local filter a')
  expect(frame).toContain('local sort name')
  expect(frame).not.toContain('zoo')
  expect(frame).not.toContain('Late preview')
  expect(frame.indexOf('Name: alpha')).toBeLessThan(frame.indexOf('Name: beta'))
  expect(frame.indexOf('Name: beta')).toBeLessThan(frame.indexOf('Name: zebra'))
  inline.update({ ...value, revision: 2, workspace: { ...value.workspace, elapsedMs: 500 } })
  expect(inline.frame({ columns: 120, rows: 24, color: false }).lines.join('\n')).toContain(
    'Chosen child',
  )
  inline.update({ ...value, revision: 3, views: [value.views[0]!] })
  frame = inline.frame({ columns: 120, rows: 24, color: false }).lines.join('\n')
  expect(frame).not.toContain('Chosen child')
  inline.dispose()
  expect(inline.frame({ columns: 120, rows: 24, color: false })).toEqual({ lines: [] })
})

test('tagged synthetic records and diagnostic clipping stay separate from opaque journal identities', async () => {
  const value = snapshot()
  value.activities = [
    {
      id: JSON.stringify(['host', 'current']),
      sourceId: value.rootSourceId,
      sourceLabel: 'Producer',
      value: { kind: 'activity', id: 'working', label: 'Current activity' },
    },
  ]
  value.journal = ['current-host', 'setup', JSON.stringify(['activity', 'working'])].map(
    (id, index) => ({
      id,
      kind: 'diagnostic',
      attribution: { provenance: 'host-observed', sourceLabel: 'Diagnostic' },
      importance: 'unknown',
      sequence: index,
      text: `Diagnostic ${index}`,
      operationsPath: [],
      pathClipped: true,
    }),
  )
  const model = new ViewerModel(value)
  expect(new Set(model.records().map((record) => record.key)).size).toBe(model.records().length)
  model.close()
  const display = await createTui(await prepareTui(), { snapshot: value })
  try {
    const activity = (await display.frame({ columns: 100, rows: 28, color: false })).text
    expect(activity).toContain('Current activity')
    expect(activity).toContain('Diagnostic 0')
    expect(activity).toContain('Diagnostic 2')
    display.input(Buffer.from('d'))
    const frame = (await display.frame({ columns: 100, rows: 28, color: false })).text
    expect(frame).toContain('Invocation path unavailable (clipped)')
    expect(frame).not.toContain('Invocation: (root)')
  } finally {
    display.dispose()
  }
})

test('recorded lexical decoration follows explicit role rather than collection names', () => {
  const value = reports()
  value.mode = 'recorded-packet'
  value.views[0]!.hostRole = 'recorded-report'
  const block = {
    kind: 'collection' as const,
    id: 'independent-fields',
    title: 'Fields',
    columns: [{ key: 'name', label: 'Name', type: 'text' as const }],
    rows: [
      {
        id: 'one',
        cells: { name: 'Field' },
        details: [{ kind: 'report' as const, text: '{"claim":true}' }],
      },
    ],
  }
  value.views[0]!.value.sections = [{ blocks: [block] }]
  const model = new ViewerModel(value)
  model.cycleCollection()
  expect(viewerDetailParts(model, model.record!)).toContainEqual({
    kind: 'value',
    text: '{"claim":true}',
  })
  const unassigned = {
    ...value.views[0]!,
    value: {
      ...value.views[0]!.value,
      sections: [{ blocks: [{ ...block, id: 'recorded-fields' }] }],
    },
  }
  delete unassigned.hostRole
  model.update({ ...value, revision: 2, views: [unassigned] })
  model.select(displayViewKey(unassigned.id))
  model.cycleCollection()
  expect(viewerDetailParts(model, model.record!)).toContainEqual({
    kind: 'text',
    text: '{"claim":true}',
  })
  model.close()
})

test('opaque call identities remain distinct from synthetic tags and raw attribution joins stay exact', async () => {
  const value = snapshot()
  const ids = [
    'host-facts',
    JSON.stringify(['host', 'current']),
    JSON.stringify(['journal', 'cause']),
    JSON.stringify(['call', 'host-facts']),
  ]
  value.calls = ids.map((id, index) => ({
    id,
    sourceId: value.rootSourceId,
    sourceLabel: 'Producer',
    operationId: `operation-${index}`,
    slot: `Invocation ${index}`,
    intent: `Invocation ${index}`,
    state: 'uncertain',
    firstObservedAt: 1,
    observedAt: 2,
    cause: `Cause ${index}`,
  }))
  value.journal = [
    {
      id: JSON.stringify(['call', 'host-facts']),
      kind: 'diagnostic',
      attribution: { provenance: 'host-observed', sourceLabel: 'Diagnostic', callId: ids[0]! },
      importance: 'unknown',
      sequence: 1,
      text: 'Exact raw attribution',
      operationsPath: [],
    },
  ]
  const display = await createTui(await prepareTui(), { snapshot: value })
  try {
    display.input(Buffer.from('v\u001b[H\r'))
    const viewport = { columns: 180, rows: 40, color: false }
    const frame = (await display.frame(viewport)).text
    for (let index = 0; index < ids.length; index++) expect(frame).toContain(`Invocation ${index}`)
    expect(frame).toContain('Cause 0')
    expect(frame).toContain('Exact raw attribution')
    display.input(Buffer.from('j'))
    const next = (await display.frame(viewport)).text
    expect(next).toContain('Cause 1')
    expect(next).not.toContain('Exact raw attribution')
  } finally {
    display.dispose()
  }
})

test('public native, compact and inline facts retain provenance and clipping without certifying literal status words', async () => {
  for (const mode of ['live-run', 'recorded-packet'] as const) {
    const value = snapshot()
    value.mode = mode
    value.workspace.phase = 'settled'
    value.workspace.facts = {
      execution: { value: 'succeeded', provenance: 'application-reported', clipped: true },
      application: { value: 'succeeded', provenance: 'application-reported' },
      cleanup: { value: 'complete', provenance: 'recorded-claim' },
      delivery: { value: 'written', provenance: 'host-observed', clipped: true },
      completeness: { value: 'Captured evidence', provenance: 'recorded-claim', clipped: true },
    }
    const inline = createInlineDisplay({ snapshot: value })
    const display = await createTui(await prepareTui(), { snapshot: value, theme: 'one-light' })
    try {
      const expected = [
        'Reported execution [clipped] succeeded',
        'Reported application (literal outcome): succeeded',
        'Recorded cleanup complete',
        'Delivery [clipped] written',
      ]
      const native = (await display.frame({ columns: 200, rows: 32, color: false })).text
      const inlineText = inline.frame({ columns: 200, rows: 24, color: false }).lines.join('\n')
      for (const text of expected) {
        expect(native).toContain(text)
        expect(inlineText).toContain(text)
      }
      expect(inlineText).toContain('Recorded observation [clipped] Captured evidence')
      const colored = (await display.frame({ columns: 200, rows: 32, color: true })).text
      expect(colored).not.toContain('38;2;50;101;45')
      display.input(Buffer.from('!'))
      let compact = ''
      for (let index = 0; index < 10; index++) {
        compact += (await display.frame({ columns: 79, rows: 8, color: false })).text
        display.input(Buffer.from('j'))
      }
      for (const text of expected) expect(compact).toContain(text)
      expect(compact).toContain('Recorded observation [clipped]')
      expect(compact).toContain('q close')
      display.input(Buffer.from('\u001b'))
      display.update({
        ...value,
        revision: 2,
        workspace: {
          ...value.workspace,
          facts: {
            ...value.workspace.facts,
            execution: { value: 'succeeded', provenance: 'host-observed' },
            cleanup: { value: 'complete', provenance: 'host-observed' },
            delivery: { value: 'written', provenance: 'host-observed' },
          },
        },
      })
      expect((await display.frame({ columns: 200, rows: 32, color: true })).text).toContain(
        '38;2;50;101;45',
      )
    } finally {
      display.dispose()
      inline.dispose()
    }
  }
})

test('public warnings and multiline titles remain inert physical lines in native, compact and inline frames', async () => {
  const hostile =
    'Useful diagnosis\u001b[777A\nAdditional reason\u0007\r\u001b]0;forged-title\u0007'
  for (const replacement of ['complete', 'incomplete'] as const) {
    for (const attention of [false, true]) {
      const value = reports()
      value.workspace.target = 'Run\nidentity\u001b[777A'
      value.views[0]!.sourceLabel = 'Supplied\nsource'
      value.views[0]!.value.title = 'Report title\u001b[777A'
      if (attention)
        value.attention = [
          {
            id: 'cause',
            attribution: { provenance: 'host-observed', sourceLabel: 'Host\nsource' },
            priority: 4,
            text: 'Retained cause',
            transcriptCommitted: false,
          },
        ]
      const envelope: DisplaySnapshotEnvelope =
        replacement === 'complete'
          ? { ...value, revision: 2, incomplete: hostile }
          : {
              kind: 'incomplete',
              revision: 2,
              rootSourceId: value.rootSourceId,
              mode: value.mode,
              reason: hostile,
              workspace: value.workspace,
              context: value.context,
              omissions: value.omissions,
              attention: value.attention,
              diagnostics: [],
            }
      const inline = createInlineDisplay({ snapshot: value })
      const display = await createTui(await prepareTui(), { snapshot: value })
      try {
        inline.update(envelope)
        display.update(envelope)
        for (const viewport of [
          { columns: 160, rows: 20, color: false },
          { columns: 80, rows: 12, color: false },
          { columns: 18, rows: 4, color: false },
        ]) {
          const frame = inline.frame(viewport)
          expect(frame.lines.length).toBeLessThanOrEqual(viewport.rows)
          expect(Buffer.byteLength(frame.lines.join('\n'))).toBeLessThanOrEqual(32768)
          for (const line of frame.lines) {
            expect(line).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/)
            expect(terminalWidth(line)).toBeLessThan(viewport.columns)
          }
          expect(frame.lines.join('\n')).toContain(
            replacement === 'complete' ? 'Incomplete' : 'Stale',
          )
          if (viewport.columns === 160 && (!attention || viewport.rows > 6)) {
            expect(frame.lines.join('\n')).toContain('Useful diagnosis')
            expect(frame.lines.join('\n')).toContain('Additional reason')
          }
          const native = (await display.frame(viewport)).text
          expect(native).not.toContain('\u001b[777A')
          expect(native).not.toContain('\u001b]0;forged-title')
          expect(native).not.toMatch(/[\u0007\r\n]/)
          expect(Buffer.byteLength(native)).toBeLessThanOrEqual(32768)
          for (const position of native.matchAll(/\u001b\[(\d+);1H/g))
            expect(Number(position[1])).toBeLessThanOrEqual(viewport.rows)
          expect(native).toContain(replacement === 'complete' ? 'Incomplete' : 'Stale')
          expect(native).toMatch(/q (?:continues )?inline/)
        }
        const transferred = display.handoffInline()!
        const lines = transferred.frame({ columns: 160, rows: 20, color: false }).lines
        expect(lines.join('\n')).toContain('Useful diagnosis')
        for (const line of lines) expect(line).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/)
        transferred.dispose()
      } finally {
        display.dispose()
        inline.dispose()
      }
    }
  }
})
