import assert from 'node:assert/strict'
import test from 'node:test'
import {
  displayDestinations,
  recordReferences,
  referenceKey,
  validateDisplaySnapshot,
} from '../dist/index.js'

const snapshot = () => ({
  kind: 'snapshot',
  revision: 1,
  mode: 'live-run',
  rootSourceId: 'root',
  workspace: { target: 'Application', phase: 'live', hostStage: 'Observing', elapsedMs: 0 },
  context: '',
  omissions: { calls: 0, journal: { flow: 0, host: 0, diagnostic: 0 } },
  views: [],
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
    files: [],
  },
})
const view = (instance) => ({
  id: instance,
  sourceId: 'root',
  sourceLabel: 'Application',
  updatedAt: 0,
  value: {
    kind: 'view',
    id: instance,
    title: 'Photos',
    summary: 'All supplied records',
    target: { definitionId: 'photos', instanceKey: instance, subjectKey: instance },
    sections: [
      {
        blocks: [
          {
            kind: 'collection',
            id: 'photos',
            title: 'Photos',
            columns: [
              { key: 'name', label: 'Name', type: 'text' },
              { key: 'image', label: 'Image', type: 'reference' },
            ],
            presentation: { kind: 'gallery', media: 'image', title: 'name', alt: 'name' },
            rows: Array.from({ length: 1000 }, (_, index) => ({
              id: String(index),
              cells: {
                name: `Photo ${index}`,
                image: { kind: 'input-artifact', attachment: 'photos', path: `${index}.jpg` },
              },
              details: [
                { kind: 'report', format: 'plain', text: 'Supplied caption' },
                { kind: 'facts', items: [{ label: 'Index', value: index }] },
              ],
            })),
          },
        ],
      },
    ],
  },
})

test('six whole instance views preserve a thousand detailed records without mutating their input', () => {
  const input = snapshot()
  input.views = Array.from({ length: 6 }, (_, index) => view('album-' + index))
  const retained = validateDisplaySnapshot(input)
  assert.equal(retained.views.length, 6)
  assert.equal(retained.views[5].value.sections[0].blocks[0].rows.length, 1000)
  input.views[0].value.sections[0].blocks[0].rows[0].cells.name = 'Changed'
  assert.equal(retained.views[0].value.sections[0].blocks[0].rows[0].cells.name, 'Photo 0')
  assert(Object.isFrozen(retained.views[0].value.sections[0].blocks[0].rows[0].details))
})

test('input evidence has separate source, identity and capture generation', () => {
  const input = snapshot()
  input.artifacts.files = [
    {
      id: 'output-file',
      path: 'same.png',
      bytes: 4,
      state: 'image',
      clipped: false,
      downloadable: true,
    },
  ]
  input.inputs = {
    generation: 'input-1',
    sourceId: 'root',
    permittedAttachments: ['photos'],
    provenance: 'captured-input',
    phase: 'ready',
    files: [
      {
        id: 'input-file',
        path: 'same.png',
        attachment: 'photos',
        bytes: 4,
        state: 'image',
        clipped: false,
      },
    ],
  }
  const retained = validateDisplaySnapshot(input)
  assert.equal(retained.inputs.provenance, 'captured-input')
  const a = { kind: 'artifact', attachment: 'photos', path: 'same.png' }
  const b = { ...a, kind: 'input-artifact' }
  assert.notEqual(referenceKey(a), referenceKey(b))
  assert.deepEqual(recordReferences({ block: { kind: 'content', reference: b } }), [b])
  input.inputs.files[0].id = 'output-file'
  assert.throws(() => validateDisplaySnapshot(input))
})

test('retained destinations contain application material without invented execution navigation', () => {
  const input = snapshot()
  input.mode = 'retained-views'
  input.workspace.phase = 'settled'
  input.views = [view('family')]
  assert.doesNotThrow(() => validateDisplaySnapshot(input))
  const tabs = displayDestinations(
    'retained-views',
    [{ key: 'family', title: 'Photos', source: 'Retained', sourceId: 'root' }],
    'archive',
  )
  assert.equal(tabs.length, 1)
  assert.equal(tabs[0].group, 'application')
  for (const value of [NaN, Infinity, -Infinity]) {
    const invalid = snapshot()
    invalid.workspace.elapsedMs = value
    assert.throws(() => validateDisplaySnapshot(invalid))
  }
  input.activities = [
    {
      id: 'work',
      sourceId: 'root',
      sourceLabel: 'Retained',
      value: { kind: 'activity', id: 'work', label: 'Not current' },
    },
  ]
  assert.throws(() => validateDisplaySnapshot(input))
})
