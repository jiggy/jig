import { spawnSync } from 'node:child_process'
import { arch, platform, release } from 'node:os'
import { basename, isAbsolute, resolve } from 'node:path'
import { discoverHostTests, NATIVE_PREREQUISITE_TESTS } from './ci/macos-host-test-shards.mjs'

const repository = resolve(import.meta.dir, '..')
const timeoutMs = 10 * 60_000

export function requireMacHost(host: {
  arch: string
  kernel: string
  build: string
  uid: number | undefined
  bunVersion: string
  bunRevision: string
}) {
  const selected =
    (host.arch === 'x64' && host.kernel === '23.4.0' && host.build === '23E224') ||
    (['x64', 'arm64'].includes(host.arch) && host.kernel === '24.6.0' && host.build === '24G830')
  if (!selected || host.uid === undefined || host.uid === 0) {
    throw Error(
      'Native preflight requires an unprivileged operator on an exact supported Mac host; use hosted Mac CI for other hosts.',
    )
  }
  if (
    host.bunVersion !== '1.4.2' ||
    host.bunRevision !== '744846f844374847c902b5e7fd59b4342a51ef99'
  ) {
    throw Error(
      'Native preflight requires the qualified Bun 1.4.2 revision 744846f844374847c902b5e7fd59b4342a51ef99.',
    )
  }
}

export function nativeTestFiles(files: readonly string[]): string[] {
  const native = files.filter((file) => basename(file).startsWith('macos-'))
  if (new Set(native).size !== native.length)
    throw Error('Native preflight inventory repeats a test file')
  for (const prerequisite of NATIVE_PREREQUISITE_TESTS) {
    if (!native.includes(prerequisite))
      throw Error(`Native preflight test is missing: ${prerequisite}`)
  }
  return [
    ...NATIVE_PREREQUISITE_TESTS,
    ...native.filter((file) => !NATIVE_PREREQUISITE_TESTS.includes(file)).sort(),
  ]
}

// Retain tool locations and compiler selection, but no ambient model opt-ins,
// API credentials or native-client paths. Test fixtures supply their own peers.
export function testEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {}
  for (const key of [
    'PATH',
    'HOME',
    'TMPDIR',
    'XDG_RUNTIME_DIR',
    'DBUS_SESSION_BUS_ADDRESS',
    'FLOW_NODE',
    'JIG_AUTHORING_NODE_PATH',
    'NO_COLOR',
    'TERM',
  ]) {
    if (source[key] !== undefined) environment[key] = source[key]
  }
  return environment
}

type NodeProbe = (
  selected: string,
  environment: NodeJS.ProcessEnv,
) => {
  status: number | null
  stdout: string
}

export function compilerEnvironment(
  source: NodeJS.ProcessEnv,
  probe: NodeProbe = (selected, environment) =>
    spawnSync(
      selected,
      [
        '-p',
        'JSON.stringify({name:process.release.name,major:Number(process.versions.node.split(".")[0]),bun:!!process.versions.bun,executable:process.execPath})',
      ],
      { env: environment, encoding: 'utf8', timeout: 5000, maxBuffer: 4096 },
    ),
): NodeJS.ProcessEnv {
  const environment = testEnvironment(source)
  const resolved = new Map<string, string>()
  for (const key of ['FLOW_NODE', 'JIG_AUTHORING_NODE_PATH']) {
    const selected = source[key] || source.FLOW_NODE || 'node'
    let executable = resolved.get(selected)
    if (!executable) {
      const result = probe(selected, environment)
      let identity: { name?: unknown; major?: unknown; bun?: unknown; executable?: unknown } = {}
      try {
        identity = JSON.parse(result.stdout) ?? {}
      } catch {}
      if (
        result.status !== 0 ||
        identity.name !== 'node' ||
        typeof identity.major !== 'number' ||
        !Number.isInteger(identity.major) ||
        identity.major < 22 ||
        identity.bun !== false ||
        typeof identity.executable !== 'string' ||
        !isAbsolute(identity.executable)
      ) {
        throw Error(
          `Local preflight requires real Node 22+; cannot resolve ${key} from ${selected}.`,
        )
      }
      executable = identity.executable
      resolved.set(selected, executable)
    }
    environment[key] = executable
  }
  return environment
}

type Execute = (command: string, args: string[], environment: NodeJS.ProcessEnv) => number

export function runNativeTests(
  files: readonly string[],
  environment: NodeJS.ProcessEnv,
  execute: Execute,
  snapshot: () => string,
  report: (message: string) => void,
): number {
  const before = snapshot()
  let status = 0
  try {
    for (const file of files) {
      report(`Native Mac regression check: ${file}`)
      status = execute(process.execPath, ['test', `./${file}`, '--bail=1', '--timeout', '420000'], {
        ...environment,
        JIG_MACOS_PROCESS_TEST: '1',
      })
      if (status !== 0) break
    }
  } finally {
    try {
      const after = snapshot()
      if (after !== before) {
        report(
          'Native preflight changed host ownership residue. Preserve failed fixtures and investigate; do not remove unconfirmed work.',
        )
        report(`Ownership before:\n${before || '(empty)'}\nOwnership after:\n${after || '(empty)'}`)
        if (status === 0) status = 1
      }
    } catch {
      report(
        'Native preflight could not verify final host ownership residue. Preserve failed fixtures and investigate.',
      )
      if (status === 0) status = 1
    }
  }
  if (status === 0)
    report(
      `Native Mac regression checks passed (${files.length} files). Full hosted qualification remains required.`,
    )
  return status
}

function capture(command: string, args: string[]) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 5000 })
  if (result.error || result.status !== 0)
    throw Error(`Cannot read native host evidence with ${command}`)
  return result.stdout
}

function snapshot() {
  return [
    ...capture('/bin/launchctl', ['list'])
      .split('\n')
      .filter((line) => /\borg\.jig\./.test(line))
      .map((line) => `job ${line.trim().split(/\s+/).at(-1)}`),
    ...capture('/sbin/mount', [])
      .split('\n')
      .filter((line) => line.includes('jig-'))
      .map((line) => `mount ${line}`),
    ...capture('/bin/ps', ['-axo', 'pid=,command='])
      .split('\n')
      .filter((line) => /macos-native-supervisor|macos-exec|\/jig-guardian-/.test(line))
      .map((line) => `process ${line.trim().split(/\s+/)[0]}`),
  ]
    .sort()
    .join('\n')
}

function execute(command: string, args: string[], environment: NodeJS.ProcessEnv) {
  const result = spawnSync(command, args, {
    cwd: repository,
    env: environment,
    stdio: 'inherit',
    timeout: timeoutMs,
  })
  if (result.error) console.error(`Preflight could not finish ${command}: ${result.error.message}`)
  return result.status ?? 1
}

async function main() {
  const mode = process.argv[2] ?? 'all'
  if (!['all', 'native'].includes(mode) || process.argv.length > 3)
    throw Error('Usage: just preflight (or package-local just check)')
  const mac = platform() === 'darwin'
  if (mac) {
    requireMacHost({
      arch: arch(),
      kernel: release(),
      build: capture('/usr/bin/sw_vers', ['-buildVersion']).trim(),
      uid: process.getuid?.(),
      bunVersion: Bun.version,
      bunRevision: Bun.revision,
    })
  }
  const files = mac ? nativeTestFiles(await discoverHostTests(repository)) : []
  if (mode === 'all') {
    for (const tool of ['just', 'node', 'jq']) {
      if (!Bun.which(tool))
        throw Error(
          `Local preflight requires ${tool} on PATH before building; install the repository development prerequisites.`,
        )
    }
  }
  const environment =
    mac || mode === 'all' ? compilerEnvironment(process.env) : testEnvironment(process.env)
  if (mode === 'all') {
    for (const recipe of ['jig::build', 'test-tooling', 'test']) {
      console.log(`Preflight: ${recipe}`)
      const status = execute(
        'just',
        ['--justfile', resolve(repository, 'justfile'), recipe],
        environment,
      )
      if (status !== 0) return status
    }
  }
  if (!mac) {
    console.log(
      'Portable checks only on this host; native Mac and delegated Linux coverage require host CI.',
    )
    return 0
  }
  return runNativeTests(files, environment, execute, snapshot, console.log)
}

if (import.meta.main) {
  try {
    process.exitCode = await main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Preflight failed')
    process.exitCode = 1
  }
}
