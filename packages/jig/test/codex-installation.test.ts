import { afterEach, describe, expect, test } from 'bun:test'
import { chmod, lstat, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  privateAcpAgentRuntime,
  revalidatePrivateAcpAgentProvider,
} from '../src/internal/acp-agent-provider.js'
import { openPrivateCodexAgentProvider } from '../src/internal/codex-agent-provider.js'
import { resolvePrivateNativeAgentExecutable as discover } from '../src/internal/native-agent-executable.js'
import { installedBunLocation } from './fixtures/installed-bun-location.js'
import { nativeElf } from './fixtures/native-elf.js'

const temporary: string[] = []
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

const platform = `${process.platform}-${process.arch}`
const triple =
  process.platform === 'darwin'
    ? `${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}-apple-darwin`
    : 'x86_64-unknown-linux-musl'
const version = '0.159.0'

async function fixture(volta = false, hoisted = false) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'jig-codex-installation-')))
  temporary.push(root)
  const project = join(root, 'project')
  const home = join(root, 'volta')
  const prefix = volta ? join(home, 'tools/image/packages/@openai/codex') : join(root, 'npm')
  const modules = join(prefix, 'lib/node_modules')
  const pkg = join(modules, '@openai/codex')
  const nativePkg = join(hoisted ? modules : join(pkg, 'node_modules'), `@openai/codex-${platform}`)
  const native = join(nativePkg, 'vendor', triple, 'bin/codex')
  const wrapper = join(pkg, 'bin/codex.js')
  const bin = volta ? join(home, 'bin') : join(prefix, 'bin')
  const manifest = {
    name: '@openai/codex',
    version,
    bin: { codex: 'bin/codex.js' },
    optionalDependencies: {
      [`@openai/codex-${platform}`]: `npm:@openai/codex@${version}-${platform}`,
    },
  }
  const nativeManifest = {
    name: '@openai/codex',
    version: `${version}-${platform}`,
    os: [process.platform],
    cpu: [process.arch],
  }
  await Promise.all(
    [project, bin, dirname(wrapper), dirname(native)].map((path) =>
      mkdir(path, { recursive: true }),
    ),
  )
  // Executing either launcher would fail. Discovery must only read installation data.
  await writeFile(
    wrapper,
    '#!/usr/bin/env node\nthrow new Error("launcher must never execute");\n',
    { mode: 0o700 },
  )
  await writeFile(native, 'native fixture inspected by the provider after selection', {
    mode: 0o700,
  })
  await writeFile(join(pkg, 'package.json'), JSON.stringify(manifest))
  await writeFile(join(nativePkg, 'package.json'), JSON.stringify(nativeManifest))
  if (volta) {
    const imageBin = join(prefix, 'bin')
    await mkdir(imageBin, { recursive: true })
    await symlink(wrapper, join(imageBin, 'codex'))
    await writeFile(join(bin, 'volta-shim'), '#!/bin/sh\nexit 91\n', { mode: 0o700 })
    await symlink(join(bin, 'volta-shim'), join(bin, 'codex'))
    await mkdir(join(home, 'tools/user/bins'), { recursive: true })
    await writeFile(
      join(home, 'tools/user/bins/codex.json'),
      JSON.stringify({ name: 'codex', package: '@openai/codex', version, manager: 'Npm' }),
    )
  } else await symlink(wrapper, join(bin, 'codex'))
  return {
    root,
    project,
    home,
    prefix,
    pkg,
    nativePkg,
    native,
    wrapper,
    bin,
    manifest,
    nativeManifest,
  }
}

describe('static Codex npm installation selection', () => {
  for (const volta of [false, true]) {
    for (const hoisted of [false, true]) {
      test(`${volta ? 'Volta' : 'npm'} selects its ${hoisted ? 'hoisted' : 'nested'} native dependency without executing a launcher`, async () => {
        const f = await fixture(volta, hoisted)
        expect(await discover('codex', { PATH: f.bin }, f.project)).toBe(f.native)
        expect(await discover('codex', { CODEX_PATH: join(f.bin, 'codex') }, f.project)).toBe(
          f.native,
        )
      })
    }
  }

  test('an explicit invalid Volta home never selects the shim-adjacent installation', async () => {
    const f = await fixture(true)
    for (const home of ['', 'relative', join(f.root, 'missing'), `${f.home}\0`])
      await expect(
        discover('codex', { PATH: f.bin, VOLTA_HOME: home }, f.project),
      ).rejects.toMatchObject({ stage: 'wrapper' })
  })

  test('Volta home is snapshotted before filesystem work', async () => {
    const f = await fixture(true)
    const environment: Record<string, string> = { PATH: f.bin, VOLTA_HOME: f.home }
    const pending = discover('codex', environment, f.project)
    environment.VOLTA_HOME = f.project
    expect(await pending).toBe(f.native)
  })

  test('Volta metadata must name this exact installed Codex package', async () => {
    const f = await fixture(true)
    for (const change of [
      { name: 'other' },
      { package: '../other' },
      { version: '0.158.0' },
      { manager: 'Yarn' },
    ]) {
      await writeFile(
        join(f.home, 'tools/user/bins/codex.json'),
        JSON.stringify({
          name: 'codex',
          package: '@openai/codex',
          version,
          manager: 'Npm',
          ...change,
        }),
      )
      await expect(discover('codex', { PATH: f.bin }, f.project)).rejects.toMatchObject({
        stage: 'wrapper',
      })
    }
  })

  test('unsupported installation metadata refuses selection without another PATH candidate', async () => {
    const f = await fixture()
    const other = join(f.root, 'other')
    await mkdir(other)
    await writeFile(join(other, 'codex'), 'another native', { mode: 0o700 })
    for (const contents of [
      '{',
      'null',
      JSON.stringify({ ...f.manifest, bin: { codex: '../other' } }),
      JSON.stringify({ ...f.manifest, optionalDependencies: {} }),
      ' '.repeat(64 * 1024 + 1),
    ]) {
      await writeFile(join(f.pkg, 'package.json'), contents)
      await expect(
        discover('codex', { PATH: `${f.bin}:${other}` }, f.project),
      ).rejects.toMatchObject({ stage: 'wrapper' })
    }
  })

  test('an existing mismatched nearest native package does not fall back to a hoisted package', async () => {
    const f = await fixture(false, true)
    const nearest = join(f.pkg, 'node_modules', `@openai/codex-${platform}`)
    await mkdir(nearest, { recursive: true })
    await writeFile(
      join(nearest, 'package.json'),
      JSON.stringify({ ...f.nativeManifest, version: '0.158.0' }),
    )
    await expect(discover('codex', { PATH: f.bin }, f.project)).rejects.toMatchObject({
      stage: 'wrapper',
    })
    await rm(join(nearest, 'package.json'))
    await expect(discover('codex', { PATH: f.bin }, f.project)).rejects.toMatchObject({
      stage: 'wrapper',
    })
    await writeFile(join(nearest, 'package.json'), '{}')
    await expect(discover('codex', { PATH: f.bin }, f.project)).rejects.toMatchObject({
      stage: 'wrapper',
    })
  })

  test('native package metadata and executable must match the selected platform', async () => {
    const f = await fixture()
    for (const change of [
      { name: 'other' },
      { version: '0.158.0' },
      { os: ['other'] },
      { cpu: ['other'] },
    ]) {
      await writeFile(
        join(f.nativePkg, 'package.json'),
        JSON.stringify({ ...f.nativeManifest, ...change }),
      )
      await expect(discover('codex', { PATH: f.bin }, f.project)).rejects.toMatchObject({
        stage: 'wrapper',
      })
    }
    await writeFile(join(f.nativePkg, 'package.json'), JSON.stringify(f.nativeManifest))
    await chmod(f.native, 0o600)
    await expect(discover('codex', { PATH: f.bin }, f.project)).rejects.toMatchObject({
      stage: 'wrapper',
    })
    await rm(f.native)
    await expect(discover('codex', { PATH: f.bin }, f.project)).rejects.toMatchObject({
      stage: 'wrapper',
    })
  })

  test('implicit metadata and native files cannot route through project source', async () => {
    const f = await fixture()
    const moved = join(f.project, 'native')
    await mkdir(dirname(moved), { recursive: true })
    await writeFile(moved, 'project binary', { mode: 0o700 })
    await rm(f.native)
    await symlink(moved, f.native)
    for (const environment of [{ PATH: f.bin }, { CODEX_PATH: f.wrapper }])
      await expect(discover('codex', environment, f.project)).rejects.toMatchObject({
        stage: 'wrapper',
      })
  })

  test('Volta metadata cannot route through project source even with an explicit dispatcher override', async () => {
    const f = await fixture(true)
    const record = join(f.home, 'tools/user/bins/codex.json')
    const moved = join(f.project, 'codex.json')
    await writeFile(
      moved,
      JSON.stringify({ name: 'codex', package: '@openai/codex', version, manager: 'Npm' }),
    )
    await rm(record)
    await symlink(moved, record)
    for (const environment of [{ PATH: f.bin }, { CODEX_PATH: join(f.bin, 'codex') }])
      await expect(discover('codex', environment, f.project)).rejects.toMatchObject({
        stage: 'wrapper',
      })
  })

  test('an unsupported JavaScript launcher remains a wrapper refusal', async () => {
    const f = await fixture()
    const arbitrary = join(f.root, 'codex.js')
    await writeFile(arbitrary, '#!/usr/bin/env node\nthrow new Error("not Codex");', {
      mode: 0o700,
    })
    await expect(
      discover('codex', { CODEX_PATH: arbitrary, PATH: f.bin }, f.project),
    ).rejects.toMatchObject({ stage: 'wrapper' })
  })

  test('a direct native selection can be named codex.js', async () => {
    const f = await fixture()
    const native = join(f.root, 'codex.js')
    await writeFile(native, nativeElf(), { mode: 0o700 })
    expect(await discover('codex', { CODEX_PATH: native }, f.project)).toBe(native)
  })

  test.skipIf(!['linux', 'darwin'].includes(process.platform))(
    'an unread metadata pipe is refused without waiting for a writer',
    async () => {
      const f = await fixture()
      const manifest = join(f.pkg, 'package.json')
      await rm(manifest)
      expect(Bun.spawnSync(['/usr/bin/mkfifo', '-m', '600', manifest]).exitCode).toBe(0)
      const module = new URL('../src/internal/native-agent-executable.ts', import.meta.url).href
      const child = Bun.spawn(
        [
          process.execPath,
          '--eval',
          `import { resolvePrivateNativeAgentExecutable as discover } from ${JSON.stringify(module)};
try { await discover('codex', { CODEX_PATH: Bun.argv.at(-2) }, Bun.argv.at(-1)); process.exitCode = 2; }
catch (error) { console.log(error.stage); }`,
          f.wrapper,
          f.project,
        ],
        { stdout: 'pipe', stderr: 'pipe' },
      )
      const output = Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ])
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        expect(
          await Promise.race([
            child.exited,
            new Promise<'deadline'>((resolve) => {
              timer = setTimeout(() => resolve('deadline'), 5_000)
            }),
          ]),
        ).toBe(0)
        expect(await output).toEqual(['wrapper\n', ''])
        expect((await lstat(manifest)).isFIFO()).toBe(true)
      } finally {
        clearTimeout(timer)
        if (child.exitCode === null) child.kill('SIGKILL')
        await child.exited
        await output
      }
    },
    15_000,
  )

  test.skipIf(process.platform !== 'linux')(
    'provider pins native bytes without the dispatcher, npm launcher, metadata or Node',
    async () => {
      const f = await fixture(true)
      await writeFile(f.native, nativeElf(), { mode: 0o700 })
      const helpers = join(dirname(dirname(f.native)), 'codex-resources')
      await mkdir(helpers)
      await writeFile(join(helpers, 'bwrap'), nativeElf(), { mode: 0o700 })
      const provider = await openPrivateCodexAgentProvider(
        installedBunLocation.releaseRoot,
        { PATH: f.bin, OPENAI_API_KEY: 'offline-placeholder', OPENAI_MODEL: 'test-model' },
        f.project,
      )
      const runtime = privateAcpAgentRuntime(provider)
      expect(runtime.environment.CODEX_PATH).toBe(f.native)
      expect(
        runtime.readOnlyMounts.some(({ source }) =>
          /volta-shim|codex\.js|package\.json|\/node$/.test(source),
        ),
      ).toBe(false)
      await writeFile(join(f.home, 'tools/user/bins/codex.json'), 'changed selection')
      await writeFile(f.wrapper, 'changed launcher')
      await revalidatePrivateAcpAgentProvider(provider)
      await writeFile(f.native, nativeElf({ search: '' }))
      await expect(revalidatePrivateAcpAgentProvider(provider)).rejects.toThrow(
        'ACP Agent support changed after selection',
      )
    },
  )
})
