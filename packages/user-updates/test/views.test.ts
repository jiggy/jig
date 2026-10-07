import { expect, test } from 'bun:test'
import {
  USER_UPDATES_CONTRACT,
  type UserView,
  validateUserUpdate,
  withUserUpdates,
} from '../src/index.js'

const view = () => ({
  kind: 'view',
  id: 'jobs',
  title: 'Jobs',
  landing: true,
  summary: 'Review supplied work',
  sections: [
    {
      blocks: [
        {
          kind: 'collection',
          id: 'items',
          title: 'Items',
          columns: [
            { key: 'name', label: 'Name', type: 'text' },
            { key: 'done', label: 'Done', type: 'boolean' },
          ],
          rows: [
            {
              id: 'one',
              cells: { name: 'Matter', done: null },
              details: [
                {
                  kind: 'report',
                  text: '',
                  references: [{ kind: 'call', operationId: 'repair:one' }],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
})
test('views are complete immutable snapshots with closed structure and typed exact cells', () => {
  const input = view(),
    snapshot = validateUserUpdate(input)
  input.sections[0]!.blocks[0]!.rows[0]!.cells.name = 'Changed'
  expect(JSON.stringify(snapshot)).toContain('Matter')
  expect(Object.isFrozen((snapshot as any).sections[0].blocks[0].rows[0].cells)).toBe(true)
  const mutate = [
    (v: any) => (v.sections[0].blocks[0].rows[0].cells.extra = true),
    (v: any) => (v.sections[0].blocks[0].rows[0].cells.done = 'true'),
    (v: any) => v.sections[0].blocks[0].rows.push(v.sections[0].blocks[0].rows[0]),
    (v: any) => v.sections[0].blocks[0].columns.push(v.sections[0].blocks[0].columns[0]),
    (v: any) => (v.sections[0].blocks[0].total = 0),
    (v: any) => (v.sections[0].blocks[0].rows[0].details = [v.sections[0].blocks[0]]),
    (v: any) => v.sections.push(v.sections[0]),
    (v: any) => (v.id = 'a\nb'),
    (v: any) => (v.landing = false),
    (v: any) =>
      (v.sections[0].blocks[0].rows[0].details[0].references = [
        { kind: 'artifact', attachment: 'output', path: '../secret' },
      ]),
    (v: any) =>
      (v.sections[0].blocks[0].rows[0].details[0].references = [
        { kind: 'call', operationId: 'a b' },
      ]),
    (v: any) => (v.sections = Array.from({ length: 9 }, () => ({ blocks: [] }))),
    (v: any) =>
      (v.sections = [{ blocks: Array.from({ length: 33 }, () => ({ kind: 'report', text: '' })) }]),
  ]
  for (const change of mutate) {
    const v = view()
    change(v)
    expect(() => validateUserUpdate(v)).toThrow(TypeError)
  }
  for (const path of ['/etc/file', 'a//b', 'a/.jig/x', 'a\\b', 'a/./b', 'a/'.repeat(17) + 'b'])
    expect(() =>
      validateUserUpdate({
        kind: 'view',
        id: 'x',
        title: 'X',
        summary: 'X',
        sections: [
          {
            blocks: [
              {
                kind: 'report',
                text: '',
                references: [{ kind: 'artifact', attachment: 'out', path }],
              },
            ],
          },
        ],
      }),
    ).toThrow()
})
test('unwired handles validate, snapshot declarations without getters, enforce lifetime, and retire idempotently', async () => {
  let retained!: UserView
  await withUserUpdates(
    { channels: {}, signal: new AbortController().signal },
    'updates',
    async (updates) => {
      expect(() =>
        updates.view('x', {
          get title() {
            throw new Error('getter executed')
          },
        }),
      ).toThrow(TypeError)
      retained = updates.view('x', { title: 'Jobs' })
      expect(() =>
        retained.update({
          get summary() {
            throw new Error('getter executed')
          },
          sections: [],
        }),
      ).toThrow(TypeError)
      retained.update({ summary: 'Still validates', sections: [] })
      retained.retire()
      retained.retire()
      expect(() => retained.update({ summary: 'Late', sections: [] })).toThrow('retired')
      expect(() => updates.view('x', { title: 'Reused' })).toThrow('owner')
    },
  )
  expect(() => retained.retire()).not.toThrow()
})
test('tail view replacements coalesce but notice/retirement and in-flight snapshots are barriers', async () => {
  const values: any[] = []
  const sender = {
    direction: 'send' as const,
    delivery: 'direct' as const,
    contract: USER_UPDATES_CONTRACT,
    send: async (v: any) => {
      values.push(v)
    },
    close: async () => {},
  }
  await withUserUpdates(
    { channels: { updates: sender }, signal: new AbortController().signal },
    'updates',
    async (updates) => {
      const handle = updates.view('jobs', { title: 'Jobs' })
      handle.update({ summary: 'Old', sections: [] })
      handle.update({ title: 'New title', summary: 'New', sections: [] })
      updates.notice('Barrier')
      handle.update({ summary: 'After barrier', sections: [] })
      handle.retire()
      handle.retire()
      await new Promise((resolve) => setTimeout(resolve, 850))
    },
  )
  expect(values.map((v) => v.kind)).toEqual(['view', 'notice', 'view', 'retire-view'])
  expect(values[0].summary).toBe('New')
  expect(values[0].title).toBe('New title')
})

test('view numbers obey JSON/0 and the shared exact 32 KiB boundary', () => {
  const value = {
    kind: 'view',
    id: 'numbers',
    title: 'Numbers',
    summary: 'Check canonical byte accounting',
    sections: [
      {
        blocks: [
          {
            kind: 'facts',
            items: Array.from({ length: 32 }, (_, i) => ({ label: 'N' + i, value: 1e-7 })),
          },
          ...Array.from({ length: 8 }, (_, i) => ({
            kind: 'report',
            text: 'x'.repeat(i < 7 ? 4096 : 2809),
          })),
        ],
      },
    ],
  }
  expect(Buffer.byteLength(JSON.stringify(value))).toBe(32768)
  expect(() => validateUserUpdate(value)).not.toThrow()
  value.sections[0]!.blocks[8]!.text += 'x'
  expect(() => validateUserUpdate(value)).toThrow('32 KiB')
  for (const number of [1e20, -1e20, 2 ** 53, NaN, Infinity, -Infinity]) {
    expect(() =>
      validateUserUpdate({
        kind: 'view',
        id: 'x',
        title: 'X',
        summary: 'X',
        sections: [{ blocks: [{ kind: 'facts', items: [{ label: 'N', value: number }] }] }],
      }),
    ).toThrow(TypeError)
  }
})
