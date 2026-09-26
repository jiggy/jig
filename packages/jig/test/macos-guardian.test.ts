import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { access, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  preparePrivateMacosGuardian,
  recoverPrivateMacosGuardian,
} from '../src/internal/macos-guardian-client.js'
import type { PrivateMacosGuardianStart } from '../src/internal/macos-native-supervisor.js'

const native = test.skipIf(
  process.platform !== 'darwin' || process.env.JIG_MACOS_PROCESS_TEST !== '1',
)

native(
  'guardian admits native execution through authenticated separate control and payload streams',
  async () => {
    const build = await realpath(await mkdtemp('/private/tmp/jig-guardian-build-'))
    const launcher = join(build, 'macos-exec'),
      payload = join(build, 'payload')
    try {
      for (const [source, output] of [
        [new URL('../support/macos-exec.c', import.meta.url), launcher],
        [new URL('./fixtures/macos-scope-payload.c', import.meta.url), payload],
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
        'cancel-ready',
        'cancel-running',
        'blocked-output',
        'output-limit',
        'guardian-loss',
        'coordinator-loss',
      ]) {
        const ownerDirectory = await realpath(await mkdtemp('/private/tmp/jig-guardian-state-'))
        const scratch = await realpath(await mkdtemp('/private/tmp/jig-guardian-data-'))
        let settled = false
        let owner: Awaited<ReturnType<typeof preparePrivateMacosGuardian>> | undefined
        try {
          const marker = join(scratch, 'started')
          const input: {
            bun: string
            supervisor: string
            configuration: PrivateMacosGuardianStart
          } = {
            bun: process.execPath,
            supervisor: fileURLToPath(
              new URL('../src/internal/macos-native-supervisor.ts', import.meta.url),
            ),
            configuration: {
              type: 'start',
              ownerDirectory,
              ownerToken: randomBytes(32).toString('hex'),
              launcher,
              cwd: scratch,
              command: [
                payload,
                mode === 'complete' ? 'echo' : mode.includes('output') ? 'flood' : 'waiting',
                marker,
              ],
              environment: {},
              files: {
                readOnlyFiles: [payload],
                readOnlyTrees: [],
                writableTrees: [scratch],
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
              maxOutputBytes: mode === 'output-limit' ? 4096 : 8 * 1024 * 1024,
            },
          }
          if (mode === 'coordinator-loss') {
            const path = join(ownerDirectory, 'fixture.json')
            await writeFile(path, JSON.stringify(input), { mode: 0o600, flag: 'wx' })
            const child = spawnSync(
              process.execPath,
              [
                '--no-env-file',
                '--no-install',
                '--config=/dev/null',
                fileURLToPath(new URL('./fixtures/macos-lost-coordinator.ts', import.meta.url)),
                path,
              ],
              { env: {}, encoding: 'utf8', timeout: 15_000 },
            )
            expect({ status: child.status, out: child.stdout, err: child.stderr }).toEqual({
              status: 0,
              out: 'coordinator-exiting\n',
              err: '',
            })
            await recoverPrivateMacosGuardian(ownerDirectory, input.configuration.ownerToken, 5000)
            await recoverPrivateMacosGuardian(ownerDirectory, input.configuration.ownerToken, 5000)
            settled = true
            continue
          }
          owner = await preparePrivateMacosGuardian(input)
          let output = '',
            errors = ''
          if (mode !== 'blocked-output')
            owner.stdout.on('data', (bytes) => {
              output += bytes.toString()
            })
          owner.stderr.on('data', (bytes) => {
            errors += bytes.toString()
          })
          if (mode !== 'blocked-output') owner.stdout.resume()
          owner.stderr.resume()
          expect(
            await access(marker).then(
              () => true,
              () => false,
            ),
          ).toBe(false)
          if (mode === 'cancel-prepared') owner.cancel()
          else {
            const ready = await owner.admit()
            expect(ready.pid).toBeGreaterThan(1)
            expect(
              await access(marker).then(
                () => true,
                () => false,
              ),
            ).toBe(false)
            if (mode === 'cancel-ready') owner.cancel()
            else {
              owner.continue()
              if (mode === 'complete') owner.stdin.end('native-roundtrip\n')
              if (['cancel-running', 'blocked-output', 'guardian-loss'].includes(mode)) {
                const end = performance.now() + 5000
                while (
                  !(await access(marker).then(
                    () => true,
                    () => false,
                  )) &&
                  performance.now() < end
                )
                  await Bun.sleep(10)
                await access(marker)
                if (mode === 'guardian-loss') {
                  const ffi = createRequire(import.meta.url)('bun:ffi')
                  const native = ffi.dlopen('/usr/lib/libSystem.B.dylib', {
                    proc_signal_with_audittoken: { args: ['ptr', 'i32'], returns: 'i32' },
                  })
                  const token = Buffer.alloc(32)
                  token.writeUInt32LE(owner.identity.guardianPid, 20)
                  token.writeUInt32LE(owner.identity.guardianVersion, 28)
                  expect(native.symbols.proc_signal_with_audittoken(ffi.ptr(token), 9)).toBe(0)
                  native.close()
                } else {
                  if (mode === 'blocked-output') await Bun.sleep(100)
                  owner.cancel()
                }
              }
            }
          }
          const result = await owner.completion
          settled = result.fenced
          expect(result.recovered).toBe(mode === 'guardian-loss')
          if (mode === 'complete') {
            expect(result.result?.exitCode).toBe(0)
            expect(result.result?.reason).toBe('payload_exit')
            expect(result.outputLost).toBe(false)
            expect(output).toBe('native-roundtrip\n')
            expect(errors).toBe('native-stderr\n')
          } else if (mode === 'cancel-prepared' || mode === 'guardian-loss')
            expect(result.result).toBeNull()
          else expect(result.result?.reason).toBe('cancelled')
          if (['blocked-output', 'output-limit', 'guardian-loss'].includes(mode))
            expect(result.outputLost).toBe(true)
          if (mode === 'output-limit') expect(Buffer.byteLength(output)).toBeLessThanOrEqual(4096)
          owner.stdout.destroy()
          owner.stderr.destroy()
        } finally {
          if (!settled && owner !== undefined) {
            owner.cancel()
            settled = (await owner.completion).fenced
          }
          if (settled) {
            await rm(ownerDirectory, { recursive: true })
            await rm(scratch, { recursive: true })
          } else console.error(`Mac guardian evidence retained at ${ownerDirectory} and ${scratch}`)
        }
      }
    } finally {
      await rm(build, { recursive: true })
    }
  },
  90_000,
)
