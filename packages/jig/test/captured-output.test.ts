import { expect, test } from 'bun:test'
import { closeSync, writeSync } from 'node:fs'
import { link, mkdir, mkdtemp, realpath, rm, rmdir, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { capturePrivateBytes } from '../src/internal/captured-bytes.js'
import {
  capturePrivateOutput,
  readPrivateCapturedOutput,
  requirePrivateCapturedOutput,
} from '../src/internal/captured-output.js'
import { privateOpenFileRoot } from '../src/internal/file-input.js'
import { capturePrivateInput, requirePrivateCapturedInput } from '../src/internal/input-capture.js'

async function fixture(work: (root: string, fd: number) => Promise<void>) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'jig-output-capture-')))
  const fd = privateOpenFileRoot(root)
  try {
    await work(root, fd)
  } finally {
    closeSync(fd)
    await rm(root, { recursive: true, force: true })
  }
}

test('output capture preserves bytes and empty directory evidence after the source disappears', async () =>
  fixture(async (root, fd) => {
    await mkdir(join(root, 'empty'))
    await mkdir(join(root, 'nested'))
    await writeFile(join(root, 'nested/binary'), Buffer.from([0, 255, 128]))
    await writeFile(join(root, 'zero'), '')
    const captured = capturePrivateOutput(fd)
    try {
      expect(captured.directories).toEqual(['empty', 'nested'])
      expect(
        captured.files.map((file) => ({ path: file.path, offset: file.offset, bytes: file.bytes })),
      ).toEqual([
        { path: 'nested/binary', offset: 0, bytes: 3 },
        { path: 'zero', offset: 3, bytes: 0 },
      ])
      await rm(join(root, 'nested'), { recursive: true })
      await writeFile(join(root, 'zero'), 'changed')
      const files = readPrivateCapturedOutput(captured)
      expect([...files[0]!.contents]).toEqual([0, 255, 128])
      expect(files[1]!.contents.length).toBe(0)
      files[0]!.contents.fill(7)
      expect([...readPrivateCapturedOutput(captured)[0]!.contents]).toEqual([0, 255, 128])
      expect(() =>
        writeSync(requirePrivateCapturedOutput(captured).fd, Buffer.from('bad')),
      ).toThrow()
      expect(() => requirePrivateCapturedOutput({ ...captured })).toThrow('not authentic')
      expect(() => requirePrivateCapturedOutput(JSON.parse(JSON.stringify(captured)))).toThrow(
        'not authentic',
      )
    } finally {
      captured.close()
    }
    expect(() => readPrivateCapturedOutput(captured)).toThrow('not active')
    captured.close()
  }))

test('output and invocation captures have separate authority and byte bounds', async () =>
  fixture(async (root, fd) => {
    const bytes = Buffer.alloc(8 * 1024 * 1024 + 1, 42)
    expect(() => capturePrivateInput(bytes)).toThrow('byte limit')
    const output = capturePrivateBytes(bytes, 'output')
    try {
      expect(() => requirePrivateCapturedInput(output as any)).toThrow('purpose')
    } finally {
      output.close()
    }
    await writeFile(join(root, 'large'), bytes)
    const captured = capturePrivateOutput(fd)
    try {
      expect(readPrivateCapturedOutput(captured)[0]!.contents.equals(bytes)).toBe(true)
    } finally {
      captured.close()
    }
    await writeFile(join(root, 'excess'), Buffer.alloc(8 * 1024 * 1024))
    expect(() => capturePrivateOutput(fd)).toThrow('input budget')
  }))

test('output capture refuses links, protected names, excess entries and cancellation', async () =>
  fixture(async (root, fd) => {
    await writeFile(join(root, 'original'), 'bytes')
    await symlink('original', join(root, 'alias'))
    expect(() => capturePrivateOutput(fd)).toThrow('symbolic link')
    await rm(join(root, 'alias'))
    await link(join(root, 'original'), join(root, 'hard'))
    expect(() => capturePrivateOutput(fd)).toThrow('singly linked')
    await rm(join(root, 'hard'))
    await mkdir(join(root, '.jig'))
    expect(() => capturePrivateOutput(fd)).toThrow('relative path')
    await rmdir(join(root, '.jig'))
    for (let index = 0; index < 65; index++) await writeFile(join(root, `file-${index}`), '')
    expect(() => capturePrivateOutput(fd)).toThrow('finite file profile')
    const cancellation = new AbortController()
    cancellation.abort()
    expect(() => capturePrivateOutput(fd, cancellation.signal)).toThrow()
  }))
