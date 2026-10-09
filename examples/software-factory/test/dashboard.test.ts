import { expect, test } from 'bun:test'
import { validateUserUpdate } from '@jigging/user-updates'
import { checksView, jobsView, type PreparedJob, patchesView } from '../flows/factory/dashboard.ts'
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
  expect(row.cells.patch).toBeNull()
  expect(row.cells.checks).toBe('Verification pending')
  expect(row.details.at(-1).references).toEqual([{ kind: 'call', operationId: 'repair:logs' }])
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
    const accepted = Object.fromEntries(
      prepared.map(({ job, input }) => [
        job.id,
        {
          status: 'settled',
          ready: true,
          verification: {
            proposal: 2,
            changedPaths: input.editPaths,
            acceptanceCases: input.cases.map((entry) => entry.id),
          },
        },
      ]),
    )
    const reports = new Map(prepared.map(({ job }) => [job.id, '\u0001'.repeat(4096)]))
    const views = [
      jobsView(prepared, stages, outcomes, new Set()),
      checksView(prepared, reports, outcomes),
      patchesView(prepared, outcomes),
      jobsView(prepared, stages, accepted, new Set()),
      checksView(prepared, reports, accepted),
      patchesView(prepared, accepted),
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
  expect(view.summary).toContain('requires verified packet delivery')
  expect((view.sections[0]!.blocks[0] as any).rows).toEqual([])
  expect((view.sections[0]!.blocks[1] as any).text).toContain('only if Jig confirms its delivery')
  expect(JSON.stringify(view)).not.toContain('Saved job summaries')
})

test('settled views expose verified work and review actions only for the accepted repair', () => {
  const prepared = ['logs', 'failed'].map((id) => ({
    job: { id, label: id === 'logs' ? 'HTTP log report' : 'Stopped repair', directory: id },
    input,
  }))
  const outcomes = {
    logs: {
      status: 'settled',
      ready: true,
      verification: {
        proposal: 2,
        changedPaths: input.editPaths,
        acceptanceCases: input.cases.map((entry) => entry.id),
      },
    },
    failed: {
      status: 'failed',
      code: 'UNCERTAIN',
      message:
        'Could not start the selected AI session. Inspect the selected client configuration.',
    },
  }
  const jobs = validateUserUpdate({
    kind: 'view',
    id: 'jobs',
    title: 'Jobs',
    ...jobsView(prepared, new Map(), outcomes, new Set(['logs', 'failed'])),
  }) as any
  const rows = jobs.sections[0].blocks[1].rows
  expect(rows[0].cells).toMatchObject({
    action: 'Ready for review',
    checks: 'Tests + 4/4 cases passed',
    patch: { kind: 'artifact', attachment: 'deliverables', path: 'logs/review.patch' },
  })
  const verified = rows[0].details.flatMap((detail: any) => detail.items ?? [])
  expect(verified).toContainEqual({ label: 'Checked proposal', value: 2 })
  expect(verified).toContainEqual({ label: 'Changed files', value: input.editPaths.join(', ') })
  expect(rows[0].details.at(-1).text).toContain('Original sources are unchanged')
  expect(rows[1].cells.patch).toBeNull()
  expect(rows[1].cells.action).toBe('Settlement unknown')
  expect(rows[1].cells.checks).toBe('No accepted patch')
  expect(JSON.stringify(rows[1].details)).toContain(outcomes.failed.message)
  expect(JSON.stringify(rows[1].details)).not.toContain('review.patch')
  const patches = validateUserUpdate({
    kind: 'view',
    id: 'patches',
    title: 'Patches',
    ...patchesView(prepared, outcomes),
  }) as any
  expect(patches.sections[0].blocks[0].rows.map((row: any) => row.id)).toEqual(['logs'])
  expect(patches.sections[0].blocks[0].rows[0].details[0].text).toBe(
    `Requested goal: ${input.issue}`,
  )
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
  expect(facts.find((v: any) => v.label === 'Saved evidence').value).toBe(
    'Checkpoint not confirmed',
  )
  expect(prepared[0]!.input.editPaths).toEqual(editPaths)
  expect(Buffer.byteLength(JSON.stringify(item))).toBeLessThanOrEqual(32768)
})

test('a passing worker report stays provisional after independent evidence validation fails', () => {
  const prepared = [{ job: { id: 'logs', directory: 'log-report' }, input }]
  const report = 'Repository test command passed. Independent acceptance cases: 4/4 passed.'
  const view = validateUserUpdate({
    kind: 'view',
    id: 'checks',
    title: 'Checks',
    ...checksView(prepared, new Map([['logs', report]]), {
      logs: {
        status: 'failed',
        message: 'Returned evidence could not be independently validated.',
      },
    }),
  }) as any
  const row = view.sections[0].blocks[0].rows[0]
  expect(row.cells.repository).toBe('Unavailable')
  expect(row.cells.cases).toBe('No accepted patch')
  expect(view.summary).toContain('provisional worker reports')
  expect(row.details.at(-1).text).toContain(
    'Worker-reported checks (provisional; independent acceptance is shown separately):',
  )
  expect(row.details.at(-1).text).toContain(report)
  expect(JSON.stringify(row.details)).not.toContain('Passed; independently verified')
})

test('standalone repair and generic router publish ordinary bounded views without dispatch claims', async () => {
  const { repairView, checksView: repairChecks } = await import('../flows/repair/dashboard.ts')
  const { selectionView } = await import('../flows/router/dashboard.ts')
  const { routingInput } = await import('../flows/router/decision.ts')
  for (const view of [repairView(input), repairChecks()])
    validateUserUpdate({ kind: 'view', id: 'standalone', title: 'Standalone', ...view })
  const request = routingInput({
    task: 'Choose a suitable prose method. ' + '\u0001'.repeat(1024),
    candidates: Array.from({ length: 16 }, (_, index) => ({
      id: `method-${index}`,
      description: '\u0001'.repeat(192),
    })),
  })
  const item = validateUserUpdate({
    kind: 'view',
    id: 'selection',
    title: 'Selection',
    ...selectionView(request, {
      outcome: 'done',
      output: { candidateId: null, reason: 'No suitable method.' },
    }),
  }) as any
  expect(item.sections[0].blocks[1].rows).toHaveLength(8)
  expect(item.sections[0].blocks[1].total).toBe(16)
  expect(item.summary).toContain('No fallback or dispatch')
  expect(item.sections[0].blocks[1].rows[0].details[0].text.length).toBeGreaterThan(
    item.sections[0].blocks[1].rows[0].cells.description.length,
  )
})
