import { expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

const repository = resolve(import.meta.dir, '..')
const just = Bun.which('just')
if (!just) throw new Error('Install Just 1.43.1 or newer to test repository tasks')
const COMMAND_TIMEOUT_MS = 10_000
const INVENTORY_TIMEOUT_MS = 30_000
const justfiles = [
  'justfile',
  'packages/flow-sdk/justfile',
  'packages/agent-method/justfile',
  'packages/agent-acp/justfile',
  'packages/flow-authoring/justfile',
  'packages/jiggy-flow/justfile',
  'packages/reporting/justfile',
  'packages/jiggy-reporting/justfile',
  'packages/display-model/justfile',
  'packages/display-web/justfile',
  'packages/display-tui/justfile',
  'packages/jig/justfile',
  'site/justfile',
]

test('startup profiler initializes its trace allowlist before execution and refuses unsupported hosts', async () => {
  const path = join(repository, 'scripts/profile-installed-startup.ts')
  const source = await readFile(path, 'utf8')
  const initialized = source.indexOf('const tracePhases = new Set<TracePhase>(')
  expect(initialized).toBeGreaterThan(-1)
  expect(initialized).toBeLessThan(
    source.indexOf('const environment = requireProfileEnvironment()'),
  )
  // The direct Flow has no collaborators; its Binding supplies both children.
  expect(source).toContain("'binding:analysis'")
  expect(source).not.toContain("'flow:flows/investigate'")
  const child = Bun.spawn([process.execPath, path], {
    env: { PATH: process.env.PATH },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  expect(code).not.toBe(0)
  expect(stdout).toBe('')
  expect(stderr).toContain('requires an exact supported Linux or Mac host and Bun')
  expect(stderr).not.toContain('before initialization')
})

test('repository task manifests exclude scripts without constraining imported skill tooling', async () => {
  const child = Bun.spawn(
    [
      'git',
      'ls-files',
      '--cached',
      '--others',
      '--exclude-standard',
      '-z',
      '--',
      '*package.json',
      ':(exclude).agents/skills/**',
    ],
    { cwd: repository, stdout: 'pipe' },
  )
  const paths = (await new Response(child.stdout).text())
    .split('\0')
    .filter((path) => path && existsSync(join(repository, path)))
  expect(await child.exited).toBe(0)
  for (const path of paths) {
    const manifest = JSON.parse(await readFile(join(repository, path), 'utf8'))
    expect(Object.hasOwn(manifest, 'scripts')).toBe(false)
  }
})

test(
  'root and package justfiles parse on the supported task runner',
  async () => {
    for (const path of justfiles) {
      const result = await run(['--justfile', join(repository, path), '--summary'])
      expect(result.code).toBe(0)
      expect(result.stdout).toContain('build')
    }
  },
  INVENTORY_TIMEOUT_MS,
)

test('preflight is available from the root and package check includes native regression coverage', async () => {
  const root = await run(['--justfile', join(repository, 'justfile'), '--dry-run', 'preflight'])
  expect(root.code).toBe(0)
  expect(root.stderr).toContain('bun scripts/preflight.ts')
  const jig = await run(['--justfile', join(repository, 'justfile'), '--dry-run', 'jig::check'])
  expect(jig.code).toBe(0)
  expect(jig.stderr.indexOf('bun scripts/build-cli.ts')).toBeGreaterThanOrEqual(0)
  expect(jig.stderr.indexOf('bun scripts/build-cli.ts')).toBeLessThan(
    jig.stderr.indexOf('bun test'),
  )
  expect(jig.stderr.indexOf('bun test')).toBeLessThan(
    jig.stderr.indexOf('bun ../../scripts/preflight.ts native'),
  )
})

test('root build delegates the complete package graph to Jig exactly once', async () => {
  const root = await run(['--justfile', join(repository, 'justfile'), '--dry-run', 'build'])
  const jig = await run(['--justfile', join(repository, 'justfile'), '--dry-run', 'jig::build'])
  expect(root.code).toBe(0)
  expect(jig.code).toBe(0)
  expect(root.stderr).toBe(jig.stderr)
  for (const dependency of ['flow-sdk', 'reporting', 'display-model'])
    expect(jig.stderr).not.toContain(`just --justfile ../${dependency}/justfile build`)
  let previous = -1
  for (const packageName of [
    'display-web',
    'display-tui',
    'agent-method',
    'agent-acp',
    'flow-authoring',
  ]) {
    const command = `just --justfile ../${packageName}/justfile build`
    const index = root.stderr.indexOf(command)
    expect(index).toBeGreaterThan(previous)
    expect(root.stderr.indexOf(command, index + command.length)).toBe(-1)
    previous = index
  }
  expect(previous).toBeLessThan(root.stderr.indexOf('bun scripts/build-cli.ts'))
  for (const renderer of ['display_web', 'display_tui']) {
    const result = await run([
      '--justfile',
      join(repository, 'justfile'),
      '--dry-run',
      `${renderer}::build`,
    ])
    expect(result.code).toBe(0)
    const modelIndex = result.stderr.indexOf('just --justfile ../display-model/justfile build')
    const compilerIndex = result.stderr.indexOf('tsc -p tsconfig.json')
    expect(modelIndex).toBeGreaterThanOrEqual(0)
    expect(compilerIndex).toBeGreaterThanOrEqual(0)
    expect(modelIndex).toBeLessThan(compilerIndex)
  }
  const model = await run([
    '--justfile',
    join(repository, 'justfile'),
    '--dry-run',
    'display_model::build',
  ])
  expect(model.code).toBe(0)
  for (const dependency of ['flow-sdk', 'reporting']) {
    const index = model.stderr.indexOf(`just --justfile ../${dependency}/justfile build`)
    expect(index).toBeGreaterThanOrEqual(0)
    expect(index).toBeLessThan(model.stderr.indexOf('tsc -p tsconfig.json'))
  }
})

test('standalone authoring build still invokes its owning compiler once', async () => {
  await withFixture(async (directory, environment) => {
    const result = await run(
      ['--justfile', join(directory, 'justfile'), 'authoring::build'],
      environment,
    )
    expect(result.code).toBe(0)
    expect(
      result.stdout
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line)),
    ).toEqual([
      {
        cwd: join(directory, 'packages/flow-authoring'),
        args: ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json'],
      },
    ])
  })
})

test(
  'tooling runs every CI file once and stops before Bun checks after a policy failure',
  async () => {
    for (const fail of ['', 'policy']) {
      await withFixture(async (directory, environment) => {
        const files = ['alpha.test.mjs', 'future.test.mjs', 'source-stages.test.mjs']
        for (const file of files) await writeFile(join(directory, 'scripts/ci', file), '')
        await writeFile(
          join(directory, 'tools/node'),
          `#!${process.execPath}
const args = process.argv.slice(2);
console.log(JSON.stringify({ cwd: process.cwd(), args }));
process.exit(process.env.JUST_TEST_FAIL_PHASE === 'policy' ? 23 : 0);
`,
          { mode: 0o755 },
        )
        const result = await run(
          ['--justfile', join(directory, 'justfile'), '--shell', '/bin/bash', 'test-tooling'],
          {
            ...environment,
            JUST_TEST_FAIL_PHASE: fail,
            // Version-manager dispatchers can prepend their selected Node to PATH.
            // Bind the inert recorder in the fixture's explicit Bash shell.
            'BASH_FUNC_node%%': `() { '${join(directory, 'tools/node').replaceAll("'", "'\\''")}' "$@"; }`,
          },
        )
        expect(result.code, result.stderr).toBe(fail ? 23 : 0)
        const calls = result.stdout
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line))
        expect(calls[0]).toEqual({
          cwd: directory,
          args: ['--test', ...files.map((file) => `scripts/ci/${file}`)],
        })
        if (fail === 'policy') expect(calls).toHaveLength(1)
        else {
          expect(calls).toHaveLength(2)
          expect(calls[1].cwd).toBe(directory)
          expect(calls[1].args[0]).toBe('test')
          expect(calls[1].args.slice(1)).toContain('scripts/justfile.test.ts')
        }
      })
    }
  },
  INVENTORY_TIMEOUT_MS,
)

test(
  'module and root tasks preserve arguments and select their own working directory',
  async () => {
    await withFixture(async (directory, environment) => {
      const args = ['a path with spaces', '$(touch SHOULD_NOT_EXIST)', '; echo unsafe', '']
      for (const [recipe, cwd, prefix] of [
        ['jig::test', 'packages/jig', ['test', './test/portable/fixture.test.ts']],
        ['flow::test', 'packages/flow-sdk', ['test']],
        ['display_model::test', 'packages/display-model', ['test']],
        ['display_web::test', 'packages/display-web', ['test']],
        ['display_tui::test', 'packages/display-tui', ['test']],
        [
          'site::dev-flow',
          'site',
          ['node_modules/@rspress/core/bin/rspress.js', 'dev', '-c', 'flow/rspress.config.ts'],
        ],
        [
          'site::dev-jig',
          'site',
          ['node_modules/@rspress/core/bin/rspress.js', 'dev', '-c', 'jig/rspress.config.ts'],
        ],
        [
          'biome-check',
          '',
          [
            'x',
            '--no-install',
            'biome',
            'check',
            '--files-ignore-unknown=true',
            '--no-errors-on-unmatched',
          ],
        ],
      ] as const) {
        const result = await run(
          ['--justfile', join(directory, 'justfile'), recipe, ...args],
          environment,
        )
        expect(result.code).toBe(0)
        expect(JSON.parse(result.stdout)).toEqual({
          cwd: join(directory, cwd),
          args: [...prefix, ...args],
        })
      }
    })
  },
  INVENTORY_TIMEOUT_MS,
)

test('Agent candidate task preserves explicit package and destination arguments', async () => {
  await withFixture(async (directory, environment) => {
    const result = await run(
      [
        '--justfile',
        join(directory, 'justfile'),
        'agent-candidate',
        'agent-acp',
        'output with spaces',
      ],
      environment,
    )
    expect(result.code).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({
      cwd: directory,
      args: ['scripts/build-agent-candidate.ts', 'agent-acp', 'output with spaces'],
    })
  })
})

test('build-tool refusal stops before removing existing package output', async () => {
  await withFixture(async (directory, environment) => {
    const retained = join(directory, 'packages/jig/dist/sentinel')
    await mkdir(dirname(retained), { recursive: true })
    await writeFile(retained, 'existing build')
    const result = await run(['--justfile', join(directory, 'justfile'), 'jig::build'], {
      ...environment,
      JUST_TEST_BUN_EXIT: '42',
    })
    expect(result.code).toBe(42)
    expect(result.stderr).toContain('verify-build-bun')
    expect(await readFile(retained, 'utf8')).toBe('existing build')
  })
})

test('site assembly explains missing Just before creating output or staging', async () => {
  await withFixture(async (directory) => {
    const before = await readdir(directory)
    const child = Bun.spawn(
      [
        '/bin/sh',
        '-c',
        'PATH=$1; site_script=$2; shift 2; . "$site_script"',
        'sh',
        join(directory, 'tools'),
        join(repository, 'scripts/build-site.sh'),
        'jig',
        join(directory, 'pages'),
      ],
      {
        stdout: 'pipe',
        stderr: 'pipe',
      },
    )
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    expect(code).toBe(2)
    expect(stdout).toBe('')
    expect(stderr).toContain('Just 1.43.1 or newer is required')
    expect(await readdir(directory)).toEqual(before)
  })
})

test('packing explicitly builds first and preserves the destination argument', async () => {
  const result = await run([
    '--justfile',
    join(repository, 'justfile'),
    '--dry-run',
    'jig::pack',
    '--destination',
    '/tmp/task archive',
  ])
  expect(result.code).toBe(0)
  expect(result.stderr).not.toContain('--compile')
  expect(result.stderr.indexOf('Bun.version')).toBeLessThan(
    result.stderr.indexOf('bun scripts/native-support.mjs check'),
  )
  expect(result.stderr.indexOf('bun scripts/native-support.mjs check')).toBeLessThan(
    result.stderr.indexOf('await rm'),
  )
  expect(result.stderr.indexOf('bun scripts/build-cli.ts')).toBeGreaterThanOrEqual(0)
  expect(result.stderr.indexOf('bun scripts/build-cli.ts')).toBeLessThan(
    result.stderr.indexOf('bun scripts/pack.ts'),
  )
  expect(result.stderr).toContain('bun scripts/pack.ts "$@"')
  await withFixture(async (directory, environment) => {
    const destination = join(directory, 'package archives')
    const packed = await run(
      ['--justfile', join(directory, 'justfile'), 'flow::pack', '--destination', destination],
      environment,
    )
    expect(packed.code).toBe(0)
    const calls = packed.stdout
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    expect(calls).toHaveLength(3)
    expect(calls[1].args).toEqual(['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json'])
    expect(calls[2]).toEqual({
      cwd: join(directory, 'packages/flow-sdk'),
      args: ['pm', 'pack', '--ignore-scripts', '--destination', destination],
    })
  })
})

test('ordinary Agent packing uses Bun after building, without a custom packer', async () => {
  for (const recipe of ['agent::pack', 'acp::pack']) {
    const result = await run([
      '--justfile',
      join(repository, 'justfile'),
      '--dry-run',
      recipe,
      '--destination',
      '/tmp/agent artifacts',
    ])
    expect(result.code).toBe(0)
    expect(result.stderr).toContain('bun pm pack --ignore-scripts "$@"')
    expect(result.stderr.indexOf('--outfile=dist/flow.js')).toBeLessThan(
      result.stderr.indexOf('bun pm pack'),
    )
    expect(result.stderr).not.toContain('scripts/pack.ts')
  }
})

test('display packing builds through owning recipes and Jig composes them in dependency order', async () => {
  const jig = await run(['--justfile', join(repository, 'justfile'), '--dry-run', 'jig::build'])
  expect(jig.code).toBe(0)
  const web = jig.stderr.indexOf('just --justfile ../display-web/justfile build')
  const tui = jig.stderr.indexOf('just --justfile ../display-tui/justfile build')
  expect(web).toBeGreaterThanOrEqual(0)
  expect(tui).toBeGreaterThan(web)
  expect(Math.max(web, tui)).toBeLessThan(jig.stderr.indexOf('bun scripts/build-cli.ts'))
  for (const recipe of ['display_model::pack', 'display_web::pack', 'display_tui::pack']) {
    const result = await run([
      '--justfile',
      join(repository, 'justfile'),
      '--dry-run',
      recipe,
      '--destination',
      '/tmp/display artifacts',
    ])
    expect(result.code).toBe(0)
    expect(result.stderr).toContain('bun pm pack --ignore-scripts "$@"')
    const compile = result.stderr.indexOf('tsc -p tsconfig.json')
    expect(compile).toBeGreaterThanOrEqual(0)
    expect(compile).toBeLessThan(result.stderr.indexOf('bun pm pack'))
    expect(result.stderr).not.toContain('scripts/pack.ts')
  }
})

test('hostile recipe executes the complete owned Linux inventory sequentially', async () => {
  const result = await run([
    '--justfile',
    join(repository, 'justfile'),
    '--dry-run',
    'jig::test-linux-rootless-proof-host',
  ])
  expect(result.code).toBe(0)
  expect(result.stderr).toContain('suite-inventory.mjs --root ../.. --profile linux')
  expect(result.stderr).toContain('while IFS= read -r file')
  expect(result.stderr).toContain(
    'JIG_LINUX_ROOTLESS_HOSTILE=1 bun test "./${file#packages/jig/}" --timeout 420000',
  )
  expect(result.stderr).not.toContain('--test-name-pattern')
})

async function withFixture(
  work: (directory: string, environment: NodeJS.ProcessEnv) => Promise<void>,
) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'jig just recipes ')))
  try {
    for (const path of justfiles) {
      const target = join(directory, path)
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, await readFile(join(repository, path)))
    }
    const bin = join(directory, 'tools')
    await mkdir(bin)
    const inventory = join(directory, 'scripts/ci/suite-inventory.mjs')
    await mkdir(dirname(inventory), { recursive: true })
    await writeFile(
      inventory,
      "process.stdout.write('packages/jig/test/portable/fixture.test.ts\\n')\n",
    )
    await writeFile(
      join(bin, 'bun'),
      `#!${process.execPath}\nconsole.log(JSON.stringify({cwd: process.cwd(), args: process.argv.slice(2)}));\nprocess.exit(Number(process.env.JUST_TEST_BUN_EXIT ?? 0));\n`,
      { mode: 0o755 },
    )
    await work(directory, {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      JUST_TEST_BUN_EXIT: '0',
    })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

async function run(args: string[], environment: NodeJS.ProcessEnv = process.env) {
  const child = Bun.spawn([just as string, ...args], {
    cwd: tmpdir(),
    env: environment,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    child.kill('SIGKILL')
  }, COMMAND_TIMEOUT_MS)
  try {
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    if (timedOut)
      throw new Error(`Repository task command exceeded ${COMMAND_TIMEOUT_MS}ms: ${args.join(' ')}`)
    return { code, stdout, stderr }
  } finally {
    clearTimeout(timer)
    if (child.exitCode === null) {
      child.kill('SIGKILL')
      await child.exited
    }
  }
}
