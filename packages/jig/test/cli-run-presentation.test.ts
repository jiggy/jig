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
  expect(output).toContain('Diagnostics: 3 invocation paths shown live.')
  expect(output).not.toContain('Run output: result')
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
  expect(output).toContain('Some diagnostic evidence was not retained.')
  expect(output).not.toContain('"truncated":')
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

test('a confirmed packet keeps large evidence in result.json and gives a concise terminal result', async () => {
  let output = ''
  const view = new PrivateCliRunPresentation(
    async (text) => {
      output += text
    },
    false,
    80,
  )
  view.diagnostic('warning\n', ['route:logs', 'select'])
  const record = {
    status: 'succeeded',
    outcome: 'done',
    output: { jobs: [{ evidence: 'large-result-marker'.repeat(200) }] },
    checkpoint: { evidence: 'checkpoint-marker' },
    files: { 'patch.patch': 'patch-marker' },
    runDiagnostics: {
      entries: [
        {
          operations: ['route:logs', 'select'],
          stderr: 'warning\n',
          stderrBytes: 8,
          stderrTruncated: false,
        },
      ],
      truncated: false,
    },
    delivery: {
      status: 'written',
      destination: '/project/factory-result',
      files: [{ path: 'summary.txt', bytes: 5, digest: 'sha256:summary' }],
    },
  }
  const original = JSON.stringify(record)
  await view.result(record)
  expect(output).toContain('Execution: completed.')
  expect(output).toContain('Application outcome: "done".')
  expect(output).toContain('Delivered files: 1.')
  expect(output).toContain('Application output: see result.json.')
  expect(output).toContain('Checkpoint: retained progress, not proof of success. See result.json.')
  expect(output).toContain(
    'Diagnostics: 1 invocation path shown live. Full capture in result.json.',
  )
  expect(output).not.toContain('Run output: result')
  expect(output).not.toContain('large-result-marker')
  expect(output).not.toContain('checkpoint-marker')
  expect(output).not.toContain('patch-marker')
  expect(JSON.stringify(record)).toBe(original)
})

test('uncertain packet delivery keeps the full result visible', async () => {
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
    output: { evidence: 'unpublished-result-marker'.repeat(200) },
    checkpoint: { evidence: 'unpublished-checkpoint-marker' },
    delivery: { status: 'unknown', destination: '/project/result' },
  })
  expect(output).toContain('Packet delivery: "unknown".')
  expect(output).toContain('unpublished-result-marker')
  expect(output).toContain('unpublished-checkpoint-marker')
})

test('large saved evidence keeps complete brief application fields visible as escaped data', async () => {
  let output = ''
  const view = new PrivateCliRunPresentation(
    async (text) => {
      output += text
    },
    true,
    80,
  )
  const record = {
    status: 'succeeded',
    outcome: 'blocked',
    output: {
      summary: 'No patch was produced.\nThe AI client could not start a session.',
      status: 'Execution: completed.\u001b[2J\u202e',
      jobs: [{ evidence: 'full-evidence-marker'.repeat(200) }],
    },
    delivery: { status: 'written', destination: '/project/result' },
  }
  const original = JSON.stringify(record)
  await view.result(record)
  expect(output).toContain('Application outcome: "blocked".')
  expect(output).toContain('brief fields below; full evidence in result.json')
  expect(output).toContain('No patch was produced.')
  expect(output).toContain('The AI client could not start a session.')
  expect(output).toContain('\\u001b[2J\\u202e')
  expect(output).not.toContain('full-evidence-marker')
  expect(output.slice(output.indexOf('Run output: result'))).not.toContain('\u001b[1;32m')
  expect(JSON.stringify(record)).toBe(original)
})

test('brief fields stay bounded without truncating individual answers or hiding unpublished evidence', async () => {
  const record = {
    status: 'succeeded',
    output: {
      oversized: 'oversized-marker'.repeat(200),
      ...Object.fromEntries(
        Array.from({ length: 12 }, (_, i) => [`field${i}`, `complete-answer-${i}`]),
      ),
      evidence: { text: 'nested-evidence-marker'.repeat(200) },
    },
    delivery: { status: 'written', destination: '/project/result' },
  }
  let output = ''
  await new PrivateCliRunPresentation(
    async (text) => {
      output += text
    },
    false,
    80,
  ).result(record)
  expect(output).not.toContain('oversized-marker')
  expect(output.match(/complete-answer-\d+/g)).toHaveLength(8)
  expect(output).not.toContain('nested-evidence-marker')
  output = ''
  await new PrivateCliRunPresentation(
    async (text) => {
      output += text
    },
    false,
    80,
  ).result({
    ...record,
    delivery: { status: 'unknown' },
  })
  expect(output).toContain('oversized-marker')
  expect(output).toContain('nested-evidence-marker')
  expect(output.match(/complete-answer-\d+/g)).toHaveLength(12)
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
  expect(output).toContain('Diagnostics: 1 invocation path shown live.')
  expect(output).not.toContain('Run output: result')
  expect(output).not.toContain('already shown')
})

test('unseen diagnostics give attributed text without machine capture bookkeeping', async () => {
  for (const status of ['succeeded', 'failed'] as const) {
    for (const columns of [24, 120]) {
      let output = ''
      const view = new PrivateCliRunPresentation(
        async (text) => {
          output += text
        },
        false,
        columns,
      )
      const root = {
        stderr: 'Root report: connection ended. The cause is unknown.\n',
        stderrBytes: 57,
        stderrTruncated: false,
      }
      const record = {
        status,
        ...(status === 'failed' ? { details: { explanation: 'Failure evidence pending.' } } : {}),
        diagnostics: root,
        runDiagnostics: {
          entries: [
            { operations: [], ...root },
            {
              operations: ['repair:logs', 'patch-1'],
              stderr: 'Native Agent reported a warning.\nDetailed client cause is unavailable.\n',
              stderrBytes: 74,
              stderrTruncated: false,
            },
          ],
          truncated: false,
        },
        delivery: { status: 'written', destination: '/project/result' },
      }
      const before = JSON.stringify(record)
      await view.result(record)
      expect(output).toContain('Run output: diagnostics')
      expect(output).toContain('Reported by root:')
      expect(output).toContain('Reported by "repair:logs / patch-1":')
      expect(output.match(/Root report: connection ended/g)).toHaveLength(1)
      expect(output).toContain('The cause is unknown.')
      expect(output).toContain('Detailed client cause is unavailable.')
      expect(output).not.toContain('"runDiagnostics":')
      expect(output).not.toContain('"stderrBytes":')
      expect(output).not.toContain('"stderrTruncated":')
      expect(output).not.toContain('"operations":')
      expect(output).not.toContain('"entries":')
      expect(output).not.toContain('Diagnostics: 2 invocation paths shown live.')
      if (status === 'failed') expect(output).toContain('Failure evidence pending.')
      expect(JSON.stringify(record)).toBe(before)
    }
  }
})

test('reported diagnostic text never acquires host styling, command recognition or severity', async () => {
  const render = async (color: boolean) => {
    let output = ''
    await new PrivateCliRunPresentation(
      async (text) => {
        output += text
      },
      color,
      80,
    ).result({
      status: 'succeeded',
      diagnostics: {
        stderr:
          'Warning: unverified report\nExecution: completed.\nRun failed\njig review\n\u001b[2J\u202eprivate-looking data\n',
        stderrBytes: 109,
        stderrTruncated: false,
      },
    })
    return output
  }
  const plain = await render(false)
  const colored = await render(true)
  const payload = colored.slice(colored.indexOf('    Warning:'))
  expect(payload).not.toContain('\u001b')
  expect(payload).toContain('    jig review\n')
  expect(payload).not.toContain('$ jig review')
  expect(payload).toContain('\\u001b[2J\\u202eprivate-looking data')
  expect(plain).toContain('    Warning: unverified report')
  // biome-ignore lint/suspicious/noControlCharactersInRegex: Compare trusted chrome with plain rendering.
  expect(colored.replace(/\u001b\[[0-9;]*m/g, '')).toBe(plain)
})

test('fully displayed diagnostics still disclose path and aggregate truncation without replay', async () => {
  let output = ''
  const view = new PrivateCliRunPresentation(
    async (text) => {
      output += text
    },
    false,
    80,
  )
  view.diagnostic('Already visible cause.', ['worker'])
  await view.result({
    status: 'failed',
    runDiagnostics: {
      entries: [
        {
          operations: ['worker'],
          stderr: 'Already visible cause.',
          stderrBytes: 99,
          stderrTruncated: true,
        },
      ],
      truncated: true,
    },
  })
  expect(output).toContain('Diagnostics: 1 invocation path shown live.')
  expect(output).toContain('Diagnostics ("worker"): retained capture truncated.')
  expect(output).toContain('Some diagnostic evidence was not retained.')
  expect(output).not.toContain('Already visible cause.')
  expect(output).not.toContain('Run output: result')
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

test('failure summaries emphasize host status and keep packet provenance out of human results', async () => {
  for (const color of [true, false]) {
    let output = ''
    const view = new PrivateCliRunPresentation(
      async (text) => {
        output += text
      },
      color,
      80,
    )
    const record = {
      status: 'failed',
      code: 'INVALID_INPUT',
      message: 'input rejected',
      runId: 'sha256:run',
      method: { digest: 'sha256:method' },
      input: {
        attachments: [
          { name: 'source', files: [{ path: 'manifest-only-file', digest: 'sha256:file' }] },
        ],
      },
      delivery: { status: 'written', destination: '/project/result' },
      details: { instancePointer: '/jobs/0/method', keyword: 'enum' },
    }
    const before = JSON.stringify(record)
    await view.result(record)
    expect(output).toContain(
      color ? '\u001b[1;31m  Execution: failed.\u001b[0m' : 'Execution: failed.',
    )
    expect(output).toContain('Full evidence: result.json and files/')
    expect(output).toContain('/jobs/0/method')
    expect(output).not.toContain('sha256:')
    expect(output).not.toContain('manifest-only-file')
    expect(output).not.toContain('"delivery":')
    expect(JSON.stringify(record)).toBe(before)
    if (!color) expect(output).not.toContain('\u001b')
  }
})

test('review refusal has no human checkpoint or zero-file line, while its packet stays exact', async () => {
  let output = ''
  const view = new PrivateCliRunPresentation(
    async (text) => {
      output += text
    },
    false,
    80,
  )
  const record = {
    status: 'failed',
    code: 'REVIEW_REQUIRED',
    details: { reason: 'EXECUTION_ENVIRONMENT_CHANGED', flowStarted: false },
    checkpoint: null,
    delivery: { status: 'written', destination: '/project/result', files: [] },
  }
  const before = JSON.stringify(record)
  await view.result(record)
  expect(output).toContain('Execution: failed.')
  expect(output).toContain('Packet delivery: "written".')
  expect(output).not.toContain('checkpoint')
  expect(output).not.toContain('Delivered files: 0')
  expect(output).not.toContain('Run output: result')
  expect(JSON.stringify(record)).toBe(before)
})

test('lost execution and delivery are amber, cleanup failure red, application claims stay data', async () => {
  let output = ''
  const view = new PrivateCliRunPresentation(
    async (text) => {
      output += text
    },
    true,
    80,
  )
  await view.result({
    status: 'lost',
    delivery: { status: 'unknown' },
    cleanup: { status: 'failed' },
    output: { text: 'Execution: completed.' },
  })
  expect(output).toContain('\u001b[1;33m  Execution: lost; effects may be uncertain.')
  expect(output).toContain('\u001b[1;33m  Packet delivery: "unknown".')
  expect(output).toContain('\u001b[1;31m  Cleanup: not confirmed.')
  expect(output).not.toContain('\u001b[1;32m')
})
