import { describe, expect, test } from 'bun:test'
import { chmod, lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { privateDomainDigest } from '../src/internal/identity.js'
import {
  normalizePrivateLinuxSealedOwnerIdentity,
  planPrivateLinuxOwnerStateAllocation,
  PrivateLinuxCgroupBackend,
  PrivateLinuxFenceUnconfirmedError,
  releasePrivateLinuxOwnerState,
  type PrivateLinuxSealedOwnerIdentity,
} from '../src/internal/linux-rootless-backend.js'
import type { JsonValue } from '../src/json.js'

const CURRENT_BOOT_ID = (await readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim()
const OTHER_BOOT_ID =
  CURRENT_BOOT_ID === '00000000-0000-0000-0000-000000000000'
    ? '11111111-1111-1111-1111-111111111111'
    : '00000000-0000-0000-0000-000000000000'

describe('private rootless Linux reboot recovery', () => {
  test('releases an active old-boot owner without probing its extinct cgroup', async () => {
    const fixture = await syntheticOwner(OTHER_BOOT_ID, 'old-boot')
    try {
      await expect(lstat(fixture.owner.delegatedCgroup)).rejects.toMatchObject({ code: 'ENOENT' })

      const receipt = await backend().recoverFence(fixture.owner)
      expect(receipt).toMatchObject({ fenced: true, stopReason: 'recovered' })
      expect(
        JSON.parse(await readFile(join(fixture.owner.ownerStateDirectory, 'final.json'), 'utf8')),
      ).toMatchObject({ recoveryBootId: CURRENT_BOOT_ID, stopReason: 'recovered' })

      await releasePrivateLinuxOwnerState(fixture.owner, receipt)
      await expect(lstat(fixture.owner.ownerStateDirectory)).rejects.toMatchObject({
        code: 'ENOENT',
      })
    } finally {
      await rm(fixture.parent, { recursive: true, force: true })
    }
  })

  test('retains an active same-boot owner when its delegated identity is missing', async () => {
    const fixture = await syntheticOwner(CURRENT_BOOT_ID, 'same-boot')
    try {
      await expect(backend().recoverFence(fixture.owner)).rejects.toBeInstanceOf(
        PrivateLinuxFenceUnconfirmedError,
      )
      expect(
        JSON.parse(await readFile(join(fixture.owner.ownerStateDirectory, 'claim.json'), 'utf8')),
      ).toMatchObject({ state: 'active' })
      await expect(
        lstat(join(fixture.owner.ownerStateDirectory, 'final.json')),
      ).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await rm(fixture.parent, { recursive: true, force: true })
    }
  })
})

function backend(): PrivateLinuxCgroupBackend {
  return new PrivateLinuxCgroupBackend({
    bunPath: '/bin/false',
    bunHostLibraryPath: '/lib',
    supervisorPath: '/bin/false',
  })
}

async function syntheticOwner(
  bootId: string,
  label: string,
): Promise<{ readonly parent: string; readonly owner: PrivateLinuxSealedOwnerIdentity }> {
  const parent = await mkdtemp(join(tmpdir(), `jig-rootless-${label}-`))
  await chmod(parent, 0o700)
  const allocation = await planPrivateLinuxOwnerStateAllocation({ parent, name: 'owner' })
  await mkdir(allocation.directory, { mode: 0o700 })
  const directory = await lstat(allocation.directory, { bigint: true })
  const nonce = 'a'.repeat(24)
  const delegatedCgroup = `/sys/fs/cgroup/jig-extinct-${label}-${process.pid}`
  const fields = {
    kind: 'private-linux-sealed-owner/1' as const,
    runId: 'reboot',
    nonce,
    ownerToken: allocation.ownerToken,
    mechanismDigest: privateDomainDigest('test-mechanism', {}),
    sealedPlanDigest: privateDomainDigest('test-plan', {}),
    bootId,
    delegatedCgroup,
    delegatedCgroupDevice: '1',
    delegatedCgroupInode: '1',
    runCgroup: `${delegatedCgroup}/jig-run-reboot-${nonce}`,
    deadlineUnixMs: 1,
    cancellationGraceMs: 1,
    cleanupTimeoutMs: 1,
    ownerStateParent: allocation.parent,
    ownerStateParentDevice: allocation.parentDevice,
    ownerStateParentInode: allocation.parentInode,
    ownerStateName: allocation.name,
    ownerStateDirectory: allocation.directory,
    ownerStateDevice: String(directory.dev),
    ownerStateInode: String(directory.ino),
    ownerStateAllocationDigest: allocation.digest,
  }
  const owner = normalizePrivateLinuxSealedOwnerIdentity({
    ...fields,
    digest: privateDomainDigest(
      'JIG-Rootless-Linux-Sealed-Owner/1',
      fields as unknown as JsonValue,
    ),
  })
  const ownerDigest = privateDomainDigest(
    'JIG-Rootless-Linux-Prepared-Owner/1',
    owner as unknown as JsonValue,
  )
  await writeFile(
    join(allocation.directory, 'owner.json'),
    `${JSON.stringify({
      allocationDigest: allocation.digest,
      kind: 'private-linux-owner-state/1',
      mechanismDigest: owner.mechanismDigest,
      ownerDigest,
      runCgroup: owner.runCgroup,
      sealedPlanDigest: owner.sealedPlanDigest,
      token: owner.ownerToken,
    })}\n`,
    { mode: 0o600 },
  )
  await writeFile(
    join(allocation.directory, 'claim.json'),
    `${JSON.stringify({
      allocationDigest: allocation.digest,
      kind: 'private-linux-owner-claim/1',
      state: 'active',
      token: owner.ownerToken,
    })}\n`,
    { mode: 0o600 },
  )
  return { parent, owner }
}
