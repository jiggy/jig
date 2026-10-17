import { expect, test } from 'bun:test'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { join } from 'node:path'
import {
  isPrivateExecutionFenceUnconfirmed,
  planPrivateExecutionOwnerStateAllocation,
  privateExecutionBackendKind,
  requirePrivateExecutionBackend,
  sealPrivateExecutionOwner,
} from '../../src/internal/execution-backend.js'
import {
  normalizePrivateLinuxConfirmedEnforcementReceipt,
  PrivateLinuxCgroupBackend,
  PrivateLinuxFenceUnconfirmedError,
} from '../../src/internal/linux-rootless-backend.js'
import {
  normalizePrivateMacosConfirmedEnforcementReceipt,
  PrivateMacosBackend,
  PrivateMacosFenceUnconfirmedError,
} from '../../src/internal/macos-native-backend.js'

test('native receipt decoders retain clock loss distinctly from elapsed expiry', () => {
  const common = {
    ownerDigest: `sha256:${'1'.repeat(64)}`,
    stopReason: 'clock',
    exitCode: null,
    signal: null,
    fenced: true,
  }
  const linux = {
    ...common,
    kind: 'private-linux-confirmed-enforcement/1',
    evidence: { cpuStat: {}, memoryEvents: {}, pidsEvents: {} },
  }
  const mac = {
    ...common,
    kind: 'private-macos-confirmed-enforcement/1',
    outputLost: true,
    recovered: false,
    evidence: {
      cpuNanoseconds: '0',
      peakFootprintBytes: '0',
      peakTasks: 0,
      samples: 0,
      pauses: 0,
      incompleteSamples: 0,
      maxSampleMilliseconds: 0,
    },
  }
  expect(normalizePrivateLinuxConfirmedEnforcementReceipt(linux).stopReason).toBe('clock')
  expect(normalizePrivateMacosConfirmedEnforcementReceipt(mac).stopReason).toBe('clock')
  expect(() =>
    normalizePrivateLinuxConfirmedEnforcementReceipt({ ...linux, stopReason: 'clock-loss' }),
  ).toThrow()
  expect(() =>
    normalizePrivateMacosConfirmedEnforcementReceipt({ ...mac, stopReason: 'clock-loss' }),
  ).toThrow()
})

test('execution backend boundary accepts only the two private implementations', () => {
  const linux = new PrivateLinuxCgroupBackend({
    bunPath: '/private/runtime/bun',
    bunHostLibraryPath: '/private/runtime/lib',
    supervisorPath: '/private/runtime/linux-supervisor',
  })
  const macos = new PrivateMacosBackend({
    bunPath: '/private/runtime/bun',
    supervisorPath: '/private/runtime/macos-supervisor',
    launcherPath: '/private/runtime/macos-exec',
  })
  expect(requirePrivateExecutionBackend(linux)).toBe(linux)
  expect(requirePrivateExecutionBackend(macos)).toBe(macos)
  expect(privateExecutionBackendKind(linux)).toBe('linux')
  expect(privateExecutionBackendKind(macos)).toBe('macos')
  expect(() => requirePrivateExecutionBackend(Object.freeze({}))).toThrow()
  expect(isPrivateExecutionFenceUnconfirmed(new PrivateLinuxFenceUnconfirmedError('lost'))).toBe(
    true,
  )
  expect(isPrivateExecutionFenceUnconfirmed(new PrivateMacosFenceUnconfirmedError('lost'))).toBe(
    true,
  )
  expect(isPrivateExecutionFenceUnconfirmed(new Error('lost'))).toBe(false)
})
test('execution launch rejects a backend-allocation mismatch before dispatch', async () => {
  const root = await realpath(
    await mkdtemp(join(process.env.TMPDIR ?? '/tmp', 'jig-backend-union-')),
  )
  try {
    const linux = new PrivateLinuxCgroupBackend({
      bunPath: '/private/runtime/bun',
      bunHostLibraryPath: '/private/runtime/lib',
      supervisorPath: '/private/runtime/linux-supervisor',
    })
    const allocation = await planPrivateExecutionOwnerStateAllocation(linux, {
      parent: root,
      name: 'owner',
    })
    await expect(
      sealPrivateExecutionOwner(
        new PrivateMacosBackend({
          bunPath: '/private/runtime/bun',
          supervisorPath: '/private/runtime/macos-supervisor',
          launcherPath: '/private/runtime/macos-exec',
        }),
        {} as never,
        allocation,
      ),
    ).rejects.toThrow('execution backend and owner allocation do not match')
  } finally {
    await rm(root, { recursive: true })
  }
})
