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

test('offline execution closes bootstrap and only explicit network authority retains DNS bootstrap', () => {
  expect(privateMacosSandboxProfile(files).bootstrap).toBe('closed')
  expect(privateMacosSandboxProfile({ ...files, network: 'inherited' }).bootstrap).toBe('dns')
})
