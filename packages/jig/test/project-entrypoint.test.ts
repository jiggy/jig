import { expect, test } from 'bun:test'
import {
  privateCliCommandLifetimeMs,
  privateCliRequiresHost,
  privateCliVerification,
} from '../src/cli.js'
import { privateNeedsFileOwner } from '../src/internal/file-command.js'
import { defineJig } from '../src/project/author.js'
import {
  entrypointWords,
  parseProjectEntrypoint,
  resolveProjectEntrypoint,
  validateEntrypointInterface,
} from '../src/project/entrypoint.js'
import { parseRun } from '../src/run-arguments.js'

test('one string accepts either a target or familiar quoted Run arguments', () => {
  expect(defineJig({ entrypoint: 'binding:factory' }).entrypoint).toBe('binding:factory')
  expect(parseProjectEntrypoint('binding:factory').target).toEqual({
    kind: 'binding',
    id: 'factory',
  })
  const source = `binding:factory --input '@sample batches/default.json' --attach 'source=sample sources' --out results --timeout 8m`
  expect(parseProjectEntrypoint(source)).toMatchObject({
    inputFile: 'sample batches/default.json',
    output: 'results',
    timeoutMs: 480000,
    attachments: [{ name: 'source', directory: 'sample sources', select: [] }],
  })
  expect(
    parseProjectEntrypoint(`flow:flows/hello --input '{"message":"hello world","literal":"$HOME"}'`)
      .input,
  ).toEqual({ message: 'hello world', literal: '$HOME' })
  expect(entrypointWords(`binding:factory --input "@a\\ b.json"`)).toEqual([
    'binding:factory',
    '--input',
    '@a\\ b.json',
  ])
  expect(entrypointWords(`binding:factory --input @a\\ b.json`)).toEqual([
    'binding:factory',
    '--input',
    '@a b.json',
  ])
})

for (const value of ['', ' ', {}, ['binding:factory'], 'x'.repeat(16385)]) {
  test(`authoring rejects invalid entrypoint shape ${JSON.stringify(value).slice(0, 50)}`, () => {
    expect(() => defineJig({ entrypoint: value as string })).toThrow()
  })
}

for (const source of [
  'jig run binding:factory',
  'binding:factory --verification fast',
  'binding:factory --json',
  'binding:factory --help',
  'binding:factory --timeout',
  'binding:factory --timeout 0m',
  'binding:factory --timeout 1m --timeout 2m',
  'binding:factory --input nope',
  'binding:factory --input @../secret',
  'binding:factory --out /absolute',
  'binding:factory --attach source=.jig',
  'binding:factory --attach source=../outside',
  'binding:factory --out .jig/results',
  'binding:factory --input @file | cat',
  'binding:factory && anything',
  'binding:factory --input $(anything)',
  'binding:factory --input `anything`',
  'binding:factory --input "unfinished',
  'binding:factory --input trailing\\',
  'binding:factory\0',
]) {
  test(`review rejects invalid invocation ${JSON.stringify(source)}`, () => {
    expect(() => parseProjectEntrypoint(source)).toThrow()
  })
}

test('explicit options replace complete defaults, with paths resolved by origin', () => {
  const source = `binding:factory --input '{"old":true}' --attach source=fixtures --select source=old.ts --attach reference=reference --out result --receive progress --receive logs --timeout 8m`
  const args = resolveProjectEntrypoint(
    source,
    [
      '--input',
      '{"new":true}',
      '--attach',
      'source=../operator-source',
      '--receive',
      'status',
      '--timeout',
      '12m',
      '--verification',
      'strict',
      '--json',
    ],
    '/project',
  )
  expect(parseRun(args)).toMatchObject({
    input: { new: true },
    timeoutMs: 720000,
    output: '/project/result',
    attachments: [
      { name: 'source', directory: '../operator-source', select: [] },
      { name: 'reference', directory: '/project/reference', select: [] },
    ],
    receive: ['status'],
    verification: 'strict',
    json: true,
  })
  expect(privateCliRequiresHost(args)).toBe(true)
  expect(privateCliVerification(args)).toBe('strict')
  expect(privateCliCommandLifetimeMs(args)).toBe(720000 + 300000)
  expect(privateNeedsFileOwner(args)).toBe(true)
})

test('file defaults are references, with fresh input capture deferred until invocation', () => {
  const args = resolveProjectEntrypoint(
    'binding:factory --input @missing.json --out result',
    [],
    '/project',
  )
  expect(parseRun(args)).toMatchObject({
    inputFile: '/project/missing.json',
    output: '/project/result',
  })
  expect(
    parseRun(
      resolveProjectEntrypoint(
        'binding:factory --input @old.json',
        ['--input', 'null'],
        '/project',
      ),
    ),
  ).toMatchObject({ input: null })
  expect(
    parseRun(
      resolveProjectEntrypoint(
        'binding:factory --input @old.json',
        ['--input', '@new.json'],
        '/project',
      ),
    ).inputFile,
  ).toBe('new.json')
})

test('explicit selections replace the selection set and can use a default attachment', () => {
  const args = resolveProjectEntrypoint(
    'binding:factory --attach source=fixtures --select source=old.ts',
    ['--select', 'source=new.ts'],
    '/project',
  )
  expect(parseRun(args).attachments).toEqual([
    { name: 'source', directory: '/project/fixtures', select: ['new.ts'] },
  ])
  for (const overrides of [
    ['--timeout', '1m', '--timeout', '2m'],
    ['--attach', 'source=a', '--attach', 'source=b'],
    ['--select', 'missing=a'],
    ['--select', 'source=a', '--select', 'source=a'],
    ['--receive', 'a', '--receive', 'a'],
    ['--unknown', 'value'],
  ])
    expect(() =>
      resolveProjectEntrypoint('binding:factory --attach source=fixtures', overrides, '/project'),
    ).toThrow()
})

test('entrypoint defaults cannot override bound resources or name undeclared interfaces', () => {
  const parsed = parseProjectEntrypoint(
    'binding:factory --attach source=fixtures --receive progress',
  )
  const contract = {
    attachments: { source: 'read' as const },
    channels: { progress: { direction: 'send' as const } },
  }
  expect(() => validateEntrypointInterface(parsed, contract)).not.toThrow()
  expect(() => validateEntrypointInterface(parsed, contract, { source: {} })).toThrow()
  expect(() => validateEntrypointInterface(parsed, {})).toThrow()
})
