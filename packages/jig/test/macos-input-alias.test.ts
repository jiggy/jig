import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sha256 } from '../src/internal/file-input-policy.js'
import { capturePrivateInput } from '../src/internal/input-capture.js'
import {
  planPrivateMacosOwnerStateAllocation,
  releasePrivateMacosOwnerState,
} from '../src/internal/macos-backend-state.js'
import { normalizePrivateMacosInputs } from '../src/internal/macos-input-projection.js'
import {
  PrivateMacosBackend,
  type PrivateMacosComponentProcess,
  type PrivateMacosSealedOwner,
} from '../src/internal/macos-native-backend.js'

test('Mac input manifests pin only canonical files and closed whole-root aliases', () => {
  const file = { path: 'first/file', bytes: 1, digest: sha256(Buffer.from('x')) }
  const aliases = [{ name: 'second', target: 'first' }]
  expect(normalizePrivateMacosInputs([file], ['first', 'second'], aliases)).toEqual([file])
  expect(() =>
    normalizePrivateMacosInputs(
      [file, { ...file, path: 'second/file' }],
      ['first', 'second'],
      aliases,
    ),
  ).toThrow()
  expect(() =>
    normalizePrivateMacosInputs(
      [file],
      ['first', 'second'],
      [{ name: 'second', target: '../host' }],
    ),
  ).toThrow()
  expect(() =>
    normalizePrivateMacosInputs(
      [file],
      ['first', 'second'],
      [{ name: 'second', target: 'first', extra: true }],
    ),
  ).toThrow()
})

const native = test.skipIf(
  process.platform !== 'darwin' || process.env.JIG_MACOS_PROCESS_TEST !== '1',
)

native(
  'Mac sealed owner projects 64 files / 8 MiB once for eight immutable whole-view aliases',
  async () => {
    const root = await mkdtemp('/private/tmp/jig-input-alias-')
    const owners = join(root, 'owners')
    await mkdir(owners, { mode: 0o700 })
    const allocation = await planPrivateMacosOwnerStateAllocation({
      parent: owners,
      name: 'aliased-inputs',
    })
    await writeFile(join(root, 'recovery-identity.json'), JSON.stringify(allocation), {
      mode: 0o600,
      flag: 'wx',
    })
    const directories = [
      'first',
      'second',
      'third',
      'fourth',
      'fifth',
      'sixth',
      'seventh',
      'eighth',
    ]
    const captures = Array.from({ length: 64 }, (_, index) => {
      const bytes = Buffer.alloc(128 * 1024, index)
      if (index === 0) {
        bytes.fill(32)
        bytes.write('export const answer = 42; /*')
        bytes.write('*/', bytes.length - 2)
      }
      return capturePrivateInput(bytes)
    })
    const capturedInputs = directories.flatMap((name) =>
      captures.map((input, index) => ({
        path: `${name}/file-${index}${index === 0 ? '.ts' : '.bin'}`,
        input,
      })),
    )
    const data = join(allocation.directory, 'data')
    const backend = new PrivateMacosBackend({
      bunPath: process.execPath,
      supervisorPath: fileURLToPath(
        new URL('../src/internal/macos-native-supervisor.ts', import.meta.url),
      ),
      launcherPath: fileURLToPath(new URL('../support/macos-exec-universal', import.meta.url)),
    })
    let sealed: PrivateMacosSealedOwner | undefined
    let processOwner: PrivateMacosComponentProcess | undefined
    let successful = false
    try {
      const payload = `
import { lstat, stat, realpath, readdir, open, writeFile, mkdir, rename, unlink, symlink, chmod } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
const folder = process.argv[1], roots = JSON.parse(process.argv[2]);
const base = join(folder, 'eighth'), observations = [];
const module = await import(join(base, 'file-0.ts'));
for (const root of roots) {
  const view = join(folder, root), info = await lstat(view);
  const file = await open(join(view, 'file-63.bin'), constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await file.stat(), bytes = Buffer.alloc(1);
    await file.read(bytes, 0, 1, 0);
    observations.push({ root, isLink: (await lstat(view)).isSymbolicLink(), isDirectory: (await stat(view)).isDirectory(),
      canonical: await realpath(view) === base, entries: (await readdir(view)).length,
      inode: String(info.ino), links: info.nlink, bytes: info.size, firstByte: bytes[0],
      module: (await import(join(view, 'file-0.ts'))).answer });
  } finally { await file.close() }
}
const mutations = [
  () => writeFile(join(folder, 'first/file-63.bin'), 'changed'),
  () => mkdir(join(folder, 'first/new')),
  () => rename(base, join(folder, 'moved')),
  () => unlink(join(folder, 'first')),
  () => symlink('../work', join(folder, 'replacement')),
  () => chmod(join(base, 'file-63.bin'), 0o600),
];
const writable = [];
for (const mutate of mutations) { try { await mutate(); writable.push(true) } catch { writable.push(false) } }
console.log(JSON.stringify({ observations, writable, answer: module.answer }));
`
      sealed = await backend.seal(
        {
          runId: 'aliased-inputs',
          limits: {
            memoryBytes: 512 * 1024 * 1024,
            pids: 8,
            cpuQuotaMicros: 50_000,
            cpuPeriodMicros: 100_000,
            deadlineUnixMs: Date.now() + 45_000,
            cleanupTimeoutMs: 5000,
          },
          command: [
            process.execPath,
            '--no-env-file',
            '--no-install',
            '--config=/dev/null',
            '-e',
            payload,
            join(data, 'inputs'),
            JSON.stringify(directories),
          ],
          cwd: join(data, 'work'),
          environment: {},
          files: {
            readOnlyFiles: [process.execPath],
            readOnlyTrees: [join(data, 'inputs')],
            writableTrees: ['work', 'tmp'].map((name) => join(data, name)),
            protectedRoots: [join(allocation.directory, 'control')],
            network: 'isolated',
          },
          maxOutputBytes: 16 * 1024,
          storage: { mountPath: data, bytes: 16 * 1024 * 1024, collect: null },
          capturedInputs,
          inputDirectories: directories,
        },
        allocation,
      )
      // The original sealed capture recipe remains authoritative after source-array edits.
      const original = captures[0]
      if (original === undefined) throw new Error('native alias fixture lost its original capture')
      capturedInputs.splice(0, capturedInputs.length, { path: '../host', input: original })
      processOwner = await sealed.admit()
      const stdout: Buffer[] = [],
        stderr: Buffer[] = []
      processOwner.stdout.on('data', (bytes) => stdout.push(bytes))
      processOwner.stderr.on('data', (bytes) => stderr.push(bytes))
      await processOwner.closeInput()
      const exit = await processOwner.completion
      const receipt = await processOwner.enforcement
      expect({
        exit: exit.exitCode,
        fenced: exit.fenced,
        stderr: Buffer.concat(stderr).toString(),
      }).toEqual({ exit: 0, fenced: true, stderr: '' })
      const result = JSON.parse(Buffer.concat(stdout).toString())
      expect(result.answer).toBe(42)
      expect(result.writable).toEqual(Array(6).fill(false))
      expect(result.observations).toHaveLength(8)
      expect(new Set(result.observations.map((item: { inode: string }) => item.inode)).size).toBe(1)
      for (const item of result.observations)
        expect(item).toMatchObject({
          isLink: item.root !== 'eighth',
          isDirectory: true,
          canonical: true,
          entries: 64,
          links: 1,
          bytes: 128 * 1024,
          firstByte: 63,
          module: 42,
        })
      expect(await readFile(join(root, 'recovery-identity.json'), 'utf8')).toContain(
        allocation.ownerToken,
      )
      await releasePrivateMacosOwnerState(allocation, receipt as never)
      expect(await readdir(owners)).toEqual([])
      successful = true
    } finally {
      if (!successful) {
        try {
          if (processOwner !== undefined) {
            await processOwner.terminate()
            await backend.recoverFence(processOwner.owner)
          } else if (sealed !== undefined) await backend.recoverFence(sealed.identity)
        } catch (error) {
          console.error('Alias cleanup remains unconfirmed', error)
        }
        console.error(`Mac alias failure evidence retained at ${root}`)
      }
      for (const input of captures) input.close()
      if (successful) await rm(root, { recursive: true })
    }
  },
  70_000,
)
