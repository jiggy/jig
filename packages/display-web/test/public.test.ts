import { expect, test } from 'bun:test'
import { displayViewKey, validateDisplaySnapshot } from '@jigging/display-model'
import {
  BrowserClient,
  browserCallSpans,
  browserLocal,
  browserPeek,
  browserRecords,
  browserResolve,
  browserTabs,
  browserView,
} from '@jigging/display-web'

// This input comes from a consumer, not a Jig model/projection or private fixture helper.
const snapshot = validateDisplaySnapshot({
  kind: 'snapshot',
  revision: 1,
  mode: 'live-run',
  rootSourceId: 'root-source',
  workspace: { target: 'Task', phase: 'settled', hostStage: 'Done', elapsedMs: 20 },
  context: '',
  omissions: { calls: 0, journal: { flow: 0, host: 0, diagnostic: 0 } },
  views: [
    {
      id: 'view',
      sourceId: 'root-source',
      sourceLabel: 'Root method',
      updatedAt: 20,
      value: {
        kind: 'view',
        id: 'findings',
        title: 'Evidence',
        summary: 'Requires review',
        sections: [
          {
            blocks: [
              {
                kind: 'collection',
                id: 'rows',
                title: 'Findings',
                columns: [
                  { key: 'name', label: 'Name', type: 'text' },
                  { key: 'file', label: 'File', type: 'reference' },
                ],
                rows: [
                  {
                    id: 'one',
                    cells: {
                      name: 'Literal finding',
                      file: { kind: 'artifact', attachment: 'output', path: 'notes.txt' },
                    },
                    details: [{ kind: 'report', text: 'Additional supplied evidence' }],
                  },
                ],
              },
            ],
          },
        ],
      },
    },
  ],
  calls: [
    {
      id: 'call',
      sourceId: 'root-source',
      sourceLabel: 'Root method',
      operationId: 'check',
      slot: 'worker',
      state: 'uncertain',
      firstObservedAt: 1,
      observedAt: 20,
      cause: 'Answer unavailable',
    },
  ],
  activities: [],
  journal: [],
  attention: [],
  artifacts: {
    generation: 'capture',
    sourceId: 'root-source',
    permittedAttachments: ['output'],
    provenance: 'verified-delivery',
    phase: 'ready',
    files: [{ id: 'artifact', path: 'notes.txt', bytes: 12, state: 'text', clipped: false }],
  },
})

test('public renderer exports consume semantic views, call uncertainty and explicit evidence identities', () => {
  if (snapshot.kind !== 'snapshot') throw new Error('Expected complete fixture')
  const records = browserRecords(snapshot.views[0]!, browserLocal())
  expect(records[1]!.row?.details?.[0]).toEqual({
    kind: 'report',
    text: 'Additional supplied evidence',
  })
  const reference = browserPeek(records[1])!
  expect(browserResolve(snapshot, records[1]!.sourceId, reference)).toEqual({
    kind: 'artifact',
    label: 'notes.txt',
    artifactId: 'artifact',
    captureGeneration: 'capture',
  })
  expect(browserResolve(snapshot, 'child-source', reference).kind).toBe('unavailable')
  expect(browserCallSpans(snapshot.calls).spans.get('call')?.milliseconds).toBe(19)
  expect(browserTabs(snapshot).at(-1)?.source).toBe('Root method')
})

test('public navigation reaches opaque-name views and built-in surfaces independently while references keep original identities', () => {
  if (snapshot.kind !== 'snapshot') throw new Error('Expected complete fixture')
  const ids = ['files', 'overview', 'activity', displayViewKey('files'), 'view with spaces']
  const body = validateDisplaySnapshot({
    ...snapshot,
    views: ids.map((id, index) => ({
      ...snapshot.views[0]!,
      id,
      value: { ...snapshot.views[0]!.value, id: `semantic-${index}`, title: `View ${index}` },
    })),
  })
  if (body.kind !== 'snapshot') throw new Error('Expected complete fixture')
  const tabs = browserTabs(body)
  expect(new Set(tabs.map((tab) => tab.id)).size).toBe(tabs.length)
  for (const builtin of ['files', 'overview', 'activity']) {
    expect(tabs.some((tab) => tab.id === builtin)).toBeTrue()
    expect(browserView(body, builtin)).toBeUndefined()
  }
  for (const [index, id] of ids.entries()) {
    const destination = tabs.find((tab) => tab.id === displayViewKey(id))!
    const selected = browserView(body, destination.id)!
    expect(selected.id).toBe(id)
    expect(browserRecords(selected, browserLocal())[1]!.row?.details?.[0]).toEqual({
      kind: 'report',
      text: 'Additional supplied evidence',
    })
    const target = browserResolve(body, body.rootSourceId, {
      kind: 'record',
      viewId: `semantic-${index}`,
      collectionId: 'rows',
      rowId: 'one',
    })
    expect(target.kind).toBe('record')
    if (target.kind !== 'record') throw new Error('Expected record reference')
    expect(target.viewId).toBe(id)
    expect(browserView(body, displayViewKey(target.viewId))).toBe(selected)
  }
  const retired = { ...body, revision: body.revision + 1, views: body.views.slice(1) }
  expect(browserView(retired, displayViewKey(ids[0]!))).toBeUndefined()
  expect(browserView(retired, displayViewKey(ids[1]!))?.id).toBe(ids[1]!)
})

test('public browser client accepts preview provenance only when it matches the captured inventory', async () => {
  if (snapshot.kind !== 'snapshot') throw new Error('Expected complete fixture')
  const provenances = ['verified-delivery', 'recorded-capture'] as const
  const flush = async () => {
    for (let index = 0; index < 40; index++) await Promise.resolve()
  }
  for (const inventoryProvenance of provenances)
    for (const replyProvenance of provenances) {
      const body = {
        ...snapshot,
        artifacts: { ...snapshot.artifacts, provenance: inventoryProvenance },
      }
      const client = new BrowserClient('a'.repeat(43), () => {}, {
        fetch: async (input, init) => {
          const path = String(input)
          if (path === '/api/events')
            return new Response(
              new ReadableStream({
                start(controller) {
                  init?.signal?.addEventListener('abort', () => controller.close(), { once: true })
                },
              }),
            )
          if (path === '/api/snapshot') return new Response(JSON.stringify(body))
          if (path === '/api/artifacts/artifact/preview')
            return new Response(
              JSON.stringify({
                artifactId: 'artifact',
                captureGeneration: 'capture',
                provenance: replyProvenance,
                state: 'text',
                text: 'Twelve bytes',
                bytes: 12,
                clipped: false,
              }),
            )
          throw new Error('Unexpected fixture request')
        },
      })
      try {
        client.start()
        await flush()
        expect(client.referencesEnabled).toBeTrue()
        client.setPreview({
          artifactId: 'artifact',
          captureGeneration: 'capture',
          signature: 'selected',
        })
        await flush()
        const matches = inventoryProvenance === replyProvenance
        expect(client.preview?.phase).toBe(matches ? 'ready' : 'unavailable')
        expect(client.preview?.reply?.provenance).toBe(matches ? inventoryProvenance : undefined)
      } finally {
        client.stop()
      }
    }
})
