import { beforeAll, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { assertResponseSchema } from '@jigging/agent-method'
import {
  type ParsedInvocationContract,
  parseInvocationContract,
} from '../src/invocation-contract.js'
import { type JsonObject, validateJson1 } from '../src/json.js'

// Consume the authoring package through its declared export in a separate Node
// process. Jig's validators receive only JSON; they do not import TypeSpec.
const source = `
import "@jigging/flow-authoring/typespec";
using FLOW;
@invocation(Input, Result, #{outcomes: #{blocked:"No result"}})
namespace Consumer;
@closed @agentResponse("./answer.schema.json")
model Answer { state: "yes" | "no"; text: string | null; count: integer | null; @maxItems(2) items: string[]; }
@closed model Input {
  @minLength(1) @maxLength(2) text: string;
  @minValue(-2) @maxValue(3) count: integer;
  previous: Answer | null;
  optional?: string;
  @minItems(1) @maxItems(2) items: string[];
}
@closed model Done { outcome: "done"; output: Answer; }
@closed model Stopped { outcome: "blocked"; output: string; }
@oneOf union Result { done: Done, stopped: Stopped }
`
let contract: ParsedInvocationContract
let artifacts: Record<string, string>
beforeAll(() => {
  const entry = fileURLToPath(import.meta.resolve('@jigging/flow-authoring'))
  const script = `import {readFileSync} from 'node:fs';
const {compileContract,stampSource} = await import(${JSON.stringify(entry)});
const source = await stampSource(readFileSync(0,'utf8'),{types:true});
process.stdout.write(JSON.stringify((await compileContract(source)).artifacts));`
  artifacts = JSON.parse(
    execFileSync(process.env.FLOW_NODE ?? 'node', ['--input-type=module', '-e', script], {
      input: source,
      env: {},
      encoding: 'utf8',
      timeout: 30000,
      maxBuffer: 1048576,
    }),
  )
  contract = parseInvocationContract(
    Buffer.from(artifacts['FLOW.contract.json']!),
    'FLOW.contract.json',
  )
}, 35000)

const answer = { state: 'yes', text: null, count: null, items: [] }
const input = { text: '😀a', count: 3, previous: null, items: ['x'] }

test('generated contract and Agent projection pass the existing exact readers', () => {
  expect(contract.profile).toBe('single')
  expect(contract.invocation?.outcomes).toEqual({ blocked: 'No result' })
  const schema = JSON.parse(artifacts['answer.schema.json']!) as JsonObject
  validateJson1(schema)
  expect(() => assertResponseSchema(schema)).not.toThrow()
  contract.schemas.get('/input')!.validate(input, 'INVALID_INPUT')
  contract.schemas.get('/result')!.validate({ outcome: 'done', output: answer }, 'INVALID_RESULT')
  contract.schemas
    .get('/result')!
    .validate({ outcome: 'blocked', output: 'explanation' }, 'INVALID_RESULT')
})

for (const [name, changed] of [
  ['too many Unicode scalars', { ...input, text: '😀ab' }],
  ['empty bounded string', { ...input, text: '' }],
  ['upper numeric bound', { ...input, count: 4 }],
  ['lower numeric bound', { ...input, count: -3 }],
  ['non-integer', { ...input, count: 1.5 }],
  ['empty bounded list', { ...input, items: [] }],
  ['oversized list', { ...input, items: ['a', 'b', 'c'] }],
  ['extra property', { ...input, extra: true }],
  ['null optional field', { ...input, optional: null }],
  ['missing required nullable field', { text: 'a', count: 0, items: ['x'] }],
])
  test(`generated input rejects ${name}`, () => {
    expect(() => contract.schemas.get('/input')!.validate(changed, 'INVALID_INPUT')).toThrow()
  })

test('optional fields, explicit null and inclusive numeric endpoints remain valid', () => {
  for (const count of [-2, 3]) {
    contract.schemas
      .get('/input')!
      .validate({ ...input, count, optional: 'present' }, 'INVALID_INPUT')
  }
  contract.schemas.get('/input')!.validate({ ...input, previous: answer }, 'INVALID_INPUT')
})

test('complete result remains correlated rather than merely accepting either output', () => {
  expect(() =>
    contract.schemas
      .get('/result')!
      .validate({ outcome: 'blocked', output: answer }, 'INVALID_RESULT'),
  ).toThrow()
  expect(() =>
    contract.schemas
      .get('/result')!
      .validate({ outcome: 'done', output: 'reason' }, 'INVALID_RESULT'),
  ).toThrow()
})

test('JSON/1 rejection still precedes generated schema validation', () => {
  expect(() => validateJson1({ ...input, count: 9007199254740992 })).toThrow()
  expect(() => validateJson1({ ...input, text: '\ud800' })).toThrow()
})
