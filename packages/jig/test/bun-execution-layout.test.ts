import { describe, expect, test } from 'bun:test'
import {
  assertPrivateBunExecutionLayoutFiles,
  EMPTY_PRIVATE_BUN_EXECUTION_LAYOUT,
  normalizePrivateBunExecutionLayout,
  PRIVATE_BUN_EXECUTION_LAYOUT_LIMITS,
  privateBunAliasPackageName,
  privateBunAliasText,
} from '../src/internal/bun-execution-layout.js'

function workspace() {
  return {
    flowRoot: 'flows/main',
    members: ['flows/main', 'libraries/shared'],
    aliases: [{ path: 'node_modules/@fixture/shared', target: 'libraries/shared' }],
  }
}

const regularFiles = [
  { path: 'flows/main/package.json' },
  { path: 'flows/main/flow.ts' },
  { path: 'libraries/shared/package.json' },
  { path: 'libraries/shared/value.ts' },
]

describe('private Bun execution layout', () => {
  test('normalizes standalone and workspace layouts into independent immutable values', () => {
    expect(normalizePrivateBunExecutionLayout({ flowRoot: '', members: [], aliases: [] })).toEqual(
      EMPTY_PRIVATE_BUN_EXECUTION_LAYOUT,
    )
    const input = workspace()
    const layout = normalizePrivateBunExecutionLayout(input)
    expect(Object.isFrozen(layout)).toBe(true)
    expect(Object.isFrozen(layout.members)).toBe(true)
    expect(Object.isFrozen(layout.aliases)).toBe(true)
    expect(Object.isFrozen(layout.aliases[0])).toBe(true)
    input.members[0] = 'modified'
    input.aliases[0]!.target = 'modified'
    expect(layout.flowRoot).toBe('flows/main')
    expect(layout.members[0]).toBe('flows/main')
    expect(layout.aliases[0]!.target).toBe('libraries/shared')
    expect(() => assertPrivateBunExecutionLayoutFiles(layout, regularFiles)).not.toThrow()
    expect(privateBunAliasText(layout.aliases[0]!)).toBe('../../libraries/shared')
  })

  test('accepts dependency cycles while every link targets a canonical real member', () => {
    const layout = normalizePrivateBunExecutionLayout({
      flowRoot: 'packages/a',
      members: ['packages/a', 'packages/b'],
      aliases: [
        { path: 'node_modules/a', target: 'packages/a' },
        { path: 'packages/a/node_modules/b', target: 'packages/b' },
        { path: 'packages/b/node_modules/a', target: 'packages/a' },
      ],
    })
    expect(() =>
      assertPrivateBunExecutionLayoutFiles(layout, [
        { path: 'packages/a/package.json' },
        { path: 'packages/b/package.json' },
      ]),
    ).not.toThrow()
    expect(privateBunAliasText(layout.aliases[1]!)).toBe('../../b')
    expect(privateBunAliasText(layout.aliases[2]!)).toBe('../../a')
  })

  test.each([
    '/node_modules/pkg',
    '../node_modules/pkg',
    'node_modules/../pkg',
    'node_modules//pkg',
    'node_modules/pkg/',
    'node_modules\\pkg',
    'node_modules/pkg\0suffix',
    'node_modules/\ud800',
    'node_modules/e\u0301',
    'node_modules/.bin',
    'node_modules/@fixture/.bin',
    'node_modules/.hidden',
    'somewhere/pkg',
    'node_modules/pkg/file.ts',
    `node_modules/${'a'.repeat(256)}`,
  ])('rejects unsafe or non-package alias path %j', (path) => {
    expect(() =>
      normalizePrivateBunExecutionLayout({
        ...workspace(),
        aliases: [{ path, target: 'libraries/shared' }],
      }),
    ).toThrow()
  })

  test.each([
    '../outside',
    '/outside',
    'libraries/unselected',
    'libraries/shared/subdirectory',
    'node_modules/@fixture/shared',
  ])('rejects unselected or noncanonical alias target %j', (target) => {
    expect(() =>
      normalizePrivateBunExecutionLayout({
        ...workspace(),
        aliases: [{ path: 'node_modules/pkg', target }],
      }),
    ).toThrow()
  })

  test('rejects overlapping aliases instead of traversing through another alias', () => {
    expect(() =>
      normalizePrivateBunExecutionLayout({
        ...workspace(),
        aliases: [
          { path: 'node_modules/pkg', target: 'libraries/shared' },
          { path: 'node_modules/pkg/node_modules/other', target: 'flows/main' },
        ],
      }),
    ).toThrow()
  })

  test('rejects path-resolution cycles, duplicate members, nested members and unsorted entries', () => {
    for (const members of [
      ['flows/main', 'flows/main'],
      ['flows/main', 'flows/main/nested'],
      ['libraries/shared', 'flows/main'],
      ['flows/main', 'node_modules/a'],
    ])
      expect(() => normalizePrivateBunExecutionLayout({ ...workspace(), members })).toThrow()
    expect(() =>
      normalizePrivateBunExecutionLayout({
        flowRoot: 'node_modules/a',
        members: ['node_modules/a', 'node_modules/b'],
        aliases: [
          { path: 'node_modules/a', target: 'node_modules/b' },
          { path: 'node_modules/b', target: 'node_modules/a' },
        ],
      }),
    ).toThrow()
    const alias = workspace().aliases[0]!
    expect(() =>
      normalizePrivateBunExecutionLayout({ ...workspace(), aliases: [alias, alias] }),
    ).toThrow()
    expect(() =>
      normalizePrivateBunExecutionLayout({
        ...workspace(),
        aliases: [
          { path: 'node_modules/z', target: 'libraries/shared' },
          { path: 'node_modules/a', target: 'libraries/shared' },
        ],
      }),
    ).toThrow()
  })

  test('requires a selected Flow root and keeps ordinary package layout empty', () => {
    expect(() => normalizePrivateBunExecutionLayout({ ...workspace(), flowRoot: '' })).toThrow()
    expect(() =>
      normalizePrivateBunExecutionLayout({ ...workspace(), flowRoot: 'unselected' }),
    ).toThrow()
    expect(() =>
      normalizePrivateBunExecutionLayout({ flowRoot: 'flows/main', members: [], aliases: [] }),
    ).toThrow()
  })

  test('rejects alias/file and alias/directory collisions, missing targets and file parents', () => {
    const layout = normalizePrivateBunExecutionLayout(workspace())
    for (const extra of [
      { path: 'node_modules/@fixture/shared' },
      { path: 'node_modules/@fixture/shared/nested.ts' },
      { path: 'node_modules' },
      { path: 'node_modules/@fixture' },
    ])
      expect(() => assertPrivateBunExecutionLayoutFiles(layout, [...regularFiles, extra])).toThrow()
    expect(() =>
      assertPrivateBunExecutionLayoutFiles(
        layout,
        regularFiles.filter(({ path }) => path !== 'libraries/shared/package.json'),
      ),
    ).toThrow()
  })

  test('allows an alias-only node_modules directory without inventing a regular placeholder', () => {
    const layout = normalizePrivateBunExecutionLayout(workspace())
    expect(() => assertPrivateBunExecutionLayoutFiles(layout, regularFiles)).not.toThrow()
    expect(privateBunAliasPackageName('flows/main/node_modules/@fixture/shared')).toBe(
      '@fixture/shared',
    )
    expect(privateBunAliasPackageName('node_modules/shared')).toBe('shared')
  })

  test('rejects member, alias and encoded metadata limits', () => {
    const limits = PRIVATE_BUN_EXECUTION_LAYOUT_LIMITS
    expect(() =>
      normalizePrivateBunExecutionLayout({
        ...workspace(),
        members: new Array(limits.members + 1).fill('member'),
      }),
    ).toThrow()
    expect(() =>
      normalizePrivateBunExecutionLayout({
        ...workspace(),
        aliases: new Array(limits.aliases + 1).fill(workspace().aliases[0]),
      }),
    ).toThrow()
    const prefix = ['a'.repeat(240), 'b'.repeat(240), 'c'.repeat(240), 'd'.repeat(180)].join('/')
    const aliases = Array.from({ length: 1_200 }, (_, index) => ({
      path: `${prefix}/node_modules/pkg${String(index).padStart(4, '0')}`,
      target: 'libraries/shared',
    }))
    const oversized = { ...workspace(), aliases }
    expect(Buffer.byteLength(JSON.stringify(oversized))).toBeGreaterThan(limits.bytes)
    expect(() => normalizePrivateBunExecutionLayout(oversized)).toThrow()
  })

  test('rejects proxies at every structural boundary without invoking their traps', () => {
    let calls = 0
    const wrap = <T extends object>(value: T): T =>
      new Proxy(value, {
        get() {
          calls++
          throw new Error('get trap')
        },
        getPrototypeOf() {
          calls++
          throw new Error('prototype trap')
        },
        ownKeys() {
          calls++
          throw new Error('keys trap')
        },
        getOwnPropertyDescriptor() {
          calls++
          throw new Error('descriptor trap')
        },
      })
    const input = workspace()
    for (const value of [
      wrap(input),
      { ...input, members: wrap(input.members) },
      { ...input, aliases: wrap(input.aliases) },
      { ...input, aliases: [wrap(input.aliases[0]!)] },
    ])
      expect(() => normalizePrivateBunExecutionLayout(value)).toThrow()
    expect(calls).toBe(0)
    const revoked = Proxy.revocable(input, {})
    revoked.revoke()
    expect(() => normalizePrivateBunExecutionLayout(revoked.proxy)).toThrow()
  })

  test('rejects accessors, sparse arrays and hidden properties without invoking getters', () => {
    let calls = 0
    const getter = {
      enumerable: true,
      get() {
        calls++
        throw new Error('getter')
      },
    }
    const input = workspace()
    const members = [...input.members]
    Object.defineProperty(members, '0', getter)
    const aliases = [...input.aliases]
    Object.defineProperty(aliases, '0', getter)
    for (const value of [
      Object.defineProperty({ ...input }, 'flowRoot', getter),
      { ...input, members },
      { ...input, aliases },
      { ...input, aliases: [Object.defineProperty({ ...input.aliases[0] }, 'path', getter)] },
      { ...input, members: new Array(2) },
      { ...input, aliases: Object.assign([...input.aliases], { extra: true }) },
      Object.defineProperty({ ...input }, 'flowRoot', { value: input.flowRoot, enumerable: false }),
      {
        ...input,
        members: Object.defineProperty([...input.members], '0', {
          value: input.members[0],
          enumerable: false,
        }),
      },
      { ...input, [Symbol('hidden')]: true },
      Object.assign(Object.create({ extra: true }), input),
    ])
      expect(() => normalizePrivateBunExecutionLayout(value)).toThrow()
    expect(calls).toBe(0)
  })
})
