import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'

import { markdownAgentContract } from '../src/internal/markdown-agent-contract.js'
import { assertPrivateAgentResponseSchema } from '../src/internal/openai-agent-client.js'
import { parseAgentRunInput, parseAgentRunResult } from '../src/internal/private-agent-run.js'
import { MARKDOWN_INTERPRETER_TEMPLATE } from '../src/markdown/runtime.js'

const packageRoot = resolve(import.meta.dir, '..')
const block = (instruction: string) => `\`\`\`flow\n${instruction}\n\`\`\`\n`
const done = (output: unknown) => ({ outcome: 'done', output })
const selection = (recipe: number) => ({
  action: 'recipe',
  recipe,
  operand: 'none',
  value: '',
  path: '',
})
const agent = (structured: unknown) => done({ text: '', structured })
const hosted = process.env.JIG_LINUX_ROOTLESS_HOSTILE === '1' ? describe.serial : describe.skip
let temporary: string
let worker: string
let preserveFailureEvidence = false

beforeAll(async () => {
  temporary = await mkdtemp(join(tmpdir(), 'jig-markdown-worker-test-'))
  worker = join(temporary, 'markdown-runtime.js')
  const build = await Bun.build({
    entrypoints: [join(packageRoot, 'src/internal/markdown-runtime-worker.ts')],
    target: 'bun',
    format: 'esm',
    outdir: temporary,
    naming: 'markdown-runtime.js',
  })
  expect(build.success).toBe(true)
})

afterAll(async () => {
  if (temporary === undefined) return
  if (preserveFailureEvidence) {
    console.error(`Installed Markdown failure evidence retained at ${temporary}`)
  } else {
    await rm(temporary, { recursive: true, force: true })
  }
})

async function fixture(files: Record<string, string>) {
  const root = await mkdtemp(join(temporary, 'package-'))
  for (const [path, content] of Object.entries(files)) await writeFile(join(root, path), content)
  return root
}

// A deterministic wire peer is evidence for the bundled worker/SDK seam, not a
// provider or containment claim. Responses enter only through public FLOW/1.
async function exchange(root: string, input: unknown, respond: (request: any) => unknown) {
  const child = Bun.spawn([process.execPath, worker, join(root, 'FLOW.md')], {
    cwd: root,
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: 15_000,
  })
  const stderr = new Response(child.stderr).text()
  const send = (value: unknown) => {
    child.stdin.write(JSON.stringify(value) + '\n')
    child.stdin.flush()
  }
  send({
    jsonrpc: '2.0',
    id: 'markdown:root',
    method: 'flow/run',
    params: {
      protocol: 'run/1',
      input,
      settings: {},
      attachments: {},
      scratch: root,
      deadlineUnixMs: Date.now() + 10_000,
    },
  })
  const messages: any[] = []
  const decoder = new TextDecoder()
  let pending = ''
  let received = 0
  try {
    for await (const bytes of child.stdout) {
      received += bytes.byteLength
      if (received > 8_388_608) throw new Error('worker trace exceeds its test bound')
      pending += decoder.decode(bytes, { stream: true })
      let newline: number
      while ((newline = pending.indexOf('\n')) >= 0) {
        const message = JSON.parse(pending.slice(0, newline))
        pending = pending.slice(newline + 1)
        messages.push(message)
        if (message.id === 'markdown:root') {
          await child.stdin.end()
        } else {
          expect(message.method).toBe('flow/call')
          send({ jsonrpc: '2.0', id: message.id, result: respond(message) })
        }
      }
    }
    expect(pending + decoder.decode()).toBe('')
    expect(await child.exited).toBe(0)
    expect(await stderr).toBe('')
    return messages
  } finally {
    if (child.exitCode === null) child.kill()
    await child.exited
  }
}

describe('bundled Markdown worker over FLOW/1', () => {
  test('executes a frontmatter-free direct recipe without requesting an Agent', async () => {
    const root = await fixture({ 'FLOW.md': block('return @input') })
    const result = done({ exact: ['😺', null, 0] })
    const messages = await exchange(root, result, () => {
      throw new Error('unexpected call')
    })
    expect(messages).toEqual([{ jsonrpc: '2.0', id: 'markdown:root', result }])
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
      const prepared = parseAgentRunInput(contract, call.input)
      assertPrivateAgentResponseSchema(prepared.input.responseSchema!)
      expect(prepared.input.instructions.startsWith(MARKDOWN_INTERPRETER_TEMPLATE + '\n\n')).toBe(
        true,
      )
      const context = JSON.parse(
        prepared.input.instructions.slice(MARKDOWN_INTERPRETER_TEMPLATE.length + 2),
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
      parseAgentRunResult(contract, prepared, {
        outcome: 'completed',
        text: '',
        structured: decision as any,
      })
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
  const artifacts = await mkdtemp(join(temporary, 'archive-choice-'))
  const supplied = join(await realpath(temporary), 'supplied.tgz')
  await writeFile(supplied, 'archive selection fixture; not installed')
  for (const packageName of ['jig', 'flow-sdk'] as const) {
    expect(await selectArchive(artifacts, supplied, packageName)).toBe(supplied)
  }
  expect(await readdir(artifacts)).toEqual([])
  const link = join(temporary, 'archive-link.tgz')
  await symlink(supplied, link)
  const directory = join(temporary, 'directory.tgz')
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

hosted('fresh installed Markdown on the provisioned proof host', () => {
  test('substitutes an exact typed TypeScript child without changing its Markdown caller', async () => {
    const root = await mkdtemp(join(temporary, 'installed-'))
    const artifacts = join(root, 'artifacts')
    const sdkArtifacts = join(root, 'sdk-artifacts')
    const consumer = join(root, 'consumer')
    await mkdir(artifacts)
    await mkdir(sdkArtifacts)
    await mkdir(consumer)
    const archive = await selectArchive(artifacts)
    await writeFile(
      join(consumer, 'package.json'),
      JSON.stringify({
        private: true,
        dependencies: { '@jigging/jig': `file:${archive}` },
      }),
    )
    await command(
      [
        process.execPath,
        'install',
        '--ignore-scripts',
        '--no-progress',
        '--backend',
        'copyfile',
        '--network-concurrency',
        '1',
      ],
      consumer,
    )
    const jig = join(consumer, 'node_modules/.bin/jig')
    const project = join(consumer, 'project')
    await command([jig, 'init', '--bare', project], consumer)
    const resultSchema = {
      type: 'object',
      properties: { outcome: { const: 'done' }, output: {} },
      required: ['outcome', 'output'],
      additionalProperties: false,
    }
    const descriptor = JSON.stringify({
      $schema: 'https://flow.jig.md/schemas/invocation-contract-1.schema.json',
      id: 'https://example.org/markdown-echo',
      version: '1.0.0',
      input: resultSchema,
      result: resultSchema,
    })
    for (const name of ['echo', 'caller']) await mkdir(join(project, 'flows', name))
    await writeFile(join(project, 'flows/echo/FLOW.md'), block('return @input'))
    await writeFile(join(project, 'flows/echo/contract.json'), descriptor)
    await writeFile(join(project, 'flows/caller/echo.contract.json'), descriptor)
    const callerSource =
      '---\nuses:\n  echo:\n    contract: ./echo.contract.json\n---\n' +
      block('call echo @input') +
      '\n' +
      block('return @previous')
    await writeFile(join(project, 'flows/caller/FLOW.md'), callerSource)
    await writeTypeScriptEcho(join(project, 'flows/code-echo'), descriptor)
    await prepareCandidateSdkWorkspace(
      project,
      await selectArchive(sdkArtifacts, undefined, 'flow-sdk'),
    )
    await writeFile(
      join(project, 'bindings/caller.ts'),
      'import { defineBinding } from "@jigging/jig"; export default defineBinding({ package: "./flows/caller", slots: { echo: "flow:flows/echo" } });\n',
    )
    await command([jig, 'review', '--yes'], project)
    const output = { exact: ['😺', null], text: 'x'.repeat(102_400) }
    let markdownResult: unknown
    for (const target of ['flow:flows/echo', 'binding:caller']) {
      const result = JSON.parse(
        await command(
          [jig, 'run', target, '--input', JSON.stringify(done(output))],
          project,
          0,
          `Markdown target ${target}`,
        ),
      )
      expect(result).toMatchObject({ status: 'succeeded', outcome: 'done', output })
      if (target === 'binding:caller') markdownResult = result.output
    }
    await writeFile(
      join(project, 'bindings/caller.ts'),
      'import { defineBinding } from "@jigging/jig"; export default defineBinding({ package: "./flows/caller", slots: { echo: "flow:flows/code-echo" } });\n',
    )
    await command([jig, 'review', '--yes'], project)
    const substituted = JSON.parse(
      await command(
        [jig, 'run', 'binding:caller', '--input', JSON.stringify(done(output))],
        project,
        0,
        'substituted TypeScript child',
      ),
    )
    expect(substituted).toMatchObject({ status: 'succeeded', outcome: 'done', output })
    expect(substituted.output).toEqual(markdownResult)
    const deadlineStarted = Date.now()
    const expired = JSON.parse(
      await command(
        [
          jig,
          'run',
          'binding:caller',
          '--input',
          JSON.stringify(done('delay-until-root-deadline')),
          '--timeout',
          '2s',
        ],
        project,
        1,
        'Markdown root deadline',
      ),
    )
    expect(expired).toMatchObject({ status: 'failed', code: 'DEADLINE_EXCEEDED' })
    expect(Object.hasOwn(expired, 'cleanup')).toBe(false)
    expect(Date.now() - deadlineStarted).toBeLessThan(20_000)
    const recovered = JSON.parse(
      await command(
        [jig, 'run', 'binding:caller', '--input', JSON.stringify(done(output))],
        project,
        0,
        'ordinary call after root deadline',
      ),
    )
    expect(recovered).toMatchObject({ status: 'succeeded', outcome: 'done', output })
    expect(recovered.output).toEqual(markdownResult)
    expect(await readFile(join(project, 'flows/caller/FLOW.md'), 'utf8')).toBe(callerSource)
    for (const path of [
      'flows/caller/echo.contract.json',
      'flows/echo/contract.json',
      'flows/code-echo/contract.json',
    ]) {
      expect(await readFile(join(project, path), 'utf8')).toBe(descriptor)
    }
  }, 120_000)
})

async function writeTypeScriptEcho(root: string, descriptor: string): Promise<void> {
  await mkdir(root)
  await writeFile(join(root, 'contract.json'), descriptor)
  await writeFile(join(root, 'flow.meta.json'), JSON.stringify({ name: 'code-echo' }))
  await writeFile(
    join(root, 'FLOW.ts'),
    'import { handle, type RunResult } from "@jigging/flow";\n' +
      'await handle(async (run) => {\n' +
      '  const result = run.input as RunResult;\n' +
      '  if (result.output === "delay-until-root-deadline") {\n' +
      '    await new Promise((resolve) => setTimeout(resolve, 30_000));\n' +
      '  }\n' +
      '  return result;\n' +
      '});\n',
  )
  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({
      name: 'code-echo',
      private: true,
      dependencies: { '@jigging/flow': 'workspace:*' },
    }),
  )
}

async function prepareCandidateSdkWorkspace(project: string, archive: string): Promise<void> {
  // Qualify the complete public candidate archive through ordinary workspace
  // capture and frozen preparation, without private source or dependency injection.
  const sdk = join(project, 'vendor/flow-sdk')
  await mkdir(sdk, { recursive: true })
  await command(['tar', '-xzf', archive, '--strip-components=1', '-C', sdk], project)
  const manifest = JSON.parse(await readFile(join(sdk, 'package.json'), 'utf8'))
  expect(manifest.name).toBe('@jigging/flow')
  expect((await readdir(sdk)).sort()).toEqual(['LICENSE', 'README.md', 'dist', 'package.json'])
  await writeFile(
    join(project, 'package.json'),
    JSON.stringify({ private: true, workspaces: ['flows/code-echo', 'vendor/flow-sdk'] }),
  )
  await command(
    [process.execPath, 'install', '--lockfile-only', '--ignore-scripts', '--no-progress'],
    project,
  )
  const lock = await readFile(join(project, 'bun.lock'), 'utf8')
  expect(lock).toContain('@jigging/flow@workspace:vendor/flow-sdk')
  expect(await readdir(join(project, 'flows/code-echo'))).not.toContain('node_modules')
}

async function selectArchive(
  artifacts: string,
  supplied?: string,
  packageName: 'jig' | 'flow-sdk' = 'jig',
): Promise<string> {
  const variable = packageName === 'jig' ? 'JIG_PACKAGE_ARCHIVE' : 'FLOW_SDK_PACKAGE_ARCHIVE'
  supplied ??= process.env[variable]
  if (supplied !== undefined) {
    if (!isAbsolute(supplied) || supplied.includes('\0') || !supplied.endsWith('.tgz'))
      throw new Error(`${variable} must name one absolute .tgz file`)
    const canonical = await realpath(supplied)
    if (canonical !== supplied || !(await stat(canonical)).isFile())
      throw new Error(`${variable} must name one canonical regular file`)
    return canonical
  }
  await command(
    [process.execPath, 'pm', 'pack', '--ignore-scripts', '--destination', artifacts],
    resolve(packageRoot, '..', packageName),
  )
  const archives = (await readdir(artifacts)).filter((name) => name.endsWith('.tgz'))
  expect(archives).toHaveLength(1)
  return join(artifacts, archives[0]!)
}

async function command(
  args: string[],
  cwd: string,
  expectedCode = 0,
  stage?: string,
): Promise<string> {
  const started = Date.now()
  const child = Bun.spawn(args, { cwd, stdout: 'pipe', stderr: 'pipe', timeout: 60_000 })
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  expect(stdout.length + stderr.length).toBeLessThan(4_194_304)
  if (code !== expectedCode) {
    preserveFailureEvidence = true
    const action = args.slice(1, 3).join(' ')
    await writeFile(
      join(temporary, 'failed-command.json'),
      JSON.stringify({
        action,
        stage,
        cwd,
        code,
        expectedCode,
        elapsedMs: Date.now() - started,
        stdout,
        stderr,
      }),
    )
    throw new Error(
      `Public command ${action}${stage === undefined ? '' : ` (${stage})`} failed (${code}) after ${Date.now() - started}ms: ${stderr}\n${stdout}`,
    )
  }
  return stdout
}
