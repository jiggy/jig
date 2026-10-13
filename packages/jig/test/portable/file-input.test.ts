import { expect, test } from 'bun:test'
import { closeSync, fstatSync, readFileSync, readSync, writeSync } from 'node:fs'
import { link, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  PrivateFileInputError,
  privateCaptureAttachments,
  privateOpenFileRoot,
  privatePublishDirectory,
} from '../../src/internal/file-input.js'
import {
  capturePrivateInput,
  readPrivateCapturedInput,
  requirePrivateCapturedInput,
} from '../../src/internal/input-capture.js'
import {
  privateDuplicateInputForStdio,
  privateVerifyLinuxSealedFile,
} from '../../src/internal/linux-file-input.js'
import { fixture } from '.././file-input.fixture.js'

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
