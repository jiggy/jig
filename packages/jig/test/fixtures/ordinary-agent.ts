import { expect } from 'bun:test'
import { lstat, mkdir, readdir, realpath, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

/** Install the complete built public artifact without rewriting its source or dependencies. */
export async function writeOrdinaryAgent(
  root: string,
  options: {
    readonly url: string
    readonly api?: 'chat-completions' | 'responses'
    readonly model?: string
    readonly bearerEnv?: string
    readonly maxCompletionTokens?: number
    readonly default?: boolean
  },
): Promise<void> {
  const method = join(root, 'flows/method')
  const artifacts = join(root, 'artifacts')
  await mkdir(method, { recursive: true })
  await mkdir(artifacts, { recursive: true })
  const supplied = process.env.AGENT_METHOD_PACKAGE_ARCHIVE
  let archive: string
  if (supplied !== undefined) {
    archive = await realpath(resolve(supplied))
    if (!(await lstat(archive)).isFile())
      throw new Error('Agent method archive must be a regular file')
  } else {
    const pack = Bun.spawn(
      [process.execPath, '--no-env-file', 'scripts/pack.ts', '--destination', artifacts],
      { cwd: join(import.meta.dir, '../../../agent-method'), stdout: 'pipe', stderr: 'pipe' },
    )
    const [exit, stdout, stderr] = await Promise.all([
      pack.exited,
      new Response(pack.stdout).text(),
      new Response(pack.stderr).text(),
    ])
    expect(exit, `${stdout}\n${stderr}`).toBe(0)
    const archives = (await readdir(artifacts)).filter((name) => name.endsWith('.tgz'))
    expect(archives).toHaveLength(1)
    archive = join(artifacts, archives[0]!)
  }
  const extract = Bun.spawn(['tar', '-xzf', archive, '--strip-components=1', '-C', method], {
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [exit, stdout, stderr] = await Promise.all([
    extract.exited,
    new Response(extract.stdout).text(),
    new Response(extract.stderr).text(),
  ])
  expect(exit, `${stdout}\n${stderr}`).toBe(0)
  await mkdir(join(root, 'bindings'), { recursive: true })
  await writeFile(
    join(root, 'bindings/method.ts'),
    [
      'import { defineBinding } from "@jigging/jig";',
      `export default defineBinding(${JSON.stringify({
        package: 'flows/method',
        settings: {
          api: options.api ?? 'chat-completions',
          model: options.model ?? 'local-recording-fixture',
          maxCompletionTokens: options.maxCompletionTokens ?? 4096,
          structuredOutput: 'json-schema',
        },
        slots: {
          http: {
            kind: 'http',
            method: 'POST',
            url: options.url,
            bearerEnv: options.bearerEnv ?? 'METHOD_TEST_TOKEN',
          },
        },
      })});`,
    ].join('\n'),
  )
  if (options.default)
    await writeFile(
      join(root, 'jig.ts'),
      [
        'import { defineJig, discover } from "@jigging/jig";',
        'export default defineJig({ flows: discover("flows"), bindings: discover("bindings"), defaultProviders: { "https://jig.md/contracts/agent-run": "binding:method" } });',
      ].join('\n'),
    )
}

export function completedResponse(text: string): unknown {
  return {
    object: 'response',
    status: 'completed',
    output: [
      {
        type: 'message',
        role: 'assistant',
        status: 'completed',
        content: [{ type: 'output_text', text }],
      },
    ],
  }
}
