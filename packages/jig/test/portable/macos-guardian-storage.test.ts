import { expect, test } from 'bun:test'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { requirePrivateMacosGuardianStorage } from '../../src/internal/macos-guardian-storage.js'
import {
  journalLossSupervisor,
  preJournalAllocationModule,
  preparationFailureSupervisor,
  preparationFailures,
} from '.././macos-guardian-storage.fixture.js'

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
test('constructs interrupted-journal and preparation-failure guardians without native execution', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'jig-guardian-fixtures-')))
  try {
    const supervisors = [await journalLossSupervisor(root), await preJournalAllocationModule(root)]
    for (const fixture of preparationFailures)
      supervisors.push(await preparationFailureSupervisor(root, fixture))
    for (const supervisor of supervisors) {
      const built = await Bun.build({ entrypoints: [supervisor], target: 'bun' })
      expect(built.success, String(built.logs)).toBe(true)
    }
  } finally {
    await rm(root, { recursive: true })
  }
})
