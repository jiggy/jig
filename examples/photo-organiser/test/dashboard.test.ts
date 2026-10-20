import { expect, test } from 'bun:test'
import { validateReportingMessage } from '@jigging/reporting'
import { type PhotoBoxState, photoBoxView } from '../flows/organise/view.ts'

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
