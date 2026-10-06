import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { createHmac, randomBytes } from 'node:crypto'
import { closeSync, constants } from 'node:fs'
import {
  access,
  link,
  mkdir,
  mkdtemp,
  open,
  readFile,
  rename,
  rm,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  privateCaptureAttachments,
  privateOpenFileRoot,
  privateReadRegularFile,
} from '../src/internal/file-input.js'
import { privateMacosFilesystem } from '../src/internal/macos-descriptor-files.js'
import { preparePrivateMacosGuardian } from '../src/internal/macos-guardian-client.js'
import {
  allocatePrivateMacosVolume,
  createPrivateMacosVolume,
  recoverPrivateMacosVolume,
  releasePrivateMacosVolume,
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
  'recovery detaches only its authenticated image after macOS mounts it elsewhere',
  async () => {
    const { root, control, mount, token } = await allocation()
    const alternate = join(root, 'alternate')
    await mkdir(alternate, { mode: 0o700 })
    await writeFile(join(alternate, 'canary'), 'keep', { mode: 0o600, flag: 'wx' })
    await writeFile(join(root, 'fixture.json'), JSON.stringify({ control, mount, token }), {
      mode: 0o600,
      flag: 'wx',
    })
    const tool = (args: string[]) => {
      const result = spawnSync('/usr/bin/hdiutil', args, {
        encoding: 'utf8',
        timeout: 30_000,
        maxBuffer: 1024 * 1024,
      })
      expect({ status: result.status, signal: result.signal }).toEqual({ status: 0, signal: null })
    }
    let cleaned = false
    try {
      const volume = await createPrivateMacosVolume(control, token, mount, 16 * 1024 * 1024)
      const device = privateMacosFilesystem(volume.directory.fd).device
      await volume.directory.close()
      tool(['detach', device])
      // Reproduce the observed interrupted-attach state deterministically, with
      // the same image inode and authenticated journal but a different mount.
      tool([
        'attach',
        '-kernel',
        '-nobrowse',
        '-noautoopen',
        '-noautofsck',
        '-owners',
        'on',
        '-mountpoint',
        alternate,
        '-mount',
        'required',
        join(control, 'volume.dmg'),
      ])
      await recoverPrivateMacosVolume(control, token)
      await releasePrivateMacosVolume(control, token)
      cleaned = true
      await expect(access(control)).rejects.toMatchObject({ code: 'ENOENT' })
      await expect(access(mount)).rejects.toMatchObject({ code: 'ENOENT' })
      // The observed mount path never becomes authority to delete a host tree.
      expect(await readFile(join(alternate, 'canary'), 'utf8')).toBe('keep')
    } finally {
      if (!cleaned) {
        const directory = await open(alternate, constants.O_RDONLY | constants.O_DIRECTORY)
        let device: string | undefined
        try {
          const filesystem = privateMacosFilesystem(directory.fd)
          if (filesystem.type === 'hfs' && filesystem.mountpoint === alternate)
            device = filesystem.device
        } finally {
          await directory.close()
        }
        if (device !== undefined) tool(['detach', device])
        await recoverPrivateMacosVolume(control, token)
        await releasePrivateMacosVolume(control, token)
      }
      await rm(root, { recursive: true })
    }
  },
  100_000,
)

native(
  'backing staging retirement rejects aliases, public modes and oversized files',
  async () => {
    for (const kind of ['symlink', 'hardlink', 'public', 'oversized']) {
      const { root, control, mount, token } = await allocation()
      const pending = join(control, 'volume-image.pending'),
        canary = join(root, 'canary')
      try {
        await allocatePrivateMacosVolume(control, token, mount, 16 * 1024 * 1024)
        await recoverPrivateMacosVolume(control, token)
        await writeFile(canary, 'keep', { mode: 0o600, flag: 'wx' })
        if (kind === 'symlink') await symlink(canary, pending)
        else if (kind === 'hardlink') await link(canary, pending)
        else
          await writeFile(pending, kind === 'oversized' ? 'x'.repeat(4097) : '', {
            mode: kind === 'public' ? 0o644 : 0o600,
            flag: 'wx',
          })
        await expect(releasePrivateMacosVolume(control, token)).rejects.toThrow('staging is unsafe')
        expect(await readFile(canary, 'utf8')).toBe('keep')
        await unlink(pending)
        await writeFile(pending, '', { mode: 0o600, flag: 'wx' })
        await releasePrivateMacosVolume(control, token)
        await expect(access(control)).rejects.toMatchObject({ code: 'ENOENT' })
      } finally {
        await rm(root, { recursive: true })
      }
    }
  },
  45_000,
)

native(
  'retirement resumes after its authenticated volume journal was removed',
  async () => {
    const { root, control, mount, token } = await allocation()
    try {
      const volume = await createPrivateMacosVolume(control, token, mount, 16 * 1024 * 1024)
      await volume.directory.close()
      await recoverPrivateMacosVolume(control, token)
      const intent = JSON.parse(await readFile(join(control, 'volume.json'), 'utf8'))
      const name = 'storage.release.json'
      const mac = createHmac('sha256', Buffer.from(token, 'hex'))
        .update(`jig-macos-volume\0${name}\0`)
        .update(JSON.stringify(intent.value))
        .digest('hex')
      await writeFile(join(root, name), `${JSON.stringify({ value: intent.value, mac })}\n`, {
        mode: 0o600,
        flag: 'wx',
      })
      await unlink(join(control, 'volume-image.json'))
      await unlink(join(control, 'volume.json'))
      await expect(releasePrivateMacosVolume(control, 'f'.repeat(64))).rejects.toThrow(
        'authentication',
      )
      await recoverPrivateMacosVolume(control, token)
      await releasePrivateMacosVolume(control, token)
      await releasePrivateMacosVolume(control, token)
      await expect(access(control)).rejects.toMatchObject({ code: 'ENOENT' })
      await expect(access(join(root, name))).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  },
  100_000,
)

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
      const captured = privateCaptureAttachments([{ name: 'data', directory: mount, select: [] }])
      try {
        expect(captured.attachments[0]!.files.map((file) => file.path)).toEqual([
          'README',
          'Readme',
        ])
      } finally {
        captured.close()
      }
      const parent = privateOpenFileRoot(root)
      try {
        expect(() => privateReadRegularFile(parent, 'mount/Readme', 32)).toThrow('mount boundary')
      } finally {
        closeSync(parent)
      }

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
      await writeFile(join(root, 'storage.release.pending'), 'interrupted', {
        mode: 0o600,
        flag: 'wx',
      })
      await releasePrivateMacosVolume(control, token)
      await releasePrivateMacosVolume(control, token)
      await expect(access(control)).rejects.toMatchObject({ code: 'ENOENT' })
      await expect(access(join(root, 'storage.release.pending'))).rejects.toMatchObject({
        code: 'ENOENT',
      })
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
