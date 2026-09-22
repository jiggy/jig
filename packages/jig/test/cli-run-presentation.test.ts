import { expect, test } from 'bun:test'
import { PrivateCliRunPresentation } from '../src/cli-run-presentation.js'
import { PrivateRunDiagnostics } from '../src/internal/run-diagnostics.js'

test('interleaved root and child diagnostics are summarized without mutating captured evidence', async () => {
  let output = ''
  const view = new PrivateCliRunPresentation(
    async (text) => {
      output += text
    },
    false,
    80,
  )
  const capture = new PrivateRunDiagnostics()
  for (const [text, operations] of [
    ['root warning\n', []],
    ['same warning\n', ['one']],
    ['same warning\n', ['two']],
    ['root ending\n', []],
  ] as const) {
    view.diagnostic(capture.record(new TextEncoder().encode(text), operations), operations)
  }
  const runDiagnostics = capture.snapshot()
  const root = runDiagnostics.entries[0]
  if (!root) throw new Error('missing root diagnostics')
  const { operations: _operations, ...diagnostics } = root
  const record = { status: 'succeeded', diagnostics, runDiagnostics }
  const before = JSON.stringify(record)
  await view.result(record)
  expect(output).not.toContain('root warning')
  expect(output).not.toContain('same warning')
  expect(output).not.toContain('root ending')
  expect(output).toContain('Diagnostics (root)')
  expect(output).toContain('Diagnostics ("one")')
  expect(output).toContain('Diagnostics ("two")')
  expect(output.match(/Diagnostics \(root\)/g)).toHaveLength(1)
  expect(JSON.stringify(record)).toBe(before)
})

test('partial delivery removes only the shown prefix for that invocation', async () => {
  let output = ''
  const view = new PrivateCliRunPresentation(
    async (text) => {
      output += text
    },
    false,
    80,
  )
  view.diagnostic('shown €\n', ['one'])
  await view.result({
    status: 'failed',
    runDiagnostics: {
      truncated: true,
      entries: [
        {
          operations: ['one'],
          stderr: 'shown €\nunseen ending',
          stderrBytes: 100,
          stderrTruncated: true,
        },
        { operations: ['two'], stderr: 'shown €\n', stderrBytes: 10, stderrTruncated: false },
      ],
    },
  })
  expect(output.match(/shown €/g)).toHaveLength(1) // The other child's identical text was not shown.
  expect(output).toContain('unseen ending')
  expect(output).toContain('retained capture truncated')
  expect(output).toContain('"truncated": true')
})

test('bounded presentation tracking preserves unseen Unicode suffixes and empty truncated records', async () => {
  let output = ''
  const view = new PrivateCliRunPresentation(
    async (text) => {
      output += text
    },
    false,
    80,
  )
  const prefix = 'x'.repeat(64 * 1024 - 1)
  view.diagnostic(`${prefix}😀`, ['one'])
  await view.result({
    status: 'succeeded',
    runDiagnostics: {
      truncated: true,
      entries: [
        {
          operations: ['one'],
          stderr: `${prefix}😀remaining`,
          stderrBytes: 65550,
          stderrTruncated: true,
        },
        { operations: ['two'], stderr: '', stderrBytes: 20, stderrTruncated: true },
      ],
    },
  })
  expect(output).not.toContain('xxx')
  expect(output).toContain('😀remaining')
  expect(output).not.toContain('�')
  expect(output).toContain('Diagnostics ("two"): retained capture truncated')
})

test('host facts precede arbitrary results without interpreting application claims as success', async () => {
  let output = ''
  const view = new PrivateCliRunPresentation(
    async (text) => {
      output += text
    },
    false,
    80,
  )
  await view.result({
    status: 'succeeded',
    outcome: 'blocked',
    output: { success: true, explanation: 'The application decides what this means.' },
    delivery: { status: 'unknown', destination: 'review\u001b[2J' },
    cleanup: { status: 'failed', code: 'PROJECT_CLOSE_FAILED' },
  })
  expect(output.indexOf('Execution: completed')).toBeLessThan(output.indexOf('"success": true'))
  expect(output).toContain('Application outcome: "blocked"')
  expect(output).toContain('Packet delivery: "unknown"')
  expect(output).toContain('Cleanup: not confirmed')
  expect(output).toContain('\\u001b')
  expect(output).not.toContain('\u001b')
})

test('channel text fragments join, switches stay labelled and closure is separate from execution', async () => {
  let output = ''
  const view = new PrivateCliRunPresentation(
    async (text) => {
      output += text
    },
    false,
    80,
  )
  await view.channel({ type: 'begin', channel: 'progress', startSequence: 1 })
  await view.channel({ type: 'data', channel: 'progress', sequence: 1, value: 'One' })
  await view.channel({ type: 'data', channel: 'progress', sequence: 2, value: ' answer.' })
  await view.channel({ type: 'data', channel: 'other', sequence: 1, value: { count: 2 } })
  await view.channel({ type: 'end', channel: 'progress', status: 'failed', code: 'LAGGED' })
  expect(output).toContain('One answer.\n')
  expect(output).toContain('channel "other"')
  expect(output).toContain('"count": 2')
  expect(output).toContain('failed ("LAGGED")')
  expect(output).not.toContain('Execution completed')
})

test('human output escapes terminal controls, preserves paragraphs and retains unseen diagnostics', async () => {
  let output = ''
  const view = new PrivateCliRunPresentation(
    async (text) => {
      output += text
    },
    false,
    80,
  )
  await view.channel({ type: 'data', channel: 'progress', value: '\u001b[2J\r\u202eevil' })
  await view.result({
    status: 'failed',
    output: { text: 'first\nsecond', empty: [], missing: null },
    diagnostics: { stderr: 'unseen warning', stderrBytes: 14, stderrTruncated: false },
  })
  expect(output).not.toContain('\u001b')
  expect(output).not.toContain('\r')
  expect(output).not.toContain('\u202e')
  expect(output).toContain('\\u001b[2J\\u000d\\u202e')
  expect(output).toContain('first\n')
  expect(output).toContain('"empty": []')
  expect(output).toContain('"missing": null')
  expect(output).toContain('unseen warning')
})

test('only diagnostics already shown exactly are summarized', async () => {
  let output = ''
  const view = new PrivateCliRunPresentation(
    async (text) => {
      output += text
    },
    false,
    80,
  )
  view.diagnostic('already shown')
  await view.result({
    status: 'succeeded',
    diagnostics: { stderr: 'already shown', stderrBytes: 13, stderrTruncated: false },
  })
  expect(output).toContain('13 bytes of text shown live')
  expect(output).not.toContain('already shown')
})

test('narrow and color-disabled terminals retain the same result content', async () => {
  for (const columns of [24, 80]) {
    const render = async (color: boolean) => {
      let output = ''
      const view = new PrivateCliRunPresentation(
        async (text) => {
          output += text
        },
        color,
        columns,
      )
      await view.result({
        status: 'succeeded',
        outcome: 'blocked',
        output: {
          text: 'A long explanation that must remain complete even on a narrow terminal.\nNext paragraph.',
          values: [true, null, {}],
        },
      })
      return output
    }
    const plain = await render(false)
    // biome-ignore lint/suspicious/noControlCharactersInRegex: Compare terminal SGR rendering with plain output.
    expect((await render(true)).replace(/\u001b\[[0-9;]*m/g, '')).toBe(plain)
    expect(plain).not.toContain('\u001b')
    expect(plain).toContain('blocked')
    expect(plain).toContain('Next paragraph.')
  }
})
