import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  capturePrivateOutput,
  type PrivateCapturedOutput,
  readPrivateCapturedOutput,
} from '../src/internal/captured-output.js'
import { privateReadRegularFile, sha256 } from '../src/internal/file-input.js'
import { capturePrivateInput } from '../src/internal/input-capture.js'
import {
  preparePrivateMacosGuardian,
  recoverPrivateMacosGuardian,
} from '../src/internal/macos-guardian-client.js'
import { normalizePrivateMacosInputs } from '../src/internal/macos-input-projection.js'
import type { PrivateMacosGuardianStart } from '../src/internal/macos-native-supervisor.js'

test('native input manifest rejects aliases, file/directory conflicts and aggregate excess', () => {
  const file = { path: 'a', bytes: 1, digest: sha256(Buffer.from('x')) }
  expect(normalizePrivateMacosInputs([file])).toEqual([file])
  for (const value of [
    null,
    [file, file],
    [file, { ...file, path: 'a/b' }],
    [{ ...file, path: '../outside' }],
    [{ ...file, path: '.jig/private' }],
    [{ ...file, bytes: 8 * 1024 * 1024 + 1 }],
    [{ ...file, bytes: -1 }],
    [{ ...file, digest: 'untrusted' }],
    [{ ...file, extra: true }],
    Array.from({ length: 65 }, (_, i) => ({ ...file, path: `f${i}` })),
    Array.from({ length: 64 }, (_, i) => ({ ...file, path: `d${i}/one/two/three/four/file` })),
  ])
    expect(() => normalizePrivateMacosInputs(value)).toThrow()
})

const native = test.skipIf(
  process.platform !== 'darwin' || process.env.JIG_MACOS_PROCESS_TEST !== '1',
)
const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  )
native(
  'native guardian projects authenticated immutable inputs before ordinary TypeScript execution',
  async () => {
    const build = await mkdtemp('/private/tmp/jig-input-build-')
    const launcher = join(build, 'macos-exec')
    let retained = false
    try {
      const compiled = spawnSync(
        '/usr/bin/clang',
        [
          '-O2',
          '-Wall',
          '-Wextra',
          '-Werror',
          '-Wno-deprecated-declarations',
          fileURLToPath(new URL('../support/macos-exec.c', import.meta.url)),
          '-o',
          launcher,
        ],
        { encoding: 'utf8', timeout: 15_000 },
      )
      expect({ status: compiled.status, error: compiled.stderr }).toEqual({ status: 0, error: '' })
      for (const mode of [
        'complete',
        'guardian-loss',
        'closed-before-admission',
        'manifest-mismatch',
      ]) {
        const root = await mkdtemp('/private/tmp/jig-input-owner-')
        const ownerDirectory = join(root, 'owner'),
          mountPath = join(root, 'data')
        await mkdir(ownerDirectory, { mode: 0o700 })
        await mkdir(mountPath, { mode: 0o700 })
        const canary = join(ownerDirectory, 'canary')
        await writeFile(canary, 'synthetic private data', { mode: 0o600, flag: 'wx' })
        const source = `import { answer } from './lib/value.ts'
import { readFile, writeFile } from 'node:fs/promises'
let writable = false, privateVisible = false
try { await writeFile(import.meta.filename, 'changed'); writable = true } catch {}
try { await readFile(process.argv[3]); privateVisible = true } catch {}
const bytes = [...await readFile(new URL('./bytes', import.meta.url))]
const empty = (await readFile(new URL('./empty', import.meta.url))).length
await writeFile(process.argv[2], JSON.stringify({answer,writable,privateVisible,bytes,empty}))
console.log('native-input-complete')
`
        const capturedInputs = [
          ['source/main.ts', Buffer.from(source)],
          ['source/lib/value.ts', Buffer.from('export const answer = 42\n')],
          ['source/bytes', Buffer.from([0, 255, 128])],
          ['source/empty', Buffer.alloc(0)],
        ].map(([path, bytes]) => ({
          path: path as string,
          input: capturePrivateInput(bytes as Buffer),
        }))
        const token = randomBytes(32).toString('hex')
        const configuration: PrivateMacosGuardianStart = {
          type: 'start',
          ownerDirectory,
          ownerToken: token,
          launcher,
          cwd: join(mountPath, 'work'),
          command: [
            process.execPath,
            '--no-env-file',
            '--no-install',
            '--config=/dev/null',
            join(mountPath, 'inputs/source/main.ts'),
            join(mountPath, 'output/result.json'),
            canary,
          ],
          environment: {},
          files: {
            readOnlyFiles: [process.execPath],
            readOnlyTrees: [join(mountPath, 'inputs')],
            writableTrees: ['work', 'tmp', 'output'].map((name) => join(mountPath, name)),
            protectedRoots: [ownerDirectory],
            network: 'isolated',
          },
          limits: {
            memoryBytes: 256 * 1024 * 1024,
            pids: 8,
            cpuQuotaMicros: 50_000,
            cpuPeriodMicros: 100_000,
            deadlineUnixMs: Date.now() + 40_000,
            cleanupTimeoutMs: 5000,
          },
          maxOutputBytes: 4096,
          storage: { mountPath, bytes: 16 * 1024 * 1024, collect: 'output' },
          inputs: capturedInputs.map(({ path, input }) => ({
            path,
            bytes: input.bytes + (mode === 'manifest-mismatch' ? 1 : 0),
            digest: input.digest,
          })),
        }
        const input = {
          bun: process.execPath,
          supervisor: fileURLToPath(
            new URL('../src/internal/macos-native-supervisor.ts', import.meta.url),
          ),
          configuration,
          capturedInputs,
        }
        let owner: Awaited<ReturnType<typeof preparePrivateMacosGuardian>> | undefined
        let capturedOutput: PrivateCapturedOutput | undefined
        let settled = false
        try {
          if (mode === 'manifest-mismatch') {
            await expect(preparePrivateMacosGuardian(input)).rejects.toThrow('do not match')
            expect(await exists(join(ownerDirectory, 'owner.json'))).toBe(false)
            expect(await exists(join(ownerDirectory, 'storage'))).toBe(false)
            settled = true
            continue
          }
          owner = await preparePrivateMacosGuardian(input)
          let stdout = '',
            stderr = ''
          owner.stdout.on('data', (bytes) => {
            stdout += bytes.toString()
          })
          owner.stderr.on('data', (bytes) => {
            stderr += bytes.toString()
          })
          expect(await exists(join(mountPath, 'inputs/source/main.ts'))).toBe(false)
          if (mode === 'closed-before-admission') {
            for (const file of capturedInputs) file.input.close()
            await expect(owner.admit()).rejects.toThrow('not active')
            expect(stdout).toBe('')
          } else {
            await owner.admit()
            for (const file of capturedInputs) file.input.close()
            expect(stdout).toBe('')
            owner.continue()
            const fenced = await owner.fenced
            expect({ exit: fenced.result?.exitCode, stderr }).toEqual({ exit: 0, stderr: '' })
            expect(stdout).toBe('native-input-complete\n')
            expect(
              JSON.parse(privateReadRegularFile(fenced.outputFd!, 'result.json', 4096).toString()),
            ).toEqual({
              answer: 42,
              writable: false,
              privateVisible: false,
              bytes: [0, 255, 128],
              empty: 0,
            })
            capturedOutput = capturePrivateOutput(fenced.outputFd!)
            if (mode === 'guardian-loss') {
              const ffi = createRequire(import.meta.url)('bun:ffi')
              const api = ffi.dlopen('/usr/lib/libSystem.B.dylib', {
                proc_signal_with_audittoken: { args: ['ptr', 'i32'], returns: 'i32' },
              })
              try {
                const token = Buffer.alloc(32)
                token.writeUInt32LE(owner.identity.guardianPid, 20)
                token.writeUInt32LE(owner.identity.guardianVersion, 28)
                expect(api.symbols.proc_signal_with_audittoken(ffi.ptr(token), 9)).toBe(0)
              } finally {
                api.close()
              }
            } else owner.release()
          }
          const terminal = await owner.completion
          expect(terminal.recovered).toBe(mode === 'guardian-loss')
          settled = terminal.fenced
          expect(await exists(mountPath)).toBe(false)
          expect(await exists(join(ownerDirectory, 'storage/volume.dmg'))).toBe(false)
          if (capturedOutput !== undefined)
            expect(
              JSON.parse(readPrivateCapturedOutput(capturedOutput)[0]!.contents.toString()).answer,
            ).toBe(42)
        } finally {
          try {
            if (!settled && owner !== undefined) {
              owner.cancel()
              await owner.completion
              await recoverPrivateMacosGuardian(ownerDirectory, token, 5000)
              settled = true
            }
          } finally {
            capturedOutput?.close()
            for (const file of capturedInputs) file.input.close()
            if (settled) await rm(root, { recursive: true })
            else {
              retained = true
              console.error(`Mac input evidence retained at ${root}`)
            }
          }
        }
      }
    } finally {
      if (!retained) await rm(build, { recursive: true })
    }
  },
  90_000,
)
