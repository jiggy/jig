import type { DisplayCallState, DisplayComposition, DisplaySnapshot } from '@jigging/display-model'

type AvailableComposition = Extract<DisplayComposition, { state: 'available' }>
export type PrivateCompositionRequestFocus = 'all' | 'active' | 'attention'
export type PrivateCompositionRequestSummary = Readonly<Record<DisplayCallState, number>>
export type PrivateCompositionRequestCount = Readonly<{ state: DisplayCallState; count: number }>

/** Summaries describe retained requests, never the component's outcome or root execution. */
export function privateCompositionRequestSummary(
  requests: readonly Pick<DisplaySnapshot['calls'][number], 'state'>[],
): PrivateCompositionRequestSummary {
  const summary: Record<DisplayCallState, number> = {
    requested: 0, active: 0, 'cancel-requested': 0, returned: 0, failed: 0, uncertain: 0,
  }
  for (const request of requests) summary[request.state]++
  return summary
}

export function privateCompositionFocusedRequests(
  summary: PrivateCompositionRequestSummary,
  focus: PrivateCompositionRequestFocus,
): number {
  if (focus === 'active') return summary.active
  if (focus === 'attention') return summary.failed + summary.uncertain
  return Object.values(summary).reduce((total, count) => total + count, 0)
}

export function privateCompositionRequestStateLabel(state: DisplayCallState): string {
  return state === 'cancel-requested' ? 'cancel requested' : state
}

/** Three reserved rows fit all states without changing map geometry as observations arrive. */
export function privateCompositionRequestRows(
  summary: PrivateCompositionRequestSummary,
): PrivateCompositionRequestCount[][] {
  return ([['active', 'failed'], ['uncertain', 'requested'], ['cancel-requested', 'returned']] as const)
    .map((states) => states.flatMap((state) => summary[state] ? [{ state, count: summary[state] }] : []))
    .filter((row) => row.length)
}

export type PrivateCompositionSelection = {
  rootSourceId?: string | undefined
  rootId?: string | undefined
  nodeId?: string | undefined
}
export type PrivateCompositionBox = {
  id: string
  x: number
  y: number
  width: number
  height: number
  labelLines: string[]
}
export type PrivateCompositionRoute = {
  id: string
  source: string
  target: string
  edgeIds: string[]
  lines: string[]
  /** The originating edge on each slot's first line; continuation lines contain ''. */
  lineEdgeIds: string[]
  /** First of three reserved state rows for each configured slot in a Run map. */
  requestRows: { edgeId: string; line: number }[]
  path: string
  sourceX: number
  sourceY: number
  targetX: number
  targetY: number
  /** Horizontal pill center and first text baseline; subsequent lines are 15px apart. */
  labelX: number
  labelY: number
  labelTop: number
  labelWidth: number
  labelHeight: number
}

/** A missing component never selects a different component with the same label. */
export function privateCompositionSelection(
  snapshot: Pick<DisplaySnapshot, 'rootSourceId' | 'composition'>,
  previous: PrivateCompositionSelection,
): PrivateCompositionSelection {
  const sameRun = previous.rootSourceId === snapshot.rootSourceId
  const composition = snapshot.composition
  if (composition?.state !== 'available')
    return sameRun ? { ...previous } : { rootSourceId: snapshot.rootSourceId }
  const keep =
    sameRun &&
    previous.rootId === composition.rootId &&
    composition.nodes.some((node) => node.id === previous.nodeId)
  return {
    rootSourceId: snapshot.rootSourceId,
    rootId: composition.rootId,
    ...(keep ? { nodeId: previous.nodeId } : {}),
  }
}

/** Wrap complete supplied labels; no title attribute is needed to recover omitted text. */
export function privateCompositionTextLines(value: string, limit = 20): string[] {
  const lines: string[] = []
  let line = '', width = 0
  for (const character of value) {
    if (character === '\n') {
      lines.push(line)
      line = ''
      width = 0
      continue
    }
    const units = character.codePointAt(0)! > 255 ? 2 : /[A-Zmw@#%]/u.test(character) ? 1.5 : 1
    if (width + units > limit && line) {
      lines.push(line)
      line = ''
      width = 0
    }
    line += character
    width += units
  }
  if (line || !lines.length) lines.push(line)
  return lines
}

type Connection = {
  id: string
  source: string
  target: string
  edgeIds: string[]
  lines: string[]
  lineEdgeIds: string[]
  requestRows: { edgeId: string; line: number }[]
  labelWidth: number
  labelHeight: number
}
type Point = { x: number; y: number }

/** Condense cycles before assigning dependency columns, without merging component identities. */
function dependencyRanks(ids: string[], connections: Connection[]): Map<string, number> {
  const outgoing = new Map(ids.map((id) => [id, [] as string[]]))
  const incoming = new Map(ids.map((id) => [id, [] as string[]]))
  for (const connection of connections) {
    outgoing.get(connection.source)!.push(connection.target)
    incoming.get(connection.target)!.push(connection.source)
  }
  const visited = new Set<string>(), finished: string[] = []
  for (const id of ids) {
    if (visited.has(id)) continue
    visited.add(id)
    const stack = [{ id, cursor: 0 }]
    while (stack.length) {
      const frame = stack[stack.length - 1]!
      const next = outgoing.get(frame.id)![frame.cursor++]
      if (next !== undefined) {
        if (visited.has(next)) continue
        visited.add(next)
        stack.push({ id: next, cursor: 0 })
      } else {
        finished.push(frame.id)
        stack.pop()
      }
    }
  }
  const component = new Map<string, number>()
  let count = 0
  for (const id of finished.reverse()) {
    if (component.has(id)) continue
    const stack = [id]
    component.set(id, count)
    while (stack.length) {
      for (const next of incoming.get(stack.pop()!)!) {
        if (component.has(next)) continue
        component.set(next, count)
        stack.push(next)
      }
    }
    count++
  }
  const children = Array.from({ length: count }, () => new Set<number>())
  const indegree = Array<number>(count).fill(0), ranks = Array<number>(count).fill(0)
  for (const connection of connections) {
    const source = component.get(connection.source)!, target = component.get(connection.target)!
    if (source === target || children[source]!.has(target)) continue
    children[source]!.add(target)
    indegree[target]!++
  }
  const queue = indegree.flatMap((degree, index) => degree ? [] : [index])
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const source = queue[cursor]!
    for (const target of children[source]!) {
      ranks[target] = Math.max(ranks[target]!, ranks[source]! + 1)
      if (--indegree[target]! === 0) queue.push(target)
    }
  }
  return new Map(ids.map((id) => [id, ranks[component.get(id)!]!]))
}

function textWidth(value: string): number {
  return [...value].reduce((width, character) => width +
    (character.codePointAt(0)! > 255 ? 2 : /[A-Zmw@#%]/u.test(character) ? 1.5 : 1), 0) * 7
}

/** Rounded orthogonal paths keep bends outside cards and leave the label approach horizontal. */
function roundedPath(points: Point[]): string {
  const clean = points.filter((point, index) =>
    !index || point.x !== points[index - 1]!.x || point.y !== points[index - 1]!.y)
  const number = (value: number) => Math.round(value * 100) / 100
  const position = (point: Point) => number(point.x) + ' ' + number(point.y)
  let path = 'M ' + position(clean[0]!)
  for (let index = 1; index < clean.length - 1; index++) {
    const previous = clean[index - 1]!, point = clean[index]!, next = clean[index + 1]!
    const before = Math.hypot(point.x - previous.x, point.y - previous.y)
    const after = Math.hypot(next.x - point.x, next.y - point.y)
    const radius = Math.min(10, before / 2, after / 2)
    const enter = { x: point.x + (previous.x - point.x) * radius / before,
      y: point.y + (previous.y - point.y) * radius / before }
    const leave = { x: point.x + (next.x - point.x) * radius / after,
      y: point.y + (next.y - point.y) * radius / after }
    path += ' L ' + position(enter) + ' Q ' + position(point) + ' ' + position(leave)
  }
  return path + ' L ' + position(clean[clean.length - 1]!)
}

/** Align a column to its children while preserving the supplied sibling order and card gaps. */
function alignColumn(column: PrivateCompositionBox[], desired: number[], gap: number): void {
  const pools: { start: number; end: number; sum: number; count: number }[] = []
  const offsets: number[] = []
  let offset = 0
  for (let index = 0; index < column.length; index++) {
    offsets.push(offset)
    pools.push({ start: index, end: index, sum: desired[index]! - offset, count: 1 })
    offset += column[index]!.height + gap
    while (pools.length > 1) {
      const right = pools[pools.length - 1]!, left = pools[pools.length - 2]!
      if (left.sum / left.count <= right.sum / right.count) break
      left.end = right.end
      left.sum += right.sum
      left.count += right.count
      pools.pop()
    }
  }
  for (const pool of pools)
    for (let index = pool.start; index <= pool.end; index++)
      column[index]!.y = pool.sum / pool.count + offsets[index]!
}

/** Columns describe configured dependencies, never invocation order or possible execution paths. */
export function privateCompositionLayout(composition: AvailableComposition, run = false): {
  nodes: PrivateCompositionBox[]
  routes: PrivateCompositionRoute[]
  width: number
  height: number
} {
  const grouped = new Map<string, Connection>()
  for (const edge of composition.edges) {
    const key = JSON.stringify([edge.source, edge.target])
    let connection = grouped.get(key)
    if (!connection) {
      connection = { id: edge.id, source: edge.source, target: edge.target,
        edgeIds: [], lines: [], lineEdgeIds: [], requestRows: [], labelWidth: 0, labelHeight: 0 }
      grouped.set(key, connection)
    }
    if (run && connection.lines.length) {
      connection.lines.push('')
      connection.lineEdgeIds.push('')
    }
    const lines = privateCompositionTextLines(edge.slot, 16)
    connection.edgeIds.push(edge.id)
    connection.lines.push(...lines)
    connection.lineEdgeIds.push(...lines.map((_, index) => index ? '' : edge.id))
    // Reserve 48px for the exact request count and its separation from the slot label.
    connection.labelWidth = Math.max(connection.labelWidth, ...lines.map((line) => Math.ceil(textWidth(line)) + 68))
    if (run) {
      connection.requestRows.push({ edgeId: edge.id, line: connection.lines.length })
      connection.lines.push('', '', '')
      connection.lineEdgeIds.push('', '', '')
      connection.labelWidth = Math.max(connection.labelWidth, 228)
    }
    connection.labelHeight = Math.max(28, connection.lines.length * 15 + 12)
  }
  const connections = [...grouped.values()]
  const ranks = dependencyRanks(composition.nodes.map((node) => node.id), connections)
  const incoming = new Map(composition.nodes.map((node) => [node.id, [] as Connection[]]))
  const outgoing = new Map(composition.nodes.map((node) => [node.id, [] as Connection[]]))
  for (const connection of connections) {
    incoming.get(connection.target)!.push(connection)
    outgoing.get(connection.source)!.push(connection)
  }
  const cardWidth = run ? 240 : 224, siblingGap = 24, padding = 32
  const nodes = composition.nodes.map((node) => {
    const labelLines = privateCompositionTextLines(node.label)
    const entries = incoming.get(node.id)!
    const labelsHeight = entries.reduce((height, entry) => height + entry.labelHeight, 0) +
      Math.max(0, entries.length - 1) * 8
    return { id: node.id, x: 0, y: 0, width: cardWidth,
      height: Math.max(88 + labelLines.length * 20 + (run && node.id !== composition.rootId ? 60 : 0), labelsHeight + 32), labelLines }
  })
  const positions = new Map(nodes.map((node) => [node.id, node]))
  const levels: PrivateCompositionBox[][] = []
  for (const node of nodes) (levels[ranks.get(node.id)!] ??= []).push(node)
  const labelWidths = levels.map((level) => Math.max(0,
    ...level.flatMap((node) => incoming.get(node.id)!.map((connection) => connection.labelWidth))))
  const columnHeights = levels.map((level) =>
    level.reduce((height, node) => height + node.height, 0) + (level.length - 1) * siblingGap)
  const contentHeight = Math.max(0, ...columnHeights)
  let x = padding + (labelWidths[0] ? labelWidths[0]! + 56 : 0)
  for (let rank = 0; rank < levels.length; rank++) {
    let y = (contentHeight - columnHeights[rank]!) / 2
    for (const node of levels[rank]!) {
      node.x = x
      node.y = y
      y += node.height + siblingGap
    }
    x += cardWidth + Math.max(168, (labelWidths[rank + 1] ?? 0) + 64)
  }
  for (let rank = levels.length - 2; rank >= 0; rank--) {
    const column = levels[rank]!
    const desired = column.map((node) => {
      const children = outgoing.get(node.id)!.filter((connection) => ranks.get(connection.target)! > rank)
      return children.length ? children.reduce((center, connection) => {
        const target = positions.get(connection.target)!
        return center + target.y + target.height / 2
      }, 0) / children.length - node.height / 2 : node.y
    })
    alignColumn(column, desired, siblingGap)
  }
  const outside = connections.filter((connection) => ranks.get(connection.target)! !== ranks.get(connection.source)! + 1)
  const laneCount = Math.min(6, outside.length)
  const topInset = laneCount ? 46 + (laneCount - 1) * 20 : 0
  const top = Math.min(0, ...nodes.map((node) => node.y))
  for (const node of nodes) node.y += padding + topInset - top

  const sources = new Map<string, Point>(), targets = new Map<string, Point>()
  const labels = new Map<string, { x: number; top: number }>()
  for (const node of nodes) {
    const entries = incoming.get(node.id)!.slice().sort((left, right) => {
      const a = positions.get(left.source)!, b = positions.get(right.source)!
      return a.y + a.height / 2 - b.y - b.height / 2
    })
    const total = entries.reduce((height, entry) => height + entry.labelHeight, 0) +
      Math.max(0, entries.length - 1) * 8
    let labelTop = node.y + (node.height - total) / 2
    for (const entry of entries) {
      targets.set(entry.id, { x: node.x, y: labelTop + entry.labelHeight / 2 })
      labels.set(entry.id, { x: node.x - 16 - entry.labelWidth / 2, top: labelTop })
      labelTop += entry.labelHeight + 8
    }
    const exits = outgoing.get(node.id)!.slice().sort((left, right) => {
      const a = positions.get(left.target)!, b = positions.get(right.target)!
      return a.y + a.height / 2 - b.y - b.height / 2
    })
    for (let index = 0; index < exits.length; index++)
      sources.set(exits[index]!.id, { x: node.x + node.width,
        y: node.y + (exits.length === 1 ? node.height / 2 : 18 + (node.height - 36) * index / (exits.length - 1)) })
  }
  const departureLanes = new Map<string, number>()
  for (const node of nodes) {
    const forward = outgoing.get(node.id)!.filter((connection) =>
      ranks.get(connection.target)! === ranks.get(node.id)! + 1)
    const ordered = forward.slice().sort((left, right) => targets.get(left.id)!.y - targets.get(right.id)!.y)
    const above = ordered.filter((connection) => targets.get(connection.id)!.y < sources.get(connection.id)!.y)
    const below = ordered.filter((connection) => targets.get(connection.id)!.y >= sources.get(connection.id)!.y)
    // The farthest branches bend first, so their stems cannot cross a nearer branch's approach.
    for (const direction of [above, below.reverse()])
      for (let index = 0; index < direction.length; index++)
        departureLanes.set(direction[index]!.id, 20 + Math.min(index, 3) * 6)
  }
  let width = Math.max(0, ...nodes.map((node) => node.x + node.width)) + padding
  const height = Math.max(0, ...nodes.map((node) => node.y + node.height)) + padding
  let outsideIndex = 0
  const routes = connections.map((connection): PrivateCompositionRoute => {
    const source = sources.get(connection.id)!, target = targets.get(connection.id)!, label = labels.get(connection.id)!
    const sourceRank = ranks.get(connection.source)!, targetRank = ranks.get(connection.target)!
    const exit = source.x + (departureLanes.get(connection.id) ?? 20)
    let points: Point[]
    if (targetRank === sourceRank + 1) {
      points = [source, { x: exit, y: source.y }, { x: exit, y: target.y }, target]
    } else {
      const lane = padding + 10 + (outsideIndex++ % 6) * 20
      const entry = target.x - labelWidths[targetRank]! - 32
      points = [source, { x: exit, y: source.y }, { x: exit, y: lane },
        { x: entry, y: lane }, { x: entry, y: target.y }, target]
    }
    width = Math.max(width, exit + padding)
    return { ...connection, path: roundedPath(points), sourceX: source.x, sourceY: source.y,
      targetX: target.x, targetY: target.y, labelX: label.x, labelY: label.top + 17, labelTop: label.top }
  })
  return { nodes, routes, width: Math.ceil(width), height: Math.ceil(height) }
}
