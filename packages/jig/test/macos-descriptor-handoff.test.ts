import { dlopen } from 'bun:ffi'
import { expect, test } from 'bun:test'
import { closeSync, constants, fstatSync, openSync, readSync, writeSync } from 'node:fs'
import { mkdir, mkdtemp, open, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  capturePrivateMacosInput,
  requirePrivateMacosCapturedInput,
} from '../src/internal/macos-captured-input.js'
import { privateMacosOpenAt } from '../src/internal/macos-descriptor-files.js'
import {
  createPrivateMacosDescriptorReceiver,
  type PrivateMacosReceivedDescriptors,
  sendPrivateMacosDescriptors,
} from '../src/internal/macos-descriptor-handoff.js'
import { privateMacosCurrentProcessIdentity } from '../src/internal/macos-process-controls.js'

const native = test.skipIf(
  process.platform !== 'darwin' || process.env.JIG_MACOS_PROCESS_TEST !== '1',
)

native(
  'authenticated native handoff preserves anonymous bytes and renamed directory identity',
  async () => {
    const root = await mkdtemp('/private/tmp/jig-fds-')
    const owner = privateMacosCurrentProcessIdentity()
    let receiver: Awaited<ReturnType<typeof createPrivateMacosDescriptorReceiver>> | undefined
    let captured: ReturnType<typeof capturePrivateMacosInput> | undefined
    let directory: Awaited<ReturnType<typeof open>> | undefined
    let received: PrivateMacosReceivedDescriptors | undefined
    try {
      receiver = await createPrivateMacosDescriptorReceiver(root, 'inputs')
      captured = capturePrivateMacosInput(root, Buffer.from('anonymous input'))
      const source = join(root, 'source'),
        moved = join(root, 'moved')
      await mkdir(source)
      await writeFile(join(source, 'data'), 'original')
      directory = await open(source, constants.O_RDONLY | constants.O_DIRECTORY)
      await rename(source, moved)
      await mkdir(source)
      await writeFile(join(source, 'data'), 'replacement')
      const original = requirePrivateMacosCapturedInput(captured).fd
      const [bundle] = await Promise.all([
        receiver.receive(owner, 2000),
        sendPrivateMacosDescriptors(receiver.path, owner, [original, directory.fd], 2000),
      ])
      received = bundle
      expect(received.descriptors).toHaveLength(2)
      const fd = received.descriptors[0]!,
        directoryFd = received.descriptors[1]!
      const nativeFlags = dlopen('/usr/lib/libSystem.B.dylib', {
        fcntl: { args: ['i32', 'i32', 'i32'], returns: 'i32' },
      })
      try {
        expect(nativeFlags.symbols.fcntl(fd, 1, 0) & 1).toBe(1)
        expect(nativeFlags.symbols.fcntl(directoryFd, 1, 0) & 1).toBe(1)
      } finally {
        nativeFlags.close()
      }
      const bytes = Buffer.alloc(15)
      expect(readSync(fd, bytes, 0, bytes.length, 0)).toBe(15)
      expect(bytes.toString()).toBe('anonymous input')
      expect(fstatSync(fd).nlink).toBe(0)
      expect(() => writeSync(fd, Buffer.from('changed'), 0, 7, 0)).toThrow()
      const opened = await privateMacosOpenAt(directoryFd, 'data', constants.O_RDONLY)
      try {
        expect(await opened.readFile('utf8')).toBe('original')
      } finally {
        await opened.close()
      }
      expect(await readFile(join(source, 'data'), 'utf8')).toBe('replacement')
      received.close()
      received.close()
      expect(() => fstatSync(fd)).toThrow()
      expect(requirePrivateMacosCapturedInput(captured).fd).toBe(original)
      await expect(receiver.receive(owner, 100)).rejects.toThrow('unavailable')
    } finally {
      received?.close()
      captured?.close()
      await directory?.close()
      await receiver?.close()
      expect((await readdir(root)).filter((name) => name.startsWith('fd-'))).toEqual([])
      await rm(root, { recursive: true, force: true })
    }
  },
)

native(
  'native handoff rejects wrong sender and receiver PID versions before accepting authority',
  async () => {
    const root = await mkdtemp('/private/tmp/jig-fds-')
    const actual = privateMacosCurrentProcessIdentity(),
      wrong = { pid: actual.pid, version: actual.version + 1 }
    const input = join(root, 'input')
    await writeFile(input, 'original')
    const fd = openSync(input, constants.O_RDONLY)
    try {
      for (const wrongSender of [true, false]) {
        const receiver = await createPrivateMacosDescriptorReceiver(root, 'inputs')
        try {
          const results = await Promise.allSettled([
            receiver.receive(wrongSender ? wrong : actual, 2000),
            sendPrivateMacosDescriptors(receiver.path, wrongSender ? actual : wrong, [fd], 2000),
          ])
          expect(results.map((result) => result.status)).toEqual(['rejected', 'rejected'])
          const failure = results[wrongSender ? 0 : 1]
          expect(failure?.status === 'rejected' ? failure.reason.message : '').toContain(
            'peer does not match',
          )
          expect(fstatSync(fd).isFile()).toBe(true)
        } finally {
          await receiver.close()
        }
      }
    } finally {
      closeSync(fd)
      await rm(root, { recursive: true, force: true })
    }
  },
)

native(
  'native handoff cancellation, expiry and socket collisions preserve unrelated state',
  async () => {
    const root = await mkdtemp('/private/tmp/jig-fds-'),
      owner = privateMacosCurrentProcessIdentity()
    try {
      const receiver = await createPrivateMacosDescriptorReceiver(root, 'roots')
      try {
        await expect(createPrivateMacosDescriptorReceiver(root, 'roots')).rejects.toThrow()
        expect(await readdir(root)).toEqual(['fd-roots'])
        const controller = new AbortController()
        const pending = receiver.receive(owner, 2000, controller.signal)
        controller.abort()
        await expect(pending).rejects.toThrow()
        await expect(receiver.receive(owner, 20)).rejects.toThrow('timed out')
        const waiting = receiver.receive(owner, 2000)
        await receiver.close()
        await expect(waiting).rejects.toThrow('closed')
      } finally {
        await receiver.close()
      }
      await writeFile(join(root, 'fd-output'), 'unrelated')
      await expect(createPrivateMacosDescriptorReceiver(root, 'output')).rejects.toThrow()
      expect(await readFile(join(root, 'fd-output'), 'utf8')).toBe('unrelated')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  },
)

native(
  'SDK-native sender proves ABI, framing and closure of every rejected descriptor',
  async () => {
    const root = await mkdtemp('/private/tmp/jig-fds-')
    const executable = join(root, 'sender'),
      input = join(root, 'input')
    try {
      const compiled = Bun.spawnSync(
        [
          '/usr/bin/clang',
          '-O2',
          '-Wall',
          '-Wextra',
          '-Werror',
          fileURLToPath(new URL('./fixtures/macos-descriptor-sender.c', import.meta.url)),
          '-o',
          executable,
        ],
        { stdout: 'pipe', stderr: 'pipe', timeout: 20_000 },
      )
      expect({ code: compiled.exitCode, err: compiled.stderr.toString() }).toEqual({
        code: 0,
        err: '',
      })
      await writeFile(input, 'native source')
      const file = await open(input, 'r')
      const identity = await file.stat()
      await file.close()
      const references = () => {
        let count = 0
        for (let fd = 0; fd < 4096; fd++) {
          try {
            const entry = fstatSync(fd)
            if (entry.dev === identity.dev && entry.ino === identity.ino) count++
          } catch {
            /* Closed descriptor. */
          }
        }
        return count
      }
      for (const mode of [
        'valid',
        'split',
        'magic',
        'count',
        'short',
        'trailing',
        'many',
        'writable',
        'stall',
      ]) {
        const receiver = await createPrivateMacosDescriptorReceiver(root, 'output')
        const child = Bun.spawn([executable, receiver.path, mode, input], {
          env: {},
          stdin: 'ignore',
          stdout: 'pipe',
          stderr: 'pipe',
          timeout: 6000,
        })
        const stdout = child.stdout.getReader()
        let bundle: PrivateMacosReceivedDescriptors | undefined
        try {
          const first = await stdout.read()
          const peer = JSON.parse(new TextDecoder().decode(first.value))
          expect(peer.pid).toBe(child.pid)
          if (['valid', 'split'].includes(mode)) {
            bundle = await receiver.receive(peer, 2000)
            expect(bundle.descriptors).toHaveLength(1)
            expect(references()).toBe(1)
            const bytes = Buffer.alloc(13)
            expect(readSync(bundle.descriptors[0]!, bytes, 0, 13, 0)).toBe(13)
            expect(bytes.toString()).toBe('native source')
            bundle.close()
          } else
            await expect(receiver.receive(peer, mode === 'stall' ? 100 : 2000)).rejects.toThrow()
          expect(await child.exited).toBe(0)
          expect(await new Response(child.stderr).text()).toBe('')
          expect(references()).toBe(0)
        } finally {
          bundle?.close()
          if (child.exitCode === null) child.kill('SIGKILL')
          await child.exited
          await stdout.cancel()
          stdout.releaseLock()
          await receiver.close()
        }
      }
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  },
  45_000,
)
