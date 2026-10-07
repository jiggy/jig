import { expect, test } from 'bun:test'
import {
  type PrivateMacosSandboxFiles,
  privateMacosSandboxProfile,
} from '../src/internal/macos-sandbox-profile.js'

const files: PrivateMacosSandboxFiles = {
  readOnlyFiles: ['/opt/runtime/bun'],
  readOnlyTrees: ['/private/tmp/admitted'],
  writableTrees: ['/private/tmp/scratch'],
  protectedRoots: ['/private/tmp/control'],
  network: 'isolated',
}

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
