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
    operationId: 'assess',
    slot: 'assess',
    intent: 'Check editorial requirements',
    input: run.input,
  })

  if (assessment.outcome === 'done') {
    return { outcome: 'done', output: run.input }
  }
  if (assessment.outcome !== 'blocked') {
    throw new Error('Assessment did not return an editorial decision')
  }

  const { issues } = assessment.output as { issues: string[] }
  const brief = await run.call({
    operationId: 'review',
    slot: 'review',
    intent: 'Prepare an editorial handoff',
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
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'bun:test'

const project = join(import.meta.dir, '..')

test('The newsletter asks for a source', () => {
  checkSubmission({
    target: 'binding:public',
    fixture: 'unattributed',
    policy: 'binding:public-policy',
    nextActions: ['Add a source for the claim'],
  })
}, 60_000)

test('The internal bulletin accepts the same draft', () => {
  checkSubmission({
    target: 'binding:internal',
    fixture: 'unattributed',
    policy: 'binding:internal-policy',
  })
}, 60_000)

test('The newsletter accepts a draft with a source', () => {
  checkSubmission({
    target: 'binding:public',
    fixture: 'attributed',
    policy: 'binding:public-policy',
  })
}, 60_000)

function checkSubmission({ target, fixture, policy, nextActions }) {
  const path = 'test/fixtures/' + fixture + '.json'
  const draft = JSON.parse(readFileSync(join(project, path), 'utf8'))
  const temporary = mkdtempSync(join(tmpdir(), 'jig-publication-test-'))
  const packet = join(temporary, 'result')
  const needsReview = nextActions !== undefined

  try {
    const result = jig([
      'run', target,
      '--input', '@' + path,
      '--out', packet,
      '--timeout', '45s',
      '--record-calls',
      '--json',
    ])
    assert.equal(result.status, 'succeeded')
    assert.equal(result.outcome, needsReview ? 'needs-review' : 'done')
    assert.deepEqual(result.output, needsReview
      ? { title: draft.title, queue: 'editorial', nextActions }
      : draft)

    const evidence = jig(['inspect', '--result', packet, '--calls', '--json'])
    assert.equal(evidence.coverage, 'complete')
    assert.equal(evidence.runId, result.runId)

    const calls = evidence.calls.map(({ caller, slot, target, state, outcome }) => ({
      caller, slot, target, state, outcome,
    }))
    const expected = [{
      caller: target,
      slot: 'assess',
      target: policy,
      state: 'returned',
      outcome: needsReview ? 'blocked' : 'done',
    }]
    if (needsReview) {
      expected.push({
        caller: target,
        slot: 'review',
        target: 'flow:flows/review',
        state: 'returned',
        outcome: 'done',
      })
    }
    assert.deepEqual(calls, expected)
  } catch (error) {
    console.error('Run evidence directory: ' + temporary)
    throw error
  }
  rmSync(temporary, { recursive: true, force: true })
}

function jig(args) {
  const result = Bun.spawnSync(['jig', ...args], { cwd: project })
  assert.equal(result.exitCode, 0, result.stderr.toString())
  return JSON.parse(result.stdout.toString())
}
`

const readme = [
  '# Publication review',
  '',
  'Try the same draft in two places. The public newsletter asks an editor for a',
  'source. The internal bulletin accepts the draft as written.',
  '',
  '## Try it',
  '',
  '```sh',
  'jig review --allow-resolution-network',
  '```',
  '',
  'Approve the revision at the prompt. The flag permits dependency resolution before approval.',
  '',
  '```sh',
  'jig run binding:public --input @test/fixtures/unattributed.json',
  'jig run binding:internal --input @test/fixtures/unattributed.json',
  '```',
  '',
  'The first Run returns `needs-review` with “Add a source for the claim.”',
  'The second returns `done` with the draft. You can also load the fixture in `jig explore`.',
  '',
  '## Follow the decision',
  '',
  '- [Public](./bindings/public.ts) and [internal](./bindings/internal.ts) select the policy for each route.',
  '- [Assess](./flows/assess/FLOW.ts) applies the selected policy to the draft.',
  '- [Prepare](./flows/prepare/FLOW.ts) sends drafts with findings to [editorial review](./flows/review/FLOW.ts).',
  '',
  '## Test the routes',
  '',
  'With Bun on your PATH, run the examples as tests.',
  '',
  '```sh',
  'bun test',
  '```',
  '',
  'The tests verify the outcome and the exact Flows called in each Run.',
  '',
  '## Change one rule',
  '',
  '1. Set `assess` to `binding:public-policy` in [bindings/internal.ts](./bindings/internal.ts).',
  '2. In [publication.test.mjs](./test/publication.test.mjs), update the internal case to expect that policy and the same editorial action as the first case.',
  '3. Run `jig check --diff`, review the edit, and run `bun test` after approval.',
  '',
  'The internal bulletin now requires a source. Both public cases should still pass.',
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
      '# Publication tests\n\nUse `bun test` after the operator approves the edited revision.\nKeep the fixtures reusable from Explorer. Cover the changed route and the routes that should stay intact.\nRequire complete saved call evidence before asserting that a path was unused.\n',
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
