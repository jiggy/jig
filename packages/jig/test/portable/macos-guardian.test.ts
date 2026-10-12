import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { accountingFaults, accountingSupervisor } from '.././macos-guardian.fixture.js'

test('constructs accounting fault guardians without native execution', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jig-accounting-build-'))
  try {
    for (const fault of accountingFaults) {
      const supervisor = await accountingSupervisor(root, fault)
      const compiled = await Bun.build({ entrypoints: [supervisor], target: 'bun' })
      expect({ success: compiled.success, logs: compiled.logs }).toEqual({
        success: true,
        logs: [],
      })
    }
  } finally {
    await rm(root, { recursive: true })
  }
})
