import { expect, test } from 'bun:test'
import { spawn, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PrivateFileImportUnconfirmedError } from '../../src/internal/execution-file-import.js'
import { writePrivateDeliveryFile } from '../../src/internal/file-delivery-storage.js'
import { privateReadRegularFile } from '../../src/internal/file-input.js'
import {
  preparePrivateMacosGuardian,
  recoverPrivateMacosGuardian,
  releasePrivateMacosGuardian,
} from '../../src/internal/macos-guardian-client.js'
import { requirePrivateMacosGuardianStorage } from '../../src/internal/macos-guardian-storage.js'
import type { PrivateMacosGuardianStart } from '../../src/internal/macos-native-supervisor.js'
import { samePrivateMacosOwnedProcess } from '../../src/internal/macos-process-controls.js'
import {
  source,
  configurationFixture,
  fixture,
  faultSupervisor,
  exists,
  proveIndependentStorageCleanup,
  type Fault,
} from '.././macos-file-import.fixture.js'

test('Mac import storage is explicit, output-only and unavailable to payload grants', () => {
  const mountPath = '/private/native/data'
  const files = {
    readOnlyFiles: [],
    readOnlyTrees: [],
    writableTrees: [join(mountPath, 'output')],
    protectedRoots: [],
    network: 'isolated' as const,
  }
  expect(() =>
    requirePrivateMacosGuardianStorage(
      { mountPath, bytes: 32 * 1024 * 1024, collect: 'output', imports: true },
      files,
      join(mountPath, 'output'),
    ),
  ).not.toThrow()
  for (const collect of ['work', null] as const)
    expect(() =>
      requirePrivateMacosGuardianStorage(
        { mountPath, bytes: 32 * 1024 * 1024, collect, imports: true },
        files,
        join(mountPath, 'output'),
      ),
    ).toThrow()
  expect(() =>
    requirePrivateMacosGuardianStorage(
      { mountPath, bytes: 32 * 1024 * 1024, collect: 'output', imports: true },
      { ...files, writableTrees: [join(mountPath, 'imports')] },
      join(mountPath, 'imports'),
    ),
  ).toThrow()
})
test('Mac process continuity permits exec but refuses PID reuse and foreign coalitions', () => {
  const original = { uniqueId: 10n, coalition: 20n }
  expect(samePrivateMacosOwnedProcess(original, { ...original })).toBe(true)
  expect(samePrivateMacosOwnedProcess(original, { uniqueId: 11n, coalition: 20n })).toBe(false)
  expect(samePrivateMacosOwnedProcess(original, { uniqueId: 10n, coalition: 21n })).toBe(false)
  expect(samePrivateMacosOwnedProcess(original, undefined)).toBe(false)
  expect(
    samePrivateMacosOwnedProcess(
      { uniqueId: 0n, coalition: 20n },
      { uniqueId: 0n, coalition: 20n },
    ),
  ).toBe(false)
  expect(
    samePrivateMacosOwnedProcess(
      { uniqueId: 10n, coalition: 0n },
      { uniqueId: 10n, coalition: 0n },
    ),
  ).toBe(false)
})
test('Mac import fault fixtures keep real native ownership and build for Bun', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'jig-import-fixtures-')))
  try {
    const supervisors = await Promise.all(
      (['roots-transfer', 'import-begin', 'import-commit'] as const).map((fault) =>
        faultSupervisor(root, fault, join(root, `${fault}.marker`)),
      ),
    )
    for (const entrypoint of [
      ...supervisors,
      fileURLToPath(new URL('.././fixtures/macos-file-import-coordinator.ts', import.meta.url)),
    ]) {
      const built = await Bun.build({ entrypoints: [entrypoint], target: 'bun', write: false })
      expect(built.success, String(built.logs)).toBe(true)
    }
  } finally {
    await rm(root, { recursive: true })
  }
})
