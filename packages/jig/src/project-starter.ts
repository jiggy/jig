import { SCHEMA_1_URI } from './schema/types.js'

const contractSchema = 'https://flow.jig.md/schemas/invocation-contract-0.schema.json'

const text = { type: 'string', minLength: 1 }
const object = (properties: Record<string, object>, required = Object.keys(properties)) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
})
const submission = object({ title: text, summary: text, source: text }, ['title', 'summary'])
const issues = { type: 'array', items: text }
const assessment = {
  $schema: contractSchema,
  id: 'https://jig.md/contracts/starter/publication-assessment',
  version: '1.0.0',
  outcomes: { blocked: 'Editorial requirements are missing.' },
  input: submission,
  result: object({
    outcome: { enum: ['done', 'blocked'] },
    output: object({ issues }),
  }),
}

const prepare = `import { handle } from '@jigging/flow'

await handle(async run => {
  const submission = run.input as { title: string }
  const assessment = await run.call({
    operationId: 'assess', slot: 'assess', intent: 'Check editorial requirements', input: run.input,
  })
  if (assessment.outcome === 'done') return { outcome: 'done', output: run.input }
  if (assessment.outcome !== 'blocked') throw new Error('Assessment did not settle')

  const { issues } = assessment.output as { issues: string[] }
  const brief = await run.call({
    operationId: 'review', slot: 'review', intent: 'Prepare an editorial handoff',
    input: { title: submission.title, issues },
  })
  if (brief.outcome !== 'done') throw new Error('Review brief did not settle')
  return { outcome: 'needs-review', output: brief.output }
})
`

const assess = `import { handle } from '@jigging/flow'

await handle(run => {
  const { summary, source } = run.input as { summary: string; source?: string }
  const settings = run.settings as { requireSource: boolean }
  const issues: string[] = []
  if (summary.trim().length < 30) issues.push('Expand the summary before publication')
  if (settings.requireSource && !source?.trim()) issues.push('Add a source for the claim')
  return { outcome: issues.length ? 'blocked' : 'done', output: { issues } }
})
`

const review = `import { handle } from '@jigging/flow'

await handle(run => {
  const { title, issues } = run.input as { title: string; issues: string[] }
  return { outcome: 'done', output: { title, queue: 'editorial', nextActions: issues } }
})
`

const routeTest = `import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

const project = new URL('../', import.meta.url)
const title = 'Weekend library hours'
const summary = 'The library will open on Saturday mornings from next month.'
const reviewOutput = { title, queue: 'editorial', nextActions: ['Add a source for the claim'] }

const cases = [
  {
    name: 'public submission without a source goes to editorial review',
    target: 'binding:public', fixture: 'unattributed', policy: 'binding:public-policy',
    outcome: 'needs-review', output: reviewOutput,
  },
  {
    name: 'internal bulletin accepts the same submission',
    target: 'binding:internal', fixture: 'unattributed', policy: 'binding:internal-policy',
    outcome: 'done', output: { title, summary },
  },
  {
    name: 'attributed public submission is ready',
    target: 'binding:public', fixture: 'attributed', policy: 'binding:public-policy',
    outcome: 'done', output: { title, summary, source: 'Library board meeting minutes' },
  },
]

function jig(args) {
  return JSON.parse(execFileSync('jig', args, { cwd: project, encoding: 'utf8' }))
}

for (const { name, target, fixture, policy, outcome, output } of cases) {
  test(name, t => {
    const temporary = mkdtempSync(join(tmpdir(), 'jig-publication-test-'))
    const packet = join(temporary, 'result')
    const needsReview = outcome === 'needs-review'
    try {
      const result = jig([
        'run', target, '--input', '@test/fixtures/' + fixture + '.json',
        '--timeout', '45s', '--out', packet, '--record-calls', '--json',
      ])
      assert.equal(result.status, 'succeeded')
      assert.equal(result.outcome, outcome)
      assert.deepEqual(result.output, output)

      const evidence = jig(['inspect', '--result', packet, '--calls', '--json'])
      assert.equal(evidence.coverage, 'complete')
      assert.equal(evidence.runId, result.runId)
      const expected = [[target, 'assess', policy, 'returned', needsReview ? 'blocked' : 'done']]
      if (needsReview) expected.push([target, 'review', 'flow:flows/review', 'returned', 'done'])
      assert.deepEqual(
        evidence.calls.map(call => [call.caller, call.slot, call.target, call.state, call.outcome]),
        expected,
      )
    } catch (error) {
      t.diagnostic('Run evidence directory ' + temporary)
      throw error
    }
    rmSync(temporary, { recursive: true, force: true })
  })
}
`

const readme = [
  '# Publication review',
  '',
  'Prepare submissions for a public newsletter or an internal bulletin.',
  'Both routes assess editorial requirements. Public submissions need a source.',
  'When requirements are missing, the workflow prepares a brief for an editor.',
  'The Run returns the draft or brief for a person to act on.',
  '',
  'Use installed Jig on a supported host and Node.js 22 or later.',
  '',
  '```sh',
  'jig check',
  'jig review --allow-resolution-network',
  '```',
  '',
  'Inspect the source and approve the exact revision before running the tests.',
  'The flag permits dependency resolution before approval.',
  'See [dependency preparation](https://jig.md/build/dependencies#fresh-resolution-and-network-access).',
  '',
  '```sh',
  'node --test test/publication.test.mjs',
  '```',
  '',
  'The suite runs both Bindings and verifies their exact calls from saved Run packets.',
  'Open `jig explore` and load `test/fixtures/unattributed.json` to compare',
  '`binding:public` and `binding:internal` with the same input.',
  '',
  '## Change one route',
  '',
  'Suppose the internal bulletin now also needs attribution.',
  'Find its assessment slot with `jig inspect --flow bindings/internal.ts`.',
  'Select `binding:public-policy` in that slot and update the internal test case.',
  'Use `jig check --diff` to verify the scoped change before asking for approval.',
  'After review, run the suite again. Both public cases should still pass.',
  '',
]

export function publicationReviewFiles(
  sdkVersion: string,
  guide: (name: string, purpose?: string) => string,
  skillsReadme: readonly string[],
): readonly (readonly [string, string])[] {
  const json = (value: unknown) => JSON.stringify(value, null, 2) + '\n'
  const manifest = json({ private: true, dependencies: { '@jigging/flow': sdkVersion } })
  const draft = {
    title: 'Weekend library hours',
    summary: 'The library will open on Saturday mornings from next month.',
  }
  const flows = [
    {
      name: 'prepare',
      description: 'Prepare a submission or hand its issues to editorial review.',
      source: prepare,
      uses: { assess: { contract: './contracts/assessment.json' }, review: {} },
      contract: {
        $schema: contractSchema,
        input: submission,
        outcomes: { 'needs-review': 'Editorial changes are needed.' },
      },
    },
    {
      name: 'assess',
      description: 'Check a submission against the selected editorial policy.',
      source: assess,
      contract: assessment,
    },
    {
      name: 'review',
      description: 'Turn editorial findings into a brief an editor can act on.',
      source: review,
      contract: { $schema: contractSchema, input: object({ title: text, issues }) },
    },
  ]
  const bindings = [
    [
      'public',
      {
        package: 'flows/prepare',
        slots: { assess: 'binding:public-policy', review: 'flow:flows/review' },
      },
    ],
    [
      'internal',
      {
        package: 'flows/prepare',
        slots: { assess: 'binding:internal-policy', review: 'flow:flows/review' },
      },
    ],
    ['public-policy', { package: 'flows/assess', settings: { requireSource: true } }],
    ['internal-policy', { package: 'flows/assess', settings: { requireSource: false } }],
  ] as const
  return [
    ['README.md', [...readme, ...skillsReadme].join('\n')],
    ['test/fixtures/unattributed.json', json(draft)],
    ['test/fixtures/attributed.json', json({ ...draft, source: 'Library board meeting minutes' })],
    ['test/publication.test.mjs', routeTest],
    [
      'test/AGENTS.md',
      '# Publication tests\n\nUse `node --test test/publication.test.mjs` after the operator approves the edited revision.\nKeep the fixtures reusable from Explorer. Cover the changed route and the routes that should stay intact.\nRequire complete saved call evidence before asserting that a path was unused.\n',
    ],
    ['flows/prepare/contracts/assessment.json', json(assessment)],
    [
      'flows/assess/settings.schema.json',
      json({
        $schema: SCHEMA_1_URI,
        ...object({ requireSource: { type: 'boolean' } }),
      }),
    ],
    ...flows.flatMap(({ name, description, source, uses, contract }) => [
      [`flows/${name}/AGENTS.md`, guide(name, description)] as const,
      [`flows/${name}/package.json`, manifest] as const,
      [`flows/${name}/FLOW.meta.json`, json({ name, description, uses })] as const,
      [`flows/${name}/FLOW.contract.json`, json(contract)] as const,
      [`flows/${name}/FLOW.ts`, source] as const,
    ]),
    ...bindings.map(
      ([name, options]) =>
        [
          `bindings/${name}.ts`,
          `import { defineBinding } from '@jigging/jig'\n\nexport default defineBinding(${json(options).trimEnd()})\n`,
        ] as const,
    ),
  ]
}
