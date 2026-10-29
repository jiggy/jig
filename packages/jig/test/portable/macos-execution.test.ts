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
  privateMacosPlatformFor,
  recoverPrivateMacosCoalition,
} from '../../src/internal/macos-process-controls.js'
import { runMacosFixture } from '.././fixtures/macos-launchd.js'
import { terminalJoinFailureFixture } from '.././macos-execution.fixture.js'

test('Mac candidate tuples preserve exact architecture, kernel and build identity', () => {
  const candidates = new Map([
    ['x64/23.4.0/23E224', 'darwin-x64-23.4.0-23E224'],
    ['x64/24.6.0/24G830', 'darwin-x64-24.6.0-24G830'],
    ['arm64/24.6.0/24G830', 'darwin-arm64-24.6.0-24G830'],
    ['arm64/24.6.0/24H232', 'darwin-arm64-24.6.0-24H232'],
  ])
  for (const architecture of ['x64', 'arm64', 'ia32'])
    for (const kernel of ['23.4.0', '24.6.0', '24.6.1', '25.0.0'])
      for (const build of ['23E224', '23E225', '24G830', '24H232', '24H233'])
        expect(privateMacosPlatformFor(architecture, kernel, build)).toBe(
          candidates.get(`${architecture}/${kernel}/${build}`),
        )
})

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
