import { expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { privateRawDirectory } from '../src/internal/raw-directory.js'

test('directory enumeration retains invalid UTF-8 bytes and identifies files, directories and links', () => {
  const root = mkdtempSync(join(tmpdir(), 'jig-raw-directory-'))
  try {
    writeFileSync(join(root, 'file'), 'bytes')
    mkdirSync(join(root, 'directory'))
    symlinkSync('file', join(root, 'link'))
    const invalid = Buffer.from([0xff, 0xfe])
    if (process.platform === 'linux')
      writeFileSync(Buffer.concat([Buffer.from(`${root}/`), invalid]), '')
    const directory = privateRawDirectory(root)
    const entries = []
    try {
      for (;;) {
        const entry = directory.readSync()
        if (entry === null) break
        entries.push(entry)
      }
    } finally {
      directory.closeSync()
    }
    expect(entries).toHaveLength(process.platform === 'linux' ? 4 : 3)
    expect(entries.find((entry) => entry.name.equals(Buffer.from('file')))?.isFile()).toBe(true)
    expect(
      entries.find((entry) => entry.name.equals(Buffer.from('directory')))?.isDirectory(),
    ).toBe(true)
    expect(entries.find((entry) => entry.name.equals(Buffer.from('link')))?.isSymbolicLink()).toBe(
      true,
    )
    if (process.platform === 'linux') {
      const raw = entries.find((entry) => entry.name.equals(invalid))!
      expect(raw.isFile()).toBe(true)
      expect(() => new TextDecoder('utf-8', { fatal: true }).decode(raw.name)).toThrow()
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
