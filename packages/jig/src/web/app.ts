import type { DetailBlock, Reference, Value } from '@jigging/user-updates'
import { type ComponentChildren, h, render } from 'preact'
import type {
  PrivateWebAttribution,
  PrivateWebSnapshot,
  PrivateWebSnapshotEnvelope,
} from '../cli-web-snapshot.js'
import { PrivateBrowserClient, privateBrowserCapability } from './client.js'
import {
  PrivateBrowserClock,
  type PrivateBrowserLocal,
  type PrivateBrowserRecord,
  privateBrowserLiteral,
  privateBrowserLocal,
  privateBrowserPeek,
  privateBrowserRecords,
  privateBrowserReferences,
  privateBrowserResolve,
  privateBrowserRowKey,
  privateBrowserSurvivingSelection,
  privateBrowserValue,
} from './navigation.js'

let capability = privateBrowserCapability(location.hash)
let hasCapability = !!capability
history.replaceState(null, '', location.pathname)
const root = document.getElementById('app')!
const local = new Map<string, PrivateBrowserLocal>()
const previousKeys = new Map<string, string[]>()
const scrollPositions = new Map<string, number>()
const treeChoices = new Map<string, boolean>()
let viewId = 'activity'
let humanNavigation = false
let landed = false
let lastBodyRevision = 0
let previousCallKeys: string[] = []
const elapsedClock = new PrivateBrowserClock()
let selectedCall: string | undefined
let panel: 'attention' | 'diagnostics' | 'help' | undefined
let panelOrigin: HTMLElement | undefined
let announcement = ''
let feedback = ''
let closing = false
let clock: ReturnType<typeof setInterval> | undefined
let client: PrivateBrowserClient | undefined

const literal = (text: string): ComponentChildren =>
  h('bdi', { class: 'literal' }, privateBrowserLiteral(text))
const button = (label: ComponentChildren, click: () => void, props: Record<string, unknown> = {}) =>
  h('button', { type: 'button', onClick: click, ...props }, label)
const teaser = (text: string, count = 180): string => {
  let result = '',
    length = 0
  for (const character of text) {
    if (length++ >= count) return `${result}…`
    result += character
  }
  return result
}
const currentLocal = (): PrivateBrowserLocal => {
  if (!local.has(viewId)) local.set(viewId, privateBrowserLocal())
  return local.get(viewId)!
}
const view = () => client?.body?.views.find((item) => item.id === viewId)
const records = (): PrivateBrowserRecord[] => {
  const selected = view()
  return selected ? privateBrowserRecords(selected, currentLocal()) : []
}
const selectedRecord = () => records().find((record) => record.key === currentLocal().selected)
const provenance = (value: PrivateWebAttribution): string =>
  value.provenance === 'recorded-claim'
    ? 'Recorded claim'
    : value.provenance === 'host-observed'
      ? 'Host observation'
      : value.ancestryIncomplete
        ? 'Accepted source · ancestry incomplete'
        : value.relation === 'root'
          ? 'Root publisher'
          : value.relation === 'observed-call'
            ? 'Observed publisher'
            : 'Accepted source · relationship unavailable'

function redraw(): void {
  const focused = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
  if (client?.body && client.body.revision !== lastBodyRevision) {
    const snapshot = client.body
    const eligible = new Set([
      'activity',
      'overview',
      'files',
      ...snapshot.views.map((item) => item.id),
    ])
    for (const key of local.keys())
      if (!eligible.has(key)) {
        local.delete(key)
        previousKeys.delete(key)
        scrollPositions.delete(key)
      }
    for (const key of treeChoices.keys())
      if (!snapshot.calls.some((call) => call.id === key)) treeChoices.delete(key)
    if (!eligible.has(viewId)) {
      viewId = 'overview'
      feedback = 'The selected view retired; showing Overview.'
    }
    if (!humanNavigation) {
      const rootViews = snapshot.views.filter(
        (item) => item.sourceId === snapshot.artifacts.sourceId,
      )
      const landing = !landed && rootViews.find((item) => item.value.landing)
      if (landing) {
        viewId = landing.id
        landed = true
      } else if (snapshot.workspace.phase === 'settled' && rootViews.length)
        viewId = rootViews[0]!.id
    }
    for (const item of snapshot.views) {
      if (!local.has(item.id)) local.set(item.id, privateBrowserLocal())
      const state = local.get(item.id)!
      const collections = item.value.sections
        .flatMap((section) => section.blocks)
        .filter((block) => block.kind === 'collection')
      for (const key of state.filters.keys())
        if (!collections.some((collection) => collection.id === key)) state.filters.delete(key)
      for (const [key, sort] of state.sorts)
        if (
          !collections.some(
            (collection) =>
              collection.id === key && collection.columns.some((column) => column.key === sort.key),
          )
        )
          state.sorts.delete(key)
      const nextRecords = privateBrowserRecords(item, state)
      const keys = nextRecords.map((record) => record.key)
      if (
        state.selected ||
        (snapshot.workspace.phase === 'settled' && !humanNavigation && item.id === viewId)
      ) {
        state.selected = privateBrowserSurvivingSelection(
          previousKeys.get(item.id) ?? [],
          state.selected,
          keys,
        )
        if (!humanNavigation) {
          state.selected = nextRecords.find((record) => record.row)?.key ?? state.selected
          state.detailOpen = true
        }
      }
      previousKeys.set(item.id, keys)
    }
    const callKeys = snapshot.calls.map((call) => call.id)
    if (selectedCall)
      selectedCall = privateBrowserSurvivingSelection(previousCallKeys, selectedCall, callKeys)
    previousCallKeys = callKeys
    if (
      viewId === 'files' &&
      currentLocal().selected &&
      !snapshot.artifacts.files.some((file) => file.id === currentLocal().selected)
    )
      currentLocal().selected = snapshot.artifacts.files[0]?.id
    lastBodyRevision = snapshot.revision
  }
  if (client?.current)
    elapsedClock.observe(
      client.current.revision,
      client.current.workspace.elapsedMs,
      client.current.workspace.phase === 'live',
      client.observationFresh,
      performance.now(),
    )
  const record = selectedRecord()
  const signature = record
    ? JSON.stringify([viewId, record.key, record.signature])
    : `${viewId}:${currentLocal().selected ?? ''}`
  const state = currentLocal()
  if (signature !== state.signature) {
    state.signature = signature
    state.reference = undefined
    state.previewSearch = ''
    state.previewScroll = undefined
    state.expanded = false
  }
  const snapshot = client?.body
  const reference = state.reference ?? privateBrowserPeek(record)
  const target =
    snapshot && reference && record
      ? privateBrowserResolve(snapshot, record.sourceId, reference)
      : undefined
  const file =
    viewId === 'files'
      ? snapshot?.artifacts.files.find((item) => item.id === currentLocal().selected)
      : undefined
  const intent =
    client?.referencesEnabled &&
    snapshot &&
    currentLocal().detailOpen &&
    !panel &&
    (target?.kind === 'artifact' || file)
      ? {
          artifactId:
            file?.id ?? (target as Extract<typeof target, { kind: 'artifact' }>).artifactId,
          captureGeneration: snapshot.artifacts.generation,
          signature: JSON.stringify([
            signature,
            privateBrowserReferences(record),
            state.reference ?? null,
          ]),
        }
      : undefined
  // Setting intent may synchronously notify; an identical intent is an idempotent no-op.
  client?.setPreview(intent)
  render(h(App, {}), root)
  if (focused && !focused.isConnected) {
    if (focused.dataset.record !== undefined)
      document.querySelector<HTMLButtonElement>('[data-record][aria-pressed=true]')?.focus()
    else if (focused.dataset.call !== undefined)
      document.querySelector<HTMLButtonElement>('[data-call][aria-pressed=true]')?.focus()
    else if (focused.getAttribute('role') === 'tab')
      document.querySelector<HTMLButtonElement>('[role=tab][tabindex="0"]')?.focus()
  }
}

function navigate(id: string): void {
  const body = document.getElementById('view-panel')
  if (body && !panel) scrollPositions.set(viewId, body.scrollTop)
  humanNavigation = true
  viewId = id
  panel = undefined
  client?.setPreview(undefined)
  feedback = ''
  redraw()
  const nextBody = document.getElementById('view-panel')
  if (nextBody) nextBody.scrollTop = scrollPositions.get(id) ?? 0
}
function focusSelectedEntry(): void {
  document
    .querySelector<HTMLButtonElement>(
      '[data-record][aria-pressed=true], [data-call][aria-pressed=true]',
    )
    ?.focus()
}
function select(key: string): void {
  humanNavigation = true
  currentLocal().selected = key
  currentLocal().detailOpen = true
  currentLocal().expanded = false
  currentLocal().reference = undefined
  feedback = ''
  redraw()
  if (matchMedia('(max-width: 599px)').matches)
    document.querySelector<HTMLButtonElement>('.back-to-records')?.focus()
}
function selectCall(id: string): void {
  selectedCall = id
  currentLocal().detailOpen = true
  let call = client?.body?.calls.find((item) => item.id === id)
  for (let depth = 0; call?.parentId && depth < 32; depth++) {
    treeChoices.set(call.parentId, true)
    call = client?.body?.calls.find((item) => item.id === call!.parentId)
  }
  redraw()
  if (matchMedia('(max-width: 599px)').matches)
    document.querySelector<HTMLButtonElement>('.back-to-records')?.focus()
}
function openPanel(next: typeof panel): void {
  const body = document.getElementById('view-panel')
  if (body && !panel) scrollPositions.set(viewId, body.scrollTop)
  humanNavigation = true
  panelOrigin = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
  panel = next
  redraw()
  const panelBody = document.getElementById('view-panel')
  if (panelBody) panelBody.scrollTop = 0
  document.getElementById('panel-back')?.focus()
}
function closePanel(): void {
  panel = undefined
  redraw()
  const body = document.getElementById('view-panel')
  if (body) body.scrollTop = scrollPositions.get(viewId) ?? 0
  panelOrigin?.focus()
  panelOrigin = undefined
}
function activate(reference: Reference, record: PrivateBrowserRecord): void {
  if (!client?.referencesEnabled || !client.body) return
  const target = privateBrowserResolve(client.body, record.sourceId, reference)
  if (target.kind === 'unavailable') {
    feedback = target.label
    redraw()
    return
  }
  humanNavigation = true
  if (target.kind === 'artifact') {
    currentLocal().reference = reference
    currentLocal().previewSearch = ''
    currentLocal().previewScroll = undefined
    redraw()
    return
  }
  if (target.kind === 'record') {
    navigate(target.viewId)
    const state = currentLocal()
    if (state.filters.delete(target.collectionId))
      feedback = 'The local filter was cleared to show the referenced record.'
    select(target.rowKey)
  } else {
    navigate('overview')
    selectCall(target.callId)
  }
}

function Progress({
  block,
}: {
  block: Extract<DetailBlock, { kind: 'progress' }>
}): ComponentChildren {
  return h(
    'div',
    { class: 'progress-block' },
    h('strong', {}, literal(block.label)),
    h(
      'span',
      { class: 'count' },
      `${block.completed}${block.total === undefined ? '' : ` / ${block.total}`} `,
      block.unit ? literal(block.unit) : null,
    ),
    block.total && block.total > 0
      ? h('progress', {
          value: block.completed,
          max: block.total,
          'aria-label': privateBrowserLiteral(block.label),
        })
      : null,
  )
}
function ReferenceButton({
  value,
  record,
}: {
  value: Reference
  record: PrivateBrowserRecord
}): ComponentChildren {
  const resolved = client?.body && privateBrowserResolve(client.body, record.sourceId, value)
  return button(
    h(
      'span',
      {},
      literal(
        value.kind === 'artifact' ? value.path : (resolved?.label ?? privateBrowserValue(value)),
      ),
      resolved?.kind === 'unavailable' ? h('small', {}, literal(resolved.label)) : null,
    ),
    () => activate(value, record),
    {
      class: 'reference',
      disabled: !client?.referencesEnabled || resolved?.kind === 'unavailable',
      title: !client?.referencesEnabled
        ? 'References are disabled while observation is stale.'
        : undefined,
    },
  )
}
function Field({
  label,
  value,
  record,
}: {
  label: string
  value: Value
  record: PrivateBrowserRecord
}): ComponentChildren {
  return h(
    'div',
    { class: 'field' },
    h('dt', {}, literal(label)),
    h(
      'dd',
      {},
      value !== null && typeof value === 'object'
        ? h(ReferenceButton, { value, record })
        : literal(privateBrowserValue(value)),
    ),
  )
}
function Block({
  block,
  record,
}: {
  block: DetailBlock
  record: PrivateBrowserRecord
}): ComponentChildren {
  if (block.kind === 'report')
    return h(
      'div',
      {},
      h('p', { class: 'report' }, literal(block.text || '(Empty report)')),
      block.references?.map((value, index) => h(ReferenceButton, { key: index, value, record })),
    )
  if (block.kind === 'progress') return h(Progress, { block })
  return h(
    'dl',
    { class: 'fields' },
    block.items.map((item, index) => h(Field, { key: index, ...item, record })),
  )
}
function recordTeaser(record: PrivateBrowserRecord): ComponentChildren {
  if (record.row && record.collection)
    return record.collection.columns
      .slice(0, 3)
      .map((column) =>
        h(
          'div',
          { key: column.key, class: 'card-field' },
          h('span', { class: 'label' }, literal(column.label)),
          h(
            'span',
            {},
            literal(teaser(privateBrowserValue(record.row!.cells[column.key] ?? null), 110)),
          ),
        ),
      )
  if (record.block?.kind === 'progress') return h(Progress, { block: record.block })
  if (record.block?.kind === 'facts')
    return literal(
      `${record.block.items.length} supplied ${record.block.items.length === 1 ? 'fact' : 'facts'}`,
    )
  return literal(teaser(record.block?.kind === 'report' ? record.block.text : (record.text ?? '')))
}
function ApplicationList(): ComponentChildren {
  const selected = view()
  if (!selected) return null
  const state = currentLocal()
  const supplied = records()
  const collectionKeys = new Set<string>()
  return h(
    'section',
    { class: 'records', 'aria-label': 'Supplied entries' },
    h('h2', {}, literal(selected.value.title)),
    h(
      'p',
      { class: 'source' },
      literal(selected.sourceLabel),
      ' · ',
      selected.ended ? literal(selected.ended) : 'Observed view',
      ' · ',
      new Date(selected.updatedAt).toISOString(),
    ),
    supplied.flatMap((record) => {
      const first = record.collection && !collectionKeys.has(record.collection.id)
      if (record.collection) collectionKeys.add(record.collection.id)
      const heading =
        first && record.collection
          ? h(
              'div',
              { key: `collection:${record.collection.id}`, class: 'collection-heading' },
              h('h3', {}, literal(record.collection.title)),
              h(
                'p',
                { class: 'secondary' },
                `${record.collection.rows.length} retained${record.collection.total === undefined ? '' : ` / ${record.collection.total} reported`}`,
              ),
              h(
                'div',
                { class: 'collection-controls' },
                h(
                  'label',
                  {},
                  'Filter supplied records',
                  h('input', {
                    value: state.filters.get(record.collection.id) ?? '',
                    placeholder: 'Find a record…',
                    onInput: (event: Event) => {
                      humanNavigation = true
                      state.filters.set(
                        record.collection!.id,
                        (event.target as HTMLInputElement).value,
                      )
                      const next = records()
                      state.selected = privateBrowserSurvivingSelection(
                        previousKeys.get(viewId) ?? [],
                        state.selected,
                        next.map((item) => item.key),
                      )
                      previousKeys.set(
                        viewId,
                        next.map((item) => item.key),
                      )
                      redraw()
                    },
                  }),
                ),
                h(
                  'label',
                  {},
                  'Sort',
                  h(
                    'select',
                    {
                      value: state.sorts.get(record.collection.id)?.key ?? '',
                      onChange: (event: Event) => {
                        humanNavigation = true
                        const key = (event.target as HTMLSelectElement).value
                        if (key) state.sorts.set(record.collection!.id, { key, descending: false })
                        else state.sorts.delete(record.collection!.id)
                        redraw()
                      },
                    },
                    h('option', { value: '' }, 'Supplied order'),
                    record.collection.columns.map((column) =>
                      h('option', { key: column.key, value: column.key }, literal(column.label)),
                    ),
                  ),
                ),
                state.sorts.has(record.collection.id)
                  ? button(
                      state.sorts.get(record.collection.id)!.descending
                        ? 'Descending'
                        : 'Ascending',
                      () => {
                        humanNavigation = true
                        const sort = state.sorts.get(record.collection!.id)!
                        state.sorts.set(record.collection!.id, {
                          ...sort,
                          descending: !sort.descending,
                        })
                        redraw()
                      },
                    )
                  : null,
              ),
            )
          : null
      return [
        heading,
        h(
          'div',
          { key: record.key },
          record.section ? h('small', { class: 'secondary' }, literal(record.section)) : null,
          button(
            h(
              'span',
              {},
              h('strong', {}, literal(record.title)),
              h('span', { class: 'card-observation' }, recordTeaser(record)),
            ),
            () => select(record.key),
            {
              class: `record ${state.selected === record.key ? 'selected' : ''}`,
              'aria-pressed': state.selected === record.key,
              'data-record': record.key,
              onKeyDown: recordKeyDown,
            },
          ),
        ),
      ]
    }),
  )
}

function recordKeyDown(event: KeyboardEvent): void {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
  const buttons = [...document.querySelectorAll<HTMLButtonElement>('[data-record]')]
  const index = buttons.indexOf(event.currentTarget as HTMLButtonElement)
  const next =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? buttons.length - 1
        : Math.max(0, Math.min(buttons.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))
  event.preventDefault()
  buttons[next]?.focus()
}

function Preview({ path }: { path: string }): ComponentChildren {
  const state = currentLocal()
  const { previewSearch, previewWrap, plainDiff } = state
  const preview = client?.preview
  const reply = preview?.reply
  const text = privateBrowserLiteral(reply?.text ?? '')
  const patchText = text.startsWith('diff --git ') || /^--- [^\n]+\n\+\+\+ [^\n]+\n@@ /.test(text)
  const diff = !plainDiff && patchText && text.split('\n').length <= 2048
  let content: ComponentChildren = text
  let matches = 0
  if (previewSearch && text) {
    const parts: ComponentChildren[] = []
    let start = 0,
      index = text.indexOf(previewSearch)
    while (index !== -1 && matches < 128) {
      parts.push(
        text.slice(start, index),
        h('mark', { key: index }, text.slice(index, index + previewSearch.length)),
      )
      start = index + previewSearch.length
      matches++
      index = text.indexOf(previewSearch, start)
    }
    parts.push(text.slice(start))
    content = parts
  } else if (diff)
    content = text.split('\n').map((line, index) =>
      h(
        'span',
        {
          key: index,
          class:
            line.startsWith('+') && !line.startsWith('+++')
              ? 'diff-add'
              : line.startsWith('-') && !line.startsWith('---')
                ? 'diff-remove'
                : 'diff-context',
        },
        line,
        '\n',
      ),
    )
  return h(
    'section',
    { class: 'file-preview', 'aria-label': 'File content' },
    h('h2', {}, literal(path)),
    !client?.referencesEnabled
      ? h(
          'p',
          { class: 'unavailable-note' },
          'File references are disabled while observation is stale.',
        )
      : !preview || preview.phase === 'loading'
        ? h('p', { role: 'status' }, 'Loading immutable preview…')
        : preview.phase === 'unavailable' || reply?.state === 'unavailable'
          ? h(
              'p',
              {},
              'Immutable text preview unavailable. Inspect the delivered evidence location reported in the terminal.',
            )
          : reply?.state === 'non-text'
            ? h('p', {}, 'This captured file has no UTF-8 text preview.')
            : reply?.state === 'empty'
              ? h('p', {}, 'This file is empty.')
              : h(
                  'div',
                  {},
                  h(
                    'div',
                    { class: 'preview-controls' },
                    button(previewWrap ? 'Preserve lines' : 'Wrap text', () => {
                      state.previewWrap = !previewWrap
                      redraw()
                    }),
                    patchText
                      ? button(plainDiff ? 'Diff colors' : 'Plain text', () => {
                          state.plainDiff = !plainDiff
                          redraw()
                        })
                      : null,
                    h(
                      'label',
                      {},
                      'Search retained excerpt',
                      h('input', {
                        value: previewSearch,
                        maxLength: 1024,
                        placeholder: 'Literal text…',
                        onInput: (event: Event) => {
                          state.previewSearch = (event.target as HTMLInputElement).value
                          redraw()
                        },
                      }),
                    ),
                  ),
                  previewSearch
                    ? h(
                        'p',
                        { class: 'secondary' },
                        `${matches}${matches === 128 ? ' or more' : ''} matches in this retained excerpt`,
                      )
                    : null,
                  h(
                    'pre',
                    {
                      class: previewWrap ? 'wrap' : '',
                      tabIndex: 0,
                      'aria-label': 'Retained file excerpt',
                      onScroll: (event: Event) => {
                        const element = event.currentTarget as HTMLElement
                        state.previewScroll = {
                          signature: state.signature ?? '',
                          left: element.scrollLeft,
                          top: element.scrollTop,
                        }
                      },
                      ref: (element: HTMLElement | null) => {
                        const anchor = state.previewScroll
                        if (element && anchor && anchor.signature === state.signature) {
                          element.scrollTop = anchor.top
                          element.scrollLeft = anchor.left
                        }
                      },
                    },
                    h('code', {}, content),
                  ),
                ),
    reply
      ? h(
          'p',
          { class: 'secondary' },
          `${reply.bytes} bytes · ${reply.provenance === 'recorded-capture' ? 'Recorded immutable capture' : 'Verified delivery'}${reply.clipped ? ' · excerpt clipped at 64 KiB' : ''}. Search covers the retained excerpt only.`,
        )
      : null,
  )
}

function SelectedDetail(): ComponentChildren {
  const record = selectedRecord()
  const state = currentLocal()
  if (!record)
    return h(
      'aside',
      { class: 'detail empty' },
      h('h2', {}, 'Select an entry'),
      h('p', {}, 'Read supplied context or referenced evidence here.'),
    )
  const reference = state.reference ?? privateBrowserPeek(record)
  const target =
    reference && client?.body
      ? privateBrowserResolve(client.body, record.sourceId, reference)
      : undefined
  return h(
    'aside',
    { class: 'detail', 'aria-label': 'Selected detail' },
    button(
      '← Back to records',
      () => {
        state.detailOpen = false
        client?.setPreview(undefined)
        redraw()
        focusSelectedEntry()
      },
      { class: 'back-to-records' },
    ),
    h(
      'div',
      { class: 'detail-heading' },
      h('h2', {}, literal(record.title)),
      button(
        state.expanded ? 'Reduce detail' : 'Expand evidence',
        () => {
          humanNavigation = true
          state.expanded = !state.expanded
          redraw()
        },
        { 'aria-expanded': state.expanded },
      ),
    ),
    reference?.kind === 'artifact'
      ? target?.kind === 'artifact'
        ? h(Preview, { path: reference.path })
        : h(
            'section',
            {},
            h('h3', {}, literal(reference.path)),
            h('p', {}, target?.label ?? 'Artifact unavailable'),
          )
      : null,
    record.text ? h('p', { class: 'report' }, literal(record.text)) : null,
    record.block ? h(Block, { block: record.block, record }) : null,
    record.row
      ? h(
          'div',
          {},
          record.row.details?.length ? h('h3', {}, 'Supplied context') : null,
          record.row.details?.map((block, index) => h(Block, { key: index, block, record })),
          record.collection!.columns.length > 3
            ? h(
                'div',
                {},
                h('h3', {}, 'Additional fields'),
                h(
                  'dl',
                  { class: 'fields' },
                  record.collection!.columns.slice(3).map((column) =>
                    h(Field, {
                      key: column.key,
                      label: column.label,
                      value: record.row!.cells[column.key] ?? null,
                      record,
                    }),
                  ),
                ),
              )
            : null,
          state.expanded
            ? h(
                'div',
                {},
                h('h3', {}, 'Complete record fields'),
                h(
                  'dl',
                  { class: 'fields' },
                  record.collection!.columns.map((column) =>
                    h(Field, {
                      key: column.key,
                      label: column.label,
                      value: record.row!.cells[column.key] ?? null,
                      record,
                    }),
                  ),
                ),
              )
            : null,
          !record.row.details?.length && record.collection!.columns.length <= 3 && !reference
            ? h(
                'p',
                { class: 'secondary' },
                'No additional context was supplied. Expand to read all fields.',
              )
            : null,
        )
      : null,
    record.block?.kind === 'progress'
      ? h(
          'p',
          { class: 'secondary' },
          'These are publisher-reported counts. Reaching the total does not establish the application outcome.',
        )
      : null,
    privateBrowserReferences(record).length
      ? h(
          'div',
          { class: 'references' },
          h('h3', {}, 'References'),
          privateBrowserReferences(record).map((value, index) =>
            h(ReferenceButton, { key: index, value, record }),
          ),
        )
      : null,
  )
}

function Files(): ComponentChildren {
  const snapshot = client?.body
  if (!snapshot) return null
  const capture = snapshot.artifacts
  const state = currentLocal()
  const file = capture.files.find((item) => item.id === state.selected)
  return h(
    'div',
    {
      class: `workspace ${state.detailOpen ? 'show-detail' : ''} ${state.expanded ? 'expanded' : ''}`,
    },
    h(
      'section',
      { class: 'records' },
      h('h2', {}, snapshot.mode === 'recorded-packet' ? 'Captured files' : 'Delivered files'),
      h('p', {}, 'Only immutable captured inventory is shown.'),
      capture.phase === 'pending'
        ? h('p', {}, 'Files are pending verified delivery. No paths are guessed.')
        : capture.phase === 'unavailable'
          ? h('p', {}, 'File capture is unavailable.')
          : !capture.files.length
            ? h('p', {}, 'The verified inventory is empty.')
            : capture.files.map((item) =>
                button(
                  h(
                    'span',
                    {},
                    h('strong', {}, literal(item.path)),
                    h(
                      'small',
                      {},
                      item.state === 'non-text'
                        ? 'No text preview'
                        : item.state === 'unavailable'
                          ? 'Preview unavailable'
                          : item.state === 'empty'
                            ? 'Empty file'
                            : 'Text preview',
                    ),
                  ),
                  () => select(item.id),
                  {
                    key: item.id,
                    class: `record ${state.selected === item.id ? 'selected' : ''}`,
                    'aria-pressed': state.selected === item.id,
                    'data-record': item.id,
                    onKeyDown: recordKeyDown,
                  },
                ),
              ),
    ),
    h(
      'aside',
      { class: 'detail', 'aria-label': 'Selected file' },
      button(
        '← Back to files',
        () => {
          state.detailOpen = false
          redraw()
          focusSelectedEntry()
        },
        { class: 'back-to-records' },
      ),
      file
        ? h(
            'div',
            {},
            h(
              'div',
              { class: 'detail-heading' },
              h('h2', {}, 'File evidence'),
              button(
                state.expanded ? 'Reduce detail' : 'Expand evidence',
                () => {
                  state.expanded = !state.expanded
                  redraw()
                },
                { 'aria-expanded': state.expanded },
              ),
            ),
            h(Preview, { path: file.path }),
          )
        : h(
            'div',
            {},
            h('h2', {}, 'Select a file'),
            h('p', {}, 'Its content or capture state appears here.'),
          ),
    ),
  )
}

function Activity(): ComponentChildren {
  const snapshot = client?.body
  if (!snapshot) return null
  const live = client?.current?.workspace.phase === 'live'
  const host = snapshot.journal.filter((item) => item.kind === 'host')
  return h(
    'section',
    { class: 'single' },
    h('h2', {}, live ? 'Current activity' : 'Retained activity'),
    live
      ? h('p', {}, literal(client?.current?.workspace.hostStage ?? ''))
      : h('p', {}, 'Nothing is running. These are retained observations.'),
    live && snapshot.activities.length
      ? h(
          'div',
          { class: 'activity-list' },
          snapshot.activities.map((item) =>
            h(
              'article',
              { key: item.id },
              h('h3', {}, literal(item.value.label)),
              h('p', { class: 'source' }, literal(item.sourceLabel)),
              item.value.progress
                ? h(Progress, {
                    block: { kind: 'progress', label: item.value.label, ...item.value.progress },
                  })
                : null,
              item.value.detail
                ? h(
                    'details',
                    {},
                    h('summary', {}, 'Activity context'),
                    h('p', { class: 'report' }, literal(item.value.detail)),
                  )
                : null,
              item.value.operationId
                ? button(
                    'Inspect observed call',
                    () => {
                      const call = snapshot.calls.find(
                        (candidate) =>
                          candidate.sourceId === item.sourceId &&
                          candidate.operationId === item.value.operationId,
                      )
                      if (call) {
                        navigate('overview')
                        selectCall(call.id)
                      } else {
                        feedback = 'Associated observed call unavailable.'
                        redraw()
                      }
                    },
                    { disabled: !client?.referencesEnabled },
                  )
                : null,
            ),
          ),
        )
      : live
        ? h('p', { class: 'secondary' }, 'No current application activities were reported.')
        : null,
    h('h3', {}, 'Recent reports'),
    snapshot.journal
      .filter((item) => item.kind !== 'host')
      .slice()
      .reverse()
      .map((item) =>
        h(
          'details',
          { key: item.id },
          h(
            'summary',
            {},
            h(
              'span',
              { class: 'importance' },
              item.importance === 'unknown'
                ? 'Unknown severity'
                : `${item.kind === 'flow' ? 'Flow-reported ' : ''}${item.importance}`,
            ),
            ' · ',
            literal(item.attribution.sourceLabel),
            ' · ',
            literal(teaser(item.text)),
          ),
          h('p', { class: 'source' }, provenance(item.attribution)),
          h('p', { class: 'report' }, literal(item.text)),
          item.clipped ? h('p', { class: 'secondary' }, 'This retained report is clipped.') : null,
        ),
      ),
    host.length
      ? h(
          'details',
          {},
          h('summary', {}, `Stage history · ${host.length} retained entries`),
          host.map((item) => h('p', { key: item.id, class: 'report' }, literal(item.text))),
        )
      : null,
    Object.values(snapshot.omissions.journal).some(Boolean)
      ? h(
          'p',
          { class: 'unavailable-note' },
          `History is incomplete. Omitted: ${snapshot.omissions.journal.flow} Flow reports, ${snapshot.omissions.journal.host} host entries, ${snapshot.omissions.journal.diagnostic} diagnostics.`,
        )
      : null,
  )
}

function Overview(): ComponentChildren {
  const snapshot = client?.body
  if (!snapshot) return null
  const selected = snapshot.calls.find((call) => call.id === selectedCall)
  const children = new Map<string | undefined, PrivateWebSnapshot['calls']>()
  for (const call of snapshot.calls) {
    const parent = snapshot.calls.some((item) => item.id === call.parentId)
      ? call.parentId
      : undefined
    if (!children.has(parent)) children.set(parent, [])
    children.get(parent)!.push(call)
  }
  const problematic = (call: PrivateWebSnapshot['calls'][number], depth = 0): boolean =>
    depth < 32 &&
    (call.state !== 'returned' ||
      (children.get(call.id) ?? []).some((item) => problematic(item, depth + 1)))
  const nodes = (parent?: string, depth = 0): ComponentChildren =>
    depth >= 32
      ? h('p', {}, 'Additional call ancestry unavailable.')
      : h(
          'ul',
          { class: 'call-tree' },
          (children.get(parent) ?? []).map((call) => {
            const descendants = children.get(call.id) ?? []
            const open = treeChoices.get(call.id) ?? problematic(call)
            return h(
              'li',
              { key: call.id },
              h(
                'div',
                { class: `call-row call-${call.state}` },
                descendants.length
                  ? button(
                      open ? '▾' : '▸',
                      () => {
                        humanNavigation = true
                        treeChoices.set(call.id, !open)
                        redraw()
                      },
                      {
                        'aria-label': `${open ? 'Collapse' : 'Expand'} call branch`,
                        'aria-expanded': open,
                      },
                    )
                  : h('span', { class: 'tree-spacer' }),
                button(
                  h(
                    'span',
                    {},
                    literal(teaser(call.intent ?? call.slot, 100)),
                    h(
                      'small',
                      {},
                      call.state === 'cancel-requested' ? 'Cancellation requested' : call.state,
                    ),
                  ),
                  () => {
                    humanNavigation = true
                    selectCall(call.id)
                  },
                  {
                    class: selectedCall === call.id ? 'selected' : '',
                    'aria-pressed': selectedCall === call.id,
                    'data-call': call.id,
                  },
                ),
              ),
              !open && descendants.length
                ? h(
                    'small',
                    { class: 'secondary' },
                    `${descendants.length} direct children hidden${descendants.some((item) => problematic(item)) ? ' · active/problematic work within branch' : ''}`,
                  )
                : null,
              open && descendants.length ? nodes(call.id, depth + 1) : null,
            )
          }),
        )
  return h(
    'div',
    { class: `workspace ${selected && currentLocal().detailOpen ? 'show-detail' : ''}` },
    h(
      'section',
      { class: 'records' },
      h('h2', {}, 'Observed calls'),
      h('p', { class: 'secondary' }, 'Calls from root · actual observed relationships only'),
      snapshot.calls.some(
        (call) => call.parentId && !snapshot.calls.some((parent) => parent.id === call.parentId),
      )
        ? h(
            'p',
            { class: 'unavailable-note' },
            'Some observed parents are unavailable. Those calls appear at the outer level; their ancestry is incomplete.',
          )
        : null,
      snapshot.calls.length ? nodes() : h('p', {}, 'No child calls have been observed.'),
      snapshot.omissions.calls
        ? h(
            'p',
            { class: 'unavailable-note' },
            `${snapshot.omissions.calls} call observations omitted; tree is incomplete.`,
          )
        : null,
    ),
    h(
      'aside',
      { class: 'detail call-detail' },
      button(
        '← Back to calls',
        () => {
          currentLocal().detailOpen = false
          redraw()
          focusSelectedEntry()
        },
        { class: 'back-to-records' },
      ),
      selected
        ? h(
            'div',
            {},
            h('h2', {}, literal(selected.intent ?? selected.slot)),
            h('p', { class: `call-${selected.state}` }, `Observed state: ${selected.state}`),
            h('p', {}, `Observed at ${new Date(selected.observedAt).toISOString()}`),
            selected.cause
              ? h('p', { class: 'report' }, literal(selected.cause))
              : h('p', { class: 'secondary' }, 'No additional safe cause was observed.'),
            selected.state === 'returned'
              ? h(
                  'p',
                  { class: 'secondary' },
                  'Returned describes execution observation, not application success.',
                )
              : null,
            h(
              'details',
              {},
              h('summary', {}, 'Invocation identity'),
              h('p', {}, 'Reviewed slot: ', literal(selected.slot)),
              h('p', {}, 'Original operation: ', literal(selected.operationId)),
            ),
          )
        : h(
            'div',
            {},
            h('h2', {}, 'Select an observed call'),
            h('p', {}, 'Its known lifecycle and cause appear here.'),
          ),
    ),
  )
}

function Panel({ current }: { current: PrivateWebSnapshotEnvelope }): ComponentChildren {
  const diagnostics =
    current.kind === 'incomplete'
      ? current.diagnostics
      : current.journal.filter((item) => item.kind === 'diagnostic')
  return h(
    'section',
    {
      class: 'single',
      'aria-label':
        panel === 'attention'
          ? 'Complete attention causes'
          : panel === 'diagnostics'
            ? 'Diagnostics'
            : 'Inspection help',
    },
    button('← Back to view', closePanel, { id: 'panel-back' }),
    panel === 'attention'
      ? h(
          'div',
          {},
          h('h2', {}, 'Retained attention causes'),
          current.attention.length
            ? current.attention.map((item) =>
                h(
                  'article',
                  { key: item.id, class: 'cause' },
                  h('h3', {}, literal(item.attribution.sourceLabel)),
                  h('p', { class: 'source' }, provenance(item.attribution)),
                  h('p', { class: 'report' }, literal(item.text)),
                ),
              )
            : h('p', {}, 'No attention causes are retained.'),
        )
      : panel === 'diagnostics'
        ? h(
            'div',
            {},
            h('h2', {}, 'Diagnostics'),
            diagnostics.length
              ? diagnostics.map((item) =>
                  h(
                    'article',
                    { key: item.id, class: 'diagnostic' },
                    h('h3', {}, literal(item.attribution.sourceLabel)),
                    h(
                      'p',
                      { class: 'source' },
                      provenance(item.attribution),
                      ' · ',
                      item.importance === 'unknown' ? 'Unknown severity' : item.importance,
                    ),
                    item.operationsPath?.length
                      ? h(
                          'p',
                          { class: 'secondary' },
                          literal(item.operationsPath.join(' → ')),
                          item.pathClipped ? ' · path clipped' : '',
                        )
                      : null,
                    h('p', { class: 'report' }, literal(item.text)),
                    item.clipped
                      ? h('p', { class: 'secondary' }, 'Diagnostic excerpt clipped.')
                      : null,
                  ),
                )
              : h('p', {}, 'No diagnostic reports are retained.'),
          )
        : h(
            'div',
            {},
            h('h2', {}, 'Inspection help'),
            h(
              'p',
              {},
              'Use the view tabs and select an entry to read context. A single artifact reference opens a read-only preview; multiple references require a choice. Delivered files are available independently of application views.',
            ),
            h(
              'p',
              {},
              'Arrow keys move focus within tabs or record lists; Enter activates the focused control. Escape dismisses detail or this panel. Browser and text-editing shortcuts remain available.',
            ),
            h(
              'p',
              {},
              'Reloading removes the memory-only access capability. Open the original terminal link in a new browser tab; this does not restart work.',
            ),
            h(
              'p',
              {},
              'Close inspection for this command closes all viewers. Live work continues in the terminal. Closing only your browser tab disconnects this viewer.',
            ),
          ),
  )
}

function Tabs(): ComponentChildren {
  const supplied = client?.body?.views ?? []
  const tabs = [
    { id: 'activity', title: 'Activity', source: '' },
    { id: 'overview', title: 'Overview', source: '' },
    ...supplied.map((item) => ({ id: item.id, title: item.value.title, source: item.sourceLabel })),
  ]
  const visible = tabs.slice(0, 7)
  if (!visible.some((item) => item.id === viewId)) {
    const selected = tabs.find((item) => item.id === viewId)
    if (selected) visible[visible.length - 1] = selected
  }
  const focusId = visible.some((item) => item.id === viewId) ? viewId : visible[0]!.id
  return h(
    'div',
    { class: 'navigation' },
    h(
      'nav',
      { role: 'tablist', 'aria-label': 'Run views' },
      visible.map((tab) =>
        button(
          h(
            'span',
            {},
            literal(tab.title),
            tab.source ? h('small', {}, literal(tab.source)) : null,
          ),
          () => navigate(tab.id),
          {
            key: tab.id,
            id: `tab-${tab.id}`,
            role: 'tab',
            'aria-selected': tab.id === viewId && !panel,
            'aria-controls': 'view-panel',
            tabIndex: tab.id === focusId ? 0 : -1,
            onKeyDown: (event: KeyboardEvent) => {
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
              event.preventDefault()
              const index = visible.findIndex((item) => item.id === tab.id)
              const next =
                event.key === 'Home'
                  ? visible[0]!
                  : event.key === 'End'
                    ? visible[visible.length - 1]!
                    : visible[
                        (index + (event.key === 'ArrowRight' ? 1 : -1) + visible.length) %
                          visible.length
                      ]!
              navigate(next.id)
              document.getElementById(`tab-${next.id}`)?.focus()
            },
          },
        ),
      ),
    ),
    h(
      'label',
      { class: 'view-overflow' },
      'All views',
      h(
        'select',
        {
          value: tabs.some((item) => item.id === viewId) ? viewId : '',
          'aria-label': 'All retained views',
          onChange: (event: Event) => navigate((event.target as HTMLSelectElement).value),
        },
        h('option', { value: '', disabled: true }, 'Choose view…'),
        tabs.map((tab) =>
          h(
            'option',
            { key: tab.id, value: tab.id },
            privateBrowserLiteral(`${tab.title}${tab.source ? ` · ${tab.source}` : ''}`),
          ),
        ),
      ),
    ),
  )
}

function App(): ComponentChildren {
  const current = client?.current
  if (!hasCapability || client?.connection === 'unauthorized')
    return h(
      'main',
      { class: 'unavailable' },
      h('h1', {}, 'Reopen your terminal link'),
      h(
        'p',
        {},
        'This page has no current access capability. Open the original terminal link in a new browser tab. This does not restart work.',
      ),
      h(
        'p',
        {},
        'Access stays in browser memory and is removed from the address. Reloading requires the original link again.',
      ),
    )
  if (client?.connection === 'closed')
    return h(
      'main',
      { class: 'unavailable' },
      h('h1', {}, 'Inspection ended'),
      h(
        'p',
        {},
        'This command’s browser inspection is closed. Closing inspection does not request execution cancellation. Consult the terminal for the run and final result.',
      ),
    )
  if (!current)
    return h(
      'main',
      { class: 'unavailable' },
      h('h1', {}, 'Connecting to local inspection'),
      h(
        'p',
        { role: 'status' },
        client?.connection === 'disconnected'
          ? 'Observation unavailable; retrying with bounded backoff. Work is not restarted.'
          : 'Waiting for a readable host snapshot…',
      ),
    )
  const live = current.workspace.phase === 'live'
  const elapsed = elapsedClock.read(performance.now())
  const seconds = Math.floor(elapsed / 1000)
  const winner = current.attention.reduce<(typeof current.attention)[number] | undefined>(
    (previous, item) => (!previous || item.priority > previous.priority ? item : previous),
    undefined,
  )
  const state = currentLocal()
  return h(
    'div',
    {},
    h(
      'header',
      { class: 'shell' },
      h(
        'div',
        { class: 'identity' },
        h(
          'small',
          {},
          current.mode === 'recorded-packet' ? 'JIG / RECORDED RESULT' : 'JIG / LOCAL RUN',
        ),
        h('h1', {}, literal(current.workspace.target)),
        current.context ? h('p', { class: 'source' }, literal(current.context)) : null,
        h(
          'p',
          { class: 'host-stage' },
          current.mode === 'recorded-packet'
            ? 'Recorded claims · nothing is running'
            : live
              ? literal(current.workspace.hostStage)
              : 'Settled inspection · nothing is running',
        ),
      ),
      h(
        'div',
        { class: 'shell-actions' },
        h('strong', {}, live ? 'Execution running' : 'Read-only inspection'),
        h(
          'span',
          { class: 'secondary' },
          `Elapsed ${Math.floor(seconds / 60)}m ${seconds % 60}s${current.workspace.limitMs === undefined ? '' : ` · limit ${Math.floor(current.workspace.limitMs / 1000)}s`}`,
        ),
        button(
          closing ? 'Closing inspection…' : 'Close inspection for this command',
          () => {
            closing = true
            redraw()
            void client?.closeInspection().then((closed) => {
              closing = false
              if (!closed)
                feedback =
                  'Close acknowledgment unavailable; inspection may have ended. No execution cancellation was requested.'
              redraw()
            })
          },
          { disabled: closing, class: 'close-inspection' },
        ),
        h(
          'small',
          {},
          live
            ? 'Closes all viewers; work continues in the terminal.'
            : 'Closes all viewers; preserves the admitted outcome.',
        ),
      ),
    ),
    current.workspace.facts
      ? h(
          'dl',
          { class: 'host-facts' },
          Object.entries(current.workspace.facts).map(([name, fact]) =>
            h(
              'div',
              { key: name },
              h('dt', {}, name[0]!.toUpperCase() + name.slice(1)),
              h(
                'dd',
                {},
                literal(fact.value),
                h(
                  'small',
                  {},
                  fact.provenance === 'host-observed'
                    ? 'Host observed'
                    : fact.provenance === 'recorded-claim'
                      ? 'Recorded claim'
                      : 'Application reported',
                ),
                fact.clipped ? ' · clipped' : '',
              ),
            ),
          ),
        )
      : null,
    h(
      'section',
      { class: 'attention-shell', 'aria-label': 'Attention and inspection controls' },
      winner
        ? button(
            h(
              'span',
              {},
              h(
                'strong',
                {},
                winner.priority >= 4
                  ? 'Host failure / unconfirmed cleanup'
                  : winner.priority === 3
                    ? 'Observation incomplete'
                    : winner.priority === 2
                      ? 'Flow-reported error'
                      : 'Flow-reported warning',
              ),
              ' · ',
              literal(winner.attribution.sourceLabel),
              h('span', { class: 'attention-teaser' }, literal(teaser(winner.text, 220))),
              h(
                'small',
                {},
                `Read full cause${current.attention.length > 1 ? ` · ${current.attention.length - 1} additional causes` : ''} →`,
              ),
            ),
            () => openPanel('attention'),
            { class: `attention ${winner.priority >= 4 ? 'host-failure' : ''}` },
          )
        : null,
      h(
        'div',
        { class: 'inspection-controls' },
        button('Diagnostics', () => openPanel('diagnostics')),
        button(
          current.mode === 'recorded-packet' ? 'Captured files' : 'Delivered files',
          () => navigate('files'),
          { 'aria-pressed': viewId === 'files' },
        ),
        button('Help', () => openPanel('help')),
        h(
          'label',
          {},
          'Theme',
          h(
            'select',
            {
              value: document.documentElement.dataset.theme ?? 'system',
              onChange: (event: Event) => {
                document.documentElement.dataset.theme = (event.target as HTMLSelectElement).value
                redraw()
              },
            },
            ['system', 'light', 'dark', 'color-free'].map((theme) =>
              h('option', { key: theme, value: theme }, theme),
            ),
          ),
        ),
      ),
    ),
    client?.connection !== 'current'
      ? h(
          'p',
          { class: 'connection-note', role: 'status' },
          'Observation disconnected; retained data may be stale. References are disabled. Work is not restarted.',
        )
      : null,
    client?.connection === 'current' && current.kind === 'snapshot' && !client.referencesEnabled
      ? h(
          'p',
          { class: 'connection-note', role: 'status' },
          'A newer committed observation is loading. References are disabled until a readable snapshot acknowledges it.',
        )
      : null,
    client?.bodyStale
      ? h(
          'p',
          { class: 'connection-note' },
          'Current projection is incomplete: ',
          literal(current.kind === 'incomplete' ? current.reason : ''),
          '. The last complete body is stale and its references are disabled. Current causes, Diagnostics and Close remain available.',
        )
      : null,
    current.kind === 'snapshot' && current.incomplete
      ? h('p', { class: 'connection-note' }, literal(current.incomplete))
      : null,
    h(Tabs, {}),
    feedback ? h('p', { class: 'feedback', role: 'status' }, feedback) : null,
    h(
      'main',
      {
        id: 'view-panel',
        role: panel || viewId === 'files' ? undefined : 'tabpanel',
        'aria-labelledby': panel || viewId === 'files' ? undefined : `tab-${viewId}`,
        'aria-label': panel
          ? 'Inspection panel'
          : viewId === 'files'
            ? 'Delivered files'
            : undefined,
        class: state.expanded ? 'expanded-body' : '',
      },
      panel
        ? h(Panel, { current })
        : !client?.body
          ? h(
              'section',
              { class: 'single' },
              h('h2', {}, 'Body unavailable'),
              h('p', {}, 'Use current attention and Diagnostics to inspect the known causes.'),
            )
          : viewId === 'activity'
            ? h(Activity, {})
            : viewId === 'overview'
              ? h(Overview, {})
              : viewId === 'files'
                ? h(Files, {})
                : h(
                    'div',
                    {
                      class: `workspace ${state.detailOpen ? 'show-detail' : ''} ${state.expanded ? 'expanded' : ''}`,
                    },
                    h(ApplicationList, {}),
                    h(SelectedDetail, {}),
                  ),
    ),
    h(
      'footer',
      {},
      h('span', {}, 'Closing this browser tab disconnects only this viewer.'),
      h(
        'span',
        {},
        client?.connection === 'current'
          ? `Observation synchronized at ${new Date(client.synchronizedAt).toISOString()}`
          : 'Observation stale',
      ),
    ),
    h(
      'div',
      { class: 'screen-reader-status', 'aria-live': 'polite', 'aria-atomic': true },
      announcement,
    ),
  )
}

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || event.defaultPrevented) return
  if (
    event.target instanceof Element &&
    event.target.closest('input,textarea,select,[contenteditable]')
  )
    return
  if (panel) {
    event.preventDefault()
    closePanel()
    return
  }
  const state = currentLocal()
  if (state.expanded) {
    event.preventDefault()
    state.expanded = false
    redraw()
  } else if (state.detailOpen) {
    event.preventDefault()
    state.detailOpen = false
    client?.setPreview(undefined)
    redraw()
    focusSelectedEntry()
  }
})
if (capability) {
  let previousConnection = ''
  client = new PrivateBrowserClient(capability, () => {
    if (client && client.connection !== previousConnection) {
      previousConnection = client.connection
      announcement =
        client.connection === 'current'
          ? 'Observation synchronized.'
          : client.connection === 'closed'
            ? 'Inspection ended.'
            : client.connection === 'disconnected'
              ? 'Observation disconnected. Retained data may be stale.'
              : ''
    }
    if (client?.connection === 'closed' || client?.connection === 'unauthorized') {
      if (clock) clearInterval(clock)
      clock = undefined
    }
    redraw()
  })
  capability = undefined
  client.start()
  clock = setInterval(() => {
    if (client?.current?.workspace.phase === 'live') render(h(App, {}), root)
  }, 1000)
}
redraw()
addEventListener(
  'pagehide',
  () => {
    if (clock) clearInterval(clock)
    client?.stop()
    render(null, root)
    local.clear()
    previousKeys.clear()
    previousCallKeys = []
    scrollPositions.clear()
    treeChoices.clear()
  },
  { once: true },
)
addEventListener('pageshow', (event) => {
  if (event.persisted) {
    hasCapability = false
    redraw()
  }
})
