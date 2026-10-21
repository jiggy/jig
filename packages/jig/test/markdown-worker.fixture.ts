import { expect } from 'bun:test'
import { mkdir, mkdtemp, readdir, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import { basename, isAbsolute, join, resolve } from 'node:path'
import { flowSdkDirectory } from './fixtures/flow-dependency'

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
export function createMarkdownFixtures() {
  let temporary: string
  let worker: string
  let preserveFailureEvidence = false
  async function fixture(files: Record<string, string>) {
    const root = await mkdtemp(join(temporary, 'package-'))
    for (const [path, content] of Object.entries(files)) await writeFile(join(root, path), content)
    return root
  }
  async function exchange(
    root: string,
    input: unknown,
    respond: (request: any) => unknown,
    channels: Record<string, unknown> = {},
  ) {
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
        protocol: 'run/0',
        input,
        settings: {},
        attachments: {},
        channels,
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
        let newline = pending.indexOf('\n')
        while (newline >= 0) {
          const message = JSON.parse(pending.slice(0, newline))
          pending = pending.slice(newline + 1)
          messages.push(message)
          if (message.id === 'markdown:root') {
            await child.stdin.end()
          } else {
            expect(['flow/call', 'channel/send', 'channel/close']).toContain(message.method)
            send({ jsonrpc: '2.0', id: message.id, result: respond(message) })
          }
          newline = pending.indexOf('\n')
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
  async function writeTypeScriptEcho(root: string, descriptor: string): Promise<void> {
    await mkdir(root)
    await writeFile(join(root, 'FLOW.contract.json'), descriptor)
    await writeFile(join(root, 'FLOW.meta.json'), JSON.stringify({ name: basename(root) }))
    await writeFile(
      join(root, 'FLOW.ts'),
      'import { handle, type RunResult } from "@jigging/flow";\n' +
        'await handle((run) => run.input as RunResult);\n',
    )
    await writeFile(
      join(root, 'package.json'),
      JSON.stringify({
        name: basename(root),
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
      JSON.stringify({ private: true, workspaces: ['flows/*', 'vendor/flow-sdk'] }),
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
      packageName === 'jig'
        ? [process.execPath, 'scripts/pack.ts', '--destination', artifacts]
        : [process.execPath, 'pm', 'pack', '--ignore-scripts', '--destination', artifacts],
      packageName === 'flow-sdk' ? flowSdkDirectory : resolve(packageRoot, '..', packageName),
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
    expectedDiagnostic?: string,
    timeoutMs = 60_000,
  ): Promise<string> {
    const started = Date.now()
    // This installed check must neither depend on nor spend operator Agent access.
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !/^(OPENAI_|OPENROUTER_|JIG_AGENT_)/.test(key)),
    )
    const child = Bun.spawn(args, { cwd, env, stdout: 'pipe', stderr: 'pipe', timeout: timeoutMs })
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
    if (expectedDiagnostic !== undefined) expect(stderr).toContain(expectedDiagnostic)
    return stdout
  }

  return {
    command,
    exchange,
    fixture,
    prepareCandidateSdkWorkspace,
    selectArchive,
    writeTypeScriptEcho,
    get temporary() {
      return temporary
    },
    set temporary(value: string) {
      temporary = value
    },
    get worker() {
      return worker
    },
    set worker(value: string) {
      worker = value
    },
    get preserveFailureEvidence() {
      return preserveFailureEvidence
    },
  }
}
export { agent, block, done, packageRoot, selection }
