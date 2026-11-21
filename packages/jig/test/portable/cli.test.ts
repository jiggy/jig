import { afterAll, beforeAll, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { lstat, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ATTEMPT_REQUEST_BYTES } from '../../src/attempt-contract.js'
import { settleTestCommand } from '../fixtures/bounded-command.js'
import {
  foundationCommands,
  foundationEnvironment,
  freezeFoundationArchives,
} from '../fixtures/host-foundation/materialize.js'

// Review refusals precede host acquisition; unchanged installed commands and files only.
const packageRoot = resolve(import.meta.dir, '../..')
let root: string
let cli: string
let sequence = 0
let passed = 0
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'jig-installed-cli-portable-'))
  const setup = foundationCommands(join(root, 'setup'))
  const archives = await freezeFoundationArchives(root, setup)
  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({
      private: true,
      dependencies: {
        '@jigging/jig': `file:${archives.jig}`,
        '@jigging/flow': `file:${archives.flow}`,
      },
    }),
  )
  await setup(
    [process.execPath, 'install', '--ignore-scripts', '--no-progress', '--backend', 'copyfile'],
    root,
    120_000,
  )
  cli = join(root, 'node_modules/.bin/jig')
}, 300_000)

async function invoke(
  args: string[],
  cwd = root,
  input?: string,
  environment: NodeJS.ProcessEnv = {},
) {
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
  for (const args of [
    ['--help'],
    ['init', '--help'],
    ['review', '-h'],
    ['run', '--help'],
    ['inspect', '--help'],
  ]) {
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
      expect(result.stdout).toContain('--source-root DIRECTORY')
      expect(result.stdout).toContain('relative to the invocation directory')
      expect(result.stdout).toContain('no network or Run filesystem access')
      expect(result.stdout).toContain('--yes alone does not approve new resource authority')
      expect(result.stdout).toContain('16 distinct dependency preparations')
      expect(result.stdout).toContain('limits.dependencies.maxPreparations in jig.ts')
      expect(result.stdout).toContain('JIG_LIMITS_DEPENDENCIES_MAX_PREPARATIONS')
      expect(result.stdout).toContain('supported range is 1-256')
      expect(result.stdout).toContain('Exported environment values take precedence')
    }
    if (args[0] === 'init') expect(result.stdout).toContain('--bare')
    if (args[0] !== 'init') {
      expect(result.stdout).toContain('--verification MODE')
      expect(result.stdout).toContain('Fast can miss changed tool bytes')
    }
  }
  const manifest = JSON.parse(
    await readFile(join(root, 'node_modules/@jigging/jig/package.json'), 'utf8'),
  )
  for (const path of ['development-build-check.js', 'development-build.json']) {
    await expect(
      lstat(join(root, 'node_modules/@jigging/jig/libexec', path)),
    ).rejects.toMatchObject({
      code: 'ENOENT',
    })
  }
  expect(await invoke(['--version'])).toMatchObject({
    code: 0,
    stdout: `${manifest.version}\n`,
    stderr: '',
  })
  let isolatedPath = '/nonexistent'
  try {
    const shebang = await readFile('/bin/sh', 'utf8')
    if (shebang.includes('/usr/bin/env')) {
      isolatedPath = dirname(Bun.which('bash') ?? '/bin')
    }
  } catch {}
  expect(
    await invoke(['--version'], root, undefined, {
      PATH: isolatedPath,
      BUN_OPTIONS: 'invalid',
      NODE_OPTIONS: 'invalid',
    }),
  ).toMatchObject({ code: 0, stdout: `${manifest.version}\n`, stderr: '' })
  passed++
})

test('installed invalid grammar refuses without disclosing rejected private values', async () => {
  const cases = [
    ['--version', 'extra'],
    ['unknown-command'],
    ['run', 'flow:../private'],
    ['run', 'flow:flows/hello', '--input', '{"secret":'],
    ...['0', '-1', 'NaN', '9007199254740992ms', '25h'].map((value) => [
      'run',
      'flow:flows/hello',
      '--timeout',
      value,
    ]),
    ...[['review'], ['inspect'], ['run', 'flow:flows/hello']].flatMap((prefix) => [
      [...prefix, '--verification'],
      [...prefix, '--verification', 'private-invalid-value'],
      [...prefix, '--verification', 'fast', '--verification', 'strict'],
    ]),
    ['run', 'flow:flows/hello', '--attach'],
    ['run', 'flow:flows/hello', '--out'],
    ['review', '--source-root'],
    ['review', '--source-root', ''],
    ['review', '--source-root', '--yes'],
    ['review', '--source-root', 'private-invalid-value\nfolder'],
    ['review', '--source-root', `private-invalid-value${'é'.repeat(2048)}`],
    [
      'review',
      ...Array.from({ length: 33 }, (_, index) => ['--source-root', `../root-${index}`]).flat(),
    ],
    ['run', 'flow:flows/hello', '--source-root', 'private-invalid-value'],
    ['inspect', '--source-root', 'private-invalid-value'],
    ['init', 'unselected', '--agent', 'unknown'],
  ]
  const project = join(root, 'grammar')
  await mkdir(project)
  for (const args of cases) {
    const result = await invoke(args, project)
    expect(result.stdout).toBe('')
    const code =
      args[0] === '--version' || args[0] === 'unknown-command'
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
  expect((await readdir(project)).sort()).toEqual([
    '.gitignore',
    'AGENTS.md',
    'bindings',
    'flows',
    'jig.ts',
  ])
  const guidance = await readFile(join(project, 'AGENTS.md'), 'utf8')
  expect(guidance.startsWith('# Workflow edits\n')).toBe(true)
  expect(guidance).toContain('jig inspect --flow')
  expect(guidance).toContain(
    'file or Binding declaration, pass its project-relative path to the same command.',
  )
  expect(guidance).not.toContain('MIT License')
  expect(guidance).not.toContain('Copyright')
  const notices = await readFile(
    join(root, 'node_modules/@jigging/jig/THIRD_PARTY_NOTICES'),
    'utf8',
  )
  expect(notices).toContain('Copyright (c) 2026 Agent Zero')
  const dox = guidance.slice(guidance.indexOf('# DOX framework\n'))
  // Upstream AGENTS.md at agent0ai/dox@765ae4ac, including its final newline.
  expect(createHash('sha256').update(dox).digest('hex')).toBe(
    'e1123d740736d6792efc4d11afa5a6a0f34610131ee7714ccf592f007b9bc3ea',
  )
  expect(await readdir(join(project, 'flows'))).toEqual([])
  expect(await readdir(join(project, 'bindings'))).toEqual([])
  expect(await readFile(join(project, '.gitignore'), 'utf8')).toBe('.jig/\n')
  expect(await readFile(join(project, 'jig.ts'), 'utf8')).toBe(
    [
      'import { defineJig, discover } from "@jigging/jig";',
      '',
      'export default defineJig({',
      '  flows: discover("./flows"),',
      '  bindings: discover("./bindings"),',
      '});',
      '',
    ].join('\n'),
  )
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
  expect(results.map((result) => result.code).sort()).toEqual([0, 1])
  expect((await readdir(destination)).sort()).toEqual([
    '.gitignore',
    'AGENTS.md',
    'bindings',
    'flows',
    'jig.ts',
  ])
  passed++
})

test('installed greeting and Agent initialization create ordinary editable files without authority', async () => {
  const current = JSON.parse(
    await readFile(join(root, 'node_modules/@jigging/jig/package.json'), 'utf8'),
  )
  for (const client of [undefined, 'codex', 'claude']) {
    const project = join(root, client ?? 'greeting')
    const result = await invoke(['init', project, ...(client ? ['--agent', client] : [])])
    expect(result.code).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout).not.toContain('\u001b')
    expect(await readFile(join(project, 'AGENTS.md'), 'utf8')).toContain('# DOX framework\n')
    const notes = await readFile(join(project, 'flows/hello/AGENTS.md'), 'utf8')
    expect(notes).toContain('# hello Flow\n')
    expect(notes).toContain('[FLOW.ts](./FLOW.ts)')
    expect(notes).not.toContain('# DOX framework')
    expect(notes).not.toContain('MIT License')
    expect(await readFile(join(project, 'flows/hello/FLOW.ts'), 'utf8')).toContain(
      'import { handle } from "@jigging/flow"',
    )
    const projectManifest = JSON.parse(await readFile(join(project, 'package.json'), 'utf8'))
    expect(projectManifest.engines).toEqual({ jig: current.version })
    expect(projectManifest.peerDependencies).toBeUndefined()
    if (client) {
      expect(await readFile(join(project, 'bindings/agent.ts'), 'utf8')).toContain(
        `client: ${JSON.stringify(client)}`,
      )
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
    await writeFile(
      join(project, 'package.json'),
      JSON.stringify({
        private: true,
        engines: { jig: required },
      }),
    )
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
    await writeFile(
      join(project, 'package.json'),
      JSON.stringify({
        engines: { jig: required },
      }),
    )
    const result = await invoke(['review'], project)
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('PROJECT_JIG_REQUIREMENT_INVALID')
    expect(result.stderr).not.toContain('PRIVATE_SECRET')
    expect(result.stderr).not.toContain('MUST_NEVER_EVALUATE_PRIVATE')
  }
  const current = JSON.parse(
    await readFile(join(root, 'node_modules/@jigging/jig/package.json'), 'utf8'),
  )
  await writeFile(
    join(project, 'package.json'),
    JSON.stringify({
      engines: { jig: current.version },
    }),
  )
  await writeFile(join(project, 'jig.ts'), 'export default {}\n')
  const recovered = await invoke(['new', 'recovered'], project)
  expect(recovered.code).toBe(0)
  expect(recovered.stderr).toBe('')
  expect(await readFile(join(project, 'flows/recovered/FLOW.ts'), 'utf8')).toContain(
    '@jigging/flow',
  )
  passed++
}, 60_000)

test('installed inspection is read-only and returns exact machine JSON', async () => {
  const project = join(root, 'inspect')
  await mkdir(project)
  for (const args of [['inspect'], ['inspect', '--json'], ['inspect', '--help']]) {
    const result = await invoke(args, project)
    expect(result.code).toBe(0)
    expect(result.stderr).toBe('')
    if (!args.includes('--help'))
      expect(result.stdout).toBe('{"state":"unreviewed","targets":[]}\n')
    expect(await readdir(project)).toEqual([])
  }
  passed++
})

test('installed Flow declarations check settings and child calls with TypeScript', async () => {
  const project = join(root, 'type-consumer')
  const caller = join(project, 'flows/worker')
  await mkdir(join(caller, 'contracts'), { recursive: true })
  await writeFile(join(project, 'package.json'), '{"type":"module"}\n')
  await writeFile(join(project, 'jig.ts'), 'throw new Error("jig types evaluated project code")\n')
  await writeFile(
    join(caller, 'FLOW.meta.json'),
    '{"uses":{"mapping-review":{"contract":"./contracts/reviewer.json"},"reader":{}}}\n',
  )
  const contractPath = join(caller, 'contracts/reviewer.json')
  const settingsPath = join(caller, 'settings.schema.json')
  const dialect = 'https://flow.jig.md/schemas/schema-0.json'
  await writeFile(
    settingsPath,
    JSON.stringify({
      $schema: dialect,
      type: 'object',
      properties: { route: { enum: ['review', 'raw'] }, reason: { type: 'string' } },
      required: ['route'],
      additionalProperties: false,
    }),
  )
  const contract = {
    $schema: 'https://flow.jig.md/schemas/invocation-contract-0.schema.json',
    id: 'https://example.org/contracts/reviewer',
    version: '0.1.0',
    input: {
      type: 'object',
      properties: {
        headers: { type: 'array', items: { type: 'string' } },
        reason: { type: 'string' },
      },
      required: ['headers', 'reason'],
      additionalProperties: false,
    },
    outcomes: { 'needs-evidence': 'Supply more evidence.' },
    result: {
      oneOf: [reviewOutcome('done', 'summary'), reviewOutcome('needs-evidence', 'request')],
    },
  }
  await writeFile(contractPath, JSON.stringify(contract))
  const source = `import { handle, type JsonValue } from '@jigging/flow'
import type { RunContext } from './FLOW.calls.js'

await handle(async (context) => {
  const run = context as RunContext
  const route: 'review' | 'raw' = run.settings.route
  const reason = run.settings.reason?.trim() ?? 'Ambiguous'
  const result = await run.call({
    operationId: 'review',
    slot: 'mapping-review',
    input: { headers: ['Name'], reason },
  }, { signal: run.signal })
  const slot = route === 'review' ? 'mapping-review' : 'reader'
  if (run.input === 'raw' && slot === 'reader') {
    const raw = await run.call({ operationId: 'raw', slot, input: [true, 7] })
    return { outcome: 'done', output: raw.output satisfies JsonValue }
  }
  if (run.input === 'choose') {
    const request = slot === 'reader'
      ? { operationId: 'choose', slot, input: [true, 7] } as const
      : { operationId: 'choose', slot, input: { headers: ['Name'], reason: 'Ambiguous' } } as const
    const child = await run.call(request)
    return { outcome: 'done', output: child.output }
  }
  switch (result.outcome) {
    case 'done': return { outcome: 'done', output: result.output.summary.toUpperCase() }
    case 'needs-evidence': return { outcome: 'done', output: result.output.request.toLowerCase() }
    default: {
      const missing: never = result
      return missing
    }
  }
})\n`
  await writeFile(join(caller, 'FLOW.ts'), source)
  const generate = async () => {
    const result = await invoke(['types', 'flows/worker'], project)
    expect(result.code, result.stderr).toBe(0)
    expect(result.stderr).toBe('')
    return result.stdout
  }
  const declaration = await generate()
  expect(await generate()).toBe(declaration)
  expect((await readdir(project)).sort()).toEqual(['flows', 'jig.ts', 'package.json'])
  expect((await readdir(caller)).sort()).toEqual([
    'FLOW.meta.json',
    'FLOW.ts',
    'contracts',
    'settings.schema.json',
  ])
  await writeFile(join(caller, 'FLOW.calls.d.ts'), declaration)

  const node = process.env.FLOW_NODE ?? Bun.which('node')
  if (node === undefined || node === null) throw new Error('TypeScript requires Node')
  const tsc = fileURLToPath(new URL('./bin/tsc', import.meta.resolve('typescript/package.json')))
  const tsc59 = fileURLToPath(
    new URL('./bin/tsc', import.meta.resolve('typescript-parser/package.json')),
  )
  const compile = async (current: string, errorAt?: string, compiler = tsc) => {
    await writeFile(join(caller, 'FLOW.ts'), current)
    const result = await settleTestCommand(
      Bun.spawn(
        [
          node,
          compiler,
          '--strict',
          '--exactOptionalPropertyTypes',
          '--noEmit',
          '--pretty',
          'false',
          '--module',
          'NodeNext',
          'flows/worker/FLOW.ts',
        ],
        { cwd: project, env: foundationEnvironment(), stdout: 'pipe', stderr: 'pipe' },
      ),
      { evidence: join(root, `command-${++sequence}`), timeoutMs: 15_000 },
    )
    expect(result.stderr).toBe('')
    if (errorAt === undefined) {
      expect(result.code, result.stdout).toBe(0)
      expect(result.stdout).toBe('')
    } else {
      const line = current.split('\n').findIndex((text) => text.includes(errorAt)) + 1
      expect(line).toBeGreaterThan(0)
      expect(result.code, result.stdout).toBeGreaterThan(0)
      expect(result.stdout.split('\n').filter((text) => text.includes('error TS'))).toHaveLength(1)
      expect(result.stdout).toMatch(
        new RegExp(`^flows/worker/FLOW\\.ts\\(${line},\\d+\\): error TS`),
      )
    }
    return result.stdout
  }
  for (const compiler of [tsc59, tsc]) {
    await compile(source, undefined, compiler)
    const wrongRoute = source.replace(
      '  const reason',
      '  const wrongRoute: number = run.settings.route\n  const reason',
    )
    const diagnostic = await compile(wrongRoute, 'wrongRoute: number', compiler)
    expect(diagnostic).toMatch(/not assignable to type 'number'/)
  }
  await compile(source.replace('reason?.trim()', 'reason.trim()'), 'reason.trim()')
  const call = (slot: string, input: string) => `import type { RunContext } from './FLOW.calls.js'

declare const run: RunContext
await run.call({
  operationId: 'review',
  slot: '${slot}',
  input: ${input},
})\n`
  await compile(call('unknown', 'null'), "slot: 'unknown'")
  const wrongHeaders = call('mapping-review', "{ headers: 42, reason: 'Ambiguous' }")
  for (const compiler of [tsc59, tsc]) {
    const diagnostic = await compile(wrongHeaders, 'headers: 42', compiler)
    expect(diagnostic).toMatch(/\bnumber\b.*\bstring\b/)
  }
  await compile(
    source.replace("run.input === 'raw' && slot === 'reader'", "run.input === 'raw'"),
    'input: [true, 7]',
  )

  await writeFile(
    contractPath,
    JSON.stringify({
      ...contract,
      outcomes: { ...contract.outcomes, deferred: 'Review later.' },
      result: { oneOf: [...contract.result.oneOf, reviewOutcome('deferred', 'reason')] },
    }),
  )
  const expanded = await generate()
  expect(expanded).not.toBe(declaration)
  expect(await generate()).toBe(expanded)
  await writeFile(join(caller, 'FLOW.calls.d.ts'), expanded)
  await compile(source, 'const missing: never')
  await compile(
    source.replace(
      'const missing: never = result\n      return missing',
      "return { outcome: 'done', output: result.outcome }",
    ),
  )

  await writeFile(contractPath, JSON.stringify({ ...contract, input: { type: 'invalid' } }))
  const invalid = await invoke(['types', 'flows/worker'], project)
  expect(invalid).toMatchObject({ code: 1, stdout: '' })
  expect(invalid.stderr).toContain('SCHEMA_INVALID')
  expect(invalid.stderr).toContain('flows/worker/contracts/reviewer.json')

  await writeFile(join(caller, 'FLOW.meta.json'), '{}\n')
  await writeFile(join(caller, 'FLOW.calls.d.ts'), await generate())
  const settingsOnly = `import { handle } from '@jigging/flow'
import type { RunContext } from './FLOW.calls.js'
await handle(async (context) => {
  const run = context as RunContext
  const route: 'review' | 'raw' = run.settings.route
  return run.call({ operationId: 'read', slot: 'any', input: route })
})\n`
  await compile(settingsOnly)
  await rm(settingsPath)
  const broad = await generate()
  await writeFile(join(caller, 'FLOW.calls.d.ts'), broad)
  await compile(`import type { RunContext as SDKContext } from '@jigging/flow'
import type { RunContext } from './FLOW.calls.js'
declare const sdk: SDKContext
export const run: RunContext = sdk
`)
  await writeFile(
    settingsPath,
    JSON.stringify({
      $schema: dialect,
      $ref: '#/$defs/Settings',
      $defs: { Settings: { type: 'object' } },
    }),
  )
  expect(await generate()).toBe(broad)
  await writeFile(settingsPath, '{"type":"object"}\n')
  const invalidSettings = await invoke(['types', 'flows/worker'], project)
  expect(invalidSettings).toMatchObject({ code: 1, stdout: '' })
  expect(invalidSettings.stderr).toContain('SCHEMA_INVALID')
  expect(invalidSettings.stderr).toContain('flows/worker/settings.schema.json')
  passed++
}, 60_000)

function reviewOutcome(outcome: string, outputField: string) {
  return {
    type: 'object',
    properties: {
      outcome: { const: outcome },
      output: {
        type: 'object',
        properties: { [outputField]: { type: 'string' } },
        required: [outputField],
        additionalProperties: false,
      },
    },
    required: ['outcome', 'output'],
    additionalProperties: false,
  }
}

test('installed attempt help and malformed requests retain exact private-safe framing', async () => {
  for (const operation of [
    'inspect',
    'prepare',
    'submit',
    'lookup',
    'cancel',
    'result',
    'export',
  ]) {
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
      protocolVersion: 1,
      operation: 'lookup',
      event: 'error',
      code: 'INVALID_REQUEST',
    })
    expect(result.stdout.trim().split('\n')).toHaveLength(1)
    expect(result.stdout + result.stderr).not.toContain('secret-marker')
    expect(await readdir(project)).toEqual([])
  }
  passed++
})

afterAll(async () => {
  if (passed === 9) await rm(root, { recursive: true, force: true })
  else if (root) console.error(`Installed CLI portable evidence retained at ${root}`)
})
