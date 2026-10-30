import { expect, test } from 'bun:test'
import { CliDiagnostic } from '../../src/cli-usage.js'
import { PrivateRootRunFiles } from '../../src/internal/root-run-files.js'
import type { InvocationOperationDescriptor } from '../../src/invocation-contract.js'
import {
  parseProjectEntrypoint,
  resolveProjectEntrypoint,
  validateEntrypointInterface,
} from '../../src/project/entrypoint.js'
import type { PrivateActivationRequest } from '../../src/project/package-resolution.js'
import { parseRun } from '../../src/run-arguments.js'

test('final bundle selection keeps its declared output member relative through defaults and overrides', () => {
  const entrypoint = 'binding:album --display-bundle edition=reports/final.json'
  expect(parseRun(resolveProjectEntrypoint(entrypoint, [], '/project')).displayBundle).toEqual({
    attachment: 'edition',
    path: 'reports/final.json',
  })
  expect(
    parseRun(
      resolveProjectEntrypoint(entrypoint, ['--display-bundle', 'review=chosen.json'], '/project'),
    ).displayBundle,
  ).toEqual({ attachment: 'review', path: 'chosen.json' })
  expect(() =>
    resolveProjectEntrypoint(
      entrypoint,
      ['--display-bundle', 'review=one.json', '--display-bundle', 'review=two.json'],
      '/project',
    ),
  ).toThrow()
  expect(parseRun(['run', 'binding:album']).displayBundle).toBeUndefined()
  const parsed = parseRun([
    'run',
    'binding:album',
    '--json',
    '--display',
    'plain',
    '--display-bundle',
    'edition=final.json',
  ])
  expect(parsed.json).toBe(true)
  expect(parsed.display).toBe('plain')
  expect(parsed.output).toBeUndefined()
})

for (const value of [
  '',
  'edition',
  '=final.json',
  'edition=',
  'Edition=final.json',
  'two--parts=final.json',
  `${'a'.repeat(65)}=final.json`,
  'edition=/final.json',
  'edition=../final.json',
  'edition=reports/../final.json',
  'edition=reports//final.json',
  'edition=reports\\final.json',
  'edition=.jig/final.json',
  'edition=final\0.json',
  `edition=${'a/'.repeat(16)}final.json`,
  `edition=${'é'.repeat(257)}`,
])
  test(`final bundle grammar refuses ${JSON.stringify(value)}`, () => {
    expect(() => parseRun(['run', 'binding:album', '--display-bundle', value])).toThrow(
      CliDiagnostic,
    )
  })

test('missing and repeated final bundle operands are refused', () => {
  expect(() => parseRun(['run', 'binding:album', '--display-bundle'])).toThrow(CliDiagnostic)
  expect(() => parseRun(['run', 'binding:album', '--display-bundle', '--json'])).toThrow(
    CliDiagnostic,
  )
  expect(() =>
    parseRun([
      'run',
      'binding:album',
      '--display-bundle',
      'edition=one.json',
      '--display-bundle',
      'edition=two.json',
    ]),
  ).toThrow(CliDiagnostic)
})

test('entrypoint and root owner require an exact declared output instead of a read input', async () => {
  const parsed = parseProjectEntrypoint('binding:album --display-bundle edition=final.json')
  const owner = new PrivateRootRunFiles([], true, undefined, 'edition')
  const base = { package: { digest: `sha256:${'0'.repeat(64)}` }, settings: {}, slots: {} }
  const valid: readonly InvocationOperationDescriptor[] = [
    { attachments: { edition: 'read-write' } },
    { attachments: {}, artifactResults: ['edition'] },
  ]
  const invalid: readonly InvocationOperationDescriptor[] = [
    { attachments: {} },
    { attachments: { edition: 'read' } },
    { attachments: { other: 'read-write' } },
    { attachments: {}, artifactResults: ['other'] },
  ]
  try {
    for (const invocation of valid) {
      expect(() => validateEntrypointInterface(parsed, invocation)).not.toThrow()
      expect(() =>
        owner.identify({ ...base, ...invocation } as unknown as PrivateActivationRequest),
      ).not.toThrow()
    }
    for (const invocation of invalid) {
      expect(() => validateEntrypointInterface(parsed, invocation)).toThrow()
      try {
        owner.identify({ ...base, ...invocation } as unknown as PrivateActivationRequest)
        throw new Error('Invalid output declaration was accepted')
      } catch (error) {
        expect(error).toMatchObject({ code: 'DISPLAY_BUNDLE_OUTPUT_INVALID', kind: 'invalid' })
      }
    }
  } finally {
    await owner.close()
  }
  expect(() => new PrivateRootRunFiles([], true, undefined, 'private/path')).toThrow()
})
