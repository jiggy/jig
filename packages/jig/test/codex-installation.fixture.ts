import { mkdir, mkdtemp, realpath, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const temporary: string[] = []
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

export { fixture, platform, temporary, triple, version }
