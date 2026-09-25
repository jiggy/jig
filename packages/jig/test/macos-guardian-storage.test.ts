import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { fstatSync } from 'node:fs'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
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
                expect(() => fstatSync(fd)).toThrow()
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
