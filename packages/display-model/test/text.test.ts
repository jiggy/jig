import { expect, test } from 'bun:test'
import { detectDisplayTextFormat, displayTextTokens, displayDelimitedRows } from '../src/index.js'

test('filename detection is shared, content fallback is conservative', () => {
  expect(detectDisplayTextFormat('output/MANIFEST.CSV', 'a,b')).toBe('csv')
  expect(detectDisplayTextFormat('data.yaml', '{}')).toBe('yaml')
  expect(detectDisplayTextFormat('file.__proto__', 'hello')).toBe('plain')
  expect(detectDisplayTextFormat('Dockerfile', 'FROM alpine')).toBe('shell')
  expect(detectDisplayTextFormat('script', '#!/usr/bin/env python3\n')).toBe('python')
  expect(detectDisplayTextFormat('script', '#!/bin/bash\n')).toBe('shell')
  expect(detectDisplayTextFormat('data', '{"ok":true}')).toBe('json')
  expect(detectDisplayTextFormat('data', '{"ok":')).toBe('plain')
  expect(detectDisplayTextFormat('notes.txt', 'a,b\nc,d')).toBe('plain')
})

test('CSV colouring preserves quoted delimiters, newlines, escaped quotes and raw bytes', () => {
  const text = 'name,caption\r\n"a,b","two\nlines with ""quotes"""\r\n'
  const tokens = displayTextTokens(text, 'csv')
  expect(tokens.map((t) => t.text).join('')).toBe(text)
  expect(tokens.find((t) => t.text.startsWith('"a,b"'))?.column).toBe(0)
  expect(tokens.find((t) => t.text.startsWith('"two'))?.column).toBe(1)
  expect(displayDelimitedRows(text)).toEqual([
    ['name', 'caption'],
    ['a,b', 'two\nlines with "quotes"'],
  ])
})

test('tables reject malformed, irregular and excessive data; TSV handles empty fields', () => {
  for (const text of [
    'a,b\n"unterminated',
    'a,b\nc',
    'a,b\n"x"junk,y',
    'a,b\nx"y,z',
    'a,b\n'.repeat(501),
    'x'.repeat(65537),
    Array(65).fill('a').join(','),
  ])
    expect(displayDelimitedRows(text)).toBeUndefined()
  expect(displayDelimitedRows('a\tb\n\tx\n', '\t')).toEqual([
    ['a', 'b'],
    ['', 'x'],
  ])
})

test('lexical highlighting preserves source and treats supplied markup as ordinary text', () => {
  for (const format of ['json', 'yaml', 'markdown', 'typescript', 'python', 'shell'] as const) {
    const text = '# comment\nconst key = "<script>"; 123 true\n'
    expect(
      displayTextTokens(text, format)
        .map((t) => t.text)
        .join(''),
    ).toBe(text)
  }
  expect(displayTextTokens('{"count":12}', 'json').some((t) => t.role === 'key')).toBe(true)
  expect(displayTextTokens('x'.repeat(65537), 'json')).toEqual([
    { text: 'x'.repeat(65537), role: 'plain' },
  ])
})
