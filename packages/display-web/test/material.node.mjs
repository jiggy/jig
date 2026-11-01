import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'
import { deflateSync } from 'node:zlib'
import {
  ApplicationPage,
  CapturedContent,
  DocumentPage,
  FormattedReport,
} from '../dist/application.js'
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
  onClearFilters() {},
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

function thumbnail(width = 384, height = 170) {
  const pixels = Buffer.alloc((width * 4 + 1) * height)
  for (let row = 0; row < height; row++)
    for (let column = 1; column <= width * 4; column++)
      pixels[row * (width * 4 + 1) + column] = (row + column) % 251
  const chunk = (type, bytes) => {
    const content = Buffer.concat([Buffer.from(type), bytes])
    let crc = 0xffffffff
    for (const byte of content) {
      crc ^= byte
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
    }
    const result = Buffer.alloc(bytes.length + 12)
    result.writeUInt32BE(bytes.length)
    content.copy(result, 4)
    result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, result.length - 4)
    return result
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 6
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(pixels, { level: 0 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
  assert(png.length <= 2 * 1024 * 1024)
  return { mime: 'image/png', width, height, base64: png.toString('base64') }
}

test('media cache pressure does not repeat settled visible requests', async () => {
  const body = snapshot()
  const image = thumbnail(800, 400)
  assert(Buffer.from(image.base64, 'base64').length > 1024 * 1024)
  const cap = 'B'.repeat(43)
  body.inputs = {
    generation: 'input-1',
    sourceId: 'root',
    permittedAttachments: ['photos'],
    provenance: 'captured-input',
    phase: 'ready',
    files: Array.from({ length: 15 }, (_, index) => ({
      id: `file-${index}`,
      attachment: 'photos',
      path: `${index}.png`,
      bytes: 256 * 1024,
      state: 'image',
      clipped: false,
    })),
  }
  const reply = (id) => ({
    artifactId: id,
    captureGeneration: body.inputs.generation,
    provenance: 'captured-input',
    state: 'image',
    image,
    bytes: 256 * 1024,
    clipped: false,
  })
  assert(13 * (JSON.stringify(reply('file-0')).length * 2 + 512) > 40 * 1024 * 1024)
  const attempts = new Map()
  const events = new Set()
  let held,
    requests = 0,
    active = 0,
    peak = 0
  const server = createServer((req, res) => {
    assert.equal(req.headers.authorization, `Bearer ${cap}`)
    if (req.url === '/api/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      res.write('event: revision\ndata: 1\n\n')
      events.add(res)
      res.on('close', () => events.delete(res))
      return
    }
    if (req.url === '/api/snapshot') {
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(body))
      return
    }
    const id = /^\/api\/artifacts\/(file-[0-9]+)\/preview$/.exec(req.url ?? '')?.[1]
    assert(id)
    requests++
    attempts.set(id, (attempts.get(id) ?? 0) + 1)
    active++
    peak = Math.max(peak, active)
    res.on('close', () => active--)
    if (id === 'file-13') {
      res.writeHead(503).end()
      return
    }
    if (id === 'file-14' && attempts.get(id) === 1) {
      held = res
      return
    }
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(reply(id)))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  const client = new BrowserClient(cap, () => {}, {
    fetch: (url, init) => fetch(new URL(url, origin), init),
  })
  const intents = Array.from({ length: 15 }, (_, index) => ({
    artifactId: `file-${index}`,
    captureGeneration: 'input-1',
    signature: String(index),
  }))
  const quiet = () => new Promise((resolve) => setTimeout(resolve, 100))
  try {
    client.start()
    await until(() => client.referencesEnabled)
    client.setMedia(intents.slice(0, 13))
    await until(() => requests >= 13 && client.mediaPreview(intents[12]))
    assert.equal(client.mediaPreview(intents[12]).state, 'image')
    assert.equal(client.mediaPreview(intents[12]).image.width, 800)
    await quiet()
    assert.equal(requests, 13)
    assert.equal(peak, 1)
    const evicted = intents.slice(0, 13).filter((intent) => !client.mediaPreview(intent))
    assert(evicted.length > 0)
    client.setMedia(intents.slice(0, 13).reverse())
    client.setMedia(intents.slice(0, 14))
    await until(() => client.mediaPreview(intents[13])?.state === 'unavailable')
    await quiet()
    assert.equal(requests, 14, 'reordering and adding media must not retry settled visible entries')
    assert.equal(attempts.get('file-13'), 1)
    client.setMedia([])
    client.setMedia([evicted[0]])
    await until(() => client.mediaPreview(evicted[0]))
    assert.equal(requests, 15, 'an evicted entry can retry after leaving visibility')

    body.revision = 2
    body.inputs.generation = 'input-2'
    for (const res of events) res.write('event: revision\ndata: 2\n\n')
    await until(() => client.body?.revision === 2 && client.referencesEnabled)
    const current = { ...evicted[0], captureGeneration: 'input-2' }
    const late = { ...intents[14], captureGeneration: 'input-2' }
    client.setMedia([current])
    await until(() => client.mediaPreview(current))
    assert.equal(requests, 16, 'new capture identities receive a fresh attempt')
    client.setMedia([late])
    await until(() => held)
    client.setMedia([current])
    held
      .writeHead(200, { 'Content-Type': 'application/json' })
      .end(JSON.stringify(reply('file-14')))
    await quiet()
    assert.equal(client.mediaPreview(late), undefined)
    client.setMedia([late])
    await until(() => client.mediaPreview(late))
    assert.equal(
      attempts.get('file-14'),
      2,
      'an aborted intent can retry after becoming visible again',
    )
    client.stop()
    await quiet()
    assert.equal(requests, 18)
    assert.equal(client.mediaPreview(late), undefined)
  } finally {
    client.stop()
    held?.end()
    for (const res of events) res.end()
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
})

const materialView = (blocks) => ({
  id: 'page',
  sourceId: 'root',
  sourceLabel: 'Original publisher',
  updatedAt: 0,
  value: {
    kind: 'view',
    id: 'page',
    title: 'Readable material',
    summary: 'Partial result: review before use.',
    sections: [{ title: 'The result', blocks }],
  },
})
const collection = () => ({
  kind: 'collection',
  id: 'people',
  title: 'People',
  columns: [{ key: 'name', label: 'Name', type: 'text' }],
  rows: [
    {
      id: 'alex',
      cells: { name: 'Alex' },
      details: [{ kind: 'report', text: 'Alex owns this context' }],
    },
    { id: 'blair', cells: { name: 'Blair' } },
  ],
})

test('application identity stays in the shell while summaries and ended state remain visible', () => {
  const view = materialView([{ kind: 'report', text: 'A readable result.' }])
  view.ended = 'Publisher stopped before completion'
  const page = ApplicationPage(props(view))
  assert.equal(walk(page).filter((node) => node.type === 'h2').length, 0)
  assert(text(page).includes(view.value.summary))
  const about = walk(page).find((node) => node.type === 'details')
  assert(text(about).includes('Original publisher'))
  assert(text(about).includes('Partial result'))
  assert(text(page).includes(view.ended))
})

test('reading, material and comparison sections retain their own presentation', () => {
  const view = materialView([{ kind: 'report', text: 'A complete letter.' }])
  view.value.sections.push(
    { title: 'People', blocks: [collection()] },
    { title: 'Patch', blocks: [{ kind: 'report', format: 'diff', text: '+literal' }] },
  )
  const page = ApplicationPage(props(view))
  const sections = walk(page).filter((node) => node.type === 'section')
  assert(sections[0].props.class.includes('application-section-reading'))
  assert(sections[1].props.class.includes('application-section-collection'))
  assert(sections[2].props.class.includes('application-section-material'))
  assert.equal(walk(sections[1]).filter((node) => node.type === 'h3').length, 0)
  assert.equal(walk(sections[1]).filter((node) => node.type === 'h4').length, 1)
})

test('a filtered-out selection keeps its own context and can clear filters without changing selection', () => {
  const view = materialView([collection()])
  const local = browserLocal()
  const selected = browserRecords(view, local).find((item) => item.row?.id === 'alex')
  local.selected = selected.key
  local.detailOpen = true
  local.filters.set('people', 'Blair')
  const options = {
    ...props(view),
    local,
    records: browserRecords(view, local),
    onClearFilters: () => local.filters.clear(),
  }
  const page = ApplicationPage(options)
  assert(text(page).includes('Alex is outside the current filters'))
  const notice = walk(page).find((node) => node.props.class === 'selection-notice')
  walk(notice)
    .find((node) => node.type === 'button')
    .props.onClick()
  assert.equal(local.filters.size, 0)
  assert.equal(local.selected, selected.key)
  assert.equal(
    browserRecords(view, local).find((item) => item.key === local.selected).row.details[0].text,
    'Alex owns this context',
  )
})

const captured = (state, value = {}) =>
  CapturedContent({
    path: value.path ?? 'notes.txt',
    alt: 'Captured document',
    unavailable: 'Capture unavailable',
    reply: {
      artifactId: 'file',
      captureGeneration: 'generation',
      provenance: 'verified-delivery',
      state,
      bytes: 50,
      clipped: false,
      ...value,
    },
  })

test('captured correspondence is literal readable text, including hostile markup', () => {
  const page = captured('text', { text: 'Dear Alex,\n\n<script>literal</script>\nRegards, Sam' })
  assert.equal(text(page), 'Dear Alex,\n\n<script>literal</script>\nRegards, Sam')
  assert.equal(walk(page).filter((node) => node.type === 'img').length, 0)
  assert(!walk(page).some((node) => node.props.dangerouslySetInnerHTML))
})

test('complete captured CSV renders a bounded table and preserves its raw text', () => {
  const source = 'Name,Reply\nAlex,"Yes, please"\n'
  const page = captured('text', { path: 'roster.csv', text: source })
  assert.equal(walk(page).filter((node) => node.type === 'table').length, 1)
  assert(text(page).includes('Yes, please'))
  assert(text(walk(page).find((node) => node.type === 'details')).includes(source))
  for (const value of [{ text: source, clipped: true }, { text: 'Name,Reply\nAlex,"unfinished' }]) {
    const raw = captured('text', { path: 'roster.csv', ...value })
    assert.equal(walk(raw).filter((node) => node.type === 'table').length, 0)
    assert(text(raw).includes(value.text))
  }
})

test('header-only CSV and TSV expose their columns and raw text without inventing records', () => {
  for (const [path, source] of [
    ['empty.csv', 'Name,Reply\n'],
    ['empty.tsv', 'Name\tReply\n'],
  ]) {
    const page = captured('text', { path, text: source })
    assert.equal(walk(page).filter((node) => node.type === 'table').length, 1)
    assert.deepEqual(
      walk(page)
        .filter((node) => node.type === 'th')
        .map(text),
      ['Name', 'Reply'],
    )
    assert.equal(text(walk(page).find((node) => node.type === 'tbody')), '')
    assert(text(walk(page).find((node) => node.type === 'details')).includes(source))
    assert.equal(
      walk(captured('text', { path, text: source, clipped: true })).filter(
        (node) => node.type === 'table',
      ).length,
      0,
    )
  }
})

test('captured diffs use literal diff presentation without requiring an image', () => {
  const source = '--- a/example.ts\n+++ b/example.ts\n@@ -1 +1 @@\n-old\n+new\n'
  const page = captured('text', { path: 'review.patch', text: source })
  const report = walk(page).find((node) => node.type === FormattedReport)
  assert(report)
  assert.equal(text(FormattedReport(report.props)), source)
  assert.equal(walk(page).filter((node) => node.type === 'img').length, 0)
})

test('empty, unavailable and non-text captures keep explicit states and selected images keep alternative text', () => {
  assert(text(captured('empty')).includes('file is empty'))
  assert(text(captured('unavailable')).includes('Capture unavailable'))
  assert(text(captured('non-text')).includes('Capture unavailable'))
  const page = captured('image', {
    image: { mime: 'image/png', base64: 'sample', width: 20, height: 10 },
  })
  assert.equal(page.type, 'img')
  assert.equal(page.props.alt, 'Captured document')
})

test('forwarded capture bindings resolve exact scoped references while preserving raw inventory paths', () => {
  const body = snapshot()
  body.artifacts = {
    ...body.artifacts,
    phase: 'ready',
    permittedAttachments: ['book'],
    files: [
      {
        id: 'pdf',
        path: 'book/yearbook.pdf',
        bytes: 12,
        state: 'non-text',
        clipped: false,
        downloadable: true,
        bindings: [{ sourceId: 'root', attachment: 'book', path: 'yearbook.pdf' }],
      },
    ],
  }
  const ref = { kind: 'artifact', attachment: 'book', path: 'yearbook.pdf' }
  assert.equal(browserResolve(body, 'root', ref).artifactId, 'pdf')
  for (const [source, value] of [
    ['other', ref],
    ['root', { ...ref, path: 'book/yearbook.pdf' }],
    ['root', { ...ref, attachment: 'other' }],
  ])
    assert.equal(browserResolve(body, source, value).kind, 'unavailable')
  assert.equal(body.artifacts.files[0].path, 'book/yearbook.pdf')
})
test('a document composes a cover, usable download and readable sections without generic inspection chrome', () => {
  const view = materialView([
    { kind: 'report', text: 'A cottage cover, followed by the contents.' },
    {
      kind: 'content',
      title: 'Family walk',
      reference: { kind: 'input-artifact', attachment: 'photos', path: 'walk.jpg' },
    },
  ])
  view.value.sections[0].label = '01–02'
  view.value.presentation = {
    kind: 'document',
    title: 'Family moments · 2025',
    subtitle: 'A family yearbook',
    label: '12-page yearbook · PDF ready',
    cover: { kind: 'input-artifact', attachment: 'photos', path: 'cottage.jpg' },
    download: {
      label: 'Download PDF',
      reference: { kind: 'artifact', attachment: 'book', path: 'yearbook.pdf' },
    },
  }
  const page = DocumentPage({
    ...props(view),
    renderCollection: () => '',
    renderDownload: () => ({ type: 'button', props: { children: 'Download PDF' } }),
  })
  assert.equal(page.props.class, 'application-document')
  assert(text(page).includes('Family moments · 2025'))
  assert(text(page).includes('Download PDF'))
  assert(text(page).includes('01–02'))
  assert.equal(walk(page).filter((node) => node.props.class === 'application-inspect').length, 0)
  assert.equal(walk(page).filter((node) => node.props.class === 'document-outline').length, 1)
})
