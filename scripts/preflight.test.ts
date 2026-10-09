import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { discoverHostTests, NATIVE_PREREQUISITE_TESTS } from './ci/macos-host-test-shards.mjs'
import {
  compilerEnvironment,
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

test('native preflight accepts only the existing unprivileged Mac qualification profiles', () => {
  expect(() => requireMacHost(host)).not.toThrow()
  for (const arch of ['x64', 'arm64']) {
    expect(() => requireMacHost({ ...host, arch, kernel: '24.6.0', build: '24G830' })).not.toThrow()
  }
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
  const files = await discoverHostTests(resolve(import.meta.dir, '..'))
  const future = 'packages/jig/test/nested/macos-future.test.ts'
  const planned = nativeTestFiles([...files, future])
  expect(planned.slice(0, NATIVE_PREREQUISITE_TESTS.length)).toEqual(NATIVE_PREREQUISITE_TESTS)
  expect(new Set(planned).size).toBe(planned.length)
  expect([...planned].sort()).toEqual(
    [...files.filter((file) => /\/macos-/.test(file)), future].sort(),
  )
  expect(() =>
    nativeTestFiles(files.filter((file) => file !== NATIVE_PREREQUISITE_TESTS[0])),
  ).toThrow('is missing')
  expect(() => nativeTestFiles([...files, NATIVE_PREREQUISITE_TESTS[0]])).toThrow('repeats')
})

test('preflight preserves tool configuration without inheriting live model opt-ins or credentials', () => {
  expect(
    testEnvironment({
      PATH: '/tools',
      FLOW_NODE: '/tools/node',
      JIG_AUTHORING_NODE_PATH: '/tools/node',
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
