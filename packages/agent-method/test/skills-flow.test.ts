import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { FlowCall, RunContext } from '@jigging/flow'

import { agentFlow } from '../src/flow.js'
import { readPackageSkills } from '../src/skills.js'

const temporary: string[] = []
afterEach(async () => {
  for (const root of temporary.splice(0)) await rm(root, { recursive: true, force: true })
})
const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-method-test-'))
  temporary.push(root)
  await mkdir(join(root, 'skills', 'check'), { recursive: true })
  await writeFile(join(root, 'skills', 'check', 'SKILL.md'), 'Exact guidance.\n')
  return { root, url: pathToFileURL(`${root}/`) }
}

describe('explicit package Skill reader', () => {
  test('reads exact UTF-8 files from a relocated package root', async () => {
    const { root, url } = await fixture()
    await mkdir(join(root, 'skills', 'check', 'nested'))
    await writeFile(join(root, 'skills', 'check', 'nested', 'note.txt'), 'café\r\n')
    const result = await readPackageSkills(url, ['check'])
    expect(result).toEqual([
      {
        name: 'check',
        files: [
          { path: 'SKILL.md', text: 'Exact guidance.\n' },
          { path: 'nested/note.txt', text: 'café\r\n' },
        ],
      },
    ])
    expect(Object.isFrozen(result[0]?.files)).toBe(true)
    expect(await readPackageSkills(url, [])).toEqual([])
  })

  test('rejects duplicate and escaped names, invalid UTF-8, missing files and symlinks', async () => {
    const { root, url } = await fixture()
    for (const names of [['check', 'check'], ['../check'], ['missing']])
      await expect(readPackageSkills(url, names)).rejects.toThrow()
    await writeFile(join(root, 'skills', 'check', 'bad.txt'), Uint8Array.from([0xff]))
    await expect(readPackageSkills(url, ['check'])).rejects.toThrow('UTF-8')
    await rm(join(root, 'skills', 'check', 'bad.txt'))
    await symlink(
      join(root, 'skills', 'check', 'SKILL.md'),
      join(root, 'skills', 'check', 'linked'),
    )
    await expect(readPackageSkills(url, ['check'])).rejects.toThrow('symlink')
    await rm(join(root, 'skills', 'check', 'linked'))
    await symlink(root, join(root, 'alias'))
    await expect(readPackageSkills(pathToFileURL(`${root}/alias/`), ['check'])).rejects.toThrow(
      'symlink',
    )
  })

  test('bounds file bytes before reading them', async () => {
    const { root, url } = await fixture()
    await writeFile(join(root, 'skills', 'check', 'large'), new Uint8Array(1_048_577))
    await expect(readPackageSkills(url, ['check'])).rejects.toThrow('1 MiB')
  })
})

describe('ordinary Flow wiring', () => {
  test('rejects missing model settings and unsupported channels before dispatch', async () => {
    let calls = 0
    const run = {
      input: { instructions: 'Answer.' },
      settings: {},
      attachments: {},
      channels: {},
      signal: new AbortController().signal,
      call: async () => {
        calls++
        throw new Error('must not dispatch')
      },
    } as unknown as RunContext
    await expect(agentFlow(run)).rejects.toThrow('model')
    await expect(
      agentFlow({ ...run, input: { instructions: 'Answer.', conversation: true } } as RunContext),
    ).rejects.toMatchObject({ code: 'UNAVAILABLE' })
    for (const session of [
      { retain: true },
      { restore: '013579ab-cdef-4567-89ab-0123456789ab' },
      null,
    ])
      await expect(
        agentFlow({ ...run, input: { instructions: 'Answer.', session } } as RunContext),
      ).rejects.toMatchObject({ code: 'UNAVAILABLE' })
    await expect(
      agentFlow({
        ...run,
        settings: { model: 'x' },
        channels: { events: {} },
      } as unknown as RunContext),
    ).rejects.toThrow('channels')
    expect(calls).toBe(0)
    await expect(
      agentFlow({ ...run, input: { instructions: 'Work.', skills: null } } as RunContext),
    ).rejects.toThrow()
    expect(calls).toBe(0)
  })
  test('prepares once and requests one HTTP completion with the original cancellation signal', async () => {
    const { url } = await fixture()
    let calls = 0
    const signal = new AbortController().signal
    const run = {
      input: { instructions: 'Answer.', skills: await readPackageSkills(url, ['check']) },
      settings: { model: 'fixture-model' },
      attachments: {},
      channels: {},
      signal,
      call: async (call: FlowCall, options: { signal: AbortSignal }) => {
        calls += 1
        expect(call.operationId).toBe('completion')
        expect(call.slot).toBe('http')
        expect(call.channels).toBeUndefined()
        expect((call.input as any).response).toBe('json')
        expect(options.signal).toBe(signal)
        const body = (call.input as any).body
        expect(body).toMatchObject({
          model: 'fixture-model',
          max_completion_tokens: 4096,
          stream: false,
          store: false,
          n: 1,
        })
        expect(body.messages[0].content).toContain('Exact guidance.')
        return {
          outcome: 'done',
          output: {
            status: 200,
            body: {
              object: 'chat.completion',
              choices: [
                {
                  index: 0,
                  finish_reason: 'stop',
                  message: { role: 'assistant', content: 'Answer.' },
                },
              ],
            },
          },
        }
      },
    } as unknown as RunContext
    expect(await agentFlow(run)).toEqual({ outcome: 'done', output: { text: 'Answer.' } })
    expect(calls).toBe(1)
  })

  test('keeps operational failure as failure without a retry', async () => {
    let calls = 0
    const failure = new Error('uncertain transport')
    const run = {
      input: { instructions: 'Answer.' },
      settings: { model: 'fixture-model' },
      attachments: {},
      channels: {},
      signal: new AbortController().signal,
      call: async () => {
        calls += 1
        throw failure
      },
    } as unknown as RunContext
    await expect(agentFlow(run)).rejects.toBe(failure)
    expect(calls).toBe(1)
  })

  test('selected Responses schema mode reaches HTTP once and returns a checked result', async () => {
    let calls = 0
    const signal = new AbortController().signal
    const responseSchema = {
      $schema: 'https://flow.jig.md/schemas/schema-1.json',
      type: 'object',
      properties: { answer: { type: 'string' } },
      required: ['answer'],
      additionalProperties: false,
    }
    const run = {
      input: { instructions: 'Answer.', responseSchema },
      settings: { model: 'fixture-model', api: 'responses', structuredOutput: 'json-schema' },
      attachments: {},
      channels: {},
      signal,
      call: async (call: FlowCall, options: { signal: AbortSignal }) => {
        calls++
        expect(options.signal).toBe(signal)
        expect(call.slot).toBe('http')
        const body = (call.input as any).body
        expect(body.max_output_tokens).toBe(4096)
        expect(body.text.format.strict).toBe(true)
        expect(body.text.format.schema.$schema).toBeUndefined()
        expect(body.messages).toBeUndefined()
        return {
          outcome: 'done',
          output: {
            status: 200,
            body: {
              object: 'response',
              status: 'completed',
              output: [
                {
                  type: 'message',
                  role: 'assistant',
                  status: 'completed',
                  content: [{ type: 'output_text', text: '{"answer":"checked"}' }],
                },
              ],
            },
          },
        }
      },
    } as unknown as RunContext
    expect(await agentFlow(run)).toEqual({
      outcome: 'done',
      output: { text: '{"answer":"checked"}', structured: { answer: 'checked' } },
    })
    expect(calls).toBe(1)
  })

  test('provider rejection of a strict schema never falls back or retries', async () => {
    for (const api of ['chat-completions', 'responses']) {
      let calls = 0
      const run = {
        input: {
          instructions: 'Answer.',
          responseSchema: {
            $schema: 'https://flow.jig.md/schemas/schema-1.json',
            type: 'object',
            properties: { answer: { type: 'string' } },
            required: ['answer'],
            additionalProperties: false,
          },
        },
        settings: { model: 'fixture-model', api, structuredOutput: 'json-schema' },
        attachments: {},
        channels: {},
        signal: new AbortController().signal,
        call: async () => {
          calls++
          return { outcome: 'done', output: { status: 400, body: 'private-provider-error' } }
        },
      } as unknown as RunContext
      await expect(agentFlow(run)).rejects.toThrow('HTTP 400')
      expect(calls).toBe(1)
    }
  })
})
