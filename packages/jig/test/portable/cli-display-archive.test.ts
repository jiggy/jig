import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import type { Reference, ViewItem } from '@jigging/reporting'
import { cliShellWord } from '../../src/cli-discovery.js'
import {
  privateDisplayArchiveFailure,
  privateParseViews,
  privateRetainDisplayBundle,
} from '../../src/cli-display-archive.js'
import { CliDiagnostic } from '../../src/cli-usage.js'
import {
  PrivateDisplayArchiveError,
  privateViewReferences,
} from '../../src/internal/display-archive.js'
import { privatePresentationNow } from '../../src/internal/root-run-timeout-policy.js'

test('copyable receipt operands survive shell quoting, Unicode and an option-like identity', () => {
  const requestId = "--café'家族"
  const shell = spawnSync(
    'sh',
    [
      '-c',
      `printf '%s\\n' --request=${cliShellWord(requestId)} --generation=${cliShellWord('generation-1')}`,
    ],
    { encoding: 'utf8' },
  )
  expect(shell.status).toBe(0)
  expect(
    privateParseViews(['views', 'receipt', ...shell.stdout.trimEnd().split('\n')]),
  ).toMatchObject({ requestId, generation: 'generation-1' })
  expect(() =>
    privateParseViews([
      'views',
      'receipt',
      '--request=one',
      '--request',
      'two',
      '--generation=gen',
    ]),
  ).toThrow(CliDiagnostic)
  expect(() => privateParseViews(['views', 'receipt', '--request=', '--generation=gen'])).toThrow(
    CliDiagnostic,
  )
})

test('retained view commands preserve exact operations and their closed operands', () => {
  expect(privateParseViews(['views'])).toEqual({ operation: 'list', json: false, display: 'plain' })
  expect(
    privateParseViews([
      'views',
      'list',
      '--definition',
      'photos',
      '--instance',
      'album-a',
      '--display',
      'web',
      '--json',
    ]),
  ).toEqual({
    operation: 'list',
    json: true,
    display: 'web',
    definitionId: 'photos',
    instanceKey: 'album-a',
  })
  expect(privateParseViews(['views', 'context', '--json'])).toMatchObject({
    operation: 'context',
    json: true,
  })
  expect(
    privateParseViews(['views', 'receipt', '--request', 'publish-1', '--generation', 'epoch-1']),
  ).toMatchObject({ operation: 'receipt', requestId: 'publish-1', generation: 'epoch-1' })
  expect(
    privateParseViews([
      'views',
      'remove',
      '--definition',
      'photos',
      '--instance',
      'album-a',
      '--expected-revision',
      'revision-1',
    ]),
  ).toMatchObject({
    operation: 'remove',
    definitionId: 'photos',
    instanceKey: 'album-a',
    expectedRevision: 'revision-1',
  })
  expect(privateParseViews(['views', 'reset', '--generation', 'epoch-1'])).toMatchObject({
    operation: 'reset',
    generation: 'epoch-1',
  })
})

for (const arguments_ of [
  ['unknown'],
  ['--unknown', 'value'],
  ['--json', '--json'],
  ['--display', 'tui'],
  ['--display'],
  ['--definition', '--json'],
  ['--definition', 'a', '--definition', 'b'],
  ['--definition', 'x'.repeat(129)],
  ['--definition', 'first\nsecond'],
  ['--definition', 'first\u2028second'],
  ['--instance', 'album-a'],
  ['context', '--display', 'web'],
  ['context', '--definition', 'photos'],
  ['receipt', '--request', 'publish-1'],
  ['receipt', '--generation', 'epoch-1'],
  ['receipt', '--request', 'publish-1', '--generation', 'epoch-1', '--definition', 'photos'],
  ['remove', '--definition', 'photos', '--instance', 'album-a'],
  ['remove', '--definition', 'photos', '--expected-revision', 'revision-1'],
  ['remove', '--instance', 'album-a', '--expected-revision', 'revision-1'],
  ['reset'],
  ['reset', '--generation', 'epoch-1', '--request', 'publish-1'],
])
  test(`retained view grammar refuses ${JSON.stringify(arguments_)}`, () => {
    expect(() => privateParseViews(['views', ...arguments_])).toThrow(CliDiagnostic)
  })

test('evidence traversal follows typed positions, deduplicates references, and leaves prose inert', () => {
  const artifact: Reference = { kind: 'artifact', attachment: 'output', path: 'chart.svg' }
  const input: Reference = { kind: 'input-artifact', attachment: 'photos', path: 'source.png' }
  const call: Reference = { kind: 'call', operationId: 'caption' }
  const record: Reference = {
    kind: 'record',
    viewId: 'photos',
    collectionId: 'images',
    rowId: 'one',
  }
  const prose = JSON.stringify({ kind: 'artifact', attachment: 'secret', path: 'unselected' })
  const view: ViewItem = {
    kind: 'view',
    id: 'photos',
    title: prose,
    summary: prose,
    sections: [
      {
        title: prose,
        blocks: [
          { kind: 'report', text: prose, references: [artifact] },
          {
            kind: 'facts',
            items: [
              { label: prose, value: input },
              { label: 'literal', value: prose },
              { label: 'invocation', value: call },
            ],
          },
          { kind: 'content', reference: artifact },
          { kind: 'progress', label: prose, completed: 1 },
          {
            kind: 'collection',
            id: 'images',
            title: prose,
            columns: [{ key: 'related', label: prose, type: 'reference' }],
            rows: [
              {
                id: 'one',
                cells: { related: record },
                details: [
                  { kind: 'report', text: prose, references: [call] },
                  { kind: 'content', reference: input },
                ],
              },
            ],
          },
        ],
      },
    ],
  }
  expect(privateViewReferences(view)).toEqual([artifact, input, call, record])
})

test('archive diagnostics retain typed codes without exposing raw storage details', () => {
  const privateText = '/private/project/display.sqlite3\nsecret SQLite failure'
  const codes: readonly PrivateDisplayArchiveError['code'][] = [
    'INVALID',
    'UNSAFE_STORE',
    'CLOSED',
    'EXPIRED',
    'CONFLICT',
    'MISMATCH',
    'CAPACITY',
    'EVIDENCE_UNAVAILABLE',
    'DEADLINE',
  ]
  for (const code of codes) {
    const diagnostic = privateDisplayArchiveFailure(
      new PrivateDisplayArchiveError(code, privateText),
    )
    expect(diagnostic.code).toBe(`JIG_DISPLAY_ARCHIVE_${code}`)
    expect(diagnostic.exitCode).toBe(1)
    expect(diagnostic.message).not.toContain('/private')
    expect(diagnostic.message).not.toContain('secret SQLite')
    expect(diagnostic.message.length).toBeGreaterThan(40)
  }
  for (const error of [new Error(privateText), new AggregateError([], privateText)]) {
    const diagnostic = privateDisplayArchiveFailure(error)
    expect(diagnostic.code).toBe('JIG_DISPLAY_ARCHIVE_UNAVAILABLE')
    expect(diagnostic.message).not.toContain('/private')
    expect(diagnostic.exitCode).toBe(error instanceof AggregateError ? 2 : 1)
  }
  const supplied = new CliDiagnostic('JIG_DISPLAY_BUNDLE_INVALID', 'Known bounded cause.', 1)
  expect(privateDisplayArchiveFailure(supplied)).toBe(supplied)
})

test('a spent inherited publication deadline refuses before reading bytes or opening storage', async () => {
  let reads = 0
  const pending = privateRetainDisplayBundle({
    directory: '/not-selected-by-this-test',
    selection: { attachment: 'edition', path: 'final.json' },
    source: { runId: 'run-1', sourceId: 'root' },
    deadline: privatePresentationNow() - 1,
    readOutput() {
      reads++
      throw new Error('Expired publication must not read output')
    },
  })
  await expect(pending).rejects.toMatchObject({ code: 'JIG_DISPLAY_PUBLICATION_DEADLINE' })
  expect(reads).toBe(0)
})
