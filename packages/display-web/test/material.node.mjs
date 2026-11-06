import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'
import { deflateSync } from 'node:zlib'
import { displayViewKey } from '@jigging/display-model'
import {
  ApplicationPage,
  CapturedContent,
  DocumentPage,
  FormattedReport,
} from '../dist/application.js'
import { CompositionPage } from '../dist/composition-view.js'
import {
  BrowserClient,
  browserLocal,
  browserPeek,
  browserRecords,
  browserRelatedViews,
  browserResolve,
  browserTabs,
} from '../dist/index.js'
import { privateBrowserNavigationDestination } from '../dist/navigation.js'

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

const compositionSnapshot = () => ({
  ...snapshot(),
  composition: {
    state: 'available',
    provenance: 'admitted',
    rootId: 'application',
    nodes: [
      { id: 'application', label: 'Review', kind: 'flow' },
      { id: 'draft', label: 'Worker', kind: 'binding' },
      { id: 'approval', label: 'Worker', kind: 'binding' },
      { id: 'http', label: '<SCRIPT>literal text</SCRIPT>', kind: 'resource', resourceKind: 'http-request' },
    ],
    edges: [
      { id: 'draft-route', source: 'application', target: 'draft', slot: 'prepare' },
      { id: 'retry-route', source: 'application', target: 'draft', slot: 'retry' },
      { id: 'approval-route', source: 'application', target: 'approval', slot: 'approve' },
      { id: 'http-route', source: 'draft', target: 'http', slot: '<fetch>' },
    ],
  },
  calls: [
    { id: 'first', sourceId: 'root', childSourceId: 'worker-one', sourceLabel: 'Review', operationId: 'attempt-one', slot: 'prepare', state: 'returned', firstObservedAt: 0, observedAt: 2 },
    { id: 'second', sourceId: 'root', sourceLabel: 'Review', operationId: 'attempt-two', slot: 'prepare', state: 'requested', firstObservedAt: 3, observedAt: 3 },
    { id: 'unknown', sourceId: 'missing', sourceLabel: 'Worker', operationId: 'unplaced', slot: '<fetch>', state: 'uncertain', firstObservedAt: 4, observedAt: 4 },
  ],
})
const compositionProps = (data, selectedNodeId, referencesEnabled = true) => ({
  snapshot: data,
  selectedNodeId,
  detailOpen: true,
  referencesEnabled,
  scale: 1,
  onScale() {},
  onSelect() {},
  onClose() {},
  onCall() {},
  onObservedCalls() {},
  onNodeKeyDown() {},
  onScroll() {},
})

test('map cards publish CSS lengths in the SVG coordinate space', () => {
  const data = compositionSnapshot()
  const page = CompositionPage(compositionProps(data, 'draft'))
  const canvas = walk(page).find((node) => node.props.class === 'composition-canvas')
  const svg = walk(canvas).find((node) => node.type === 'svg')
  const pixels = (value) => {
    assert.equal(typeof value, 'string', 'Preact core requires explicit CSS length units')
    assert.match(value, /^\d+(?:\.\d+)?px$/)
    return Number(value.slice(0, -2))
  }
  const width = pixels(canvas.props.style.width)
  const height = pixels(canvas.props.style.height)
  assert.equal(width, svg.props.width)
  assert.equal(height, svg.props.height)
  const cards = walk(canvas).filter((node) => node.props['data-component'])
  assert.equal(cards.length, data.composition.nodes.length)
  const boxes = cards.map((card) => {
    const style = card.props.style
    return {
      x: pixels(style.left), y: pixels(style.top),
      width: pixels(style.width), height: pixels(style.height),
    }
  })
  for (const box of boxes) {
    assert(box.width > 0 && box.height > 0)
    assert(box.x + box.width <= width && box.y + box.height <= height)
  }
  for (const [index, box] of boxes.entries())
    for (const other of boxes.slice(index + 1))
      assert(
        box.x + box.width <= other.x || other.x + other.width <= box.x ||
        box.y + box.height <= other.y || other.y + other.height <= box.y,
        'Component cards must occupy distinct rectangles',
      )
})

test('application maps retain repeated exact requests and distinguish duplicate display labels', () => {
  const data = compositionSnapshot()
  data.omissions.calls = 3
  const page = CompositionPage(compositionProps(data, 'draft'))
  const entries = walk(page).filter((node) => node.props['data-composition-call'])
  assert.deepEqual(entries.map((node) => node.props['data-composition-call']), ['first', 'second'])
  assert(text(entries[0]).includes('Observed state: returned'))
  assert(text(entries[1]).includes('Observed state: requested'))
  assert(entries[0].props['aria-label'].includes('Observed state: returned'))
  assert(entries[1].props['aria-label'].includes('Observed state: requested'))
  assert(text(page).includes('3 call observations are omitted'))
  assert(text(page).includes('1 retained observation cannot be placed on this map'))
  assert(text(page).includes('Caller relationship unavailable: 1'))
  const options = walk(page).filter((node) => node.type === 'option')
  assert(text(options.find((node) => node.props.value === 'draft')).includes('Worker · Binding · from Review / prepare'))
  assert(text(options.find((node) => node.props.value === 'approval')).includes('Worker · Binding · from Review / approve'))
  assert.equal(walk(page).filter((node) => node.props['data-component']).length, 4)
  assert.equal(walk(page).filter((node) => node.type === 'script' || node.type === '<SCRIPT>literal text</SCRIPT>').length, 0)
  assert(text(page).includes('<SCRIPT>literal text</SCRIPT>'))
  assert(text(page).includes('HTTP request'))
  assert(walk(page).every((node) => !Object.hasOwn(node.props, 'dangerouslySetInnerHTML')))
  assert(text(page).includes('do not show execution order or internal decisions'))
  const detail = walk(page).find((node) => node.type === 'aside')
  assert(text(detail).includes('3 call observations are omitted from this run'))
  assert(text(detail).includes('Counts show retained requests'))
})

test('map zoom scales the shared canvas without changing card or connection coordinates', () => {
  const data = compositionSnapshot()
  const natural = CompositionPage(compositionProps(data, 'draft'))
  const zoomed = CompositionPage({ ...compositionProps(data, 'draft'), scale: 0.75 })
  const canvas = walk(zoomed).find((node) => node.props.class === 'composition-canvas')
  const scaled = walk(zoomed).find((node) => node.props.class === 'composition-scaled')
  const viewport = walk(zoomed).find((node) => node.props.id === 'composition-scroll')
  assert.equal(canvas.props.style.transform, 'scale(0.75)')
  assert.equal(canvas.props.style.transformOrigin, '0 0')
  assert.equal(parseFloat(scaled.props.style.width), viewport.props['data-composition-width'] * 0.75)
  assert.equal(parseFloat(scaled.props.style.height), viewport.props['data-composition-height'] * 0.75)
  assert.equal(viewport.props['data-composition-scale'], 0.75)
  const coordinates = (page) => walk(page)
    .filter((node) => node.props['data-component'])
    .map((node) => node.props.style)
  assert.deepEqual(coordinates(zoomed), coordinates(natural))
  const routes = (page) => walk(page)
    .filter((node) => node.props.class === 'composition-route')
    .map((node) => node.props.d)
  assert.deepEqual(routes(zoomed), routes(natural))
  const controls = walk(zoomed).find((node) => node.props['aria-label'] === 'Map zoom')
  assert.equal(walk(controls).filter((node) => node.type === 'button').length, 4)
  assert(walk(controls).filter((node) => node.type === 'button').every((node) => node.props['aria-label']))
})

test('shared targets retain separate visible slot counts and incoming caller context', () => {
  const data = compositionSnapshot()
  const page = CompositionPage(compositionProps(data, 'draft'))
  const counts = walk(page).filter((node) => node.props['data-composition-edge'])
  assert.deepEqual(Object.fromEntries(counts.map((node) => [node.props['data-composition-edge'], text(node)])), {
    'draft-route': '2',
    'retry-route': '0',
    'approval-route': '0',
    'http-route': '0',
  })
  assert.equal(counts.length, data.composition.edges.length)
  const detail = walk(page).find((node) => node.type === 'aside')
  const callers = walk(detail).find((node) => node.props.class === 'composition-route-list composition-incoming')
  const rows = walk(callers).filter((node) => node.type === 'li')
  assert.equal(rows.length, 2)
  assert(text(rows[0]).includes('Reviewprepare2 retained requests'))
  assert(text(rows[1]).includes('ReviewretryNo matching retained requests'))
  const leaf = walk(CompositionPage(compositionProps(data, 'http'))).find((node) => node.type === 'aside')
  assert(text(leaf).includes('Configured callers'))
  assert(text(leaf).includes('Worker'))
  assert(text(leaf).includes('<fetch>'))
  assert(text(leaf).includes('No configured child calls.'))
})

test('root facts and exact per-slot counts remain separate from child request totals', () => {
  const data = compositionSnapshot()
  const page = CompositionPage(compositionProps(data, 'application'))
  const root = walk(page).find((node) => node.props['data-component'] === 'application')
  assert(text(root).includes('Run root'))
  assert(!text(root).includes('No matching retained requests'))
  const detail = walk(page).find((node) => node.type === 'aside')
  assert(text(detail).includes('Run phase: live'))
  assert(text(detail).includes('Observing'))
  assert(!text(detail).includes('No matching invocation observations'))
  const routeList = walk(detail).find((node) => node.props.class === 'composition-route-list')
  const routes = walk(routeList).filter((node) => node.type === 'li')
  assert(text(routes[0]).includes('prepareWorker2 retained requests'))
  assert(text(routes[1]).includes('retryWorkerNo matching retained requests'))
  const table = walk(page).find((node) => node.type === 'tbody')
  assert.equal(walk(table).filter((node) => node.type === 'tr').length, 4)
  assert(text(table).includes('<fetch>'))
})

test('all native resource kinds have human labels and retain exact kind in their identity', () => {
  for (const [resourceKind, label] of [
    ['http-request', 'HTTP request'],
    ['project-command', 'Project command'],
    ['project-evaluation', 'Project evaluation'],
    ['finite-acp', 'Agent conversation'],
    ['run-checkpoint', 'Save checkpoint'],
    ['child-checkpoint', 'Read child checkpoint'],
  ]) {
    const data = compositionSnapshot()
    data.composition.nodes = data.composition.nodes.map((node) =>
      node.id === 'http' ? { ...node, resourceKind } : node,
    )
    const page = CompositionPage(compositionProps(data, 'http'))
    const card = walk(page).find((node) => node.props['data-component'] === 'http')
    assert.equal(card.props['aria-pressed'], true)
    assert(text(card).includes(label))
    const detail = walk(page).find((node) => node.type === 'aside')
    assert(text(detail).includes('Native resource kind: ' + resourceKind))
  }
})

test('missing and stale observations remain explicit without replacing exact component selection', () => {
  const data = compositionSnapshot()
  const empty = CompositionPage(compositionProps(data, 'approval'))
  const detail = walk(empty).find((node) => node.type === 'aside')
  assert(text(detail).includes('No matching invocation observations are retained'))
  assert.equal(walk(detail).filter((node) => node.props['data-composition-call']).length, 0)
  const stale = CompositionPage(compositionProps(data, 'draft', false))
  assert(walk(stale).filter((node) => node.props['data-composition-call']).every((node) => node.props.disabled))
  assert(text(stale).includes('stale or incomplete'))
  assert.equal(walk(CompositionPage(compositionProps(data, 'removed'))).filter((node) => node.type === 'aside').length, 0)
  data.composition = { state: 'unavailable', reason: 'limit' }
  const unavailable = CompositionPage(compositionProps(data, 'draft'))
  assert(text(unavailable).includes('No partial map is shown'))
  assert.equal(walk(unavailable).filter((node) => node.props['data-component']).length, 0)
  assert(text(unavailable).includes('Inspect observed calls'))
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
  assert(!text(about).includes(view.ended), 'stopped state must not be hidden in About')
  const ended = walk(page).find((node) => node.props.class === 'unavailable-note application-ended')
  assert.equal(ended.props.role, 'status')
  assert.equal(text(ended), view.ended)
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

test('small collections retain search and sort behind a disclosure with compact truthful counts', () => {
  const people = collection()
  people.total = people.rows.length
  const view = materialView([people])
  const options = props(view)
  const page = ApplicationPage(options)
  const tools = walk(page).find((node) => node.props.class === 'collection-tools')
  assert.equal(tools.props.open, false)
  assert(text(page).includes('2 records'))
  assert(!text(page).includes('2 reported'))
  assert.equal(walk(tools).filter((node) => node.type === 'input').length, 1)
  assert.equal(walk(tools).filter((node) => node.type === 'select').length, 1)
  options.local.filters.set('people', 'Blair')
  const filtered = ApplicationPage({
    ...options,
    records: browserRecords(view, options.local),
  })
  assert.equal(
    walk(filtered).find((node) => node.props.class === 'collection-tools').props.open,
    true,
  )
  assert(text(filtered).includes('1 of 2 records'))
  options.local.collectionTools.set('people', false)
  const collapsed = ApplicationPage({ ...options, records: browserRecords(view, options.local) })
  const summary = walk(collapsed).find((node) =>
    node.type === 'summary' && text(node).includes('Search and sort'))
  assert(text(summary).includes('Blair'), 'active query must be visible when tools are closed')
  people.total = 25
  assert(text(ApplicationPage(options)).includes('1 of 2 retained · 25 reported'))
})

test('clearing a small collection query preserves the user-open controls', () => {
  const view = materialView([collection()])
  const options = props(view)
  options.onFilter = (collection, value) => options.local.filters.set(collection, value)
  const tools = () =>
    walk(ApplicationPage(options)).find((node) => node.props.class === 'collection-tools')
  tools().props.onToggle({ currentTarget: { open: true } })
  const search = walk(tools()).find((node) => node.type === 'input')
  search.props.onInput({ target: { value: 'Blair' } })
  assert.equal(options.local.filters.get('people'), 'Blair')
  assert.equal(tools().props.open, true)
  search.props.onInput({ target: { value: '' } })
  assert.equal(options.local.filters.get('people'), '')
  assert.equal(tools().props.open, true)
  tools().props.onToggle({ currentTarget: { open: false } })
  assert.equal(tools().props.open, false)
})

test('material and independently supplied context compose together without application-specific names', () => {
  const patch = {
    kind: 'content',
    title: 'Captured change',
    reference: { kind: 'artifact', attachment: 'files', path: 'review.patch' },
  }
  const view = materialView([
    collection(),
    patch,
    { kind: 'report', text: 'Checked independently' },
  ])
  const rendered = []
  const options = {
    ...props(view),
    renderBlock(block, record) {
      rendered.push({ block, record })
      return block.kind === 'content' ? block.title : block.text
    },
  }
  const page = ApplicationPage(options)
  const section = walk(page).find((node) => node.type === 'section')
  assert(section.props.class.includes('application-section-comparison'))
  const context = walk(section).find((node) => node.props.class === 'comparison-context')
  const material = walk(section).find((node) => node.props.class === 'comparison-material')
  assert(text(context).includes('Checked independently'))
  assert(text(context).includes('Alex'))
  assert.equal(text(material), 'Captured change')
  assert.equal(rendered.find((item) => item.block === patch).record.block, patch)
  view.value.sections[0].blocks[1] = { kind: 'report', format: 'diff', text: '+literal patch' }
  assert(text(ApplicationPage(options)).includes('+literal patch'))
})

test('technical identity remains readable inside About this view without becoming a page heading', () => {
  const view = materialView([{ kind: 'report', text: 'Application result' }])
  const identity = 'Exact instance: opaque-reviewed-source-identity'
  const page = ApplicationPage({ ...props(view), identity })
  const about = walk(page).find((node) => node.props.class === 'application-about')
  assert(text(about).includes(identity))
  assert.equal(walk(page).filter((node) => node.type === 'h2').length, 0)
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
  const owner = browserRecords(view, browserLocal())[0]
  assert.deepEqual(browserPeek(owner), view.value.presentation.cover)
  const signature = owner.signature
  view.value.presentation.cover = { kind: 'input-artifact', attachment: 'photos', path: 'walk.jpg' }
  assert.notEqual(browserRecords(view, browserLocal())[0].signature, signature)
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

test('resolved record references bypass subject-preserving tab redirects', () => {
  const body = snapshot()
  const make = (id, definition, subject) => ({
    ...materialView([]),
    id,
    value: {
      ...materialView([]).value,
      id,
      target: { definitionId: definition, instanceKey: subject, subjectKey: subject },
    },
  })
  const photosA = make('photos-a', 'photos', 'a')
  const eventsA = make('events-a', 'events', 'a')
  const eventsB = make('events-b', 'events', 'b')
  body.views = [photosA, eventsA, eventsB]
  const requested = displayViewKey(eventsB.id)
  assert.equal(
    privateBrowserNavigationDestination(body, photosA, requested),
    displayViewKey(eventsA.id),
  )
  assert.equal(privateBrowserNavigationDestination(body, photosA, requested, false), requested)
})
