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
