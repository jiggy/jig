import { expect, test } from 'bun:test'
import { parse } from 'yaml'
import { privateCliHumanText } from '../src/cli-presentation.js'
import { privateCliValueFields } from '../src/cli-value-presentation.js'

// biome-ignore lint/suspicious/noControlCharactersInRegex: Compare rendered SGR with exact plain YAML.
const strip = (text: string) => text.replace(/\u001b\[[0-9;]*m/g, '')

test('human YAML round-trips JSON types, arbitrary keys, arrays, and text whitespace', () => {
  const values = [
    null,
    true,
    1e-20,
    '',
    'true',
    '2026-09-13',
    {},
    [],
    { object: { '0': 'value' }, list: [null, true, 12, {}, [], 'null', ''] },
    { 'multiline\nkey': 'value', 'a: b': '---', ['__proto__']: 'ordinary data' },
    { text: 'one\n\n\n  indented\nlast\n\n', next: 'plain' },
    { text: 'a "quote\nacross lines"\nend', unsafe: '\u202e' },
    ['\n', 'text\n\n', { text: 'long words '.repeat(20) + '\nnext', next: true }],
    { text: 'line\n \n', unicode: 'café 😀', controls: '\u0000\u0085\u202e\u200b\u001b[2J\r' },
    'Run failed\n\nWarning: forged status\n' + 'complete text '.repeat(25),
  ]
  for (const value of values) {
    for (const ascii of [false, true]) {
      const yaml = privateCliValueFields(value, 1, ascii)
      expect(parse(yaml)).toEqual(value)
      // biome-ignore lint/suspicious/noControlCharactersInRegex: Require unsafe terminal controls to be escaped.
      expect(yaml).not.toMatch(/[\p{Cf}\p{Zl}\p{Zp}\u0000\u0085\u001b\r]/u)
      if (ascii) expect(yaml).not.toMatch(/[^\x20-\x7e\n]/)
      expect(yaml).not.toMatch(/\((object|list|text)\):/)
      for (const width of [24, 80]) {
        expect(privateCliHumanText(yaml, false, width)).toBe(yaml)
        for (const JIG_THEME of ['one-dark', 'one-light', 'macchiato']) {
          const colored = privateCliHumanText(yaml, true, width, {
            JIG_THEME,
            COLORTERM: 'truecolor',
          })
          expect(strip(colored)).toBe(yaml)
          expect(parse(strip(colored))).toEqual(value)
          expect(colored).not.toContain('\u001b[1;31m')
        }
      }
    }
  }
})

test('signed review YAML preserves complete multiline changes and diff direction', () => {
  const value = {
    text: 'first\n\nWarning: still data\n' + 'long line '.repeat(30),
    list: ['a\nb\n\n'],
  }
  const yaml = privateCliValueFields(value, 1, true)
  for (const sign of ['-', '+']) {
    const signed =
      yaml
        .slice(0, -1)
        .split('\n')
        .map((line) => `${sign} ${line}`)
        .join('\n') + '\n'
    for (const color of [false, true]) {
      const rendered = privateCliHumanText(signed, color, 24)
      expect(strip(rendered)).toBe(signed)
      expect(parse(strip(rendered).replace(/^[+-] /gm, ''))).toEqual(value)
      if (color)
        expect(rendered).toContain(`\u001b[${sign === '+' ? '32' : '31'}m${sign}\u001b[39m`)
    }
  }
})

test('paths and unchanged context recede while changes and approval consequences stay prominent', () => {
  const lines = [
    '  Executable: "/nix/store/installation/bin/codex"',
    '  Flow source, prepared dependencies, settings and permissions are unchanged.',
    '  Unavailable: Pi, API endpoint. Setup: jig review --details.',
  ]
  for (const line of lines) {
    expect(privateCliHumanText(line, true)).toBe(`\u001b[90m${line}\u001b[39m`)
    expect(privateCliHumanText(line, false)).toBe(line)
  }
  const changed = 'Changed: "flow:flows/chat"'
  expect(privateCliHumanText(changed, true)).toBe(`\u001b[1;33m${changed}\u001b[0m`)
  expect(privateCliHumanText(changed, false)).toBe(changed)
  const consequence =
    '  Approval authorizes this target to run with the currently selected execution environment.'
  expect(privateCliHumanText(consequence, true)).toBe(consequence)
  for (const width of [24, 40, 80]) {
    const option = '  1. Codex — final result and live updates'
    expect(strip(privateCliHumanText(option, true, width))).toBe(
      privateCliHumanText(option, false, width),
    )
  }
  expect(privateCliHumanText('  1. Codex — final result and live updates', true)).toContain(
    '\u001b[1m  1. Codex\u001b[0m',
  )
})
