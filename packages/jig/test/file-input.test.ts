import { privateDuplicateInputForStdio, privateVerifyLinuxSealedFile } from '../src/internal/linux-file-input.js'
import { expect, test } from 'bun:test'
import { closeSync, readFileSync, writeSync } from 'node:fs'
import { link, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  PrivateFileInputError,
  privateCaptureAttachments,
  privateOpenFileRoot,
  privatePublishDirectory,
} from '../src/internal/file-input.js'
import {
  capturePrivateInput,
  readPrivateCapturedInput,
  requirePrivateCapturedInput,
} from '../src/internal/input-capture.js'

async function fixture(work: (root: string) => Promise<void>) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'jig-file-input-')))
  try {
    await work(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test('captures selected binary and empty files into sealed anonymous input', async () =>
  fixture(async (root) => {
    await mkdir(join(root, 'source'))
    await writeFile(join(root, 'source', 'bytes'), Buffer.from([0, 255, 128]))
    await writeFile(join(root, 'source', 'empty'), '')
    await symlink('/proc', join(root, 'source', 'unselected'))
    const capture = privateCaptureAttachments([
      { name: 'source', directory: join(root, 'source'), select: ['empty', 'bytes'] },
    ])
    try {
      const files = capture.attachments[0]!.files
      expect(files.map((file) => file.path)).toEqual(['bytes', 'empty'])
      await writeFile(join(root, 'source', 'bytes'), 'edited later')
      expect([...readPrivateCapturedInput(files[0]!.input)]).toEqual([0, 255, 128])
      for (const file of files) requirePrivateCapturedInput(file.input)
      expect(() =>
        writeSync(requirePrivateCapturedInput(files[0]!.input).fd, Buffer.from('changed')),
      ).toThrow()
    } finally {
      capture.close()
    }
  }))

test.skipIf(process.platform !== 'linux')('duplicates sealed inputs above every child stdio destination without changing bytes', async () =>
  fixture(async (root) => {
    for (let index = 0; index < 24; index++)
      await writeFile(join(root, `file-${index}`), `distinct payload ${index}`)
    const capture = privateCaptureAttachments([
      {
        name: 'source',
        directory: root,
        select: Array.from({ length: 24 }, (_, index) => `file-${index}`),
      },
    ])
    const duplicates: number[] = []
    try {
      const files = capture.attachments[0]!.files
      for (const file of files)
        duplicates.push(privateDuplicateInputForStdio(requirePrivateCapturedInput(file.input).fd, 6 + files.length))
      expect(new Set(duplicates).size).toBe(files.length)
      for (const [index, fd] of duplicates.entries()) {
        expect(fd).toBeGreaterThanOrEqual(6 + files.length)
        expect(readFileSync(`/proc/self/fd/${fd}`)).toEqual(
          readFileSync(`/proc/self/fd/${requirePrivateCapturedInput(files[index]!.input).fd}`),
        )
        privateVerifyLinuxSealedFile(fd, files[index]!.bytes, files[index]!.digest)
        expect(() =>
          privateVerifyLinuxSealedFile(fd, files[index]!.bytes, `sha256:${'0'.repeat(64)}`),
        ).toThrow('captured input descriptor changed')
      }
    } finally {
      for (const fd of duplicates) closeSync(fd)
      capture.close()
    }
  }))
test('capture capabilities cannot be reconstructed from copied metadata or reused after closure', () => {
  const capture = capturePrivateInput(Buffer.from('exact bytes'))
  try {
    expect(() => requirePrivateCapturedInput({ ...capture })).toThrow('not active')
    expect(() => requirePrivateCapturedInput(JSON.parse(JSON.stringify(capture)))).toThrow(
      'not active',
    )
    expect(readPrivateCapturedInput(capture).toString()).toBe('exact bytes')
  } finally {
    capture.close()
  }
  expect(() => requirePrivateCapturedInput(capture)).toThrow('not active')
  capture.close()
})

test.skipIf(process.platform !== 'darwin')(
  'Mac capture refuses case variants of private Jig state',
  async () =>
    fixture(async (root) => {
      await mkdir(join(root, '.jig'))
      await writeFile(join(root, '.jig', 'private'), 'authority')
      for (const select of ['.JIG/private', '.JiG/private', '.jig/private'])
        expect(() =>
          privateCaptureAttachments([{ name: 'source', directory: root, select: [select] }]),
        ).toThrow()
      expect(() => privateOpenFileRoot(join(root, '.JIG'))).toThrow('cannot be selected')
    }),
)

test('rejects symlinks, hard links, protected paths, traversal and missing selectors', async () =>
  fixture(async (root) => {
    await writeFile(join(root, 'file'), 'one')
    await symlink('file', join(root, 'symbolic'))
    await link(join(root, 'file'), join(root, 'hard'))
    await mkdir(join(root, '.jig'))
    await writeFile(join(root, '.jig', 'private'), 'authority')
    for (const select of [
      ['symbolic'],
      ['hard'],
      ['file'],
      ['.jig/private'],
      ['../outside'],
      ['missing'],
    ]) {
      expect(() =>
        privateCaptureAttachments([{ name: 'source', directory: root, select }]),
      ).toThrow()
    }
    expect(() =>
      privateCaptureAttachments([{ name: 'source', directory: root, select: [] }]),
    ).toThrow()
  }))

test('captures trees without retaining empty directories and bounds aggregate input', async () =>
  fixture(async (root) => {
    await mkdir(join(root, 'empty'))
    await mkdir(join(root, 'nested'))
    await writeFile(join(root, 'nested', 'one'), '1')
    const capture = privateCaptureAttachments([{ name: 'source', directory: root, select: [] }])
    expect(capture.attachments[0]!.files.map((file) => file.path)).toEqual(['nested/one'])
    capture.close()
    await writeFile(join(root, 'large'), Buffer.alloc(8 * 1024 * 1024))
    expect(() =>
      privateCaptureAttachments([{ name: 'source', directory: root, select: [] }]),
    ).toThrow('remaining')
  }))

test('does not reserve development-environment directory names', async () =>
  fixture(async (root) => {
    await mkdir(join(root, '.agent-sandbox'))
    await writeFile(join(root, '.agent-sandbox', 'selected'), 'operator-selected data')
    const capture = privateCaptureAttachments([
      { name: 'source', directory: root, select: ['.agent-sandbox/selected'] },
    ])
    expect(capture.attachments[0]!.files[0]!.path).toBe('.agent-sandbox/selected')
    capture.close()
  }))

test.skipIf(process.platform !== 'linux')(
  'unsupported filesystems have a closed actionable cause',
  () => {
    expect(() => privateOpenFileRoot('/proc')).toThrow(PrivateFileInputError)
    expect(() => privateOpenFileRoot('/proc')).toThrow('ext4, XFS, Btrfs, or tmpfs')
  },
)

test.skipIf(process.platform !== 'linux')(
  'file capture uses NixOS glibc when the FHS loader is a shim',
  async () =>
    fixture(async (root) => {
      await writeFile(join(root, 'issue.json'), '{"issue":"capture this file"}')
      // A fresh process isolates the fs mock and FFI cache from other tests.
      // The shim has no adjacent libc; actual capture must use the system glibc.
      const program = `
      import { mock } from 'bun:test';
      import * as fs from 'node:fs';
      const resolve = fs.realpathSync;
      const { resolvePrivateLinuxHostLoaderSync } = await import(${JSON.stringify(join(import.meta.dir, '../src/internal/linux-host-paths.ts'))});
      const loader = resolvePrivateLinuxHostLoaderSync();
      mock.module('node:fs', () => ({ ...fs, realpathSync(path, ...args) {
        if (path === '/run/current-system/sw/share/nix-ld/lib/ld.so') return loader;
        if (path === '/lib64/ld-linux-x86-64.so.2') return '/unavailable-nix-ld/lib/ld-linux-x86-64.so.2';
        return resolve(path, ...args);
      }}));
      const { privateCaptureAttachments } = await import(${JSON.stringify(join(import.meta.dir, '../src/internal/file-input.ts'))});
      const { requirePrivateCapturedInput } = await import(${JSON.stringify(join(import.meta.dir, '../src/internal/input-capture.ts'))});
      const capture = privateCaptureAttachments([{name:'source', directory:${JSON.stringify(root)}, select:[]}]);
      try {
        const file = capture.attachments[0].files[0];
        requirePrivateCapturedInput(file.input);
        console.log(file.path);
      } finally { capture.close(); }
    `
      const child = Bun.spawn(
        [process.execPath, '--no-env-file', '--no-install', '--config=/dev/null', '-e', program],
        {
          stdout: 'pipe',
          stderr: 'pipe',
        },
      )
      const [code, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ])
      expect({ code, stdout, stderr }).toEqual({ code: 0, stdout: 'issue.json\n', stderr: '' })
    }),
)

test('attachment diagnostics distinguish missing files and links without exposing paths', async () =>
  fixture(async (root) => {
    await symlink('/private/operator/path', join(root, 'link'))
    for (const [path, reason] of [
      ['missing', 'missing'],
      ['link', 'symlink'],
    ] as const) {
      try {
        privateCaptureAttachments([{ name: 'source', directory: root, select: [path] }])
        throw new Error('capture unexpectedly succeeded')
      } catch (error) {
        expect(error).toBeInstanceOf(PrivateFileInputError)
        expect((error as PrivateFileInputError).reason).toBe(reason)
        expect((error as Error).message).not.toContain(root)
        expect((error as Error).message).not.toContain('/private/operator/path')
      }
    }
  }))

test('publishes a directory atomically without replacing a racing destination', async () =>
  fixture(async (root) => {
    const parent = privateOpenFileRoot(root)
    try {
      await mkdir(join(root, 'stage'))
      await writeFile(join(root, 'stage', 'result.json'), '{}')
      await mkdir(join(root, 'occupied'))
      await writeFile(join(root, 'occupied', 'keep'), 'untouched')
      expect(() => privatePublishDirectory(parent, 'stage', 'occupied')).toThrow()
      expect(await readFile(join(root, 'occupied', 'keep'), 'utf8')).toBe('untouched')
      privatePublishDirectory(parent, 'stage', 'review')
      expect(await readFile(join(root, 'review', 'result.json'), 'utf8')).toBe('{}')
    } finally {
      closeSync(parent)
    }
  }))
