const staffShift = `import { handle } from '@jigging/flow'

await handle(async run => {
  const { shift, cooks } = run.input as { shift: string; cooks: string[] }
  const [cook] = cooks

  if (cook) return { outcome: 'done', output: { shift, cook } }

  const request = await run.call({
    slot: 'cover',
    operationId: 'cover',
    intent: 'Ask for a cook to cover the shift',
    input: shift,
  })
  if (request.outcome !== 'done') throw new Error('Could not prepare a cover request')

  return { outcome: 'needs-cover', output: request.output }
})
`

const requestCover = `import { handle } from '@jigging/flow'

await handle(({ input }) => ({
  outcome: 'done',
  output: { message: \`Find a cook for \${input}.\` },
}))
`

const shiftTest = `import { $ } from 'bun'
import { expect, test } from 'bun:test'

const project = \`\${import.meta.dir}/..\`

function runShift(input: string) {
  return $\`jig run binding:kitchen --input \${input} --record-calls --json\`.cwd(project).quiet().json()
}

test('A staffed shift assigns a cook', async () => {
  const result = await runShift('@tests/fixtures/staffed.json')
  expect(result).toMatchObject({
    status: 'succeeded',
    outcome: 'done',
    output: { shift: 'Saturday breakfast', cook: 'Ada' },
    callEvidence: { coverage: 'complete' },
  })
  expect(result.callEvidence.calls).toEqual([])
}, 60_000)

test('A shift without a cook asks for cover', async () => {
  const result = await runShift('@tests/fixtures/short-staffed.json')
  expect(result).toMatchObject({
    status: 'succeeded',
    outcome: 'needs-cover',
    output: { message: 'Find a cook for Saturday breakfast.' },
    callEvidence: { coverage: 'complete' },
  })
  expect(result.callEvidence.calls).toMatchObject([{
    caller: 'binding:kitchen',
    slot: 'cover',
    target: 'flow:flows/request-cover',
    state: 'returned',
    outcome: 'done',
  }])
}, 60_000)
`

const readme = [
  '# Kitchen shifts',
  '',
  'Assign a cook to a kitchen shift. If nobody is available, prepare a request for cover.',
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
  'jig run binding:kitchen --input @tests/fixtures/staffed.json',
  'jig run binding:kitchen --input @tests/fixtures/short-staffed.json',
  '```',
  '',
  'The first shift gets Ada as its cook. The second returns `needs-cover` with a message.',
  'Load either JSON fixture in `jig explore` to see the calls.',
  '',
  '## Follow the decision',
  '',
  '[Staff shift](./flows/staff-shift/FLOW.ts) assigns the first available cook or calls',
  '[Request cover](./flows/request-cover/FLOW.ts). [The kitchen Binding](./bindings/kitchen.ts)',
  'selects which Flow handles the cover request.',
  '',
  '## Test it',
  '',
  'With Bun on your PATH, run `bun test` after approval.',
  '[The tests](./tests/shifts.test.ts) check the shift result and whether Jig called for cover.',
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
  const flows = [
    {
      name: 'staff-shift',
      description: 'Assign a cook or ask for cover.',
      uses: { cover: {} },
      source: staffShift,
      contract: {
        $schema: contractSchema,
        input: {
          type: 'object',
          properties: { shift: text, cooks: { type: 'array', items: text } },
          required: ['shift', 'cooks'],
          additionalProperties: false,
        },
        outcomes: { 'needs-cover': 'No cook was available for the shift.' },
      },
    },
    {
      name: 'request-cover',
      description: 'Draft a cover request for a shift.',
      source: requestCover,
      contract: { $schema: contractSchema, input: text },
    },
  ]
  return [
    ['README.md', [...readme, ...skillsReadme].join('\n')],
    ['tests/fixtures/staffed.json', json({ shift: 'Saturday breakfast', cooks: ['Ada'] })],
    ['tests/fixtures/short-staffed.json', json({ shift: 'Saturday breakfast', cooks: [] })],
    ['tests/shifts.test.ts', shiftTest],
    [
      'bindings/kitchen.ts',
      `import { defineBinding } from '@jigging/jig'

export default defineBinding({
  package: 'flows/staff-shift',
  slots: { cover: 'flow:flows/request-cover' },
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
