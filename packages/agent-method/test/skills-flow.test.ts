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
  test('prepares once, exchanges once and forwards the unused endpoint itself', async () => {
    const { url } = await fixture()
    let calls = 0
    const events = {
      direction: 'send',
      send() {
        throw new Error('must not consume endpoint')
      },
    }
    const run = {
      input: { instructions: 'Answer.', methodSkills: ['check'] },
      settings: {},
      attachments: {},
      channels: { events },
      signal: new AbortController().signal,
      call: async (call: FlowCall) => {
        calls += 1
        expect(call.operationId).toBe('exchange')
        expect(call.slot).toBe('exchange')
        expect(call.channels?.events).toBe(events)
        expect((call.input as { prompt: string }).prompt).toContain('Exact guidance.')
        return { outcome: 'done', output: { text: 'Answer.', stop: 'end-turn' } }
      },
    } as unknown as RunContext
    expect(await agentFlow(run, url)).toEqual({ outcome: 'done', output: { text: 'Answer.' } })
    expect(calls).toBe(1)
  })

  test('keeps operational failure as failure without a retry', async () => {
    const { url } = await fixture()
    let calls = 0
    const failure = new Error('uncertain transport')
    const run = {
      input: { instructions: 'Answer.' },
      settings: {},
      attachments: {},
      channels: {},
      signal: new AbortController().signal,
      call: async () => {
        calls += 1
        throw failure
      },
    } as unknown as RunContext
    await expect(agentFlow(run, url)).rejects.toBe(failure)
    expect(calls).toBe(1)
  })
})
