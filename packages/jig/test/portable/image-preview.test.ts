import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Worker } from 'node:worker_threads'
import { validDisplayImage } from '@jigging/display-model'
import { createContactSheet } from '../../../../examples/photo-organiser/flows/contact-sheet/rendering.js'
import { privateImagePreview } from '../../src/internal/image-preview.js'
import {
  PRIVATE_PREVIEW_LIMITS,
  privateValidImagePreview,
} from '../../src/internal/image-preview-policy.js'

const svg = (body: string, dimensions = 'width="32" height="16"') =>
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" ${dimensions}>${body}</svg>`)

test('process renderer: captured SVG becomes bounded PNG and raster input is normalised inside the renderer', async () => {
  const image = (await privateImagePreview(
    svg('<rect width="32" height="16" fill="red"/><text x="1" y="12">Hi</text>'),
  ))!
  expect(privateValidImagePreview(image)).toBeTrue()
  expect(image.mime).toBe('image/png')
  expect([image.width, image.height]).toEqual([384, 192])
  const roundTrip = (await privateImagePreview(Buffer.from(image.base64, 'base64')))!
  expect(privateValidImagePreview(roundTrip)).toBeTrue()
  expect([roundTrip.width, roundTrip.height]).toEqual([384, 192])
  expect(
    privateValidImagePreview(
      await privateImagePreview(
        Buffer.from(
          '<!-- chart attribution -->' + svg('<rect width="32" height="16"/>').toString(),
        ),
      ),
    ),
  ).toBeTrue()
})

test('process renderer: photo images render from owned SVG data and external references are refused', async () => {
  const photo = svg('<rect width="32" height="16" fill="green"/>')
  expect(
    privateValidImagePreview(
      await privateImagePreview(
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
    expect(await privateImagePreview(svg(`<image href="${href}"/>`))).toBeUndefined()
})

test('process renderer: a complete contact sheet retains all twelve before-and-after rows', async () => {
  const photos = Array.from({ length: 12 }, (_, index) => ({
    id: `p${index}`,
    file: `photo-${index}.svg`,
    date: '2025-06-14',
    caption: `Photograph ${index}`,
  }))
  const images = new Map(
    photos.map((photo) => [photo.id, svg('<rect width="32" height="16" fill="green"/>')]),
  )
  const renamed = photos.map((photo) => ({
    ...photo,
    event: 'Group',
    destination: `Grouped/${photo.file}`,
  }))
  const image = (await privateImagePreview(
    Buffer.from(createContactSheet(photos, renamed, images)),
  ))!
  expect(privateValidImagePreview(image)).toBeTrue()
  expect([image.width, image.height]).toEqual([384, 579])
  expect(Buffer.from(image.base64, 'base64').length).toBeLessThanOrEqual(65536)
})

test('process renderer: invalid input loses its preview while tall surfaces fit the bounded profile', async () => {
  expect(
    await privateImagePreview(Buffer.alloc(PRIVATE_PREVIEW_LIMITS.sourceBytes + 1)),
  ).toBeUndefined()
  expect(await privateImagePreview(Buffer.from('ordinary text'))).toBeUndefined()
  expect(await privateImagePreview(svg('', 'width="1" height="100000"'))).toBeUndefined()
  const tall = (await privateImagePreview(svg('', 'width="1024" height="4096"')))!
  expect(privateValidImagePreview(tall)).toBeTrue()
  expect([tall.width, tall.height]).toEqual([256, PRIVATE_PREVIEW_LIMITS.height])
  const image = (await privateImagePreview(svg('<rect width="32" height="16"/>')))!
  const bytes = Buffer.from(image.base64, 'base64')
  bytes.writeUInt32BE(100000, 16)
  expect(await privateImagePreview(bytes)).toBeUndefined()
  expect(validDisplayImage({ ...image, mime: 'image/svg+xml' })).toBeFalse()
  expect(
    privateValidImagePreview({ ...image, width: PRIVATE_PREVIEW_LIMITS.width + 1 }),
  ).toBeFalse()
})

test('process renderer: nested image source and decoded raster budgets are aggregate, and refusal does not poison later jobs', async () => {
  const raster = (await privateImagePreview(svg('<rect width="32" height="16" fill="red"/>')))!
  const body = `<image width="32" height="16" href="data:image/png;base64,${raster.base64}"/>`
  expect(privateValidImagePreview(await privateImagePreview(svg(body)))).toBeTrue()
  expect(await privateImagePreview(svg(body.repeat(6)))).toBeUndefined()
  expect(
    await privateImagePreview(svg('<image href="data:image/png;base64,AAAA"/>')),
  ).toBeUndefined()
  const dense = Array.from({ length: 2000 }, (_, index) => `<path d="M0 ${index}h1000"/>`).join('')
  expect(await privateImagePreview(svg(dense, 'width="384" height="1024"'))).toBeUndefined()
  expect(
    privateValidImagePreview(
      await privateImagePreview(svg('<rect width="32" height="16" fill="blue"/>')),
    ),
  ).toBeTrue()
})

test('process renderer: cancelled or concurrent renderer reservations cannot allocate another heap', async () => {
  const abort = new AbortController()
  const pending = privateImagePreview(svg('<rect width="32" height="16"/>'), abort.signal)
  expect(await privateImagePreview(svg('<rect width="32" height="16"/>'))).toBeUndefined()
  abort.abort()
  expect(await pending).toBeUndefined()
  expect(
    privateValidImagePreview(await privateImagePreview(svg('<rect width="32" height="16"/>'))),
  ).toBeTrue()
})

test('production renderer enables bounded image previews', async () => {
  expect(
    privateValidImagePreview(await privateImagePreview(svg('<rect width="32" height="16"/>'))),
  ).toBeTrue()
})

const fixture = fileURLToPath(
  new URL('../fixtures/image-preview-lifetime-worker.ts', import.meta.url),
)
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

test('process renderer: captured photographs retain document detail within bounded PNG output', async () => {
  const source = readFileSync(
    new URL('../../../../examples/photo-organiser/fixtures/photos/walk.jpg', import.meta.url),
  )
  const image = await privateImagePreview(source)
  expect(privateValidImagePreview(image)).toBeTrue()
  expect(image!.width).toBeGreaterThan(384)
  expect(image!.width).toBeLessThanOrEqual(1024)
  expect(Buffer.from(image!.base64, 'base64').length).toBeLessThanOrEqual(
    PRIVATE_PREVIEW_LIMITS.pngBytes,
  )
})
