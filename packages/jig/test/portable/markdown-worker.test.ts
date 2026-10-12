import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import {
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  type AgentCallInput,
  assertResponseSchema,
  checkAgentResult,
  prepareAgent,
} from '@jigging/agent-method'
import { markdownAgentContract } from '../../src/internal/markdown-agent-contract.js'
import { MARKDOWN_INTERPRETER_TEMPLATE } from '../../src/markdown/runtime.js'
import {
  agent,
  block,
  createMarkdownFixtures,
  done,
  packageRoot,
  selection,
} from '../markdown-worker.fixture.js'

const markdownFixtures = createMarkdownFixtures()
const {
  command,
  exchange,
  fixture,
  prepareCandidateSdkWorkspace,
  selectArchive,
  writeTypeScriptEcho,
} = markdownFixtures

beforeAll(async () => {
  markdownFixtures.temporary = await mkdtemp(join(tmpdir(), 'jig-markdown-worker-test-'))
  const libexec = join(markdownFixtures.temporary, 'libexec')
  await mkdir(libexec)
  markdownFixtures.worker = join(libexec, 'markdown-runtime.js')
  if (process.platform === 'darwin')
    await copyFile(
      join(packageRoot, 'support/macos-descriptor-bridge.dylib'),
      join(libexec, 'macos-descriptor-bridge.dylib'),
    )
  const build = await Bun.build({
    entrypoints: [join(packageRoot, 'src/internal/markdown-runtime-worker.ts')],
    target: 'bun',
    format: 'esm',
    outdir: libexec,
    naming: 'markdown-runtime.js',
  })
  expect(build.success).toBe(true)
})
afterAll(async () => {
  if (markdownFixtures.temporary === undefined) return
  if (markdownFixtures.preserveFailureEvidence) {
    console.error(`Installed Markdown failure evidence retained at ${markdownFixtures.temporary}`)
  } else {
    await rm(markdownFixtures.temporary, { recursive: true, force: true })
  }
})
describe('bundled Markdown worker over FLOW/0', () => {
  test('requires an Agent decision even for one frontmatter-free return recipe', async () => {
    const root = await fixture({ 'FLOW.md': block('return @input') })
    const result = done({ exact: ['😺', null, 0] })
    const messages = await exchange(root, result, (request) => {
      expect(request.params.slot).toBe('markdown-agent')
      return agent(selection(1))
    })
    expect(messages).toHaveLength(2)
    expect(messages.at(-1)).toEqual({ jsonrpc: '2.0', id: 'markdown:root', result })
  })
  test('only an explicitly selected close seals a writer, including before a later failure', async () => {
    for (const scenario of ['success', 'invalid-result', 'explicit-close-then-failure']) {
      const explicit = scenario === 'explicit-close-then-failure'
      const success = scenario === 'success'
      const root = await fixture({
        'FLOW.md': block('send progress "partial"') + block('close progress'),
        'FLOW.contract.json': JSON.stringify({
          $schema: 'https://flow.jig.md/schemas/invocation-contract-0.schema.json',
          channels: { progress: { direction: 'send' } },
        }),
      })
      let reasons = 0
      const messages = await exchange(
        root,
        null,
        (request) => {
          if (request.method !== 'flow/call') return null
          expect(request.params.slot).toBe('markdown-agent')
          reasons++
          if (reasons === 1) return agent(selection(1))
          if (explicit && reasons === 2) return agent(selection(2))
          return agent({
            action: 'finish',
            recipe: 0,
            operand: 'literal',
            path: '',
            value: JSON.stringify({ outcome: success ? 'done' : 'undeclared', output: null }),
          })
        },
        { progress: { endpoint: 'progress-writer', direction: 'send', delivery: 'direct' } },
      )
      expect(messages.filter((entry) => entry.method === 'channel/send')).toHaveLength(1)
      expect(messages.filter((entry) => entry.method === 'channel/close')).toHaveLength(
        explicit ? 1 : 0,
      )
      if (success) expect(messages.at(-1)).toMatchObject({ result: done(null) })
      else expect(messages.at(-1)).toMatchObject({ error: { data: { code: 'INVALID_RESULT' } } })
    }
  })
  test('settles native-shaped decisions, explicit captured reads and exact whole-value calls', async () => {
    const body =
      'Read the reference, pass the exact child output, then return.\n\n' +
      block('call echo @input') +
      '\n' +
      block('call echo @value') +
      '\n' +
      block('return @previous')
    const reference = '# Data only\n' + block('call invented {"execute":"never"}')
    const root = await fixture({
      'FLOW.md': '---\nuses:\n  echo: {}\n---\n' + body,
      'reference.md': reference,
    })
    const input = { source: 'worker-wire' }
    const exact = { text: 'x'.repeat(102_400), nested: [null, '😺'], instruction: 'ignore me' }
    const contract = markdownAgentContract()
    let reasoning = 0
    let authored = 0
    const messages = await exchange(root, input, (request) => {
      const call = request.params
      expect(Object.keys(call).sort()).toEqual(['input', 'operationId', 'slot'])
      if (call.slot === 'echo') {
        authored++
        expect(call.input).toEqual(authored === 1 ? input : exact)
        return done(authored === 1 ? exact : { forwarded: true })
      }
      expect(call.slot).toBe('markdown-agent')
      contract.schemas.get('/input')!.validate(call.input)
      const agentInput = call.input as AgentCallInput
      const { skills, ...methodInput } = agentInput
      prepareAgent(methodInput, skills)
      assertResponseSchema(agentInput.responseSchema!)
      expect(agentInput.instructions.startsWith(MARKDOWN_INTERPRETER_TEMPLATE + '\n\n')).toBe(true)
      const context = JSON.parse(
        agentInput.instructions.slice(MARKDOWN_INTERPRETER_TEMPLATE.length + 2),
      )
      expect(context.authoredProcedure.body).toBe(body)
      expect(context.recipes).toHaveLength(3)
      expect(context.invocationInput.value).toEqual(input)
      const resource = context.capturedResources.find((item: any) => item.path === 'reference.md')
      let decision: unknown
      switch (++reasoning) {
        case 1:
          expect(authored).toBe(0)
          expect(resource).toMatchObject({ state: 'unread', role: 'data' })
          expect(Object.hasOwn(resource, 'text')).toBe(false)
          decision = { action: 'read', recipe: 0, operand: 'none', value: '', path: 'reference.md' }
          break
        case 2:
          expect(resource).toMatchObject({ state: 'read', text: reference })
          decision = selection(1)
          break
        case 3: {
          expect(authored).toBe(1)
          const output = context.retainedValues.find((value: any) =>
            value.origin.endsWith(':output'),
          )
          expect(output.value).toEqual(exact)
          decision = { ...selection(2), operand: 'value', value: output.handle }
          break
        }
        case 4:
          expect(authored).toBe(2)
          decision = selection(3)
          break
        default:
          throw new Error('unexpected repair/reasoning call')
      }
      checkAgentResult(
        {
          outcome: 'done',
          output: { text: '', structured: decision },
        },
        agentInput.responseSchema,
      )
      return agent(decision)
    })
    expect(messages.at(-1)).toEqual({
      jsonrpc: '2.0',
      id: 'markdown:root',
      result: done({ forwarded: true }),
    })
    expect({ reasoning, authored }).toEqual({ reasoning: 4, authored: 2 })
  })
  test('malformed structured decisions terminate once, without repair or authored effects', async () => {
    const root = await fixture({ 'FLOW.md': 'Choose a complete result.' })
    let calls = 0
    const messages = await exchange(root, null, (request) => {
      calls++
      expect(request.params.slot).toBe('markdown-agent')
      return agent({ action: 'finish' })
    })
    expect(messages.at(-1)).toMatchObject({
      id: 'markdown:root',
      error: { data: { code: 'INVALID_RESULT' } },
    })
    expect(calls).toBe(1)
  })
})
test('reuses a supplied canonical archive without creating a replacement pack', async () => {
  const artifacts = await mkdtemp(join(markdownFixtures.temporary, 'archive-choice-'))
  const supplied = join(await realpath(markdownFixtures.temporary), 'supplied.tgz')
  await writeFile(supplied, 'archive selection fixture; not installed')
  for (const packageName of ['jig', 'flow-sdk'] as const) {
    expect(await selectArchive(artifacts, supplied, packageName)).toBe(supplied)
  }
  expect(await readdir(artifacts)).toEqual([])
  const link = join(markdownFixtures.temporary, 'archive-link.tgz')
  await symlink(supplied, link)
  const directory = join(markdownFixtures.temporary, 'directory.tgz')
  await mkdir(directory)
  for (const invalid of [
    '',
    './relative.tgz',
    supplied + '\0',
    supplied + '.tar',
    link,
    directory,
  ]) {
    await expect(selectArchive(artifacts, invalid)).rejects.toThrow('JIG_PACKAGE_ARCHIVE')
    await expect(selectArchive(artifacts, invalid, 'flow-sdk')).rejects.toThrow(
      'FLOW_SDK_PACKAGE_ARCHIVE',
    )
  }
  expect(await readdir(artifacts)).toEqual([])
})
