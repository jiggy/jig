import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import {
  access,
  link,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { privateMacosFilesystem } from '../src/internal/macos-descriptor-files.js'
import { preparePrivateMacosGuardian } from '../src/internal/macos-guardian-client.js'
import {
  createPrivateMacosVolume,
  recoverPrivateMacosVolume,
} from '../src/internal/macos-volume.js'

const native = test.skipIf(
  process.platform !== 'darwin' || process.env.JIG_MACOS_PROCESS_TEST !== '1',
)

async function allocation() {
  const root = await mkdtemp('/private/tmp/jig-volume-')
  const control = join(root, 'control'),
    mount = join(root, 'mount')
  await mkdir(control, { mode: 0o700 })
  await mkdir(mount, { mode: 0o700 })
  return { root, control, mount, token: randomBytes(32).toString('hex') }
}

native(
  'native volume enforces shared capacity, protects backing, and authenticates exact recovery',
  async () => {
    const fixture = await allocation()
    const { root, control, mount, token } = fixture
    let volume: Awaited<ReturnType<typeof createPrivateMacosVolume>> | undefined
    let guardian: Awaited<ReturnType<typeof preparePrivateMacosGuardian>> | undefined
    try {
      volume = await createPrivateMacosVolume(control, token, mount, 16 * 1024 * 1024)
      const filesystem = privateMacosFilesystem(volume.directory.fd)
      expect(filesystem.capacityBytes).toBeLessThanOrEqual(16n * 1024n * 1024n)
      expect(filesystem.type).toBe('hfs')
      // Actual case-sensitive files, even when the host's project disk folds case.
      await writeFile(join(mount, 'Readme'), 'upper', { flag: 'wx' })
      await writeFile(join(mount, 'README'), 'lower', { flag: 'wx' })
      expect(await readFile(join(mount, 'Readme'), 'utf8')).toBe('upper')
      expect(await readFile(join(mount, 'README'), 'utf8')).toBe('lower')

      await expect(recoverPrivateMacosVolume(control, 'f'.repeat(64))).rejects.toThrow(
        'authentication',
      )
      const journalPath = join(control, 'volume.json')
      const journal = await readFile(journalPath)
      const forged = JSON.parse(journal.toString())
      forged.value.mount.path = root
      await writeFile(journalPath, JSON.stringify(forged))
      await expect(recoverPrivateMacosVolume(control, token)).rejects.toThrow('authentication')
      await writeFile(journalPath, journal)
      await link(join(control, 'volume-image.json'), join(control, 'alias'))
      await expect(recoverPrivateMacosVolume(control, token)).rejects.toThrow('unsafe')
      await unlink(join(control, 'alias'))
      await rename(join(control, 'volume.dmg'), join(control, 'original.dmg'))
      await writeFile(join(control, 'volume.dmg'), 'unrelated canary', { flag: 'wx', mode: 0o600 })
      await expect(recoverPrivateMacosVolume(control, token)).rejects.toThrow('backing identity')
      expect(await readFile(join(control, 'volume.dmg'), 'utf8')).toBe('unrelated canary')
      await unlink(join(control, 'volume.dmg'))
      await rename(join(control, 'original.dmg'), join(control, 'volume.dmg'))

      const launcher = join(root, 'launcher'),
        payload = join(root, 'payload')
      for (const [source, output] of [
        [new URL('../support/macos-exec.c', import.meta.url), launcher],
        [new URL('./fixtures/macos-volume-payload.c', import.meta.url), payload],
      ] as const) {
        const compiled = spawnSync(
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
        expect({ code: compiled.status, errors: compiled.stderr }).toEqual({ code: 0, errors: '' })
      }
      const ownerDirectory = join(root, 'guardian')
      await mkdir(ownerDirectory, { mode: 0o700 })
      guardian = await preparePrivateMacosGuardian({
        bun: process.execPath,
        supervisor: fileURLToPath(
          new URL('../src/internal/macos-native-supervisor.ts', import.meta.url),
        ),
        configuration: {
          type: 'start',
          ownerDirectory,
          ownerToken: randomBytes(32).toString('hex'),
          launcher,
          cwd: mount,
          command: [payload, mount, join(control, 'volume.dmg')],
          environment: {},
          files: {
            readOnlyFiles: [payload],
            readOnlyTrees: [],
            writableTrees: [mount],
            protectedRoots: [control, ownerDirectory],
            network: 'isolated',
          },
          limits: {
            memoryBytes: 32 * 1024 * 1024,
            pids: 4,
            cpuQuotaMicros: 50_000,
            cpuPeriodMicros: 100_000,
            deadlineUnixMs: Date.now() + 25_000,
            cleanupTimeoutMs: 5000,
          },
          maxOutputBytes: 4096,
        },
      })
      let stdout = '',
        stderr = ''
      guardian.stdout.on('data', (bytes) => {
        stdout += bytes.toString()
      })
      guardian.stderr.on('data', (bytes) => {
        stderr += bytes.toString()
      })
      guardian.stdout.resume()
      guardian.stderr.resume()
      await guardian.admit()
      guardian.continue()
      guardian.stdin.end()
      const completion = await guardian.completion
      expect(completion.fenced).toBe(true)
      expect(completion.result?.exitCode).toBe(0)
      expect(stderr).toBe('')
      const reported = JSON.parse(stdout)
      expect(reported).toMatchObject({ backingDenied: true, full: true, reaped: 2 })
      expect(reported.bytes).toBeLessThan(16 * 1024 * 1024)
      expect(reported.bytes).toBeGreaterThan(8 * 1024 * 1024)
    } finally {
      if (guardian) {
        guardian.cancel()
        await guardian.completion
      }
      await volume?.directory.close()
      await recoverPrivateMacosVolume(control, token)
      await recoverPrivateMacosVolume(control, token)
      await expect(access(mount)).rejects.toMatchObject({ code: 'ENOENT' })
      await expect(access(join(control, 'volume.dmg'))).rejects.toMatchObject({ code: 'ENOENT' })
      await rm(root, { recursive: true })
    }
  },
  100_000,
)

native(
  'fresh process recovers a volume after its creator exits without releasing it',
  async () => {
    const fixture = await allocation()
    const worker = fileURLToPath(new URL('./fixtures/macos-volume-recovery.ts', import.meta.url))
    const run = (mode: string) =>
      spawnSync(process.execPath, ['--no-env-file', '--no-install', '--config=/dev/null', worker], {
        env: {},
        input: JSON.stringify({ ...fixture, mode }),
        encoding: 'utf8',
        timeout: 45_000,
      })
    try {
      const created = run('create')
      expect({ status: created.status, stderr: created.stderr }).toEqual({ status: 76, stderr: '' })
      const recovered = run('recover')
      expect({
        status: recovered.status,
        stdout: recovered.stdout,
        stderr: recovered.stderr,
      }).toEqual({ status: 0, stdout: 'recovered\n', stderr: '' })
      await expect(access(fixture.mount)).rejects.toMatchObject({ code: 'ENOENT' })
      await expect(access(join(fixture.control, 'volume.dmg'))).rejects.toMatchObject({
        code: 'ENOENT',
      })
    } finally {
      await recoverPrivateMacosVolume(fixture.control, fixture.token)
      await rm(fixture.root, { recursive: true })
    }
  },
  100_000,
)

native(
  'existing control or data prevents allocation without taking cleanup ownership',
  async () => {
    const fixture = await allocation()
    try {
      const data = join(fixture.mount, 'unrelated')
      await writeFile(data, 'canary')
      await expect(
        createPrivateMacosVolume(fixture.control, fixture.token, fixture.mount, 16 * 1024 * 1024),
      ).rejects.toThrow('destination is not empty')
      expect(await readFile(data, 'utf8')).toBe('canary')
      await unlink(data)
      const backing = join(fixture.control, 'volume.dmg')
      await writeFile(backing, 'canary')
      await expect(
        createPrivateMacosVolume(fixture.control, fixture.token, fixture.mount, 16 * 1024 * 1024),
      ).rejects.toThrow('control allocation is not empty')
      expect(await readFile(backing, 'utf8')).toBe('canary')
      await expect(access(join(fixture.control, 'volume.json'))).rejects.toMatchObject({
        code: 'ENOENT',
      })
    } finally {
      await rm(fixture.root, { recursive: true })
    }
  },
)
