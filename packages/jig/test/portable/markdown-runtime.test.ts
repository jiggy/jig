import { describe, expect, test } from 'bun:test'
import {
  INVOCATION_CONTRACT_SCHEMA,
  parseInvocationContract,
} from '../../src/invocation-contract.js'
import { compileMarkdown } from '../../src/markdown/parser.js'
import { MARKDOWN_INTERPRETER_TEMPLATE } from '../../src/markdown/runtime.js'

const bytes = (value: string) => new TextEncoder().encode(value)
const block = (instruction: string) => `\`\`\`flow\n${instruction}\n\`\`\`\n`

// These are compilation and static guidance checks, not interpreter execution.
// Native admission evidence belongs to host/markdown-worker.test.ts; the exact
// retired execution windows are inventoried in .tmp/host-foundation/.
describe('Markdown interpreter compilation inputs and guidance', () => {
  test('preserves literal operand content rather than interpreting reference-shaped JSON', () => {
    const compiled = compileMarkdown(
      bytes(
        block(
          'return {"outcome":"done","output":{"literal":"@input","ref":{"$ref":"@previous"}}}',
        ) + block('return {"outcome":"done","output":"unreachable"}'),
      ),
    )
    expect(compiled.recipes.map((entry) => entry.instruction)).toEqual([
      {
        operation: 'return',
        operand: {
          kind: 'literal',
          value: { outcome: 'done', output: { literal: '@input', ref: { $ref: '@previous' } } },
        },
      },
      {
        operation: 'return',
        operand: { kind: 'literal', value: { outcome: 'done', output: 'unreachable' } },
      },
    ])
  })

  test('compiles prose-only Skill metadata without recipes or tools', () => {
    const compiled = compileMarkdown(
      bytes(
        '---\nname: sum-integers\ndescription: Add a supplied list of integers.\nlicense: MIT\n' +
          'compatibility: A reasoning agent that accepts JSON input.\nmetadata:\n  author: example\nallowed-tools: ""\n---\n' +
          'Add every integer in the supplied JSON array. Return a JSON object with a single property, sum, whose value is the computed integer. Do not add explanation or call external tools.\n',
      ),
    )
    expect(compiled.recipes).toEqual([])
    expect(compiled.toolPolicy).toBe('none')
  })

  test('retains optional channel declarations as compiler inputs without supplying endpoints', () => {
    const contract = parseInvocationContract(
      bytes(
        JSON.stringify({
          $schema: INVOCATION_CONTRACT_SCHEMA,
          channels: {
            updates: { direction: 'receive', required: false },
            published: { direction: 'send', required: false },
          },
        }),
      ),
    )
    const compiled = compileMarkdown(
      bytes(block('receive updates') + block('send published @previous')),
      { contract },
    )
    expect(compiled.recipes.map((entry) => entry.diagnostic)).toEqual([undefined, undefined])
    expect(compiled.recipes.map((entry) => entry.instruction)).toEqual([
      { operation: 'receive', target: 'updates' },
      { operation: 'send', target: 'published', operand: { kind: 'previous' } },
    ])
  })

  test('states prose-only completion and the complete result envelope in the static template', () => {
    for (const guidance of [
      'a prose-only Skill can perform reasoning and finish without any recipe',
      'Never select action "recipe" with recipe 0',
      'put its complete answer in RunResult.output',
      'the outcome field must still be present',
      'Reasoning and finish remain available when toolPolicy is "none"',
      JSON.stringify({
        action: 'finish',
        recipe: 0,
        operand: 'literal',
        value: '{"outcome":"done","output":null}',
        path: '',
      }),
    ])
      expect(MARKDOWN_INTERPRETER_TEMPLATE).toContain(guidance)
  })
})
