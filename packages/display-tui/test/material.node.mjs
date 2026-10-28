import assert from 'node:assert/strict'
import test from 'node:test'
import {
  viewerApplicationParts,
  viewerDetailParts,
  viewerReferences,
} from '../dist/presentation/projection.js'
import { ViewerModel } from '../dist/presentation/viewer-model.js'

const input = { kind: 'input-artifact', attachment: 'files', path: 'same.txt' }
const output = { kind: 'artifact', attachment: 'files', path: 'same.txt' }
const snapshot = () => ({
  kind: 'snapshot',
  revision: 1,
  mode: 'live-run',
  rootSourceId: 'root',
  workspace: { target: 'Read-only report', phase: 'settled', hostStage: 'Complete', elapsedMs: 0 },
  context: 'Application projections remain reported claims.',
  omissions: { calls: 0, journal: { flow: 0, host: 0, diagnostic: 0 } },
  views: [
    {
      id: 'application',
      sourceId: 'root',
      sourceLabel: 'Flow',
      updatedAt: 100,
      value: {
        kind: 'view',
        id: 'report',
        title: 'Report',
        summary: 'Inspect supplied material.',
        landing: true,
        target: { definitionId: 'report', instanceKey: 'family', subjectKey: 'family' },
        sections: [
          {
            blocks: [
              { kind: 'report', text: '  const value = 1\n\n    return value', format: 'code' },
              { kind: 'report', text: '@@ changes\n- before\n+  after', format: 'diff' },
              { kind: 'content', title: 'Captured input', reference: input },
            ],
          },
        ],
      },
    },
  ],
  calls: [],
  activities: [],
  journal: [],
  attention: [],
  artifacts: {
    generation: 'output-1',
    sourceId: 'root',
    permittedAttachments: ['files'],
    provenance: 'verified-delivery',
    phase: 'ready',
    files: [
      {
        id: 'output-file',
        sourceId: 'root',
        attachment: 'files',
        path: 'same.txt',
        bytes: 6,
        state: 'text',
        clipped: false,
      },
    ],
  },
  inputs: {
    generation: 'input-1',
    sourceId: 'root',
    permittedAttachments: ['files'],
    provenance: 'captured-input',
    phase: 'ready',
    files: [
      {
        id: 'input-file',
        sourceId: 'root',
        attachment: 'files',
        path: 'same.txt',
        bytes: 5,
        state: 'text',
        clipped: false,
      },
    ],
  },
})

test('terminal projections preserve literal code/diff and content reference positions', () => {
  const model = new ViewerModel(snapshot())
  const reports = model.records().filter((record) => record.block?.kind === 'report')
  for (const record of reports) {
    const application = viewerApplicationParts(record)
    assert.equal(application[0].kind, 'literal')
    assert.equal(application[0].text, record.block.text)
    const detail = viewerDetailParts(model, record)
    assert.equal(detail[0].kind, 'literal')
    assert.equal(detail[0].text, record.block.text)
    assert.equal(detail[0].format, record.block.format)
  }
  const content = model.records().find((record) => record.block?.kind === 'content')
  assert.equal(content.kind, 'content')
  assert.deepEqual(viewerReferences(content), [input])
  assert.deepEqual(viewerApplicationParts(content), [
    { kind: 'field', label: 'Captured input', value: input },
  ])
  assert.ok(model.destinations()[0].source.includes('family'))
  model.close()
})

test('input and output references with the same path retain exact inventory identities and provenance', async () => {
  const observed = []
  const model = new ViewerModel(snapshot(), {
    preview: async (intent) => {
      observed.push(intent)
      const fromInput = intent.artifactId === 'input-file'
      return {
        ...intent,
        provenance: fromInput ? 'captured-input' : 'verified-delivery',
        state: 'text',
        text: fromInput ? 'input' : 'output',
        bytes: fromInput ? 5 : 6,
        clipped: false,
      }
    },
  })
  assert.equal(model.resolve('root', input).target, 'input-file')
  assert.equal(model.resolve('root', output).target, 'output-file')
  assert.equal(model.resolve('child', input).available, false)
  assert.equal(model.resolve('root', { ...input, attachment: 'other' }).available, false)
  await model.activate('root', input)
  assert.equal(model.preview.text, 'input')
  assert.equal(model.previewProvenance, 'captured-input')
  await model.activate('root', output)
  assert.equal(model.preview.text, 'output')
  assert.equal(model.previewProvenance, 'verified-delivery')
  assert.deepEqual(observed, [
    { artifactId: 'input-file', captureGeneration: 'input-1' },
    { artifactId: 'output-file', captureGeneration: 'output-1' },
  ])
  model.close()
})

test('capture replacement fences a pending input preview completion', async () => {
  let finish
  const model = new ViewerModel(snapshot(), {
    preview: (intent) =>
      new Promise((resolve) => {
        finish = () =>
          resolve({
            ...intent,
            provenance: 'captured-input',
            state: 'text',
            text: 'stale',
            bytes: 5,
            clipped: false,
          })
      }),
  })
  const pending = model.activate('root', input)
  const replacement = snapshot()
  replacement.revision++
  replacement.inputs.generation = 'input-2'
  replacement.inputs.files = []
  model.update(replacement)
  finish()
  await pending
  assert.equal(model.preview, undefined)
  assert.equal(model.resolve('root', input).available, false)
  model.close()
})

test('retained-only presentation creates no execution or activity destinations', () => {
  const value = snapshot()
  value.mode = 'retained-views'
  value.rootSourceId = 'archive'
  const model = new ViewerModel(value)
  assert.deepEqual(
    model.destinations().map((destination) => destination.title),
    ['Report'],
  )
  assert.equal(model.selected.value.target.instanceKey, 'family')
  model.close()
})
