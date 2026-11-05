import { caseComparison, evidenceGaps, investigationContext, nodeOccurrences, valueChanges } from './behavior.mjs'

/** Read-only renderer for already redacted graph data. It embeds that snapshot in JSON. */
export function graphRoots(graph) {
  const known = new Set(graph.nodes.map(node => node.id))
  const explicit = [graph.entry, graph.root, graph.provenance?.root].filter(id => known.has(id))
  if (explicit.length) return [...new Set(explicit)]
  const targets = new Set(graph.edges.map(edge => edge.target ?? edge.to))
  const structural = graph.nodes.filter(node => !targets.has(node.id)).map(node => node.id)
  if (structural.length) return structural
  // Inventory roots are available Run targets, including targets with callers.
  // They are not all structural roots. A cyclic graph needs only a layout seed.
  const candidate = (graph.provenance?.roots || []).find(id => known.has(id))
  return [candidate ?? graph.nodes[0]?.id].filter(id => id !== undefined)
}

export function edgeLabel(edge) {
  return edge.label ?? edge.slot ?? edge.action ?? (edge.meaning === 'scope-entry' ? 'entry' : 'unlabelled')
}

export function scopeExits(graph, node) {
  if (Array.isArray(node.declaredExits)) return node.declaredExits
  if (Array.isArray(node.exits)) return node.exits
  const scope = (graph.scopes || []).find(item => item.owner === node.id || item.ownerElementId === node.id)
  return scope?.declaredExits ?? scope?.exits ?? []
}

export function isRuntimeGraph(graph) {
  return graph.layer === 'runtime-topology' || graph.provenance?.semantics === 'declared-runtime-topology'
}

export function displayNodeKind(node, graph) {
  if (node.kind === 'grant') return 'Host resource'
  if (node.kind === 'unknown') return 'Unresolved'
  if (node.kind === 'external') return 'External package'
  if (node.kind === 'binding') return 'Binding'
  if (node.kind === 'flow') return isRuntimeGraph(graph) ? 'Scope' : node.runnable === false ? 'Flow · not direct' : 'Flow'
  return node.kind === 'scope' ? 'Scope' : node.kind === 'node' ? 'Step' : node.kind
}

export function nodeSource(node) {
  return node.location ?? node.source ?? (typeof node.evidence === 'object' ? node.evidence : undefined)
}

export function evidenceText(graph) {
  if (isRuntimeGraph(graph)) {
    const measured = graph.provenance?.checks?.handlersDuringInspection === 0
    return {
      heading: graph.runs?.length ? 'Declared topology + recorded probe runs' : 'Declared runtime topology',
      text: (measured ? 'The recorded probe reports zero handler entries during inspection. ' : 'This viewer does not verify how the runtime description was obtained. ') + 'Highlights show recorded handler entries. Edge traversal is not inferred.',
    }
  }
  return {
    heading: graph.provenance?.source === 'jig.lock' ? 'Generated from the supplied lock' : 'Generated from supplied declarations',
    text: 'Connections describe available calls. They do not prove execution order, use, or approval.',
  }
}

export function edgeGeometry(edge, index, positions, lane = 0) {
  const a = positions.get(edge.source ?? edge.from), b = positions.get(edge.target ?? edge.to)
  if (!a || !b) return null
  const ax = a.x + 100, ay = a.y + 81, bx = b.x + 100, by = b.y
  let points, labelX, labelY, labelWidth = 200
  if (by > ay + 12) {
    const mid = (ay + by) / 2, offset = lane * 16
    points = [[ax + offset, ay], [ax + offset, mid], [bx + offset, mid], [bx + offset, by]]
    labelX = (ax + bx) / 2 + offset
    labelY = mid - 6 + offset
  } else if (by === a.y) {
    const right = b.x > a.x, start = right ? a.x + 200 : a.x, end = right ? b.x : b.x + 200
    const gap = Math.abs(b.x - a.x) - 200
    if (gap >= 80 && gap < 200) {
      // Adjacent siblings have a clear gutter. Keep this edge below the
      // incoming-label zone instead of arching into the preceding row.
      const mid = (start + end) / 2, line = a.y + 41 + lane * 12
      points = [[start, line], [mid, line], [mid, line], [end, line]]
      labelX = mid; labelY = line - 8; labelWidth = gap - 16
    } else {
      // An intervening card (or a self-loop) needs an outer route.
      const curve = a.y - 40 - (index % 3) * 14 - lane * 12
      points = [[start, a.y + 35], [start, curve], [end, curve], [end, b.y + 35]]
      labelX = (start + end) / 2
      labelY = curve + 13
    }
  } else {
    const bend = Math.max(a.x + 200, b.x + 200) + 40 + (index % 3) * 16 + lane * 12
    points = [[a.x + 200, a.y + 48], [bend, a.y + 48], [bend, b.y + 35], [b.x + 200, b.y + 35]]
    labelX = bend + 3
    labelY = (a.y + b.y) / 2 + 38 + lane * 16
  }
  // A cubic Bezier stays inside its control-point hull. Include label margins
  // and the arrowhead, rather than fitting only the node rectangles.
  const xs = points.map(point => point[0]), ys = points.map(point => point[1])
  return {
    path: `M ${points[0].join(' ')} C ${points[1].join(' ')}, ${points[2].join(' ')}, ${points[3].join(' ')}`,
    labelX, labelY, labelWidth,
    bounds: {
      left: Math.min(...xs, labelX - 110) - 12,
      right: Math.max(...xs, labelX + 110) + 12,
      top: Math.min(...ys, labelY - 14) - 12,
      bottom: Math.max(...ys, labelY + 8) + 12,
    },
  }
}

export function layoutGraph(graph) {
  const adjacent = new Map(graph.nodes.map(node => [node.id, []]))
  for (const edge of graph.edges) {
    const source = edge.source ?? edge.from, target = edge.target ?? edge.to
    if (adjacent.has(source) && adjacent.has(target)) adjacent.get(source).push(target)
  }
  const rank = new Map(), queue = graphRoots(graph)
  for (const id of queue) rank.set(id, 0)
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const id = queue[cursor]
    for (const target of adjacent.get(id) || []) if (!rank.has(target)) { rank.set(target, rank.get(id) + 1); queue.push(target) }
  }
  const levels = new Map()
  for (const node of graph.nodes) {
    const level = rank.get(node.id) ?? 0
    if (!levels.has(level)) levels.set(level, [])
    levels.get(level).push(node)
  }
  const columns = Math.max(1, ...[...levels.values()].map(nodes => Math.min(nodes.length, 4)))
  const gap = 96, stride = 200 + gap
  const width = Math.max(660, columns * 200 + (columns - 1) * gap + 166), positions = new Map()
  let y = 54
  for (const [level, nodes] of [...levels].sort((a, b) => a[0] - b[0])) {
    for (let start = 0; start < nodes.length; start += 4) {
      const row = nodes.slice(start, start + 4), total = row.length * 200 + (row.length - 1) * gap
      row.forEach((node, index) => positions.set(node.id, { x: (width - total) / 2 + index * stride, y, width: 200, height: 81, rank: level }))
      y += 153
    }
  }
  const pairs = new Map(), pairKey = edge => JSON.stringify([edge.source ?? edge.from, edge.target ?? edge.to])
  for (const edge of graph.edges) { const key = pairKey(edge); pairs.set(key, (pairs.get(key) || 0) + 1) }
  const occurrences = new Map(), edgePaths = new Map()
  let left = 0, top = 0, right = width, bottom = Math.max(410, y - 45)
  graph.edges.forEach((edge, index) => {
    const key = pairKey(edge), occurrence = occurrences.get(key) || 0, count = pairs.get(key)
    occurrences.set(key, occurrence + 1)
    const lane = (occurrence - (count - 1) / 2) * Math.min(1, 4 / Math.max(1, count - 1))
    const geometry = edgeGeometry(edge, index, positions, lane)
    if (!geometry) return
    edgePaths.set(edge.id, geometry)
    left = Math.min(left, geometry.bounds.left); top = Math.min(top, geometry.bounds.top)
    right = Math.max(right, geometry.bounds.right); bottom = Math.max(bottom, geometry.bounds.bottom)
  })
  return {
    positions, edgePaths,
    dimensions: { x: Math.floor(left) - 16, y: Math.floor(top) - 16, width: Math.ceil(right - left) + 32, height: Math.ceil(bottom - top) + 32 },
  }
}

/** Prefer an application with actual cases, without assigning meaning from its name. */
export function defaultGraphIndex(items) {
  const runtime = items.findIndex(item => isRuntimeGraph(item.graph) && item.graph.runs?.length)
  if (runtime >= 0) return runtime
  const recorded = items.findIndex(item => item.graph.runs?.length)
  return recorded >= 0 ? recorded : 0
}

/** Preserve component and visit identity. A missing visit does not silently select another. */
export function preserveCaseSelection(graph, selection, nextRunId) {
  const nodeId = graph.nodes.some(node => node.id === selection.nodeId) ? selection.nodeId : null
  const previous = (graph.runs || []).find(run => run.id === selection.runId)
  const next = (graph.runs || []).find(run => run.id === nextRunId)
  const oldVisits = nodeId && previous ? nodeOccurrences(graph, previous, nodeId) : []
  const oldOrdinal = oldVisits.findIndex(entry => entry.index === selection.observationIndex)
  const visitOrdinal = nodeId ? oldOrdinal >= 0 ? oldOrdinal + 1 : selection.visitOrdinal || 1 : null
  const visits = nodeId && next ? nodeOccurrences(graph, next, nodeId) : []
  const observation = visits[(visitOrdinal || 1) - 1]
  return {
    nodeId, runId: next?.id ?? null, visitOrdinal,
    observationIndex: Number.isSafeInteger(observation?.index) ? observation.index : null,
  }
}

/** Component selection also updates the remembered case while Overview is visible. */
export function componentSelection(graph, selection, nodeId) {
  const changed = selection.nodeId !== nodeId
  return preserveCaseSelection(graph, {
    ...selection, nodeId,
    observationIndex: changed ? null : selection.observationIndex,
    visitOrdinal: changed ? 1 : selection.visitOrdinal,
  }, selection.runId)
}

/** Never present a retained observation under another component's inspector. */
export function selectedCaseObservation(graph, run, selection) {
  return (run?.observations || []).find(entry => entry && typeof entry === 'object' &&
    entry.index === selection.observationIndex &&
    (selection.nodeId ? entry.nodeId === selection.nodeId : !graph.nodes.some(node => node.id === entry.nodeId)))
}

/** The copied case excerpt must retain a missing selected visit as an explicit gap. */
export function selectedInvestigationContext(item, selection) {
  const context = investigationContext(item, selection)
  const run = (item.graph.runs || []).find(value => value.id === selection.runId)
  const visits = nodeOccurrences(item.graph, run, selection.nodeId)
  const gap = run && selection.nodeId && Number.isSafeInteger(selection.visitOrdinal) &&
    selection.visitOrdinal > 0 && selection.observationIndex === null && !visits[selection.visitOrdinal - 1]
  return gap ? 'Selection gap: requested visit ' + selection.visitOrdinal + ' of component ' + selection.nodeId +
    ' is not retained in this case. Any included observations are other available visits.\n\n' + context : context
}

/** Bound ordinary snapshot data before serialization; accessors and custom objects are not data. */
function validateSnapshotData(value) {
  const pending = [{ value, depth: 0, leave: false }], ancestors = new Set()
  let entries = 0, textLength = 0
  while (pending.length) {
    const frame = pending.pop(), current = frame.value
    if (frame.leave) { ancestors.delete(current); continue }
    if (++entries > 250000 || frame.depth > 64) throw new TypeError('Snapshot exceeds the viewer data limits.')
    if (current === null || current === undefined || typeof current === 'boolean') continue
    if (typeof current === 'string') {
      textLength += current.length
      if (textLength > 16 * 1024 * 1024) throw new TypeError('Snapshot exceeds the viewer text limit.')
      continue
    }
    if (typeof current === 'number' && Number.isFinite(current)) continue
    if (typeof current !== 'object') throw new TypeError('Snapshot must contain ordinary JSON data.')
    const prototype = Object.getPrototypeOf(current)
    if (!Array.isArray(current) && prototype !== Object.prototype && prototype !== null) throw new TypeError('Snapshot must contain ordinary JSON objects.')
    if (ancestors.has(current)) throw new TypeError('Snapshot data must not contain cycles.')
    ancestors.add(current)
    pending.push({ value: current, depth: frame.depth, leave: true })
    const descriptors = Object.getOwnPropertyDescriptors(current)
    const keys = Reflect.ownKeys(descriptors)
    if (keys.length + entries + pending.length > 250000) throw new TypeError('Snapshot exceeds the viewer data limits.')
    for (const key of keys) {
      const descriptor = descriptors[key]
      if (typeof key !== 'string' || !Object.hasOwn(descriptor, 'value')) throw new TypeError('Snapshot data must not contain accessors or symbol keys.')
      textLength += key.length
      pending.push({ value: descriptor.value, depth: frame.depth + 1, leave: false })
    }
  }
}

function validateGraphs(items) {
  validateSnapshotData(items)
  if (!Array.isArray(items) || items.length === 0 || items.length > 64) throw new TypeError('Supply between one and 64 graph examples.')
  for (const item of items) {
    const graph = item?.graph
    if (!item || typeof item.title !== 'string' || !graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) throw new TypeError('Each example needs a title and a graph with nodes and edges.')
    if (graph.nodes.length > 4096 || graph.edges.length > 16384) throw new TypeError('Graph exceeds the viewer limits.')
    const ids = new Set(), edgeIds = new Set()
    for (const node of graph.nodes) {
      if (!node || typeof node.id !== 'string' || !node.id || ids.has(node.id) || typeof node.kind !== 'string' || !node.kind) throw new TypeError('Graph nodes need unique string IDs and a kind.')
      if (node.runnable !== undefined && typeof node.runnable !== 'boolean') throw new TypeError('Node runnable flags must be boolean.')
      if (['label', 'name', 'description', 'descriptionSource'].some(key => node[key] !== undefined && typeof node[key] !== 'string')) throw new TypeError('Node labels and descriptions must be strings.')
      if (['declaredExits', 'exits'].some(key => node[key] !== undefined && !Array.isArray(node[key]))) throw new TypeError('Node scope exits must be arrays.')
      ids.add(node.id)
    }
    for (const edge of graph.edges) {
      if (!edge || typeof edge.id !== 'string' || !edge.id || edgeIds.has(edge.id) || !ids.has(edge.source ?? edge.from) || !ids.has(edge.target ?? edge.to) || typeof edge.meaning !== 'string') throw new TypeError('Graph edges need unique IDs, known endpoints, and a meaning.')
      if (['label', 'slot', 'action'].some(key => edge[key] !== undefined && edge[key] !== null && typeof edge[key] !== 'string')) throw new TypeError('Edge labels must be strings.')
      edgeIds.add(edge.id)
    }
    if (graph.warnings !== undefined && (!Array.isArray(graph.warnings) || graph.warnings.some(warning => typeof warning !== 'string' && (!warning || typeof (warning.message ?? warning.code) !== 'string')))) throw new TypeError('Graph warnings must contain text diagnostics.')
    if (graph.scopes !== undefined && (!Array.isArray(graph.scopes) || graph.scopes.some(scope => !scope || !Array.isArray(scope.declaredExits ?? scope.exits ?? []) || (scope.declaredExits ?? scope.exits ?? []).some(exit => typeof exit !== 'string')))) throw new TypeError('Scope exits must contain strings.')
    for (const node of graph.nodes) if (!Array.isArray(scopeExits(graph, node)) || scopeExits(graph, node).some(exit => typeof exit !== 'string')) throw new TypeError('Node scope exits must contain strings.')
    if (graph.runs !== undefined && (!Array.isArray(graph.runs) || graph.runs.length > 64)) throw new TypeError('A graph can contain at most 64 recorded cases.')
    const runIds = new Set()
    for (const run of graph.runs || []) {
      if (!run || typeof run !== 'object' || typeof run.id !== 'string' || !run.id || runIds.has(run.id)) throw new TypeError('Recorded cases need unique string IDs.')
      runIds.add(run.id)
      if (['label', 'name', 'title', 'status', 'outcome', 'summary'].some(key => run[key] !== undefined && typeof run[key] !== 'string')) throw new TypeError('Recorded case labels and summaries must be strings.')
      if (run.nodeCounts !== undefined && (!run.nodeCounts || typeof run.nodeCounts !== 'object' || Array.isArray(run.nodeCounts) || Object.entries(run.nodeCounts).some(([id, count]) => !ids.has(id) || !Number.isSafeInteger(count) || count < 0))) throw new TypeError('Recorded node counts must name graph nodes and contain nonnegative integers.')
      if (run.observations !== undefined && (!Array.isArray(run.observations) || run.observations.length > 4096)) throw new TypeError('A recorded case can contain at most 4096 observations.')
      const indexes = new Set(), occurrences = new Set()
      for (const entry of run.observations || []) {
        if (typeof entry === 'string') continue
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new TypeError('Recorded observations must contain data records.')
        if (['label', 'nodeId', 'occurrenceId', 'action', 'kind'].some(key => entry[key] !== undefined && typeof entry[key] !== 'string')) throw new TypeError('Observation identities and actions must be strings.')
        {
          if (!Number.isSafeInteger(entry.index) || entry.index < 1 || indexes.has(entry.index)) throw new TypeError('Observation indexes must be distinct positive integers within a case.')
          indexes.add(entry.index)
        }
        if (entry.nodeId !== undefined && !ids.has(entry.nodeId)) throw new TypeError('Observation node IDs must identify graph components.')
        if (entry.occurrenceId !== undefined) {
          if (!entry.occurrenceId || occurrences.has(entry.occurrenceId)) throw new TypeError('Occurrence IDs must be distinct within a case.')
          occurrences.add(entry.occurrenceId)
        }
        if (entry.conditions !== undefined && (!Array.isArray(entry.conditions) || entry.conditions.length > 64)) throw new TypeError('An observation can contain at most 64 evaluated conditions.')
        for (const condition of entry.conditions || []) {
          if (!condition || typeof condition !== 'object' || typeof condition.result !== 'boolean' || ['id', 'label', 'expression'].some(key => typeof condition[key] !== 'string') || !condition.values || typeof condition.values !== 'object' || Array.isArray(condition.values)) throw new TypeError('Recorded conditions need text, operand values, and a boolean result.')
        }
      }
    }
    if (item.revision !== undefined && typeof item.revision !== 'string') throw new TypeError('Source revisions must be strings.')
    if (graph.provenance?.roots !== undefined && (!Array.isArray(graph.provenance.roots) || graph.provenance.roots.some(id => typeof id !== 'string'))) throw new TypeError('Graph root inventories must contain strings.')
    if ([graph.entry, graph.root, graph.provenance?.root].some(id => id !== undefined && !ids.has(id))) throw new TypeError('A selected graph root must identify a known node.')
  }
}

/** Browser code consumes the same pure helpers as the Node-side tests. It performs no network IO. */
function startExplorer() {
  const DATA = JSON.parse(document.getElementById('graph-data').textContent)
  const $ = id => document.getElementById(id), NS = 'http://www.w3.org/2000/svg'
  const h = (tag, text, className) => {
    const element = document.createElement(tag)
    if (text !== undefined) element.textContent = String(text)
    if (className) element.className = className
    return element
  }
  const svg = (tag, attributes = {}, text) => {
    const element = document.createElementNS(NS, tag)
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value))
    if (text !== undefined) element.textContent = String(text)
    return element
  }
  const button = (text, action, className = 'button', key) => {
    const element = h('button', text, className)
    element.type = 'button'
    if (key) element.dataset.focusKey = key
    element.addEventListener('click', action)
    return element
  }
  const short = (value, length = 38) => {
    const text = String(value ?? '')
    return text.length > length ? text.slice(0, length - 1) + '…' : text
  }
  const label = value => value?.label || value?.name || value?.title || value?.id || 'Unattributed observation'
  const json = value => value === undefined ? 'Not captured' : JSON.stringify(value, null, 2)
  const own = (value, key) => value !== null && typeof value === 'object' && Object.hasOwn(value, key)
  const edgeFrom = edge => edge.source ?? edge.from, edgeTo = edge => edge.target ?? edge.to
  const memories = DATA.map(item => ({
    mode: 'overview', nodeId: null, inspectorOpen: false, runId: item.graph.runs?.[0]?.id ?? null,
    compare: false, compareRunId: item.graph.runs?.[1]?.id ?? null, side: 'left',
    observationIndex: null, visitOrdinal: null, view: null,
  }))
  let current = defaultGraphIndex(DATA), positions = new Map(), edgePaths = new Map(), dimensions, drag = null
  const state = () => memories[current]
  const item = () => DATA[current]
  const graph = () => item().graph
  const runs = () => graph().runs || []
  const runById = id => runs().find(run => run.id === id)
  const rememberedRun = () => runById(state().compare && state().side === 'right' ? state().compareRunId : state().runId)
  const activeRun = () => state().mode === 'cases' ? rememberedRun() : undefined
  const observation = () => selectedCaseObservation(graph(), activeRun(), state())
  const selectedNode = () => graph().nodes.find(node => node.id === state().nodeId)
  const notify = text => { $('status').textContent = text }
  const paragraph = (parent, text, className = 'muted') => parent.append(h('p', text, className))
  const heading = (parent, text, level = 'h3') => { const element = h(level, text); parent.append(element); return element }
  const disclosure = (parent, title, content) => {
    const details = h('details', undefined, 'disclosure')
    details.append(h('summary', title))
    if (content) details.append(content)
    parent.append(details)
    return details
  }
  const codeBlock = (value, name, className = '') => {
    const pre = h('pre', json(value), 'json ' + className)
    pre.tabIndex = 0
    pre.setAttribute('aria-label', name)
    return pre
  }
  function keepFocus(render) {
    const focused = document.activeElement, key = focused?.dataset?.focusKey
    render()
    if (key && !focused.isConnected) {
      const next = [...document.querySelectorAll('[data-focus-key]')].find(element => element.dataset.focusKey === key)
      next?.focus({ preventScroll: true })
    }
  }
  function sourceText(source) {
    if (typeof source === 'string') return source
    if (!source || typeof source !== 'object') return ''
    const path = source.path || source.file
    if (!path) return source.symbol || ''
    return path + (source.line ? ':' + source.line + (source.column ? ':' + source.column : '') : '') + (source.symbol ? ' · ' + source.symbol : '')
  }
  function sourceBlock(parent, source) {
    const text = sourceText(source)
    if (!text) return
    const box = h('div', undefined, 'source-location')
    box.append(h('span', 'Source', 'eyebrow'), h('code', text))
    parent.append(box)
  }
  function description(node) {
    if (node.description) return node.description
    if (node.reason) return node.reason
    if (node.kind === 'binding') return 'A configured use of this package. Its routes stay distinct from other bindings of the same package.'
    if (node.kind === 'grant') return 'A configured host resource. Its policy values and credentials are omitted.'
    if (node.kind === 'unknown') return 'The supplied declarations do not establish this target.'
    if (node.kind === 'external') return 'This package is referenced, but its contents are outside this source snapshot.'
    return isRuntimeGraph(graph()) ? 'An element in the runtime’s declared structure.' : 'A reusable method. Its internal ordering and decisions are not captured in this view.'
  }
  function visitCounts(run) {
    const counts = new Map()
    for (const entry of run?.observations || []) if (entry && typeof entry === 'object' && graph().nodes.some(node => node.id === entry.nodeId)) counts.set(entry.nodeId, (counts.get(entry.nodeId) || 0) + 1)
    return counts
  }
  function enterCase(side, runId) {
    const previous = activeRun(), next = runById(runId)
    const selection = preserveCaseSelection(graph(), {
      nodeId: state().nodeId, runId: previous?.id, observationIndex: state().observationIndex, visitOrdinal: state().visitOrdinal,
    }, next?.id)
    if (side === 'right') state().compareRunId = next?.id ?? null
    else state().runId = next?.id ?? null
    Object.assign(state(), { side, nodeId: selection.nodeId, observationIndex: selection.observationIndex, visitOrdinal: selection.visitOrdinal })
    keepFocus(render)
  }
  function selectObservation(run, entry, side) {
    if (!Number.isSafeInteger(entry?.index)) return
    state().mode = 'cases'
    state().side = side
    state().nodeId = graph().nodes.some(node => node.id === entry.nodeId) ? entry.nodeId : null
    state().observationIndex = entry.index
    state().visitOrdinal = state().nodeId ? nodeOccurrences(graph(), run, state().nodeId).findIndex(value => value.index === entry.index) + 1 : null
    state().inspectorOpen = true
    keepFocus(render)
    notify(label(entry) + ', recorded observation ' + entry.index + (state().visitOrdinal ? ', visit ' + state().visitOrdinal : ''))
    revealInspector()
  }
  function selectNode(nodeId) {
    const selection = componentSelection(graph(), {
      nodeId: state().nodeId, runId: rememberedRun()?.id,
      observationIndex: state().observationIndex, visitOrdinal: state().visitOrdinal,
    }, nodeId)
    Object.assign(state(), { nodeId: selection.nodeId, observationIndex: selection.observationIndex, visitOrdinal: selection.visitOrdinal })
    state().inspectorOpen = true
    keepFocus(render)
    revealInspector()
  }
  function revealInspector() {
    if (window.matchMedia('(max-width: 1000px)').matches) $('inspector').scrollIntoView({ block: 'start', behavior: 'auto' })
  }
  function closeInspector() {
    state().inspectorOpen = false
    render()
    const target = [...$('canvas').querySelectorAll('[data-focus-key]')].find(element => element.dataset.focusKey === 'node:' + state().nodeId)
    target?.focus({ preventScroll: true })
    if (window.matchMedia('(max-width: 1000px)').matches) $('diagram-wrap').scrollIntoView({ block: 'start', behavior: 'auto' })
  }
  function changeMode(mode) {
    state().mode = mode
    keepFocus(render)
  }
  function setComparison(enabled) {
    if (!enabled && state().side === 'right') {
      const selection = preserveCaseSelection(graph(), {
        nodeId: state().nodeId, runId: activeRun()?.id, observationIndex: state().observationIndex, visitOrdinal: state().visitOrdinal,
      }, state().runId)
      Object.assign(state(), { nodeId: selection.nodeId, observationIndex: selection.observationIndex, visitOrdinal: selection.visitOrdinal })
    }
    state().compare = enabled
    state().side = 'left'
    keepFocus(render)
  }
  function applyView() {
    const view = state().view || dimensions
    $('diagram').setAttribute('viewBox', [view.x, view.y, view.width, view.height].join(' '))
  }
  function fit() { state().view = { ...dimensions }; applyView() }
  function zoom(factor) {
    const view = state().view || dimensions, width = view.width * factor, height = view.height * factor
    if (width < 200 || width > dimensions.width * 5) return
    state().view = { x: view.x + (view.width - width) / 2, y: view.y + (view.height - height) / 2, width, height }
    applyView()
  }
  function fitText(element, width) {
    if (element.getComputedTextLength() > width) {
      element.setAttribute('textLength', width)
      element.setAttribute('lengthAdjust', 'spacingAndGlyphs')
    }
  }
  function draw() {
    const g = graph(), layer = $('canvas'), mode = state().mode, comparing = mode === 'cases' && state().compare
    const left = mode === 'cases' ? visitCounts(runById(state().runId)) : new Map()
    const right = comparing ? visitCounts(runById(state().compareRunId)) : new Map()
    layer.replaceChildren()
    for (const edge of g.edges) {
      const geometry = edgePaths.get(edge.id)
      if (!geometry) continue
      const related = state().nodeId && (edgeFrom(edge) === state().nodeId || edgeTo(edge) === state().nodeId)
      const className = ['edge', related ? 'related' : '', edge.meaning === 'scope-entry' ? 'scope-entry' : '', String(edge.evidence).includes('unmapped') ? 'unresolved' : ''].join(' ')
      const path = svg('path', { d: geometry.path, class: className, 'marker-end': related ? 'url(#arrow-related)' : 'url(#arrow)' })
      path.append(svg('title', {}, edgeLabel(edge) + ' · ' + edge.meaning))
      layer.append(path, svg('text', { x: geometry.labelX, y: geometry.labelY, 'text-anchor': 'middle', class: 'edge-label', 'data-fit-width': geometry.labelWidth }, short(edgeLabel(edge), 27)))
    }
    g.nodes.forEach((node, index) => {
      const position = positions.get(node.id), a = left.get(node.id) || 0, b = right.get(node.id) || 0
      const selected = state().nodeId === node.id, observed = a > 0 || b > 0
      const className = ['graph-node', selected ? 'selected' : '', observed ? 'observed' : '', comparing && a > 0 && b > 0 ? 'both-cases' : '', comparing && b > 0 && a === 0 ? 'case-b-only' : ''].join(' ')
      const countText = comparing ? 'A ' + a + ' · B ' + b : a + ' recorded ' + (a === 1 ? 'entry' : 'entries')
      const group = svg('g', {
        class: className, transform: 'translate(' + position.x + ',' + position.y + ')', role: 'button',
        tabindex: selected || (!state().nodeId && index === 0) ? '0' : '-1', 'aria-pressed': String(selected),
        'aria-label': label(node) + ', ' + displayNodeKind(node, g) + (mode === 'cases' ? ', ' + countText : ''),
      })
      group.dataset.focusKey = 'node:' + node.id
      const color = node.kind === 'binding' ? '#7262a1' : node.kind === 'grant' ? '#a57a35' : ['unknown', 'external'].includes(node.kind) ? '#8b9396' : '#337c70'
      group.append(svg('rect', { width: 200, height: 81, rx: 12, class: 'node' }))
      group.append(svg('rect', { x: 13, y: 13, width: 24, height: 24, rx: 7, fill: color }))
      group.append(svg('text', { x: 25, y: 30, 'text-anchor': 'middle', class: 'node-symbol' }, node.kind === 'binding' ? 'B' : node.kind === 'grant' ? '↗' : node.kind === 'unknown' ? '?' : node.kind === 'flow' && isRuntimeGraph(g) ? '◇' : 'ƒ'))
      group.append(svg('text', { x: 45, y: 25, class: 'node-kind' }, displayNodeKind(node, g).toUpperCase()))
      group.append(svg('text', { x: 14, y: 51, class: 'node-title' }, short(label(node), 28)))
      const subtitle = node.packagePath || node.package || (node.kind === 'flow' && isRuntimeGraph(g) ? 'Declared scope' : node.kind === 'node' ? 'Runtime step' : sourceText(nodeSource(node)) || node.id)
      group.append(svg('text', { x: 14, y: 68, class: 'node-subtitle' }, short(subtitle, 34)))
      if (observed) {
        const text = comparing ? 'A ' + (a > 99 ? '99+' : a) + '  B ' + (b > 99 ? '99+' : b) : (a > 999 ? '999+' : a) + '×'
        const width = comparing ? 79 : 34, x = 202 - width
        group.append(svg('rect', { x, y: -12, width, height: 24, rx: 12, class: 'node-count' }))
        group.append(svg('text', { x: x + width / 2, y: 4, 'text-anchor': 'middle', class: 'node-count-text' }, text))
      }
      group.append(svg('title', {}, label(node) + '\n' + description(node)))
      group.addEventListener('click', () => selectNode(node.id))
      group.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectNode(node.id); return }
        const directions = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }
        if (own(directions, event.key)) {
          event.preventDefault()
          const next = (index + directions[event.key] + g.nodes.length) % g.nodes.length
          layer.querySelectorAll('.graph-node')[next]?.focus()
        }
      })
      layer.append(group)
    })
    for (const text of layer.querySelectorAll('.node-title,.node-subtitle')) fitText(text, 174)
    for (const text of layer.querySelectorAll('.edge-label')) fitText(text, Number(text.getAttribute('data-fit-width')) || 200)
    $('empty-graph').hidden = g.nodes.length !== 0
    applyView()
  }

  function changesTable(parent, diff, emptyText, labels = ['Before', 'After']) {
    if (!diff.changes.length) {
      paragraph(parent, diff.truncated ? 'The comparison reached its bound before establishing a difference.' : emptyText)
      return
    }
    const wrapper = h('div', undefined, 'table-scroll'), table = h('table', undefined, 'changes')
    const head = h('thead'), row = h('tr')
    for (const text of ['Field', ...labels]) {
      const th = h('th', text); th.scope = 'col'; row.append(th)
    }
    head.append(row); table.append(head)
    const body = h('tbody')
    for (const change of diff.changes) {
      const tr = h('tr'), path = h('th')
      path.scope = 'row'; path.append(h('code', change.path || '(root)')); tr.append(path)
      for (const side of ['before', 'after']) {
        const cell = h('td')
        if (!change[side + 'Present']) cell.append(h('span', 'Not present', 'not-present'))
        else {
          const value = json(change[side]), code = h('code', short(value, 260))
          if (value.length > 260) code.title = value
          cell.append(code)
        }
        tr.append(cell)
      }
      body.append(tr)
    }
    table.append(body); wrapper.append(table); parent.append(wrapper)
    if (diff.truncated) paragraph(parent, 'The comparison is bounded. Additional differences may be present.', 'small muted')
  }
  function conditionCards(parent, entry) {
    heading(parent, 'Evaluated conditions')
    if (!entry.conditions?.length) {
      paragraph(parent, 'No condition evaluations were recorded for this visit.')
      return
    }
    paragraph(parent, 'These checks were recorded during this visit. Unrecorded checks are not treated as false.', 'small muted')
    for (const condition of entry.conditions) {
      const card = h('article', undefined, 'condition')
      const title = h('div', undefined, 'condition-title')
      title.append(h('strong', condition.label), h('span', condition.result ? 'true' : 'false', 'result-pill ' + (condition.result ? 'true' : 'false')))
      card.append(title, h('code', condition.expression, 'expression'))
      const operands = h('dl', undefined, 'operands')
      for (const [name, value] of Object.entries(condition.values)) operands.append(h('dt', name), h('dd', json(value)))
      card.append(operands)
      parent.append(card)
    }
  }
  function visitNavigation(parent, node, run) {
    const visits = nodeOccurrences(graph(), run, node.id)
    if (!visits.length) {
      paragraph(parent, 'No handler entry for this component is retained in this case.', 'empty-note')
      return
    }
    const ordinal = state().visitOrdinal || 1, currentEntry = observation()
    const toolbar = h('div', undefined, 'visit-navigation')
    const labelText = currentEntry ? 'Visit ' + ordinal + ' of ' + visits.length : 'Requested visit ' + ordinal + ' is not captured'
    toolbar.append(h('strong', labelText))
    const controls = h('div', undefined, 'compact-controls')
    const previous = button('←', () => {
      const index = Math.min(visits.length - 1, ordinal - 2)
      if (visits[index]) selectObservation(run, visits[index], state().side)
    }, 'icon-button', 'previous-visit')
    previous.setAttribute('aria-label', 'Previous recorded visit to this component')
    previous.disabled = ordinal <= 1
    const next = button('→', () => {
      if (visits[ordinal]) selectObservation(run, visits[ordinal], state().side)
    }, 'icon-button', 'next-visit')
    next.setAttribute('aria-label', 'Next recorded visit to this component')
    next.disabled = ordinal >= visits.length
    controls.append(previous, next)
    toolbar.append(controls); parent.append(toolbar)
    if (!currentEntry) paragraph(parent, visits.length + ' ' + (visits.length === 1 ? 'visit is' : 'visits are') + ' recorded. Choose an available visit below.', 'small muted')
    if (visits.length > 1 || !currentEntry) {
      const picker = h('div', undefined, 'visit-picks')
      visits.forEach((entry, index) => {
        if (!Number.isSafeInteger(entry.index)) return
        const pick = button('Visit ' + (index + 1), () => selectObservation(run, entry, state().side), 'visit-pick', 'visit:' + entry.index)
        pick.setAttribute('aria-pressed', String(entry.index === currentEntry?.index))
        picker.append(pick)
      })
      parent.append(picker)
    }
  }
  function observationDetails(parent, entry, run) {
    const position = run.observations.findIndex(value => value === entry)
    const navigation = h('div', undefined, 'observation-navigation')
    navigation.append(h('span', 'Recorded entry ' + (position + 1) + ' of ' + run.observations.length, 'eyebrow'))
    const controls = h('div', undefined, 'compact-controls')
    const previous = button('←', () => selectObservation(run, run.observations[position - 1], state().side), 'icon-button', 'previous-observation')
    previous.setAttribute('aria-label', 'Previous recorded observation')
    previous.disabled = position <= 0 || !Number.isSafeInteger(run.observations[position - 1]?.index)
    const next = button('→', () => selectObservation(run, run.observations[position + 1], state().side), 'icon-button', 'next-observation')
    next.setAttribute('aria-label', 'Next recorded observation')
    next.disabled = position >= run.observations.length - 1 || !Number.isSafeInteger(run.observations[position + 1]?.index)
    controls.append(previous, next); navigation.append(controls); parent.append(navigation)
    conditionCards(parent, entry)
    if (own(entry, 'action')) {
      const action = h('div', undefined, 'recorded-action')
      action.append(h('span', 'Emitted action', 'eyebrow'), h('code', entry.action))
      parent.append(action)
      paragraph(parent, 'The recorded emission does not identify a traversed graph edge.', 'small muted')
    }
    if (own(entry, 'terminal')) {
      heading(parent, 'Terminal value recorded')
      parent.append(codeBlock(entry.terminal, 'Terminal value recorded by the selected handler'))
    }
    heading(parent, 'Captured state changes')
    if (own(entry, 'before') && own(entry, 'after')) {
      changesTable(parent, valueChanges(entry.before, entry.after), 'No change in the captured fields.')
      const snapshots = h('div', undefined, 'snapshot-pair')
      heading(snapshots, 'Before', 'h4'); snapshots.append(codeBlock(entry.before, 'Captured state before the selected handler'))
      heading(snapshots, 'After', 'h4'); snapshots.append(codeBlock(entry.after, 'Captured state after the selected handler'))
      disclosure(parent, 'Full before and after snapshots', snapshots)
    } else {
      paragraph(parent, 'A complete before/after pair was not captured for this observation.', 'empty-note')
      if (own(entry, 'before')) disclosure(parent, 'Available before snapshot', codeBlock(entry.before, 'Available before snapshot'))
      if (own(entry, 'after')) disclosure(parent, 'Available after snapshot', codeBlock(entry.after, 'Available after snapshot'))
    }
    sourceBlock(parent, entry.source)
  }
  function routeDetails(parent, node) {
    const routes = graph().edges.filter(edge => edgeFrom(edge) === node.id)
    if (routes.length) {
      heading(parent, isRuntimeGraph(graph()) ? 'Declared connections' : 'Available calls')
      for (const edge of routes) {
        const target = graph().nodes.find(value => value.id === edgeTo(edge))
        const route = button('', () => selectNode(edgeTo(edge)), 'route-button', 'route:' + edge.id)
        route.append(h('code', edgeLabel(edge)), h('span', label(target)), h('span', '↗', 'route-symbol'))
        route.setAttribute('aria-label', edgeLabel(edge) + ': inspect ' + label(target))
        parent.append(route)
        if (edge.attachments) paragraph(parent, 'File ports: ' + Object.keys(edge.attachments).join(', '), 'small muted')
      }
      paragraph(parent, isRuntimeGraph(graph()) ? 'These connections come from the declared structure.' : 'A call may use its configured slot. Ordering and use are not established here.', 'small muted')
    }
    const exits = scopeExits(graph(), node)
    if (exits.length) {
      heading(parent, 'Declared scope exits')
      const pills = h('div', undefined, 'pills')
      for (const exit of exits) pills.append(h('code', exit, 'pill'))
      parent.append(pills)
      paragraph(parent, 'The compiled description does not identify each callback that can emit these exits.', 'small muted')
    }
  }
  function renderInspector() {
    const panel = $('inspector'), content = $('inspector-content'), node = selectedNode(), entry = observation(), run = activeRun()
    const open = state().inspectorOpen && Boolean(node || entry)
    panel.hidden = !open
    $('workspace').classList.toggle('inspecting', open)
    if (!open) return
    content.replaceChildren()
    $('inspector-title').textContent = node ? label(node) : label(entry)
    $('inspector-kind').textContent = node ? displayNodeKind(node, graph()) : 'Unattributed observation'
    if (node) {
      paragraph(content, description(node), 'component-description')
      if (node.descriptionSource) paragraph(content, node.descriptionSource === 'package-metadata' ? 'Description supplied by the package.' : node.descriptionSource === 'probe-authored' ? 'Description supplied by the probe.' : 'Description source: ' + node.descriptionSource, 'small muted')
      if (node.reason && node.description) paragraph(content, node.reason, 'small muted')
      if (node.runnable === false) paragraph(content, 'This package is not a direct Run target in the lock. A binding may configure another use.', 'small muted')
    }
    if (run) {
      const capture = h('div', undefined, 'inspector-capture')
      capture.append(h('span', state().compare ? (state().side === 'right' ? 'Case B' : 'Case A') : 'Recorded case', 'eyebrow'), h('strong', label(run)))
      content.append(capture)
      if (node) visitNavigation(content, node, run)
      if (entry) observationDetails(content, entry, run)
    }
    if (node) {
      const routes = h('div')
      routeDetails(routes, node)
      if (run && entry) disclosure(content, 'Component connections', routes)
      else content.append(routes)
      if (!entry || !sourceText(entry.source)) sourceBlock(content, nodeSource(node))
      const identity = h('div')
      heading(identity, 'Component ID', 'h4'); identity.append(h('code', node.id))
      if (node.packagePath) { heading(identity, 'Package', 'h4'); identity.append(h('code', node.packagePath)) }
      if (node.packageDigest) {
        heading(identity, 'Recorded package digest', 'h4'); identity.append(h('code', node.packageDigest))
        paragraph(identity, 'This viewer has not verified the package bytes.', 'small muted')
      }
      disclosure(content, 'Component identity', identity)
    }
    const gaps = evidenceGaps(graph(), { nodeId: node?.id, run })
    if (gaps.length) {
      const list = h('ul', undefined, 'evidence-list')
      for (const gap of gaps) list.append(h('li', gap))
      disclosure(content, 'What this capture cannot show', list)
    }
  }
  function dataCard(parent, title, value, available, name) {
    const card = h('section', undefined, 'data-card')
    heading(card, title)
    if (available) card.append(codeBlock(value, name))
    else paragraph(card, title === 'Input supplied' ? 'Input values were not captured.' : 'No separate output value was captured.', 'empty-note')
    parent.append(card)
    return card
  }
  function observationList(parent, run, side, prefix = 0, firstDifference = null) {
    const list = h('ol', undefined, 'observation-list')
    const counts = visitCounts(run), seen = new Map()
    for (const [position, entry] of (run.observations || []).entries()) {
      const row = h('li', undefined, position < prefix ? 'shared' : position + 1 === firstDifference ? 'divergent' : '')
      const attributed = entry && typeof entry === 'object', nodeId = attributed ? entry.nodeId : undefined
      const ordinal = nodeId ? (seen.get(nodeId) || 0) + 1 : 0
      if (nodeId) seen.set(nodeId, ordinal)
      const interactive = attributed && Number.isSafeInteger(entry.index)
      const content = interactive ? button('', () => selectObservation(run, entry, side), 'observation-button', 'observation:' + side + ':' + entry.index) : h('div', undefined, 'observation-button unavailable')
      const selected = interactive && activeRun()?.id === run.id && state().side === side && state().observationIndex === entry.index
      if (interactive) content.setAttribute('aria-pressed', String(selected))
      content.append(h('span', String(position + 1).padStart(2, '0'), 'observation-number'))
      const copy = h('span', undefined, 'observation-copy')
      copy.append(h('strong', attributed ? label(entry) : entry))
      let detail = !attributed || !nodeId ? 'Unattributed observation' : entry.kind === 'handler-enter' ? 'Handler entered' : entry.kind || 'Recorded observation'
      if (attributed && own(entry, 'action')) detail = 'Emitted ' + entry.action
      else if (attributed && own(entry, 'terminal')) detail = 'Recorded terminal' + (typeof entry.terminal?.outcome === 'string' ? ': ' + entry.terminal.outcome : '')
      copy.append(h('small', detail))
      content.append(copy)
      if ((counts.get(nodeId) || 0) > 1) content.append(h('span', 'visit ' + ordinal, 'visit-label'))
      if (interactive) content.setAttribute('aria-label', 'Observation ' + (position + 1) + ': ' + label(entry) + (ordinal ? ', visit ' + ordinal : '') + ', ' + detail)
      row.append(content); list.append(row)
    }
    if (!(run.observations || []).length) paragraph(parent, 'No handler observations are retained for this case.', 'empty-note')
    else parent.append(list)
  }
  function caseHeading(parent, run, side) {
    const top = h('div', undefined, 'case-heading'), title = h('div')
    title.append(h('span', state().compare ? 'Case ' + (side === 'left' ? 'A' : 'B') : 'Captured execution', 'eyebrow'))
    heading(title, label(run), 'h2')
    top.append(title)
    if (run.outcome) top.append(h('span', run.outcome, 'outcome-pill'))
    parent.append(top)
    if (run.summary) paragraph(parent, run.summary, 'case-summary')
    else paragraph(parent, (run.observations || []).length + ' recorded observations' + (run.status ? ' · ' + run.status : ''), 'case-summary')
  }
  function renderSingleCase(parent, run) {
    caseHeading(parent, run, 'left')
    const layout = h('div', undefined, 'case-layout'), timeline = h('section', undefined, 'timeline-panel'), data = h('div', undefined, 'case-values')
    heading(timeline, 'Recorded observations')
    paragraph(timeline, 'Select a visit to inspect its conditions and captured state.', 'small muted')
    observationList(timeline, run, 'left')
    dataCard(data, 'Input supplied', run.input, own(run, 'input'), 'Input supplied to this recorded case')
    const output = dataCard(data, 'Output returned', run.output, own(run, 'output'), 'Output captured from this recorded case')
    if (own(run, 'result')) disclosure(output, 'Full runtime result', codeBlock(run.result, 'Full recorded runtime result'))
    layout.append(timeline, data); parent.append(layout)
  }
  function comparisonHint(parent, title, detail, action) {
    const box = h('div', undefined, 'comparison-hint')
    box.append(h('strong', title), h('p', detail))
    if (action) box.append(button('Inspect this difference', action, 'text-button'))
    parent.append(box)
  }
  function captureDifferences(parent, left, right, key, difference) {
    const presentA = own(left, key), presentB = own(right, key)
    if (!presentA && !presentB) paragraph(parent, 'No ' + key + ' values are available to compare.')
    else if (!presentA || !presentB) paragraph(parent, 'Incomplete capture: case ' + (presentA ? 'B' : 'A') + ' has no separate ' + key + ' value. A value comparison is unavailable.')
    else changesTable(parent, difference, 'No differences in captured ' + key + ' values.', ['Case A', 'Case B'])
  }
  function renderComparison(parent, left, right) {
    const comparison = caseComparison(graph(), left, right)
    const header = h('div', undefined, 'case-heading')
    heading(header, 'Compare recorded cases', 'h2')
    header.append(h('span', 'A / B', 'comparison-mark')); parent.append(header)
    const hints = h('div', undefined, 'comparison-hints')
    const same = left.id === right.id
    comparisonHint(hints, same ? 'The same captured case is selected twice' : comparison.commonPrefix + ' matching handler entries at the start',
      same ? 'Choose another case to compare its recorded behavior.' : 'Matching entries identify the same component. Their data and decisions can still differ.')
    if (comparison.decisionDifference) {
      const difference = comparison.decisionDifference
      comparisonHint(hints, 'Recorded check results or actions differ at position ' + difference.position,
        'Compare the captured checks, actions, and terminal values. Missing capture is not proof of a different decision.',
        () => selectObservation(left, difference.left, 'left'))
    }
    if (comparison.firstDifference) {
      const difference = comparison.firstDifference
      comparisonHint(hints, 'The entry lists differ at record position ' + difference.position,
        (difference.left ? 'A: ' + label(difference.left) : 'A: no retained entry') + ' · ' + (difference.right ? 'B: ' + label(difference.right) : 'B: no retained entry'),
        Number.isSafeInteger(difference.left?.index) ? () => selectObservation(left, difference.left, 'left') : Number.isSafeInteger(difference.right?.index) ? () => selectObservation(right, difference.right, 'right') : null)
    } else if (!comparison.decisionDifference && !same) {
      comparisonHint(hints, 'No recorded entry or decision-result difference', 'Available entry identities, check results, actions, and terminal values match. Captured operands or other inputs can still differ.')
    }
    parent.append(hints)
    const differences = h('div', undefined, 'comparison-differences')
    const inputs = h('section'), outputs = h('section')
    heading(inputs, 'Input differences'); captureDifferences(inputs, left, right, 'input', comparison.inputChanges)
    heading(outputs, 'Output differences'); captureDifferences(outputs, left, right, 'output', comparison.outputChanges)
    differences.append(inputs, outputs); parent.append(differences)
    paragraph(parent, 'These are observations from two cases. Input differences alone do not establish what caused a different result.', 'small muted')
    const columns = h('div', undefined, 'comparison-columns')
    for (const [run, side] of [[left, 'left'], [right, 'right']]) {
      const column = h('section', undefined, 'comparison-column ' + (side === 'left' ? 'case-a' : 'case-b'))
      caseHeading(column, run, side)
      observationList(column, run, side, comparison.commonPrefix, comparison.firstDifference?.position)
      const values = h('div')
      dataCard(values, 'Input supplied', run.input, own(run, 'input'), 'Input supplied to case ' + (side === 'left' ? 'A' : 'B'))
      const output = dataCard(values, 'Output returned', run.output, own(run, 'output'), 'Output captured from case ' + (side === 'left' ? 'A' : 'B'))
      if (own(run, 'result')) disclosure(output, 'Full runtime result', codeBlock(run.result, 'Full recorded runtime result'))
      disclosure(column, 'Captured input and output', values)
      columns.append(column)
    }
    parent.append(columns)
  }
  function renderCases() {
    const parent = $('case-area')
    parent.hidden = state().mode !== 'cases'
    if (parent.hidden) return
    parent.replaceChildren()
    const run = runById(state().runId)
    if (!run) {
      const empty = h('div', undefined, 'empty-state')
      heading(empty, 'No cases captured for this application', 'h2')
      paragraph(empty, 'You can inspect its configured calls and source locations. This snapshot contains no execution evidence.')
      empty.append(button('Explore the overview', () => changeMode('overview'), 'button'))
      parent.append(empty)
      return
    }
    if (state().compare && runById(state().compareRunId)) renderComparison(parent, run, runById(state().compareRunId))
    else renderSingleCase(parent, run)
  }
  function renderEvidence() {
    const parent = $('evidence-content'), g = graph(), evidence = evidenceText(g)
    parent.replaceChildren()
    heading(parent, evidence.heading, 'h3'); paragraph(parent, evidence.text)
    if (item().revision) {
      paragraph(parent, 'Source revision supplied with this view', 'small muted')
      parent.append(h('code', item().revision))
    }
    if (g.provenance?.originalVerification?.commit) {
      paragraph(parent, 'Probe source revision', 'small muted')
      parent.append(h('code', g.provenance.originalVerification.commit))
    }
    const gaps = evidenceGaps(g, { run: activeRun() })
    if (gaps.length) {
      const list = h('ul', undefined, 'evidence-list')
      for (const gap of gaps) list.append(h('li', gap))
      parent.append(list)
    }
    const warnings = g.warnings || []
    if (warnings.length) {
      const list = h('ul', undefined, 'evidence-list')
      for (const warning of warnings.slice(0, 30)) list.append(h('li', typeof warning === 'string' ? warning : warning.message || warning.code))
      if (warnings.length > 30) list.append(h('li', (warnings.length - 30) + ' additional diagnostics are retained in the graph JSON.'))
      disclosure(parent, warnings.length + ' source diagnostics', list)
    }
    const buttons = h('div', undefined, 'evidence-actions')
    buttons.append(button('Export graph JSON', exportGraph, 'button'))
    parent.append(buttons)
  }
  function renderChrome() {
    const g = graph(), runtime = isRuntimeGraph(g), mode = state().mode, availableRuns = runs()
    const root = graphRoots(g).map(id => g.nodes.find(node => node.id === id)).find(node => node?.description)
    $('app-select').value = String(current)
    $('application-title').textContent = item().title
    $('application-summary').textContent = root?.description || item().summary || (runtime ? 'Inspect the declared structure, then follow a captured case through its recorded observations.' : 'Explore the components and configured calls in this application.')
    $('capture-kind').textContent = runtime ? 'Declared runtime structure' : 'Configured component calls'
    $('capture-count').textContent = g.nodes.length + ' components' + (availableRuns.length ? ' · ' + availableRuns.length + ' recorded cases' : '')
    $('overview-tab').setAttribute('aria-selected', String(mode === 'overview'))
    $('cases-tab').setAttribute('aria-selected', String(mode === 'cases'))
    $('overview-tab').tabIndex = mode === 'overview' ? 0 : -1
    $('cases-tab').tabIndex = mode === 'cases' ? 0 : -1
    $('cases-count').textContent = String(availableRuns.length)
    $('view-panel').setAttribute('aria-labelledby', mode === 'overview' ? 'overview-tab' : 'cases-tab')
    $('view-panel').dataset.mode = mode
    $('case-controls').hidden = mode !== 'cases' || !availableRuns.length
    $('run-label').textContent = state().compare ? 'Case A' : 'Recorded case'
    for (const [id, selected] of [['run-select', state().runId], ['compare-select', state().compareRunId]]) {
      const select = $(id)
      select.replaceChildren(...availableRuns.map(run => new Option(label(run), run.id)))
      if (selected) select.value = selected
    }
    $('compare-button').disabled = availableRuns.length < 2
    $('compare-button').setAttribute('aria-pressed', String(state().compare))
    $('compare-button').textContent = state().compare ? 'Close comparison' : 'Compare cases'
    $('compare-field').hidden = !state().compare
    $('map-title').textContent = mode === 'overview' ? 'Application map' : state().compare ? 'Recorded visits · A / B' : 'Recorded visits'
    $('map-note').textContent = mode === 'cases' && availableRuns.length ? 'Nodes show recorded handler entries. Connections remain declared.' : runtime ? 'Connections are declared by the runtime. Select a component to inspect it.' : 'Connections show available calls. Order and conditions remain in the method source.'
    $('map-legend').textContent = mode === 'cases' && availableRuns.length ? state().compare ? 'A · first case    B · second case' : 'Number badges count recorded visits' : runtime ? 'Dashed connection · scope entry' : 'Bindings · flows · resources'
    $('diagram-description').textContent = $('map-note').textContent + ' Use arrow keys to move between components. Press Enter to inspect.'
    $('map-footnote').textContent = mode === 'cases' && availableRuns.length ? 'This is a recorded capture. It does not run a workflow or stream live events.' : runtime ? 'Scope exits and callback conditions are separate evidence. Inspect a recorded case to see captured decisions.' : 'Internal order, branches, data transformations, and repeated calls are not established by this composition view.'
    $('overview-hint').hidden = mode !== 'overview'
    $('explore-cases').hidden = !availableRuns.length
    $('explore-cases').textContent = 'Explore ' + availableRuns.length + ' recorded cases'
    $('overview-hint-text').textContent = runtime ? 'Select a component for its role, declared connections, and source. Recorded cases reveal the behavior captured for specific inputs.' : 'Select a component for its authored description, configured collaborators, and source location.'
    $('node-select').value = state().nodeId || ''
  }
  function render() {
    renderChrome()
    renderInspector()
    draw()
    renderCases()
    renderEvidence()
  }
  function chooseApplication(index) {
    if (!Number.isInteger(index) || !DATA[index]) return
    current = index
    const layout = layoutGraph(graph())
    positions = layout.positions; edgePaths = layout.edgePaths; dimensions = layout.dimensions
    if (!state().view) state().view = { ...dimensions }
    const select = $('node-select')
    select.replaceChildren(new Option('Inspect a component…', ''))
    for (const node of graph().nodes) select.add(new Option(label(node), node.id))
    $('capture-evidence').open = false
    render()
  }
  function contextText() {
    const run = activeRun()
    return selectedInvestigationContext(item(), {
      nodeId: state().nodeId, runId: run?.id,
      compareRunId: state().compare && state().mode === 'cases' ? (state().side === 'right' ? state().runId : state().compareRunId) : undefined,
      observationIndex: state().mode === 'cases' ? state().observationIndex : undefined,
      visitOrdinal: state().mode === 'cases' ? state().visitOrdinal : undefined,
    })
  }
  function showContext(text) {
    $('context-text').value = text
    if (typeof $('context-dialog').showModal === 'function') $('context-dialog').showModal()
    else $('context-dialog').setAttribute('open', '')
    $('context-text').focus()
    $('context-text').select()
    notify('Investigation context is ready to copy.')
  }
  async function copyContext() {
    const text = contextText()
    try {
      if (!navigator.clipboard?.writeText) { showContext(text); return }
      await navigator.clipboard.writeText(text)
      notify('Investigation context copied. It includes the selected evidence and source locations.')
    } catch { showContext(text) }
  }
  function exportGraph() {
    const blob = new Blob([JSON.stringify(graph(), null, 2) + '\n'], { type: 'application/json' })
    const url = URL.createObjectURL(blob), anchor = h('a')
    anchor.href = url
    anchor.download = String(item().id || 'flow-graph').replace(/[^a-zA-Z0-9._-]+/gu, '-').slice(0, 100) + '.json'
    anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  DATA.forEach((value, index) => $('app-select').add(new Option(value.title, String(index))))
  $('app-select').addEventListener('change', () => chooseApplication(Number($('app-select').value)))
  $('overview-tab').addEventListener('click', () => changeMode('overview'))
  $('cases-tab').addEventListener('click', () => changeMode('cases'))
  $('mode-tabs').addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const mode = event.key === 'Home' ? 'overview' : event.key === 'End' ? 'cases' : state().mode === 'overview' ? 'cases' : 'overview'
    changeMode(mode)
    $(mode === 'overview' ? 'overview-tab' : 'cases-tab').focus()
  })
  $('run-select').addEventListener('change', () => enterCase('left', $('run-select').value))
  $('compare-select').addEventListener('change', () => enterCase('right', $('compare-select').value))
  $('compare-button').addEventListener('click', () => setComparison(!state().compare))
  $('explore-cases').addEventListener('click', () => changeMode('cases'))
  $('node-select').addEventListener('change', () => { if ($('node-select').value) selectNode($('node-select').value) })
  $('close-inspector').addEventListener('click', closeInspector)
  $('copy-context').addEventListener('click', copyContext)
  $('inspector-copy-context').addEventListener('click', copyContext)
  $('context-close').addEventListener('click', () => {
    if (typeof $('context-dialog').close === 'function') $('context-dialog').close()
    else $('context-dialog').removeAttribute('open')
  })
  $('context-select').addEventListener('click', () => { $('context-text').focus(); $('context-text').select() })
  $('zoom-in').addEventListener('click', () => zoom(.8))
  $('zoom-out').addEventListener('click', () => zoom(1.25))
  $('fit').addEventListener('click', fit)
  $('diagram').addEventListener('pointerdown', event => {
    if (event.button !== 0 || event.target.closest('.graph-node')) return
    drag = { x: event.clientX, y: event.clientY, view: { ...state().view } }
    $('diagram').setPointerCapture(event.pointerId)
  })
  $('diagram').addEventListener('pointermove', event => {
    if (!drag) return
    const rect = $('diagram').getBoundingClientRect()
    if (!rect.width || !rect.height) return
    const scale = Math.max(drag.view.width / rect.width, drag.view.height / rect.height)
    state().view = { ...drag.view, x: drag.view.x - (event.clientX - drag.x) * scale, y: drag.view.y - (event.clientY - drag.y) * scale }
    applyView()
  })
  $('diagram').addEventListener('pointerup', () => { drag = null })
  $('diagram').addEventListener('pointercancel', () => { drag = null })
  $('diagram').addEventListener('wheel', event => {
    if (!event.ctrlKey && !event.metaKey) return
    event.preventDefault()
    zoom(event.deltaY > 0 ? 1.1 : .9)
  }, { passive: false })
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && state().inspectorOpen && !$('context-dialog').open) { event.preventDefault(); closeInspector() }
  })
  chooseApplication(current)
}

const styles = [
  ':root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#233341;background:#f5f7f8;font-synthesis:none;color-scheme:light;--ink:#233341;--muted:#63717d;--line:#dce3e7;--teal:#246d61;--blue:#365e8b}',
  '*{box-sizing:border-box}[hidden]{display:none!important}body{margin:0}button,select,textarea{font:inherit}button,select,a{touch-action:manipulation}button{cursor:pointer}button:disabled{opacity:.45;cursor:default}button:focus-visible,select:focus-visible,a:focus-visible,summary:focus-visible,textarea:focus-visible,[tabindex]:focus-visible{outline:3px solid #759dcc;outline-offset:3px}button,select{color:inherit}h1,h2,h3,h4,p{margin:0}h1{font-size:32px;letter-spacing:-1.1px;line-height:1.2;font-weight:680}h2{font-size:21px;line-height:1.35;letter-spacing:-.45px}h3{font-size:14px;line-height:1.5;font-weight:680}h4{font-size:12px;line-height:1.6}p{line-height:1.7}code,pre,textarea{font-family:ui-monospace,SFMono-Regular,Consolas,"Liberation Mono",monospace}code{font-size:12px;overflow-wrap:anywhere}.muted{color:var(--muted);font-size:13px}.small{font-size:11px!important;line-height:1.65}.eyebrow{display:block;font-size:10px;line-height:1.6;font-weight:700;text-transform:uppercase;letter-spacing:1.25px;color:var(--muted)}.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}.skip-link{position:fixed;top:10px;left:10px;background:#fff;padding:12px;z-index:20;transform:translateY(-200%)}.skip-link:focus{transform:none}',
  '.appbar{border-bottom:1px solid var(--line);background:#fff}.appbar-inner{max-width:1580px;margin:auto;padding:18px 36px;display:flex;align-items:center;gap:28px}.brand{display:flex;gap:12px;align-items:center;white-space:nowrap}.brand-mark{width:36px;height:36px;border-radius:10px;display:grid;place-items:center;background:#243e48;color:#fff;font-size:25px;font-weight:650}.brand strong{font-size:14px;letter-spacing:-.25px}.brand small{display:block;font-size:10px;color:var(--muted);margin-top:3px}.application-picker{display:flex;align-items:center;gap:12px;margin-left:auto}.application-picker label{font-size:11px;color:var(--muted)}select{max-width:100%;background:#fff;border:1px solid #cfd8de;border-radius:8px;min-height:39px;padding:8px 30px 8px 11px;font-size:12px}.application-picker select{width:280px}.button,.icon-button,.text-button{border:1px solid #cad5dc;border-radius:8px;background:#fff;padding:9px 13px;min-height:39px;font-size:12px;font-weight:600;line-height:1.4}.button:hover,.icon-button:hover{background:#edf2f5;border-color:#b0c2cb}.button.primary{background:var(--teal);border-color:var(--teal);color:#fff}.button.primary:hover{background:#1b584e}.icon-button{min-width:35px;min-height:35px;padding:6px 9px}.text-button{border:0;padding:5px 0;min-height:28px;background:transparent;color:var(--teal);text-align:left}.text-button:hover{text-decoration:underline}',
  '.page{max-width:1580px;margin:auto;padding:30px 36px 48px}.application-heading{max-width:980px;margin-bottom:23px}.capture-meta{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:12px;font-size:11px;color:var(--muted)}.capture-tag{border:1px solid #d4e2df;background:#edf4f1;color:#32685c;border-radius:20px;padding:5px 9px;font-size:10px;font-weight:600}.application-summary{margin-top:12px;font-size:14px;line-height:1.75;color:#5b6b76;max-width:880px;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;overflow:hidden}.mode-bar{display:flex;align-items:center;justify-content:space-between;gap:12px;border-bottom:1px solid var(--line);margin-bottom:24px}.tabs{display:flex;gap:4px;padding-bottom:10px}.tab{background:transparent;border:0;border-radius:8px;padding:10px 14px;min-height:42px;font-size:13px;color:#697680;font-weight:650}.tab:hover{background:#edf1f3}.tab[aria-selected=true]{color:#263d49;background:#fff;box-shadow:0 1px 4px #1c374810}.tab-count{display:inline-block;min-width:19px;padding:1px 5px;margin-left:6px;font-size:10px;border-radius:6px;background:#e9eef0;color:#65737e}.mode-caption{font-size:11px;color:#77838c;padding-bottom:10px}',
  '.case-controls{display:flex;align-items:end;gap:16px;flex-wrap:wrap;margin:0 0 20px;padding:17px 20px;border:1px solid var(--line);background:#fff;border-radius:12px}.case-field{display:flex;flex-direction:column;gap:6px;min-width:225px}.case-field label{font-size:11px;font-weight:650;color:#60717c}.case-field select{min-width:225px}.case-control-note{font-size:11px;color:#7b8790;margin-left:auto;padding-bottom:10px}.case-controls .button[aria-pressed=true]{background:#edf3f5;border-color:#9eb7c1}',
  '.workspace{display:grid;grid-template-columns:minmax(0,1fr);gap:22px;align-items:start}.workspace.inspecting{grid-template-columns:minmax(0,1fr) 350px}.workspace-main{min-width:0}.canvas-panel{background:#fff;border:1px solid var(--line);border-radius:16px;overflow:hidden;box-shadow:0 2px 5px #253a4610}.map-toolbar{padding:18px 21px;display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap;border-bottom:1px solid #e5eaed}.map-heading{min-width:220px;flex:1}.map-heading p{font-size:11px;color:#71808a;line-height:1.6;margin-top:4px;max-width:620px}.map-tools{display:flex;gap:14px;align-items:center;flex-wrap:wrap}.map-tools select{font-size:11px;max-width:220px;min-height:35px}.zoom-controls,.compact-controls{display:flex;gap:5px;align-items:center}.zoom-controls .icon-button{background:#f8fafb;border-color:#dae2e6}.zoom-controls .icon-button:last-child{font-size:11px;padding-left:12px;padding-right:12px}',
  '#diagram-wrap{position:relative;background-color:#f8fafb;background-image:radial-gradient(#dbe3e8 .7px,transparent .7px);background-size:20px 20px;height:620px;min-height:380px;max-height:760px;overflow:hidden}#diagram{display:block;width:100%;height:100%;user-select:none;touch-action:none}.view-panel[data-mode=cases] #diagram-wrap{height:540px}.graph-node{cursor:pointer}.graph-node rect.node{fill:#fff;stroke:#c9d4dc;stroke-width:1.3;filter:drop-shadow(0 3px 5px #2137460c)}.graph-node:hover rect.node{stroke:#71929f;stroke-width:2}.graph-node.observed rect.node{fill:#f0faf5;stroke:#76aa99;stroke-width:1.8}.graph-node.case-b-only rect.node{fill:#eef5fc;stroke:#92acc8}.graph-node.selected rect.node{stroke:#365e8b;stroke-width:3;fill:#f6faff}.graph-node:focus-visible{outline:none}.graph-node:focus-visible rect.node{stroke:#365e8b;stroke-width:3;stroke-dasharray:4 2}.node-title{font-size:17px;font-weight:650;fill:#293d48}.node-kind{font-size:8.6px;font-weight:700;letter-spacing:.8px;fill:#6d7d86}.node-subtitle{font-size:9.5px;fill:#7f8b92}.node-symbol{font-size:13px;font-weight:650;fill:#fff}.edge{fill:none;stroke:#a5b4bc;stroke-width:1.5}.edge.related{stroke:#557894;stroke-width:2.3}.edge.scope-entry{stroke-dasharray:4 5}.edge.unresolved{stroke-dasharray:3 5}.edge-label{font-size:12px;fill:#657c88;paint-order:stroke;stroke:#f8fafb;stroke-width:6px;stroke-linejoin:round}.node-count{fill:#d9eee4;stroke:#f8fafb;stroke-width:2}.case-b-only .node-count{fill:#dce8f6}.node-count-text{fill:#31534d;font-size:12px;font-weight:700}.map-empty{position:absolute;inset:30px;display:grid;place-items:center;font-size:13px;color:var(--muted);text-align:center;pointer-events:none}.map-footer{display:flex;justify-content:space-between;gap:18px;padding:13px 20px;border-top:1px solid #e3e9ed;background:#fcfdfd;font-size:10px;color:#76858e;line-height:1.7}.map-footer #map-footnote{max-width:740px}.map-footer #map-legend{flex-shrink:0;color:#586d78}.overview-hint{display:flex;align-items:center;gap:24px;justify-content:space-between;padding:20px 3px 4px}.overview-hint p{font-size:12px;color:var(--muted);max-width:760px}.overview-hint .button{flex-shrink:0}',
  '.inspector{position:sticky;top:16px;max-height:calc(100vh - 32px);overflow:auto;border:1px solid var(--line);border-radius:15px;background:#fff;scroll-margin-top:18px;box-shadow:0 2px 6px #263c4610}.inspector-header{display:flex;justify-content:space-between;align-items:start;gap:12px;padding:21px 21px 15px;border-bottom:1px solid #e7ecef}.inspector-header h2{font-size:20px;margin-top:5px;overflow-wrap:anywhere}.close-button{font-size:20px;line-height:1.2;color:#77858d;background:transparent;border:0;min-width:34px;min-height:34px;padding:3px;border-radius:7px}.close-button:hover{background:#edf2f5}.inspector-content{padding:20px;overflow-wrap:anywhere}.inspector-content h3{margin:25px 0 9px}.inspector-content h4{margin-top:13px}.inspector-content p+p{margin-top:8px}.component-description{font-size:13px;color:#455b67;line-height:1.8}.inspector-capture{border-top:1px solid #e5ebee;margin-top:20px;padding-top:18px}.inspector-capture strong{display:block;font-size:13px;line-height:1.5;margin-top:5px}.visit-navigation,.observation-navigation{display:flex;justify-content:space-between;align-items:center;gap:8px;margin:15px 0}.visit-navigation strong{font-size:12px}.visit-picks{display:flex;gap:6px;flex-wrap:wrap}.visit-pick{padding:6px 9px;border:1px solid #d6e0e4;border-radius:6px;background:#fff;color:#72818a;font-size:11px;min-height:32px}.visit-pick[aria-pressed=true]{background:#eaf2f7;border-color:#96b3ca;color:#305775}.observation-navigation{border-top:1px solid #e6ecef;padding-top:16px;margin-top:19px}.inspector-footer{padding:14px 20px;border-top:1px solid #e7ecef;background:#fbfcfd}.inspector-footer .button{width:100%}',
  '.condition{border:1px solid #dce5e9;border-radius:10px;padding:12px;margin:11px 0;background:#fcfdfd}.condition-title{display:flex;align-items:start;justify-content:space-between;gap:10px}.condition-title strong{font-size:12px;line-height:1.5}.result-pill{font-family:ui-monospace,monospace;font-size:10px;padding:3px 6px;border-radius:5px;flex-shrink:0}.result-pill.true{background:#e1f2e9;color:#2f6a50}.result-pill.false{background:#edf0f3;color:#63727e}.expression{display:block;margin:12px 0;color:#485d69;font-size:11px;white-space:pre-wrap}.operands{display:grid;grid-template-columns:minmax(0,1fr) minmax(50px,1fr);gap:5px 10px;margin:9px 0 0;padding-top:9px;border-top:1px solid #e7edef;font-size:10px}.operands dt{color:#75858c;overflow-wrap:anywhere}.operands dd{margin:0;font-family:ui-monospace,monospace;color:#415965;white-space:pre-wrap;overflow-wrap:anywhere}.recorded-action{padding:12px 14px;margin:15px 0 6px;border-left:3px solid #70a395;background:#f0f7f4;border-radius:0 8px 8px 0}.recorded-action code{display:block;margin-top:4px;font-size:13px;color:#346657}.empty-note{background:#f6f8fa;border:1px solid #e4eaee;border-radius:8px;padding:13px 14px;font-size:12px;color:#74828c;line-height:1.7}.source-location{border-top:1px solid #e5ebef;padding-top:17px;margin-top:22px}.source-location code{display:block;line-height:1.7;color:#567386;font-size:11px;margin-top:5px}.route-button{display:grid;grid-template-columns:minmax(70px,.7fr) minmax(0,1fr) 13px;gap:9px;align-items:center;padding:11px 0;text-align:left;width:100%;border:0;border-bottom:1px solid #e7edef;background:transparent;font-size:11px;color:#526976}.route-button code{font-size:11px;color:#2e6774}.route-button:hover{background:#f4f8f9}.route-symbol{color:#91a1aa}.pills{display:flex;gap:6px;flex-wrap:wrap}.pill{display:inline-block;padding:5px 8px;border:1px solid #d6e2e5;background:#f4f8f9;border-radius:6px;font-size:11px}',
  '.case-area{margin-top:28px}.case-heading{display:flex;justify-content:space-between;align-items:center;gap:16px;margin-bottom:9px}.case-heading .eyebrow{margin-bottom:5px}.case-summary{font-size:13px;color:#6b7a84;line-height:1.75;margin-bottom:20px}.outcome-pill{display:inline-block;flex-shrink:0;padding:6px 10px;background:#e8f1ec;color:#3c6a57;border-radius:7px;font-family:ui-monospace,monospace;font-size:11px;border:1px solid #d3e3d9}.case-layout{display:grid;grid-template-columns:minmax(260px,.9fr) minmax(360px,1.3fr);gap:23px;align-items:start}.timeline-panel{min-width:0;border:1px solid var(--line);border-radius:13px;background:#fff;padding:20px}.timeline-panel>p{margin:5px 0 12px}.case-values{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;align-items:start}.data-card{border:1px solid var(--line);border-radius:12px;background:#fff;padding:18px;min-width:0}.data-card h3{margin-bottom:11px}.json{white-space:pre-wrap;word-break:break-word;overflow:auto;font-size:11px;line-height:1.8;padding:12px;border:1px solid #e4eaee;border-radius:8px;background:#f7f9fa;color:#4b626d;margin:9px 0 0;max-height:280px}.inspector .json{font-size:10px;max-height:260px}.case-values .json{min-height:110px}.inspecting .case-layout{grid-template-columns:1fr}.observation-list{list-style:none;padding:0;margin:0}.observation-list li{border-bottom:1px solid #e9eef1}.observation-list li:last-child{border-bottom:0}.observation-button{display:flex;gap:11px;align-items:center;text-align:left;width:100%;min-height:65px;border:0;border-radius:8px;padding:11px 8px;background:transparent;color:inherit}.observation-button:hover{background:#f4f8fa}.observation-button[aria-pressed=true]{background:#eaf3f8;box-shadow:inset 3px 0 #688eaa}.observation-number{font-family:ui-monospace,monospace;font-size:10px;color:#8d9ca4;min-width:22px}.observation-copy{min-width:0;flex:1}.observation-copy strong{display:block;font-size:12px;line-height:1.5;font-weight:600;overflow-wrap:anywhere}.observation-copy small{display:block;font-size:10px;line-height:1.7;color:#819099;margin-top:2px;overflow-wrap:anywhere}.visit-label{font-size:9px;color:#71828d;background:#eef2f4;padding:4px 6px;border-radius:5px;white-space:nowrap}.observation-button.unavailable{cursor:default}.observation-button.unavailable:hover{background:transparent}',
  '.comparison-mark{font-size:11px;font-weight:700;background:#e8eff3;color:#5e7b8d;border-radius:6px;padding:7px 10px}.comparison-hints{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:12px;margin:18px 0}.comparison-hint{background:#edf3f6;border:1px solid #dce6eb;border-radius:10px;padding:15px}.comparison-hint strong{display:block;font-size:12px;line-height:1.65;font-weight:650}.comparison-hint p{font-size:11px;color:#73828d;margin-top:5px;line-height:1.75}.comparison-hint .text-button{font-size:11px;margin-top:8px}.comparison-differences{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:22px;background:#fff;border:1px solid var(--line);border-radius:12px;padding:20px;margin-bottom:11px}.comparison-differences h3{margin-bottom:10px}.table-scroll{max-width:100%;overflow:auto}.changes{border-collapse:collapse;width:100%;text-align:left;font-size:11px}.changes th{font-weight:600}.changes thead th{font-size:10px;color:#81919a;white-space:nowrap}.changes th,.changes td{padding:9px 8px;border-bottom:1px solid #e6ecef;vertical-align:top}.changes th:first-child,.changes td:first-child{padding-left:0}.changes td:last-child,.changes th:last-child{padding-right:0}.changes code{font-size:10px;white-space:pre-wrap;overflow-wrap:anywhere;color:#526b78}.changes tbody th{width:34%}.changes tbody td{width:33%}.not-present{font-size:10px;color:#8a979f;font-style:italic}.comparison-columns{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px;margin-top:22px}.comparison-column{background:#fff;border:1px solid var(--line);border-radius:12px;padding:20px;min-width:0}.comparison-column.case-a{border-top:3px solid #8ab8a7}.comparison-column.case-b{border-top:3px solid #8aabc6}.comparison-column .case-heading{align-items:start;flex-wrap:wrap;gap:9px}.comparison-column h2{font-size:17px}.comparison-column .case-summary{font-size:11px;line-height:1.75;margin-bottom:12px}.comparison-column .data-card{border:0;padding:7px 0}.observation-list .shared .observation-number{color:#5e8e7f}.observation-list .divergent{border-top:1px dashed #adbcc6}.empty-state{padding:30px;border:1px solid var(--line);border-radius:14px;background:#fff}.empty-state p{margin:10px 0 18px;max-width:650px}',
  '.disclosure{border-top:1px solid #e2e9ed;padding-top:12px;margin-top:16px}.disclosure>summary{font-size:11px;line-height:1.8;font-weight:600;color:#71818b;cursor:pointer;list-style-position:outside;margin-left:14px;padding-left:2px}.disclosure[open]>summary{color:#46616f;margin-bottom:12px}.disclosure p{font-size:11px}.evidence-list{padding-left:18px;margin:13px 0;color:#6f7f8a;font-size:11px;line-height:1.8}.evidence-list li{margin-bottom:8px}.capture-evidence{margin-top:28px;border-top:1px solid var(--line);padding-top:17px}.capture-evidence>summary{font-size:12px;color:#73838c;cursor:pointer;line-height:1.8}.capture-evidence>summary span{margin-left:7px;font-size:10px;color:#89969e}.evidence-content{max-width:980px;background:#fff;border:1px solid #e0e7eb;border-radius:12px;padding:20px;margin-top:15px}.evidence-content>p{margin:8px 0}.evidence-actions{margin-top:17px}.evidence-content>code{font-size:11px;line-height:1.8;color:#6a808c}.context-dialog{border:1px solid #cfdbe1;border-radius:16px;box-shadow:0 20px 70px #152f3c30;width:min(760px,calc(100vw - 32px));padding:25px;color:var(--ink);background:#fff}.context-dialog::backdrop{background:#243f5366}.dialog-heading{display:flex;justify-content:space-between;align-items:start;gap:18px}.context-dialog p{margin:12px 0 18px}.context-dialog textarea{width:100%;height:340px;max-height:55vh;resize:vertical;border:1px solid #d5e0e5;border-radius:8px;padding:14px;font-size:11px;line-height:1.7;color:#526b78;background:#f8fafb}.dialog-actions{display:flex;justify-content:flex-end;gap:9px;margin-top:16px}.snapshot-pair h4{color:#607b89}',
  '@media(min-width:1600px){#diagram-wrap{height:630px}.view-panel[data-mode=cases] #diagram-wrap{height:560px}.workspace.inspecting{grid-template-columns:minmax(0,1fr) 375px}}',
  '@media(max-width:1200px){.appbar-inner,.page{padding-left:25px;padding-right:25px}.brand small{display:none}.application-picker select{width:230px}.workspace.inspecting{grid-template-columns:minmax(0,1fr) 325px}.map-footer{display:block}.map-footer #map-legend{margin-top:5px}.case-control-note{display:none}.case-layout{grid-template-columns:1fr}.case-values{grid-template-columns:repeat(2,minmax(0,1fr))}}',
  '@media(max-width:1000px){.workspace,.workspace.inspecting{display:block}.inspector{position:static;max-height:none;margin-top:22px}.inspector-content{display:block}.map-heading{min-width:210px}.map-tools{margin-left:auto}.appbar-inner{gap:18px}.application-picker{gap:7px}.application-picker label{display:none}.application-picker select{width:210px}.page{padding-top:25px}.case-layout,.inspecting .case-layout{grid-template-columns:minmax(230px,.9fr) minmax(270px,1.1fr)}.case-values{grid-template-columns:1fr}.mode-caption{display:none}#diagram-wrap{height:500px}.view-panel[data-mode=cases] #diagram-wrap{height:430px}}',
  '@media(max-width:700px){.appbar-inner{flex-wrap:wrap;padding:16px 18px;gap:14px}.brand{margin-right:auto}.brand strong{font-size:13px}.brand small{display:block}.application-picker{order:3;margin:0;width:100%}.application-picker select{width:100%}.application-picker label{display:block;min-width:70px}.appbar-inner>.button{font-size:11px;padding:8px 11px}.page{padding:23px 16px 32px}h1{font-size:27px}.application-summary{font-size:13px;-webkit-line-clamp:4}.application-heading{margin-bottom:18px}.capture-meta{gap:8px;font-size:10px}.mode-bar{margin-bottom:18px}.tab{padding:10px 12px;font-size:12px}.case-controls{padding:15px;gap:12px}.case-field,.case-field select{min-width:0;width:100%}.case-controls .button{min-height:36px;font-size:11px}.map-toolbar{padding:15px;gap:12px}.map-heading{min-width:100%;flex:1}.map-tools{width:100%;justify-content:space-between;margin:0;gap:8px}.map-tools select{max-width:calc(100% - 125px);font-size:10px}.zoom-controls{gap:3px}.zoom-controls .icon-button{min-width:30px;min-height:32px;padding:5px 8px}.zoom-controls .icon-button:last-child{padding:5px 9px}#diagram-wrap,.view-panel[data-mode=cases] #diagram-wrap{height:365px;min-height:330px}.map-footer{padding:12px 15px;font-size:10px}.overview-hint{display:block;padding:17px 2px}.overview-hint p{font-size:11px}.overview-hint .button{margin-top:13px;width:100%}.case-layout,.inspecting .case-layout{display:block}.case-values{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));margin-top:17px;gap:12px}.data-card{padding:13px}.data-card .json{font-size:10px;padding:8px}.case-heading{align-items:start}.case-heading h2{font-size:19px}.case-summary{font-size:12px}.timeline-panel{padding:17px}.comparison-hints{grid-template-columns:1fr}.comparison-differences{grid-template-columns:1fr;gap:20px;padding:17px}.comparison-columns{gap:12px}.comparison-column{padding:13px 10px}.comparison-column h2{font-size:14px}.comparison-column .outcome-pill{font-size:9px;padding:5px 6px}.comparison-column .observation-button{padding:11px 2px;gap:5px;flex-wrap:wrap}.comparison-column .observation-number{min-width:17px;font-size:9px}.comparison-column .observation-copy strong{font-size:11px}.comparison-column .observation-copy small{font-size:9px}.comparison-column .visit-label{margin-left:22px;padding:2px 5px;font-size:8px}.comparison-column .case-summary{font-size:10px}.inspector-content .json{font-size:11px}.empty-state{padding:22px}.empty-state h2{font-size:19px}.context-dialog{padding:20px}.context-dialog h2{font-size:20px}}',
  '@media(max-width:400px){.case-values,.comparison-columns{grid-template-columns:1fr}.map-tools select{max-width:175px}.capture-meta{align-items:start;flex-direction:column}}',
  '@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important}}',
].join('\n')

export function renderExplorer({ title = 'Jig behavior explorer', graphs }) {
  validateGraphs(graphs)
  if (typeof title !== 'string' || title.length > 4096) throw new TypeError('The viewer title must be bounded text.')
  const escapeHtml = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
  const serialized = JSON.stringify(graphs)
  if (new TextEncoder().encode(serialized).length > 16 * 1024 * 1024) throw new TypeError('Snapshot exceeds the 16 MiB viewer limit.')
  const data = serialized.replaceAll('<', '\\u003c').replaceAll('>', '\\u003e').replaceAll('&', '\\u0026').replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029')
  const helpers = [
    graphRoots, edgeLabel, scopeExits, isRuntimeGraph, displayNodeKind, nodeSource, evidenceText,
    edgeGeometry, layoutGraph, valueChanges, nodeOccurrences, caseComparison, evidenceGaps, investigationContext,
    defaultGraphIndex, preserveCaseSelection, componentSelection, selectedCaseObservation, selectedInvestigationContext,
  ].map(fn => 'const ' + fn.name + ' = ' + fn.toString() + ';').join('\n')
  return [
    '<!doctype html>',
    '<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; img-src data:; connect-src \'none\'; base-uri \'none\'; form-action \'none\'">',
    '<title>' + escapeHtml(title) + '</title><style>' + styles + '</style></head><body>',
    '<a class="skip-link" href="#main">Skip to application</a>',
    '<header class="appbar"><div class="appbar-inner"><div class="brand"><span class="brand-mark" aria-hidden="true">ƒ</span><div><strong>Jig behavior explorer</strong><small>Read-only visibility experiment</small></div></div><div class="application-picker"><label for="app-select">Application</label><select id="app-select"></select></div><button type="button" class="button" id="copy-context" aria-label="Copy investigation context">Copy context</button></div></header>',
    '<main class="page" id="main" tabindex="-1"><section class="application-heading"><div class="capture-meta"><span id="capture-kind" class="capture-tag"></span><span id="capture-count"></span></div><h1 id="application-title"></h1><p id="application-summary" class="application-summary"></p></section>',
    '<div class="mode-bar"><div id="mode-tabs" class="tabs" role="tablist" aria-label="Application view"><button type="button" id="overview-tab" class="tab" role="tab" aria-selected="true" aria-controls="view-panel">Overview</button><button type="button" id="cases-tab" class="tab" role="tab" aria-selected="false" aria-controls="view-panel" tabindex="-1">Recorded cases <span id="cases-count" class="tab-count"></span></button></div><span class="mode-caption">Code stays the source of truth</span></div>',
    '<section id="view-panel" class="view-panel" role="tabpanel" aria-labelledby="overview-tab" data-mode="overview"><div class="case-controls" id="case-controls" hidden><div class="case-field"><label id="run-label" for="run-select">Recorded case</label><select id="run-select"></select></div><button type="button" class="button" id="compare-button" aria-pressed="false">Compare cases</button><div class="case-field" id="compare-field" hidden><label for="compare-select">Case B</label><select id="compare-select"></select></div><span class="case-control-note">Captured inputs · recorded behavior</span></div>',
    '<div id="workspace" class="workspace"><div class="workspace-main"><section class="canvas-panel" aria-label="Application map"><div class="map-toolbar"><div class="map-heading"><h2 id="map-title" style="font-size:14px;letter-spacing:0">Application map</h2><p id="map-note"></p></div><div class="map-tools"><label for="node-select" class="sr-only">Inspect a component</label><select id="node-select"><option value="">Inspect a component…</option></select><div class="zoom-controls"><button type="button" class="icon-button" id="zoom-out" aria-label="Zoom out">−</button><button type="button" class="icon-button" id="zoom-in" aria-label="Zoom in">+</button><button type="button" class="icon-button" id="fit" aria-label="Fit the whole application map">Fit</button></div></div></div>',
    '<div id="diagram-wrap"><svg id="diagram" xmlns="http://www.w3.org/2000/svg" role="group" aria-labelledby="diagram-title" aria-describedby="diagram-description"><title id="diagram-title">Application components and declared connections</title><desc id="diagram-description"></desc><defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="userSpaceOnUse"><path d="M 0 0 L 8 4 L 0 8 Z" fill="#a5b4bc"/></marker><marker id="arrow-related" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="userSpaceOnUse"><path d="M 0 0 L 8 4 L 0 8 Z" fill="#557894"/></marker></defs><g id="canvas"></g></svg><div id="empty-graph" class="map-empty" hidden>No components are present in this snapshot.</div></div>',
    '<div class="map-footer"><p id="map-footnote"></p><p id="map-legend"></p></div></section><div id="overview-hint" class="overview-hint"><p id="overview-hint-text"></p><button type="button" id="explore-cases" class="button primary" hidden>Explore recorded cases</button></div><section id="case-area" class="case-area" aria-label="Recorded case evidence" hidden></section></div>',
    '<aside id="inspector" class="inspector" aria-labelledby="inspector-title" hidden><div class="inspector-header"><div><span id="inspector-kind" class="eyebrow"></span><h2 id="inspector-title"></h2></div><button type="button" id="close-inspector" class="close-button" aria-label="Close component inspection">×</button></div><div id="inspector-content" class="inspector-content"></div><div class="inspector-footer"><button type="button" id="inspector-copy-context" class="button">Copy investigation context</button></div></aside></div></section>',
    '<details id="capture-evidence" class="capture-evidence"><summary>About this capture <span>Source, evidence, and limits</span></summary><div id="evidence-content" class="evidence-content"></div></details></main>',
    '<dialog id="context-dialog" class="context-dialog" aria-labelledby="context-title"><div class="dialog-heading"><h2 id="context-title">Investigation context</h2><button type="button" class="close-button" id="context-close" aria-label="Close investigation context">×</button></div><p class="muted">Copy this evidence and source context into a coding agent. Add the question you want it to investigate.</p><label class="sr-only" for="context-text">Read-only investigation context</label><textarea id="context-text" readonly spellcheck="false"></textarea><div class="dialog-actions"><button type="button" class="button" id="context-select">Select all text</button></div></dialog>',
    '<div id="status" class="sr-only" role="status" aria-live="polite" aria-atomic="true"></div>',
    '<script id="graph-data" type="application/json">' + data + '</script>',
    '<script>\n\'use strict\';\n' + helpers + '\n(' + startExplorer.toString() + ')();\n</script></body></html>',
  ].join('\n')
}
