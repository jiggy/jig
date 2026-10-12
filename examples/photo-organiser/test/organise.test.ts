import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assertResponseSchema, prepareAgent } from '@jigging/agent-method'
import type { Attachment, JsonValue, RunContext } from '@jigging/flow'
import { REPORTING_CONTRACT, validateReportingMessage } from '@jigging/reporting'
import { organisePhotos } from '../flows/organise/method.ts'
import { readCatalogue } from '../flows/organise/catalogue.ts'
import { checkProposal, type RenamedPhoto } from '../flows/organise/plan.ts'
import { photosView } from '../flows/organise/view.ts'
import { groupPhotos } from '../flows/group/method.ts'
import responseSchema from '../flows/group/proposal.schema.json'

type TestOrganiserRun = {
  input: JsonValue
  signal: AbortSignal
  attachments: Record<string, Attachment>
  call: RunContext['call']
}

const catalogue = readCatalogue(
  await Bun.file(join(import.meta.dir, '../fixtures/photos/photos.json')).json(),
)

test('all photo Flows carry the exact licensed public reporting contract', async () => {
  const descriptor = await readFile(new URL(import.meta.resolve('@jigging/reporting/reporting.json')))
  const license = await readFile(new URL(import.meta.resolve('@jigging/reporting/LICENSE')))

  for (const flow of ['organise', 'group', 'copy-photos', 'contact-sheet']) {
    const contractFolder = join(import.meta.dir, '..', 'flows', flow, 'contracts', 'reporting')
    expect(await readFile(join(contractFolder, 'reporting.json'))).toEqual(descriptor)
    expect(await readFile(join(contractFolder, 'LICENSE'))).toEqual(license)
  }
})

function fixtureEvent(caption: string): string {
  if (caption.includes('birthday')) {
    return 'Birthday party'
  }
  if (caption.toLowerCase().includes('mountain')) {
    return 'Mountain walk'
  }
  return 'Lake picnic'
}

const proposal = {
  assignments: catalogue.map((photo) => ({ id: photo.id, event: fixtureEvent(photo.caption) })),
}
async function withRun(assertion: (run: TestOrganiserRun, outputFolder: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'photo-organiser-'))
  const outputFolder = join(root, 'output')
  await mkdir(outputFolder)
  const run: TestOrganiserRun = {
    input: {},
    signal: new AbortController().signal,
    attachments: {
      source: { path: join(import.meta.dir, '../fixtures/photos'), access: 'read' },
      photos: { path: outputFolder, access: 'read-write' },
    },
    call: async (request) => {
      expect(request.slot).toBe('group')
      return groupPhotos({
        input: request.input,
        signal: new AbortController().signal,
        call: async () => ({
          outcome: 'done',
          output: { structured: proposal },
        }),
      })
    },
  }
  try {
    await assertion(run, outputFolder)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}
test('checked copies preserve original bytes, group files and deliver a visible before/after sheet', async () =>
  withRun(async (run, outputFolder) => {
    const result = await organisePhotos(run)
    expect(result.outcome).toBe('done')
    const rows = (result.output as { photos: RenamedPhoto[] }).photos
    expect(rows).toHaveLength(12)
    for (const photo of rows) {
      expect(await readFile(join(outputFolder, photo.destination))).toEqual(
        await readFile(join(run.attachments.source!.path, photo.file)),
      )
    }
    expect(await readFile(join(outputFolder, 'manifest.csv'), 'utf8')).toContain(
      'id,original,event,date,copy',
    )
    const sheet = await readFile(join(outputFolder, 'contact-sheet.svg'), 'utf8')
    expect(sheet.match(/<image /g)).toHaveLength(24)
    expect(sheet).toContain('Original order and names')
    expect(sheet).toContain('Grouped copies')
  }))
for (const [name, invalidProposal] of [
  ['duplicate IDs', { assignments: proposal.assignments.map(() => proposal.assignments[0]!) }],
  ['missing photo', { assignments: proposal.assignments.slice(1) }],
  [
    'unknown ID',
    {
      assignments: proposal.assignments.map((photo, photoIndex) =>
        photoIndex === 0 ? { ...photo, id: 'unknown' } : photo,
      ),
    },
  ],
  [
    'path injection',
    { assignments: proposal.assignments.map((photo) => ({ ...photo, event: '../escape' })) },
  ],
  [
    'normalization collision',
    {
      assignments: proposal.assignments.map((photo, photoIndex) => ({
        ...photo,
        event: photoIndex === 0 ? 'Lake picnic' : 'Lake-picnic',
      })),
    },
  ],
  ['unexpected fields', { ...proposal, command: 'delete' }],
] as const) {
  test(`rejects ${name} before writing any output`, async () =>
    withRun(async (run, outputFolder) => {
      run.call = async () => ({
        outcome: 'done',
        output: invalidProposal,
      })
      await expect(organisePhotos(run)).rejects.toThrow()
      expect(await readdir(outputFolder)).toEqual([])
    }))
}
for (const outcome of ['blocked', 'limit', 'error', 'cancel'] as const) {
  test(`preserves ${outcome} without replay or files`, async () =>
    withRun(async (run, outputFolder) => {
      let calls = 0
      const controller = new AbortController()
      run.signal = controller.signal
      run.call = async () => {
        calls++
        if (outcome === 'error') {
          throw Error('uncertain dispatch')
        }
        if (outcome === 'cancel') {
          controller.abort()
          return { outcome: 'done', output: proposal }
        }
        return { outcome, output: { reason: 'cannot proceed' } }
      }
      if (outcome === 'error' || outcome === 'cancel') {
        await expect(organisePhotos(run)).rejects.toThrow()
      } else {
        expect((await organisePhotos(run)).outcome).toBe(outcome)
      }
      expect(calls).toBe(1)
      expect(await readdir(outputFolder)).toEqual([])
    }))
}
test('refuses unsafe paths, duplicate source identities and invalid dates', () => {
  for (const change of [
    { file: '../image.svg' },
    { date: '2026-02-30' },
    { id: catalogue[1]!.id },
  ]) {
    expect(() =>
      readCatalogue(
        catalogue.map((photo, photoIndex) => (photoIndex === 0 ? { ...photo, ...change } : photo)),
      ),
    ).toThrow()
  }
})
test('missing source photo fails before paid work', async () =>
  withRun(async (run, outputFolder) => {
    const root = await mkdtemp(join(tmpdir(), 'photo-missing-'))
    try {
      await writeFile(join(root, 'photos.json'), JSON.stringify(catalogue))
      run.attachments.source = { path: root, access: 'read' }
      let calls = 0
      run.call = async () => {
        calls++
        throw Error('unexpected')
      }
      await expect(organisePhotos(run)).rejects.toThrow()
      expect(calls).toBe(0)
      expect(await readdir(outputFolder)).toEqual([])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }))
test('both Flow views satisfy the exact public channel contract', async () => {
  const { withReporting } = await import('@jigging/reporting')
  const writes: unknown[] = []
  // Each invoked Flow owns a distinct publisher and its own landing view.
  for (const grouping of [false, true]) {
    await withReporting(
      {
        signal: new AbortController().signal,
        channels: {
          progress: {
            direction: 'send',
            contract: REPORTING_CONTRACT,
            delivery: 'broadcast',
            send: async (update: unknown) => {
              writes.push(update)
            },
            close: async () => {},
          },
        },
      },
      'progress',
      async (updates) => {
        if (grouping) {
          await groupPhotos(
            {
              input: { photos: catalogue.map(({ id, date, caption }) => ({ id, date, caption })) },
              signal: new AbortController().signal,
              call: async () => ({
                outcome: 'done',
                output: { structured: proposal },
              }),
            },
            updates,
          )
        } else {
          updates
            .view('photos', { title: 'Photo box', landing: true })
            .update(photosView(checkProposal(catalogue, proposal), true))
        }
      },
    )
  }
  expect(writes.length).toBeGreaterThan(0)
  for (const item of writes) {
    validateReportingMessage(item)
  }
})

test('the emitted request passes the actual ACP Agent preparation and schema profile', async () =>
  withRun(async (run) => {
    assertResponseSchema(responseSchema)
    let prepared = false
    run.call = async (request) => {
      expect(request.slot).toBe('group')
      expect(JSON.stringify(request.input)).not.toContain('.svg')
      return groupPhotos({
        input: request.input,
        signal: run.signal,
        call: async (agentRequest) => {
          expect(agentRequest.slot).toBe('agent')
          const task = prepareAgent(agentRequest.input)
          expect(task.request.responseSchema).toEqual(responseSchema)
          prepared = true
          return { outcome: 'done', output: { structured: proposal } }
        },
      })
    }
    expect((await organisePhotos(run)).outcome).toBe('done')
    expect(prepared).toBe(true)
  }))

test('the ACP regression check rejects the originally shipped schema', () => {
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
      (await readFile(join(import.meta.dir, '../fixtures/photos', photo.file), 'utf8')).replace(
        /<text[^>]*>.*?<\/text>/g,
        '',
      ),
    ),
  )
  expect(new Set(scenes).size).toBe(12)
})

for (const outcome of ['blocked', 'limit', 'cancel', 'error'] as const) {
  test(`grouping preserves Agent ${outcome} without retry`, async () => {
    const controller = new AbortController()
    let calls = 0
    const run = {
      input: { photos: catalogue.map(({ id, date, caption }) => ({ id, date, caption })) },
      signal: controller.signal,
      call: async () => {
        calls++
        if (outcome === 'error') {
          throw Error('uncertain Agent dispatch')
        }
        if (outcome === 'cancel') {
          controller.abort()
          return { outcome: 'done', output: { structured: proposal } }
        }
        return { outcome, output: { text: 'cannot proceed' } }
      },
    }
    if (outcome === 'error' || outcome === 'cancel') {
      await expect(groupPhotos(run)).rejects.toThrow()
    } else {
      expect(await groupPhotos(run)).toEqual({ outcome, output: { reason: 'cannot proceed' } })
    }
    expect(calls).toBe(1)
  })
}
