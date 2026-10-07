import { expect, test } from 'bun:test'
import { validateUserUpdate } from '@jigging/user-updates'
import { checksView, jobsView, patchesView, type PreparedJob } from '../flows/factory/dashboard.ts'
import { input } from './fixture.ts'

test('Jobs retains a short complete goal and explicitly references the original request file', () => {
  const prepared = [{ job: { id: 'logs', directory: 'log-report', method: 'p1' }, input }]
  const view = validateUserUpdate({
    kind: 'view',
    id: 'jobs',
    title: 'Jobs',
    ...jobsView(prepared, new Map(), {}, new Set()),
  }) as any
  const row = view.sections[0].blocks[1].rows[0]
  expect(row.details[0]).toEqual({
    kind: 'report',
    text: `Requested goal: ${input.issue}`,
    references: [{ kind: 'artifact', attachment: 'deliverables', path: 'logs/goal.txt' }],
  })
  expect(row.details[1].items.find((v: any) => v.label === 'Editable files').value).toBe(
    input.editPaths.join(', '),
  )
  expect(row.details[2].text).toContain(input.cases[0]!.id)
  expect(view.landing).toBeUndefined()
  expect(row.cells.call).toEqual({ kind: 'call', operationId: 'repair:logs' })
})

test('maximum legal goals, scope and escaped reports stay inside every complete view item', () => {
  for (const issue of ['G' + '\u0001'.repeat(7999), 'G' + 'x'.repeat(7999), '😀'.repeat(2000)]) {
    const prepared: PreparedJob[] = ['first', 'second'].map((id) => ({
      job: { id, directory: 'd'.repeat(256), label: 'L'.repeat(80), method: 'p2' },
      input: {
        ...input,
        issue,
        editPaths: Array.from({ length: 8 }, (_, n) => `src/${n}${'a'.repeat(248)}.ts`),
        cases: Array.from({ length: 8 }, (_, n) => ({
          ...input.cases[0]!,
          id: String(n) + '\u0001'.repeat(63),
        })),
      },
    }))
    const stages = new Map(
      prepared.map(({ job }) => [
        job.id,
        { phase: 'check', attempt: 2, maximum: 2, detail: '\u0001'.repeat(4096) },
      ]),
    )
    const outcomes = Object.fromEntries(
      prepared.map(({ job }) => [job.id, { status: 'failed', message: '\u0001'.repeat(8000) }]),
    )
    const reports = new Map(prepared.map(({ job }) => [job.id, '\u0001'.repeat(4096)]))
    const views = [
      jobsView(prepared, stages, outcomes, new Set()),
      checksView(prepared, reports, outcomes),
      patchesView(prepared, outcomes),
    ]
    for (const [index, view] of views.entries()) {
      const item = validateUserUpdate({
        kind: 'view',
        id: String(index),
        title: 'Maximum input',
        ...view,
      })
      expect(Buffer.byteLength(JSON.stringify(item))).toBeLessThanOrEqual(32768)
    }
    const details = (views[0]!.sections[0]!.blocks[1] as any).rows[0].details
    expect(details[0].text).toContain(
      '[excerpt; complete goal in supplied job input and files/first/goal.txt after packet delivery]',
    )
    expect(details[0].references[0].path).toBe('first/goal.txt')
    expect(prepared[0]!.input.issue).toBe(issue)
    expect(details[1].items.find((v: any) => v.label === 'Editable files').value).toBe(
      prepared[0]!.input.editPaths.join(', '),
    )
  }
})

test('initial patch view explicitly reports no checked candidates without claiming delivered files', () => {
  const view = patchesView([{ job: { id: 'logs', directory: 'log-report' }, input }], {})
  validateUserUpdate({ kind: 'view', id: 'patches', title: 'Patches', ...view })
  expect(view.summary).toContain('0 independently checked candidates')
  expect(view.summary).toContain('after verified packet delivery')
  expect((view.sections[0]!.blocks[0] as any).rows).toEqual([])
  expect((view.sections[0]!.blocks[1] as any).text).toContain('only if Jig confirms its delivery')
  expect(JSON.stringify(view)).not.toContain('Saved job summaries')
})

test('long captured safe path lists disclose excerpts without violating a fact or item bound', () => {
  const editPaths = Array.from(
    { length: 8 },
    (_, index) => `src/${('d'.repeat(50) + '/').repeat(14)}${index}${'f'.repeat(45)}.ts`,
  )
  expect(editPaths.every((path) => path.split('/').length === 16)).toBe(true)
  expect(editPaths.join(', ').length).toBeGreaterThan(4096)
  const prepared = [
    { job: { id: 'logs', directory: 'log-report' }, input: { ...input, editPaths } },
  ]
  const view = jobsView(prepared, new Map(), {}, new Set())
  const item = validateUserUpdate({ kind: 'view', id: 'jobs', title: 'Jobs', ...view }) as any
  const facts = item.sections[0].blocks[1].rows[0].details[1].items
  expect(facts.find((v: any) => v.label === 'Editable files').value).toContain(
    '[excerpt; complete paths in supplied job input and retained job evidence]',
  )
  expect(facts.find((v: any) => v.label === 'Checkpoint').value).toBe('Not acknowledged')
  expect(prepared[0]!.input.editPaths).toEqual(editPaths)
  expect(Buffer.byteLength(JSON.stringify(item))).toBeLessThanOrEqual(32768)
})
