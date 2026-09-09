import { expect, test } from 'bun:test'
import {
  assertPrivatePackageAliasFiles,
  normalizePrivatePackageAliases,
  privatePackageAliasText,
} from '../src/internal/package-aliases.js'
import { privatePackageMaterializationMatches } from '../src/internal/package-materialization.js'

test('file aliases describe a tree without requiring Bun manifests or membership', () => {
  const source = { path: 'links/shared', target: 'data/shared' }
  const aliases = normalizePrivatePackageAliases([source])
  const alias = aliases[0]
  if (alias === undefined) throw new Error('missing normalized alias')
  assertPrivatePackageAliasFiles(aliases, [{ path: 'data/shared/value.txt' }])
  expect(privatePackageAliasText(alias)).toBe('../data/shared')
  source.target = 'elsewhere'
  expect(alias.target).toBe('data/shared')
  expect(Object.isFrozen(aliases[0])).toBe(true)
})

test('alias targets and parents cannot traverse another alias', () => {
  for (const aliases of [
    [{ path: 'a', target: 'a' }],
    [
      { path: 'a', target: 'b' },
      { path: 'b', target: 'a' },
    ],
    [
      { path: 'a', target: 'data' },
      { path: 'a/child', target: 'data' },
    ],
    [
      { path: 'a', target: 'data' },
      { path: 'b', target: 'a/nested' },
    ],
    [{ path: 'a', target: '../outside' }],
  ])
    expect(() => normalizePrivatePackageAliases(aliases)).toThrow()
})

test('materialization matching accounts for bytes and every alias, not object identity', () => {
  const aliases = normalizePrivatePackageAliases([{ path: 'links/shared', target: 'data/shared' }])
  const contents = { packageDigest: 'sha256:fixture', aliases }
  const allocation = contents as Parameters<typeof privatePackageMaterializationMatches>[0]
  expect(
    privatePackageMaterializationMatches(allocation, JSON.parse(JSON.stringify(contents))),
  ).toBe(true)
  expect(privatePackageMaterializationMatches(allocation, { ...contents, aliases: [] })).toBe(false)
  expect(
    privatePackageMaterializationMatches(allocation, {
      ...contents,
      packageDigest: 'sha256:changed',
    }),
  ).toBe(false)
  expect(
    privatePackageMaterializationMatches(allocation, {
      ...contents,
      aliases: [{ path: 'links/shared', target: 'data/other' }],
    }),
  ).toBe(false)
})
