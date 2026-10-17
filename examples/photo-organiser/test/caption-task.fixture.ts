import assert from 'node:assert/strict'
import { handle } from '@jigging/flow'

// A real finite task implementation, deliberately limited to these labelled
// synthetic scenes. This is not a model-quality or native Agent qualification.
await handle(async (run) => {
  assert.deepEqual(Object.keys(run.attachments), [])
  const input = run.input as { instructions: string; responseSchema: unknown }
  assert.equal(typeof input.instructions, 'string')
  assert.ok(input.responseSchema)
  const marker = '\n\nPhoto captions:\n'
  const start = input.instructions.indexOf(marker)
  assert.ok(start >= 0, 'The grouping task needs its caption catalogue')
  const captions: unknown = JSON.parse(input.instructions.slice(start + marker.length))
  assert.ok(Array.isArray(captions) && captions.length > 0 && captions.length <= 12)
  const assignments = captions.map((photo) => {
    run.signal.throwIfAborted()
    assert.deepEqual(Object.keys(photo).sort(), ['caption', 'date', 'id'])
    assert.equal(typeof photo.id, 'string')
    assert.equal(typeof photo.date, 'string')
    assert.equal(typeof photo.caption, 'string')
    const caption = photo.caption.toLowerCase()
    let event: string
    if (caption.includes('birthday')) {
      event = 'Birthday party'
    } else if (caption.includes('mountain')) {
      event = 'Mountain walk'
    } else {
      assert.ok(caption.includes('lake') || caption.includes('picnic'))
      event = 'Lake picnic'
    }
    return { id: photo.id, event }
  })
  return {
    outcome: 'done',
    output: {
      text: 'Grouped the supplied labelled scenes by their captioned event.',
      structured: { assignments },
    },
  }
})
