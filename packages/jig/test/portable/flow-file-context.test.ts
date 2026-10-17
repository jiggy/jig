import { expect, test } from 'bun:test'
import {
  createPrivateChildFlowFileContext,
  createPrivateRootFlowFileContext,
  planPrivateChildFlowFiles,
  privateFlowFileExecutionProjection,
} from '../../src/internal/flow-file-context.js'
import { capturePrivateInput, readPrivateCapturedInput } from '../../src/internal/input-capture.js'

test('child aliases retain the whole original immutable read view without recapture', () => {
  const binary = capturePrivateInput(Uint8Array.from([0, 128, 255]))
  const empty = capturePrivateInput(new Uint8Array())
  const root = createPrivateRootFlowFileContext({
    declarations: { source: 'read', unused: 'read' },
    captured: [
      {
        name: 'source',
        files: [
          { path: 'binary.dat', input: binary },
          { path: 'nested/empty', input: empty },
        ],
      },
      { name: 'unused', files: [] },
    ],
  })
  try {
    const plan = planPrivateChildFlowFiles({
      caller: root,
      declarations: { first: 'read', second: 'read' },
      mapping: { first: { from: 'source' }, second: { from: 'source' } },
    })
    const child = createPrivateChildFlowFileContext(plan)
    const projected = privateFlowFileExecutionProjection(child)
    expect(projected.plan.capturedInputs?.map((item) => item.destination)).toEqual([
      '/jig-input/first/binary.dat',
      '/jig-input/first/nested/empty',
      '/jig-input/second/binary.dat',
      '/jig-input/second/nested/empty',
    ])
    expect(projected.plan.capturedInputs?.map((item) => item.input)).toEqual([
      binary,
      empty,
      binary,
      empty,
    ])
    expect([...readPrivateCapturedInput(binary)]).toEqual([0, 128, 255])
    expect(() => createPrivateChildFlowFileContext(plan)).toThrow('unavailable')
    expect(() => createPrivateChildFlowFileContext({ ...plan })).toThrow('unavailable')
    child.close()
    expect(() => privateFlowFileExecutionProjection(child)).toThrow('unavailable')
    // Closing the borrowed view never owns or closes the root's input captures.
    expect(readPrivateCapturedInput(empty).byteLength).toBe(0)
  } finally {
    root.close()
    binary.close()
    empty.close()
  }
})
test('nested delegation cannot reach back to an undeclared ancestor read port', () => {
  const input = capturePrivateInput(Buffer.from('original'))
  const root = createPrivateRootFlowFileContext({
    declarations: { source: 'read' },
    captured: [{ name: 'source', files: [{ path: 'photo.svg', input }] }],
  })
  try {
    const child = createPrivateChildFlowFileContext(
      planPrivateChildFlowFiles({
        caller: root,
        declarations: { photos: 'read' },
        mapping: { photos: { from: 'source' } },
      }),
    )
    expect(() =>
      planPrivateChildFlowFiles({
        caller: child,
        declarations: { source: 'read' },
        mapping: { source: { from: 'source' } },
      }),
    ).toThrow('declared read ports')
    const grandchild = createPrivateChildFlowFileContext(
      planPrivateChildFlowFiles({
        caller: child,
        declarations: { images: 'read' },
        mapping: { images: { from: 'photos' } },
      }),
    )
    expect(privateFlowFileExecutionProjection(grandchild).plan.capturedInputs?.[0]?.input).toBe(
      input,
    )
    child.close()
    expect(() => privateFlowFileExecutionProjection(grandchild)).toThrow('ancestor')
    expect(privateFlowFileExecutionProjection(root).plan.capturedInputs?.[0]?.input).toBe(input)
    root.close()
    expect(() => privateFlowFileExecutionProjection(grandchild)).toThrow('unavailable')
    child.close()
    grandchild.close()
  } finally {
    root.close()
    input.close()
  }
})
test('incomplete maps and unavailable source captures refuse before a child context exists', () => {
  const input = capturePrivateInput(Buffer.from('original'))
  const root = createPrivateRootFlowFileContext({
    declarations: { source: 'read' },
    captured: [{ name: 'source', files: [{ path: 'photo.svg', input }] }],
  })
  try {
    for (const mapping of [null, { wrong: { from: 'source' } }]) {
      expect(() =>
        planPrivateChildFlowFiles({
          caller: root,
          declarations: { photos: 'read' },
          mapping,
        }),
      ).toThrow()
    }
    const plan = planPrivateChildFlowFiles({
      caller: root,
      declarations: { photos: 'read' },
      mapping: { photos: { from: 'source' } },
    })
    input.close()
    expect(() => createPrivateChildFlowFileContext(plan)).toThrow('not active')
    expect(() => privateFlowFileExecutionProjection({ ...root })).toThrow('unavailable')
  } finally {
    root.close()
    input.close()
  }
})
test('data-only children require no native output or invented file ports', () => {
  const root = createPrivateRootFlowFileContext({ declarations: {}, captured: [] })
  try {
    const child = createPrivateChildFlowFileContext(
      planPrivateChildFlowFiles({
        caller: root,
        declarations: {},
        mapping: null,
      }),
    )
    expect(privateFlowFileExecutionProjection(child)).toEqual({
      plan: { capturedInputs: [], inputDirectories: [], output: false },
      attachments: {},
    })
    child.close()
    expect(() =>
      createPrivateRootFlowFileContext({
        declarations: { photos: 'read' },
        captured: [],
      }),
    ).toThrow('missing')
    expect(() =>
      createPrivateRootFlowFileContext({
        declarations: { 'photos\n': 'read' },
        captured: [],
      }),
    ).toThrow('LocalNames')
  } finally {
    root.close()
  }
})
test('operation plans are authentic, single-use and revoked with their caller', () => {
  const root = createPrivateRootFlowFileContext({ declarations: {}, captured: [] })
  const other = createPrivateRootFlowFileContext({ declarations: {}, captured: [] })
  try {
    const plan = planPrivateChildFlowFiles({ caller: root, declarations: {}, mapping: null })
    expect(() => createPrivateChildFlowFileContext({ ...plan })).toThrow('unavailable')
    root.close()
    expect(() => createPrivateChildFlowFileContext(plan)).toThrow('unavailable')
  } finally {
    root.close()
    other.close()
  }
})
test('closing an authenticated caller revokes descendant writable views', () => {
  const caller = createPrivateRootFlowFileContext({
    declarations: { files: 'read-write' },
    captured: [],
  })
  try {
    expect(() => privateFlowFileExecutionProjection({ ...caller })).toThrow('unavailable')
    const child = createPrivateChildFlowFileContext(
      planPrivateChildFlowFiles({
        caller,
        declarations: { output: 'read-write' },
        mapping: { output: { create: true } },
        attachments: { output: { create: true } },
      }),
    )
    caller.close()
    expect(() => privateFlowFileExecutionProjection(child)).toThrow('unavailable')
    expect(() => privateFlowFileExecutionProjection(caller)).toThrow('unavailable')
    child.close()
  } finally {
    caller.close()
  }
})
