import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

const repository = resolve(import.meta.dir, '..')
const just = Bun.which('just')
if (!just) throw new Error('Install Just 1.43.1 or newer to test repository tasks')
const justfiles = [
  'justfile',
  'packages/flow-sdk/justfile',
  'packages/jig/justfile',
  'site/justfile',
]

test('repository task manifests exclude scripts without constraining imported skill tooling', async () => {
  const child = Bun.spawn(['git', 'ls-files', '*package.json', ':(exclude).agents/skills/**'], {
    cwd: repository,
    stdout: 'pipe',
  })
  const paths = (await new Response(child.stdout).text()).trim().split('\n')
  expect(await child.exited).toBe(0)
  for (const path of paths) {
    const manifest = JSON.parse(await readFile(join(repository, path), 'utf8'))
    expect(Object.hasOwn(manifest, 'scripts')).toBe(false)
  }
})

test('root and package justfiles parse on the supported task runner', async () => {
  for (const path of justfiles) {
    const result = await run(['--justfile', join(repository, path), '--summary'])
    expect(result.code).toBe(0)
    expect(result.stdout).toContain('build')
  }
})

test('module and root tasks preserve arguments and select their own working directory', async () => {
  await withFixture(async (directory, environment) => {
    const args = ['a path with spaces', '$(touch SHOULD_NOT_EXIST)', '; echo unsafe', '']
    for (const [recipe, cwd, prefix] of [
      ['jig::test', 'packages/jig', ['test']],
      ['flow::test', 'packages/flow-sdk', ['test']],
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
  expect(result.stderr.indexOf('Bun.version')).toBeLessThan(result.stderr.indexOf('await rm'))
  expect(result.stderr.indexOf('--outfile=libexec/installed-cli.js')).toBeLessThan(
    result.stderr.indexOf('bun pm pack'),
  )
  expect(result.stderr).toContain('bun pm pack --ignore-scripts "$@"')
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

test('hostile files remain separate ordered invocations', async () => {
  const result = await run([
    '--justfile',
    join(repository, 'justfile'),
    '--dry-run',
    'jig::test-linux-rootless-proof-host',
  ])
  expect(result.code).toBe(0)
  const lines = result.stderr
    .split('\n')
    .filter((line) => line.startsWith('JIG_LINUX_ROOTLESS_HOSTILE=1'))
  expect(lines).toEqual([
    'JIG_LINUX_ROOTLESS_HOSTILE=1 bun test test/linux-rootless-delegation-hostile.test.ts --timeout 30000',
    'JIG_LINUX_ROOTLESS_HOSTILE=1 bun test test/linux-rootless-run.test.ts --timeout 30000',
    'JIG_LINUX_ROOTLESS_HOSTILE=1 bun test test/bun-native-preparation.test.ts --timeout 120000',
    'JIG_LINUX_ROOTLESS_HOSTILE=1 bun test test/private-foreground.test.ts --timeout 30000',
    'JIG_LINUX_ROOTLESS_HOSTILE=1 bun test test/root-agent-run-lifecycle.test.ts --timeout 180000',
  ])
})

async function withFixture(
  work: (directory: string, environment: NodeJS.ProcessEnv) => Promise<void>,
) {
  const directory = await mkdtemp(join(tmpdir(), 'jig just recipes '))
  try {
    for (const path of justfiles) {
      const target = join(directory, path)
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, await readFile(join(repository, path)))
    }
    const bin = join(directory, 'tools')
    await mkdir(bin)
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
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  return { code, stdout, stderr }
}
