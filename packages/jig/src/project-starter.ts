const contractSchema = 'https://flow.jig.md/schemas/invocation-contract-0.schema.json'

function json(value: unknown): string {
  return JSON.stringify(value, null, 2) + '\n'
}

const greetingContract = json({
  $schema: contractSchema,
  id: 'https://jig.md/contracts/starter/greeting',
  version: '1.0.0',
  input: { type: 'string' },
  result: {
    type: 'object',
    properties: {
      outcome: { const: 'done' },
      output: {
        type: 'object',
        properties: { message: { type: 'string' } },
        required: ['message'],
        additionalProperties: false,
      },
    },
    required: ['outcome', 'output'],
    additionalProperties: false,
  },
})

const groupContract = json({
  $schema: contractSchema,
  input: { type: 'array', items: { type: 'string', maxLength: 80 }, minItems: 1, maxItems: 3 },
  result: {
    type: 'object',
    properties: {
      outcome: { const: 'done' },
      output: {
        type: 'object',
        properties: { messages: { type: 'array', items: { type: 'string' } } },
        required: ['messages'],
        additionalProperties: false,
      },
    },
    required: ['outcome', 'output'],
    additionalProperties: false,
  },
})

const welcomeGroup = `import { handle } from '@jigging/flow'

await handle(async run => {
  const names = run.input
  if (!Array.isArray(names)) throw new TypeError('Supply an array of names.')

  const messages: string[] = []
  for (const [index, name] of names.entries()) {
    const greeting = await run.call({
      operationId: 'greeting-' + index,
      slot: 'greeting',
      intent: 'Create one welcome message',
      input: name,
    })
    const output = greeting.output
    if (greeting.outcome !== 'done' || !output || typeof output !== 'object' ||
        Array.isArray(output) || !('message' in output) || typeof output.message !== 'string') {
      throw new TypeError('The greeting returned an unexpected result.')
    }
    messages.push(output.message)
  }
  return { outcome: 'done', output: { messages } }
})
`

const wiringTest = `import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import test from 'node:test'

const project = new URL('../', import.meta.url)

test('each group uses its configured greeter', async t => {
  const cases = [
    {
      target: 'binding:brief-welcome-group',
      greeter: 'flow:flows/brief-hello',
      messages: ['Hi, Ada.', 'Hi, Grace.'],
    },
    {
      target: 'binding:welcome-group',
      greeter: 'flow:flows/hello',
      messages: ['Welcome, Ada!', 'Welcome, Grace!'],
    },
  ]
  for (const { target, greeter, messages } of cases) {
    await t.test(target, subtest => {
      const args = ['run', target, '--input', '@fixtures/group.json', '--timeout', '45s', '--json', '--record-calls']
      const stdout = execFileSync('jig', args, {
        cwd: project,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'inherit'],
      })
      const result = JSON.parse(stdout)
      assert.equal(result.status, 'succeeded')
      assert.equal(result.outcome, 'done')
      assert.deepEqual(result.output, { messages })
      const evidence = result.callEvidence
      assert.equal(evidence?.coverage, 'complete', 'Expected complete call evidence')
      assert.equal(evidence.runId, result.runId)
      assert.deepEqual(
        evidence.calls.map(call => [call.caller, call.slot, call.target, call.state, call.outcome]),
        messages.map(() => [target, 'greeting', greeter, 'returned', 'done']),
        'Expected exact greeter calls',
      )
      subtest.diagnostic('Approved revision ' + evidence.revision)
    })
  }
})
`

const readme = [
  '# Scoped greetings',
  '',
  'Both group Bindings use the same caller Flow. Each selects its greeter through the',
  '`greeting` slot. The test covers both routes with a shared input.',
  '',
  'Use this Jig installation on a supported host and Node.js 22 or newer for the test.',
  'From the project directory:',
  '',
  '```sh',
  'jig check',
  'jig review --allow-resolution-network',
  '```',
  '',
  'Inspect the source and approve its exact revision before testing.',
  'The flag permits package resolution before approval.',
  'See [dependency preparation](https://jig.md/build/dependencies#fresh-resolution-and-network-access).',
  '',
  '```sh',
  'node --test test/wiring.test.mjs',
  '```',
  '',
  'Both cases should pass. The test checks execution, outcome, messages, and exact',
  'call destinations. It names the approved revision it ran.',
  'You can also open `jig explore` and load `fixtures/group.json` for either group.',
  '',
  '## Change one route',
  '',
  'Select `flow:flows/hello` in `bindings/brief-welcome-group.ts`.',
  'Update only the brief case in the test to expect the standard greeter and messages.',
  'Run `jig check --diff` and look for the change to the brief Binding’s `greeting` slot.',
  'Review and approve the changed revision before running the same test.',
  'The standard case should still pass with its original destination and messages.',
  '',
  'See [Test a scoped route](https://jig.md/build/compose#test-a-scoped-route) for an',
  'exercise that detects a wrong target even when the messages stay identical.',
  '',
].join('\n')

function binding(greeter: string): string {
  return [
    "import { defineBinding } from '@jigging/jig'",
    '',
    'export default defineBinding({',
    "  package: 'flows/welcome-group',",
    `  slots: { greeting: 'flow:flows/${greeter}' },`,
    '})',
    '',
  ].join('\n')
}

export function scopedGreetingFiles(
  sdkVersion: string,
  guide: (name: string) => string,
): readonly (readonly [string, string])[] {
  const manifest = json({ private: true, dependencies: { '@jigging/flow': sdkVersion } })
  return [
    ['README.md', readme],
    ['fixtures/group.json', '["Ada", "Grace"]\n'],
    ['bindings/welcome-group.ts', binding('hello')],
    ['bindings/brief-welcome-group.ts', binding('brief-hello')],
    ['test/wiring.test.mjs', wiringTest],
    ['flows/welcome-group/AGENTS.md', guide('welcome-group')],
    ['flows/welcome-group/package.json', manifest],
    [
      'flows/welcome-group/FLOW.meta.json',
      json({
        name: 'welcome-group',
        description: 'Welcome a group through a configured greeter.',
        uses: { greeting: { contract: './contracts/greeting.json' } },
      }),
    ],
    ['flows/welcome-group/FLOW.ts', welcomeGroup],
    ['flows/welcome-group/FLOW.contract.json', groupContract],
    ['flows/welcome-group/contracts/greeting.json', greetingContract],
    ...[
      { name: 'hello', description: 'Welcome one person.', prefix: 'Welcome, ', suffix: '!' },
      {
        name: 'brief-hello',
        description: 'Greet one person briefly.',
        prefix: 'Hi, ',
        suffix: '.',
      },
    ].flatMap(({ name, description, prefix, suffix }) => [
      [`flows/${name}/AGENTS.md`, guide(name)] as const,
      [`flows/${name}/package.json`, manifest] as const,
      [`flows/${name}/FLOW.meta.json`, json({ name, description })] as const,
      [`flows/${name}/FLOW.contract.json`, greetingContract] as const,
      [
        `flows/${name}/FLOW.ts`,
        `import { handle } from '@jigging/flow'

await handle(run => ({
  outcome: 'done',
  output: { message: ${JSON.stringify(prefix)} + run.input + ${JSON.stringify(suffix)} },
}))
`,
      ] as const,
    ]),
  ]
}
