import { afterAll, beforeAll, expect, test } from 'bun:test'
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { jigDevelopmentBuild } from '../../../../scripts/jig-development-build.js'

const source = resolve(import.meta.dir, '../../../..')
let root: string
let release: string
let consumer: string

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'jig contributor build '))
  release = join(root, 'packages/jig')
  consumer = join(root, 'unrelated-consumer')
  const paths = [
    'package.json', 'justfile', 'LICENSE.md', 'LICENSES.md', 'PRICING.md', 'LICENSES',
    'scripts/jig-development-build.ts', 'docs/jig/spec/contracts',
    'docs/jig/spec/machine/project-authoring-1.schema.json',
  ]
  for (const name of [
    'jig', 'agent-method', 'agent-acp', 'reporting',
    'display-model', 'display-web', 'display-tui',
  ]) {
    paths.push('packages/' + name + '/src', 'packages/' + name + '/package.json',
      'packages/' + name + '/justfile')
  }
  paths.push('packages/jig/scripts', 'packages/jig/support', 'packages/jig/patches',
    'packages/jig/bin', 'packages/jig/libexec', 'packages/jig/dist')
  for (const path of paths) {
    await mkdir(dirname(join(root, path)), { recursive: true })
    await cp(join(source, path), join(root, path), {
      recursive: true,
      filter: path => basename(path) !== 'node_modules' && basename(path) !== '.tmp',
    })
  }
  const name = process.platform === 'darwin'
    ? (process.arch === 'arm64' ? 'bun-darwin-aarch64' : 'bun-darwin-x64-baseline')
    : 'bun-linux-x64-baseline'
  const bin = join(release, 'node_modules/@oven', name, 'bin')
  await mkdir(bin, { recursive: true })
  await symlink(process.execPath, join(bin, 'bun'))
  await mkdir(consumer)
}, 120_000)

async function launch(args = ['completion', 'bash']) {
  const child = Bun.spawn([join(release, 'bin/jig'), ...args], {
    cwd: consumer,
    env: { PATH: '/nonexistent', BUN_OPTIONS: 'invalid', NODE_OPTIONS: 'invalid' },
    stdin: 'ignore', stdout: 'pipe', stderr: 'pipe',
  })
  const [code, stdout, stderr] = await Promise.all([
    child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
  ])
  return { code, stdout, stderr }
}

test('the real contributor launcher accepts its matching build from another project', async () => {
  const result = await launch()
  expect(result.code, result.stderr).toBe(0)
  expect(result.stdout).toContain('complete')
  expect(result.stderr).toBe('')
}, 30_000)

test('same-version source edits fail before launch and restoration recovers ordinary use', async () => {
  const path = join(release, 'src/project/author.ts')
  const original = await readFile(path)
  try {
    await writeFile(path, Buffer.concat([
      original, Buffer.from('\n// A new source revision, with the same package version.\n'),
    ]))
    const result = await launch()
    expect(result.code).toBe(2)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('JIG_BUILD_STALE')
    expect(result.stderr).toContain('From the repository root, run just jig::build, then retry review.')
    expect((await launch(['--version'])).code).toBe(0)
    expect((await launch(['--help'])).code).toBe(0)
  } finally {
    await writeFile(path, original)
  }
  expect((await launch()).code).toBe(0)
}, 30_000)

test('changed generated evaluators and incomplete output refuse the real launcher', async () => {
  const path = join(release, 'libexec/evaluator/project-evaluator-sdk.bundle.js')
  const original = await readFile(path)
  try {
    await writeFile(path, Buffer.concat([original, Buffer.from('\n// Changed generated output.\n')]))
    expect((await launch()).stderr).toContain('JIG_BUILD_STALE')
    await rm(path)
    expect((await launch()).code).toBe(2)
  } finally {
    await writeFile(path, original)
  }
  expect((await launch()).code).toBe(0)
}, 30_000)

test('a source change during build cannot publish a successful build marker', async () => {
  await jigDevelopmentBuild('begin', release)
  const path = join(release, 'src/project/author.ts')
  const original = await readFile(path)
  const marker = await readFile(join(release, 'libexec/development-build.json'))
  try {
    await writeFile(path, Buffer.concat([original, Buffer.from('\n// Changed while building.\n')]))
    await expect(jigDevelopmentBuild('finish', release)).rejects.toThrow('Source changed during the build')
    expect(await readFile(join(release, 'libexec/development-build.json'))).toEqual(marker)
  } finally {
    await writeFile(path, original)
  }
  await jigDevelopmentBuild('begin', release)
  await jigDevelopmentBuild('finish', release)
  expect((await launch()).code).toBe(0)
}, 30_000)

afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true })
})
