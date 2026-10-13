import { describe, expect, setDefaultTimeout, test } from 'bun:test'
import { chmod, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  disposePrivatePackageMaterializationLease,
  materializePrivatePackageLease,
  reacquirePrivatePackageMaterializationLease,
} from '../../src/internal/package-materialization.js'
import { runCrashFixture, workspaceFixture } from '.././package-materialization.fixture.js'

setDefaultTimeout(15_000)
describe('private workspace layout materialization', () => {
  test('recovers the Darwin chmod-before-rename disposal window without readmitting mutable bytes', async () => {
    const fixture = await workspaceFixture()
    try {
      const lease = await materializePrivatePackageLease(fixture.captured, fixture.allocation)
      const child = await runCrashFixture('chmod-before-rename', {
        JIG_TEST_IDENTITY: JSON.stringify(lease.identity),
      })
      expect(child.exitCode).toBe(76)
      await expect(
        reacquirePrivatePackageMaterializationLease(fixture.protectedParent, lease.identity),
      ).rejects.toThrow()
      await disposePrivatePackageMaterializationLease(fixture.protectedParent, lease.identity)
      expect(await readdir(fixture.protectedParent)).toEqual([])
    } finally {
      await fixture.dispose()
    }
  })
  test('refuses changed bytes after interruption before the Darwin disposal rename', async () => {
    const fixture = await workspaceFixture()
    try {
      const lease = await materializePrivatePackageLease(fixture.captured, fixture.allocation)
      const child = await runCrashFixture('chmod-before-rename', {
        JIG_TEST_IDENTITY: JSON.stringify(lease.identity),
      })
      expect(child.exitCode).toBe(76)
      const file = join(lease.root, 'libraries/shared/value.txt')
      await chmod(file, 0o600)
      await writeFile(file, 'changed')
      await chmod(file, 0o444)
      await expect(
        disposePrivatePackageMaterializationLease(fixture.protectedParent, lease.identity),
      ).rejects.toThrow('changed digest')
      expect(await readFile(file, 'utf8')).toBe('changed')
    } finally {
      await fixture.dispose()
    }
  })
})

if (process.platform !== 'darwin') throw Error('This suite requires a native Mac')
