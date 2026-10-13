import { expect, test } from 'bun:test'
import { capturePrivateInput, type PrivateCapturedInput } from '../../src/internal/input-capture.js'
import {
  normalizePrivateReadInputAliases,
  planPrivateReadInputProjection,
} from '../../src/internal/read-input-projection.js'

test('eight whole views reuse 64 original captures and exactly 8 MiB of canonical input', () => {
  const captures = Array.from({ length: 64 }, (_, index) =>
    capturePrivateInput(Buffer.alloc(128 * 1024, index)),
  )
  const directories = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth']
  try {
    const files = directories.flatMap((root) =>
      captures.map((input, index) => ({ path: `${root}/folder/file-${index}`, input })),
    )
    const projection = planPrivateReadInputProjection({ files: [...files].reverse(), directories })
    expect(projection.files).toHaveLength(64)
    expect(projection.files.reduce((sum, file) => sum + file.input.bytes, 0)).toBe(8 * 1024 * 1024)
    expect(new Set(projection.files.map((file) => file.input)).size).toBe(64)
    expect(projection.aliases).toEqual(
      [...directories]
        .sort()
        .filter((name) => name !== 'eighth')
        .map((name) => ({ name, target: 'eighth' })),
    )
    expect(projection.files.every((file) => file.path.startsWith('eighth/'))).toBe(true)
    expect(projection.directories).toEqual(directories)
  } finally {
    for (const input of captures) input.close()
  }
})
test('equal content does not alias distinct original captures, and partial views stay independent', () => {
  const first = capturePrivateInput(Buffer.from('same bytes'))
  const second = capturePrivateInput(Buffer.from('same bytes'))
  try {
    const equal = planPrivateReadInputProjection({
      directories: ['first', 'second'],
      files: [
        { path: 'first/file', input: first },
        { path: 'second/file', input: second },
      ],
    })
    expect(first.digest).toBe(second.digest)
    expect(equal.aliases).toEqual([])
    expect(equal.files).toHaveLength(2)
    const partial = planPrivateReadInputProjection({
      directories: ['first', 'second'],
      files: [
        { path: 'first/file', input: first },
        { path: 'first/extra', input: second },
        { path: 'second/file', input: first },
      ],
    })
    expect(partial.aliases).toEqual([])
    expect(partial.files).toHaveLength(3)
  } finally {
    first.close()
    second.close()
  }
})
test('whole-view planning preserves empty roots and freezes the derived recipe', () => {
  const input = capturePrivateInput(Buffer.from('x'))
  try {
    const file = { path: 'first/file', input }
    const files = [file, { path: 'second/file', input }]
    const roots = ['empty', 'second', 'first']
    const projection = planPrivateReadInputProjection({ files, directories: roots })
    files.length = 0
    roots.length = 0
    file.path = '../outside'
    expect(projection.files).toEqual([{ path: 'first/file', input }])
    expect(projection.directories).toEqual(['empty', 'second', 'first'])
    expect(projection.aliases).toEqual([{ name: 'second', target: 'first' }])
    expect(Object.isFrozen(projection)).toBe(true)
    expect(Object.isFrozen(projection.files[0])).toBe(true)
    expect(Object.isFrozen(projection.aliases[0])).toBe(true)
  } finally {
    input.close()
  }
})
test('projection refuses decoded or closed captures, conflicting paths and independent excess', () => {
  const input = capturePrivateInput(Buffer.from('x'))
  const captures: PrivateCapturedInput[] = []
  try {
    for (const files of [
      [{ path: 'source/file', input: { ...input } }],
      [
        { path: 'source/file', input },
        { path: 'source/file', input },
      ],
      [
        { path: 'source/file', input },
        { path: 'source/file/child', input },
      ],
      [{ path: 'outside/file', input }],
      [{ path: 'source/../outside', input }],
      Array.from({ length: 65 }, (_, index) => ({ path: `source/file-${index}`, input })),
    ])
      expect(() => planPrivateReadInputProjection({ directories: ['source'], files })).toThrow()
    for (let index = 0; index < 65; index++) captures.push(capturePrivateInput(Buffer.alloc(0)))
    expect(() =>
      planPrivateReadInputProjection({
        directories: ['first', 'second'],
        files: captures.map((input, index) => ({
          path: `${index < 64 ? 'first' : 'second'}/file-${index}`,
          input,
        })),
      }),
    ).toThrow('unique physical')
    input.close()
    expect(() =>
      planPrivateReadInputProjection({
        directories: ['source'],
        files: [{ path: 'source/file', input }],
      }),
    ).toThrow()
  } finally {
    input.close()
    for (const input of captures) input.close()
  }
})
test('native alias recipes have only bounded local physical-root targets with no chains or files', () => {
  const roots = ['first', 'second', 'third', 'empty']
  expect(
    normalizePrivateReadInputAliases([{ name: 'second', target: 'first' }], roots, ['first/file']),
  ).toEqual([{ name: 'second', target: 'first' }])
  for (const aliases of [
    null,
    [{ name: 'second', target: '../outside' }],
    [{ name: 'second', target: '/host' }],
    [{ name: 'second', target: 'empty' }],
    [{ name: 'second', target: 'missing' }],
    [{ name: 'missing', target: 'first' }],
    [{ name: 'first', target: 'first' }],
    [{ name: 'second', target: 'first', extra: true }],
    [
      { name: 'second', target: 'first' },
      { name: 'second', target: 'first' },
    ],
    [
      { name: 'second', target: 'first' },
      { name: 'third', target: 'second' },
    ],
    [
      { name: 'first', target: 'second' },
      { name: 'second', target: 'first' },
    ],
  ])
    expect(() => normalizePrivateReadInputAliases(aliases, roots, ['first/file'])).toThrow()
  expect(() =>
    normalizePrivateReadInputAliases([{ name: 'second', target: 'first' }], roots, [
      'first/file',
      'second/file',
    ]),
  ).toThrow()
})
