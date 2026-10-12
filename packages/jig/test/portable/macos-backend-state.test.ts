import { expect, test } from 'bun:test'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { interruptedReleaseFixture, unsafeRecordFixture } from '.././macos-backend-state.fixture.js'

test('constructs the owner-state subprocess fixtures without native execution', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'jig-release-fixture-')))
  try {
    const runners = [await interruptedReleaseFixture(root), await unsafeRecordFixture(root)]
    const built = await Bun.build({ entrypoints: runners, target: 'bun' })
    expect(built.success, String(built.logs)).toBe(true)
  } finally {
    await rm(root, { recursive: true })
  }
})
