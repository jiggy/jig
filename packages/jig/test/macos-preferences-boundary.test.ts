import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { privateExecutionPath } from '../src/internal/execution-intent.js'
import { privateMacosExecutionPlan } from '../src/internal/execution-plan.js'
import { openPrivateInstalledBunSupport } from '../src/internal/installed-bun-support.js'
import { PrivateMacosBackend } from '../src/internal/macos-native-backend.js'
import { installedBunLocation } from './fixtures/installed-bun-location.js'

const native = test.skipIf(
  process.platform !== 'darwin' || process.env.JIG_MACOS_PROCESS_TEST !== '1',
)
native(
  'Codex notification access denies populated host preferences, writes, other services and writable shared pages',
  async () => {
    const root = await realpath(await mkdtemp('/private/tmp/jig-preferences-boundary-'))
    const payload = join(root, 'payload')
    const other = `md.jig.fixture.${randomUUID()}`,
      canary = `jig-fixture-${randomUUID()}`
    const args = [canary, other, canary]
    let ownsCanary = false
    let safeToRemove = true
    const hostCall = (mode: string) =>
      spawnSync(payload, [...args, mode, String(process.pid)], {
        stdio: 'ignore',
        env: {},
        timeout: 5000,
      })
    try {
      const build = spawnSync(
        '/usr/bin/clang',
        [
          '-O2',
          '-Wall',
          '-Wextra',
          '-Werror',
          '-Wno-deprecated-declarations',
          join(import.meta.dir, 'fixtures/macos-preferences-payload.c'),
          '-framework',
          'CoreFoundation',
          '-o',
          payload,
        ],
        { encoding: 'utf8', timeout: 15_000 },
      )
      expect({ status: build.status, errors: build.stderr }).toEqual({ status: 0, errors: '' })
      // Only these freshly absent, unique fixture keys are populated. Existing
      // operator settings are never changed, printed or used as test values.
      expect(hostCall('absent').status).toBe(0)
      ownsCanary = true
      expect(hostCall('seed').status).toBe(0)
      expect(hostCall('host').status).toBe(0)
      expect(hostCall('verify').status).toBe(0)
      const support = await openPrivateInstalledBunSupport(installedBunLocation)
      if (!support.launcherPath) throw new Error('missing native launcher')
      const backend = new PrivateMacosBackend({
        bunPath: support.executablePath,
        supervisorPath: support.supervisorPath,
        launcherPath: support.launcherPath,
      })
      safeToRemove = false
      const component = await backend.launch((allocation) =>
        privateMacosExecutionPlan(
          {
            runId: 'codex-preferences-boundary',
            command: [privateExecutionPath(payload), ...args, 'payload', String(process.pid)],
            projections: [{ source: payload, destination: payload, kind: 'file' }],
            limits: {
              memoryBytes: 128 * 1024 * 1024,
              pids: 16,
              cpuQuotaMicros: 100_000,
              cpuPeriodMicros: 100_000,
              deadlineUnixMs: Date.now() + 15_000,
              cancellationGraceMs: 1000,
              cleanupTimeoutMs: 5000,
            },
            environment: { HOME: '/tmp' },
            relocateEnvironment: true,
            network: 'isolated',
            macosCodexPreferenceNotifications: true,
            maxOutputBytes: 4096,
            storageBytes: 16 * 1024 * 1024,
          },
          allocation,
        ),
      )
      try {
        const collect = async (stream: AsyncIterable<Uint8Array>) => {
          let text = ''
          for await (const bytes of stream) text += new TextDecoder().decode(bytes)
          return text
        }
        const [stdout, stderr, receipt] = await Promise.all([
          collect(component.stdout),
          collect(component.stderr),
          component.enforcement,
        ])
        expect(receipt).toMatchObject({
          exitCode: 0,
          signal: null,
          fenced: true,
          stopReason: 'payload_exit',
        })
        expect(stderr).toBe('')
        expect(stdout).toBe('preference values and writes denied; notification reads only\n')
      } finally {
        await component.terminate()
        safeToRemove = true
      }
      // Fresh trusted process, rather than CF's local write cache, verifies state.
      expect(hostCall('verify').status).toBe(0)
      expect(hostCall('host').status).toBe(0)
    } finally {
      if (safeToRemove) {
        if (ownsCanary) {
          expect(hostCall('cleanup').status).toBe(0)
          expect(hostCall('absent').status).toBe(0)
        }
        await rm(root, { recursive: true, force: true })
      } else {
        console.error(`unconfirmed preferences fixture retained at ${root}`)
      }
    }
  },
  45_000,
)
