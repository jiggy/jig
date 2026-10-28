import { expect, test } from 'bun:test'
import {
  REPORTING_CONTRACT,
  type ReportingView,
  validateReportingMessage,
  withReporting,
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
    snapshot = validateReportingMessage(input)
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
    (v: any) => (v.sections = Array.from({ length: 33 }, () => ({ blocks: [] }))),
    (v: any) =>
      (v.sections = [{ blocks: Array.from({ length: 33 }, () => ({ kind: 'report', text: '' })) }]),
  ]
  for (const change of mutate) {
    const v = view()
    change(v)
    expect(() => validateReportingMessage(v)).toThrow(TypeError)
  }
  for (const path of ['/etc/file', 'a//b', 'a/.jig/x', 'a\\b', 'a/./b', 'a/'.repeat(17) + 'b'])
    expect(() =>
      validateReportingMessage({
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
  let retained!: ReportingView
  await withReporting(
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
    contract: REPORTING_CONTRACT,
    send: async (v: any) => {
      values.push(v)
    },
    close: async () => {},
  }
  await withReporting(
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

test('view numbers obey JSON/0 and the shared exact 512 KiB boundary', () => {
  const rows = Array.from({ length: 128 }, (_, index) => ({
    id: String(index),
    cells: { text: '' },
  }))
  const value = {
    kind: 'view',
    id: 'numbers',
    title: 'Numbers',
    summary: 'Canonical byte accounting',
    sections: [
      {
        blocks: [
          {
            kind: 'collection',
            id: 'records',
            title: 'Records',
            columns: [{ key: 'text', label: 'Text', type: 'text' }],
            rows,
          },
        ],
      },
    ],
  }
  let remaining = 524288 - Buffer.byteLength(JSON.stringify(value))
  for (const row of rows) {
    const count = Math.min(remaining, 4096)
    row.cells.text = 'x'.repeat(count)
    remaining -= count
  }
  expect(remaining).toBe(0)
  expect(Buffer.byteLength(JSON.stringify(value))).toBe(524288)
  expect(() => validateReportingMessage(value)).not.toThrow()
  rows.find((row) => row.cells.text.length < 4096)!.cells.text += 'x'
  expect(() => validateReportingMessage(value)).toThrow('512 KiB')
  for (const number of [1e20, -1e20, 2 ** 53, NaN, Infinity, -Infinity]) {
    expect(() =>
      validateReportingMessage({
        kind: 'view',
        id: 'x',
        title: 'X',
        summary: 'X',
        sections: [{ blocks: [{ kind: 'facts', items: [{ label: 'N', value: number }] }] }],
      }),
    ).toThrow(TypeError)
  }
})
