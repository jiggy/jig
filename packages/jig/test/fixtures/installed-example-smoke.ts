import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { settleTestCommand } from './bounded-command.js'
import { startExampleSmokeApi } from './example-smoke-api.js'
import type { ExampleSmokeCase } from './example-smoke-cases.js'
import {
  type FoundationQualification,
  foundationEnvironment,
  foundationResidue,
} from './host-foundation/materialize.js'

const repository = resolve(import.meta.dir, '../../../..')
const archiveInputs = [
  ['JIG_PACKAGE_ARCHIVE', 'jig'],
  ['FLOW_SDK_PACKAGE_ARCHIVE', 'flow-sdk'],
  ['REPORTING_PACKAGE_ARCHIVE', 'reporting'],
  ['AGENT_METHOD_PACKAGE_ARCHIVE', 'agent-method'],
  ['AGENT_ACP_PACKAGE_ARCHIVE', 'agent-acp'],
  ['DISPLAY_MODEL_PACKAGE_ARCHIVE', 'display-model'],
  ['DISPLAY_WEB_PACKAGE_ARCHIVE', 'display-web'],
  ['DISPLAY_TUI_PACKAGE_ARCHIVE', 'display-tui'],
] as const
const generated = new Set(['node_modules', '.git', '.jig', 'bun.lock', 'jig.lock'])
const modelName = 'gpt-5.3-codex'
const modelToken = 'jig-example-fixture-api-key'

async function digest(path: string): Promise<string> {
  return createHash('sha256')
    .update(await readFile(path))
    .digest('hex')
}

/** Preserve all authored bytes, including manifests, fixtures and declarations. */
async function sourceTree(directory: string, relative = ''): Promise<Record<string, string>> {
  const result: Record<string, string> = {}
  for (const entry of (await readdir(join(directory, relative), { withFileTypes: true })).sort(
    (a, b) => a.name.localeCompare(b.name),
  )) {
    if (generated.has(entry.name)) continue
    const path = relative ? `${relative}/${entry.name}` : entry.name
    if (entry.isDirectory()) Object.assign(result, await sourceTree(directory, path))
    else {
      assert.ok(entry.isFile(), `Example source must contain ordinary files: ${path}`)
      result[path] = await digest(join(directory, path))
    }
  }
  return result
}

async function requireFile(environment: string, executable = false): Promise<string> {
  const selected = process.env[environment]
  assert.ok(selected && isAbsolute(selected), `${environment} must name an absolute existing file`)
  const path = await realpath(selected)
  const entry = await lstat(path)
  assert.ok(entry.isFile(), `${environment} must select a regular file`)
  if (executable) assert.ok((entry.mode & 0o111) !== 0, `${environment} must be executable`)
  return path
}

/** Refuse absent infrastructure before creating consumers or registering a partial pass. */
export async function requireExampleSmokePrerequisites() {
  assert.equal(process.platform, 'linux', 'Example e2e requires the qualified Linux host')
  assert.equal(
    process.env.JIG_LINUX_ROOTLESS_HOSTILE,
    '1',
    'Example e2e requires native host opt-in',
  )
  const archives = await Promise.all(
    archiveInputs.map(async ([environment, name]) => ({
      name,
      path: await requireFile(environment),
    })),
  )
  return {
    archives,
    codex: await requireFile('JIG_EXAMPLE_CODEX_PATH', true),
    certFile: await requireFile('JIG_EXAMPLE_API_CERT'),
    keyFile: await requireFile('JIG_EXAMPLE_API_KEY'),
  }
}

async function requireNoGitAncestor(directory: string): Promise<void> {
  for (let path = directory; ; path = dirname(path)) {
    const entry = await lstat(join(path, '.git')).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return undefined
      throw error
    })
    assert.equal(entry, undefined, 'Fresh example initialization must not inherit a Git repository')
    if (dirname(path) === path) return
  }
}

/** Execute one unchanged authored example through the installed public CLI. */
export async function runInstalledExampleSmoke(options: {
  example: ExampleSmokeCase
  prerequisites: Awaited<ReturnType<typeof requireExampleSmokePrerequisites>>
  qualification: FoundationQualification
}): Promise<void> {
  const { example, prerequisites, qualification } = options
  const setupDeadline = performance.now() + 420_000
  const root = await realpath(await mkdtemp(join(tmpdir(), `jig-example-e2e-${example.name}-`)))
  const evidence = join(root, 'commands')
  const workspace = join(root, 'workspace')
  const project = join(workspace, 'apps', example.name)
  const tooling = join(root, 'tooling')
  const home = join(root, 'home')
  await mkdir(evidence, { mode: 0o700 })
  await mkdir(home, { mode: 0o700 })
  await mkdir(join(home, '.codex'), { mode: 0o700 })
  await requireNoGitAncestor(root)
  const frozen = await Promise.all(prerequisites.archives.map(({ path }) => digest(path)))
  const model = example.createModel()
  const server = await startExampleSmokeApi({
    certFile: prerequisites.certFile,
    keyFile: prerequisites.keyFile,
    model: modelName,
    token: modelToken,
    expectedRequests: example.expectedRequests,
    reply: model.reply,
  })
  const environment: NodeJS.ProcessEnv = {
    ...foundationEnvironment(),
    HOME: home,
    CODEX_HOME: join(home, '.codex'),
    CODEX_PATH: prerequisites.codex,
    PATH: `${dirname(prerequisites.codex)}:${process.env.PATH ?? ''}`,
    OPENAI_API: 'responses',
    OPENAI_MODEL: modelName,
    OPENAI_BASE_URL: server.baseURL,
    OPENAI_API_KEY: modelToken,
  }
  let sequence = 0
  let phase: 'setup' | 'run' | 'cleanup' = 'setup'
  const command = async (args: string[], cwd: string, timeoutMs = 120_000) => {
    // The outer test must outlast every owned command and its bounded closing.
    // Setup shares one budget even when extraction or installation is slow.
    if (phase === 'setup') {
      const remaining = setupDeadline - performance.now() - 30_000
      assert.ok(remaining > 0, 'Example setup exceeded its seven-minute budget')
      timeoutMs = Math.min(timeoutMs, remaining)
    }
    const child = Bun.spawn(args, {
      cwd,
      env: environment,
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const output = await settleTestCommand(child, {
      evidence: join(evidence, String(++sequence).padStart(3, '0')),
      timeoutMs,
      graceMs: 10_000,
    })
    const code = /Diagnostic code: ([A-Z][A-Z0-9_]{0,63})\b/.exec(output.stderr)?.[1]
    assert.equal(
      output.code,
      0,
      `Example ${example.name} command ${sequence} failed${code ? ` (${code})` : ''}; see ${evidence}`,
    )
    return output
  }
  const failures: unknown[] = []
  let residue: Awaited<ReturnType<typeof foundationResidue>> | undefined
  let authored: Record<string, string> | undefined
  try {
    residue = await foundationResidue(qualification, command, root)
    if (example.expectedRequests > 0) {
      const version = await command([prerequisites.codex, '--version'], root, 15_000)
      assert.match(version.stdout, /^codex-cli \d+\.\d+\.\d+/)
    }
    const source = join(repository, 'examples', example.name)
    authored = await sourceTree(source)
    assert.ok(
      authored['package.json'] && authored['jig.ts'],
      'Example requires original initialization inputs',
    )
    await cp(source, project, {
      recursive: true,
      filter: (path) => !generated.has(basename(path)),
    })
    assert.deepEqual(await sourceTree(project), authored)
    const candidates: Record<string, string> = {}
    for (const archive of prerequisites.archives) {
      const directory = join(workspace, 'packages', archive.name)
      await mkdir(directory, { recursive: true })
      await command(['tar', '-xzf', archive.path, '--strip-components=1', '-C', directory], root)
      const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'))
      assert.equal(typeof manifest.name, 'string')
      assert.equal(typeof manifest.version, 'string')
      candidates[manifest.name] = `file:${archive.path}`
    }
    // This is the repository's ordinary workspace relationship. Only the outer
    // tooling manifest is authored by the test; every application byte is original.
    await writeFile(
      join(workspace, 'package.json'),
      JSON.stringify({
        name: `example-e2e-${example.name}`,
        private: true,
        type: 'module',
        workspaces: ['apps/*', 'apps/*/flows/*', 'packages/*'],
      }),
      { flag: 'wx' },
    )
    await mkdir(tooling)
    await writeFile(
      join(tooling, 'package.json'),
      JSON.stringify({
        name: `example-e2e-${example.name}-tooling`,
        private: true,
        type: 'module',
        dependencies: candidates,
        overrides: candidates,
      }),
      { flag: 'wx' },
    )
    const install = [
      process.execPath,
      '--no-env-file',
      '--config=/dev/null',
      'install',
      '--ignore-scripts',
      '--no-progress',
      '--backend',
      'copyfile',
    ]
    await command(install, tooling)
    await command(install, workspace)
    // Installation may create links and a lock, never repair authored source.
    assert.deepEqual(await sourceTree(project), authored)
    const cli = join(tooling, 'node_modules/.bin/jig')
    const review = [
      cli,
      'review',
      '--yes',
      '--allow-resolution-network',
      '--allow-authority-changes',
    ]
    if (example.expectedRequests > 0) review.push('--agent', 'codex')
    await command(review, project, 180_000)
    assert.deepEqual(await sourceTree(project), authored)
    const packet = example.name === 'support-case' ? undefined : join(root, 'packet')
    const run = [cli, 'run', '--json']
    if (packet !== undefined) run.push('--out', packet)
    phase = 'run'
    const invoked = await command(run, project, example.timeoutMs + 75_000)
    const result = JSON.parse(invoked.stdout)
    assert.equal(result.status, 'succeeded')
    assert.equal(result.outcome, 'done')
    assert.equal(result.cleanup, undefined, 'The CLI reported native cleanup failure')
    await example.assertResult({ result, project, packet })
    assert.deepEqual(
      await sourceTree(project),
      authored,
      'Example setup or Run changed authored files',
    )
  } catch (error) {
    failures.push(error)
  } finally {
    phase = 'cleanup'
    try {
      server.assertConsumed()
      model.assertConsumed()
    } catch (error) {
      failures.push(error)
    }
    try {
      await server.close()
    } catch (error) {
      failures.push(error)
    }
    if (residue !== undefined) {
      try {
        assert.deepEqual(
          await foundationResidue(qualification, command, root),
          residue,
          'Example left native execution residue',
        )
      } catch (error) {
        failures.push(error)
      }
    }
    try {
      assert.deepEqual(
        await Promise.all(prerequisites.archives.map(({ path }) => digest(path))),
        frozen,
        'Example qualification changed frozen archives',
      )
    } catch (error) {
      failures.push(error)
    }
  }
  if (failures.length) {
    console.error(`Example ${example.name} consumer and bounded transcripts retained at ${root}`)
    throw new AggregateError(
      failures,
      `Example ${example.name} did not complete its public first run`,
    )
  }
  await rm(root, { recursive: true, force: true })
}
