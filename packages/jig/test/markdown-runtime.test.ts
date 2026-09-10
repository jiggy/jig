import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import {
  type ChannelEndpoint,
  type FlowCall,
  type JsonValue,
  OperationError,
  type RunContext,
  type RunResult,
} from '@jigging/flow'
import { markdownAgentContract } from '../src/internal/markdown-agent-contract.js'
import { assertPrivateAgentResponseSchema } from '../src/internal/openai-agent-client.js'
import { parseAgentRunInput, parseAgentRunResult } from '../src/internal/private-agent-run.js'
import { INVOCATION_CONTRACT_SCHEMA, parseInvocationContract } from '../src/invocation-contract.js'
import { compileMarkdown } from '../src/markdown/parser.js'
import {
  MARKDOWN_INTERPRETER_TEMPLATE,
  type MarkdownResources,
  runMarkdown,
} from '../src/markdown/runtime.js'

const bytes = (value: string) => new TextEncoder().encode(value)
const block = (instruction: string) => `\`\`\`flow\n${instruction}\n\`\`\`\n`
const done = (output: JsonValue): RunResult => ({ outcome: 'done', output })
const staticRecipe = (recipe: number) => ({
  action: 'recipe',
  recipe,
  operand: 'none',
  value: '',
  path: '',
})
const finish = (output: JsonValue = null) => ({
  action: 'finish',
  recipe: 0,
  operand: 'literal',
  value: JSON.stringify(done(output)),
  path: '',
})
const decision = (value: unknown): RunResult => done({ text: '', structured: value as JsonValue })
const emptyResources: MarkdownResources = {
  manifest: [],
  read: async () => {
    throw new Error('unexpected read')
  },
}
function compile(body: string, metadata = '', fields?: Record<string, unknown>) {
  const contract =
    fields === undefined
      ? undefined
      : parseInvocationContract(
          bytes(JSON.stringify({ $schema: INVOCATION_CONTRACT_SCHEMA, ...fields })),
        )
  return compileMarkdown(
    bytes((metadata ? `---\n${metadata}\n---\n` : '') + body),
    contract === undefined ? {} : { contract },
  )
}
function context(
  call: RunContext['call'],
  options: {
    input?: JsonValue
    channels?: Record<string, ChannelEndpoint>
    signal?: AbortSignal
  } = {},
): RunContext {
  return {
    input: options.input ?? null,
    settings: {},
    attachments: {},
    channels: options.channels ?? {},
    scratch: '/unused',
    deadlineUnixMs: Date.now() + 60_000,
    signal: options.signal ?? new AbortController().signal,
    call,
    channel: (() => {
      throw new Error('channel creation is outside the profile')
    }) as RunContext['channel'],
  }
}
function reasoningContext(call: FlowCall): any {
  expect(call.slot).toBe('markdown-agent')
  const instructions = (call.input as { instructions: string }).instructions
  expect(instructions.startsWith(MARKDOWN_INTERPRETER_TEMPLATE + '\n\n')).toBe(true)
  return JSON.parse(instructions.slice(MARKDOWN_INTERPRETER_TEMPLATE.length + 2))
}

describe('finite Markdown runtime', () => {
  test('Agent selection controls recipe-only bodies just as it controls prose', async () => {
    for (const prose of ['', '# Procedure\n', '<!-- explanation -->\n']) {
      let calls = 0
      const result = await runMarkdown(
        compile(
          prose +
            block('return {"outcome":"done","output":"first"}') +
            block('return {"outcome":"done","output":"selected"}'),
        ),
        context(async (call) => {
          reasoningContext(call)
          calls++
          return decision(staticRecipe(2))
        }),
        emptyResources,
      )
      expect(result).toEqual(done('selected'))
      expect(calls).toBe(1)
    }
  })

  test('a recipe-only body cannot execute when its reasoning dependency fails', async () => {
    let calls = 0
    await expect(
      runMarkdown(
        compile(block('return {"outcome":"done","output":null}')),
        context(async (call) => {
          reasoningContext(call)
          calls++
          throw new OperationError('UNAVAILABLE', 'No admitted Agent.')
        }),
        emptyResources,
      ),
    ).rejects.toMatchObject({ code: 'UNAVAILABLE' })
    expect(calls).toBe(1)
  })

  test('qualifies the actual decision request and result through the native Agent schema seam', async () => {
    const contract = markdownAgentContract()
    let calls = 0
    const result = await runMarkdown(
      compile('Return a bounded result.'),
      context(async (call) => {
        calls++
        reasoningContext(call)
        const prepared = parseAgentRunInput(contract, call.input)
        expect(prepared.input.responseSchema?.$schema).toBe(
          'https://flow.jig.md/schemas/schema-1.json',
        )
        expect(() => assertPrivateAgentResponseSchema(prepared.input.responseSchema!)).not.toThrow()
        const structured = finish('qualified')
        expect(
          parseAgentRunResult(contract, prepared, { outcome: 'completed', text: '', structured })
            .structured,
        ).toEqual(structured)
        return decision(structured)
      }),
      emptyResources,
    )
    expect(result).toEqual(done('qualified'))
    expect(calls).toBe(1)
  })

  test('keeps the provider schema simple while locally rejecting out-of-range recipe indexes', async () => {
    for (const recipe of [-1, 257, 0.5]) {
      let calls = 0
      await expect(
        runMarkdown(
          compile('Return a bounded result.'),
          context(async () => {
            calls++
            return decision({ ...finish(), recipe })
          }),
          emptyResources,
        ),
      ).rejects.toMatchObject({ code: 'INVALID_RESULT' })
      expect(calls).toBe(1)
    }
  })

  test('stops on changed captured resources and charges resource reads before I/O', async () => {
    const content = bytes('x'.repeat(600_000))
    const digest = `sha256:${createHash('sha256').update(content).digest('hex')}`
    let reads = 0
    let turns = 0
    const compiled = compile('Read both resources, then return.')
    await expect(
      runMarkdown(
        compiled,
        context(async () =>
          decision({
            action: 'read',
            recipe: 0,
            operand: 'none',
            value: '',
            path: ++turns === 1 ? 'one.txt' : 'two.txt',
          }),
        ),
        {
          manifest: [
            { path: 'one.txt', size: content.byteLength, digest },
            { path: 'two.txt', size: content.byteLength, digest },
          ],
          read: async () => {
            reads++
            return content
          },
        },
      ),
    ).rejects.toMatchObject({ code: 'RESOURCE_EXHAUSTED' })
    expect(reads).toBe(1)
    turns = 0
    await expect(
      runMarkdown(
        compiled,
        context(async () => {
          turns++
          return decision({
            action: 'read',
            recipe: 0,
            operand: 'none',
            value: '',
            path: 'one.txt',
          })
        }),
        {
          manifest: [{ path: 'one.txt', size: 4, digest }],
          read: async () => bytes('oops'),
        },
      ),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    expect(turns).toBe(1)
  })
  test('recipe-only bodies require Agent selection and propagate complete declared domain results', async () => {
    const calls: FlowCall[] = []
    let reasons = 0
    const compiled = compile(
      block('call reviewer @input') + block('return @previous'),
      'uses: {reviewer: {}}',
      { outcomes: { blocked: 'The specialist declined.' } },
    )
    const result = { outcome: 'blocked', output: { text: 'Cannot review.' } }
    expect(
      await runMarkdown(
        compiled,
        context(
          async (call) => {
            if (call.slot === 'markdown-agent') return decision(staticRecipe(++reasons))
            calls.push(call)
            return result
          },
          { input: { text: 'source' } },
        ),
        emptyResources,
      ),
    ).toEqual(result)
    expect(calls).toEqual([
      { operationId: 'markdown:recipe:1', slot: 'reviewer', input: { text: 'source' } },
    ])
    expect(reasons).toBe(2)
  })

  test('preserves literals and stops at the selected explicit return', async () => {
    const compiled = compile(
      block('return {"outcome":"done","output":{"literal":"@input","ref":{"$ref":"@previous"}}}') +
        block('return {"outcome":"done","output":"unreachable"}'),
    )
    expect(
      await runMarkdown(
        compiled,
        context(async (call) => {
          reasoningContext(call)
          return decision(staticRecipe(1))
        }),
        emptyResources,
      ),
    ).toEqual(done({ literal: '@input', ref: { $ref: '@previous' } }))
  })

  test('resolves @previous before clearing it for the next attempted call', async () => {
    let index = 0
    let reasons = 0
    const first = done({ evidence: 'exact' })
    const compiled = compile(
      block('call reviewer @input') + block('call archive @previous') + block('return @previous'),
      'uses: {reviewer: {}, archive: {}}',
    )
    const result = await runMarkdown(
      compiled,
      context(async (call) => {
        if (call.slot === 'markdown-agent') return decision(staticRecipe(++reasons))
        if (++index === 1) return first
        expect(call.input).toEqual(first)
        return done('stored')
      }),
      emptyResources,
    )
    expect(result).toEqual(done('stored'))
  })

  test('preserves 100 KiB exact values across decision packets and exposes failed cursor invalidation', async () => {
    const review = done({ body: 'x'.repeat(100 * 1024), unicode: 'é😀', quoted: '"\\\n' })
    let reasons = 0
    let reviews = 0
    const ids = new Set<string>()
    const compiled = compile(
      'Forward an earlier successful review unchanged.\n' +
        block('call reviewer @input') +
        block('call archive @value'),
      'uses: {reviewer: {}, archive: {}}',
    )
    const result = await runMarkdown(
      compiled,
      context(async (call) => {
        expect(ids.has(call.operationId)).toBe(false)
        ids.add(call.operationId)
        if (call.slot === 'reviewer') {
          if (++reviews === 2)
            throw new OperationError(
              'EXECUTION_FAILED',
              'The second review failed after settlement.',
            )
          return review
        }
        if (call.slot === 'archive') {
          expect(call.input).toEqual(review)
          return done('stored')
        }
        const context = reasoningContext(call)
        reasons++
        if (reasons <= 2) return decision(staticRecipe(1))
        if (reasons === 3) {
          expect(context.previous).toEqual({ state: 'absent' })
          expect(
            context.settledRuntimeObservations.some(
              (entry: any) => entry.code === 'EXECUTION_FAILED',
            ),
          ).toBe(true)
          const handle = context.retainedValues.find((entry: any) =>
            entry.origin.endsWith(':result'),
          ).handle
          return decision({
            action: 'recipe',
            recipe: 2,
            operand: 'value',
            value: handle,
            path: '',
          })
        }
        return decision(finish('complete'))
      }),
      emptyResources,
    )
    expect(result).toEqual(done('complete'))
    expect(reasons).toBe(4)
  })

  test('accepts ? only as fresh JSON and rejects static overrides without another call', async () => {
    let reasons = 0
    let effects = 0
    const compiled = compile(
      'Review fresh data.\n' + block('call reviewer ?'),
      'uses: {reviewer: {}}',
    )
    expect(
      await runMarkdown(
        compiled,
        context(async (call) => {
          if (call.slot === 'reviewer') {
            effects++
            expect(call.input).toEqual({ chosen: 7 })
            return done(null)
          }
          return decision(
            ++reasons === 1
              ? { action: 'recipe', recipe: 1, operand: 'literal', value: '{"chosen":7}', path: '' }
              : finish(),
          )
        }),
        emptyResources,
      ),
    ).toEqual(done(null))
    expect(effects).toBe(1)
    const staticCompiled = compile(
      'Review exact data.\n' + block('call reviewer @input'),
      'uses: {reviewer: {}}',
    )
    let calls = 0
    await expect(
      runMarkdown(
        staticCompiled,
        context(async () => {
          calls++
          return decision({
            action: 'recipe',
            recipe: 1,
            operand: 'literal',
            value: '{}',
            path: '',
          })
        }),
        emptyResources,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_RESULT' })
    expect(calls).toBe(1)
  })

  test('reports frozen recipe unavailability and rejects malformed decision packets', async () => {
    let turn = 0
    const compiled = compile('A tutorial may be unused.\n' + block('call reviewer {broken'))
    expect(
      await runMarkdown(
        compiled,
        context(async (call) => {
          const state = reasoningContext(call)
          if (++turn === 1) return decision(staticRecipe(1))
          expect(
            state.settledRuntimeObservations.some(
              (entry: any) =>
                entry.diagnostic?.code === 'MARKDOWN_RECIPE_INVALID' && entry.dispatched === false,
            ),
          ).toBe(true)
          return decision(finish('prose remains usable'))
        }),
        emptyResources,
      ),
    ).toEqual(done('prose remains usable'))
    for (const invalid of [
      { ...finish(), surprise: true },
      { ...finish(), recipe: 1 },
      { ...finish(), operand: 'value', value: 'foreign' },
    ]) {
      let calls = 0
      await expect(
        runMarkdown(
          compile('Prose'),
          context(async () => {
            calls++
            return decision(invalid)
          }),
          emptyResources,
        ),
      ).rejects.toMatchObject({ code: 'INVALID_RESULT' })
      expect(calls).toBe(1)
    }
  })

  test('reads only explicit captured UTF-8 resources and keeps resource code inert', async () => {
    const content = bytes('Reference data.\n' + block('call injected null'))
    const resource = {
      path: 'references/guide.md',
      size: content.byteLength,
      digest: `sha256:${createHash('sha256').update(content).digest('hex')}`,
    }
    let reads = 0
    let turns = 0
    const compiled = compile('Read the guide, then finish.', 'allowed-tools: Read')
    const result = await runMarkdown(
      compiled,
      context(async (call) => {
        const state = reasoningContext(call)
        expect(state.recipes).toHaveLength(0)
        if (++turns === 1) {
          expect(state.capturedResources[0].state).toBe('unread')
          return decision({
            action: 'read',
            recipe: 0,
            operand: 'none',
            value: '',
            path: resource.path,
          })
        }
        expect(state.capturedResources[0].text).toBe(new TextDecoder().decode(content))
        return decision(finish('read'))
      }),
      {
        manifest: [resource],
        read: async (path, maximum) => {
          reads++
          expect(path).toBe(resource.path)
          expect(maximum).toBe(content.byteLength)
          return content
        },
      },
    )
    expect(result).toEqual(done('read'))
    expect(reads).toBe(1)
  })

  test('allows reasoning/finish with no tools and rejects unsupported restrictions before reasoning', async () => {
    expect(
      await runMarkdown(
        compile('Think and return.', 'allowed-tools: ""'),
        context(async () => decision(finish('thought'))),
        emptyResources,
      ),
    ).toEqual(done('thought'))
    let calls = 0
    await expect(
      runMarkdown(
        compile('Run a shell script.', 'allowed-tools: Bash'),
        context(async () => {
          calls++
          return decision(finish())
        }),
        emptyResources,
      ),
    ).rejects.toMatchObject({ code: 'UNAVAILABLE' })
    expect(calls).toBe(0)
  })

  test('explains prose-only Skill completion and rejects the observed recipe-zero input-handle decision', async () => {
    const compiled = compileMarkdown(
      bytes(
        '---\nname: sum-integers\ndescription: Add a supplied list of integers.\nlicense: MIT\n' +
          'compatibility: A reasoning agent that accepts JSON input.\nmetadata:\n  author: example\nallowed-tools: ""\n---\n' +
          'Add every integer in the supplied JSON array. Return a JSON object with a single property, sum, whose value is the computed integer. Do not add explanation or call external tools.\n',
      ),
    )
    expect(compiled.recipes).toEqual([])
    expect(compiled.toolPolicy).toBe('none')
    let calls = 0
    const result = await runMarkdown(
      compiled,
      context(
        async (call) => {
          calls++
          const packet = reasoningContext(call)
          expect(packet.recipes).toEqual([])
          expect(packet.invocationInput.value).toEqual([2, 3, 4])
          expect(packet.toolPolicy).toBe('none')
          const instructions = (call.input as { instructions: string }).instructions
          expect(instructions).toContain(
            'a prose-only Skill can perform reasoning and finish without any recipe',
          )
          expect(instructions).toContain('Never select action "recipe" with recipe 0')
          expect(instructions).toContain('put its complete answer in RunResult.output')
          expect(instructions).toContain('the outcome field must still be present')
          expect(instructions).toContain(
            'Reasoning and finish remain available when toolPolicy is "none"',
          )
          expect(instructions).toContain(
            JSON.stringify({
              action: 'finish',
              recipe: 0,
              operand: 'literal',
              value: '{"outcome":"done","output":null}',
              path: '',
            }),
          )
          return decision({
            action: 'finish',
            recipe: 0,
            operand: 'literal',
            value: '{"outcome":"done","output":{"sum":9}}',
            path: '',
          })
        },
        { input: [2, 3, 4] },
      ),
      emptyResources,
    )
    expect(result).toEqual(done({ sum: 9 }))
    expect(calls).toBe(1)

    calls = 0
    await expect(
      runMarkdown(
        compiled,
        context(
          async (call) => {
            calls++
            const packet = reasoningContext(call)
            // The one-request live diagnostic selected index zero with the input's
            // whole-value handle. Keep rejecting it; guidance is not packet repair.
            return decision({
              action: 'recipe',
              recipe: 0,
              operand: 'value',
              path: '',
              value: packet.retainedValues[0].handle,
            })
          },
          { input: [2, 3, 4] },
        ),
        emptyResources,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_RESULT' })
    expect(calls).toBe(1)
  })

  test('receives and forwards exact null message handles while EOF clears the cursor', async () => {
    const sent: JsonValue[] = []
    let next = 0
    let turn = 0
    const receiver = {
      direction: 'receive',
      delivery: 'direct',
      startSequence: 0,
      next: async () =>
        ++next === 1 ? { done: false, value: null } : { done: true, value: undefined },
      close: async () => {},
      [Symbol.asyncIterator]() {
        return this
      },
    } as ChannelEndpoint
    const sender = {
      direction: 'send',
      delivery: 'direct',
      send: async (value: JsonValue) => {
        sent.push(value)
      },
      close: async () => {},
    } as ChannelEndpoint
    const compiled = compile(
      'Forward a useful exact message, then observe EOF.\n' +
        block('receive updates') +
        block('send published @value'),
      '',
      { channels: { updates: { direction: 'receive' }, published: { direction: 'send' } } },
    )
    expect(
      await runMarkdown(
        compiled,
        context(
          async (call) => {
            const state = reasoningContext(call)
            switch (++turn) {
              case 1:
                return decision(staticRecipe(1))
              case 2:
                expect(state.previous.value).toEqual({ done: false, value: null })
                return decision({
                  action: 'recipe',
                  recipe: 2,
                  operand: 'value',
                  value: state.retainedValues.find((entry: any) =>
                    entry.origin.endsWith(':message'),
                  ).handle,
                  path: '',
                })
              case 3:
                return decision(staticRecipe(1))
              default:
                expect(state.previous).toEqual({ state: 'absent' })
                return decision(finish())
            }
          },
          { channels: { updates: receiver, published: sender } },
        ),
        emptyResources,
      ),
    ).toEqual(done(null))
    expect(sent).toEqual([null])
  })

  test('forwards the iterator wrapper and exposes absent optional endpoints before selection', async () => {
    const sent: JsonValue[] = []
    const receiver = {
      direction: 'receive',
      delivery: 'direct',
      startSequence: 0,
      next: async () => ({ done: false, value: { id: 7 } }),
      close: async () => {},
      [Symbol.asyncIterator]() {
        return this
      },
    } as ChannelEndpoint
    const sender = {
      direction: 'send',
      delivery: 'direct',
      send: async (value: JsonValue) => {
        sent.push(value)
      },
      close: async () => {},
    } as ChannelEndpoint
    const compiled = compile(
      block('receive updates') +
        block('send published @previous') +
        block('return {"outcome":"done","output":null}'),
      '',
      {
        channels: {
          updates: { direction: 'receive', required: false },
          published: { direction: 'send', required: false },
        },
      },
    )
    await expect(
      runMarkdown(
        compiled,
        context(async (call) => {
          const state = reasoningContext(call)
          expect(state.recipes.slice(0, 2).map((entry: any) => entry.diagnostic.code)).toEqual([
            'MARKDOWN_ENDPOINT_UNAVAILABLE',
            'MARKDOWN_ENDPOINT_UNAVAILABLE',
          ])
          return decision(staticRecipe(3))
        }),
        emptyResources,
      ),
    ).resolves.toEqual(done(null))
    let reasons = 0
    await runMarkdown(
      compiled,
      context(async () => decision(staticRecipe(++reasons)), {
        channels: { updates: receiver, published: sender },
      }),
      emptyResources,
    )
    expect(sent).toEqual([{ done: false, value: { id: 7 } }])
  })

  test('exposes settled late disposal failure before a new finish', async () => {
    let closeCalls = 0
    let reasons = 0
    const receiver = {
      direction: 'receive',
      delivery: 'broadcast',
      startSequence: 0,
      next: async () => ({ done: true, value: undefined }),
      close: async () => {
        closeCalls++
        throw new OperationError('LAGGED', 'The isolated observer lagged.')
      },
      [Symbol.asyncIterator]() {
        return this
      },
    } as ChannelEndpoint
    const compiled = compile('Summarize without waiting for updates.', '', {
      channels: { updates: { direction: 'receive' } },
    })
    expect(
      await runMarkdown(
        compiled,
        context(
          async (call) => {
            if (++reasons === 2)
              expect(
                reasoningContext(call).settledRuntimeObservations.some(
                  (entry: any) => entry.kind === 'close-error' && entry.code === 'LAGGED',
                ),
              ).toBe(true)
            return decision(finish('settled'))
          },
          { channels: { updates: receiver } },
        ),
        emptyResources,
      ),
    ).toEqual(done('settled'))
    expect(closeCalls).toBe(1)
    expect(reasons).toBe(2)
  })

  test('never retries uncertain dispatch or converts reasoner domain failures into root outcomes', async () => {
    let calls = 0
    const compiled = compile(
      'Review input.\n' + block('call reviewer @input'),
      'uses: {reviewer: {}}',
    )
    await expect(
      runMarkdown(
        compiled,
        context(async (call) => {
          calls++
          if (call.slot === 'markdown-agent') return decision(staticRecipe(1))
          throw new OperationError('UNCERTAIN', 'The accepted operation may have started.')
        }),
        emptyResources,
      ),
    ).rejects.toMatchObject({ code: 'UNCERTAIN' })
    expect(calls).toBe(2)
    for (const outcome of ['blocked', 'limit']) {
      const result = { outcome, output: { text: 'No decision.' } }
      await expect(
        runMarkdown(
          compile('Prose'),
          context(async () => result),
          emptyResources,
        ),
      ).rejects.toMatchObject({ code: 'EXECUTION_FAILED', details: { result } })
    }
  })

  test('disposes receivers on root cancellation without sealing granted writers', async () => {
    const controller = new AbortController()
    let calls = 0
    let closed = 0
    let disposed = 0
    const sender = {
      direction: 'send',
      delivery: 'direct',
      send: async () => {},
      close: async () => {
        closed++
      },
    } as ChannelEndpoint
    const receiver = {
      direction: 'receive',
      delivery: 'direct',
      startSequence: 0,
      next: async () => ({ done: true, value: undefined }),
      close: async () => {
        disposed++
      },
      [Symbol.asyncIterator]() {
        return this
      },
    } as ChannelEndpoint
    await expect(
      runMarkdown(
        compile('Prose'),
        context(
          async () => {
            calls++
            controller.abort()
            return decision(finish())
          },
          { signal: controller.signal, channels: { events: sender, updates: receiver } },
        ),
        emptyResources,
      ),
    ).rejects.toMatchObject({ code: 'CANCELLED' })
    expect(calls).toBe(1)
    expect(closed).toBe(0)
    expect(disposed).toBe(1)
  })

  test('bounds complete reasoning context before dispatch and retains honest settled overflow', async () => {
    let reasons = 0
    await expect(
      runMarkdown(
        compile('Prose'),
        context(
          async () => {
            reasons++
            return decision(finish())
          },
          { input: 'x'.repeat(1024 * 1024) },
        ),
        emptyResources,
      ),
    ).rejects.toMatchObject({ code: 'RESOURCE_EXHAUSTED' })
    expect(reasons).toBe(0)
    let effects = 0
    const compiled = compile(
      block('call reviewer @input') + block('return @previous'),
      'uses: {reviewer: {}}',
    )
    await expect(
      runMarkdown(
        compiled,
        context(async (call) => {
          if (call.slot === 'markdown-agent') return decision(staticRecipe(1))
          effects++
          return done('x'.repeat(4_300_000))
        }),
        emptyResources,
      ),
    ).rejects.toMatchObject({
      code: 'RESOURCE_EXHAUSTED',
      details: { settled: true, retained: false },
    })
    expect(effects).toBe(1)
  })

  test('stops at the finite reasoning-call ceiling without repair or hidden summaries', async () => {
    let calls = 0
    const compiled = compile(
      'Continue only through the supplied tutorial.\n' + block('call missing null'),
    )
    await expect(
      runMarkdown(
        compiled,
        context(async () => {
          calls++
          return decision(staticRecipe(1))
        }),
        emptyResources,
      ),
    ).rejects.toMatchObject({ code: 'RESOURCE_EXHAUSTED' })
    expect(calls).toBe(32)
  })
})
