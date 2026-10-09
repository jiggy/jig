import { expect, test } from 'bun:test'
import {
  PrivateOpenTuiDashboard,
  privateOpenTuiCells,
  privatePrepareOpenTui,
} from '../src/cli-opentui.js'
import { PrivateRunModel } from '../src/cli-run-model.js'

// biome-ignore lint/suspicious/noControlCharactersInRegex: Observe native ANSI frame bytes.
const strip = (text: string) => text.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
// biome-ignore lint/suspicious/noControlCharactersInRegex: Verify NO_COLOR suppresses generated SGR.
const sgr = /\x1b\[[0-9;]*m/
function scene() {
  const model = new PrivateRunModel()
  model.configureWorkspace({ target: 'binding:consumer', startedAt: 100, limitMs: 30000 })
  model.acceptView('root', {
    kind: 'view',
    id: 'matters',
    title: 'Document intake',
    summary: 'Two supplied matters; no legal sufficiency verdict.',
    sections: [
      {
        blocks: [
          {
            kind: 'collection',
            id: 'cases',
            title: 'Requested matters',
            columns: [
              { key: 'name', label: 'Matter', type: 'string' },
              { key: 'state', label: 'Completeness', type: 'string' },
            ],
            rows: [
              {
                id: 'a',
                cells: { name: 'MAT-042', state: 'Missing required instructions' },
                details: [
                  {
                    kind: 'report',
                    text: 'Goal: Check the client-supplied documents.\nMissing instructions must remain visible.',
                  },
                ],
              },
              {
                id: 'b',
                cells: { name: 'MAT-043', state: 'Documents present' },
                details: [
                  { kind: 'facts', items: [{ label: 'Goal', value: 'Check the second packet' }] },
                ],
              },
            ],
          },
        ],
      },
    ],
  })
  model.select(JSON.stringify(['root', 'matters']))
  model.cycleCollection()
  return model
}

test('native panes render unrelated semantic records, selected detail, attribution and no real IO ownership', async () => {
  const model = scene(),
    raw = process.stdin.isRaw,
    listeners = process.stdin.listenerCount('data')
  const dashboard = await PrivateOpenTuiDashboard.create(
    await privatePrepareOpenTui(),
    model,
    140,
    36,
  )
  try {
    let frame = await dashboard.frame(140, 36, { panels: [] }, 0, false)
    expect(frame.text).toContain('Requested matters')
    expect(frame.text).toContain('MAT-042')
    expect(frame.text).toContain('Goal: Check the client-supplied documents.')
    expect(frame.text).toContain('Selected detail')
    expect(frame.text).not.toMatch(sgr)
    expect((await dashboard.frame(140, 36, { panels: [] }, frame.scroll, false)).text).toBe('')
    model.moveRecord(1)
    frame = await dashboard.frame(140, 36, { panels: [] }, frame.scroll, true)
    expect(strip(frame.text)).toContain('Check the second packet')
    expect(frame.text).toMatch(sgr)
    expect(process.stdin.isRaw).toBe(raw)
    expect(process.stdin.listenerCount('data')).toBe(listeners)
  } finally {
    dashboard.close()
    model.close()
  }
})

test('narrow view keeps the active tab reachable; detail, diagnostics and full causes remain literal', async () => {
  const model = scene()
  model.addAttention('Flow', 'Missing instructions\n\u001b]52;hostile\u202e', 2, false)
  model.addDiagnostic('Producer warning without structured severity', ['verify'])
  const dashboard = await PrivateOpenTuiDashboard.create(
    await privatePrepareOpenTui(),
    model,
    80,
    24,
  )
  try {
    let frame = await dashboard.frame(80, 24, { panels: [] }, 0, false)
    expect(frame.text).toContain('[Flow: Document intake]')
    expect(frame.text).toContain('Flow-reported error')
    expect(frame.text).not.toContain('Selected detail')
    frame = await dashboard.frame(
      80,
      24,
      { panels: [{ kind: 'attention', index: 0, scroll: 0 }] },
      0,
      false,
    )
    expect(frame.text).toContain('Missing instructions')
    expect(frame.text).toContain('\\u001b]52;hostile')
    expect(frame.text).toContain('\\u202e')
    frame = await dashboard.frame(
      80,
      24,
      { panels: [{ kind: 'diagnostics', index: 0, scroll: 0 }] },
      0,
      false,
    )
    expect(frame.text).toContain('Severity was not supplied')
    expect(frame.text).toContain('verify')
    frame = await dashboard.frame(50, 14, { panels: [] }, 0, false)
    expect(frame.text).toContain('q inline')
    expect(frame.text).toContain('Ctrl-C stop')
    expect(frame.text).toContain('! cause')
    frame = await dashboard.frame(
      80,
      24,
      { panels: [{ kind: 'filter', draft: '', collection: 'cases' }] },
      0,
      false,
    )
    expect(frame.text).toContain('Enter apply')
    expect(frame.text).toContain('Ctrl-D leave')
    expect(frame.text).not.toContain('q inline')
    frame = await dashboard.frame(18, 4, { panels: [] }, 0, false)
    expect(frame.text).toContain('q inline')
    expect(Buffer.byteLength(frame.text)).toBeLessThanOrEqual(32768)
  } finally {
    dashboard.close()
    model.close()
  }
})

test('settled facts never certify domain prose and closing during a pending native draw cannot read freed cells', async () => {
  const model = scene()
  model.setWorkspaceFacts({
    execution: 'failed',
    application: '"done"',
    cleanup: 'unconfirmed',
    delivery: 'unknown',
  })
  model.setWorkspacePhase('settled')
  const dashboard = await PrivateOpenTuiDashboard.create(
    await privatePrepareOpenTui(),
    model,
    140,
    36,
  )
  const frame = await dashboard.frame(140, 36, { panels: [] }, 0, false)
  expect(frame.text).toContain('Execution failed')
  expect(frame.text).toContain('Application "done"')
  expect(frame.text).toContain('Cleanup unconfirmed')
  expect(frame.text).toContain('Delivery unknown')
  model.moveRecord(1)
  const pending = dashboard.frame(140, 36, { panels: [] }, 0, true)
  dashboard.close()
  expect((await pending).text).toBe('')
  dashboard.close()
  model.close()
})

test('native records refresh reference availability after delivery without a new Flow report', async () => {
  const model = scene()
  model.acceptView('root', {
    kind: 'view',
    id: 'evidence',
    title: 'Evidence',
    sections: [
      {
        blocks: [
          {
            kind: 'facts',
            items: [
              {
                label: 'Packet',
                value: { kind: 'artifact', attachment: 'deliverables', path: 'summary.txt' },
              },
            ],
          },
        ],
      },
    ],
  })
  model.select(JSON.stringify(['root', 'evidence']))
  model.moveRecord(1)
  const dashboard = await PrivateOpenTuiDashboard.create(
    await privatePrepareOpenTui(),
    model,
    140,
    36,
  )
  try {
    const before = await dashboard.frame(140, 36, { panels: [] }, 0, false)
    expect(before.text).toContain('Artifact unavailable')
    model.setArtifacts(
      () => '/captured/summary.txt',
      async () => ({ text: 'Captured evidence', bytes: 17, clipped: false }),
    )
    const after = await dashboard.frame(140, 36, { panels: [] }, 0, false)
    expect(after.text).toContain('Delivered file: summary.txt')
    expect(after.text).not.toContain('Artifact unavailable')
  } finally {
    dashboard.close()
    model.close()
  }
})

test('initial native allocation is bounded before oversized terminal geometry is rendered', async () => {
  const model = scene()
  const dashboard = await PrivateOpenTuiDashboard.create(
    await privatePrepareOpenTui(),
    model,
    65535,
    65535,
  )
  try {
    expect(dashboard.renderer.width).toBe(4096)
    expect(dashboard.renderer.height).toBe(100)
  } finally {
    dashboard.close()
    model.close()
  }
})

test('saved inspection keeps its phase visible beside a long packet path without live claims', async () => {
  const model = scene()
  model.workspace.target = '/packet-location/'.repeat(100)
  model.workspace.recorded = true
  model.setWorkspaceFacts({
    execution: 'succeeded',
    application: '"done"',
    cleanup: 'no failure recorded',
    delivery: 'written',
  })
  model.setWorkspacePhase('settled')
  const dashboard = await PrivateOpenTuiDashboard.create(
    await privatePrepareOpenTui(),
    model,
    120,
    32,
  )
  try {
    const frame = await dashboard.frame(120, 32, { panels: [] }, 0, false)
    expect(frame.text).toContain('Saved result · read-only')
    expect(frame.text).toContain('Recorded local claims · no live observation')
    expect(frame.text).not.toContain('Live observations')
  } finally {
    dashboard.close()
    model.close()
  }
})

test('native span encoding charges ANSI and escaped zero-width content and discloses clipping', async () => {
  const core = await privatePrepareOpenTui()
  const fg = core.RGBA.fromHex('#ffffff'),
    bg = core.RGBA.fromHex('#000000')
  for (const color of [true, false]) {
    const text = privateOpenTuiCells(
      Array.from({ length: 100 }, () => ({
        spans: [{ text: 'x' + '\u0301'.repeat(32768), fg, bg, attributes: 1, width: 1 }],
      })),
      color,
    )
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(32768)
    expect(text).toContain('Frame clipped')
    if (!color) expect(text).not.toMatch(sgr)
  }
})

test('large native panes keep color roles and exit controls without spending the frame budget on blanks', async () => {
  const original = process.env.JIG_THEME
  try {
    for (const theme of ['one-dark', 'one-light'])
      for (const color of [true, false]) {
        process.env.JIG_THEME = theme
        const model = scene()
        model.moveRecord(1)
        const dashboard = await PrivateOpenTuiDashboard.create(
          await privatePrepareOpenTui(),
          model,
          240,
          80,
        )
        try {
          const frame = await dashboard.frame(240, 80, { panels: [] }, 0, color)
          expect(frame.text).not.toContain('Frame clipped')
          expect(Buffer.byteLength(frame.text)).toBeLessThan(24_000)
          expect(frame.text).toContain('q inline')
          expect(frame.text).toContain('Ctrl-C stop')
          const spans = dashboard.renderer.currentRenderBuffer
            .getSpanLines()
            .flatMap((l) => l.spans)
          const title = spans.find((s) => s.text.includes('MAT-043') && Boolean(s.attributes & 1))!
          const key = spans.find((s) => s.text.includes('Completeness'))!
          const value = spans.find((s) => s.text.includes('Documents present'))!
          expect(title.attributes & 1).toBe(1)
          expect(key.attributes & 1).toBe(1)
          expect(key.fg.toInts()).not.toEqual(value.fg.toInts())
          expect(title.fg.toInts()).not.toEqual(value.fg.toInts())
          if (!color) expect(frame.text).not.toMatch(sgr)
        } finally {
          dashboard.close()
          model.close()
        }
      }
  } finally {
    if (original === undefined) delete process.env.JIG_THEME
    else process.env.JIG_THEME = original
  }
})

test('expanded native detail scrolls to the last supplied evidence line after layout', async () => {
  const model = scene()
  model.acceptView('root', {
    kind: 'view',
    id: 'long-evidence',
    title: 'Evidence',
    sections: [
      {
        blocks: [
          {
            kind: 'report',
            text:
              'Evidence title\n' +
              Array.from({ length: 90 }, (_, i) => `Evidence line ${i}`).join('\n'),
          },
        ],
      },
    ],
  })
  model.select(JSON.stringify(['root', 'long-evidence']))
  model.moveRecord(1)
  const record = model.record!
  const dashboard = await PrivateOpenTuiDashboard.create(
    await privatePrepareOpenTui(),
    model,
    120,
    32,
  )
  try {
    const frame = await dashboard.frame(
      120,
      32,
      { panels: [{ kind: 'detail', key: record.key, signature: record.signature, scroll: 999 }] },
      0,
      false,
    )
    expect(frame.text).toContain('Evidence line 89')
    expect(frame.text).not.toContain('Frame clipped')
  } finally {
    dashboard.close()
    model.close()
  }
})

test('multiline caller intent cannot replace or recolor the actual host call state', async () => {
  const model = scene()
  model.observeCall({
    publisher: 'root',
    operationId: 'failure',
    slot: 'check',
    intent: 'Caller title\nreturned',
    state: 'failed',
    time: 1000,
  })
  model.select('overview')
  const dashboard = await PrivateOpenTuiDashboard.create(
    await privatePrepareOpenTui(),
    model,
    120,
    32,
  )
  try {
    const frame = await dashboard.frame(120, 32, { panels: [] }, 0, true)
    expect(strip(frame.text)).toContain('Caller title · returned')
    const spans = dashboard.renderer.currentRenderBuffer.getSpanLines().flatMap((l) => l.spans)
    const state = spans.find((s) => s.text.trim() === 'failed')!
    const title = spans.find((s) => s.text.includes('Caller title'))!
    expect(state).toBeDefined()
    expect(state.fg.toInts()).not.toEqual(title.fg.toInts())
  } finally {
    dashboard.close()
    model.close()
  }
})

test('native content-first artifact peek keeps semantic context and literal diff whitespace', async () => {
  const model = new PrivateRunModel()
  const reference = { kind: 'artifact' as const, attachment: 'evidence', path: 'review.patch' }
  model.acceptView('root', {
    kind: 'view',
    id: 'review',
    title: 'Document review',
    summary: 'Supplied evidence',
    sections: [
      {
        blocks: [
          {
            kind: 'report',
            text: 'Selected artifact\nSupplied context stays reachable',
            references: [reference, reference],
          },
        ],
      },
    ],
  })
  model.select(JSON.stringify(['root', 'review']))
  model.selectRecord('block:0:0')
  let reads = 0
  const text =
    'diff --git a/source b/source\n--- a/source\n+++ b/source\n@@ -1 +1 @@\n-  old text\n+  new text\n context\n'
  model.setArtifacts(
    (_publisher, ref) => ref.path,
    async () => {
      reads++
      return { text, bytes: Buffer.byteLength(text), clipped: false }
    },
  )
  model.setArtifactCapture({
    generation: 'capture',
    sourcePublisher: 'root',
    provenance: 'verified-delivery',
    phase: 'ready',
    files: [
      { path: 'review.patch', bytes: Buffer.byteLength(text), state: 'text', clipped: false },
    ],
  })
  const dashboard = await PrivateOpenTuiDashboard.create(
    await privatePrepareOpenTui(),
    model,
    140,
    36,
  )
  try {
    await dashboard.frame(140, 36, { panels: [] }, 0, false)
    const frame = await dashboard.frame(140, 36, { panels: [] }, 0, false)
    expect(reads).toBe(1)
    expect(frame.text).toContain('review.patch')
    expect(frame.text).toContain('-  old text')
    expect(frame.text).toContain('+  new text')
    expect(frame.text).toContain('Supplied context stays reachable')
    expect(frame.text).toContain('Verified delivery')
    expect(frame.text).not.toMatch(sgr)
  } finally {
    dashboard.close()
    model.close()
  }
})

test('native Delivered files works without views and distinguishes empty, non-text and unavailable captures', async () => {
  const model = new PrivateRunModel()
  let reads = 0
  model.setArtifacts(
    () => undefined,
    async () => {
      reads++
      return { text: '', bytes: 0, clipped: false }
    },
  )
  model.setArtifactCapture({
    generation: 'inventory',
    sourcePublisher: 'root',
    provenance: 'verified-delivery',
    phase: 'ready',
    files: [
      { path: 'empty.txt', bytes: 0, state: 'empty', clipped: false },
      { path: 'binary', bytes: 4, state: 'non-text', clipped: false },
      { path: 'missing', bytes: 4, state: 'unavailable', clipped: false },
    ],
  })
  model.select('files')
  const dashboard = await PrivateOpenTuiDashboard.create(
    await privatePrepareOpenTui(),
    model,
    80,
    24,
  )
  try {
    const inventory = await dashboard.frame(80, 24, { panels: [] }, 0, false)
    expect(inventory.text).toContain('Delivered files')
    expect(inventory.text).toContain('empty.txt')
    expect(model.views.size).toBe(0)
    expect(reads).toBe(0)
    await model.activateFile('empty.txt')
    const empty = await dashboard.frame(
      80,
      24,
      { panels: [{ kind: 'preview', scroll: 0 }] },
      0,
      false,
    )
    expect(empty.text).toContain('captured text file is empty')
    expect(empty.text).toContain('Esc back')
    await model.activateFile('binary')
    const binary = await dashboard.frame(
      80,
      24,
      { panels: [{ kind: 'preview', scroll: 0 }] },
      0,
      false,
    )
    expect(binary.text).toContain('UTF-8 text preview')
    await model.activateFile('missing')
    const missing = await dashboard.frame(
      80,
      24,
      { panels: [{ kind: 'preview', scroll: 0 }] },
      0,
      false,
    )
    expect(missing.text).toContain('Immutable content is unavailable')
    expect(reads).toBe(1)
  } finally {
    dashboard.close()
    model.close()
  }
})

test('native captured-content scrolling and literal search reach the retained excerpt without new reads', async () => {
  const model = new PrivateRunModel()
  const text =
    Array.from({ length: 60 }, (_, i) => `Literal line ${i}`).join('\n') +
    '\nSearch target at the end'
  let reads = 0
  model.setArtifacts(
    () => undefined,
    async () => {
      reads++
      return { text, bytes: Buffer.byteLength(text), clipped: false }
    },
  )
  model.setArtifactCapture({
    generation: 'search',
    sourcePublisher: 'root',
    provenance: 'verified-delivery',
    phase: 'ready',
    files: [{ path: 'report.txt', bytes: Buffer.byteLength(text), state: 'text', clipped: false }],
  })
  model.select('files')
  await model.activateFile('report.txt')
  const dashboard = await PrivateOpenTuiDashboard.create(
    await privatePrepareOpenTui(),
    model,
    80,
    24,
  )
  try {
    await dashboard.frame(80, 24, { panels: [{ kind: 'preview', scroll: 0 }] }, 0, false)
    const state = {
      panels: [
        {
          kind: 'preview' as const,
          scroll: 0,
          query: 'Search target',
          matchOffset: text.indexOf('Search target'),
        },
      ],
    }
    const first = await dashboard.frame(80, 24, state, 0, false)
    const second = await dashboard.frame(80, 24, state, first.scroll, false)
    expect(first.text + second.text).toContain('Search target at the end')
    expect(reads).toBe(1)
    expect(first.scroll).toBeGreaterThan(0)
  } finally {
    dashboard.close()
    model.close()
  }
})
