import { expect, test } from 'bun:test'
import {
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Attachment, JsonValue, RunResult } from '@jigging/flow'
import { createPhotoContactSheet } from '../flows/contact-sheet/method.ts'
import { copyPhotos } from '../flows/copy-photos/method.ts'

type FileMethodRun = {
  input: JsonValue
  attachments: Record<string, Attachment>
  signal: AbortSignal
}
type FixturePhoto = { id: string; file: string; date: string; caption: string }
type CopiedPhoto = FixturePhoto & { event: string; destination: string }
type FileMethodFixture = {
  run: FileMethodRun
  sourceFolder: string
  outputFolder: string
  controller: AbortController
}

const fixtureFolder = join(import.meta.dir, '../fixtures/photos')
const catalogue = (await Bun.file(join(fixtureFolder, 'photos.json')).json()) as FixturePhoto[]
const [firstPhoto, secondPhoto] = catalogue
const lastPhoto = catalogue.at(-1)
if (firstPhoto === undefined || secondPhoto === undefined || lastPhoto === undefined) {
  throw new Error('The photo fixture needs its complete twelve-photo catalogue.')
}

function eventForFixture(photo: FixturePhoto): string {
  if (photo.caption.includes('birthday')) {
    return 'Birthday party'
  }
  if (photo.caption.toLowerCase().includes('mountain')) {
    return 'Mountain walk'
  }
  return 'Lake picnic'
}

const validInput = {
  assignments: catalogue.map((photo) => ({ id: photo.id, event: eventForFixture(photo) })),
}

async function withFileMethodFixture(
  assertion: (fixture: FileMethodFixture) => Promise<void>,
): Promise<void> {
  const temporaryFolder = await mkdtemp(join(tmpdir(), 'photo-file-method-'))
  const sourceFolder = join(temporaryFolder, 'source')
  const outputFolder = join(temporaryFolder, 'output')
  const controller = new AbortController()
  await cp(fixtureFolder, sourceFolder, { recursive: true })
  await mkdir(outputFolder)

  const run: FileMethodRun = {
    input: structuredClone(validInput),
    signal: controller.signal,
    attachments: {
      source: { path: sourceFolder, access: 'read' },
      files: { path: outputFolder, access: 'read-write' },
    },
  }

  try {
    await assertion({ run, sourceFolder, outputFolder, controller })
  } finally {
    await rm(temporaryFolder, { recursive: true, force: true })
  }
}

test('copy-photos independently checks assignments and preserves all original bytes', async () => {
  await withFileMethodFixture(async ({ run, sourceFolder, outputFolder }) => {
    const result = await copyPhotos(run)
    expect(result.outcome).toBe('done')
    const output = result.output as {
      count: number
      photos: CopiedPhoto[]
      manifest: string
    }
    expect(Object.keys(output).sort()).toEqual(['count', 'manifest', 'photos'])
    expect(output.count).toBe(12)
    expect(output.manifest).toBe('manifest.csv')
    expect(output.photos).toHaveLength(12)

    for (const photo of output.photos) {
      const original = await readFile(join(sourceFolder, photo.file))
      expect(await readFile(join(outputFolder, photo.destination))).toEqual(original)
      expect(await readFile(join(fixtureFolder, photo.file))).toEqual(original)
      expect(Object.keys(photo).sort()).toEqual([
        'caption',
        'date',
        'destination',
        'event',
        'file',
        'id',
      ])
    }

    const manifest = await readFile(join(outputFolder, output.manifest), 'utf8')
    const manifestLines = manifest.trimEnd().split('\n')
    expect(manifestLines[0]).toBe('id,original,event,date,copy')
    expect(manifestLines).toHaveLength(13)
    for (const photo of output.photos) {
      expect(manifest).toContain(`"${photo.destination}"`)
    }
    expect(await readdir(outputFolder)).not.toContain('contact-sheet.svg')
  })
})

test('contact-sheet runs without copied files and embeds every original twice', async () => {
  await withFileMethodFixture(async ({ run, sourceFolder, outputFolder }) => {
    const result = await createPhotoContactSheet(run)
    expect(result).toEqual({
      outcome: 'done',
      output: { count: 12, contactSheet: 'contact-sheet.svg' },
    })
    expect(await readdir(outputFolder)).toEqual(['contact-sheet.svg'])

    const sheet = await readFile(join(outputFolder, 'contact-sheet.svg'), 'utf8')
    expect(sheet.match(/<image /g)).toHaveLength(24)
    expect(sheet).toContain('Original order and names')
    expect(sheet).toContain('Grouped copies')
    for (const photo of catalogue) {
      const original = await readFile(join(sourceFolder, photo.file))
      expect(sheet).toContain(original.toString('base64'))
      expect(await readFile(join(fixtureFolder, photo.file))).toEqual(original)
    }
    expect(sheet).not.toMatch(/<script\b|<foreignObject\b|href="https?:/)
  })
})

const methods: Array<{
  name: string
  invoke: (run: FileMethodRun) => Promise<RunResult>
}> = [
  { name: 'copy-photos', invoke: copyPhotos },
  { name: 'contact-sheet', invoke: createPhotoContactSheet },
]

const invalidInputs: Array<{ name: string; input: JsonValue }> = [
  { name: 'missing assignment', input: { assignments: validInput.assignments.slice(1) } },
  {
    name: 'duplicate photo ID',
    input: {
      assignments: validInput.assignments.map(() => ({ id: firstPhoto.id, event: 'Lake picnic' })),
    },
  },
  {
    name: 'unknown photo ID',
    input: {
      assignments: validInput.assignments.map((assignment, index) =>
        index === 0 ? { ...assignment, id: 'unknown' } : assignment,
      ),
    },
  },
  {
    name: 'path in an event label',
    input: {
      assignments: validInput.assignments.map((assignment) => ({
        ...assignment,
        event: '../escape',
      })),
    },
  },
  {
    name: 'event folder collision',
    input: {
      assignments: validInput.assignments.map((assignment, index) => ({
        ...assignment,
        event: index === 0 ? 'Lake picnic' : 'Lake-picnic',
      })),
    },
  },
  {
    name: 'caller-supplied destination',
    input: {
      assignments: validInput.assignments.map((assignment) => ({
        ...assignment,
        destination: 'chosen-by-caller.svg',
      })),
    },
  },
  { name: 'assertion that a plan is checked', input: { ...validInput, checked: true } },
  { name: 'empty assignment list', input: { assignments: [] } },
  { name: 'non-object input', input: null },
]

for (const method of methods) {
  test(`${method.name} accepts one PNG photo at the declared text bounds`, async () => {
    await withFileMethodFixture(async ({ run, sourceFolder, outputFolder }) => {
      const photo = {
        id: 'p'.repeat(32),
        file: `${'image_'}${'x'.repeat(58)}.png`,
        date: '2026-10-11',
        caption: 'c'.repeat(240),
      }
      const event = 'E'.repeat(48)
      const imageBytes = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jp1kAAAAASUVORK5CYII=',
        'base64',
      )
      await writeFile(join(sourceFolder, 'photos.json'), JSON.stringify([photo]))
      await writeFile(join(sourceFolder, photo.file), imageBytes)
      run.input = { assignments: [{ id: photo.id, event }] }

      const result = await method.invoke(run)
      expect(result.outcome).toBe('done')
      expect((result.output as { count: number }).count).toBe(1)
      if (method.name === 'copy-photos') {
        const output = result.output as { photos: CopiedPhoto[] }
        const copiedPhoto = output.photos[0]
        expect(copiedPhoto).toBeDefined()
        if (copiedPhoto === undefined) {
          throw new Error('The independent copy result omitted its only photo.')
        }
        expect(copiedPhoto.destination.length).toBe(145)
        expect(await readFile(join(outputFolder, copiedPhoto.destination))).toEqual(imageBytes)
      } else {
        const sheet = await readFile(join(outputFolder, 'contact-sheet.svg'), 'utf8')
        expect(sheet.match(/<image /g)).toHaveLength(2)
        expect(sheet).toContain(`data:image/png;base64,${imageBytes.toString('base64')}`)
      }
    })
  })

  for (const invalidInput of invalidInputs) {
    test(`${method.name} rejects ${invalidInput.name} before writing`, async () => {
      await withFileMethodFixture(async ({ run, outputFolder }) => {
        run.input = invalidInput.input
        await expect(method.invoke(run)).rejects.toThrow()
        expect(await readdir(outputFolder)).toEqual([])
      })
    })
  }

  for (const malformedPhoto of [
    { name: 'unsafe source filename', change: { file: '../outside.svg' } },
    { name: 'invalid calendar date', change: { date: '2026-02-30' } },
    {
      name: 'duplicate filename ignoring case',
      change: { file: secondPhoto.file.toUpperCase().replace('.SVG', '.svg') },
    },
    { name: 'control characters in a caption', change: { caption: 'unsafe\u0000caption' } },
    { name: 'invalid Unicode in a caption', change: { caption: 'unsafe\ud800caption' } },
  ]) {
    test(`${method.name} rejects ${malformedPhoto.name} independently`, async () => {
      await withFileMethodFixture(async ({ run, sourceFolder, outputFolder }) => {
        const changedCatalogue = catalogue.map((photo, index) =>
          index === 0 ? { ...photo, ...malformedPhoto.change } : photo,
        )
        await writeFile(join(sourceFolder, 'photos.json'), JSON.stringify(changedCatalogue))
        await expect(method.invoke(run)).rejects.toThrow()
        expect(await readdir(outputFolder)).toEqual([])
      })
    })
  }

  test(`${method.name} reads and validates even the last original before writing`, async () => {
    await withFileMethodFixture(async ({ run, sourceFolder, outputFolder }) => {
      await writeFile(join(sourceFolder, lastPhoto.file), '<svg><script>unsafe</script></svg>')
      await expect(method.invoke(run)).rejects.toThrow()
      expect(await readdir(outputFolder)).toEqual([])
    })
  })

  test(`${method.name} rejects a missing original before writing`, async () => {
    await withFileMethodFixture(async ({ run, sourceFolder, outputFolder }) => {
      await unlink(join(sourceFolder, firstPhoto.file))
      await expect(method.invoke(run)).rejects.toThrow()
      expect(await readdir(outputFolder)).toEqual([])
    })
  })

  test(`${method.name} rejects source symlinks before writing`, async () => {
    await withFileMethodFixture(async ({ run, sourceFolder, outputFolder }) => {
      const firstPhotoPath = join(sourceFolder, firstPhoto.file)
      await unlink(firstPhotoPath)
      await symlink(join(fixtureFolder, firstPhoto.file), firstPhotoPath)
      await expect(method.invoke(run)).rejects.toThrow()
      expect(await readdir(outputFolder)).toEqual([])
    })
  })

  test(`${method.name} rejects oversized image and catalogue bytes before writing`, async () => {
    await withFileMethodFixture(async ({ run, sourceFolder, outputFolder }) => {
      await writeFile(join(sourceFolder, firstPhoto.file), Buffer.alloc(256 * 1024 + 1))
      await expect(method.invoke(run)).rejects.toThrow()
      expect(await readdir(outputFolder)).toEqual([])
    })
    await withFileMethodFixture(async ({ run, sourceFolder, outputFolder }) => {
      await writeFile(join(sourceFolder, 'photos.json'), ' '.repeat(8 * 1024 + 1))
      await expect(method.invoke(run)).rejects.toThrow()
      expect(await readdir(outputFolder)).toEqual([])
    })
  })

  test(`${method.name} respects cancellation before source or output work`, async () => {
    await withFileMethodFixture(async ({ run, outputFolder, controller }) => {
      controller.abort()
      await expect(method.invoke(run)).rejects.toThrow()
      expect(await readdir(outputFolder)).toEqual([])
    })
  })

  test(`${method.name} requires the declared read and write attachment modes`, async () => {
    for (const invalidMode of ['source', 'files', 'missing'] as const) {
      await withFileMethodFixture(async ({ run, sourceFolder, outputFolder }) => {
        run.attachments = {
          source: { path: sourceFolder, access: invalidMode === 'source' ? 'read-write' : 'read' },
          files: { path: outputFolder, access: invalidMode === 'files' ? 'read' : 'read-write' },
        }
        if (invalidMode === 'missing') {
          delete run.attachments.files
        }
        await expect(method.invoke(run)).rejects.toThrow('read-only source')
        expect(await readdir(outputFolder)).toEqual([])
      })
    }
  })
}

test('copy-photos refuses a second write instead of replacing any earlier copy', async () => {
  await withFileMethodFixture(async ({ run, outputFolder }) => {
    const result = await copyPhotos(run)
    const photos = (result.output as { photos: CopiedPhoto[] }).photos
    const earlierFiles = new Map<string, Buffer>()
    for (const photo of photos) {
      earlierFiles.set(photo.destination, await readFile(join(outputFolder, photo.destination)))
    }
    earlierFiles.set('manifest.csv', await readFile(join(outputFolder, 'manifest.csv')))

    await expect(copyPhotos(run)).rejects.toThrow()
    for (const [filename, earlierBytes] of earlierFiles) {
      expect(await readFile(join(outputFolder, filename))).toEqual(earlierBytes)
    }
  })
})

test('contact-sheet refuses to replace an existing sheet', async () => {
  await withFileMethodFixture(async ({ run, outputFolder }) => {
    const sentinel = 'keep this existing sheet'
    await writeFile(join(outputFolder, 'contact-sheet.svg'), sentinel)
    await expect(createPhotoContactSheet(run)).rejects.toThrow()
    expect(await readFile(join(outputFolder, 'contact-sheet.svg'), 'utf8')).toBe(sentinel)
    expect(await readdir(outputFolder)).toEqual(['contact-sheet.svg'])
  })
})
