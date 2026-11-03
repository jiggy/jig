import { expect, test } from 'bun:test'
import { validateReportingMessage } from '@jigging/reporting'
import {
  type PhotoBoxState,
  photoAlbumKey,
  photoBoxView,
  photoContactSheetView,
  photoGalleryView,
  photoViewOptions,
} from '../flows/organise/view.ts'

const photo = {
  id: 'p01',
  file: 'photo.png',
  date: '2026-06-14',
  caption: 'Picnic beside the lake',
}
const planned = {
  ...photo,
  event: 'Lake picnic',
  destination: 'copies/lake-picnic/2026-06-14-p01.png',
}

function checked(state: PhotoBoxState) {
  const view = photoBoxView(state)
  const item = validateReportingMessage({ kind: 'view', id: 'photos', title: 'Photo box', ...view })
  expect(Buffer.byteLength(JSON.stringify(item))).toBeLessThanOrEqual(32768)
  return view
}

test('the photo page follows work and leads with the visual result only after completion', () => {
  const reading = checked({ phase: 'reading' })
  expect(reading.sections).toHaveLength(1)
  const grouping = checked({ phase: 'grouping', photos: [photo] })
  expect(JSON.stringify(grouping)).toContain('photo.png')
  expect(JSON.stringify(grouping)).not.toContain('Lake picnic')
  const copying = checked({ phase: 'copying', photos: [photo], plan: [planned] })
  expect(JSON.stringify(copying)).toContain('Lake picnic')
  expect(JSON.stringify(copying)).not.toContain('"kind":"artifact"')
  const ready = checked({ phase: 'ready', photos: [photo], plan: [planned] })
  expect(ready.sections[0]?.title).toBe('Before and after')
  expect(ready.sections[0]?.blocks[0]).toMatchObject({
    references: [
      { kind: 'artifact', attachment: 'overview', path: 'contact-sheet.svg' },
      { kind: 'artifact', attachment: 'copies', path: 'manifest.csv' },
    ],
  })
  expect(JSON.stringify(ready)).toContain(planned.destination)
  expect(JSON.stringify(ready)).toContain('"path":"lake-picnic/2026-06-14-p01.png"')
})

test('a later file failure retains the checked plan without declaring a finished collection', () => {
  const failed = checked({
    phase: 'failed',
    photos: [photo],
    plan: [planned],
    reason: 'Contact sheet failed; output is unconfirmed.',
  })
  expect(JSON.stringify(failed)).toContain('Contact sheet failed')
  expect(JSON.stringify(failed)).toContain('No complete collection confirmed')
  expect(JSON.stringify(failed)).not.toContain('"kind":"artifact"')
})

test('captured originals appear before grouping and contact-sheet output remains provisional', () => {
  const state: PhotoBoxState = { phase: 'grouping', photos: [photo] }
  const gallery = photoGalleryView(state)
  const accepted = validateReportingMessage({
    kind: 'view',
    id: 'photos',
    ...photoViewOptions('family').photos,
    ...gallery,
  })
  expect(accepted.kind).toBe('view')
  expect(gallery.sections[0]?.blocks[0]).toMatchObject({
    presentation: {
      kind: 'gallery',
      media: 'image',
      title: 'caption',
      alt: 'caption',
      description: 'date',
    },
    rows: [
      {
        id: photo.id,
        cells: { image: { kind: 'input-artifact', attachment: 'source', path: photo.file } },
      },
    ],
  })
  const pending = photoContactSheetView(state)
  expect(JSON.stringify(pending)).not.toContain('"kind":"artifact"')
  const ready = photoContactSheetView({ phase: 'ready', photos: [photo], plan: [planned] })
  validateReportingMessage({
    kind: 'view',
    id: 'sheet',
    ...photoViewOptions('family').contactSheet,
    ...ready,
  })
  expect(ready.sections[0]?.blocks[0]).toMatchObject({
    kind: 'content',
    reference: { kind: 'artifact', attachment: 'overview', path: 'contact-sheet.svg' },
  })
})

test('two catalogues produce six independently identified application views', () => {
  const first = photoAlbumKey([photo])
  const second = photoAlbumKey([{ ...photo, caption: 'Another collection' }])
  expect(first).toBe(photoAlbumKey([{ ...photo }]))
  expect(first).not.toBe(second)
  const targets = [first, second].flatMap((key) =>
    Object.values(photoViewOptions(key)).map((options) => options.target),
  )
  expect(
    new Set(targets.map((target) => JSON.stringify([target?.definitionId, target?.instanceKey])))
      .size,
  ).toBe(6)
  for (const key of [first, second]) {
    const options = photoViewOptions(key)
    expect(
      Object.values(options).every(
        (item) => item.target?.instanceKey === key && item.target.subjectKey === key,
      ),
    ).toBe(true)
    expect(Object.values(options).filter((item) => item.landing)).toHaveLength(1)
  }
})
