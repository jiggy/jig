import { expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assertResponseSchema, prepareAgent } from '@jigging/agent-method'
import { validateReportingMessage } from '@jigging/reporting'
import { contactSheetView } from '../flows/contact-sheet/view.ts'
import { copiesView } from '../flows/copy-photos/view.ts'
import responseSchema from '../flows/group/proposal.schema.json'
import { groupingView } from '../flows/group/view.ts'
import { capturePhotos, readCatalogue } from '../flows/organise/catalogue.ts'
import {
  checkContactSheetOutput,
  checkCopiedPhotos,
  checkProposal,
} from '../flows/organise/plan.ts'
import { photoBoxView } from '../flows/organise/view.ts'

const fixtureFolder = join(import.meta.dir, '../fixtures/photos')
const catalogue = readCatalogue(await Bun.file(join(fixtureFolder, 'photos.json')).json())

function fixtureEvent(caption: string): string {
  if (caption.includes('birthday')) {
    return 'Birthday party'
  }
  if (caption.toLowerCase().includes('mountain')) {
    return 'Mountain walk'
  }
  return 'Lake picnic'
}

// Ordinary proposal data exercises application acceptance, not an Agent reply.
const proposal = {
  assignments: catalogue.map((photo) => ({ id: photo.id, event: fixtureEvent(photo.caption) })),
}
const plan = checkProposal(catalogue, proposal)
const deliveredPlan = plan.map((photo) => ({
  ...photo,
  destination: `copies/${photo.destination}`,
}))
const firstAssignment = proposal.assignments[0]
const secondPhoto = catalogue[1]
if (firstAssignment === undefined || secondPhoto === undefined) {
  throw new Error('The fixture needs at least two photos and their assignments.')
}

test('all photo Flows carry the exact licensed public reporting contract', async () => {
  const descriptor = await readFile(
    new URL(import.meta.resolve('@jigging/reporting/reporting.json')),
  )
  const license = await readFile(new URL(import.meta.resolve('@jigging/reporting/LICENSE')))
  for (const flow of ['organise', 'group', 'copy-photos', 'contact-sheet']) {
    const folder = join(import.meta.dir, '..', 'flows', flow, 'contracts', 'reporting')
    expect(await readFile(join(folder, 'reporting.json'))).toEqual(descriptor)
    expect(await readFile(join(folder, 'LICENSE'))).toEqual(license)
  }
})

test('the accepted plan accounts for every original with deterministic safe destinations', () => {
  expect(plan).toHaveLength(12)
  expect(new Set(plan.map((photo) => photo.id))).toEqual(
    new Set(catalogue.map((photo) => photo.id)),
  )
  for (const photo of plan) {
    const eventFolder = photo.event.toLowerCase().replaceAll(' ', '-')
    expect(photo.destination).toBe(`${eventFolder}/${photo.date}_${eventFolder}_${photo.id}.svg`)
  }
  expect(checkProposal(catalogue, { assignments: [...proposal.assignments].reverse() })).toEqual(
    plan,
  )
})

for (const [name, invalidProposal] of [
  ['duplicate IDs', { assignments: proposal.assignments.map(() => firstAssignment) }],
  ['missing photo', { assignments: proposal.assignments.slice(1) }],
  [
    'unknown ID',
    {
      assignments: proposal.assignments.map((photo, index) =>
        index === 0 ? { ...photo, id: 'unknown' } : photo,
      ),
    },
  ],
  [
    'path injection',
    {
      assignments: proposal.assignments.map((photo) => ({ ...photo, event: '../escape' })),
    },
  ],
  [
    'normalization collision',
    {
      assignments: proposal.assignments.map((photo, index) => ({
        ...photo,
        event: index === 0 ? 'Lake picnic' : 'Lake-picnic',
      })),
    },
  ],
  ['unexpected fields', { ...proposal, command: 'delete' }],
] as const) {
  test(`proposal acceptance rejects ${name}`, () => {
    expect(() => checkProposal(catalogue, invalidProposal)).toThrow()
  })
}

test('copy metadata acceptance permits reordering without changing the plan', () => {
  const before = structuredClone(plan)
  checkCopiedPhotos(plan, { count: 12, photos: [...plan].reverse(), manifest: 'manifest.csv' })
  expect(plan).toEqual(before)
})

for (const [name, output] of [
  ['incomplete count', { count: 11, photos: plan, manifest: 'manifest.csv' }],
  ['missing photo', { count: 12, photos: plan.slice(1), manifest: 'manifest.csv' }],
  [
    'changed destination',
    {
      count: 12,
      photos: plan.map((photo, index) =>
        index === 0 ? { ...photo, destination: 'unreviewed/image.svg' } : photo,
      ),
      manifest: 'manifest.csv',
    },
  ],
  ['duplicate identity', { count: 12, photos: plan.map(() => plan[0]), manifest: 'manifest.csv' }],
  ['changed manifest', { count: 12, photos: plan, manifest: '../manifest.csv' }],
  ['extra field', { count: 12, photos: plan, manifest: 'manifest.csv', checked: true }],
] as const) {
  test(`copy metadata acceptance rejects ${name}`, () => {
    expect(() => checkCopiedPhotos(plan, output)).toThrow()
  })
}

test('contact sheet metadata acceptance requires the complete count and exact relative path', () => {
  checkContactSheetOutput(12, { count: 12, contactSheet: 'contact-sheet.svg' })
  for (const output of [
    { count: 11, contactSheet: 'contact-sheet.svg' },
    { count: 12, contactSheet: '../unreviewed.svg' },
    { count: 12, contactSheet: 'contact-sheet.svg', checked: true },
  ]) {
    expect(() => checkContactSheetOutput(12, output)).toThrow()
  }
})

test('refuses unsafe paths, duplicate source identities and invalid dates', () => {
  for (const change of [{ file: '../image.svg' }, { date: '2026-02-30' }, { id: secondPhoto.id }]) {
    expect(() =>
      readCatalogue(
        catalogue.map((photo, index) => (index === 0 ? { ...photo, ...change } : photo)),
      ),
    ).toThrow()
  }
})

test('source capture reads all real fixture bytes', async () => {
  const captured = await capturePhotos(fixtureFolder, new AbortController().signal)
  expect(captured.photos).toEqual(catalogue)
  for (const photo of catalogue) {
    expect(captured.images.get(photo.id)).toEqual(await readFile(join(fixtureFolder, photo.file)))
  }
})

test('source capture rejects a catalogue whose original is missing', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'photo-missing-'))
  try {
    await writeFile(join(folder, 'photos.json'), JSON.stringify(catalogue))
    await expect(capturePhotos(folder, new AbortController().signal)).rejects.toThrow()
  } finally {
    await rm(folder, { recursive: true, force: true })
  }
})

test('all four pure view projections satisfy the public reporting schema', () => {
  for (const snapshot of [
    photoBoxView({ phase: 'reading' }),
    photoBoxView({ phase: 'ready', photos: catalogue, plan: deliveredPlan }),
    groupingView(12),
    groupingView(12, true),
    copiesView(),
    copiesView(plan, true),
    contactSheetView(),
    contactSheetView(12, true),
  ]) {
    validateReportingMessage({ kind: 'view', id: 'photos', title: 'Photos', ...snapshot })
  }
  const completed = photoBoxView({ phase: 'ready', photos: catalogue, plan: deliveredPlan })
  expect(completed.sections[0]?.blocks[0]).toMatchObject({
    references: [
      { kind: 'artifact', attachment: 'overview', path: 'contact-sheet.svg' },
      { kind: 'artifact', attachment: 'copies', path: 'manifest.csv' },
    ],
  })
  for (const photo of plan) {
    expect(JSON.stringify(completed)).toContain(
      JSON.stringify({ kind: 'artifact', attachment: 'copies', path: photo.destination }),
    )
  }
})

test('the private response schema passes the public Agent preparation validator', () => {
  assertResponseSchema(responseSchema)
  const task = prepareAgent({ instructions: 'Group captions by event.', responseSchema })
  expect(task.request.responseSchema).toEqual(responseSchema)
})

test('the ACP regression check rejects unsupported response schemas', () => {
  const original = structuredClone(responseSchema) as Record<string, unknown>
  delete original.$schema
  expect(() => assertResponseSchema(original as typeof responseSchema)).toThrow(
    'bounded structured-output profile',
  )
  const unsupported = structuredClone(responseSchema)
  Object.assign(unsupported.properties.assignments.items.properties.event, { maxLength: 48 })
  expect(() => assertResponseSchema(unsupported)).toThrow('bounded structured-output profile')
})

test('all twelve fixtures differ visually beyond their ID labels', async () => {
  const scenes = await Promise.all(
    catalogue.map(async (photo) =>
      (await readFile(join(fixtureFolder, photo.file), 'utf8')).replace(
        /<text[^>]*>.*?<\/text>/g,
        '',
      ),
    ),
  )
  expect(new Set(scenes).size).toBe(12)
})
