import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assertResponseSchema, prepareAgent } from '@jigging/agent-method'
import type { Attachment, JsonValue, RunContext } from '@jigging/flow'
import { REPORTING_CONTRACT, validateReportingMessage, withReporting } from '@jigging/reporting'
import { runMethod as checkRosterFlow } from '../flows/check-roster/method.ts'
import { checkRoster } from '../flows/check-roster/policy.ts'
import { type RosterRow, rosterCsv } from '../flows/export-roster/csv.ts'
import { runMethod as exportRoster } from '../flows/export-roster/method.ts'
import { runMethod as proposeRoster } from '../flows/propose-roster/method.ts'
import responseSchema from '../flows/propose-roster/proposal.schema.json'
import { runMethod as readRoster } from '../flows/read-roster/method.ts'
import { readScenario } from '../flows/read-roster/scenario.ts'
import { runMethod as createRoster } from '../flows/roster/method.ts'

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

test('accepted rows derive names and times from the source, with stable chronological order', () => {
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

test('soft preferences do not override hard rules or reject a valid nonpreferred roster', () => {
  const preferences = clone(scenario)
  preferences.volunteers[0].preference = 'Prefer late shifts, despite being available early.'
  expect(checkRoster(preferences, proposal)).toHaveLength(8)
})

test('review decisions are explicit and cannot conceal partial assignments', async () => {
  expect(
    await checkRosterFlow({
      signal: signal(),
      input: {
        scenario,
        proposal: { status: 'review', assignments: [], reason: 'Cannot cover all roles.' },
      },
    }),
  ).toEqual({ outcome: 'blocked', output: { reason: 'Cannot cover all roles.' } })
  expect(() =>
    checkRoster(scenario, {
      status: 'review',
      reason: 'Partial',
      assignments: proposal.assignments,
    }),
  ).toThrow(/no provisional/)
})

test('the checker preserves a review reason at the Unicode scalar limit', async () => {
  const reason = '😀'.repeat(240)
  const result = await checkRosterFlow({
    signal: signal(),
    input: { scenario, proposal: { status: 'review', assignments: [], reason } },
  })
  expect(result).toEqual({ outcome: 'blocked', output: { reason } })
  expect(() =>
    checkRoster(scenario, { status: 'review', assignments: [], reason: reason + 'x' }),
  ).toThrow(/bounded reason/)
})

test('scenario identity, intervals and safe exported names are checked at the reading boundary', () => {
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

test('Agent blocked and limit responses are propagated without another call', async () => {
  for (const outcome of ['blocked', 'limit'] as const) {
    let calls = 0
    const result = await proposeRoster({
      input: { scenario },
      signal: signal(),
      call: async (request) => {
        calls++
        expect(request.slot).toBe('agent')
        assertResponseSchema(
          (request.input as { responseSchema: typeof responseSchema }).responseSchema,
        )
        return { outcome, output: { text: 'Unable to finish.' } }
      },
    })
    expect(result).toEqual({ outcome, output: { reason: 'Unable to finish.' } })
    expect(calls).toBe(1)
  }
})

for (const outcome of ['blocked', 'limit'] as const) {
  test(`Agent ${outcome} explanations are trimmed and clipped on Unicode scalar boundaries`, async () => {
    for (const [text, reason] of [
      ['  Unable to finish.\n', 'Unable to finish.'],
      ['a'.repeat(240), 'a'.repeat(240)],
      ['a'.repeat(300), 'a'.repeat(239) + '…'],
      ['😀'.repeat(240), '😀'.repeat(240)],
      ['😀'.repeat(241), '😀'.repeat(239) + '…'],
    ]) {
      let calls = 0
      const result = await proposeRoster({
        input: { scenario },
        signal: signal(),
        call: async () => {
          calls++
          return { outcome, output: { text: text! } }
        },
      })
      expect(result).toEqual({ outcome, output: { reason } })
      expect(Array.from((result.output as { reason: string }).reason).length).toBeLessThanOrEqual(
        240,
      )
      expect(calls).toBe(1)
    }
  })

  test(`Agent ${outcome} explanations reject missing or empty text`, async () => {
    for (const text of [undefined, null, '', ' \n\t ']) {
      await expect(
        proposeRoster({
          input: { scenario },
          signal: signal(),
          call: async () => ({ outcome, output: text === undefined ? {} : { text } }),
        }),
      ).rejects.toThrow('The Agent omitted a reason for stopping.')
    }
  })
}

async function composedFixture(
  assertion: (
    run: Pick<RunContext, 'input' | 'attachments' | 'signal' | 'call'>,
    folder: string,
    calls: string[],
    controller: AbortController,
  ) => Promise<void>,
  agentProposal: JsonValue = proposal,
  sourceFolder = source,
) {
  const root = await mkdtemp(join(tmpdir(), 'kitchen-roster-'))
  const output = join(root, 'output')
  await mkdir(output)
  const controller = new AbortController()
  const calls: string[] = []
  const run = {
    input: {},
    signal: controller.signal,
    attachments: {
      source: { path: sourceFolder, access: 'read' },
      files: { path: output, access: 'read-write' },
    } as Record<string, Attachment>,
    call: (async (request) => {
      calls.push(request.slot)
      if (request.slot === 'read-roster')
        return readRoster({ attachments: { source: run.attachments.source! }, signal: run.signal })
      if (request.slot === 'propose-roster')
        return proposeRoster({
          input: request.input,
          signal: run.signal,
          call: async () => ({ outcome: 'done', output: { structured: agentProposal } }),
        })
      if (request.slot === 'check-roster')
        return checkRosterFlow({ input: request.input, signal: run.signal })
      expect(request.slot).toBe('export-roster')
      // Execute the real leaf and model visibility after await. Native mapping is
      // separately established by an admitted Run, not this application substitute.
      const childOutput = join(root, 'child-output')
      await mkdir(childOutput)
      const result = await exportRoster({
        input: request.input,
        signal: run.signal,
        attachments: { files: { path: childOutput, access: 'read-write' } },
      })
      await rename(childOutput, join(output, 'schedule'))
      return result
    }) as RunContext['call'],
  }
  try {
    await assertion(run, output, calls, controller)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

for (const outcome of ['blocked', 'limit'] as const) {
  test(`the coordinator preserves a clipped Unicode Agent ${outcome} explanation`, async () => {
    await composedFixture(async (run, folder, calls) => {
      const result = await createRoster({
        ...run,
        call: async (request) => {
          if (request.slot !== 'propose-roster') return run.call(request)
          return proposeRoster({
            input: request.input,
            signal: run.signal,
            call: async () => ({ outcome, output: { text: '😀'.repeat(300) } }),
          })
        },
      })
      expect(result).toEqual({ outcome, output: { reason: '😀'.repeat(239) + '…' } })
      expect(calls).toEqual(['read-roster'])
      expect(await readdir(folder)).toEqual([])
    })
  })
}

test('five composed Flows deliver eight checked assignments and preserve the source', async () => {
  const original = await readFile(join(source, 'scenario.json'))
  await composedFixture(async (run, folder, calls) => {
    const result = await createRoster(run)
    expect(result.outcome).toBe('done')
    expect(result.output).toMatchObject({
      status: 'ready',
      count: 8,
      roster: 'schedule/roster.csv',
    })
    expect(calls).toEqual(['read-roster', 'propose-roster', 'check-roster', 'export-roster'])
    expect(await readFile(join(folder, 'schedule/roster.csv'), 'utf8')).toBe(
      rosterCsv(checkRoster(scenario, proposal) as RosterRow[]),
    )
    expect(await readFile(join(source, 'scenario.json'))).toEqual(original)
  })
})

test('an absence proposal never calls the exporter or writes a roster', async () => {
  const absent = clone(proposal)
  absent.assignments[0]!.volunteerId = 'sam'
  await composedFixture(async (run, folder, calls) => {
    expect(await createRoster(run)).toEqual({
      outcome: 'blocked',
      output: { reason: 'Sam is unavailable for shift-1.' },
    })
    expect(calls).not.toContain('export-roster')
    expect(await readdir(folder)).toEqual([])
  }, absent)
})

test('an impossible Saturday stops before an Agent call or file export', async () => {
  await composedFixture(
    async (run, folder, calls) => {
      expect(await createRoster(run)).toEqual({
        outcome: 'blocked',
        output: { reason: 'No qualified, available volunteer can cover shift-4 as cook.' },
      })
      expect(calls).toEqual(['read-roster'])
      expect(await readdir(folder)).toEqual([])
    },
    proposal,
    join(import.meta.dir, '../fixtures/impossible'),
  )
})

test('cancellation after proposal settlement prevents checking and file writes', async () => {
  await composedFixture(async (run, folder, calls, controller) => {
    const originalCall = run.call
    run.call = async (request) => {
      const result = await originalCall(request)
      if (request.slot === 'propose-roster') controller.abort()
      return result
    }
    await expect(createRoster(run)).rejects.toThrow()
    expect(calls).toEqual(['read-roster', 'propose-roster'])
    expect(await readdir(folder)).toEqual([])
  })
})

test('the exporter refuses formula fields before writing and never overwrites an existing CSV', async () => {
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
    await writeFile(join(root, 'roster.csv'), 'existing')
    await expect(exportRoster(run)).rejects.toThrow()
    expect(await readFile(join(root, 'roster.csv'), 'utf8')).toBe('existing')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('every Flow publishes valid optional domain views through the public reporting helper', async () => {
  await composedFixture(async (run) => {
    const sent: unknown[] = []
    const report = async (body: Parameters<typeof withReporting>[2]) =>
      withReporting(
        {
          signal: run.signal,
          channels: {
            progress: {
              direction: 'send',
              contract: REPORTING_CONTRACT,
              delivery: 'broadcast',
              send: async (message) => {
                sent.push(message)
              },
              close: async () => {},
            },
          },
        },
        'progress',
        body,
      )
    run.call = async (request) => {
      if (request.slot === 'read-roster') return report((updates) => readRoster(run, updates))
      if (request.slot === 'propose-roster')
        return report((updates) =>
          proposeRoster(
            {
              input: request.input,
              signal: run.signal,
              call: async () => ({ outcome: 'done', output: { structured: proposal } }),
            },
            updates,
          ),
        )
      if (request.slot === 'check-roster')
        return report((updates) =>
          checkRosterFlow({ input: request.input, signal: run.signal }, updates),
        )
      return report(async (updates) => {
        // The original call performs the independently owned file import model.
        // Exercise the exporter view separately with its real output boundary.
        const root = await mkdtemp(join(tmpdir(), 'kitchen-view-export-'))
        try {
          return await exportRoster(
            {
              input: request.input,
              signal: run.signal,
              attachments: { files: { path: root, access: 'read-write' } },
            },
            updates,
          )
        } finally {
          await rm(root, { recursive: true, force: true })
        }
      })
    }
    await report((updates) => createRoster(run, updates))
    expect(sent.length).toBeGreaterThan(5)
    for (const message of sent) validateReportingMessage(message)
    // Descriptor validation above checks shape; all five distinct titles must be present.
    const encoded = JSON.stringify(sent)
    for (const title of [
      'Saturday kitchen',
      'Kitchen availability',
      'Kitchen proposal',
      'Roster checks',
      'Roster export',
    ]) {
      expect(encoded).toContain(title)
    }
  })
})

test('actual stopped results are declared by each independent Flow contract', async () => {
  const declared = async (flow: string, result: { outcome: string }) => {
    const contract = JSON.parse(
      await readFile(join(import.meta.dir, '..', 'flows', flow, 'FLOW.contract.json'), 'utf8'),
    )
    expect(typeof contract.outcomes?.[result.outcome]).toBe('string')
  }
  await composedFixture(
    async (run) => {
      await declared('roster', await createRoster(run))
      await declared('read-roster', await readRoster(run))
    },
    proposal,
    join(import.meta.dir, '../fixtures/impossible'),
  )
  await declared(
    'check-roster',
    await checkRosterFlow({
      input: { scenario, proposal: { status: 'review', assignments: [], reason: 'Needs review.' } },
      signal: signal(),
    }),
  )
  for (const outcome of ['blocked', 'limit'] as const) {
    await declared(
      'propose-roster',
      await proposeRoster({
        input: { scenario },
        signal: signal(),
        call: async () => ({ outcome, output: { text: 'Unable to finish.' } }),
      }),
    )
  }
})

async function reportedRoster(run: Parameters<typeof createRoster>[0]) {
  const views: ReturnType<typeof validateReportingMessage>[] = []
  const result = await withReporting(
    {
      signal: run.signal,
      channels: {
        progress: {
          direction: 'send',
          contract: REPORTING_CONTRACT,
          send: async (message) => {
            views.push(validateReportingMessage(message))
          },
          close: async () => {},
        },
      },
    },
    'progress',
    (updates) => createRoster(run, updates),
  )
  return { result, views: views.filter((item) => item.kind === 'view') }
}

test('the main application page follows every stage and reveals assignments only after acceptance', async () => {
  await composedFixture(async (run) => {
    const { views } = await reportedRoster(run)
    expect(views).toHaveLength(5)
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
    expect(JSON.stringify(views[3])).not.toContain('schedule/roster.csv')
    expect(JSON.stringify(views[4])).toContain('schedule/roster.csv')
    expect(JSON.stringify(views[4])).toContain('Jig confirms delivery separately')
  })
})

test('a rejected proposal leaves a cohesive blocked page without accepted assignments or export', async () => {
  const invalid = clone(proposal)
  invalid.assignments[0]!.volunteerId = 'sam'
  await composedFixture(async (run, folder) => {
    const { result, views } = await reportedRoster(run)
    expect(result.outcome).toBe('blocked')
    const last = JSON.stringify(views.at(-1))
    expect(last).toContain('Sam is unavailable for shift-1.')
    expect(last).toContain('No assignments accepted')
    expect(last).not.toContain('Both roles checked')
    expect(last).not.toContain('schedule/roster.csv')
    expect(await readdir(folder)).toEqual([])
  }, invalid)
})

test('an export failure preserves checked assignments without claiming that a CSV was never written', async () => {
  await composedFixture(async (run, folder) => {
    const sent: ReturnType<typeof validateReportingMessage>[] = []
    const originalCall = run.call
    run.call = async (request) => {
      const result = await originalCall(request)
      if (request.slot === 'export-roster') throw new Error('private I/O detail')
      return result
    }
    await expect(
      withReporting(
        {
          signal: run.signal,
          channels: {
            progress: {
              direction: 'send',
              contract: REPORTING_CONTRACT,
              send: async (message) => {
                sent.push(validateReportingMessage(message))
              },
              close: async () => {},
            },
          },
        },
        'progress',
        (updates) => createRoster(run, updates),
      ),
    ).rejects.toThrow('private I/O detail')
    const last = JSON.stringify(sent.filter((item) => item.kind === 'view').at(-1))
    expect(last).toContain('8 of 8 roles checked')
    expect(last).toContain('Unconfirmed; inspect the run result')
    expect(last).not.toContain('private I/O detail')
    expect(await readFile(join(folder, 'schedule/roster.csv'), 'utf8')).toStartWith(
      'shift,start,end,role,volunteer_id,volunteer\n',
    )
  })
})
