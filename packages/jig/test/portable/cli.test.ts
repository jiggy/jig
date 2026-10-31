import { afterAll, beforeAll, expect, test } from 'bun:test'
import { ATTEMPT_REQUEST_BYTES } from '../../src/attempt-contract.js'
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  foundationCommands,
  foundationEnvironment,
  freezeFoundationArchives,
} from '../fixtures/host-foundation/materialize.js'
import { settleTestCommand } from '../fixtures/bounded-command.js'

// No review or execution: unchanged installed commands and actual files only.
let root: string
let cli: string
let sequence = 0
let passed = 0
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'jig-installed-cli-portable-'))
  const setup = foundationCommands(join(root, 'setup'))
  const archives = await freezeFoundationArchives(root, setup)
  await writeFile(join(root, 'package.json'), JSON.stringify({
    private: true,
    dependencies: { '@jigging/jig': `file:${archives.jig}` },
  }))
  await setup([process.execPath, 'install', '--ignore-scripts', '--no-progress', '--backend', 'copyfile'], root, 120_000)
  cli = join(root, 'node_modules/.bin/jig')
}, 300_000)

async function invoke(args: string[], cwd = root, input?: string, environment: NodeJS.ProcessEnv = {}) {
  const child = Bun.spawn([cli, ...args], {
    cwd,
    env: { ...foundationEnvironment(), ...environment },
    stdin: input === undefined ? 'ignore' : new Blob([input]),
    stdout: 'pipe',
    stderr: 'pipe',
  })
  return settleTestCommand(child, {
    evidence: join(root, `command-${++sequence}`),
    timeoutMs: 15_000,
  })
}

test('installed help is focused and version matches the installed manifest', async () => {
  for (const args of [['--help'], ['init', '--help'], ['review', '-h'], ['run', '--help'], ['inspect', '--help']]) {
    const result = await invoke(args)
    expect(result.code).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout).toContain('Usage:')
    if (args[0] === 'run') {
      expect(result.stdout).toContain('--timeout DURATION')
      expect(result.stdout).toContain('default: 30s')
      expect(result.stdout).not.toContain('Usage: jig review')
    }
    if (args[0] === 'review') {
      expect(result.stdout).toContain('--details')
      expect(result.stdout).toContain('--yes alone does not approve new resource authority')
    }
    if (args[0] === 'init') expect(result.stdout).toContain('--bare')
    if (args[0] !== 'init') {
      expect(result.stdout).toContain('--verification MODE')
      expect(result.stdout).toContain('Fast can miss changed tool bytes')
    }
  }
  const manifest = JSON.parse(await readFile(join(root, 'node_modules/@jigging/jig/package.json'), 'utf8'))
  expect(await invoke(['--version'])).toMatchObject({ code: 0, stdout: `${manifest.version}\n`, stderr: '' })
  expect(await invoke(['--version'], root, undefined, {
    PATH: '/nonexistent', BUN_OPTIONS: 'invalid', NODE_OPTIONS: 'invalid',
  })).toMatchObject({ code: 0, stdout: `${manifest.version}\n`, stderr: '' })
  passed++
})

test('installed invalid grammar refuses without disclosing rejected private values', async () => {
  const cases = [
    ['--version', 'extra'],
    ['unknown-command'],
    ['run', 'flow:../private'],
    ['run', 'flow:flows/hello', '--input', '{"secret":'],
    ...['0', '-1', 'NaN', '9007199254740992ms', '25h'].map(value => ['run', 'flow:flows/hello', '--timeout', value]),
    ...[['review'], ['inspect'], ['run', 'flow:flows/hello']].flatMap(prefix => [
      [...prefix, '--verification'],
      [...prefix, '--verification', 'private-invalid-value'],
      [...prefix, '--verification', 'fast', '--verification', 'strict'],
    ]),
    ['run', 'flow:flows/hello', '--attach'],
    ['run', 'flow:flows/hello', '--out'],
    ['init', 'unselected', '--agent', 'unknown'],
  ]
  const project = join(root, 'grammar')
  await mkdir(project)
  for (const args of cases) {
    const result = await invoke(args, project)
    expect(result.stdout).toBe('')
    const code = args[0] === '--version' || args[0] === 'unknown-command'
      ? 'JIG_UNKNOWN_COMMAND'
      : args.includes('--timeout')
      ? 'JIG_RUN_TIMEOUT_INVALID'
      : args[1] === 'flow:../private'
      ? 'JIG_RUN_TARGET_INVALID'
      : args.includes('{"secret":')
        ? 'JIG_RUN_INPUT_INVALID'
        : 'JIG_USAGE'
    expect(result.code, JSON.stringify(args)).toBe(code.startsWith('JIG_RUN_') ? 1 : 2)
    expect(result.stderr).toContain(code)
    expect(result.stderr).not.toContain('private-invalid-value')
    expect(await readdir(project)).toEqual([])
  }
  passed++
}, 60_000)

test('installed bare init writes only the inert envelope and preserves existing destinations', async () => {
  const project = join(root, 'bare')
  const initialized = await invoke(['init', '--bare', project])
  expect(initialized.code).toBe(0)
  expect(initialized.stderr).toBe('')
  expect(initialized.stdout).toContain('Created bare Jig project')
  expect((await readdir(project)).sort()).toEqual(['.gitignore', 'bindings', 'flows', 'jig.ts'])
  expect(await readdir(join(project, 'flows'))).toEqual([])
  expect(await readdir(join(project, 'bindings'))).toEqual([])
  expect(await readFile(join(project, '.gitignore'), 'utf8')).toBe('.jig/\n')
  expect(await readFile(join(project, 'jig.ts'), 'utf8')).toBe([
    'import { defineJig, discover } from "@jigging/jig";',
    '',
    'export default defineJig({',
    '  flows: discover("./flows"),',
    '  bindings: discover("./bindings"),',
    '});',
    '',
  ].join('\n'))
  await writeFile(join(project, 'owned.txt'), 'keep\n')
  const refused = await invoke(['init', '--bare', project])
  expect(refused.code).toBe(1)
  expect(refused.stdout).toBe('')
  expect(refused.stderr).toContain('JIG_INIT_DESTINATION_EXISTS')
  expect(refused.stderr).not.toContain(project)
  expect(await readFile(join(project, 'owned.txt'), 'utf8')).toBe('keep\n')
  const unavailable = await invoke(['init', '--bare', join(root, 'missing-parent/project')])
  expect(unavailable.code).toBe(2)
  expect(unavailable.stderr).toContain('JIG_INIT_UNAVAILABLE')
  expect(unavailable.stderr).not.toMatch(/ENOENT|missing-parent/)
  passed++
})

test('concurrent installed bare initializers have exactly one winner', async () => {
  const destination = join(root, 'concurrent')
  const results = await Promise.all([
    invoke(['init', '--bare', destination]),
    invoke(['init', '--bare', destination]),
  ])
  expect(results.map(result => result.code).sort()).toEqual([0, 1])
  expect((await readdir(destination)).sort()).toEqual(['.gitignore', 'bindings', 'flows', 'jig.ts'])
  passed++
})

test('installed greeting and Agent initialization create ordinary editable files without authority', async () => {
  const current = JSON.parse(await readFile(join(root, 'node_modules/@jigging/jig/package.json'), 'utf8'))
  for (const client of [undefined, 'codex', 'claude', 'pi']) {
    const project = join(root, client ?? 'greeting')
    const result = await invoke(['init', project, ...(client ? ['--agent', client] : [])])
    expect(result.code).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout).not.toContain('\u001b')
    expect(await readFile(join(project, 'flows/hello/FLOW.ts'), 'utf8')).toContain('import { handle } from "@jigging/flow"')
    const projectManifest = JSON.parse(await readFile(join(project, 'package.json'), 'utf8'))
    expect(projectManifest.peerDependencies).toEqual({ '@jigging/jig': current.version })
    expect(projectManifest.peerDependenciesMeta).toEqual({ '@jigging/jig': { optional: true } })
    if (client) {
      expect(await readFile(join(project, 'bindings/agent.ts'), 'utf8')).toContain(`client: ${JSON.stringify(client)}`)
      expect(await readFile(join(project, 'jig.ts'), 'utf8')).toContain('defaultProviders:')
    } else {
      expect(result.stdout).toContain('jig review --allow-resolution-network')
      expect(result.stdout).toContain(`jig run flow:flows/hello --input '"Ada"'`)
    }
    for (const path of ['.jig', 'jig.lock', 'node_modules', 'bun.lock'])
      await expect(lstat(join(project, path))).rejects.toMatchObject({ code: 'ENOENT' })
  }
  passed++
})

test('installed review explains incompatible versions before evaluating source or acquiring state', async () => {
  const project = join(root, 'version-requirement')
  await mkdir(project)
  await writeFile(join(project, 'jig.ts'), 'throw new Error("MUST_NEVER_EVALUATE_PRIVATE")\n')
  for (const required of ['0.0.0-alpha.1', '999.0.0']) {
    await writeFile(join(project, 'package.json'), JSON.stringify({
      private: true, peerDependencies: { '@jigging/jig': required },
    }))
    const before = await readdir(project)
    const result = await invoke(['review', '--allow-resolution-network'], project)
    expect(result.code).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('PROJECT_JIG_VERSION_MISMATCH')
    expect(result.stderr).toContain('requires Jig ' + required)
    expect(result.stderr).toContain('Executable:')
    expect(result.stderr).toContain('bun install --global @jigging/jig@' + required)
    expect(result.stderr).toContain('npm install --global @jigging/jig@' + required)
    expect(result.stderr).not.toContain('just jig::build')
    expect(result.stderr).not.toContain('MUST_NEVER_EVALUATE_PRIVATE')
    expect(await readdir(project)).toEqual(before)
  }
  // A packaged executable running from Jig's real repository still owns
  // installation recovery. The working directory cannot choose rebuild advice.
  const fromRepository = await invoke(['review', project], packageRoot)
  expect(fromRepository.stderr).toContain('PROJECT_JIG_VERSION_MISMATCH')
  expect(fromRepository.stderr).toContain('npm install --global')
  expect(fromRepository.stderr).not.toContain('just jig::build')
  for (const required of ['*', '^0.1.0', 'PRIVATE_SECRET; touch /private/credential', null]) {
    await writeFile(join(project, 'package.json'), JSON.stringify({
      peerDependencies: { '@jigging/jig': required },
    }))
    const result = await invoke(['review'], project)
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('PROJECT_JIG_REQUIREMENT_INVALID')
    expect(result.stderr).not.toContain('PRIVATE_SECRET')
    expect(result.stderr).not.toContain('MUST_NEVER_EVALUATE_PRIVATE')
  }
  const current = JSON.parse(await readFile(join(root, 'node_modules/@jigging/jig/package.json'), 'utf8'))
  await writeFile(join(project, 'package.json'), JSON.stringify({
    peerDependencies: { '@jigging/jig': current.version },
  }))
  await writeFile(join(project, 'jig.ts'), 'export default {}\n')
  const recovered = await invoke(['new', 'recovered'], project)
  expect(recovered.code).toBe(0)
  expect(recovered.stderr).toBe('')
  expect(await readFile(join(project, 'flows/recovered/FLOW.ts'), 'utf8')).toContain('@jigging/flow')
  passed++
}, 60_000)

test('installed inspection is read-only and returns exact machine JSON', async () => {
  const project = join(root, 'inspect')
  await mkdir(project)
  for (const args of [['inspect'], ['inspect', '--json'], ['inspect', '--help']]) {
    const result = await invoke(args, project)
    expect(result.code).toBe(0)
    expect(result.stderr).toBe('')
    if (!args.includes('--help')) expect(result.stdout).toBe('{"state":"unreviewed","targets":[]}\n')
    expect(await readdir(project)).toEqual([])
  }
  passed++
})

test('installed attempt help and malformed requests retain exact private-safe framing', async () => {
  for (const operation of ['inspect', 'prepare', 'submit', 'lookup', 'cancel', 'result', 'export']) {
    const help = await invoke(['attempt', operation, '--help'])
    expect(help.code).toBe(0)
    expect(help.stdout).toContain('not permission')
  }
  const project = join(root, 'attempt-input')
  await mkdir(project)
  for (const input of [
    'not-json\n',
    '{"protocolVersion":1,"protocolVersion":1}\n',
    '{"protocolVersion":2,"operation":"lookup","request":{"ticket":"secret-marker"}}\n',
    '{"protocolVersion":1,"operation":"submit","request":{}}\n',
    `"${'x'.repeat(ATTEMPT_REQUEST_BYTES)}"\n`,
  ]) {
    const result = await invoke(['attempt', 'lookup', '--json'], project, input)
    expect(result.code).toBe(1)
    expect(JSON.parse(result.stdout)).toMatchObject({
      protocolVersion: 1, operation: 'lookup', event: 'error', code: 'INVALID_REQUEST',
    })
    expect(result.stdout.trim().split('\n')).toHaveLength(1)
    expect(result.stdout + result.stderr).not.toContain('secret-marker')
    expect(await readdir(project)).toEqual([])
  }
  passed++
})

afterAll(async () => {
  if (passed === 8) await rm(root, { recursive: true, force: true })
  else if (root) console.error(`Installed CLI portable evidence retained at ${root}`)
})
