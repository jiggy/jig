import { expect, test } from 'bun:test'
import { spawn, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PrivateFileImportUnconfirmedError } from '../src/internal/execution-file-import.js'
import { writePrivateDeliveryFile } from '../src/internal/file-delivery-storage.js'
import { privateReadRegularFile } from '../src/internal/file-input.js'
import {
  preparePrivateMacosGuardian,
  recoverPrivateMacosGuardian,
  releasePrivateMacosGuardian,
} from '../src/internal/macos-guardian-client.js'
import { requirePrivateMacosGuardianStorage } from '../src/internal/macos-guardian-storage.js'
import type { PrivateMacosGuardianStart } from '../src/internal/macos-native-supervisor.js'
import { samePrivateMacosOwnedProcess } from '../src/internal/macos-process-controls.js'

const native = test.skipIf(
  process.platform !== 'darwin' || process.env.JIG_MACOS_PROCESS_TEST !== '1',
)
const source = `#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>
int main(int argc, char **argv) {
  if (argc != 3) return 1;
  for (int fd = 3; fd < 4096; fd++) {
    errno = 0;
    if (fcntl(fd, F_GETFD) != -1 || errno != EBADF) return 9;
  }
  char path[2048];
  snprintf(path, sizeof(path), "%s/../imports", argv[1]);
  if (access(path, R_OK) == 0) return 2;
  puts("ready"); fflush(stdout);
  int command;
  while ((command = getchar()) != EOF) {
    if (command == 'C') {
      snprintf(path, sizeof(path), "%s/copies", argv[1]);
      if (access(path, F_OK) == 0) return 3;
      puts("private"); fflush(stdout);
    } else if (command == 'X') {
      snprintf(path, sizeof(path), "%s/copies", argv[1]);
      if (mkdir(path, 0700)) return 4;
      strncat(path, "/caller.txt", sizeof(path) - strlen(path) - 1);
      int fd = open(path, O_CREAT | O_EXCL | O_WRONLY, 0600);
      if (fd < 0 || write(fd, "caller", 6) != 6 || close(fd)) return 5;
      puts("occupied"); fflush(stdout);
    } else if (command == 'D') {
      snprintf(path, sizeof(path), "%s/copies/copy.txt", argv[1]);
      int fd = open(path, O_RDONLY); char bytes[16] = {0};
      if (fd < 0 || read(fd, bytes, sizeof(bytes)) != 4 || strcmp(bytes, "copy") || close(fd)) return 6;
      snprintf(path, sizeof(path), "%s/overview/sheet.txt", argv[1]);
      fd = open(path, O_RDONLY); memset(bytes, 0, sizeof(bytes));
      if (fd < 0 || read(fd, bytes, sizeof(bytes)) != 5 || strcmp(bytes, "sheet") || close(fd)) return 7;
      return 0;
    } else if (command == 'E') return 0;
    else if (command == 'F') return 12;
  }
  return 8;
}
`

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

async function configurationFixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'jig-mac-import-')))
  const ownerDirectory = join(root, 'owner')
  const mountPath = join(root, 'data')
  await mkdir(ownerDirectory, { mode: 0o700 })
  await mkdir(mountPath, { mode: 0o700 })
  const caller = join(root, 'caller')
  const callerSource = join(root, 'caller.c')
  await writeFile(callerSource, source)
  const built = spawnSync(
    '/usr/bin/cc',
    ['-Wall', '-Wextra', '-Werror', callerSource, '-o', caller],
    { encoding: 'utf8', timeout: 10_000 },
  )
  expect({ status: built.status, errors: built.stderr }).toEqual({ status: 0, errors: '' })
  const ownerToken = randomBytes(32).toString('hex')
  const deadlineUnixMs = Date.now() + 45_000
  const configuration: PrivateMacosGuardianStart = {
    type: 'start',
    ownerDirectory,
    ownerToken,
    launcher: fileURLToPath(new URL('../support/macos-exec-universal', import.meta.url)),
    cwd: join(mountPath, 'work'),
    command: [caller, join(mountPath, 'output'), 'fixture'],
    environment: {},
    maxOutputBytes: 4096,
    files: {
      readOnlyFiles: [caller],
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
      deadlineUnixMs,
      cleanupTimeoutMs: 5000,
    },
    storage: { mountPath, bytes: 32 * 1024 * 1024, collect: 'output', imports: true },
  }
  return {
    root,
    bun: process.execPath,
    supervisor: fileURLToPath(
      new URL('../src/internal/macos-native-supervisor.ts', import.meta.url),
    ),
    configuration,
  }
}

async function fixture(provided?: Awaited<ReturnType<typeof configurationFixture>>) {
  const input = provided ?? (await configurationFixture())
  const { root, configuration } = input
  const { ownerDirectory, ownerToken } = configuration
  const deadlineUnixMs = configuration.limits.deadlineUnixMs
  const guardian = await preparePrivateMacosGuardian(input)
  let output = ''
  guardian.stdout.on('data', (bytes: Buffer) => {
    output += bytes.toString()
  })
  guardian.stderr.resume()
  const observe = (pid: number) => {
    const ffi = createRequire(import.meta.url)('bun:ffi')
    const library = ffi.dlopen('/usr/lib/libSystem.B.dylib', {
      proc_pidinfo: { args: ['i32', 'i32', 'u64', 'ptr', 'i32'], returns: 'i32' },
    })
    try {
      const bytes = Buffer.alloc(56)
      expect(library.symbols.proc_pidinfo(pid, 17, 0, ffi.ptr(bytes), bytes.length)).toBe(56)
      return { version: bytes.readUInt32LE(32), uniqueId: bytes.readBigUInt64LE(16) }
    } finally {
      library.close()
    }
  }
  const preExec = await guardian.admit()
  const original = observe(preExec.pid)
  expect(original.version).toBe(preExec.version)
  guardian.continue()
  const wait = async (text: string) => {
    const end = performance.now() + 5000
    while (!output.includes(text) && performance.now() < end) await Bun.sleep(5)
    expect(output).toContain(text)
  }
  await wait('ready')
  const postExec = observe(preExec.pid)
  expect(postExec.version).not.toBe(preExec.version)
  expect(postExec.uniqueId).toBe(original.uniqueId)
  expect(postExec.uniqueId).toBeGreaterThan(0n)
  const target = guardian.outputImport!
  expect(target).toBeDefined()
  let settled = false
  return {
    guardian,
    target,
    deadlineUnixMs,
    wait,
    input,
    async finish(command: string) {
      guardian.stdin.end(command)
      const fenced = await guardian.fenced
      expect(fenced.result?.exitCode).toBe(0)
      expect(fenced.outputFd).toBeDefined()
      return fenced.outputFd!
    },
    async release() {
      guardian.release()
      const result = await guardian.completion
      expect(result.outputLost).toBe(false)
      await releasePrivateMacosGuardian(ownerDirectory, ownerToken)
      expect(
        await readFile(join(ownerDirectory, 'owner.json')).catch(() => undefined),
      ).toBeUndefined()
      settled = true
    },
    async close() {
      if (!settled) {
        guardian.cancel()
        await guardian.completion
        await releasePrivateMacosGuardian(ownerDirectory, ownerToken)
        settled = true
      }
      if (settled) await rm(root, { recursive: true })
    },
  }
}

type Fault = 'roots-transfer' | 'import-begin' | 'import-commit'
async function faultSupervisor(root: string, fault: Fault, marker: string) {
  const sourceUrl = new URL('../src/internal/macos-native-supervisor.ts', import.meta.url)
  const original = await readFile(sourceUrl, 'utf8')
  const point =
    fault === 'roots-transfer'
      ? "        channel.send({ type: 'import-roots' })"
      : '          channel.send(importRoots.handle(message))'
  expect(original.split(point)).toHaveLength(2)
  const altered =
    fault === 'roots-transfer'
      ? `        await writeFile(${JSON.stringify(marker)}, 'held', { mode: 0o600, flag: 'wx' })
        await new Promise<void>((resolve) => {
          if (cancellation.signal.aborted) resolve()
          else cancellation.signal.addEventListener('abort', () => resolve(), { once: true })
        })
        cancellation.signal.throwIfAborted()
${point}`
      : `          const reply = importRoots.handle(message)
          if (reply.action === ${JSON.stringify(fault)})
            await writeFile(${JSON.stringify(marker)}, reply.state, { mode: 0o600, flag: 'wx' })
          else channel.send(reply)`
  const supervisor = join(root, `${fault}.ts`)
  await writeFile(
    supervisor,
    "import { writeFile } from 'node:fs/promises'\n" +
      original
        .replace(point, altered)
        .replaceAll("from './", `from '${fileURLToPath(new URL('.', sourceUrl))}`),
  )
  return supervisor
}

async function exists(path: string) {
  return await stat(path).then(
    () => true,
    () => false,
  )
}
async function proveIndependentStorageCleanup(
  input: Awaited<ReturnType<typeof configurationFixture>>,
) {
  const { ownerDirectory, ownerToken, storage } = input.configuration
  const end = performance.now() + 45_000
  while (
    (await exists(storage!.mountPath)) ||
    (await exists(join(ownerDirectory, 'storage/volume.dmg')))
  ) {
    if (performance.now() >= end)
      throw new Error(`independent import cleanup is unconfirmed: ${input.root}`)
    await Bun.sleep(20)
  }
  expect(await exists(storage!.mountPath)).toBe(false)
  expect(await exists(join(ownerDirectory, 'storage/volume.dmg'))).toBe(false)
  // Recovery verifies the exact original coalition/job and retires only proved journals.
  await recoverPrivateMacosGuardian(ownerDirectory, ownerToken, 5000)
  await releasePrivateMacosGuardian(ownerDirectory, ownerToken)
  expect(await exists(join(ownerDirectory, 'owner.json'))).toBe(false)
}

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
      fileURLToPath(new URL('./fixtures/macos-file-import-coordinator.ts', import.meta.url)),
    ]) {
      const built = await Bun.build({ entrypoints: [entrypoint], target: 'bun', write: false })
      expect(built.success, String(built.logs)).toBe(true)
    }
  } finally {
    await rm(root, { recursive: true })
  }
})

native(
  'two sibling imports remain private, commit complete folders and release original loans',
  async () => {
    const run = await fixture()
    try {
      const signal = new AbortController().signal
      const [copy, sheet] = await Promise.all([
        run.target.stage({
          directory: 'copies',
          operationId: 'copy',
          deadlineUnixMs: run.deadlineUnixMs,
          signal,
        }),
        run.target.stage({
          directory: 'overview',
          operationId: 'sheet',
          deadlineUnixMs: run.deadlineUnixMs,
          signal,
        }),
      ])
      await writePrivateDeliveryFile(copy.directory, 'copy.txt', Buffer.from('copy'), () =>
        signal.throwIfAborted(),
      )
      await writePrivateDeliveryFile(sheet.directory, 'sheet.txt', Buffer.from('sheet'), () =>
        signal.throwIfAborted(),
      )
      run.guardian.stdin.write('C')
      await run.wait('private')
      expect(await Promise.all([copy.commit(), sheet.commit()])).toEqual(['committed', 'committed'])
      await Promise.all([copy.close(), sheet.close()])
      const fd = await run.finish('D')
      expect(privateReadRegularFile(fd, 'copies/copy.txt', 16).toString()).toBe('copy')
      expect(privateReadRegularFile(fd, 'overview/sheet.txt', 16).toString()).toBe('sheet')
      await run.release()
    } finally {
      await run.close()
    }
  },
  90_000,
)

native(
  'accepted cancellation and occupied destinations commit nothing and preserve caller files',
  async () => {
    const run = await fixture()
    try {
      const cancellation = new AbortController()
      const cancelled = await run.target.stage({
        directory: 'cancelled',
        operationId: 'cancelled',
        deadlineUnixMs: run.deadlineUnixMs,
        signal: cancellation.signal,
      })
      await writePrivateDeliveryFile(
        cancelled.directory,
        'partial.txt',
        Buffer.from('discard'),
        () => {},
      )
      cancellation.abort()
      expect(await cancelled.commit()).toBe('absent')
      await cancelled.close()
      const signal = new AbortController().signal
      const collision = await run.target.stage({
        directory: 'copies',
        operationId: 'collision',
        deadlineUnixMs: run.deadlineUnixMs,
        signal,
      })
      await writePrivateDeliveryFile(collision.directory, 'copy.txt', Buffer.from('copy'), () => {})
      run.guardian.stdin.write('X')
      await run.wait('occupied')
      expect(await collision.commit()).toBe('absent')
      await collision.close()
      const fd = await run.finish('E')
      expect(privateReadRegularFile(fd, 'copies/caller.txt', 16).toString()).toBe('caller')
      expect(() => privateReadRegularFile(fd, 'copies/copy.txt', 16)).toThrow()
      expect(() => privateReadRegularFile(fd, 'cancelled/partial.txt', 16)).toThrow()
      await run.release()
    } finally {
      await run.close()
    }
  },
  90_000,
)

native(
  'cancelled and nonzero callers join active stages before non-collecting storage cleanup',
  async () => {
    for (const mode of ['cancelled', 'nonzero'] as const) {
      const run = await fixture()
      let cleaned = false
      try {
        const stage = await run.target.stage({
          directory: 'copies',
          operationId: mode,
          deadlineUnixMs: run.deadlineUnixMs,
          signal: new AbortController().signal,
        })
        await writePrivateDeliveryFile(
          stage.directory,
          'partial.txt',
          Buffer.from('discard'),
          () => {},
        )
        if (mode === 'cancelled') run.guardian.cancel()
        else run.guardian.stdin.end('F')
        const fenced = await run.guardian.fenced
        expect(fenced.outputFd).toBeUndefined()
        expect(fenced.result?.reason).toBe(mode === 'cancelled' ? 'cancelled' : 'payload_exit')
        if (mode === 'nonzero') expect(fenced.result?.exitCode).toBe(12)
        await run.target.close()
        await stage.close()
        const result = await run.guardian.completion
        expect(result.fenced).toBe(true)
        expect(result.result?.reason).toBe(fenced.result?.reason)
        await proveIndependentStorageCleanup(run.input)
        cleaned = true
      } finally {
        if (!cleaned) {
          run.guardian.cancel()
          await run.guardian.completion.catch(() => undefined)
          await proveIndependentStorageCleanup(run.input)
        }
        if (cleaned) await rm(run.input.root, { recursive: true })
      }
    }
  },
  120_000,
)

native(
  'coordinator loss during original loans, an active stage and a committed stage cleans independently',
  async () => {
    for (const phase of ['roots-transfer', 'active-stage', 'committed-stage'] as const) {
      const input = await configurationFixture()
      const marker = join(input.root, 'loan.marker')
      if (phase === 'roots-transfer')
        input.supervisor = await faultSupervisor(input.root, phase, marker)
      const configPath = join(input.root, 'coordinator.json')
      await writeFile(configPath, JSON.stringify({ phase, marker, input }), {
        mode: 0o600,
        flag: 'wx',
      })
      const coordinator = spawn(
        process.execPath,
        [
          '--no-env-file',
          '--no-install',
          '--config=/dev/null',
          fileURLToPath(new URL('./fixtures/macos-file-import-coordinator.ts', import.meta.url)),
          configPath,
        ],
        { env: {}, stdio: ['ignore', 'pipe', 'pipe'] },
      )
      let output = '',
        errors = ''
      coordinator.stdout.on('data', (bytes: Buffer) => {
        output += bytes.toString()
      })
      coordinator.stderr.on('data', (bytes: Buffer) => {
        errors += bytes.toString()
      })
      const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
        (resolve, reject) => {
          coordinator.once('error', reject)
          coordinator.once('close', (code, signal) => resolve({ code, signal }))
        },
      )
      void exited.catch(() => undefined)
      let cleaned = false
      try {
        const end = performance.now() + 25_000
        while (
          !output.includes(`${phase}\n`) &&
          performance.now() < end &&
          coordinator.exitCode === null &&
          coordinator.signalCode === null
        ) {
          if (output.length + errors.length > 8192)
            throw new Error('coordinator fixture output exceeded its bound')
          await Bun.sleep(5)
        }
        expect({ output, errors }).toEqual({ output: `${phase}\n`, errors: '' })
        expect(coordinator.kill('SIGKILL')).toBe(true)
        expect(await exited).toEqual({ code: null, signal: 'SIGKILL' })
        await proveIndependentStorageCleanup(input)
        cleaned = true
      } finally {
        if (coordinator.exitCode === null && coordinator.signalCode === null)
          coordinator.kill('SIGKILL')
        await exited
        if (!cleaned) await proveIndependentStorageCleanup(input)
        if (cleaned) await rm(input.root, { recursive: true })
      }
    }
  },
  180_000,
)

native(
  'applied begin and commit with lost ACK remain unconfirmed and fence the original caller',
  async () => {
    for (const action of ['import-begin', 'import-commit'] as const) {
      const input = await configurationFixture()
      const marker = join(input.root, 'ack.marker')
      input.supervisor = await faultSupervisor(input.root, action, marker)
      const run = await fixture(input)
      let cleaned = false
      try {
        const opening = run.target.stage({
          directory: 'copies',
          operationId: action,
          deadlineUnixMs: run.deadlineUnixMs,
          signal: new AbortController().signal,
        })
        if (action === 'import-begin') {
          await expect(opening).rejects.toBeInstanceOf(PrivateFileImportUnconfirmedError)
          expect(await readFile(marker, 'utf8')).toBe('ready')
        } else {
          const stage = await opening
          await writePrivateDeliveryFile(stage.directory, 'copy.txt', Buffer.from('copy'), () => {})
          await expect(stage.commit()).rejects.toBeInstanceOf(PrivateFileImportUnconfirmedError)
          expect(await readFile(marker, 'utf8')).toBe('committed')
          await expect(stage.close()).rejects.toBeInstanceOf(PrivateFileImportUnconfirmedError)
        }
        await expect(run.guardian.completion).rejects.toBeInstanceOf(Error)
        await expect(run.target.close()).rejects.toBeInstanceOf(PrivateFileImportUnconfirmedError)
        await proveIndependentStorageCleanup(input)
        cleaned = true
      } finally {
        if (!cleaned) {
          run.guardian.cancel()
          await run.guardian.completion.catch(() => undefined)
          await proveIndependentStorageCleanup(input)
        }
        if (cleaned) await rm(input.root, { recursive: true })
      }
    }
  },
  120_000,
)
