import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { AuthoringError, compileContract, getToolchain, stampSource } from '../dist/index.js'

const drafter = await readFile(new URL('./fixtures/drafter.tsp', import.meta.url), 'utf8')
const source = await stampSource(drafter, { types: true })
const full = await compileContract(source)
const descriptor = JSON.parse(full.artifacts['FLOW.contract.json'])
test('generated data preserves the full original drafter constraints and Agent schema', async () => {
  const original = JSON.parse(
    await readFile(new URL('./fixtures/original-contract.json', import.meta.url), 'utf8'),
  )
  const agent = JSON.parse(
    await readFile(new URL('./fixtures/original-agent.schema.json', import.meta.url), 'utf8'),
  )
  function expanded(value) {
    if (Array.isArray(value)) return value.map(expanded)
    if (value && typeof value === 'object') {
      if (value.$ref) return expanded(descriptor.$defs[value.$ref.slice('#/$defs/'.length)])
      return Object.fromEntries(
        Object.entries(value)
          .filter(([k]) => k !== '$defs')
          .map(([k, v]) => [k, expanded(v)]),
      )
    }
    return value
  }
  assert.deepEqual(expanded(descriptor), original)
  assert.deepEqual(JSON.parse(full.artifacts['proposal.schema.json']), agent)
})
const compile = async (body, types = true) => compileContract(await stampSource(body, { types }))
const simple = (fields, extra = '', options = '') => `
import "@jigging/flow-authoring/typespec";
using FLOW;
@invocation(Input, Result${options})
namespace Example;
@closed model Input { ${fields} }
${extra}
@closed model Result { outcome: "done"; output: Input; }
`

async function rejects(body, code, message) {
  await assert.rejects(compile(body), (error) => {
    assert(error instanceof AuthoringError)
    assert.equal(error.diagnostic.code, code)
    if (message) assert.match(error.message, message)
    return true
  })
}

test('full drafter compiles deterministically, preserving authored source and meaningful types', async () => {
  assert.equal(full.source, source)
  assert.deepEqual((await compileContract(source)).artifacts, full.artifacts)
  assert.equal(full.authoring.digest, (await getToolchain()).digest)
  assert.deepEqual(Object.keys(full.artifacts), [
    'FLOW.contract.json',
    'proposal.schema.json',
    'FLOW.contract.d.ts',
  ])
  assert.equal(descriptor.input.$ref, '#/$defs/Input')
  assert.equal(descriptor.result.$ref, '#/$defs/Result')
  assert.deepEqual(descriptor.$defs.Input.required, ['request', 'previous', 'feedback'])
  assert.deepEqual(descriptor.$defs.Input.properties.previous.anyOf, [
    { $ref: '#/$defs/Proposal' },
    { type: 'null' },
  ])
  assert.match(full.artifacts['FLOW.contract.d.ts'], /export type FlowResult = Result/)
})

test('an explicitly reused Section edit reaches validation, Agent projection and types', async () => {
  const changed = drafter
    .replace('requirementId: string;', 'requirementKey: string;')
    .replace('limitations: string[];', 'limitations: string[];\n  @maxItems(2) audit: Section[];')
  const result = await compile(changed)
  const contract = JSON.parse(result.artifacts['FLOW.contract.json'])
  const agent = JSON.parse(result.artifacts['proposal.schema.json'])
  assert(contract.$defs.Section.properties.requirementKey)
  assert(!contract.$defs.Section.properties.requirementId)
  for (const name of ['sections', 'audit']) {
    assert(agent.properties[name].items.properties.requirementKey)
    assert(!agent.properties[name].items.properties.requirementId)
  }
  assert.match(result.artifacts['FLOW.contract.d.ts'], /"requirementKey": string/)
  assert.doesNotMatch(result.artifacts['proposal.schema.json'], /"\$ref"|"\$defs"/)
})

test('Agent-incompatible optional fields fail with the field and output identified', async () => {
  const changed = drafter.replace('title: string;', 'title: string;\n  subtitle?: string;')
  await assert.rejects(compile(changed), (error) => {
    assert.equal(error.diagnostic.code, 'AGENT_SCHEMA_UNSUPPORTED')
    assert.equal(error.diagnostic.output, 'proposal.schema.json')
    assert.match(error.message, /subtitle/)
    assert.equal(changed.split('\n')[error.diagnostic.line - 2].trim(), 'subtitle?: string;')
    assert.equal('artifacts' in error, false)
    return true
  })
})

test('Agent-incompatible bounds are not stripped', async () => {
  await rejects(
    drafter.replace('title: string;', '@maxLength(100) title: string;'),
    'AGENT_SCHEMA_UNSUPPORTED',
    /constraint/,
  )
})

test('optional fields, nullability, numeric bounds and negative zero remain distinct', async () => {
  const result = await compile(
    simple('maybe?: string; nil: string | null; @minValue(-2) @maxValue(3) n: integer; zero: -0;'),
  )
  const input = JSON.parse(result.artifacts['FLOW.contract.json']).$defs.Input
  assert.deepEqual(input.required, ['nil', 'n', 'zero'])
  assert.deepEqual(input.properties.n, { type: 'integer', minimum: -2, maximum: 3 })
  assert.equal(input.properties.zero.const, 0)
})

test('Agent literals, nullable strings/integers and arrays have exact projections', async () => {
  const result = await compile(
    simple(
      'v: string;',
      `
@closed @agentResponse("./answer.schema.json")
model Answer { state: "yes" | "no"; text: string | null; count: integer | null; @maxItems(2) records: string[]; }
`,
    ),
  )
  const agent = JSON.parse(result.artifacts['answer.schema.json'])
  assert.deepEqual(agent.properties.state, { enum: ['yes', 'no'], type: 'string' })
  assert.deepEqual(agent.properties.text.type, ['string', 'null'])
  assert.deepEqual(agent.properties.count.type, ['integer', 'null'])
})

test('types are optional; comments affect source but not emitted contract meaning', async () => {
  const result = await compile('// ordinary comment\n' + drafter, false)
  assert.equal(result.artifacts['FLOW.contract.d.ts'], undefined)
  assert.equal(result.artifacts['FLOW.contract.json'], full.artifacts['FLOW.contract.json'])
})

for (const [name, body, code, message] of [
  ['external import', 'import "./other.tsp";\n' + drafter, 'SOURCE_UNSUPPORTED', /bundled/],
  [
    'remote import',
    'import "https://example.com/x.tsp";\n' + drafter,
    'SOURCE_UNSUPPORTED',
    /bundled/,
  ],
  ['JS extension', 'import "./steal.js";\n' + drafter, 'SOURCE_UNSUPPORTED', /bundled/],
  ['directive', '#suppress "anything" "ignored"\n' + drafter, 'SOURCE_UNSUPPORTED', /directives/],
  [
    'unqualified decorator',
    drafter.replace('@closed', '@withOptionalProperties'),
    'SOURCE_UNSUPPORTED',
    /decorator/,
  ],
  [
    'duplicate decorator',
    drafter.replace('@closed', '@closed @closed'),
    'SOURCE_INVALID',
    /Duplicate/,
  ],
  ['unsupported default', simple('v: string = "x";'), 'SOURCE_UNSUPPORTED', /Defaults/],
  ['unsupported numeric primitive', simple('v: int64;'), 'SOURCE_UNSUPPORTED', /Scalar/],
  ['unsafe integer literal', simple('v: 9007199254740992;'), 'SOURCE_UNSUPPORTED', /JSON\/1/],
  [
    'recursive graph',
    simple('v: Loop;', '@closed model Loop { next: Loop; }'),
    'SOURCE_UNSUPPORTED',
    /Recursive/,
  ],
  ['template application', simple('v: Record<string>;'), 'SOURCE_UNSUPPORTED', /Template/],
  [
    'open object',
    drafter.replace('@closed\nmodel Input', 'model Input'),
    'SOURCE_UNSUPPORTED',
    /closed/,
  ],
  [
    'output traversal',
    drafter.replace('./proposal.schema.json', '../escape.schema.json'),
    'SOURCE_UNSUPPORTED',
    /root/,
  ],
  [
    'invalid outcome',
    simple('v: string;', '', ', #{outcomes: #{done: "bad"}}'),
    'SOURCE_INVALID',
    /Outcomes/,
  ],
  [
    'unknown invocation option',
    simple('v: string;', '', ', #{settings: #{}}'),
    'SOURCE_UNSUPPORTED',
    /outcomes/,
  ],
  [
    'duplicate projection',
    simple(
      'v: string;',
      '@closed @agentResponse("./x.schema.json") model A { a:string; } @closed @agentResponse("./x.schema.json") model B { b:string; }',
    ),
    'SOURCE_INVALID',
    /same output/,
  ],
  [
    'unsupported Agent boolean',
    simple('v:string;', '@closed @agentResponse("./x.schema.json") model A { a:boolean; }'),
    'AGENT_SCHEMA_UNSUPPORTED',
    /type/,
  ],
  [
    'unsupported Agent array bound',
    drafter.replace('@maxItems(16) sections', '@maxItems(257) sections'),
    'AGENT_SCHEMA_UNSUPPORTED',
    /maxItems/,
  ],
])
  test(name, async () => rejects(body, code, message))

test('the compiler cannot read unrelated ambient configuration or files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'flow-authoring-ambient-'))
  const cwd = process.cwd()
  try {
    await writeFile(join(dir, 'tspconfig.yaml'), 'emit:\n  - ./steal.js\n')
    await writeFile(join(dir, 'steal.js'), 'throw new Error("MUST NOT EXECUTE");')
    process.chdir(dir)
    assert.deepEqual((await compileContract(source)).artifacts, full.artifacts)
  } finally {
    process.chdir(cwd)
    await rm(dir, { recursive: true, force: true })
  }
})

test('headers cannot silently select another toolchain or hide duplicate JSON keys', async () => {
  await assert.rejects(compileContract(drafter), (e) => e.diagnostic.code === 'SOURCE_HEADER')
  await assert.rejects(
    compileContract(source.replace('"types":true', '"types":false,"types":true')),
    (e) => e.diagnostic.code === 'SOURCE_HEADER',
  )
  await assert.rejects(
    compileContract(source.replace('sha256:', 'sha512:')),
    (e) => e.diagnostic.code === 'SOURCE_HEADER',
  )
})

test('unsupported source cannot hide in a second namespace or a generated type keyword', async () => {
  await rejects(
    drafter + '\nnamespace TypeSpec { model Hidden {} }',
    'SOURCE_UNSUPPORTED',
    /namespace/,
  )
  await rejects(
    simple('v: `class`;', '@closed model `class` { value: string; }'),
    'SOURCE_UNSUPPORTED',
    /definition name/,
  )
})

test('names and output paths must match completely, including the final character', async () => {
  await rejects(
    simple('v:string;', '', ', #{outcomes: #{`blocked\\n`:"bad"}}'),
    'SOURCE_INVALID',
    /Outcomes/,
  )
  await rejects(
    drafter.replace('./proposal.schema.json', './proposal.schema.json\\n'),
    'SOURCE_UNSUPPORTED',
    /root/,
  )
})

test('oversized and malformed-Unicode input fails before compilation', async () => {
  await assert.rejects(
    stampSource('x'.repeat(65537), { types: true }),
    (e) => e.diagnostic.code === 'VALUE_LIMIT',
  )
  await assert.rejects(
    stampSource('\ud800', { types: true }),
    (e) => e.diagnostic.code === 'VALUE_INVALID',
  )
})

test('cancellation before and during compilation settles the worker without artifacts', async () => {
  const early = AbortSignal.abort()
  await assert.rejects(
    compileContract(source, { signal: early }),
    (e) => e.diagnostic.code === 'CANCELLED',
  )
  const controller = new AbortController()
  const pending = compileContract(source, { signal: controller.signal })
  setTimeout(() => controller.abort(), 5)
  await assert.rejects(pending, (e) => e.diagnostic.code === 'CANCELLED')
  assert.deepEqual((await compileContract(source)).artifacts, full.artifacts)
})

test('deadline exhaustion does not return a partial artifact batch', async () => {
  await assert.rejects(
    compileContract(source, { timeoutMs: 1 }),
    (e) => e.diagnostic.code === 'COMPILER_LIMIT',
  )
})

test('generated types guide ordinary implementation and expose invalid results and stale field use', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'flow-authoring-types-'))
  const tsc = fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url))
  try {
    await mkdir(join(dir, 'empty-types'))
    await writeFile(join(dir, 'FLOW.contract.d.ts'), full.artifacts['FLOW.contract.d.ts'])
    const code = `import type { Input, Proposal, Section, Result } from "./FLOW.contract.js";
export function complete(input: Input, proposal: Proposal): Result {
  const section: Section | undefined = proposal.sections[0];
  if (section) section.requirementId.toUpperCase();
  return input.previous === null ? {outcome:"done",output:proposal} :
    {outcome:"blocked",output:{reason:"already drafted"}};
}`
    await writeFile(join(dir, 'consumer.mts'), code)
    const args = [
      tsc,
      '--strict',
      '--noEmit',
      '--target',
      'ES2022',
      '--module',
      'NodeNext',
      '--moduleResolution',
      'NodeNext',
      '--typeRoots',
      join(dir, 'empty-types'),
      join(dir, 'consumer.mts'),
    ]
    execFileSync(process.execPath, args, { env: {}, cwd: dir, timeout: 15000 })
    await writeFile(
      join(dir, 'consumer.mts'),
      code.replace('{outcome:"done",output:proposal}', '{outcome:"blocked",output:proposal}'),
    )
    const bad = spawnSync(process.execPath, args, {
      env: {},
      cwd: dir,
      encoding: 'utf8',
      timeout: 15000,
    })
    assert.ok(typeof bad.status === 'number' && bad.status > 0)
    assert.match(bad.stdout, /reason/)
    await writeFile(join(dir, 'consumer.mts'), code)
    const changed = await compile(
      drafter.replace('requirementId: string;', 'requirementKey: string;'),
    )
    await writeFile(join(dir, 'FLOW.contract.d.ts'), changed.artifacts['FLOW.contract.d.ts'])
    const stale = spawnSync(process.execPath, args, {
      env: {},
      cwd: dir,
      encoding: 'utf8',
      timeout: 15000,
    })
    assert.ok(typeof stale.status === 'number' && stale.status > 0)
    assert.match(stale.stdout, /requirementId/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
