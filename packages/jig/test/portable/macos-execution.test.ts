import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { createHmac } from 'node:crypto'
import { access, link, mkdtemp, readFile, realpath, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readPrivateMacosOwner } from '../../src/internal/macos-owner-state.js'
import {
  privateMacosOwnerIsFromPriorBoot,
  recoverPrivateMacosCoalition,
} from '../../src/internal/macos-process-controls.js'
import { runMacosFixture } from '.././fixtures/macos-launchd.js'
import { terminalJoinFailureFixture } from '.././macos-execution.fixture.js'

test('constructs Mac launcher terminal-join failure while retaining the actual owner and native producer', async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'jig-macos-exec-fixture-')))
  try {
    const fixture = await terminalJoinFailureFixture(directory)
    const built = await Bun.build({ entrypoints: [fixture], target: 'bun', write: false })
    expect(built.success, String(built.logs)).toBe(true)
  } finally {
    await rm(directory, { recursive: true })
  }
})
