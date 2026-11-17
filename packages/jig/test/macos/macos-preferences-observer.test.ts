import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { checkNativeSupport } from '../../scripts/native-support.mjs'
import { privateMacosKernelPlatform } from '../../src/internal/macos-process-controls.js'
import { installedBunLocation } from '../fixtures/installed-bun-location.js'

// Only actual host calls and the shipped helper establish these native facts.
// A forced-policy host and genuinely stalled CF call need separate observations.
test('actual ARM observer authenticates its asset and refuses inherited sandboxes', () => {
  expect(privateMacosKernelPlatform()).toStartWith('darwin-arm64-')
  const root = installedBunLocation.releaseRoot
  const observer = join(root, 'support/macos-codex-preferences-universal')
  const manifest = checkNativeSupport(root)
  const hash = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex')
  expect(hash(observer)).toBe(manifest.sha256['support/macos-codex-preferences-universal'])
  const installed = join(root, 'libexec/macos-codex-preferences')
  const assets = [observer]
  if (existsSync(installed)) {
    expect(hash(installed)).toBe(hash(observer))
    assets.push(installed)
  }
  for (const actual of assets) {
    const run = (command: string, args: string[]) => {
      const result = spawnSync(command, args, { env: {}, encoding: 'utf8', timeout: 6000 })
      expect(result.error).toBeUndefined()
      expect(result.signal).toBeNull()
      expect(result.stdout).toBe('')
      expect(result.stderr).toBe('')
      return result.status
    }
    // This machine must actually have no configured forced Codex preferences.
    // No preference values, policy APIs, loader interposition or helper modes are replaced.
    expect(run(actual, [])).toBe(0)
    expect(run(actual, ['unexpected'])).toBe(70)
    for (const profile of [
      '(version 1)(allow default)',
      '(version 1)(allow default)(deny user-preference-read managed-preference-read)',
    ])
      expect(run('/usr/bin/sandbox-exec', ['-p', profile, actual])).toBe(70)
  }
}, 30_000)

if (
  process.platform !== 'darwin' ||
  process.arch !== 'arm64' ||
  process.env.JIG_MACOS_PROCESS_TEST !== '1'
)
  throw Error('This suite requires opted-in native ARM preference-observer qualification')
