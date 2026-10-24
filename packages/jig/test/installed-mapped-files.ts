import assert from 'node:assert/strict'
import { lstat, mkdir, realpath, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
import { settleTestCommand } from './fixtures/bounded-command.js'
import {
  assertMappedFilesPacket,
  writeMappedFilesProject,
} from './fixtures/mapped-files-project.js'

/** Optional profiles share the existing private evidence directory, never Flow inputs. */
export async function mappedFilesCommandEnvironment(
  profile?: 'leaf' | 'composed',
  operatorEnvironment: Readonly<NodeJS.ProcessEnv> = process.env,
): Promise<NodeJS.ProcessEnv> {
  const environment: NodeJS.ProcessEnv = {}
  for (const key of [
    'PATH',
    'HOME',
    'TMPDIR',
    'XDG_RUNTIME_DIR',
    'DBUS_SESSION_BUS_ADDRESS',
    'FLOW_NODE',
    'JIG_AUTHORING_NODE_PATH',
  ])
    if (operatorEnvironment[key] !== undefined) environment[key] = operatorEnvironment[key]
  const directory = operatorEnvironment.JIG_PACKAGE_SMOKE_DIAGNOSTIC_DIRECTORY
  if (!directory || (profile !== 'leaf' && profile !== 'composed')) return environment
  try {
    if (!isAbsolute(directory) || (await realpath(directory)) !== directory) return environment
    const owner = await lstat(directory)
    if (
      !owner.isDirectory() ||
      owner.isSymbolicLink() ||
      owner.uid !== process.geteuid?.() ||
      (owner.mode & 0o022) !== 0
    )
      return environment
    environment.JIG_PRIVATE_PROFILE_FILE = join(
      directory,
      `installed-mapped-files-${profile}-run-profile.txt`,
    )
  } catch {
    // Optional observation cannot change the installed command's outcome.
  }
  return environment
}

/** Actual public CLI and packed SDK; no private runtime injected into Flow code. */
export async function checkInstalledMappedFiles(options: {
  readonly directory: string
  readonly cli: string
  readonly sdkArchive: string
}): Promise<void> {
  const operatorEnvironment = { ...process.env }
  const evidence = `${options.directory}.commands`
  await mkdir(evidence, { mode: 0o700 })
  let index = 0
  const command = async (
    args: string[],
    cwd = options.directory,
    profile?: 'leaf' | 'composed',
  ) => {
    const environment = await mappedFilesCommandEnvironment(profile, operatorEnvironment)
    const child = Bun.spawn(args, { cwd, env: environment, stdout: 'pipe', stderr: 'pipe' })
    const result = await settleTestCommand(child, {
      evidence: join(evidence, String(++index).padStart(3, '0')),
      timeoutMs: 120_000,
    })
    assert.equal(
      result.code,
      0,
      `${args[1]} failed (${result.code})\n${result.stdout}${result.stderr}`,
    )
    return result
  }
  await command([options.cli, 'init', options.directory, '--bare'], dirname(options.directory))
  await writeMappedFilesProject({
    root: options.directory,
    jigVersion: 'workspace:*',
    flowVersion: 'workspace:*',
  })
  // Consume the packed FLOW SDK as an ordinary captured workspace dependency.
  await writeFile(
    join(options.directory, 'package.json'),
    JSON.stringify({
      private: true,
      type: 'module',
      workspaces: ['flows/*', 'libs/*'],
    }),
  )
  const library = join(options.directory, 'libs/flow')
  await mkdir(library, { recursive: true })
  await command(['tar', '-xzf', options.sdkArchive, '--strip-components=1', '-C', library])
  await command([options.cli, 'review', '--yes', '--allow-resolution-network'])
  const directory = await realpath(options.directory)
  const source = join(directory, 'source')
  const independent = join(directory, 'leaf-packet')
  const composed = join(directory, 'composed-packet')
  for (const [target, packet, composition] of [
    ['flow:flows/copy', independent, false],
    ['binding:root', composed, true],
  ] as const) {
    const result = await command(
      [
        options.cli,
        'run',
        target,
        '--input',
        'null',
        '--attach',
        `source=${source}`,
        '--out',
        packet,
        '--timeout',
        '90s',
      ],
      options.directory,
      composition ? 'composed' : 'leaf',
    )
    assert.equal(JSON.parse(result.stdout).status, 'succeeded')
    await assertMappedFilesPacket(packet, source, composition)
  }
}
