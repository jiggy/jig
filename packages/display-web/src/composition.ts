import type { DisplayComposition, DisplaySnapshot } from '@jigging/display-model'

type AvailableComposition = Extract<DisplayComposition, { state: 'available' }>
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
  path: string
  labelX: number
  labelY: number
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

/** Positions are presentation only. Breadth does not establish invocation ordering. */
export function privateCompositionLayout(composition: AvailableComposition): {
  nodes: PrivateCompositionBox[]
  routes: PrivateCompositionRoute[]
  width: number
  height: number
} {
  const adjacent = new Map(composition.nodes.map((node) => [node.id, [] as string[]]))
  const grouped = new Map<string, { id: string; source: string; target: string; edgeIds: string[]; slots: string[] }>()
  for (const edge of composition.edges) {
    adjacent.get(edge.source)?.push(edge.target)
    const key = JSON.stringify([edge.source, edge.target])
    let group = grouped.get(key)
    if (!group) {
      group = { id: edge.id, source: edge.source, target: edge.target, edgeIds: [], slots: [] }
      grouped.set(key, group)
    }
    group.edgeIds.push(edge.id)
    group.slots.push(edge.slot)
  }
  const ranks = new Map<string, number>([[composition.rootId, 0]])
  const queue = [composition.rootId]
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const source = queue[cursor]!
    for (const target of adjacent.get(source) ?? []) {
      if (ranks.has(target)) continue
      ranks.set(target, ranks.get(source)! + 1)
      queue.push(target)
    }
  }
  const levels = new Map<number, typeof composition.nodes[number][]>()
  for (const node of composition.nodes) {
    const rank = ranks.get(node.id) ?? 0
    if (!levels.has(rank)) levels.set(rank, [])
    levels.get(rank)!.push(node)
  }
  const columns = Math.max(1, ...[...levels.values()].map((nodes) => nodes.length))
  const cardWidth = 220, columnGap = 112, padding = 48
  const contentWidth = Math.max(600, padding * 2 + columns * cardWidth + (columns - 1) * columnGap)
  const groupLines = new Map(
    [...grouped].map(([key, group]) => [key, group.slots.flatMap((slot) => privateCompositionTextLines(slot))]),
  )
  const rowGaps = new Map<number, number>()
  for (const [key, group] of grouped) {
    const rank = ranks.get(group.source) ?? 0
    rowGaps.set(rank, Math.max(rowGaps.get(rank) ?? 110, (groupLines.get(key)?.length ?? 1) * 15 + 62))
  }
  const nodes: PrivateCompositionBox[] = []
  const rowBottoms = new Map<number, number>()
  let y = padding
  for (const [rank, level] of [...levels].sort((left, right) => left[0] - right[0])) {
    const start = (contentWidth - level.length * cardWidth - (level.length - 1) * columnGap) / 2
    const row = level.map((node, index) => {
      const labelLines = privateCompositionTextLines(node.label)
      return {
        id: node.id, x: start + index * (cardWidth + columnGap), y,
        width: cardWidth, height: (node.kind === 'resource' ? 100 : 80) + labelLines.length * 20, labelLines,
      }
    })
    nodes.push(...row)
    const rowHeight = Math.max(100, ...row.map((node) => node.height))
    rowBottoms.set(rank, y + rowHeight)
    y += rowHeight + (rowGaps.get(rank) ?? 110)
  }
  const positions = new Map(nodes.map((node) => [node.id, node]))
  let width = contentWidth, height = y + padding
  const routes: PrivateCompositionRoute[] = []
  for (const [key, group] of grouped) {
    const source = positions.get(group.source), target = positions.get(group.target)
    if (!source || !target) continue
    const lines = groupLines.get(key) ?? []
    const sourceRank = ranks.get(source.id) ?? 0, targetRank = ranks.get(target.id) ?? 0
    let path: string, labelX: number, labelY: number
    if (targetRank === sourceRank + 1) {
      const x1 = source.x + cardWidth / 2, x2 = target.x + cardWidth / 2
      const y1 = source.y + source.height, y2 = target.y, middle = (y1 + y2) / 2
      path = 'M ' + x1 + ' ' + y1 + ' C ' + x1 + ' ' + middle + ' ' + x2 + ' ' + middle + ' ' + x2 + ' ' + y2
      labelX = (x1 + x2) / 2
      labelY = middle - (lines.length - 1) * 7.5
    } else {
      const lane = contentWidth + 35 + (routes.length % 5) * 24
      const y1 = source.y + source.height, y2 = target.y
      const exit = (rowBottoms.get(sourceRank) ?? y1) + 25, entry = y2 - 25
      path = 'M ' + (source.x + cardWidth / 2) + ' ' + y1 +
        ' V ' + exit + ' H ' + lane + ' V ' + entry +
        ' H ' + (target.x + cardWidth / 2) + ' V ' + y2
      labelX = lane + 86
      labelY = Math.max(padding, (y1 + y2) / 2 - (lines.length - 1) * 7.5)
      width = Math.max(width, labelX + 100)
    }
    height = Math.max(height, labelY + lines.length * 15 + padding)
    routes.push({ ...group, lines, path, labelX, labelY })
  }
  return { nodes, routes, width: Math.ceil(width), height: Math.ceil(height) }
}
