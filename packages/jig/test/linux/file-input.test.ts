import { dirname as suiteDirname } from 'node:path'

const suiteTestRoot = suiteDirname(import.meta.dir)

import { expect, test } from 'bun:test'
import { closeSync, readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  PrivateFileInputError,
  privateCaptureAttachments,
  privateOpenFileRoot,
} from '../../src/internal/file-input.js'
import { requirePrivateCapturedInput } from '../../src/internal/input-capture.js'
import {
  privateDuplicateInputForStdio,
  privateVerifyLinuxSealedFile,
} from '../../src/internal/linux-file-input.js'
import { fixture } from '.././file-input.fixture.js'

test('duplicates sealed inputs above every child stdio destination without changing bytes', async () =>
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
        duplicates.push(
          privateDuplicateInputForStdio(
            requirePrivateCapturedInput(file.input).fd,
            6 + files.length,
          ),
        )
      expect(new Set(duplicates).size).toBe(files.length)
      for (const [index, fd] of duplicates.entries()) {
        const input = requirePrivateCapturedInput(files[index]!.input)
        expect(fd).toBeGreaterThanOrEqual(6 + files.length)
        expect(readFileSync(`/proc/self/fd/${fd}`)).toEqual(
          readFileSync(`/proc/self/fd/${requirePrivateCapturedInput(files[index]!.input).fd}`),
        )
        privateVerifyLinuxSealedFile(fd, input.bytes, input.digest)
        expect(() =>
          privateVerifyLinuxSealedFile(fd, input.bytes, `sha256:${'0'.repeat(64)}`),
        ).toThrow('captured input descriptor changed')
      }
    } finally {
      for (const fd of duplicates) closeSync(fd)
      capture.close()
    }
  }))
test('unsupported filesystems have a closed actionable cause', () => {
  expect(() => privateOpenFileRoot('/proc')).toThrow(PrivateFileInputError)
  expect(() => privateOpenFileRoot('/proc')).toThrow('ext4, XFS, Btrfs, or tmpfs')
})
test('file capture uses NixOS glibc when the FHS loader is a shim', async () =>
  fixture(async (root) => {
    await writeFile(join(root, 'issue.json'), '{"issue":"capture this file"}')
    // A fresh process isolates the fs mock and FFI cache from other tests.
    // The shim has no adjacent libc; actual capture must use the system glibc.
    const program = `
      import { mock } from 'bun:test';
      import * as fs from 'node:fs';
      const resolve = fs.realpathSync;
      const { resolvePrivateLinuxHostLoaderSync } = await import(${JSON.stringify(join(suiteTestRoot, '../src/internal/linux-host-paths.ts'))});
      const loader = resolvePrivateLinuxHostLoaderSync();
      mock.module('node:fs', () => ({ ...fs, realpathSync(path, ...args) {
        if (path === '/run/current-system/sw/share/nix-ld/lib/ld.so') return loader;
        if (path === '/lib64/ld-linux-x86-64.so.2') return '/unavailable-nix-ld/lib/ld-linux-x86-64.so.2';
        return resolve(path, ...args);
      }}));
      const { privateCaptureAttachments } = await import(${JSON.stringify(join(suiteTestRoot, '../src/internal/file-input.ts'))});
      const { requirePrivateCapturedInput } = await import(${JSON.stringify(join(suiteTestRoot, '../src/internal/input-capture.ts'))});
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
  }))

if (process.platform !== 'linux') throw Error('This suite requires Linux')
