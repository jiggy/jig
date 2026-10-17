import { expect, test } from 'bun:test'
import {
  normalizePrivateMacosEvaluationWorkspace,
  PRIVATE_MACOS_EVALUATION_WORKSPACE_LIMITS,
  requirePrivateMacosEvaluationEnvironment,
} from '../../src/internal/macos-evaluation-workspace.js'
import { requirePrivateMacosGuardianStorage } from '../../src/internal/macos-guardian-storage.js'
import {
  type PrivateMacosSandboxFiles,
  privateMacosSandboxProfile,
} from '../../src/internal/macos-sandbox-profile.js'

const files: PrivateMacosSandboxFiles = {
  readOnlyFiles: ['/opt/runtime/bun'],
  readOnlyTrees: ['/private/tmp/admitted'],
  writableTrees: ['/private/tmp/scratch'],
  protectedRoots: ['/private/tmp/control'],
  network: 'isolated',
}

test('evaluation overlap is closed to fixed phase outputs and bounded owner storage', () => {
  const root = '/private/tmp/owner/data/evaluation'
  for (const phase of ['generate', 'compile', 'test'] as const) {
    const outputs =
      phase === 'generate' ? ['generated', 'reports'] : phase === 'compile' ? ['dist'] : ['reports']
    const evaluation: PrivateMacosSandboxFiles = {
      ...files,
      readOnlyTrees: [root],
      writableTrees: [
        ...outputs.map((name) => `${root}/${name}`),
        `${root}/scratch`,
        '/private/tmp/owner/data/tmp',
      ],
      evaluationWorkspace: { phase, root },
    }
    expect(privateMacosSandboxProfile(evaluation).bootstrap).toBe('closed')
    const storage = {
      mountPath: '/private/tmp/owner/data',
      bytes: 512 * 1024 * 1024,
      collect: 'evaluation' as const,
    }
    expect(() => requirePrivateMacosGuardianStorage(storage, evaluation, root)).not.toThrow()
    for (const write of [root, `${root}/src`, `${root}/reports/nested`, `${root}/node_modules`])
      expect(() =>
        privateMacosSandboxProfile({
          ...evaluation,
          writableTrees: [...evaluation.writableTrees, write],
        }),
      ).toThrow()
    expect(() => privateMacosSandboxProfile({ ...evaluation, network: 'inherited' })).toThrow()
    expect(() =>
      privateMacosSandboxProfile({ ...evaluation, evaluationWorkspace: undefined }),
    ).toThrow('immutable')
    expect(() =>
      requirePrivateMacosGuardianStorage({ ...storage, bytes: 64 * 1024 * 1024 }, evaluation, root),
    ).toThrow()
    expect(() => requirePrivateMacosGuardianStorage(storage, evaluation, `${root}/src`)).toThrow()
    expect(() =>
      requirePrivateMacosGuardianStorage(
        storage,
        {
          ...evaluation,
          writableTrees: [...evaluation.writableTrees, '/private/tmp/owner/data/work'],
        },
        root,
      ),
    ).toThrow()
  }
})

test('evaluation source descriptor is a closed inert phase and canonical source only', () => {
  expect(PRIVATE_MACOS_EVALUATION_WORKSPACE_LIMITS).toEqual({
    files: 8448,
    bytes: 192 * 1024 * 1024,
  })
  expect(Object.isFrozen(PRIVATE_MACOS_EVALUATION_WORKSPACE_LIMITS)).toBe(true)
  expect(
    normalizePrivateMacosEvaluationWorkspace({
      phase: 'test',
      source: '/retained/package',
      emptyDirectories: ['assets/empty', 'generated/prior-empty'],
    }),
  ).toEqual({
    phase: 'test',
    source: '/retained/package',
    emptyDirectories: ['assets/empty', 'generated/prior-empty'],
  })
  for (const value of [
    null,
    { phase: 'other', source: '/retained/package', emptyDirectories: [] },
    { phase: 'test', source: '../package', emptyDirectories: [] },
    { phase: 'test', source: '/retained/../package', emptyDirectories: [] },
    { phase: 'test', source: '/retained/package', emptyDirectories: [], writableRoots: ['src'] },
  ])
    expect(() => normalizePrivateMacosEvaluationWorkspace(value)).toThrow()
  for (const emptyDirectories of [
    ['../escape'],
    ['/absolute'],
    ['a//b'],
    ['reports'],
    ['reports/empty'],
    ['scratch/empty'],
    ['duplicate', 'duplicate'],
    ['a/'.repeat(17) + 'deep'],
    Array.from({ length: 257 }, (_, index) => `empty-${index}`),
  ])
    expect(() =>
      normalizePrivateMacosEvaluationWorkspace({
        phase: 'test',
        source: '/retained/package',
        emptyDirectories,
      }),
    ).toThrow()
  for (const phase of ['generate', 'compile', 'test'] as const)
    for (const name of phase === 'generate'
      ? ['generated', 'reports', 'dist']
      : phase === 'compile'
        ? ['dist']
        : ['reports'])
      expect(() =>
        normalizePrivateMacosEvaluationWorkspace({
          phase,
          source: '/retained/package',
          emptyDirectories: [`${name}/empty`],
        }),
      ).toThrow()
  const environment = {
    TMPDIR: '/owner/data/tmp',
    BUN_RUNTIME_TRANSPILER_CACHE_PATH: '0',
    BUN_CONFIG_NO_CLEAR_TERMINAL: '1',
  }
  expect(() => requirePrivateMacosEvaluationEnvironment(environment, '/owner/data')).not.toThrow()
  for (const extra of [
    { API_KEY: 'synthetic' },
    { PATH: '/ambient/bin' },
    { TMPDIR: '/tmp' },
    { BUN_RUNTIME_TRANSPILER_CACHE_PATH: '/ambient/cache' },
  ])
    expect(() =>
      requirePrivateMacosEvaluationEnvironment({ ...environment, ...extra }, '/owner/data'),
    ).toThrow()
})

test('control data cannot be exposed through either an ancestor or a descendant grant', () => {
  for (const key of ['readOnlyFiles', 'readOnlyTrees', 'writableTrees'] as const)
    for (const grant of ['/private/tmp', '/private/tmp/control', '/private/tmp/control/secret'])
      expect(() => privateMacosSandboxProfile({ ...files, [key]: [grant] })).toThrow('host control')
  expect(() => privateMacosSandboxProfile({ ...files, protectedRoots: [] })).toThrow(
    'control roots',
  )
})
test('writable projections cannot overlap immutable runtime or admitted data', () => {
  for (const grant of [
    '/opt/runtime',
    '/private/tmp/admitted',
    '/private/tmp/admitted/nested',
    '/System/Library/new',
    '/usr/share/icu',
  ])
    expect(() => privateMacosSandboxProfile({ ...files, writableTrees: [grant] })).toThrow(
      'immutable',
    )
})
test('malformed paths and policy expansion beyond the bounded native handoff are rejected', () => {
  for (const value of [
    'relative',
    '/private/tmp/../control',
    '/private/tmp/with\nnewline',
    '/private/tmp/with\0nul',
  ])
    expect(() => privateMacosSandboxProfile({ ...files, readOnlyFiles: [value] })).toThrow('path')
  expect(() =>
    privateMacosSandboxProfile({
      ...files,
      readOnlyFiles: Array.from({ length: 100 }, (_, i) => `/opt/${i}/${'x'.repeat(400)}`),
    }),
  ).toThrow('bound')
})
test('ordinary offline execution closes bootstrap and explicit network authority retains service lookup', () => {
  expect(privateMacosSandboxProfile(files).bootstrap).toBe('closed')
  expect(privateMacosSandboxProfile({ ...files, network: 'inherited' }).bootstrap).toBe('services')
})
test('Codex receives notification counters without any preference values or writes', () => {
  if (process.platform !== 'darwin') return
  const profile = privateMacosSandboxProfile({ ...files, codexPreferenceNotifications: true })
  expect(profile.bootstrap).toBe('services')
  expect(profile.text).toContain(`(ipc-posix-name "apple.cfprefs.${process.getuid!()}v1")`)
  expect(profile.text).toContain('(ipc-posix-name "apple.cfprefs.daemonv1")')
  expect(profile.text).not.toContain('user-preference-read')
  expect(profile.text).not.toContain('managed-preference-read')
  expect(profile.text).not.toContain('ipc-posix-shm-write')
  expect(profile.text).not.toContain('network-outbound')
  expect(profile.text).not.toContain('ipc-posix-name-prefix')
  expect(privateMacosSandboxProfile(files).text).not.toContain('cfpref')
  expect(() =>
    privateMacosSandboxProfile({
      ...files,
      codexPreferenceNotifications: false,
    } as unknown as PrivateMacosSandboxFiles),
  ).toThrow('notification policy')
})
