import { expect, test } from 'bun:test'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { join } from 'node:path'
import {
  isPrivateExecutionFenceUnconfirmed,
  planPrivateExecutionOwnerStateAllocation,
  privateExecutionBackendKind,
  requirePrivateExecutionBackend,
  sealPrivateExecutionOwner,
} from '../src/internal/execution-backend.js'
import {
  PrivateLinuxCgroupBackend,
  PrivateLinuxFenceUnconfirmedError,
} from '../src/internal/linux-rootless-backend.js'
import {
  PrivateMacosBackend,
  PrivateMacosFenceUnconfirmedError,
} from '../src/internal/macos-native-backend.js'

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

test('execution launch rejects a backend-plan mismatch before dispatch', async () => {
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
      sealPrivateExecutionOwner(linux, { kind: 'macos', plan: {} as never }, allocation),
    ).rejects.toThrow('execution launch, backend and owner allocation do not match')
  } finally {
    await rm(root, { recursive: true })
  }
})
