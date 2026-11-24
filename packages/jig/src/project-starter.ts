const planRoster = `import { handle } from '@jigging/flow'

type Shift = { shift: string; available: string[] }

await handle(async run => {
  const shifts = run.input as Shift[]
  const assigned = new Map<string, number>()
  const roster: { shift: string; cook: string | null }[] = []

  for (const [index, { shift, available }] of shifts.entries()) {
    if (available.length === 0) {
      roster.push({ shift, cook: null })
      continue
    }

    const choice = await run.call({
      slot: 'choose-cook',
      operationId: \`shift-\${index + 1}\`,
      intent: \`Choose a cook for \${shift}\`,
      input: available.map(cook => ({ cook, assigned: assigned.get(cook) ?? 0 })),
    })
    if (choice.outcome !== 'done') throw new Error('Could not choose a cook')

    const { cook } = choice.output as { cook: string }
    if (!available.includes(cook)) throw new Error('The chosen cook is unavailable')
    assigned.set(cook, (assigned.get(cook) ?? 0) + 1)
    roster.push({ shift, cook })
  }

  const outcome = roster.some(({ cook }) => cook === null) ? 'needs-cover' : 'done'
  return { outcome, output: { roster } }
})
`

const chooseCook = `import { handle } from '@jigging/flow'

type Candidate = { cook: string; assigned: number }

await handle(({ input }) => {
  const candidates = input as Candidate[]
  const { cook } = candidates.reduce((best, next) => next.assigned < best.assigned ? next : best)
  return { outcome: 'done', output: { cook } }
})
`

const shiftTest = `import { $ } from 'bun'
import { expect, test } from 'bun:test'

async function runRoster(input: string, assigned: number) {
  const result = await $\`jig run binding:kitchen --input \${input} --record-calls --json\`
    .cwd(\`\${import.meta.dir}/..\`).quiet().json()
  expect(result.status).toBe('succeeded')
  expect(result.callEvidence.coverage).toBe('complete')
  expect(result.callEvidence.calls).toHaveLength(assigned)
  for (const call of result.callEvidence.calls) {
    expect(call).toMatchObject({
      caller: 'binding:kitchen',
      slot: 'choose-cook',
      target: 'flow:flows/choose-cook',
      state: 'returned',
      outcome: 'done',
    })
  }
  return result
}

test('Spreads four shifts across the available cooks', async () => {
  const result = await runRoster('@tests/fixtures/weekend.json', 4)
  expect(result.outcome).toBe('done')
  expect(result.output.roster).toEqual([
    { shift: 'Saturday breakfast', cook: 'Ada' },
    { shift: 'Saturday lunch', cook: 'Bea' },
    { shift: 'Sunday breakfast', cook: 'Cal' },
    { shift: 'Sunday lunch', cook: 'Ada' },
  ])
}, 60_000)

test('Leaves an unstaffed shift open and assigns the others', async () => {
  const result = await runRoster('@tests/fixtures/short-staffed.json', 3)
  expect(result.outcome).toBe('needs-cover')
  expect(result.output.roster).toEqual([
    { shift: 'Saturday breakfast', cook: 'Ada' },
    { shift: 'Saturday lunch', cook: null },
    { shift: 'Sunday breakfast', cook: 'Bea' },
    { shift: 'Sunday lunch', cook: 'Cal' },
  ])
}, 60_000)
`

const readme = [
  '# Kitchen shifts',
  '',
  'Build a weekend roster from the cooks available for each shift.',
  'Each shift goes to the available cook with the fewest assignments so far.',
  '',
  '## Try it',
  '',
  '```sh',
  'jig review --allow-resolution-network',
  '```',
  '',
  'Approve the project at the prompt. The flag allows Jig to resolve dependencies before approval.',
  '',
  '```sh',
  'jig run binding:kitchen --input @tests/fixtures/weekend.json',
  '```',
  '',
  '| Shift | Cook |',
  '| --- | --- |',
  '| Saturday breakfast | Ada |',
  '| Saturday lunch | Bea |',
  '| Sunday breakfast | Cal |',
  '| Sunday lunch | Ada |',
  '',
  'Try `tests/fixtures/short-staffed.json` in the same command or in `jig explore`.',
  'Saturday lunch stays open and the Run returns `needs-cover` with the rest of the roster.',
  '',
  '## Follow the decision',
  '',
  '[Plan roster](./flows/plan-roster/FLOW.ts) visits shifts in order and counts assignments.',
  'It calls [Choose cook](./flows/choose-cook/FLOW.ts) for each shift with an available cook.',
  'If two cooks have the same workload, the first listed for that shift gets it.',
  '[The kitchen Binding](./bindings/kitchen.ts) selects the chooser.',
  '',
  '## Test it',
  '',
  'With Bun on your PATH, run `bun test` after approval.',
  '[The tests](./tests/shifts.test.ts) check both rosters and the calls that produced them.',
  '',
]

export function kitchenShiftFiles(
  sdkVersion: string,
  guide: (name: string, purpose?: string) => string,
  skillsReadme: readonly string[],
): readonly (readonly [string, string])[] {
  const json = (value: unknown) => JSON.stringify(value, null, 2) + '\n'
  const manifest = json({ private: true, dependencies: { '@jigging/flow': sdkVersion } })
  const contractSchema = 'https://flow.jig.md/schemas/invocation-contract-0.schema.json'
  const text = { type: 'string', minLength: 1 }
  const object = (properties: Record<string, object>) => ({
    type: 'object', properties, required: Object.keys(properties), additionalProperties: false,
  })
  const chooser = {
    $schema: contractSchema,
    id: 'https://jig.md/contracts/starter/choose-cook',
    version: '1.0.0',
    input: {
      type: 'array', minItems: 1,
      items: object({ cook: text, assigned: { type: 'integer', minimum: 0 } }),
    },
    result: object({ outcome: { enum: ['done'] }, output: object({ cook: text }) }),
  }
  const flows = [
    {
      name: 'plan-roster',
      description: 'Assign available cooks across a weekend roster and list open shifts.',
      uses: { 'choose-cook': { contract: './contracts/choose-cook.json' } },
      source: planRoster,
      contract: {
        $schema: contractSchema,
        input: {
          type: 'array', minItems: 1,
          items: object({ shift: text, available: { type: 'array', items: text } }),
        },
        outcomes: { 'needs-cover': 'At least one shift has no available cook.' },
      },
    },
    {
      name: 'choose-cook',
      description: 'Choose the available cook with the fewest assignments.',
      source: chooseCook,
      contract: chooser,
    },
  ]
  const weekend = [
    { shift: 'Saturday breakfast', available: ['Ada', 'Bea'] },
    { shift: 'Saturday lunch', available: ['Ada', 'Bea'] },
    { shift: 'Sunday breakfast', available: ['Bea', 'Cal'] },
    { shift: 'Sunday lunch', available: ['Ada', 'Cal'] },
  ]
  const shortStaffed = weekend.map(slot =>
    slot.shift === 'Saturday lunch' ? { ...slot, available: [] } : slot,
  )
  return [
    ['README.md', [...readme, ...skillsReadme].join('\n')],
    ['tests/fixtures/weekend.json', json(weekend)],
    ['tests/fixtures/short-staffed.json', json(shortStaffed)],
    ['tests/shifts.test.ts', shiftTest],
    ['flows/plan-roster/contracts/choose-cook.json', json(chooser)],
    [
      'bindings/kitchen.ts',
      `import { defineBinding } from '@jigging/jig'

export default defineBinding({
  package: 'flows/plan-roster',
  slots: { 'choose-cook': 'flow:flows/choose-cook' },
})
`,
    ],
    ...flows.flatMap(({ name, description, source, uses, contract }) => [
      [`flows/${name}/AGENTS.md`, guide(name, description)] as const,
      [`flows/${name}/package.json`, manifest] as const,
      [`flows/${name}/FLOW.meta.json`, json({ name, description, uses })] as const,
      [`flows/${name}/FLOW.contract.json`, json(contract)] as const,
      [`flows/${name}/FLOW.ts`, source] as const,
    ]),
  ]
}
