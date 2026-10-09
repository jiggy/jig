import { expect, test } from 'bun:test'
import { type ViewItem, validateUserUpdate } from '@jigging/user-updates'
import { PrivateRunModel } from '../src/cli-run-model.js'
import {
  PRIVATE_WEB_INCOMPLETE_LIMIT,
  PRIVATE_WEB_SNAPSHOT_LIMIT,
  PrivateWebProjection,
} from '../src/cli-web-snapshot.js'

const view = (id = 'same', text = 'Literal report'): ViewItem =>
  validateUserUpdate({
    kind: 'view',
    id,
    title: 'Same label',
    summary: 'Summary',
    sections: [{ blocks: [{ kind: 'report', text }] }],
  }) as ViewItem
const call = (publisher: string, operationId: string, childPublisher?: string) => ({
  publisher,
  operationId,
  slot: 'same label',
  state: 'active' as const,
  time: 100,
  ...(childPublisher === undefined ? {} : { childPublisher }),
})
const size = (value: unknown) => Buffer.byteLength(JSON.stringify(value))

test('semantic subscriptions exclude navigation, elapsed repaint and receipt commitment; transactions are atomic', () => {
  const model = new PrivateRunModel(),
    observations: unknown[] = []
  const unsubscribe = model.subscribeSemantic((generation) =>
    observations.push({
      generation,
      calls: model.calls.size,
      causes: model.attention.length,
      stopped: model.stopped,
    }),
  )
  model.transaction(() => {
    model.setHostStage('Dispatching')
    model.acceptView('root', view())
    model.acceptNotice('root', 'info', 'Working', 100)
  })
  expect(observations).toHaveLength(1)
  model.select([...model.views.keys()][0])
  model.selectRecord('block:0:0')
  model.toggleDisclosure()
  model.workspace.now = 1000
  model.onChange()
  expect(observations).toHaveLength(1)
  model.observeCall({ ...call('root', 'own'), state: 'failed', cause: 'Full host cause' })
  expect(observations).toHaveLength(2)
  expect(observations[1]).toMatchObject({ calls: 1, causes: 1 })
  model.attention[0]!.committed = true
  model.onChange()
  expect(observations).toHaveLength(2)
  model.acceptView('other', view())
  model.stop('Frozen')
  expect(observations.at(-1)).toMatchObject({ stopped: true })
  expect(observations).toHaveLength(4)
  unsubscribe()
  model.setContext('Settled context')
  expect(observations).toHaveLength(4)
})

test('accepted-source identities and actual call ancestry survive colliding labels/local IDs without exposing sideband', () => {
  const model = new PrivateRunModel(),
    projection = new PrivateWebProjection(model, new Uint8Array(32).fill(7))
  model.observeCall(call('root', 'worker', 'private-child-A'))
  model.observeCall(call('private-child-A', 'worker', 'private-grandchild'))
  for (const publisher of ['root', 'private-child-A', 'private-child-B']) {
    model.acceptView(publisher, view())
    model.acceptNotice(publisher, 'error', 'Same literal cause', 64)
    model.addAttention('Same label', 'Same literal cause', 2, false, false, {
      provenance: 'accepted-source',
      publisher,
    })
  }
  const first = projection.capture(1),
    second = projection.capture(2)
  expect(new Set(first.views.map((v) => v.id)).size).toBe(3)
  expect(new Set(first.views.map((v) => v.sourceId)).size).toBe(3)
  expect(first.views.map((v) => v.id)).toEqual(second.views.map((v) => v.id))
  const child = first.attention[1]!.attribution
  expect(child).toMatchObject({
    provenance: 'accepted-source',
    relation: 'observed-call',
    ancestryIncomplete: false,
    callId: first.calls[0]!.id,
  })
  expect(first.calls[0]!.childSourceId).toBe(first.views[1]!.sourceId)
  expect(first.attention[2]!.attribution).toMatchObject({
    relation: 'unavailable',
    ancestryIncomplete: true,
  })
  expect(first.journal[1]!.attribution).toMatchObject({
    sourceId: first.views[1]!.sourceId,
    callId: first.calls[0]!.id,
    relation: 'observed-call',
  })
  expect(JSON.stringify(first)).not.toContain('private-child')
  expect(first.views[0]!.value).toEqual(view())
  expect(first.attention.every((entry) => /^[a-f0-9]{64}$/.test(entry.id))).toBe(true)
})

test('omitted call ancestry stays unavailable; diagnostic paths never invent a source relationship', () => {
  const model = new PrivateRunModel(),
    projection = new PrivateWebProjection(model)
  for (let i = 0; i < 256; i++) model.observeCall(call('root', `op-${i}`))
  model.observeCall(call('root', 'omitted', 'accepted-unknown-child'))
  model.addAttention('Same label', 'Retained error', 2, false, false, {
    provenance: 'accepted-source',
    publisher: 'accepted-unknown-child',
  })
  model.addDiagnostic('Unmapped diagnostic', ['op-0'])
  const snapshot = projection.capture(1)
  expect(snapshot.omissions.calls).toBe(1)
  expect(snapshot.attention[0]!.attribution).toMatchObject({
    relation: 'unavailable',
    ancestryIncomplete: true,
  })
  expect(snapshot.journal[0]!.attribution).toEqual({
    provenance: 'host-observed',
    sourceLabel: 'Diagnostic',
  })
  expect(snapshot.journal[0]!.importance).toBe('unknown')
  expect(snapshot.calls).toHaveLength(256)
})

test('diagnostic emitters retain actual host-observed source/call sideband despite matching display paths', () => {
  const model = new PrivateRunModel(),
    projection = new PrivateWebProjection(model)
  model.observeCall(call('root', 'original', 'private-emitter'))
  model.acceptView('private-emitter', view())
  const admission = {
    provenance: 'host-observed' as const,
    emitter: 'private-emitter',
    publisher: 'root',
    operationId: 'original',
  }
  model.addDiagnostic('First', ['untrusted-display-path'], false, admission)
  model.addDiagnostic(' continued', ['untrusted-display-path'], false, admission)
  model.addDiagnostic('Other emitter', ['untrusted-display-path'], false, {
    ...admission,
    emitter: 'another-private-emitter',
    operationId: 'omitted-call',
  })
  const snapshot = projection.capture(1)
  expect(snapshot.journal).toHaveLength(2)
  expect(snapshot.journal[0]!.text).toBe('First continued')
  expect(snapshot.journal[0]!.importance).toBe('unknown')
  expect(snapshot.journal[0]!.attribution).toMatchObject({
    provenance: 'host-observed',
    sourceId: snapshot.views[0]!.sourceId,
    callId: snapshot.calls[0]!.id,
  })
  expect(snapshot.journal[1]!.attribution).toMatchObject({ relationshipIncomplete: true })
  expect(snapshot.journal[1]!.attribution).not.toHaveProperty('callId')
  expect(JSON.stringify(snapshot)).not.toContain('private-emitter')
})

test('full view details and hidden references are retained; host inventory does not depend on application references', async () => {
  const model = new PrivateRunModel(),
    projection = new PrivateWebProjection(model)
  const ref = { kind: 'artifact' as const, attachment: 'deliverables', path: 'evidence.txt' }
  const v = validateUserUpdate({
    kind: 'view',
    id: 'evidence',
    title: 'Evidence',
    summary: 'Literal',
    sections: [
      {
        blocks: [
          {
            kind: 'collection',
            id: 'rows',
            title: 'Rows',
            columns: [
              { key: 'name', label: 'Name', type: 'text' },
              { key: 'hidden', label: 'Evidence', type: 'reference' },
            ],
            rows: [
              {
                id: 'a',
                cells: { name: 'A', hidden: ref },
                details: [{ kind: 'facts', items: [{ label: 'Again', value: ref }] }],
              },
            ],
          },
        ],
      },
    ],
  }) as ViewItem
  model.acceptView('root', v)
  model.acceptView('child', { ...v, id: 'child' })
  model.setArtifacts(
    (publisher, reference) =>
      publisher === 'root' &&
      reference.attachment === 'deliverables' &&
      reference.path === 'evidence.txt'
        ? reference.path
        : undefined,
    async () => ({ text: 'Exact immutable bytes', bytes: 21, clipped: false }),
  )
  model.setArtifactCapture({
    generation: 'one',
    sourcePublisher: 'root',
    provenance: 'verified-delivery',
    phase: 'ready',
    files: [{ path: 'evidence.txt', bytes: 21, state: 'text', clipped: false }],
  })
  const snapshot = projection.capture(1)
  expect(snapshot.views[0]!.value.sections).toEqual(v.sections)
  expect(snapshot.artifacts.permittedAttachments).toEqual(['deliverables'])
  expect(snapshot.artifacts.sourceId).toBe(snapshot.views[0]!.sourceId)
  const file = snapshot.artifacts.files[0]!
  expect(await projection.preview(file.id)).toMatchObject({
    artifactId: file.id,
    captureGeneration: snapshot.artifacts.generation,
    provenance: 'verified-delivery',
    text: 'Exact immutable bytes',
  })
  model.acceptView('root', { kind: 'retire-view', id: 'evidence' })
  expect(projection.capture(2).artifacts.permittedAttachments).toEqual([])
  expect(projection.capture(2).artifacts.files[0]!.id).toBe(file.id)
  expect(await projection.preview(file.id)).toBeDefined()
})

test('preview identity fences capture replacement and states stay distinct', async () => {
  const model = new PrivateRunModel(),
    projection = new PrivateWebProjection(model)
  let finish: ((value: { text: string; bytes: number; clipped: boolean }) => void) | undefined
  model.setArtifacts(
    () => 'same.txt',
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  model.setArtifactCapture({
    generation: 'old',
    sourcePublisher: 'root',
    provenance: 'verified-delivery',
    phase: 'ready',
    files: [{ path: 'same.txt', bytes: 3, state: 'text', clipped: false }],
  })
  const old = projection.capture(1).artifacts.files[0]!.id
  const pending = projection.preview(old)
  model.setArtifactCapture({
    generation: 'new',
    sourcePublisher: 'root',
    provenance: 'verified-delivery',
    phase: 'ready',
    files: [
      { path: 'same.txt', bytes: 0, state: 'empty', clipped: false },
      { path: 'binary', bytes: 1, state: 'non-text', clipped: false },
      { path: 'missing', bytes: 1, state: 'unavailable', clipped: false },
    ],
  })
  finish!({ text: 'old', bytes: 3, clipped: false })
  expect(await pending).toBeUndefined()
  expect(await projection.preview(old)).toBeUndefined()
  const files = projection.capture(2).artifacts.files
  expect(files[0]!.id).not.toBe(old)
  expect(await projection.preview(files[1]!.id)).toMatchObject({ state: 'non-text', bytes: 1 })
  expect(await projection.preview(files[2]!.id)).toMatchObject({ state: 'unavailable' })
})

test('recorded large shell claims are bounded and are never promoted to host observations', () => {
  const model = new PrivateRunModel(),
    projection = new PrivateWebProjection(model)
  model.configureWorkspace({ target: 'x'.repeat(1000000), recorded: true })
  model.setWorkspaceFacts({
    execution: 'succeeded',
    application: '😀'.repeat(1000000),
    cleanup: 'recorded',
    delivery: 'written',
  })
  model.setContext('\\'.repeat(1000000))
  model.addAttention('Recorded', 'Full recorded cause', 4, false, false, {
    provenance: 'recorded-claim',
  })
  const snapshot = projection.capture(1)
  expect([...snapshot.workspace.target]).toHaveLength(1024)
  expect([...snapshot.context]).toHaveLength(2048)
  expect(snapshot.workspace.facts!.application).toMatchObject({
    provenance: 'recorded-claim',
    clipped: true,
  })
  expect(snapshot.attention[0]!.attribution.provenance).toBe('recorded-claim')
  expect(size(snapshot)).toBeLessThan(30000)
})

test('maximum legal escaping fits complete and independent incomplete reserve, preserving every retained cause', () => {
  const model = new PrivateRunModel(),
    projection = new PrivateWebProjection(model)
  const controls = '\u0000"\\😀'.repeat(1024)
  for (let source = 0; source < 4; source++)
    for (let id = 0; id < 4; id++) {
      const v = view(`v-${id}`, controls)
      model.acceptView(`private-${source}`, v)
    }
  for (let i = 0; i < 16; i++)
    model.activity(`private-${i}`, {
      kind: 'activity',
      id: 'work',
      label: 'Label',
      detail: controls,
    })
  for (let i = 0; i < 256; i++)
    model.observeCall({ ...call('root', `op-${i}`), intent: '\\"😀'.repeat(200) })
  for (let i = 0; i < 32; i++) {
    model.addDiagnostic(
      controls,
      Array.from({ length: 32 }, (_, j) => '\u0000'.repeat(128) + `${i}:${j}`),
    )
    model.addHostEntry(`host-${i}`, controls)
    model.acceptNotice(
      `private-${i}`,
      'error',
      controls,
      size({ kind: 'notice', text: controls, severity: 'error' }),
    )
    model.addAttention('Flow', controls, 2, false, false, {
      provenance: 'accepted-source',
      publisher: `private-${i}`,
    })
  }
  const complete = projection.capture(1),
    fallback = projection.incomplete(2, 'Independent bounded projection unavailable', 1)
  expect(size(complete)).toBeLessThan(PRIVATE_WEB_SNAPSHOT_LIMIT)
  expect(size(fallback)).toBeLessThan(PRIVATE_WEB_INCOMPLETE_LIMIT)
  expect(fallback.attention.map((entry) => entry.text)).toEqual(
    model.attention.map((entry) => entry.text),
  )
  expect(fallback.diagnostics.map((entry) => entry.text)).toEqual(
    model.journal.filter((entry) => entry.kind === 'diagnostic').map((entry) => entry.text),
  )
  expect(fallback).not.toHaveProperty('views')
  expect(fallback.lastCompleteRevision).toBe(1)
  const corrupt = model.views.values().next().value!
  corrupt.value = { ...corrupt.value, summary: '"\\'.repeat(300000) }
  expect(() => projection.capture(3)).toThrow('allowance')
  expect(projection.incomplete(3).attention).toHaveLength(model.attention.length)
})

test('all diagnostic path wrappers fit complete reserve and independently clip only paths in fallback', () => {
  const model = new PrivateRunModel(),
    projection = new PrivateWebProjection(model)
  for (let i = 0; i < 32; i++)
    model.addDiagnostic(
      '\u0000'.repeat(256),
      Array.from({ length: 32 }, (_, j) => '\u0000'.repeat(128) + `${i}:${j}`),
    )
  for (let i = 0; i < 128; i++)
    model.addAttention('Attributed source', '"\\\u0000'.repeat(150), 2, false, false, {
      provenance: 'accepted-source',
      publisher: `private-${i}`,
    })
  model.addAttention('Jig', 'Full critical retained host cause', 4)
  const snapshot = projection.capture(1),
    fallback = projection.incomplete(2)
  expect(snapshot.journal).toHaveLength(32)
  expect(snapshot.journal.every((entry) => entry.pathClipped)).toBe(true)
  expect(fallback.diagnostics).toHaveLength(32)
  expect(fallback.diagnostics.at(-1)?.operationsPath).toHaveLength(0)
  expect(fallback.diagnostics.at(-1)?.pathClipped).toBe(true)
  expect(fallback.attention).toHaveLength(128)
  expect(fallback.attention.map((report) => report.text)).toEqual(
    model.attention.map((report) => report.text),
  )
  expect(size(snapshot)).toBeLessThan(PRIVATE_WEB_SNAPSHOT_LIMIT)
  expect(size(fallback)).toBeLessThan(PRIVATE_WEB_INCOMPLETE_LIMIT)
})

test('attention admission IDs survive eviction and root own-call omission is explicit', () => {
  const model = new PrivateRunModel(),
    projection = new PrivateWebProjection(model)
  for (let i = 0; i < 127; i++)
    model.addAttention('Flow', `Cause ${i}`, 2, false, false, {
      provenance: 'accepted-source',
      publisher: 'root',
    })
  const id = projection.capture(1).attention[0]?.id
  model.addAttention('Jig', 'Higher priority 1', 4)
  model.addAttention('Jig', 'Higher priority 2', 4)
  expect(projection.capture(2).attention[0]?.id).toBe(id)
  model.addAttention('Flow', 'Unobserved own operation', 4, false, false, {
    provenance: 'accepted-source',
    publisher: 'root',
    operationId: 'missing',
  })
  expect(projection.capture(3).attention.at(-1)?.attribution).toMatchObject({
    relation: 'unavailable',
    ancestryIncomplete: true,
  })
})

test('an omitted own call never falls back to a different retained parent call', () => {
  const model = new PrivateRunModel(),
    projection = new PrivateWebProjection(model)
  model.observeCall(call('root', 'parent', 'child'))
  model.addAttention('Flow', 'Missing child operation cause', 2, false, false, {
    provenance: 'accepted-source',
    publisher: 'child',
    operationId: 'missing-own-call',
  })
  const attribution = projection.capture(1).attention[0]?.attribution
  expect(attribution).toMatchObject({
    provenance: 'accepted-source',
    relation: 'unavailable',
    ancestryIncomplete: true,
  })
  expect(attribution).not.toHaveProperty('callId')
})
