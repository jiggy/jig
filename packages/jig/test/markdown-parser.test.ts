import { describe, expect, test } from 'bun:test'
import { Node, Parser } from 'commonmark'

import { INVOCATION_CONTRACT_SCHEMA, parseInvocationContract } from '../src/invocation-contract.js'
import { compileMarkdown, MARKDOWN_LIMITS } from '../src/markdown/parser.js'

const source = (value: string) => new TextEncoder().encode(value)
const recipe = (instruction: string, fence = '```') => `${fence}flow\n${instruction}\n${fence}\n`
const finish = 'return {"outcome":"done","output":null}'

describe('captured Markdown recipe compilation', () => {
  test('accepts Skill prose and recipe-only bodies without an execution-mode distinction', () => {
    expect(
      compileMarkdown(
        source(
          "---\nname: writing\ndescription: Revise supplied prose.\n---\nPreserve the author's claims.",
        ),
      ).recipes,
    ).toEqual([])
    for (const body of [recipe(finish), `${recipe(finish)}<!-- Explanation -->`]) {
      const compiled = compileMarkdown(source(` \t\r\n${body}\r\n`))
      expect(compiled.recipes).toHaveLength(1)
      expect(compiled).not.toHaveProperty('mode')
    }
    expect(compileMarkdown(source('# Heading only')).recipes).toEqual([])
    expect(compileMarkdown(source('<!-- Comment only -->')).recipes).toEqual([])
    for (const body of ['', ' \r\n\t']) expect(() => compileMarkdown(source(body))).toThrow('empty')
  })

  test('selects raw root-level exact lowercase flow info without entity or Unicode normalization', () => {
    for (const info of ['FLOW', 'flow example', 'fl&#111;w', '\u00a0flow', 'flow\u00a0', 'fℓow']) {
      const compiled = compileMarkdown(source(`Prose\n\n\`\`\`${info}\n${finish}\n\`\`\`\n`))
      expect(compiled.recipes).toHaveLength(0)
    }
    expect(compileMarkdown(source(`\`\`\`\t flow \t\n${finish}\n\`\`\`\n`)).recipes).toHaveLength(1)
  })

  test('keeps quote, list, indented-code, HTML and displayed-inner fences inert', () => {
    for (const body of [
      `> \`\`\`flow\n> ${finish}\n> \`\`\`\n`,
      `- \`\`\`flow\n  ${finish}\n  \`\`\`\n`,
      `    \`\`\`flow\n    ${finish}\n    \`\`\`\n`,
      `<pre>\n${recipe(finish)}</pre>\n`,
      `\`\`\`\`markdown\n${recipe(finish)}\`\`\`\`\n`,
    ])
      expect(compileMarkdown(source(body)).recipes).toHaveLength(0)
    expect(compileMarkdown(source(`Example:\n\n${recipe(finish)}`)).recipes).toHaveLength(1)
  })

  test('retains original complete byte spans including indentation and CRLF', () => {
    const frontmatter = '---\r\nname: exact\r\n---\r\n'
    const prose = '😀 Intro\r\n\r\n'
    const block = '  ~~~~flow\r\n  return {"outcome":"done","output":"é"}\r\n ~~~~~\r\n'
    const bytes = source(frontmatter + prose + block)
    const compiled = compileMarkdown(bytes)
    const span = compiled.recipes[0]!.span
    expect(new TextDecoder().decode(bytes.subarray(span.start, span.end))).toBe(block)
    expect(span.start).toBe(source(frontmatter + prose).byteLength)
    expect(compiled.recipes[0]!.instruction).toEqual({
      operation: 'return',
      operand: { kind: 'literal', value: { outcome: 'done', output: 'é' } },
    })
  })

  test('requires an explicit matching closing fence and preserves unavailable candidates', () => {
    const unclosed = compileMarkdown(source(`Prose\n\n\`\`\`flow\n${finish}`))
    expect(unclosed.recipes[0]!.diagnostic!.code).toBe('MARKDOWN_FENCE_UNCLOSED')
    expect(compileMarkdown(source(`\`\`\`flow\n${finish}`)).recipes[0]!.diagnostic!.code).toBe(
      'MARKDOWN_FENCE_UNCLOSED',
    )
    const malformed = compileMarkdown(source(`Prose\n${recipe('call missing {broken')}`))
    expect(malformed.recipes[0]!.diagnostic!.code).toBe('MARKDOWN_RECIPE_INVALID')
    expect(Object.isFrozen(malformed.recipes[0]!.diagnostic)).toBe(true)
  })

  test('parses exactly one instruction with complete JSON and exact operand tokens', () => {
    const metadata = '---\nuses: {reviewer: {}}\n---\n'
    for (const instruction of [
      'call reviewer {"a":1}\ncall reviewer null',
      'call reviewer null #comment',
      'call reviewer {"a":1,"a":2}',
      'call reviewer toString',
      'receive updates extra',
      'return\nnull',
    ]) {
      const compiled = compileMarkdown(source(metadata + 'Prose\n' + recipe(instruction)))
      expect(compiled.recipes[0]!.diagnostic!.code).toBe('MARKDOWN_RECIPE_INVALID')
    }
    const compiled = compileMarkdown(
      source(
        metadata +
          'Prose\n' +
          recipe('call\treviewer\t{\n  "literal":"@input",\n  "ref":{"$ref":"@previous"}\n}'),
      ),
    )
    expect(compiled.recipes[0]!.instruction).toEqual({
      operation: 'call',
      target: 'reviewer',
      operand: { kind: 'literal', value: { literal: '@input', ref: { $ref: '@previous' } } },
    })
  })

  test('freezes every recipe without requiring a return or restricting dynamic operands', () => {
    const compiled = compileMarkdown(source(recipe(finish) + recipe('call missing null')))
    expect(compiled.recipes[1]!.diagnostic!.code).toBe('MARKDOWN_SLOT_UNAVAILABLE')
    expect(
      compileMarkdown(source('---\nuses: {reviewer: {}}\n---\n' + recipe('call reviewer @input')))
        .recipes[0]!.diagnostic,
    ).toBeUndefined()
    for (const operand of ['@value', '?'])
      expect(
        compileMarkdown(source(recipe(`return ${operand}`))).recipes[0]!.diagnostic,
      ).toBeUndefined()
  })

  test('qualifies recipe declarations and tool restrictions without inventing slot tools', () => {
    const contract = parseInvocationContract(
      source(
        JSON.stringify({
          $schema: INVOCATION_CONTRACT_SCHEMA,
          channels: {
            updates: { direction: 'receive', required: false },
            published: { direction: 'send' },
          },
        }),
      ),
    )
    const compiled = compileMarkdown(
      source(
        '---\nallowed-tools: Read\n---\nProse\n' +
          recipe('receive updates') +
          recipe('send published null') +
          recipe('close updates') +
          recipe(finish),
      ),
      { contract },
    )
    expect(compiled.toolPolicy).toBe('read')
    expect(compiled.recipes.map((entry) => entry.diagnostic?.code)).toEqual([
      'MARKDOWN_RECIPE_RESTRICTED',
      'MARKDOWN_RECIPE_RESTRICTED',
      undefined,
      undefined,
    ])
    expect(compileMarkdown(source('---\nallowed-tools: "  "\n---\nProse')).toolPolicy).toBe('none')
    expect(compileMarkdown(source('---\nallowed-tools: "\\tRead"\n---\nProse')).toolPolicy).toBe(
      'unsupported',
    )
    expect(() => compileMarkdown(source('---\nuses: {markdown-agent: {}}\n---\nProse'))).toThrow(
      'reserved',
    )
  })

  test('bounds source, candidate count and AST construction while restoring parser methods', () => {
    const append = Node.prototype.appendChild
    expect(() => compileMarkdown(source('a'.repeat(MARKDOWN_LIMITS.bodyBytes)))).not.toThrow()
    expect(() => compileMarkdown(source('a'.repeat(MARKDOWN_LIMITS.bodyBytes + 1)))).toThrow(
      '256 KiB',
    )
    expect(() => compileMarkdown(source(recipe(finish).repeat(257)))).toThrow('256 candidate')
    expect(() => compileMarkdown(source('> '.repeat(65) + 'deep'))).toThrow('AST exceeds')
    expect(() => compileMarkdown(source('*x* '.repeat(2_000)))).toThrow('AST exceeds')
    expect(Node.prototype.appendChild).toBe(append)
    expect(new Parser().parse('hello').firstChild!.type).toBe('paragraph')
  })
})
