import { expect } from 'bun:test'
import { lstat, mkdir, readdir, realpath, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

/** Install the unchanged built Agent Flow and authorize only its selected native profile. */
export async function writeOrdinaryAcpAgent(
  root: string,
  client: 'codex' | 'claude' | 'pi',
): Promise<void> {
  const method = join(root, 'flows/agent')
  const artifacts = join(root, 'artifacts/acp')
  await mkdir(method, { recursive: true })
  await mkdir(artifacts, { recursive: true })
  let archive = process.env.AGENT_ACP_PACKAGE_ARCHIVE
  if (archive !== undefined) {
    archive = await realpath(resolve(archive))
    if (!(await lstat(archive)).isFile())
      throw new Error('ACP Agent archive must be a regular file')
  } else {
    const pack = Bun.spawn(
      [process.execPath, '--no-env-file', 'scripts/pack.ts', '--destination', artifacts],
      { cwd: join(import.meta.dir, '../../../agent-acp'), stdout: 'pipe', stderr: 'pipe' },
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
    join(root, 'bindings/agent.ts'),
    `import {defineBinding} from "@jigging/jig"; export default defineBinding(${JSON.stringify({
      package: 'flows/agent',
      slots: { native: { kind: 'acp', client } },
    })});`,
  )
  await writeFile(
    join(root, 'jig.ts'),
    'import {defineJig,discover} from "@jigging/jig"; export default defineJig({flows:discover("flows"),bindings:discover("bindings"),defaultProviders: { "https://jig.md/contracts/agent-run": "binding:agent" }});',
  )
}
