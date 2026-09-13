import { expect, test } from 'bun:test'
import { PrivateCliRunPresentation } from '../src/cli-run-presentation.js'

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
  await view.result(
    {
      status: 'failed',
      output: { text: 'first\nsecond', empty: [], missing: null },
      diagnostics: { stderr: 'unseen warning', stderrBytes: 14, stderrTruncated: false },
    },
    '',
  )
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
  await view.result(
    {
      status: 'succeeded',
      diagnostics: { stderr: 'already shown', stderrBytes: 13, stderrTruncated: false },
    },
    'already shown',
  )
  expect(output).toContain('13 bytes shown live')
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
      await view.result(
        {
          status: 'succeeded',
          outcome: 'blocked',
          output: {
            text: 'A long explanation that must remain complete even on a narrow terminal.\nNext paragraph.',
            values: [true, null, {}],
          },
        },
        '',
      )
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
