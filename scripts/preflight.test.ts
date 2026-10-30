import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { NATIVE_PREREQUISITE_TESTS } from './ci/macos-host-test-shards.mjs'
import { discoverRepositoryTests } from './ci/suite-inventory.mjs'
import manifest from './ci/test-suites.json'
import {
  compilerEnvironment,
  macosOwnershipSnapshot,
  nativeTestFiles,
  requireMacHost,
  runNativeTests,
  testEnvironment,
} from './preflight'

const host = {
  arch: 'x64',
  kernel: '23.4.0',
  build: '23E224',
  uid: 501,
  bunVersion: '1.4.2',
  bunRevision: '744846f844374847c902b5e7fd59b4342a51ef99',
}

test('native preflight accepts only exact unprivileged Mac qualification candidates', () => {
  expect(() => requireMacHost(host)).not.toThrow()
  for (const arch of ['x64', 'arm64']) {
    expect(() => requireMacHost({ ...host, arch, kernel: '24.6.0', build: '24G830' })).not.toThrow()
  }
  expect(() =>
    requireMacHost({ ...host, arch: 'arm64', kernel: '24.6.0', build: '24H232' }),
  ).not.toThrow()
  for (const candidate of [
    { arch: 'x64', kernel: '24.6.0', build: '24H232' },
    { arch: 'arm64', kernel: '24.6.1', build: '24H232' },
    { arch: 'arm64', kernel: '24.6.0', build: '24H233' },
    { arch: 'arm64', kernel: '24.6.0', build: '24H232\n' },
  ])
    expect(() => requireMacHost({ ...host, ...candidate })).toThrow()
  for (const change of [
    { arch: 'arm64' },
    { arch: 'ia32' },
    { kernel: '23.5.0' },
    { build: '23E225' },
    { uid: 0 },
    { uid: undefined },
    { bunVersion: '1.4.3' },
    { bunRevision: 'different' },
  ])
    expect(() => requireMacHost({ ...host, ...change })).toThrow()
})

test('native inventory includes every discovered Mac file once, prerequisites first', async () => {
  const files = discoverRepositoryTests(resolve(import.meta.dir, '..'), manifest)
  const future = 'packages/jig/test/macos/future.test.ts'
  const planned = nativeTestFiles([...files, future])
  expect(planned).toContain('packages/jig/test/macos-23E224/macos-preferences-observer.test.ts')
  expect(planned.slice(0, NATIVE_PREREQUISITE_TESTS.length)).toEqual(NATIVE_PREREQUISITE_TESTS)
  expect(new Set(planned).size).toBe(planned.length)
  expect([...planned].sort()).toEqual(
    [...files.filter((file) => /\/macos(?:-23E224)?\//.test(file)), future].sort(),
  )
  expect(() =>
    nativeTestFiles(files.filter((file) => file !== NATIVE_PREREQUISITE_TESTS[0])),
  ).toThrow('is missing')
  expect(() => nativeTestFiles([...files, NATIVE_PREREQUISITE_TESTS[0]])).toThrow('Repeated')
  expect(nativeTestFiles(files, '24G830')).not.toContain(
    'packages/jig/test/macos-23E224/macos-preferences-observer.test.ts',
  )
  expect(nativeTestFiles(files, '24H232')).toEqual(nativeTestFiles(files, '24G830'))
  expect(() => nativeTestFiles([...files, 'packages/jig/test/unowned.test.ts'])).toThrow('Unowned')
})

test('preflight preserves tool configuration without inheriting live model opt-ins or credentials', () => {
  expect(
    testEnvironment({
      PATH: '/tools',
      FLOW_NODE: '/tools/node',
      JIG_AUTHORING_NODE_PATH: '/tools/node',
      PYTHON: '/tools/python',
      TMPDIR: '/tmp',
      JIG_MACOS_PROCESS_TEST: '1',
      JIG_NATIVE_AGENT_RESTORE: '1',
      JIG_NATIVE_AGENT_STARTUP: '1',
      JIG_CODEX_PROOF_PATH: '/client',
      JIG_RESTORE_MODEL: 'model',
      OPENAI_API_KEY: 'private',
      OPENROUTER_API_KEY: 'private',
      ANTHROPIC_AUTH_TOKEN: 'private',
    }),
  ).toEqual({
    PATH: '/tools',
    FLOW_NODE: '/tools/node',
    JIG_AUTHORING_NODE_PATH: '/tools/node',
    PYTHON: '/tools/python',
    TMPDIR: '/tmp',
  })
})

test('preflight resolves real compiler paths once and preserves separate operator selections', () => {
  const calls: string[] = []
  const source = { PATH: '/tools', FLOW_NODE: '/shim/node', OPENAI_API_KEY: 'private' }
  const environment = compilerEnvironment(source, (selected, env) => {
    expect(env.OPENAI_API_KEY).toBeUndefined()
    calls.push(selected)
    return {
      status: 0,
      stdout: JSON.stringify({
        name: 'node',
        major: 22,
        bun: false,
        executable: `/real${selected}`,
      }),
    }
  })
  expect(calls).toEqual(['/shim/node'])
  expect(environment).toEqual({
    PATH: '/tools',
    FLOW_NODE: '/real/shim/node',
    JIG_AUTHORING_NODE_PATH: '/real/shim/node',
  })
  expect(source.FLOW_NODE).toBe('/shim/node')
  expect(
    compilerEnvironment({ ...source, JIG_AUTHORING_NODE_PATH: '/other/node' }, (selected) => ({
      status: 0,
      stdout: JSON.stringify({
        name: 'node',
        major: 24,
        bun: false,
        executable: `/real${selected}`,
      }),
    })),
  ).toMatchObject({ FLOW_NODE: '/real/shim/node', JIG_AUTHORING_NODE_PATH: '/real/other/node' })
})

test('preflight resolves PATH-selected Node without an operator compiler override', () => {
  const node = Bun.which('node')
  expect(node).toBeString()
  const environment = compilerEnvironment({
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    FLOW_NODE: '',
    JIG_AUTHORING_NODE_PATH: '',
  })
  expect(environment.FLOW_NODE?.startsWith('/')).toBeTrue()
  expect(environment.JIG_AUTHORING_NODE_PATH).toBe(environment.FLOW_NODE)
  const child = spawnSync(environment.FLOW_NODE!, ['-p', 'process.release.name'], {
    env: environment,
    encoding: 'utf8',
  })
  expect(child.status).toBe(0)
  expect(child.stdout.trim()).toBe('node')
})

test('preflight refuses missing, old, Bun or malformed compiler identity before work', () => {
  const identity = { name: 'node', major: 22, bun: false, executable: '/real/node' }
  for (const result of [
    { status: 1, stdout: JSON.stringify(identity) },
    { status: null, stdout: '' },
    { status: 0, stdout: 'not JSON' },
    ...[
      { major: 21 },
      { bun: true },
      { name: 'bun' },
      { executable: 'relative/node' },
      { major: '24' },
    ].map((change) => ({ status: 0, stdout: JSON.stringify({ ...identity, ...change }) })),
  ]) {
    expect(() => compilerEnvironment({ PATH: '/tools' }, () => result)).toThrow('real Node 22+')
  }
})

test('the full command refuses an invalid selected compiler before starting a build', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'jig-preflight-node-'))
  try {
    const selected = resolve(directory, 'old-node')
    await writeFile(
      selected,
      '#!/bin/sh\nprintf \'{"name":"node","major":20,"bun":false,"executable":"/old/node"}\\n\'\n',
      { mode: 0o700 },
    )
    const result = spawnSync(process.execPath, [resolve(import.meta.dir, 'preflight.ts')], {
      env: { ...testEnvironment(process.env), FLOW_NODE: selected },
      encoding: 'utf8',
    })
    expect(result.status).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('real Node 22+')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('a real child failure stops native preflight and still checks residue', () => {
  const calls: unknown[] = [],
    reports: string[] = []
  let snapshots = 0
  const status = runNativeTests(
    ['first.test.ts', 'second.test.ts'],
    { PATH: '/tools' },
    (command, args, env) => {
      calls.push({ command, args, env })
      return spawnSync(process.execPath, ['-e', 'process.exit(42)']).status ?? 1
    },
    () => {
      snapshots++
      return 'existing ownership'
    },
    (message) => reports.push(message),
  )
  expect(status).toBe(42)
  expect(snapshots).toBe(2)
  expect(calls).toEqual([
    {
      command: process.execPath,
      args: ['test', './first.test.ts', '--bail=1', '--timeout', '420000'],
      env: { PATH: '/tools', JIG_MACOS_PROCESS_TEST: '1' },
    },
  ])
  expect(reports.join('\n')).not.toContain('passed')
})

test('residue changes fail successful tests without overwriting an earlier test failure', () => {
  for (const childStatus of [0, 42]) {
    let snapshots = 0
    const reports: string[] = []
    const status = runNativeTests(
      ['one.test.ts'],
      {},
      () => childStatus,
      () => (snapshots++ === 0 ? 'before' : 'unconfirmed owned work'),
      (message) => reports.push(message),
    )
    expect(status).toBe(childStatus || 1)
    expect(reports.join('\n')).toContain('Preserve failed fixtures')
    expect(reports.join('\n')).not.toContain('passed')
  }
})

test('successful native checks run sequentially and report their bounded coverage', () => {
  const calls: string[] = [],
    reports: string[] = []
  const status = runNativeTests(
    ['one.test.ts', 'two.test.ts'],
    {},
    (_command, args) => {
      calls.push(args[1] ?? 'missing file')
      return 0
    },
    () => '',
    (message) => reports.push(message),
  )
  expect(status).toBe(0)
  expect(calls).toEqual(['./one.test.ts', './two.test.ts'])
  expect(reports.at(-1)).toContain('2 files')
  expect(reports.at(-1)).toContain('Full hosted qualification remains required')
})

test('final residue inspection failure preserves a prior child failure and cannot claim success', () => {
  for (const childStatus of [0, 42]) {
    let snapshots = 0
    const reports: string[] = []
    const status = runNativeTests(
      ['one.test.ts'],
      {},
      () => childStatus,
      () => {
        if (snapshots++ === 0) return ''
        throw Error('inspection unavailable')
      },
      (message) => reports.push(message),
    )
    expect(status).toBe(childStatus || 1)
    expect(reports.join('\n')).toContain('could not verify')
    expect(reports.join('\n')).not.toContain('passed')
  }
})

test('invalid preflight arguments fail before any build or test', () => {
  const result = spawnSync(
    process.execPath,
    [resolve(import.meta.dir, 'preflight.ts'), 'invalid'],
    { encoding: 'utf8' },
  )
  expect(result.status).toBe(1)
  expect(result.stdout).toBe('')
  expect(result.stderr).toContain('Usage: just preflight')
})

test('source-stage options are validated by the CI runner before build or native host checks', () => {
  for (const args of [
    ['--targets', 'not-a-source-stage'],
    ['--targets', 'source-python,source-python'],
    ['--profile', 'not-a-source-profile'],
  ]) {
    const result = spawnSync(
      process.execPath,
      [resolve(import.meta.dir, 'preflight.ts'), 'source', ...args],
      { env: testEnvironment(process.env), encoding: 'utf8', timeout: 5000 },
    )
    expect(result.status).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toMatch(
      /Unknown source target|Repeated source target|Invalid source profile/,
    )
    expect(result.stderr).not.toContain('Native preflight requires')
  }
})

test('Python-only source checks preserve the selected interpreter and refuse before creating reports', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'jig-source-preflight-'))
  try {
    const reports = resolve(directory, 'source reports')
    const result = spawnSync(
      process.execPath,
      [
        resolve(import.meta.dir, 'preflight.ts'),
        'source',
        '--targets',
        'source-python',
        '--report-directory',
        reports,
      ],
      {
        env: { ...testEnvironment(process.env), PYTHON: resolve(directory, 'missing-python') },
        encoding: 'utf8',
        timeout: 5000,
      },
    )
    expect(result.status).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('Selected source stages require Python 3; set PYTHON.')
    expect(result.stderr).not.toContain('Native preflight requires')
    expect(existsSync(reports)).toBe(false)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

const mountFixture = [
  '/dev/disk20 on /private/tmp/jig-owned/mount (hfs, local, nodev, noexec)',
  '/dev/disk21 on /Volumes/Jig-0123456789abcdef (hfs, local, nodev, noexec)',
  '/dev/disk22 on /Volumes/Jig-0123456789abcdef 1 (hfs, local, nodev, noexec)',
  '/dev/disk23 on /Volumes/Ordinary (hfs, local)',
  '/dev/disk24 on /Volumes/My-Jig-0123456789abcdef (hfs, local)',
  '/dev/disk25 on /Volumes/Personal/Jig-0123456789abcdef (hfs, local)',
  '/dev/disk26 on /Volumes/Jigsaw (hfs, local)',
].join('\n')
const expectedMountResidue = mountFixture
  .split('\n')
  .slice(0, 3)
  .map((line) => `mount ${line}`)
  .sort()
function observedMounts(text: string, calls: unknown[] = []) {
  return macosOwnershipSnapshot((command, args) => {
    calls.push({ command, args })
    if (command === '/bin/launchctl' && args.join(' ') === 'list') return 'PID\tStatus\tLabel\n'
    if (command === '/sbin/mount' && args.length === 0) return text
    if (command === '/bin/ps' && args.join(' ') === '-axo pid=,command=') return ''
    throw Error('Residue observation attempted a non-observational command')
  })
}
test('native snapshots observe automatic Jig volumes and explicit paths without cleanup authority', () => {
  const calls: unknown[] = []
  expect(observedMounts(mountFixture, calls).split('\n')).toEqual(expectedMountResidue)
  expect(calls).toEqual([
    { command: '/bin/launchctl', args: ['list'] },
    { command: '/sbin/mount', args: [] },
    { command: '/bin/ps', args: ['-axo', 'pid=,command='] },
  ])
  expect(observedMounts(mountFixture.split('\n').slice(3).join('\n'))).toBe('')
})
test('an automatic uppercase mount refuses clean credit and preserves an earlier failure', () => {
  for (const childStatus of [0, 42]) {
    let snapshots = 0
    const reports: string[] = []
    const status = runNativeTests(
      ['one.test.ts'],
      {},
      () => childStatus,
      () => observedMounts(snapshots++ === 0 ? '' : mountFixture.split('\n')[1]!),
      (message) => reports.push(message),
    )
    expect(status).toBe(childStatus || 1)
    expect(snapshots).toBe(2)
    expect(reports.join('\n')).toContain('mount /dev/disk21 on /Volumes/Jig-0123456789abcdef')
    expect(reports.join('\n')).not.toContain('passed')
  }
})
test('hosted and self-hosted Mac snapshot commands execute the same automatic-volume detection', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'jig-mac-mount-evidence-'))
  try {
    const bin = resolve(directory, 'bin'),
      input = resolve(directory, 'mounts.txt')
    await mkdir(bin)
    await writeFile(input, mountFixture + '\n', { mode: 0o600 })
    for (const [name, body] of Object.entries({
      launchctl: 'test "$#" -eq 1 && test "$1" = list || exit 90\nprintf "PID\\tStatus\\tLabel\\n"',
      mount: 'test "$#" -eq 0 || exit 90\ncat "$MOUNT_FIXTURE"',
      ps: 'test "$#" -eq 2 && test "$1" = -axo && test "$2" = pid=,command= || exit 90',
    }))
      await writeFile(resolve(bin, name), `#!/bin/sh\nset -eu\n${body}\n`, { mode: 0o700 })
    for (const path of [
      'scripts/ci/qualify-macos-host.sh',
      '.github/workflows/macos-hosted-candidates.yml',
    ]) {
      const source = await readFile(resolve(import.meta.dir, '..', path), 'utf8'),
        lines = source.split('\n')
      const start = lines.findIndex((line) => /^\s*snapshot\(\) \{$/.test(line))
      expect(start).toBeGreaterThanOrEqual(0)
      const end = lines.findIndex((line, index) => index > start && line.trim() === '}')
      expect(end).toBeGreaterThan(start)
      const indent = lines[start]!.match(/^\s*/)![0].length
      const command =
        lines
          .slice(start, end + 1)
          .map((line) => line.slice(indent))
          .join('\n') + '\nsnapshot\n'
      const result = spawnSync('/bin/sh', ['-c', command], {
        encoding: 'utf8',
        timeout: 5000,
        env: { PATH: `${bin}:/usr/bin:/bin`, LC_ALL: 'C', MOUNT_FIXTURE: input },
      })
      expect(result.error).toBeUndefined()
      expect(result.status).toBe(0)
      expect(result.stderr).toBe('')
      expect(result.stdout.trimEnd().split('\n')).toEqual(expectedMountResidue)
    }
    const selfHosted = await readFile(
      resolve(import.meta.dir, '../.github/workflows/macos-host-conformance.yml'),
      'utf8',
    )
    expect(selfHosted).toContain('run: scripts/ci/qualify-macos-host.sh --preflight')
    expect(selfHosted).toContain('run: scripts/ci/qualify-macos-host.sh\n')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}, 15_000)
