import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { Worker } from 'node:worker_threads'
import {
  privateCandidateThreadImagePreview as candidateImagePreview,
  privateImagePreview,
} from '../../src/internal/image-preview.js'
import {
  PRIVATE_PREVIEW_LIMITS,
  privateValidImagePreview,
} from '../../src/internal/image-preview-policy.js'
import { validDisplayImage } from '@jigging/display-model'
import { createContactSheet } from '../../../../examples/photo-organiser/flows/contact-sheet/rendering.js'
import { svg, fixture } from '../image-preview.fixture.js'

test('candidate renderer: captured SVG becomes bounded PNG and raster input is normalised inside the renderer', async () => {
  const image = (await candidateImagePreview(
    svg('<rect width="32" height="16" fill="red"/><text x="1" y="12">Hi</text>'),
  ))!
  expect(privateValidImagePreview(image)).toBeTrue()
  expect(image.mime).toBe('image/png')
  expect([image.width, image.height]).toEqual([384, 192])
  const roundTrip = (await candidateImagePreview(Buffer.from(image.base64, 'base64')))!
  expect(privateValidImagePreview(roundTrip)).toBeTrue()
  expect([roundTrip.width, roundTrip.height]).toEqual([384, 192])
  expect(
    privateValidImagePreview(
      await candidateImagePreview(
        Buffer.from(
          '<!-- chart attribution -->' + svg('<rect width="32" height="16"/>').toString(),
        ),
      ),
    ),
  ).toBeTrue()
})
test('candidate renderer: photo images render from owned SVG data and external references are refused', async () => {
  const photo = readFileSync(
    new URL('../../../../examples/photo-organiser/fixtures/photos/IMG_0201.svg', import.meta.url),
  )
  expect(
    privateValidImagePreview(
      await candidateImagePreview(
        svg(
          `<image width="32" height="16" href="data:image/svg+xml;base64,${photo.toString('base64')}"/>`,
        ),
      ),
    ),
  ).toBeTrue()
  for (const href of [
    'file:///private/operator-data',
    'https://example.com/image.png',
    '../selected.svg',
    '#fragment&amp;escape',
  ])
    expect(await candidateImagePreview(svg(`<image href="${href}"/>`))).toBeUndefined()
})
test('candidate renderer: the complete cookbook contact sheet retains all twelve before-and-after rows', async () => {
  const root = new URL('../../../../examples/photo-organiser/fixtures/photos/', import.meta.url)
  const photos = JSON.parse(readFileSync(new URL('photos.json', root), 'utf8'))
  const images = new Map<string, Buffer>(
    photos.map((photo: { id: string; file: string }) => [
      photo.id,
      readFileSync(new URL(photo.file, root)),
    ]),
  )
  const renamed = photos.map((photo: { file: string }) => ({
    ...photo,
    destination: `Grouped/${photo.file}`,
  }))
  const image = (await candidateImagePreview(
    Buffer.from(createContactSheet(photos, renamed, images)),
  ))!
  expect(privateValidImagePreview(image)).toBeTrue()
  expect([image.width, image.height]).toEqual([384, 579])
  expect(Buffer.from(image.base64, 'base64').length).toBeLessThanOrEqual(65536)
})
test('candidate renderer: oversized input, unsafe fitted surfaces and malformed raster data lose only their preview', async () => {
  expect(
    await candidateImagePreview(Buffer.alloc(PRIVATE_PREVIEW_LIMITS.sourceBytes + 1)),
  ).toBeUndefined()
  expect(await candidateImagePreview(Buffer.from('ordinary text'))).toBeUndefined()
  expect(await candidateImagePreview(svg('', 'width="1" height="100000"'))).toBeUndefined()
  expect(await candidateImagePreview(svg('', 'width="1024" height="4096"'))).toBeUndefined()
  const image = (await candidateImagePreview(svg('<rect width="32" height="16"/>')))!
  const bytes = Buffer.from(image.base64, 'base64')
  bytes.writeUInt32BE(100000, 16)
  expect(await candidateImagePreview(bytes)).toBeUndefined()
  expect(validDisplayImage({ ...image, mime: 'image/svg+xml' })).toBeFalse()
  expect(privateValidImagePreview({ ...image, width: 385 })).toBeFalse()
})
test('candidate renderer: nested image source and decoded raster budgets are aggregate, and refusal does not poison later jobs', async () => {
  const raster = (await candidateImagePreview(svg('<rect width="32" height="16" fill="red"/>')))!
  const body = `<image width="32" height="16" href="data:image/png;base64,${raster.base64}"/>`
  expect(privateValidImagePreview(await candidateImagePreview(svg(body)))).toBeTrue()
  expect(await candidateImagePreview(svg(body.repeat(6)))).toBeUndefined()
  expect(
    await candidateImagePreview(svg('<image href="data:image/png;base64,AAAA"/>')),
  ).toBeUndefined()
  const dense = Array.from({ length: 2000 }, (_, index) => `<path d="M0 ${index}h1000"/>`).join('')
  expect(await candidateImagePreview(svg(dense, 'width="384" height="1024"'))).toBeUndefined()
  expect(
    privateValidImagePreview(
      await candidateImagePreview(svg('<rect width="32" height="16" fill="blue"/>')),
    ),
  ).toBeTrue()
})
test('candidate renderer: cancelled or concurrent renderer reservations cannot allocate another heap', async () => {
  const abort = new AbortController()
  const pending = candidateImagePreview(svg('<rect width="32" height="16"/>'), abort.signal)
  expect(await candidateImagePreview(svg('<rect width="32" height="16"/>'))).toBeUndefined()
  abort.abort()
  expect(await pending).toBeUndefined()
  expect(
    privateValidImagePreview(await candidateImagePreview(svg('<rect width="32" height="16"/>'))),
  ).toBeTrue()
})
test('unqualified production renderer reports unavailable without starting a thread', async () => {
  expect(await privateImagePreview(svg('<rect width="32" height="16"/>'))).toBeUndefined()
})
test('renderer import guards charge before individual and aggregate content allocations', async () => {
  const worker = new Worker(fixture, { workerData: 'allocation', env: {} })
  const exited = new Promise<void>((resolve) => worker.once('exit', () => resolve()))
  try {
    const result = await new Promise<Record<string, boolean | number>>((resolve, reject) => {
      worker.once('message', resolve)
      worker.once('error', reject)
    })
    expect(result).toEqual({
      individualRefused: true,
      aggregateRefused: true,
      textRefused: true,
      copies: 1024 * 1024,
      decodedText: 1024 * 1024,
    })
  } finally {
    await worker.terminate()
    await exited
  }
})
