import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { fstatSync } from 'node:fs'
import { access, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { privateReadRegularFile } from '../src/internal/file-input.js'
import { privateMacosFilesystem } from '../src/internal/macos-descriptor-files.js'
import {
  preparePrivateMacosGuardian,
  recoverPrivateMacosGuardian,
  releasePrivateMacosGuardian,
} from '../src/internal/macos-guardian-client.js'
import type { PrivateMacosGuardianStart } from '../src/internal/macos-native-supervisor.js'
import {
  privateMacosStorageRecoveryToken,
  readPrivateMacosOwner,
} from '../src/internal/macos-owner-state.js'
import { createPrivateMacosVolume } from '../src/internal/macos-volume.js'

const native = test.skipIf(
  process.platform !== 'darwin' || process.env.JIG_MACOS_PROCESS_TEST !== '1',
)
const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  )
function killGuardian(identity: { guardianPid: number; guardianVersion: number }) {
  const ffi = createRequire(import.meta.url)('bun:ffi')
  const api = ffi.dlopen('/usr/lib/libSystem.B.dylib', {
    proc_signal_with_audittoken: { args: ['ptr', 'i32'], returns: 'i32' },
  })
  try {
    const token = Buffer.alloc(32)
    token.writeUInt32LE(identity.guardianPid, 20)
    token.writeUInt32LE(identity.guardianVersion, 28)
    expect(api.symbols.proc_signal_with_audittoken(ffi.ptr(token), 9)).toBe(0)
  } finally {
    api.close()
  }
}

const preparationFailures = [
  [
    'storage',
    '      const storage = await preparePrivateMacosGuardianStorage(',
    "new Error('macOS volume create failed', { cause: new Error('private-canary') })",
    'MACOS_GUARDIAN_STORAGE_VOLUME_CREATE',
  ],
  [
    'scope',
    '    execution = await preparePrivateMacosScope({',
    "new Error('private-canary /private/owner/path')",
    'MACOS_GUARDIAN_SCOPE_PREPARATION_OTHER',
  ],
] as const

async function journalLossSupervisor(root: string): Promise<string> {
  const directory = fileURLToPath(new URL('../src/internal/', import.meta.url))
  const volume = join(root, 'volume.ts'),
    storage = join(root, 'storage.ts')
  const supervisor = join(root, 'supervisor.ts')
  const volumeSource = await readFile(join(directory, 'macos-volume.ts'), 'utf8')
  const write = '    await file.writeFile(`${JSON.stringify({ value, mac })}\\n`)'
  expect(volumeSource.split(write)).toHaveLength(2)
  await writeFile(
    volume,
    volumeSource
      .replace(
        write,
        `    if (signatureName === 'volume-image.json') await new Promise<void>(() => {})\n${write}`,
      )
      .replaceAll("from './", `from '${directory}`),
  )
  const storageSource = await readFile(join(directory, 'macos-guardian-storage.ts'), 'utf8')
  expect(storageSource.split("from './macos-volume.js'")).toHaveLength(2)
  await writeFile(
    storage,
    storageSource
      .replace("from './macos-volume.js'", `from '${volume}'`)
      .replaceAll("from './", `from '${directory}`),
  )
  const supervisorSource = await readFile(join(directory, 'macos-native-supervisor.ts'), 'utf8')
  expect(supervisorSource.split("from './macos-guardian-storage.js'")).toHaveLength(2)
  await writeFile(
    supervisor,
    supervisorSource
      .replace("from './macos-guardian-storage.js'", `from '${storage}'`)
      .replaceAll("from './", `from '${directory}`),
  )
  return supervisor
}

async function preparationFailureSupervisor(
  root: string,
  [step, marker, failure]: (typeof preparationFailures)[number],
): Promise<string> {
  const sourceUrl = new URL('../src/internal/macos-native-supervisor.ts', import.meta.url)
  const source = await readFile(sourceUrl, 'utf8')
  expect(source.split(marker)).toHaveLength(2)
  const supervisor = join(root, `failure-${step}.ts`)
  await writeFile(
    supervisor,
    source
      .replace(marker, `throw ${failure}\n${marker}`)
      .replaceAll("from './", `from '${fileURLToPath(new URL('.', sourceUrl))}`),
  )
  return supervisor
}

test('constructs interrupted-journal and preparation-failure guardians without native execution', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'jig-guardian-fixtures-')))
  try {
    const supervisors = [await journalLossSupervisor(root)]
    for (const fixture of preparationFailures)
      supervisors.push(await preparationFailureSupervisor(root, fixture))
    for (const supervisor of supervisors) {
      const built = await Bun.build({ entrypoints: [supervisor], target: 'bun' })
      expect(built.success, String(built.logs)).toBe(true)
    }
  } finally {
    await rm(root, { recursive: true })
  }
})

native(
  'recovery expiry during final drain refuses success and preserves retry evidence',
  async () => {
    const root = await mkdtemp('/private/tmp/jig-recovery-drain-')
    const owner = join(root, 'owner')
    const storage = join(owner, 'storage')
    const mount = join(root, 'data')
    const token = randomBytes(32).toString('hex')
    const supervisor = join(root, 'expiring-supervisor.ts')
    const sourceUrl = new URL('../src/internal/macos-native-supervisor.ts', import.meta.url)
    const source = await readFile(sourceUrl, 'utf8')
    const drain = '      const fencedBy = performance.now() + 5000\n      while (!owner.empty()) {'
    expect(source.split(drain)).toHaveLength(2)
    // Force the operation timer to expire inside a delayed final drain, after real
    // storage cleanup. Keep the actual guardian, timer callback and receipt path.
    await writeFile(
      supervisor,
      source.replaceAll("from './", `from '${fileURLToPath(new URL('.', sourceUrl))}`).replace(
        drain,
        `      clearTimeout(timer)
      timer = setTimeout(() => stop('cancelled'), 1)
      const drainUntil = performance.now() + 50
      const fencedBy = performance.now() + 5000
      while (!owner.empty() || performance.now() < drainUntil) {`,
      ),
    )
    await mkdir(storage, { recursive: true, mode: 0o700 })
    await mkdir(mount, { mode: 0o700 })
    try {
      const volume = await createPrivateMacosVolume(storage, token, mount, 16 * 1024 * 1024)
      await volume.directory.close()
      await expect(
        recoverPrivateMacosGuardian(owner, token, 5000, {
          bun: process.execPath,
          supervisor,
        }),
      ).rejects.toMatchObject({
        message: 'macOS storage recovery is unconfirmed',
        cause: { code: 'MACOS_GUARDIAN_STORAGE_RECOVERY_OTHER' },
      })
      expect(await exists(join(storage, 'volume.json'))).toBe(true)
      expect(await exists(join(owner, 'recovery/owner.json'))).toBe(true)
      expect(await exists(mount)).toBe(false)
      expect(await exists(join(storage, 'volume.dmg'))).toBe(false)
    } finally {
      // An ordinary new guardian must prove recovery before journals can retire.
      await recoverPrivateMacosGuardian(owner, token, 5000)
      await releasePrivateMacosGuardian(owner, token)
      await rm(root, { recursive: true })
    }
  },
  45_000,
)

native(
  'guardian preparation failures retain a closed step and cause after fenced cleanup',
  async () => {
    const build = await mkdtemp('/private/tmp/jig-preparation-failure-')
    const launcher = join(build, 'macos-exec')
    const compiled = spawnSync(
      '/usr/bin/clang',
      [
        '-O2',
        '-Wno-deprecated-declarations',
        fileURLToPath(new URL('../support/macos-exec.c', import.meta.url)),
        '-o',
        launcher,
      ],
      { encoding: 'utf8', timeout: 15_000 },
    )
    expect({ status: compiled.status, stderr: compiled.stderr }).toEqual({ status: 0, stderr: '' })
    for (const fixture of preparationFailures) {
      const [, , , code] = fixture
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
      const supervisor = await preparationFailureSupervisor(build, fixture)
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
          storage: { mountPath, bytes: 16 * 1024 * 1024, collect: null },
        },
      })
      guardian.stdout.resume()
      guardian.stderr.resume()
      try {
        const failure = await guardian.admit().catch((error) => error)
        expect(failure).toMatchObject({ code })
        expect(failure.message).not.toContain('private-canary')
        expect(await guardian.completion).toMatchObject({
          fenced: true,
          result: null,
          recovered: false,
        })
        expect(await exists(mountPath)).toBe(false)
        expect(await exists(join(ownerDirectory, 'storage/volume.dmg'))).toBe(false)
      } finally {
        await recoverPrivateMacosGuardian(ownerDirectory, token, 5000)
        await releasePrivateMacosGuardian(ownerDirectory, token)
        await rm(root, { recursive: true })
      }
    }
    await rm(build, { recursive: true })
  },
  45_000,
)

native(
  'guardian loss during backing journal publication retains recoverable storage',
  async () => {
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
    const supervisor = await journalLossSupervisor(root)
    const launcher = join(root, 'macos-exec')
    const compiled = spawnSync(
      '/usr/bin/clang',
      [
        '-O2',
        '-Wno-deprecated-declarations',
        fileURLToPath(new URL('../support/macos-exec.c', import.meta.url)),
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
      const end = performance.now() + 10_000
      while (
        !(await exists(join(ownerDirectory, 'storage/volume-image.json'))) &&
        !(await exists(join(ownerDirectory, 'storage/volume-image.pending'))) &&
        performance.now() < end
      )
        await Bun.sleep(5)
      expect(
        (await exists(join(ownerDirectory, 'storage/volume-image.json'))) ||
          (await exists(join(ownerDirectory, 'storage/volume-image.pending'))),
      ).toBe(true)
      killGuardian(guardian.identity)
      await expect(ready).rejects.toThrow()
      expect((await guardian.completion).fenced).toBe(true)
      await recoverPrivateMacosGuardian(ownerDirectory, token, 5000)
      recovered = true
      expect(await exists(mountPath)).toBe(false)
      expect(await exists(join(ownerDirectory, 'storage/volume.dmg'))).toBe(false)
      await releasePrivateMacosGuardian(ownerDirectory, token)
      expect(await exists(ownerDirectory)).toBe(false)
    } finally {
      if (recovered) await rm(root, { recursive: true })
    }
  },
  45_000,
)

native(
  'guardian retains bounded output only through collection and recovers exact storage after failures',
  async () => {
    const build = await mkdtemp('/private/tmp/jig-storage-build-')
    const launcher = join(build, 'macos-exec'),
      payload = join(build, 'payload')
    try {
      for (const [source, output] of [
        [new URL('../support/macos-exec.c', import.meta.url), launcher],
        [new URL('./fixtures/macos-storage-payload.c', import.meta.url), payload],
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
        expect({ status: result.status, errors: result.stderr }).toEqual({ status: 0, errors: '' })
      }
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
      ]) {
        const root = await mkdtemp('/private/tmp/jig-storage-owner-')
        const ownerDirectory = join(root, 'owner'),
          mountPath = join(root, 'data')
        await mkdir(ownerDirectory, { mode: 0o700 })
        await mkdir(mountPath, { mode: 0o700 })
        const token = randomBytes(32).toString('hex')
        const marker = join(mountPath, 'output/result.txt')
        const input: { bun: string; supervisor: string; configuration: PrivateMacosGuardianStart } =
          {
            bun: process.execPath,
            supervisor: fileURLToPath(
              new URL('../src/internal/macos-native-supervisor.ts', import.meta.url),
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
                fileURLToPath(new URL('./fixtures/macos-lost-coordinator.ts', import.meta.url)),
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
            expect(
              readPrivateMacosOwner(directory, recoveryToken).identity.guardianVersion,
            ).not.toBe(identity!.guardianVersion)
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
      }
    } finally {
      await rm(build, { recursive: true })
    }
  },
  150_000,
)
