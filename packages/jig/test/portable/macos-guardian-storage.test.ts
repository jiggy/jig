import { expect, test } from 'bun:test'
import { join } from 'node:path'
import { requirePrivateMacosGuardianStorage } from '../../src/internal/macos-guardian-storage.js'

test('Mac storage accepts only the closed collection configuration', () => {
  const mountPath = '/private/native/data'
  const files = {
    readOnlyFiles: [],
    readOnlyTrees: [],
    writableTrees: [join(mountPath, 'output')],
    protectedRoots: [],
    network: 'isolated' as const,
  }
  const storage = { mountPath, bytes: 32 * 1024 * 1024, collect: 'output' as const }
  expect(() =>
    requirePrivateMacosGuardianStorage(storage, files, join(mountPath, 'output')),
  ).not.toThrow()
  expect(() =>
    requirePrivateMacosGuardianStorage(
      { ...storage, unexpected: true } as typeof storage,
      files,
      join(mountPath, 'output'),
    ),
  ).toThrow('invalid macOS guardian storage')
})
