import { expect } from 'bun:test'
import { cp, mkdir, mkdtemp, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { main, type PrivateCliOptions } from '../../src/cli.js'
import { openPrivateProjectSession } from '../../src/internal/project-session-controller.js'
import { installedBunLocation } from './installed-bun-location.js'
import {
  openDeterministicFiniteAcpHost,
  deterministicAcpProgram,
} from './deterministic-acp-agent.js'

export async function qualifyIncidentBrief(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'jig-incident-contained-'))
  const project = join(root, 'app')
  const release = join(root, 'release')
  async function command(args: string[], cwd: string) {
    const child = Bun.spawn(args, { cwd, stdout: 'pipe', stderr: 'pipe' })
    const [exit, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    expect(exit, stdout + stderr).toBe(0)
  }
  await cp(resolve(import.meta.dir, '../../../../examples/incident-brief'), project, {
    recursive: true,
    filter: (path) => !['node_modules', '.jig'].includes(basename(path)),
  })
  await mkdir(join(root, 'packages'))
  for (const [name, variable] of [
    ['flow-sdk', 'FLOW_SDK_PACKAGE_ARCHIVE'],
    ['agent-method', 'AGENT_METHOD_PACKAGE_ARCHIVE'],
    ['agent-acp', 'AGENT_ACP_PACKAGE_ARCHIVE'],
  ] as const) {
    const dir = join(root, 'packages', name)
    await mkdir(dir)
    let archive = process.env[variable]
    if (archive === undefined) {
      await command(
        [process.execPath, 'pm', 'pack', '--ignore-scripts', '--destination', dir],
        resolve(import.meta.dir, '../../../', name),
      )
      const archives = (await readdir(dir)).filter((name) => name.endsWith('.tgz'))
      expect(archives).toHaveLength(1)
      archive = join(dir, archives[0]!)
    }
    await command(['tar', '-xzf', await realpath(archive), '--strip-components=1', '-C', dir], root)
  }
  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({ private: true, workspaces: ['packages/*', 'app', 'app/flows/*'] }),
  )
  await command(
    [process.execPath, '--no-env-file', 'install', '--ignore-scripts', '--config=/dev/null'],
    root,
  )
  await cp(join(installedBunLocation.releaseRoot, 'libexec'), join(release, 'libexec'), {
    recursive: true,
  })
  await mkdir(join(release, 'node_modules/@oven/bun-linux-x64-baseline/bin'), { recursive: true })
  const executablePath = await realpath(installedBunLocation.executablePath)
  await symlink(executablePath, join(release, 'node_modules/@oven/bun-linux-x64-baseline/bin/bun'))
  await writeFile(
    join(release, 'libexec/agent/fixture-acp.js'),
    deterministicAcpProgram().replace(
      ".find(value => text.includes('scenario:' + value));",
      ".find(value => text.includes('scenario:' + value)) ?? 'success';",
    ),
  )
  const events: unknown[] = []
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      expect(request.headers.get('authorization')).toBe('Bearer synthetic-handoff-only')
      events.push(await request.json())
      return new Response('recorded')
    },
  })
  let clean = false
  try {
    const host = await openDeterministicFiniteAcpHost(
      {
        releaseRoot: release,
        executablePath,
        installedCliPath: join(release, 'libexec/installed-cli.js'),
      },
      {
        METHOD_TEST_TOKEN: 'synthetic-handoff-only',
        ACP_TEST_ENDPOINT: `http://127.0.0.1:${server.port}/dispatch`,
      },
      project,
    )
    let stdout = '',
      stderr = ''
    const options: PrivateCliOptions = {
      currentDirectory: project,
      interactive: false,
      writeOutput(text: string) {
        stdout += text
      },
      async writeRecord(text: string) {
        stdout += text
      },
      writeError(text: string) {
        stderr += text
      },
      host: {
        acquire: (directory, overrides) =>
          openPrivateProjectSession({ directory, host: { ...host, ...overrides } }),
      },
    }
    expect(
      await main(['review', '--yes', '--allow-authority-changes'], options),
      stdout + stderr,
    ).toBe(0)
    stdout = ''
    stderr = ''
    const code = await main(
      ['run', 'binding:brief', '--input', '@input.json', '--timeout', '90s', '--json'],
      options,
    )
    await writeFile(join(root, 'result.json'), stdout)
    await writeFile(join(root, 'stderr.txt'), stderr)
    expect(code, stdout + stderr).toBe(0)
    const result = JSON.parse(stdout)
    expect(result.status).toBe('succeeded')
    expect(result.outcome).toBe('done')
    expect(events).toHaveLength(5)
    expect(result.output.results.map((entry: any) => entry.result.outcome)).toEqual([
      'done',
      'done',
    ])
    expect(result.output.results[0].result.output.predecessor).toEqual({
      outcome: 'done',
      output: { turns: 2 },
    })
    expect(result.output.results[0].result.output.requestedTurns).toBe(3)
    expect(result.output.results[0].result.output.handoff.remainingTurns).toBe(1)
    expect(result.output.results[1].result.output.requestedTurns).toBe(2)
    expect(result.output.results[0].result.output.revision).toBe(1)
    expect(result.output.results[1].result.output.publication.status).toBe('submitted')
    expect(
      (await readdir(process.env.AGENT_DELEGATED_CGROUP!)).filter((name) =>
        name.startsWith('jig-run-'),
      ),
    ).toEqual([])
    for (const name of ['private-root-linux-owners', 'private-root-materializations']) {
      expect(
        (await readdir(join(project, '.jig', name))).filter((entry) =>
          /^(a-|c-|x-|child-)/.test(entry),
        ),
      ).toEqual([])
    }
    clean = true
  } finally {
    await server.stop(true)
    if (clean) await rm(root, { recursive: true, force: true })
    else console.error(`Incident brief host failure; retained ${root}`)
  }
}
