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

test('Mac platform captures observed ARM host identity without build allowlists', () => {
  for (const [kernel, build] of [
    ['23.4.0', '23E224'],
    ['24.6.0', '24G830'],
    ['25.0.0', '25A100'],
    ['26.1.0', '26B321'],
  ]) expect(privateMacosPlatformFor('arm64', kernel, build)).toBe(`darwin-arm64-${kernel}-${build}`)
  for (const [arch, kernel, build] of [
    ['x64', '24.6.0', '24G830'],
    ['arm64', '22.6.0', '22G100'],
    ['arm64', 'invalid', '24G830'],
    ['arm64', '25.0.0', 'bad-build'],
    ['arm64', '25.0.0', '25A100\\n'],
  ]) expect(privateMacosPlatformFor(arch, kernel, build)).toBeUndefined()
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
