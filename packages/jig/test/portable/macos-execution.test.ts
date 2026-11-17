import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { createHmac } from 'node:crypto'
import { access, link, mkdtemp, readFile, realpath, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readPrivateMacosOwner } from '../../src/internal/macos-owner-state.js'
import {
  privateMacosDeploymentVersionFor,
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

test('Mach-O deployment ceiling follows the actual macOS product version, including 26', () => {
  for (const [version, expected] of [
    ['14.4.1', 0x000e0401],
    ['15.6', 0x000f0600],
    ['26.0', 0x001a0000],
    ['26.1.2', 0x001a0102],
    ['27.10.3', 0x001b0a03],
  ] as const) expect(privateMacosDeploymentVersionFor(version)).toBe(expected)
  for (const version of [
    '13.6', '14', '26', '26.1.2.3', '026.1', '26.-1', '26.100',
    '100.1', 'latest', '26.1\\n', '26.1  ',
  ]) expect(() => privateMacosDeploymentVersionFor(version)).toThrow('unavailable')
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
