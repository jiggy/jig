import { expect, test } from 'bun:test'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assertResponseSchema, prepareAgent } from '@jigging/agent-method'
import { validateReportingMessage } from '@jigging/reporting'
import { runMethod as checkRosterFlow } from '../flows/check-roster/method.ts'
import { checkRoster } from '../flows/check-roster/policy.ts'
import { type RosterRow, rosterCsv } from '../flows/export-roster/csv.ts'
import { runMethod as exportRoster } from '../flows/export-roster/method.ts'
import { interpretProposal } from '../flows/propose-roster/method.ts'
import responseSchema from '../flows/propose-roster/proposal.schema.json'
import { runMethod as readRoster } from '../flows/read-roster/method.ts'
import { readScenario } from '../flows/read-roster/scenario.ts'
import { rosterView, rosterViewOptions } from '../flows/roster/view.ts'

const source = join(import.meta.dir, '../fixtures/feasible')
const scenario = JSON.parse(await readFile(join(source, 'scenario.json'), 'utf8'))
const proposal = {
  status: 'proposed',
  reason: '',
  assignments: [
    { shiftId: 'shift-1', role: 'cook', volunteerId: 'alex' },
    { shiftId: 'shift-1', role: 'serve', volunteerId: 'bea' },
    { shiftId: 'shift-2', role: 'cook', volunteerId: 'alex' },
    { shiftId: 'shift-2', role: 'serve', volunteerId: 'bea' },
    { shiftId: 'shift-3', role: 'cook', volunteerId: 'casey' },
    { shiftId: 'shift-3', role: 'serve', volunteerId: 'drew' },
    { shiftId: 'shift-4', role: 'cook', volunteerId: 'casey' },
    { shiftId: 'shift-4', role: 'serve', volunteerId: 'drew' },
  ],
}
const signal = () => new AbortController().signal
const clone = <T>(value: T): T => structuredClone(value)

test('the ordinary Agent validator accepts the actual response shape', () => {
  assertResponseSchema(responseSchema)
  expect(
    prepareAgent({ instructions: 'Suggest a roster.', responseSchema }).request.responseSchema,
  ).toEqual(responseSchema)
})

test('all five Flows carry the exact licensed reporting agreement', async () => {
  const descriptor = await readFile(
    new URL(import.meta.resolve('@jigging/reporting/reporting.json')),
  )
  const license = await readFile(new URL(import.meta.resolve('@jigging/reporting/LICENSE')))
  for (const flow of ['roster', 'read-roster', 'propose-roster', 'check-roster', 'export-roster']) {
    const root = join(import.meta.dir, '..', 'flows', flow, 'contracts/reporting')
    expect(await readFile(join(root, 'reporting.json'))).toEqual(descriptor)
    expect(await readFile(join(root, 'LICENSE'))).toEqual(license)
  }
})

test('accepted rows derive names and times from source in chronological order', () => {
  const rows = checkRoster(scenario, {
    ...proposal,
    assignments: [...proposal.assignments].reverse(),
  }) as RosterRow[]
  expect(rows).toHaveLength(8)
  expect(rows[0]).toEqual({
    shiftId: 'shift-1',
    from: 540,
    until: 600,
    role: 'cook',
    volunteerId: 'alex',
    name: 'Alex',
  })
  expect(rosterCsv(rows)).toStartWith(
    'shift,start,end,role,volunteer_id,volunteer\nshift-1,09:00,10:00,cook,alex,Alex\n',
  )
})

const invalidProposals = [
  [
    'absence',
    (value: typeof proposal) => {
      value.assignments[0]!.volunteerId = 'sam'
    },
    /unavailable/,
  ],
  [
    'qualification',
    (value: typeof proposal) => {
      value.assignments[0]!.volunteerId = 'bea'
    },
    /not qualified/,
  ],
  [
    'unknown volunteer',
    (value: typeof proposal) => {
      value.assignments[0]!.volunteerId = 'unknown'
    },
    /known/,
  ],
  [
    'unknown shift',
    (value: typeof proposal) => {
      value.assignments[0]!.shiftId = 'unknown'
    },
    /known/,
  ],
  [
    'duplicate coverage',
    (value: typeof proposal) => {
      value.assignments[1] = value.assignments[0]!
    },
    /more than once/,
  ],
  [
    'missing role',
    (value: typeof proposal) => {
      value.assignments.pop()
    },
    /eight assignments/,
  ],
  [
    'extra assignment',
    (value: typeof proposal) => {
      value.assignments.push(value.assignments[0]!)
    },
    /eight assignments/,
  ],
  [
    'unknown role',
    (value: typeof proposal) => {
      value.assignments[0]!.role = 'drive'
    },
    /cook or serve/,
  ],
] as const
for (const [name, change, message] of invalidProposals) {
  test(`reject ${name} in the complete proposal`, () => {
    const value = clone(proposal)
    change(value)
    expect(() => checkRoster(scenario, value)).toThrow(message)
  })
}

test('aggregate workload and overlapping work are checked independently', () => {
  const excessive = clone(scenario)
  excessive.volunteers[0].maxMinutes = 60
  expect(() => checkRoster(excessive, proposal)).toThrow(/workload/)
  const overlapping = clone(scenario)
  overlapping.shifts[1].from = 570
  expect(() => checkRoster(overlapping, proposal)).toThrow(/overlapping/)
})

test('the real checker returns the violated absence rule as a blocked result', async () => {
  const absent = clone(proposal)
  absent.assignments[0]!.volunteerId = 'sam'
  expect(
    await checkRosterFlow({
      signal: signal(),
      input: { scenario, proposal: absent },
    }),
  ).toEqual({
    outcome: 'blocked',
    output: { reason: 'Sam is unavailable for shift-1.' },
  })
})

test('soft preferences cannot override hard rules or reject valid nonpreferred work', () => {
  const preferences = clone(scenario)
  preferences.volunteers[0].preference = 'Prefer late shifts, despite being available early.'
  expect(checkRoster(preferences, proposal)).toHaveLength(8)
})

test('review decisions are explicit, bounded and cannot conceal partial assignments', async () => {
  for (const reason of ['Cannot cover all roles.', '😀'.repeat(240)]) {
    expect(
      await checkRosterFlow({
        signal: signal(),
        input: { scenario, proposal: { status: 'review', assignments: [], reason } },
      }),
    ).toEqual({ outcome: 'blocked', output: { reason } })
  }
  expect(() =>
    checkRoster(scenario, {
      status: 'review',
      reason: 'Partial',
      assignments: proposal.assignments,
    }),
  ).toThrow(/no provisional/)
  expect(() =>
    checkRoster(scenario, {
      status: 'review',
      assignments: [],
      reason: '😀'.repeat(240) + 'x',
    }),
  ).toThrow(/bounded reason/)
})

test('reading checks scenario identity, intervals, safe names and exact fields', () => {
  for (const change of [
    (value: typeof scenario) => {
      value.volunteers[1].id = value.volunteers[0].id
    },
    (value: typeof scenario) => {
      value.shifts[1].id = value.shifts[0].id
    },
    (value: typeof scenario) => {
      value.shifts[0].until = value.shifts[0].from
    },
    (value: typeof scenario) => {
      value.volunteers[0].name = '=FORMULA()'
    },
    (value: typeof scenario) => {
      value.volunteers[0].roles = ['cook', 'cook']
    },
    (value: typeof scenario) => {
      value.extra = true
    },
  ]) {
    const value = clone(scenario)
    change(value)
    expect(() => readScenario(value)).toThrow()
  }
})

// Ordinary response data establishes interpretation, not Agent or host execution.
for (const outcome of ['blocked', 'limit'] as const) {
  test(`Agent ${outcome} reasons are propagated, trimmed and scalar-bounded`, () => {
    for (const [text, reason] of [
      ['Unable to finish.', 'Unable to finish.'],
      ['  Unable to finish.\n', 'Unable to finish.'],
      ['a'.repeat(240), 'a'.repeat(240)],
      ['a'.repeat(300), 'a'.repeat(239) + '…'],
      ['😀'.repeat(240), '😀'.repeat(240)],
      ['😀'.repeat(241), '😀'.repeat(239) + '…'],
      ['😀'.repeat(300), '😀'.repeat(239) + '…'],
    ]) {
      const result = interpretProposal({ outcome, output: { text: text! } })
      expect(result).toEqual({ outcome, output: { reason } })
      expect(Array.from((result.output as { reason: string }).reason).length).toBeLessThanOrEqual(
        240,
      )
    }
  })
  test(`Agent ${outcome} reasons reject missing or empty text`, () => {
    for (const text of [undefined, null, '', ' \n\t ']) {
      expect(() =>
        interpretProposal({
          outcome,
          output: text === undefined ? {} : { text },
        }),
      ).toThrow('The Agent omitted a reason for stopping.')
    }
  })
}

test('real reader detects the uncovered Saturday and preserves feasible source', async () => {
  const original = await readFile(join(source, 'scenario.json'))
  const loaded = await readRoster({
    signal: signal(),
    attachments: { source: { path: source, access: 'read' } },
  })
  expect(loaded.outcome).toBe('done')
  expect(await readFile(join(source, 'scenario.json'))).toEqual(original)
  expect(
    await readRoster({
      signal: signal(),
      attachments: {
        source: { path: join(import.meta.dir, '../fixtures/impossible'), access: 'read' },
      },
    }),
  ).toEqual({
    outcome: 'blocked',
    output: { reason: 'No qualified, available volunteer can cover shift-4 as cook.' },
  })
})

test('real exporter writes checked rows, rejects formulas and never overwrites', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kitchen-export-'))
  const rows = checkRoster(scenario, proposal) as RosterRow[]
  const run = {
    input: { rows },
    signal: signal(),
    attachments: { files: { path: root, access: 'read-write' as const } },
  }
  try {
    const unsafe = clone(rows)
    unsafe[0]!.name = '=SUM(1,2)'
    await expect(exportRoster({ ...run, input: { rows: unsafe } })).rejects.toThrow(/safe CSV/)
    expect(await readdir(root)).toEqual([])
    await exportRoster(run)
    expect(await readFile(join(root, 'roster.csv'), 'utf8')).toBe(rosterCsv(rows))
    await writeFile(join(root, 'roster.csv'), 'existing')
    await expect(exportRoster(run)).rejects.toThrow()
    expect(await readFile(join(root, 'roster.csv'), 'utf8')).toBe('existing')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('pure root projection preserves stages, acceptance and uncertain delivery', () => {
  const rows = checkRoster(scenario, proposal) as RosterRow[]
  const phases = ['reading', 'proposing', 'checking', 'exporting', 'ready'] as const
  const views = phases.map((phase, index) =>
    rosterView({
      phase,
      scenario,
      ...(index >= 3 ? { assignments: rows } : {}),
    }),
  )
  expect(views.map((view) => view.sections[0]!.blocks[0])).toEqual([
    {
      kind: 'progress',
      label: 'Reading volunteer availability',
      completed: 0,
      total: 4,
      unit: 'stages',
    },
    {
      kind: 'progress',
      label: 'Considering volunteer preferences',
      completed: 1,
      total: 4,
      unit: 'stages',
    },
    {
      kind: 'progress',
      label: 'Checking all scheduling rules',
      completed: 2,
      total: 4,
      unit: 'stages',
    },
    {
      kind: 'progress',
      label: 'Preparing the roster CSV',
      completed: 3,
      total: 4,
      unit: 'stages',
    },
    { kind: 'progress', label: 'Roster prepared', completed: 4, total: 4, unit: 'stages' },
  ])
  expect(JSON.stringify(views[2])).toContain('Awaiting checked assignment')
  expect(JSON.stringify(views[2])).not.toContain('Both roles checked')
  expect(views[3]!.sections.slice(1, 5).map((section) => section.title)).toEqual([
    '09:00–10:00',
    '10:00–11:00',
    '11:00–12:00',
    '12:00–13:00',
  ])
  expect(JSON.stringify(views[3])).toContain('120 / 120 min')
  expect(JSON.stringify(views[3])).not.toContain('"attachment":"schedule"')
  expect(JSON.stringify(views[4])).toContain('"attachment":"schedule","path":"roster.csv"')
  expect(JSON.stringify(views[4])).toContain('Jig confirms delivery separately')
  const blocked = JSON.stringify(
    rosterView({
      phase: 'blocked',
      scenario,
      reason: 'Sam is unavailable for shift-1.',
    }),
  )
  expect(blocked).toContain('Sam is unavailable for shift-1.')
  expect(blocked).toContain('No assignments accepted')
  expect(blocked).not.toContain('Both roles checked')
  expect(blocked).not.toContain('"attachment":"schedule"')
  for (const phase of ['failed', 'cancelled'] as const) {
    const uncertain = JSON.stringify(rosterView({ phase, scenario, assignments: rows }))
    expect(uncertain).toContain('8 of 8 roles checked')
    expect(uncertain).toContain('Unconfirmed; inspect the run result')
    expect(uncertain).not.toContain('"attachment":"schedule"')
  }
})

test('independent contracts declare stopped outcomes and root artifact delivery', async () => {
  for (const flow of ['roster', 'read-roster', 'propose-roster', 'check-roster']) {
    const contract = JSON.parse(
      await readFile(join(import.meta.dir, '..', 'flows', flow, 'FLOW.contract.json'), 'utf8'),
    )
    expect(typeof contract.outcomes.blocked).toBe('string')
    if (flow === 'roster' || flow === 'propose-roster') {
      expect(typeof contract.outcomes.limit).toBe('string')
    }
    if (flow === 'roster') {
      expect(contract.attachments).toEqual({ source: 'read' })
      expect(contract.artifactResults).toEqual(['schedule'])
    }
  }
})

test('the captured scenario identifies the roster and captured CSV remains explicit', () => {
  const options = rosterViewOptions(scenario)
  expect(options.landing).toBe(true)
  expect(options.target?.definitionId).toBe('kitchen-roster')
  expect(options).toEqual(rosterViewOptions(clone(scenario)))
  const changed = clone(scenario)
  changed.volunteers[0]!.preference = 'Prefer the later shift.'
  expect(rosterViewOptions(changed).target?.instanceKey).not.toBe(options.target?.instanceKey)
  const ready = rosterView({
    phase: 'ready',
    scenario,
    assignments: checkRoster(scenario, proposal) as RosterRow[],
  })
  const item = validateReportingMessage({ kind: 'view', id: 'roster', ...options, ...ready })
  expect(JSON.stringify(item)).toContain('"kind":"content"')
  expect(JSON.stringify(rosterView({ phase: 'checking', scenario }))).not.toContain(
    '"kind":"content"',
  )
})
