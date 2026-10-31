import { expect, test } from 'bun:test'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PDFDocument } from 'pdf-lib'
import { createYearbook } from '../flows/yearbook/method.ts'

const source = join(import.meta.dir, '../fixtures/photos')
const photos = JSON.parse(await readFile(join(source, 'photos.json'), 'utf8')) as {
  id: string
  file: string
}[]
const assignments = photos.map((photo, index) => ({
  id: photo.id,
  event: ['A weekend away', 'Around the table', 'Little adventures'][Math.floor(index / 2)]!,
}))

test('yearbook produces a real twelve-page PDF and preserves original photographs and exclusive output', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'photo-yearbook-'))
  const originals = await Promise.all(photos.map((photo) => readFile(join(source, photo.file))))
  const run = {
    input: { title: 'Family moments · 2025', assignments },
    attachments: {
      source: { access: 'read' as const, path: source },
      files: { access: 'read-write' as const, path: folder },
    },
    signal: new AbortController().signal,
  }
  try {
    const result = await createYearbook(run)
    const bytes = await readFile(join(folder, 'yearbook.pdf'))
    expect(result).toMatchObject({
      outcome: 'done',
      output: { count: 6, pages: 12, file: 'yearbook.pdf', bytes: bytes.length },
    })
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(12)
    await expect(createYearbook(run)).rejects.toThrow(/EEXIST/)
    expect(await readFile(join(folder, 'yearbook.pdf'))).toEqual(bytes)
    expect(await Promise.all(photos.map((photo) => readFile(join(source, photo.file))))).toEqual(
      originals,
    )
  } finally {
    await rm(folder, { recursive: true, force: true })
  }
})

test('yearbook rejects an incomplete assignment before producing a file', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'photo-yearbook-invalid-'))
  try {
    await expect(
      createYearbook({
        input: { title: 'Incomplete', assignments: assignments.slice(1) },
        attachments: {
          source: { access: 'read', path: source },
          files: { access: 'read-write', path: folder },
        },
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow()
    expect(await readdir(folder)).toEqual([])
  } finally {
    await rm(folder, { recursive: true, force: true })
  }
})

test('cancelled yearbook preparation creates no file', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'photo-yearbook-abort-'))
  const controller = new AbortController()
  controller.abort()
  try {
    await expect(
      createYearbook({
        input: { title: 'Cancelled', assignments },
        attachments: {
          source: { access: 'read', path: source },
          files: { access: 'read-write', path: folder },
        },
        signal: controller.signal,
      }),
    ).rejects.toThrow()
    expect(await readdir(folder)).toEqual([])
  } finally {
    await rm(folder, { recursive: true, force: true })
  }
})
