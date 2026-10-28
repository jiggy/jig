import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'
import { ApplicationPage, FormattedReport } from '../dist/application.js'
import {
  BrowserClient,
  browserLocal,
  browserRecords,
  browserRelatedViews,
  browserResolve,
  browserTabs,
} from '../dist/index.js'

const snapshot = () => ({
  kind: 'snapshot',
  revision: 1,
  mode: 'live-run',
  rootSourceId: 'root',
  workspace: { target: 'Photos', phase: 'live', hostStage: 'Observing', elapsedMs: 0 },
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
const walk = (value) =>
  Array.isArray(value)
    ? value.flatMap(walk)
    : value && typeof value === 'object' && 'props' in value
      ? [value, ...walk(value.props.children)]
      : []
const text = (value) =>
  Array.isArray(value)
    ? value.map(text).join('')
    : value && typeof value === 'object' && 'props' in value
      ? text(value.props.children)
      : value == null
        ? ''
        : String(value)
const props = (view) => ({
  view,
  local: browserLocal(),
  records: browserRecords(view, browserLocal()),
  onSelect() {},
  onRecordKeyDown() {},
  onFilter() {},
  onSort() {},
  renderBlock: (block) => block.text ?? 'Content',
  renderValue: (value) => (typeof value === 'object' ? JSON.stringify(value) : String(value)),
  renderMedia: (_ref, _record, alt) => alt,
})

test('display-only material renders no generic inspection or trivial collection controls', () => {
  const view = {
    id: 'page',
    sourceId: 'root',
    sourceLabel: 'Application',
    updatedAt: 0,
    value: {
      kind: 'view',
      id: 'page',
      title: 'Read this',
      summary: 'A useful display without actions',
      sections: [
        {
          blocks: [
            { kind: 'report', text: 'The complete explanation.' },
            {
              kind: 'collection',
              id: 'one',
              title: 'One item',
              columns: [{ key: 'name', label: 'Name', type: 'text' }],
              rows: [{ id: 'one', cells: { name: 'Complete value' } }],
            },
          ],
        },
      ],
    },
  }
  const page = ApplicationPage(props(view))
  assert(text(page).includes('Complete value'))
  assert.equal(
    walk(page).filter((node) => ['button', 'input', 'select'].includes(node.type)).length,
    0,
  )
})

test('gallery roles preserve every field and all details across a thousand records', () => {
  const view = {
    id: 'page',
    sourceId: 'root',
    sourceLabel: 'Application',
    updatedAt: 0,
    value: {
      kind: 'view',
      id: 'page',
      title: 'Photos',
      summary: 'All retained records',
      target: { definitionId: 'photos', instanceKey: 'family', subjectKey: 'family' },
      sections: [
        {
          blocks: [
            {
              kind: 'collection',
              id: 'photos',
              title: 'Photos',
              presentation: {
                kind: 'gallery',
                media: 'image',
                title: 'name',
                alt: 'alt',
                description: 'caption',
              },
              columns: [
                { key: 'name', label: 'Name', type: 'text' },
                { key: 'image', label: 'Image', type: 'reference' },
                { key: 'alt', label: 'Alternative text', type: 'text' },
                { key: 'caption', label: 'Caption', type: 'text' },
                { key: 'other', label: 'Other field', type: 'text' },
              ],
              rows: Array.from({ length: 1000 }, (_, index) => ({
                id: String(index),
                cells: {
                  name: `Photo ${index}`,
                  image: { kind: 'input-artifact', attachment: 'photos', path: `${index}.jpg` },
                  alt: `Alternative ${index}`,
                  caption: `Caption ${index}`,
                  other: `Additional ${index}`,
                },
                details: [{ kind: 'report', text: `Detailed ${index}` }],
              })),
            },
          ],
        },
      ],
    },
  }
  const page = ApplicationPage(props(view))
  assert(text(page).includes('Additional 999'))
  assert(text(page).includes('Alternative 999'))
  assert(text(page).includes('Caption 999'))
  assert.equal(
    walk(page).filter(
      (node) => node.type === 'article' && node.props.class === 'application-gallery-card',
    ).length,
    1000,
  )
  assert.equal(browserRecords(view, browserLocal()).at(-1).row.details[0].text, 'Detailed 999')
})

test('code and diff reports preserve literal whitespace without authored HTML', () => {
  for (const format of ['code', 'diff']) {
    const report = FormattedReport({
      block: {
        kind: 'report',
        format,
        text: '  <script>never execute</script>\n+ exact spacing\n',
      },
    })
    assert.equal(report.type, 'pre')
    assert.equal(text(report), '  <script>never execute</script>\n+ exact spacing\n')
    assert.equal(
      walk(report).some((node) => node.props.dangerouslySetInnerHTML),
      false,
    )
  }
})

test('related navigation and artifact lookup preserve exact application subject and source', () => {
  const body = snapshot()
  body.mode = 'retained-views'
  body.workspace.phase = 'settled'
  const view = (id, source, subject) => ({
    id,
    sourceId: source,
    sourceLabel: source,
    updatedAt: 0,
    value: {
      kind: 'view',
      id,
      title: id,
      summary: '',
      target: { definitionId: id, instanceKey: subject, subjectKey: subject },
      sections: [],
    },
  })
  body.views = [
    view('photos', 'first', 'family'),
    view('organize', 'first', 'family'),
    view('other-album', 'first', 'spring'),
    view('other-source', 'second', 'family'),
  ]
  assert.deepEqual(
    browserRelatedViews(body, body.views[0]).map((item) => item.id),
    ['organize'],
  )
  assert(!browserTabs(body).some((tab) => ['activity', 'overview', 'files'].includes(tab.id)))
  body.artifacts = {
    ...body.artifacts,
    sourceId: 'archive',
    permittedAttachments: ['files'],
    files: [
      {
        id: 'a',
        sourceId: 'first',
        attachment: 'files',
        path: 'same.png',
        bytes: 1,
        state: 'image',
        clipped: false,
      },
      {
        id: 'b',
        sourceId: 'second',
        attachment: 'files',
        path: 'same.png',
        bytes: 1,
        state: 'image',
        clipped: false,
      },
    ],
  }
  assert.equal(
    browserResolve(body, 'first', { kind: 'artifact', attachment: 'files', path: 'same.png' })
      .artifactId,
    'a',
  )
  assert.equal(
    browserResolve(body, 'second', { kind: 'artifact', attachment: 'files', path: 'same.png' })
      .artifactId,
    'b',
  )
  assert.equal(
    browserResolve(body, 'first', { kind: 'input-artifact', attachment: 'files', path: 'same.png' })
      .kind,
    'unavailable',
  )
})

const until = async (predicate) => {
  const end = Date.now() + 5000
  while (!predicate()) {
    if (Date.now() > end) throw Error('Expected observation was not reached')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}
test('real HTTP serializes visible media, authenticates full downloads and fences late completions', async () => {
  const body = snapshot()
  const bytes = Uint8Array.from([0, 255, 128, 10])
  const cap = 'A'.repeat(43)
  body.inputs = {
    generation: 'input-1',
    sourceId: 'root',
    permittedAttachments: ['photos'],
    provenance: 'captured-input',
    phase: 'ready',
    files: Array.from({ length: 30 }, (_, index) => ({
      id: `file-${index}`,
      attachment: 'photos',
      path: `${index}.bin`,
      bytes: 4,
      state: 'non-text',
      clipped: false,
      downloadable: true,
    })),
  }
  let active = 0,
    peak = 0,
    previews = 0,
    downloads = 0,
    releaseDownload
  const eventResponses = new Set()
  const server = createServer(async (req, res) => {
    if (req.headers.authorization !== `Bearer ${cap}`) {
      res.writeHead(401).end()
      return
    }
    if (req.url === '/api/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      res.write('event: revision\ndata: 1\n\n')
      eventResponses.add(res)
      res.on('close', () => eventResponses.delete(res))
      return
    }
    if (req.url === '/api/snapshot') {
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(body))
      return
    }
    const match = /^\/api\/artifacts\/(file-[0-9]+)\/(preview|download)$/.exec(req.url ?? '')
    if (!match) {
      res.writeHead(404).end()
      return
    }
    if (match[2] === 'preview') {
      active++
      peak = Math.max(peak, active)
      previews++
      await new Promise((resolve) => setTimeout(resolve, 3))
      active--
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(
        JSON.stringify({
          artifactId: match[1],
          captureGeneration: 'input-1',
          provenance: 'captured-input',
          state: 'non-text',
          bytes: 4,
          clipped: false,
        }),
      )
      return
    }
    downloads++
    assert.equal(req.headers['x-jig-capture-generation'], 'input-1')
    res.writeHead(200, {
      'X-Jig-Capture-Generation': 'input-1',
      'Content-Type': 'application/octet-stream',
    })
    res.write(bytes.subarray(0, 2))
    releaseDownload = () => res.end(bytes.subarray(2))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const origin = `http://127.0.0.1:${address.port}`
  const client = new BrowserClient(cap, () => {}, {
    fetch: (url, init) => fetch(new URL(url, origin), init),
  })
  try {
    client.start()
    await until(() => client.referencesEnabled)
    const intents = Array.from({ length: 30 }, (_, index) => ({
      artifactId: `file-${index}`,
      captureGeneration: 'input-1',
      signature: String(index),
    }))
    client.setMedia(intents)
    await until(() => previews === 24 && client.mediaPreview(intents[23]))
    assert.equal(peak, 1)
    assert.equal(previews, 24)
    assert.equal(client.mediaPreview(intents[24]), undefined)
    const first = client.download(intents[0])
    await until(() => downloads === 1)
    releaseDownload()
    assert.deepEqual(await first, bytes)
    const late = client.download(intents[1])
    await until(() => downloads === 2)
    client.stop()
    releaseDownload()
    assert.equal(await late, undefined)
    assert.equal(client.mediaPreview(intents[0]), undefined)
  } finally {
    client.stop()
    for (const res of eventResponses) res.end()
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
})
