import { expect, test } from 'bun:test'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  journalLossSupervisor,
  preJournalAllocationModule,
  preparationFailureSupervisor,
  preparationFailures,
} from '.././macos-guardian-storage.fixture.js'

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
