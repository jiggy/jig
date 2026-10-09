import { expect, test } from 'bun:test'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expandPrivateCliFreshOutput } from '../src/private-cli-fresh-output.js'
import { resolveProjectEntrypoint } from '../src/project/entrypoint.js'
import { parseRun } from '../src/run-arguments.js'

test('a fresh name is selected once and subsequent command owners retain it exactly', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jig-fresh-output-'))
  try {
    await writeFile(join(root, 'existing-result'), 'previous evidence')
    const arguments_ = ['run', 'binding:work', '--out-new', 'result']
    const first = expandPrivateCliFreshOutput(arguments_, root)
    const second = expandPrivateCliFreshOutput(arguments_, root)
    expect(parseRun(first).output).toMatch(new RegExp(`^${root}/result-[0-9a-f]{32}$`))
    expect(parseRun(second).output).not.toBe(parseRun(first).output)
    expect(first).not.toContain('--out-new')
    expect(expandPrivateCliFreshOutput(first, '/other-owner')).toBe(first)
    expect(await readdir(root)).toEqual(['existing-result'])
    expect(await readFile(join(root, 'existing-result'), 'utf8')).toBe('previous evidence')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('default prefixes are project-relative and explicit prefixes are caller-relative', () => {
  const defaults = resolveProjectEntrypoint('binding:work --out-new evidence', [], '/project')
  expect(parseRun(expandPrivateCliFreshOutput(defaults, '/caller')).output).toMatch(
    /^\/project\/evidence-[0-9a-f]{32}$/,
  )
  const overrides = resolveProjectEntrypoint(
    'binding:work --out-new evidence',
    ['--out-new', 'chosen'],
    '/project',
  )
  expect(parseRun(expandPrivateCliFreshOutput(overrides, '/caller')).output).toMatch(
    /^\/caller\/chosen-[0-9a-f]{32}$/,
  )
})

test('fresh output rejects empty leaves, controls, malformed names and overlong paths', () => {
  for (const prefix of [
    '',
    'results/',
    '.',
    '..',
    'a/..',
    'a\\b',
    'a\nname',
    '\ud800',
    'a'.repeat(223),
    `${'a/'.repeat(2040)}result`,
  ])
    expect(() =>
      expandPrivateCliFreshOutput(['run', 'binding:work', '--out-new', prefix], '/project'),
    ).toThrow()
  for (const arguments_ of [
    ['--out', 'fixed', '--out-new', 'fresh'],
    ['--out-new', 'fresh', '--out', 'fixed'],
    ['--out-new', 'first', '--out-new', 'second'],
  ])
    expect(() =>
      expandPrivateCliFreshOutput(['run', 'binding:work', ...arguments_], '/project'),
    ).toThrow()
})
