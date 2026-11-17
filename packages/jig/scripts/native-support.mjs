import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const recipe = 'scripts/native-support.mjs'
const manifestPath = 'support/macos-native-build.json'
const pinPath = 'src/internal/macos-descriptor-files.ts'
const installedPinPath = 'src/internal/installed-bun-support.ts'
const installedPinPattern = /descriptorBridgeDigest !==\s*'sha256:[a-f0-9]{64}'/
const assets = [
  ['macos-exec.c', 'macos-exec-universal'],
  ['macos-descriptor-bridge.c', 'macos-descriptor-bridge.dylib'],
  ['macos-codex-preferences.m', 'macos-codex-preferences-universal'],
]
const digest = (path) => createHash('sha256').update(readFileSync(path)).digest('hex')
const run = (...args) => execFileSync('/usr/bin/xcrun', args, { encoding: 'utf8' }).trim()
const pinPattern = /digest\('hex'\) !== '[a-f0-9]{64}'/

export function checkNativeSupport(directory = root) {
  const manifest = JSON.parse(readFileSync(join(directory, manifestPath), 'utf8'))
  const paths = [
    recipe,
    ...assets.flatMap(([source, binary]) => [`support/${source}`, `support/${binary}`]),
  ]
  for (const path of paths) {
    if (digest(join(directory, path)) !== manifest.sha256[path])
      throw new Error(
        `Native support is stale or modified: ${path}; run just jig::build-native-support on the recorded Apple toolchain`,
      )
  }
  const bridgeHash = manifest.sha256['support/macos-descriptor-bridge.dylib']
  if (!readFileSync(join(directory, pinPath), 'utf8').includes(`digest('hex') !== '${bridgeHash}'`))
    throw new Error('Native descriptor bridge runtime pin differs from the build manifest')
  const installedPin = readFileSync(join(directory, installedPinPath), 'utf8').match(
    installedPinPattern,
  )?.[0]
  if (!installedPin?.includes(`'sha256:${bridgeHash}'`))
    throw new Error('Installed descriptor bridge pin differs from the build manifest')
  return manifest
}

function compile(mode) {
  if (process.platform !== 'darwin')
    throw new Error('Native support compilation requires macOS and the Apple toolchain')
  const toolchain = {
    clang: run('clang', '--version').split('\n')[0],
    linker: run('ld', '-version_details'),
    sdk: run('--sdk', 'macosx', '--show-sdk-version'),
    sdkBuild: run('--sdk', 'macosx', '--show-sdk-build-version'),
  }
  if (mode === 'verify-rebuild') {
    const manifest = checkNativeSupport()
    if (JSON.stringify(toolchain) !== JSON.stringify(manifest.toolchain))
      throw new Error(
        'Exact native rebuild requires the Apple compiler, linker and SDK recorded in support/macos-native-build.json',
      )
  }
  const temporary = mkdtempSync(join(tmpdir(), 'jig-native-build-'))
  try {
    const sha256 = { [recipe]: digest(join(root, recipe)) }
    for (const [source, binary] of assets) {
      const input = join(root, 'support', source)
      const slices = []
      for (const arch of ['x86_64', 'arm64']) {
        const output = join(temporary, `${arch}-${binary}`)
        const flags = [
          '-arch',
          arch,
          '-isysroot',
          run('--sdk', 'macosx', '--show-sdk-path'),
          '-mmacosx-version-min=14.4',
          '-O2',
          '-Wall',
          '-Wextra',
          '-Werror',
          '-Wno-deprecated-declarations',
        ]
        if (binary.endsWith('.dylib'))
          flags.push('-dynamiclib', '-Wl,-install_name,@rpath/macos-descriptor-bridge.dylib')
        if (source.endsWith('.m')) flags.push('-fobjc-arc', '-framework', 'Foundation')
        run('clang', ...flags, input, '-o', output)
        slices.push(output)
      }
      const output = join(temporary, binary)
      run('lipo', '-create', ...slices, '-output', output)
      sha256[`support/${source}`] = digest(input)
      sha256[`support/${binary}`] = digest(output)
      if (mode === 'verify-rebuild' && digest(join(root, 'support', binary)) !== digest(output))
        throw new Error(`Rebuilt native bytes differ: ${binary}`)
    }
    if (mode === 'build') {
      const pin = readFileSync(join(root, pinPath), 'utf8')
      const installedPin = readFileSync(join(root, installedPinPath), 'utf8')
      if (!installedPinPattern.test(installedPin))
        throw new Error('Cannot locate installed bridge pin')
      if (!pinPattern.test(pin))
        throw new Error('Cannot locate the native descriptor bridge runtime pin')
      for (const [, binary] of assets)
        copyFileSync(join(temporary, binary), join(root, 'support', binary))
      writeFileSync(
        join(root, pinPath),
        pin.replace(
          pinPattern,
          `digest('hex') !== '${sha256['support/macos-descriptor-bridge.dylib']}'`,
        ),
      )
      writeFileSync(
        join(root, installedPinPath),
        installedPin.replace(
          installedPinPattern,
          `descriptorBridgeDigest !==\n      'sha256:${sha256['support/macos-descriptor-bridge.dylib']}'`,
        ),
      )
      writeFileSync(
        join(root, manifestPath),
        `${JSON.stringify({ toolchain, deploymentTarget: '14.4', architectures: ['x86_64', 'arm64'], sha256 }, null, 2)}\n`,
      )
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2]
  if (mode === 'check') checkNativeSupport()
  else if (mode === 'build' || mode === 'verify-rebuild') compile(mode)
  else throw new Error('Usage: native-support.mjs check|build|verify-rebuild')
  console.log(`Native support ${mode}: passed`)
}
