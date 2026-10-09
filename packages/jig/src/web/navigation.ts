import type { Block, Collection, DetailBlock, Reference, Value } from '@jigging/user-updates'
import type { PrivateWebSnapshot } from '../cli-web-snapshot.js'

export type PrivateBrowserLocal = {
  selected?: string | undefined
  filters: Map<string, string>
  sorts: Map<string, { key: string; descending: boolean }>
  expanded: boolean
  detailOpen: boolean
  signature?: string | undefined
  reference?: Reference | undefined
  previewSearch: string
  previewWrap: boolean
  plainDiff: boolean
  previewScroll?: { signature: string; left: number; top: number } | undefined
}
export type PrivateBrowserRecord = {
  key: string
  signature: string
  sourceId: string
  title: string
  section?: string | undefined
  text?: string | undefined
  block?: Exclude<Block, Collection> | undefined
  collection?: Collection | undefined
  row?: Collection['rows'][number] | undefined
}
export type PrivateBrowserReferenceTarget =
  | { kind: 'unavailable'; label: string }
  | { kind: 'artifact'; label: string; artifactId: string; captureGeneration: string }
  | { kind: 'record'; label: string; viewId: string; rowKey: string; collectionId: string }
  | { kind: 'call'; label: string; callId: string }

export const privateBrowserRowKey = (collection: string, row?: string): string =>
  JSON.stringify(['row', collection, row ?? null])

/** Saved adapters are host-owned. Authored IDs/titles never select host navigation. */
export function privateBrowserTabs(
  snapshot: PrivateWebSnapshot | undefined,
  mode = snapshot?.mode ?? 'live-run',
): {
  id: string
  title: string
  source: string
  icon: string
  application?: boolean
}[] {
  const views = snapshot?.views ?? []
  if (mode === 'recorded-packet') {
    const report = views.find((view) => view.hostRole === 'recorded-report')
    const diagnostics = views.find((view) => view.hostRole === 'recorded-diagnostics')
    return [
      ...(report ? [{ id: report.id, title: 'Recorded result', source: '', icon: '◈' }] : []),
      { id: 'files', title: 'Captured files', source: '', icon: '▤' },
      ...(diagnostics ? [{ id: diagnostics.id, title: 'Diagnostics', source: '', icon: '!' }] : []),
      ...views
        .filter((view) => !view.hostRole)
        .map((view) => ({
          id: view.id,
          title: view.value.title,
          source: view.sourceLabel,
          icon: '◈',
        })),
    ]
  }
  return [
    { id: 'overview', title: 'Execution', source: '', icon: '↳' },
    { id: 'activity', title: 'Activity', source: '', icon: '≡' },
    { id: 'files', title: 'Delivered files', source: '', icon: '▤' },
    ...views.map((view) => ({
      id: view.id,
      title: view.value.title,
      source: view.sourceLabel,
      icon: '◈',
      application: true,
    })),
  ]
}

export function privateBrowserLiteral(value: string): string {
  // Preserve line breaks/spacing, expose invisible controls/bidi overrides as data.
  return value.replace(
    // biome-ignore lint/suspicious/noControlCharactersInRegex: Display these exact controls visibly as inert data.
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g,
    (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`,
  )
}

export function privateBrowserValue(value: Value): string {
  if (value === null) return 'null'
  if (typeof value !== 'object') return privateBrowserLiteral(String(value))
  if (value.kind === 'artifact') return privateBrowserLiteral(value.path)
  if (value.kind === 'call') return `Call: ${privateBrowserLiteral(value.operationId)}`
  return `Record: ${privateBrowserLiteral(value.rowId)}`
}

export function privateBrowserReferences(record: PrivateBrowserRecord | undefined): Reference[] {
  const references = new Map<string, Reference>()
  const add = (reference: Reference) =>
    references.set(
      JSON.stringify(
        reference.kind === 'artifact'
          ? ['artifact', reference.attachment, reference.path]
          : reference.kind === 'call'
            ? ['call', reference.operationId]
            : ['record', reference.viewId, reference.collectionId, reference.rowId],
      ),
      reference,
    )
  const block = (item: DetailBlock) => {
    if (item.kind === 'report') for (const reference of item.references ?? []) add(reference)
    if (item.kind === 'facts')
      for (const fact of item.items)
        if (fact.value !== null && typeof fact.value === 'object') add(fact.value)
  }
  if (record?.block) block(record.block)
  if (record?.row) {
    for (const cell of Object.values(record.row.cells))
      if (cell !== null && typeof cell === 'object') add(cell)
    for (const detail of record.row.details ?? []) block(detail)
  }
  return [...references.values()]
}

export function privateBrowserPeek(
  record: PrivateBrowserRecord | undefined,
): Reference | undefined {
  const refs = privateBrowserReferences(record)
  return refs.length === 1 && refs[0]!.kind === 'artifact' ? refs[0] : undefined
}

export function privateBrowserResolve(
  snapshot: PrivateWebSnapshot,
  sourceId: string,
  ref: Reference,
): PrivateBrowserReferenceTarget {
  if (ref.kind === 'call') {
    const call = snapshot.calls.find(
      (item) => item.sourceId === sourceId && item.operationId === ref.operationId,
    )
    return call
      ? { kind: 'call', label: `${call.slot}: ${call.state}`, callId: call.id }
      : { kind: 'unavailable', label: 'Observed call unavailable' }
  }
  if (ref.kind === 'record') {
    const view = snapshot.views.find(
      (item) => item.sourceId === sourceId && item.value.id === ref.viewId,
    )
    const collection = view?.value.sections
      .flatMap((section) => section.blocks)
      .find(
        (item): item is Collection => item.kind === 'collection' && item.id === ref.collectionId,
      )
    return view && collection?.rows.some((row) => row.id === ref.rowId)
      ? {
          kind: 'record',
          label: `${view.value.title} / ${ref.rowId}`,
          viewId: view.id,
          rowKey: privateBrowserRowKey(ref.collectionId, ref.rowId),
          collectionId: ref.collectionId,
        }
      : { kind: 'unavailable', label: 'Referenced record unavailable' }
  }
  const capture = snapshot.artifacts
  if (sourceId !== capture.sourceId || !capture.permittedAttachments.includes(ref.attachment))
    return {
      kind: 'unavailable',
      label: 'Artifact unavailable in this publisher’s verified output',
    }
  if (capture.phase === 'pending')
    return { kind: 'unavailable', label: 'Artifact pending verified delivery' }
  const file = capture.files.find((item) => item.path === ref.path)
  return capture.phase === 'ready' && file
    ? {
        kind: 'artifact',
        label: file.path,
        artifactId: file.id,
        captureGeneration: capture.generation,
      }
    : { kind: 'unavailable', label: 'Artifact unavailable in the immutable capture' }
}

export function privateBrowserRows(
  collection: Collection,
  local: PrivateBrowserLocal,
): Collection['rows'] {
  const query = (local.filters.get(collection.id) ?? '').toLocaleLowerCase()
  const rows = collection.rows.filter(
    (row) =>
      !query ||
      collection.columns.some((column) =>
        privateBrowserValue(row.cells[column.key] ?? null)
          .toLocaleLowerCase()
          .includes(query),
      ),
  )
  const sort = local.sorts.get(collection.id)
  if (!sort || !collection.columns.some((column) => column.key === sort.key)) return rows
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const first = a.row.cells[sort.key] ?? null
      const second = b.row.cells[sort.key] ?? null
      const order =
        typeof first === 'number' && typeof second === 'number'
          ? first - second
          : privateBrowserValue(first).localeCompare(privateBrowserValue(second))
      return (sort.descending ? -order : order) || a.index - b.index
    })
    .map((item) => item.row)
}

export function privateBrowserRecords(
  view: PrivateWebSnapshot['views'][number],
  local: PrivateBrowserLocal,
): PrivateBrowserRecord[] {
  const records: PrivateBrowserRecord[] = [
    {
      key: 'summary',
      signature: view.value.summary,
      sourceId: view.sourceId,
      title: 'View summary',
      text: view.value.summary,
    },
  ]
  view.value.sections.forEach((section, sectionIndex) => {
    section.blocks.forEach((block, blockIndex) => {
      const base = { sourceId: view.sourceId, section: section.title }
      if (block.kind === 'collection') {
        const rows = privateBrowserRows(block, local)
        if (!rows.length)
          records.push({
            ...base,
            key: privateBrowserRowKey(block.id),
            signature: JSON.stringify(block),
            title: block.title,
            collection: block,
            text: block.rows.length ? 'No matching supplied records.' : 'No records were supplied.',
          })
        for (const row of rows)
          records.push({
            ...base,
            key: privateBrowserRowKey(block.id, row.id),
            signature: JSON.stringify([block.columns, row]),
            title: privateBrowserValue(row.cells[block.columns[0]!.key] ?? null),
            collection: block,
            row,
          })
      } else
        records.push({
          ...base,
          key: JSON.stringify(['block', sectionIndex, blockIndex]),
          signature: JSON.stringify(block),
          title:
            block.kind === 'progress' ? block.label : block.kind === 'facts' ? 'Facts' : 'Report',
          block,
        })
    })
  })
  return records
}

export function privateBrowserSurvivingSelection(
  previous: readonly string[],
  selected: string | undefined,
  next: readonly string[],
): string | undefined {
  if (selected && next.includes(selected)) return selected
  const position = selected ? previous.indexOf(selected) : -1
  for (let index = position - 1; index >= 0; index--)
    if (next.includes(previous[index]!)) return previous[index]
  return next[0]
}

export function privateBrowserLocal(): PrivateBrowserLocal {
  return {
    filters: new Map(),
    sorts: new Map(),
    expanded: false,
    detailOpen: false,
    previewSearch: '',
    previewWrap: false,
    plainDiff: false,
  }
}

/** Frozen while stale; equal-revision acknowledgments resume from retained time. */
export class PrivateBrowserClock {
  #revision = 0
  #elapsed = 0
  #at = 0
  #running = false
  read(now: number): number {
    return this.#elapsed + (this.#running ? Math.max(0, now - this.#at) : 0)
  }
  observe(revision: number, elapsed: number, live: boolean, fresh: boolean, now: number): void {
    this.#elapsed = this.read(now)
    if (revision !== this.#revision) {
      this.#revision = revision
      this.#elapsed = elapsed
    }
    this.#at = now
    this.#running = live && fresh
  }
}
