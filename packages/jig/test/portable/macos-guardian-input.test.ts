import { expect, test } from 'bun:test'
import { privateFilePath, sha256 } from '../../src/internal/file-input.js'
import {
  normalizePrivateMacosInputDirectories,
  normalizePrivateMacosInputs,
} from '../../src/internal/macos-input-projection.js'

test('native input manifest rejects aliases, file/directory conflicts and aggregate excess', () => {
  const file = { path: 'source/a', bytes: 1, digest: sha256(Buffer.from('x')) }
  expect(normalizePrivateMacosInputs([file], ['source'])).toEqual([file])
  // Native projection also accepts held artifact inputs. Operator capture
  // retains its independent 8 MiB bound before reaching this native manifest.
  const artifact = { ...file, bytes: 16 * 1024 * 1024 }
  expect(normalizePrivateMacosInputs([artifact], ['source'])).toEqual([artifact])
  for (const value of [
    null,
    [file, file],
    [file, { ...file, path: 'source/a/b' }],
    [{ ...file, path: 'other/a' }],
    [{ ...file, path: 'source' }],
    [{ ...file, path: '../outside' }],
    [{ ...file, path: '.jig/private' }],
    [{ ...file, bytes: 16 * 1024 * 1024 + 1 }],
    [{ ...file, bytes: -1 }],
    [{ ...file, digest: 'untrusted' }],
    [{ ...file, extra: true }],
    Array.from({ length: 65 }, (_, i) => ({ ...file, path: `source/f${i}` })),
    Array.from({ length: 64 }, (_, i) => ({
      ...file,
      path: `source/d${i}/one/two/three/four/file`,
    })),
  ])
    expect(() => normalizePrivateMacosInputs(value, ['source'])).toThrow()
})
test('native input roots are bounded exact names even when they contain no files', () => {
  expect(normalizePrivateMacosInputDirectories(['source', 'empty'])).toEqual(['source', 'empty'])
  expect(normalizePrivateMacosInputs([], ['source', 'empty'])).toEqual([])
  for (const roots of [
    null,
    ['source', 'source'],
    ['../outside'],
    ['source/child'],
    ['.jig'],
    ['source\n'],
    ['a'.repeat(65)],
    Array.from({ length: 9 }, (_, i) => `root${i}`),
  ])
    expect(() => normalizePrivateMacosInputDirectories(roots)).toThrow()
})
test('native attachment roots do not consume the enumerated entry budget', () => {
  const files = Array.from({ length: 64 }, (_, i) => ({
    path: `source/d${i}/one/two/file`,
    bytes: 0,
    digest: sha256(Buffer.alloc(0)),
  }))
  expect(normalizePrivateMacosInputs(files, ['source', 'empty'])).toEqual(files)
  expect(() =>
    normalizePrivateMacosInputs(
      files.map((file, index) =>
        index === 0 ? { ...file, path: 'source/d0/one/two/extra/file' } : file,
      ),
      ['source'],
    ),
  ).toThrow()
})
test('native attachment projection preserves the full relative path budget', () => {
  const root = 'a'.repeat(64)
  const paths = [
    [...Array<string>(15).fill('dir'), 'file'].join('/'),
    `${'a'.repeat(250)}/${'b'.repeat(250)}/result.txt`,
  ]
  for (const path of paths) {
    expect(privateFilePath(path)).toBe(path)
    const file = { path: `${root}/${path}`, bytes: 0, digest: sha256(Buffer.alloc(0)) }
    expect(normalizePrivateMacosInputs([file], [root])).toEqual([file])
  }
  for (const path of [`${paths[0]}/extra`, `${paths[1]}x`, '../outside', '.jig/private']) {
    const file = { path: `${root}/${path}`, bytes: 0, digest: sha256(Buffer.alloc(0)) }
    expect(() => normalizePrivateMacosInputs([file], [root])).toThrow()
  }
})
