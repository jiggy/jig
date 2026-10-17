const suiteTestUrl = new URL('../' + import.meta.url.split('/').at(-1), import.meta.url).href

import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { fstatSync } from 'node:fs'
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  readFile,
  rm,
  rmdir,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { privateReadRegularFile } from '../../src/internal/file-input.js'
import {
  privateMacosDirectory,
  privateMacosFilesystem,
} from '../../src/internal/macos-descriptor-files.js'
import {
  preparePrivateMacosGuardian,
  recoverPrivateMacosGuardian,
  releasePrivateMacosGuardian,
} from '../../src/internal/macos-guardian-client.js'
import {
  type PrivateMacosGuardianRecoveryDiagnostic,
  withPrivateMacosGuardianDiagnostics,
} from '../../src/internal/macos-guardian-diagnostics.js'
import {
  allocatePrivateMacosGuardianStorage,
  removeEmptyPrivateMacosUnstartedStorage,
} from '../../src/internal/macos-guardian-storage.js'
import type { PrivateMacosGuardianStart } from '../../src/internal/macos-native-supervisor.js'
import {
  privateMacosStorageRecoveryToken,
  readPrivateMacosOwner,
} from '../../src/internal/macos-owner-state.js'
import {
  allocatePrivateMacosVolume,
  createPrivateMacosVolume,
  recoverPrivateMacosVolume,
  releasePrivateMacosVolume,
} from '../../src/internal/macos-volume.js'
import { exists, killGuardian } from '.././macos-guardian-storage.fixture.js'

function expectUnstartedJobAbsent(token: string): void {
  const label = `org.jig.native.${createHash('sha256').update(token).digest('hex').slice(0, 32)}`
  expect(
    spawnSync('/bin/launchctl', ['print', `user/${process.getuid!()}/${label}`], {
      env: {},
      timeout: 5000,
    }).status,
  ).toBe(113)
}

test('invalid native mount input leaves only an empty allocation for exact recovery', async () => {
  const root = await mkdtemp('/private/tmp/jig-storage-allocation-loss-')
  const owner = join(root, 'owner'),
    mount = join(root, 'data')
  const token = randomBytes(32).toString('hex')
  await mkdir(owner, { mode: 0o700 })
  await mkdir(mount, { mode: 0o700 })
  await writeFile(join(root, 'sibling-canary'), 'preserved', { mode: 0o600, flag: 'wx' })
  const mountIdentity = await lstat(mount, { bigint: true })
  await writeFile(
    join(root, 'fixture.json'),
    JSON.stringify({ ownerDirectory: owner, ownerToken: token }),
    { mode: 0o600, flag: 'wx' },
  )
  let verified = false,
    primaryError: unknown
  try {
    await expect(
      allocatePrivateMacosGuardianStorage(owner, token, {
        mountPath: join(mount, 'missing'),
        bytes: 16 * 1024 * 1024,
        collect: null,
      }),
    ).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readdir(join(owner, 'storage'))).toEqual([])
    expect(await exists(join(owner, 'owner.json'))).toBe(false)
    expectUnstartedJobAbsent(token)
    await recoverPrivateMacosGuardian(owner, token, 5000)
    await recoverPrivateMacosGuardian(owner, token, 5000)
    expect(await exists(join(owner, 'storage'))).toBe(false)
    expect(await exists(join(owner, 'recovery'))).toBe(false)
    expect(await readFile(join(root, 'sibling-canary'), 'utf8')).toBe('preserved')
    expect((await lstat(mount, { bigint: true })).ino).toBe(mountIdentity.ino)
    expect(await readdir(mount)).toEqual([])
    await releasePrivateMacosGuardian(owner, token)
    await releasePrivateMacosGuardian(owner, token)
    expect(await exists(owner)).toBe(false)
    verified = true
  } catch (error) {
    primaryError = error
  }
  if (verified) await rm(root, { recursive: true })
  else console.error('Unstarted storage allocation evidence retained at', root)
  if (primaryError !== undefined) throw primaryError
}, 45_000)

for (const entry of [
  'volume.json',
  'volume.dmg',
  'volume-image.json',
  'volume-image.pending',
  'foreign',
]) {
  test(`unstarted storage retains a nonempty ${entry} allocation`, async () => {
    const root = await mkdtemp('/private/tmp/jig-unstarted-storage-')
    const owner = join(root, 'owner'),
      storage = join(owner, 'storage')
    const token = randomBytes(32).toString('hex')
    await mkdir(storage, { recursive: true, mode: 0o700 })
    const bytes = 'test-owned invalid or partial state'
    await writeFile(join(storage, entry), bytes, { mode: 0o600, flag: 'wx' })
    let verified = false
    try {
      expectUnstartedJobAbsent(token)
      expect(await removeEmptyPrivateMacosUnstartedStorage(owner)).toBe(false)
      expect(await readFile(join(storage, entry), 'utf8')).toBe(bytes)
      // Remove only the fixture's own known leaf after proving it was retained;
      // ordinary no-owner recovery then owns empty-directory retirement.
      await unlink(join(storage, entry))
      await recoverPrivateMacosGuardian(owner, token, 5000)
      await releasePrivateMacosGuardian(owner, token)
      verified = true
    } finally {
      if (verified) await rm(root, { recursive: true })
      else console.error('Unstarted storage refusal evidence retained at', root)
    }
  }, 30_000)
}

for (const kind of [
  'known-owner',
  'retirement',
  'retirement-pending',
  'public-mode',
  'symlink',
] as const) {
  test(`unstarted storage refuses the ${kind} empty-child exception`, async () => {
    const root = await mkdtemp('/private/tmp/jig-unstarted-storage-')
    const owner = join(root, 'owner'),
      storage = join(owner, 'storage')
    const token = randomBytes(32).toString('hex')
    await mkdir(storage, { recursive: true, mode: 0o700 })
    let verified = false
    const marker =
      kind === 'retirement'
        ? 'storage.release.json'
        : kind === 'retirement-pending'
          ? 'storage.release.pending'
          : 'owner.json'
    if (['known-owner', 'retirement', 'retirement-pending'].includes(kind))
      await writeFile(join(owner, marker), 'test-owned marker', { mode: 0o600, flag: 'wx' })
    if (kind === 'public-mode') await chmod(storage, 0o755)
    if (kind === 'symlink') {
      await rmdir(storage)
      await mkdir(join(root, 'foreign'), { mode: 0o700 })
      await writeFile(join(root, 'foreign/canary'), 'preserved', { mode: 0o600, flag: 'wx' })
      await symlink(join(root, 'foreign'), storage)
    }
    try {
      expectUnstartedJobAbsent(token)
      if (['known-owner', 'retirement', 'retirement-pending'].includes(kind))
        expect(await removeEmptyPrivateMacosUnstartedStorage(owner)).toBe(false)
      else
        await expect(removeEmptyPrivateMacosUnstartedStorage(owner)).rejects.toBeInstanceOf(Error)
      expect(await exists(storage)).toBe(true)
      if (['known-owner', 'retirement', 'retirement-pending'].includes(kind)) {
        expect(await readFile(join(owner, marker), 'utf8')).toBe('test-owned marker')
        await unlink(join(owner, marker))
      }
      if (kind === 'public-mode') await chmod(storage, 0o700)
      if (kind === 'symlink') {
        expect(await readFile(join(root, 'foreign/canary'), 'utf8')).toBe('preserved')
        await unlink(storage)
        await mkdir(storage, { mode: 0o700 })
      }
      await recoverPrivateMacosGuardian(owner, token, 5000)
      await releasePrivateMacosGuardian(owner, token)
      verified = true
    } finally {
      if (verified) await rm(root, { recursive: true })
      else console.error('Unstarted storage guard evidence retained at', root)
    }
  }, 30_000)
}

test('native storage enumeration refuses an actually closed owned descriptor', async () => {
  const root = await mkdtemp('/private/tmp/jig-storage-closed-directory-')
  const directory = await open(root, 'r')
  try {
    const fd = directory.fd
    const entries = privateMacosDirectory(fd)
    expect(entries.readSync()).toBeNull()
    entries.closeSync()
    expect(() => entries.readSync()).toThrow('macOS directory stream is closed')
    await directory.close()
    // No intervening allocation can reuse this descriptor before the native call.
    expect(() => privateMacosDirectory(fd)).toThrow()
    expect(await readdir(root)).toEqual([])
  } finally {
    await directory.close()
    await rm(root, { recursive: true })
  }
}, 30_000)

for (const kind of ['missing-owner', 'file-owner'] as const) {
  test(`unstarted storage refuses the actual ${kind} path`, async () => {
    const root = await mkdtemp('/private/tmp/jig-storage-invalid-path-')
    const owner = join(root, 'owner')
    if (kind === 'file-owner') await writeFile(owner, 'preserved', { mode: 0o600, flag: 'wx' })
    try {
      await expect(removeEmptyPrivateMacosUnstartedStorage(owner)).rejects.toBeInstanceOf(Error)
      if (kind === 'file-owner') expect(await readFile(owner, 'utf8')).toBe('preserved')
      else expect(await exists(owner)).toBe(false)
    } finally {
      await rm(root, { recursive: true })
    }
  }, 30_000)
}

test('unstarted storage cannot retire a mounted foreign volume', async () => {
  const root = await mkdtemp('/private/tmp/jig-unstarted-storage-mount-')
  const owner = join(root, 'owner'),
    storage = join(owner, 'storage'),
    control = join(root, 'volume-control')
  const token = randomBytes(32).toString('hex'),
    volumeToken = randomBytes(32).toString('hex')
  await mkdir(storage, { recursive: true, mode: 0o700 })
  await mkdir(control, { mode: 0o700 })
  await writeFile(
    join(root, 'fixture.json'),
    JSON.stringify({ ownerDirectory: owner, ownerToken: token, controlPath: control, volumeToken }),
    { mode: 0o600, flag: 'wx' },
  )
  let volume: Awaited<ReturnType<typeof createPrivateMacosVolume>> | undefined
  let verified = false,
    primaryError: unknown
  try {
    volume = await createPrivateMacosVolume(control, volumeToken, storage, 16 * 1024 * 1024)
    const filesystem = privateMacosFilesystem(volume.directory.fd)
    expect(filesystem.mountpoint).toBe(storage)
    expectUnstartedJobAbsent(token)
    await expect(removeEmptyPrivateMacosUnstartedStorage(owner)).rejects.toBeInstanceOf(Error)
    expect(privateMacosFilesystem(volume.directory.fd).device).toBe(filesystem.device)
    verified = true
  } catch (error) {
    primaryError = error
  }
  try {
    await volume?.directory.close()
    await recoverPrivateMacosVolume(control, volumeToken)
    await releasePrivateMacosVolume(control, volumeToken)
    await recoverPrivateMacosGuardian(owner, token, 5000)
    await releasePrivateMacosGuardian(owner, token)
  } catch (cleanupError) {
    console.error('Mounted storage refusal evidence retained at', root)
    if (primaryError !== undefined)
      throw new AggregateError(
        [primaryError, cleanupError],
        'Mounted storage test and cleanup failed',
      )
    throw cleanupError
  }
  if (verified) await rm(root, { recursive: true })
  else console.error('Mounted storage refusal evidence retained at', root)
  if (primaryError !== undefined) throw primaryError
}, 45_000)

test('empty unstarted storage retains an authenticated earlier recovery-slot fence', async () => {
  const root = await mkdtemp('/private/tmp/jig-unstarted-storage-recovery-')
  const owner = join(root, 'owner'),
    storage = join(owner, 'storage'),
    recovery = join(owner, 'recovery')
  const token = randomBytes(32).toString('hex'),
    recoveryToken = privateMacosStorageRecoveryToken(token)
  await mkdir(storage, { recursive: true, mode: 0o700 })
  await mkdir(recovery, { mode: 0o700 })
  await writeFile(
    join(root, 'fixture.json'),
    JSON.stringify({ ownerDirectory: owner, ownerToken: token }),
    { mode: 0o600, flag: 'wx' },
  )
  const prior = await preparePrivateMacosGuardian({
    bun: process.execPath,
    supervisor: fileURLToPath(new URL('../src/internal/macos-native-supervisor.ts', suiteTestUrl)),
    configuration: {
      type: 'start',
      ownerDirectory: recovery,
      ownerToken: recoveryToken,
      launcher: fileURLToPath(new URL('../support/macos-exec-universal', suiteTestUrl)),
      cwd: '/',
      command: ['/usr/bin/true'],
      environment: {},
      maxOutputBytes: 4096,
      files: {
        readOnlyFiles: ['/usr/bin/true'],
        readOnlyTrees: [],
        writableTrees: [],
        protectedRoots: [owner],
        network: 'isolated',
      },
      limits: {
        memoryBytes: 32 * 1024 * 1024,
        pids: 4,
        cpuQuotaMicros: 50_000,
        cpuPeriodMicros: 100_000,
        deadlineUnixMs: Date.now() + 30_000,
        cleanupTimeoutMs: 5000,
      },
    },
  })
  prior.stdout.resume()
  prior.stderr.resume()
  let verified = false,
    primaryError: unknown
  try {
    // Lose the actual prepared guardian before admission. Its client must fence
    // the real coalition; the authenticated journal remains for outer recovery.
    killGuardian(prior.identity)
    expect(await prior.completion).toMatchObject({
      fenced: true,
      recovered: true,
      result: null,
    })
    const recorded = readPrivateMacosOwner(recovery, recoveryToken)
    expect(recorded.identity).toEqual(prior.identity)
    expect(await exists(storage)).toBe(true)
    await recoverPrivateMacosGuardian(owner, token, 5000)
    expect(await exists(storage)).toBe(false)
    expectUnstartedJobAbsent(recoveryToken)
    expect(readPrivateMacosOwner(recovery, recoveryToken).identity).toEqual(recorded.identity)
    await releasePrivateMacosGuardian(owner, token)
    expect(await exists(owner)).toBe(false)
    verified = true
  } catch (error) {
    primaryError = error
  }
  try {
    prior.cancel()
    await prior.completion
    await recoverPrivateMacosGuardian(owner, token, 5000)
    await releasePrivateMacosGuardian(owner, token)
  } catch (cleanupError) {
    console.error('Retained recovery-slot evidence retained at', root)
    if (primaryError !== undefined)
      throw new AggregateError(
        [primaryError, cleanupError],
        'Recovery-slot test and cleanup failed',
      )
    throw cleanupError
  }
  if (verified) await rm(root, { recursive: true })
  else console.error('Retained recovery-slot evidence retained at', root)
  if (primaryError !== undefined) throw primaryError
}, 45_000)

for (const unavailable of ['runtime', 'supervisor'] as const) {
  test(`actual missing recovery ${unavailable} preserves native storage for retry`, async () => {
    const root = await mkdtemp('/private/tmp/jig-recovery-drain-')
    const owner = join(root, 'owner')
    const storage = join(owner, 'storage')
    const mount = join(root, 'data')
    const token = randomBytes(32).toString('hex')
    const supervisor =
      unavailable === 'supervisor'
        ? join(root, 'missing-supervisor.ts')
        : fileURLToPath(new URL('../src/internal/macos-native-supervisor.ts', suiteTestUrl))
    await mkdir(storage, { recursive: true, mode: 0o700 })
    await mkdir(mount, { mode: 0o700 })
    try {
      const volume = await createPrivateMacosVolume(storage, token, mount, 16 * 1024 * 1024)
      await volume.directory.close()
      await expect(
        recoverPrivateMacosGuardian(owner, token, 5000, {
          bun: unavailable === 'runtime' ? join(root, 'missing-bun') : process.execPath,
          supervisor,
        }),
      ).rejects.toBeInstanceOf(Error)
      expect(await exists(join(storage, 'volume.json'))).toBe(true)
      expect(await exists(mount)).toBe(true)
      expect(await exists(join(storage, 'volume.dmg'))).toBe(true)
    } finally {
      // An ordinary new guardian must prove recovery before journals can retire.
      await recoverPrivateMacosGuardian(owner, token, 5000)
      await releasePrivateMacosGuardian(owner, token)
      await rm(root, { recursive: true })
    }
  }, 45_000)
}
test('native volume allocation collision preserves the original authenticated journal', async () => {
  const root = await mkdtemp('/private/tmp/jig-storage-publication-collision-')
  const owner = join(root, 'owner')
  const mount = join(root, 'data')
  const token = randomBytes(32).toString('hex')
  await mkdir(owner, { mode: 0o700 })
  await mkdir(mount, { mode: 0o700 })
  let released = false
  try {
    await allocatePrivateMacosGuardianStorage(owner, token, {
      mountPath: mount,
      bytes: 16 * 1024 * 1024,
      collect: null,
    })
    const journal = await readFile(join(owner, 'storage/volume.json'))
    await expect(
      allocatePrivateMacosVolume(join(owner, 'storage'), token, mount, 16 * 1024 * 1024),
    ).rejects.toThrow('macOS volume control allocation is not empty')
    expect(await readFile(join(owner, 'storage/volume.json'))).toEqual(journal)
    expect(await readdir(mount)).toEqual([])
    expect(await exists(join(owner, 'storage/volume.dmg'))).toBe(false)
    await recoverPrivateMacosGuardian(owner, token, 5000)
    await releasePrivateMacosGuardian(owner, token)
    expect(await exists(owner)).toBe(false)
    released = true
  } finally {
    if (released) await rm(root, { recursive: true })
    else console.error('Volume collision evidence retained at', root)
  }
}, 45_000)

test('actual missing launcher retains a closed preparation cause after fenced storage cleanup', async () => {
  const build = await mkdtemp('/private/tmp/jig-preparation-failure-')
  {
    const root = await mkdtemp('/private/tmp/jig-preparation-owner-')
    const ownerDirectory = join(root, 'owner'),
      mountPath = join(root, 'data')
    const token = randomBytes(32).toString('hex')
    await mkdir(ownerDirectory, { mode: 0o700 })
    await mkdir(mountPath, { mode: 0o700 })
    await writeFile(
      join(root, 'fixture.json'),
      JSON.stringify({ ownerDirectory, ownerToken: token }),
      { mode: 0o600, flag: 'wx' },
    )
    const supervisor = fileURLToPath(
      new URL('../src/internal/macos-native-supervisor.ts', suiteTestUrl),
    )
    const input: Parameters<typeof preparePrivateMacosGuardian>[0] = {
      bun: process.execPath,
      supervisor,
      configuration: {
        type: 'start',
        ownerDirectory,
        ownerToken: token,
        launcher: join(build, 'missing-private-canary-launcher'),
        cwd: join(mountPath, 'work'),
        command: ['/usr/bin/true'],
        environment: {},
        files: {
          readOnlyFiles: ['/usr/bin/true'],
          readOnlyTrees: [],
          writableTrees: ['work', 'tmp', 'output'].map((name) => join(mountPath, name)),
          protectedRoots: [ownerDirectory],
          network: 'isolated',
        },
        limits: {
          memoryBytes: 32 * 1024 * 1024,
          pids: 4,
          cpuQuotaMicros: 50_000,
          cpuPeriodMicros: 100_000,
          deadlineUnixMs: Date.now() + 30_000,
          cleanupTimeoutMs: 5000,
        },
        maxOutputBytes: 4096,
        storage: { mountPath, bytes: 16 * 1024 * 1024, collect: null },
      },
    }
    const recoveryEvents: PrivateMacosGuardianRecoveryDiagnostic[] = []
    const guardian = await withPrivateMacosGuardianDiagnostics(
      (event) => {
        if (recoveryEvents.length < 16) recoveryEvents.push(event)
      },
      () => preparePrivateMacosGuardian(input),
    )
    guardian.stdout.resume()
    guardian.stderr.resume()
    let completionDiagnostic: object = { state: 'pending' }
    try {
      const failure = await guardian.admit().catch((error) => error)
      // Observe real settlement before an assertion can hide its cleanup outcome.
      const completion = await guardian.completion.then(
        (result) => {
          completionDiagnostic = {
            state: 'fulfilled',
            fenced: result.fenced,
            recovered: result.recovered,
            outputLost: result.outputLost,
            result: result.result === null ? 'absent' : 'present',
          }
          return result
        },
        (error: unknown) => {
          completionDiagnostic = { state: 'rejected' }
          throw error
        },
      )
      expect(failure).toBeInstanceOf(Error)
      expect(failure.code).toBe('MACOS_GUARDIAN_SCOPE_PREPARATION_FILESYSTEM_MISSING')
      expect(failure.message).not.toContain('private-canary')
      expect(completion).toMatchObject({
        fenced: true,
        result: null,
        recovered: false,
      })
      expect(await exists(mountPath)).toBe(false)
      expect(await exists(join(ownerDirectory, 'storage/volume.dmg'))).toBe(false)
    } catch (error) {
      console.error('Missing launcher guardian evidence', {
        recoveryEvents,
        completion: completionDiagnostic,
      })
      throw error
    } finally {
      await recoverPrivateMacosGuardian(ownerDirectory, token, 5000)
      await releasePrivateMacosGuardian(ownerDirectory, token)
      await rm(root, { recursive: true })
    }
  }
  await rm(build, { recursive: true })
}, 45_000)
test('actual guardian loss after native storage attachment retains recoverable storage', async () => {
  const root = await mkdtemp('/private/tmp/jig-image-journal-loss-')
  const ownerDirectory = join(root, 'owner'),
    mountPath = join(root, 'data')
  const token = randomBytes(32).toString('hex')
  await mkdir(ownerDirectory, { mode: 0o700 })
  await mkdir(mountPath, { mode: 0o700 })
  await writeFile(
    join(root, 'fixture.json'),
    JSON.stringify({ ownerDirectory, ownerToken: token }),
    { mode: 0o600, flag: 'wx' },
  )
  const supervisor = fileURLToPath(
    new URL('../src/internal/macos-native-supervisor.ts', suiteTestUrl),
  )
  const launcher = join(root, 'macos-exec')
  const compiled = spawnSync(
    '/usr/bin/clang',
    [
      '-O2',
      '-Wno-deprecated-declarations',
      fileURLToPath(new URL('../support/macos-exec.c', suiteTestUrl)),
      '-o',
      launcher,
    ],
    { encoding: 'utf8', timeout: 15_000 },
  )
  expect({ status: compiled.status, stderr: compiled.stderr }).toEqual({ status: 0, stderr: '' })
  let recovered = false
  const guardian = await preparePrivateMacosGuardian({
    bun: process.execPath,
    supervisor,
    configuration: {
      type: 'start',
      ownerDirectory,
      ownerToken: token,
      launcher,
      cwd: join(mountPath, 'work'),
      command: ['/usr/bin/true'],
      environment: {},
      files: {
        readOnlyFiles: ['/usr/bin/true'],
        readOnlyTrees: [],
        writableTrees: ['work', 'tmp', 'output'].map((name) => join(mountPath, name)),
        protectedRoots: [ownerDirectory],
        network: 'isolated',
      },
      limits: {
        memoryBytes: 32 * 1024 * 1024,
        pids: 4,
        cpuQuotaMicros: 50_000,
        cpuPeriodMicros: 100_000,
        deadlineUnixMs: Date.now() + 30_000,
        cleanupTimeoutMs: 5000,
      },
      maxOutputBytes: 4096,
      storage: { mountPath, bytes: 16 * 1024 * 1024, collect: 'output' },
    },
  })
  guardian.stdout.resume()
  guardian.stderr.resume()
  const ready = guardian.admit()
  void ready.catch(() => undefined)
  try {
    await ready
    expect(await exists(join(ownerDirectory, 'storage/volume-image.json'))).toBe(true)
    killGuardian(guardian.identity)
    expect(await guardian.completion).toMatchObject({
      fenced: true,
      recovered: true,
      result: null,
    })
    await recoverPrivateMacosGuardian(ownerDirectory, token, 5000)
    recovered = true
    expect(await exists(mountPath)).toBe(false)
    expect(await exists(join(ownerDirectory, 'storage/volume.dmg'))).toBe(false)
    await releasePrivateMacosGuardian(ownerDirectory, token)
    expect(await exists(ownerDirectory)).toBe(false)
  } finally {
    if (recovered) await rm(root, { recursive: true })
  }
}, 45_000)
for (const mode of [
  'complete',
  'cancel-prepared',
  'cancel-preparing',
  'guardian-loss-preparing',
  'collection-timeout',
  'cancel-collecting',
  'guardian-loss-running',
  'guardian-loss-collecting',
  'coordinator-loss-running',
  'coordinator-loss-collecting',
] as const) {
  test(`guardian storage ${mode}: retains bounded output only through collection and recovers exact storage after failures`, async () => {
    const build = await mkdtemp('/private/tmp/jig-storage-build-')
    const launcher = join(build, 'macos-exec'),
      payload = join(build, 'payload')
    try {
      for (const [source, output] of [
        [new URL('../support/macos-exec.c', suiteTestUrl), launcher],
        [new URL('./fixtures/macos-storage-payload.c', suiteTestUrl), payload],
      ] as const) {
        const result = spawnSync(
          '/usr/bin/clang',
          [
            '-O2',
            '-Wall',
            '-Wextra',
            '-Werror',
            '-Wno-deprecated-declarations',
            fileURLToPath(source),
            '-o',
            output,
          ],
          { encoding: 'utf8', timeout: 15_000 },
        )
        expect({ status: result.status, errors: result.stderr }).toEqual({
          status: 0,
          errors: '',
        })
      }
      const root = await mkdtemp('/private/tmp/jig-storage-owner-')
      const ownerDirectory = join(root, 'owner'),
        mountPath = join(root, 'data')
      await mkdir(ownerDirectory, { mode: 0o700 })
      await mkdir(mountPath, { mode: 0o700 })
      const token = randomBytes(32).toString('hex')
      const marker = join(mountPath, 'output/result.txt')
      const input: { bun: string; supervisor: string; configuration: PrivateMacosGuardianStart } = {
        bun: process.execPath,
        supervisor: fileURLToPath(
          new URL('../src/internal/macos-native-supervisor.ts', suiteTestUrl),
        ),
        configuration: {
          type: 'start',
          ownerDirectory,
          ownerToken: token,
          launcher,
          cwd: join(mountPath, 'work'),
          command: [
            payload,
            mode.endsWith('running') ? 'waiting' : 'complete',
            marker,
            join(ownerDirectory, 'storage/volume.dmg'),
          ],
          environment: {},
          files: {
            readOnlyFiles: [payload],
            readOnlyTrees: [],
            writableTrees: ['work', 'tmp', 'output'].map((name) => join(mountPath, name)),
            protectedRoots: [ownerDirectory],
            network: 'isolated',
          },
          limits: {
            memoryBytes: 32 * 1024 * 1024,
            pids: 4,
            cpuQuotaMicros: 50_000,
            cpuPeriodMicros: 100_000,
            deadlineUnixMs: Date.now() + 45_000,
            cleanupTimeoutMs: 5000,
          },
          maxOutputBytes: 4096,
          storage: { mountPath, bytes: 16 * 1024 * 1024, collect: 'output' },
        },
      }
      let owner: Awaited<ReturnType<typeof preparePrivateMacosGuardian>> | undefined
      let settled = false
      try {
        if (mode.startsWith('coordinator-loss')) {
          const path = join(root, 'fixture.json')
          await writeFile(
            path,
            JSON.stringify({
              ...input,
              fixturePhase: mode.endsWith('collecting') ? 'collecting' : 'running',
            }),
            { mode: 0o600, flag: 'wx' },
          )
          const child = spawnSync(
            process.execPath,
            [
              '--no-env-file',
              '--no-install',
              '--config=/dev/null',
              fileURLToPath(new URL('./fixtures/macos-lost-coordinator.ts', suiteTestUrl)),
              path,
            ],
            { env: {}, encoding: 'utf8', timeout: 20_000 },
          )
          expect({ status: child.status, out: child.stdout, err: child.stderr }).toEqual({
            status: 0,
            out: 'coordinator-exiting\n',
            err: '',
          })
          await recoverPrivateMacosGuardian(ownerDirectory, token, 5000)
          settled = true
        } else {
          owner = await preparePrivateMacosGuardian(input)
          owner.stdout.resume()
          owner.stderr.resume()
          expect(await exists(join(ownerDirectory, 'storage/volume.json'))).toBe(true)
          expect(await exists(join(ownerDirectory, 'storage/volume.dmg'))).toBe(false)
          expect(await exists(marker)).toBe(false)
          if (mode === 'cancel-prepared') owner.cancel()
          else if (mode.endsWith('preparing')) {
            const readiness = owner.admit()
            void readiness.catch(() => undefined)
            const end = performance.now() + 5000
            while (
              !(await exists(join(ownerDirectory, 'storage/volume.dmg'))) &&
              performance.now() < end
            )
              await Bun.sleep(5)
            expect(await exists(join(ownerDirectory, 'storage/volume.dmg'))).toBe(true)
            if (mode === 'cancel-preparing') owner.cancel()
            else killGuardian(owner.identity)
            await expect(readiness).rejects.toThrow()
          } else {
            await owner.admit()
            expect(await exists(marker)).toBe(false)
            owner.continue()
            if (mode === 'guardian-loss-running') {
              const end = performance.now() + 5000
              while (!(await exists(marker)) && performance.now() < end) await Bun.sleep(10)
              expect(await exists(marker)).toBe(true)
              killGuardian(owner.identity)
            } else {
              const fenced = await owner.fenced
              expect(fenced.result?.exitCode).toBe(0)
              expect(fenced.outputFd).toBeDefined()
              const fd = fenced.outputFd!
              const outputIdentity = fstatSync(fd)
              expect(privateMacosFilesystem(fd).capacityBytes).toBeLessThanOrEqual(
                16n * 1024n * 1024n,
              )
              expect(privateReadRegularFile(fd, 'result.txt', 32).toString()).toBe(
                'captured-output',
              )
              let complete = false
              void owner.completion.then(() => {
                complete = true
              })
              await Bun.sleep(30)
              expect(complete).toBe(false)
              expect(await exists(join(ownerDirectory, 'storage/volume.dmg'))).toBe(true)
              if (mode === 'guardian-loss-collecting') killGuardian(owner.identity)
              else if (mode === 'cancel-collecting') owner.cancel()
              else if (mode !== 'collection-timeout') owner.release()
              // Ownership of the borrowed descriptor ends at release or recovery.
              const result = await owner.completion
              settled = result.fenced
              expect(result.recovered).toBe(mode === 'guardian-loss-collecting')
              if (['collection-timeout', 'cancel-collecting'].includes(mode))
                expect(result.outputLost).toBe(true)
              // Another socket may reuse the integer after the collector closes it.
              let current: ReturnType<typeof fstatSync> | undefined
              try {
                current = fstatSync(fd)
              } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== 'EBADF') throw error
              }
              if (current !== undefined)
                expect([current.dev, current.ino]).not.toEqual([
                  outputIdentity.dev,
                  outputIdentity.ino,
                ])
            }
          }
          const result = await owner.completion
          settled = result.fenced
          expect(result.recovered).toBe(mode.startsWith('guardian-loss'))
        }
        expect(await exists(mountPath)).toBe(false)
        expect(await exists(join(ownerDirectory, 'storage/volume.dmg'))).toBe(false)
        settled = false
        await recoverPrivateMacosGuardian(ownerDirectory, token, 5000)
        if (mode === 'complete') {
          // Kill only this allocation's new authenticated cleanup guardian.
          // The next attempt must fence it before replacing its journals.
          const directory = join(ownerDirectory, 'recovery')
          const recoveryToken = privateMacosStorageRecoveryToken(token)
          const previous = readPrivateMacosOwner(directory, recoveryToken).identity
          const recovering = recoverPrivateMacosGuardian(ownerDirectory, token, 5000)
          void recovering.catch(() => undefined)
          let identity: typeof previous | undefined
          const end = performance.now() + 5000
          while (performance.now() < end) {
            try {
              const current = readPrivateMacosOwner(directory, recoveryToken).identity
              if (current.guardianVersion !== previous.guardianVersion) {
                identity = current
                break
              }
            } catch {
              /* The old bounded journal is being replaced before tool admission. */
            }
            await Bun.sleep(5)
          }
          expect(identity).toBeDefined()
          killGuardian(identity!)
          await expect(recovering).rejects.toThrow()
          await recoverPrivateMacosGuardian(ownerDirectory, token, 5000)
          expect(readPrivateMacosOwner(directory, recoveryToken).identity.guardianVersion).not.toBe(
            identity!.guardianVersion,
          )
        }
        settled = true
        expect(
          JSON.parse(await readFile(join(ownerDirectory, 'storage/volume.json'), 'utf8')).mac,
        ).toHaveLength(64)
        await releasePrivateMacosGuardian(ownerDirectory, token)
        expect(await exists(ownerDirectory)).toBe(false)
      } finally {
        if (!settled && owner !== undefined) {
          owner.cancel()
          await owner.completion
          await recoverPrivateMacosGuardian(ownerDirectory, token, 5000)
          settled = true
        }
        if (settled) await rm(root, { recursive: true })
        else console.error(`Mac storage evidence retained at ${root}`)
      }
    } finally {
      await rm(build, { recursive: true })
    }
  }, 150_000)
}

if (process.platform !== 'darwin') throw Error('This suite requires a native Mac')
