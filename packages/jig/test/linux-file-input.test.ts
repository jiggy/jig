import { expect, test } from 'bun:test'
import { closeSync, readFileSync } from 'node:fs'
import { link, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  PrivateFileInputError,
  privateCaptureAttachments,
  privateOpenFileRoot,
  privatePublishDirectory,
  privateVerifySealedFile,
} from '../src/internal/linux-file-input.js'

async function fixture(work: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'jig-file-input-'))
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
      expect([...readFileSync(`/proc/self/fd/${files[0]!.fd}`)]).toEqual([0, 255, 128])
      for (const file of files) privateVerifySealedFile(file.fd, file.bytes, file.digest)
      await expect(writeFile(`/proc/self/fd/${files[0]!.fd}`, 'changed')).rejects.toThrow()
    } finally {
      capture.close()
    }
  }))

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

test('unsupported filesystems have a closed actionable cause', () => {
  expect(() => privateOpenFileRoot('/proc')).toThrow(PrivateFileInputError)
  expect(() => privateOpenFileRoot('/proc')).toThrow('ext4, XFS, Btrfs, or tmpfs')
})

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
