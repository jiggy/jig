import type { DisplayPreviewReply, DisplaySnapshot } from '@jigging/display-model'
import {
  detectDisplayTextFormat,
  displayDelimitedRows,
  displayTextTokens,
} from '@jigging/display-model'
import type {
  Collection,
  DetailBlock,
  MediaReference,
  Report,
  Section,
  Value,
} from '@jigging/reporting'
import { type ComponentChildren, h } from 'preact'
import { useLayoutEffect, useRef, useState } from 'preact/hooks'
import {
  type PrivateBrowserLocal,
  type PrivateBrowserRecord,
  privateBrowserLiteral,
  privateBrowserRecords,
  privateBrowserReferences,
  privateBrowserRowKey,
  privateBrowserRows,
  privateBrowserValue,
} from './navigation.js'

type ApplicationPageProps = {
  view: DisplaySnapshot['views'][number]
  local: PrivateBrowserLocal
  records: PrivateBrowserRecord[]
  onSelect: (key: string) => void
  onRecordKeyDown: (event: KeyboardEvent) => void
  onFilter: (collection: string, query: string) => void
  onClearFilters: () => void
  onSort: (collection: string, key: string, descending: boolean) => void
  renderBlock: (block: DetailBlock, record: PrivateBrowserRecord) => ComponentChildren
  renderValue: (value: Value, record: PrivateBrowserRecord) => ComponentChildren
  scope?: ComponentChildren
  identity?: ComponentChildren
  renderDownload?: (
    reference: MediaReference,
    record: PrivateBrowserRecord,
    label: string,
  ) => ComponentChildren
  renderMedia?: (
    reference: MediaReference,
    record: PrivateBrowserRecord,
    alt: string,
  ) => ComponentChildren
}

function isMaterial(block: Section['blocks'][number]): boolean {
  return (
    block.kind === 'content' ||
    (block.kind === 'report' && Boolean(block.format && block.format !== 'plain'))
  )
}

function sectionPresentation(section: Section): string {
  if (section.blocks.some(isMaterial) && section.blocks.some((block) => !isMaterial(block)))
    return 'application-section-comparison'
  if (section.blocks.some((block) => block.kind === 'collection'))
    return 'application-section-collection'
  if (section.blocks.some(isMaterial)) return 'application-section-material'
  if (section.blocks.every((block) => block.kind === 'report')) return 'application-section-reading'
  return 'application-section-context'
}

function conciseCell(value: Value): boolean {
  const text = privateBrowserValue(value)
  return text.length <= 24 && !/[\r\n\t]/.test(text)
}

/** Keep wide collections readable and make offscreen columns discoverable. */
function TableViewport({
  label,
  children,
}: {
  label: string
  children?: ComponentChildren
}): ComponentChildren {
  const viewport = useRef<HTMLDivElement>(null)
  const [edges, setEdges] = useState({ before: false, after: false })
  const update = () => {
    const node = viewport.current
    if (!node) return
    const before = node.scrollLeft > 1
    const after = node.scrollLeft + node.clientWidth < node.scrollWidth - 1
    setEdges((previous) =>
      previous.before === before && previous.after === after ? previous : { before, after },
    )
  }
  useLayoutEffect(() => {
    const node = viewport.current
    if (!node) return
    const observer = new ResizeObserver(update)
    observer.observe(node)
    if (node.firstElementChild) observer.observe(node.firstElementChild)
    update()
    return () => observer.disconnect()
  }, [])
  const scroll = (direction: number) =>
    viewport.current?.scrollBy({ left: direction * viewport.current.clientWidth * 0.75 })
  return h(
    'div',
    { class: 'table-viewport' },
    edges.before || edges.after
      ? h(
          'div',
          { class: 'table-scroll-tools' },
          h('span', {}, 'More columns'),
          h(
            'button',
            {
              type: 'button',
              'aria-label': `Scroll ${label} left`,
              disabled: !edges.before,
              onClick: () => scroll(-1),
            },
            '←',
          ),
          h(
            'button',
            {
              type: 'button',
              'aria-label': `Scroll ${label} right`,
              disabled: !edges.after,
              onClick: () => scroll(1),
            },
            '→',
          ),
        )
      : null,
    h(
      'div',
      {
        class: 'application-table',
        role: 'region',
        'aria-label': label,
        tabIndex: 0,
        ref: viewport,
        onScroll: update,
      },
      children,
    ),
  )
}

/** Plain supplied data forms the page. Only additional context needs inspection. */
export function ApplicationPage(props: ApplicationPageProps): ComponentChildren {
  const { view, local, records } = props
  const text = privateBrowserLiteral
  const recordByKey = new Map(records.map((record) => [record.key, record]))
  const hiddenSelection =
    local.selected && !recordByKey.has(local.selected)
      ? privateBrowserRecords(view, { ...local, filters: new Map() }).find(
          (record) => record.key === local.selected,
        )
      : undefined
  const inspect = (record: PrivateBrowserRecord, label: string) =>
    h(
      'button',
      {
        type: 'button',
        class: 'application-inspect',
        'data-record': record.key,
        'aria-pressed': local.selected === record.key && local.detailOpen,
        onClick: () => props.onSelect(record.key),
        onKeyDown: props.onRecordKeyDown,
      },
      text(label),
    )
  const rowRecord = (block: Collection, row: Collection['rows'][number]) =>
    recordByKey.get(privateBrowserRowKey(block.id, row.id))!
  const hasDetail = (record: PrivateBrowserRecord) =>
    Boolean(record.row?.details?.length || privateBrowserReferences(record).length)
  const collections = view.value.sections.flatMap((section) =>
    section.blocks.filter((block): block is Collection => block.kind === 'collection'),
  )
  const collectionLabel = (block: Collection) => {
    if (collections.filter((item) => item.title === block.title).length < 2)
      return text(block.title)
    const section = view.value.sections.find((item) => item.blocks.includes(block))
    const context = section?.title ? `${block.title} · ${section.title}` : block.title
    const repeated =
      collections.filter((item) => {
        const owner = view.value.sections.find((section) => section.blocks.includes(item))
        return (owner?.title ? `${item.title} · ${owner.title}` : item.title) === context
      }).length > 1
    return text(repeated ? `${context} · ${block.id}` : context)
  }
  const collection = (block: Collection) => {
    const rows = privateBrowserRows(block, local)
    const sort = local.sorts.get(block.id)
    const activeQuery = local.filters.get(block.id) ?? ''
    const filtered = Boolean(activeQuery)
    const gallery = block.presentation?.kind === 'gallery' ? block.presentation : undefined
    const count =
      block.total !== undefined && block.total !== block.rows.length
        ? `${rows.length}${filtered ? ` of ${block.rows.length}` : ''} retained · ${block.total} reported`
        : `${filtered ? `${rows.length} of ` : ''}${block.rows.length} ${block.rows.length === 1 ? 'record' : 'records'}`
    return h(
      'div',
      { key: block.id, class: 'application-collection' },
      h(
        'header',
        { class: 'collection-heading' },
        h('h4', {}, text(block.title)),
        h('span', { class: 'secondary' }, count),
        block.rows.length > 1
          ? h(
              'details',
              {
                class: 'collection-tools',
                open:
                  local.collectionTools.get(block.id) ??
                  (block.rows.length > 12 || filtered || Boolean(sort)),
                onToggle: (event: Event) =>
                  local.collectionTools.set(
                    block.id,
                    (event.currentTarget as HTMLDetailsElement).open,
                  ),
              },
              h(
                'summary',
                {},
                'Search and sort',
                filtered
                  ? h(
                      'span',
                      { class: 'secondary' },
                      ` · “${text(activeQuery.slice(0, 80))}${activeQuery.length > 80 ? '…' : ''}”`,
                    )
                  : null,
              ),
              h(
                'div',
                { class: 'collection-controls' },
                h(
                  'label',
                  { class: 'collection-search' },
                  h('span', { class: 'visually-hidden' }, `Search ${text(block.title)}`),
                  h('input', {
                    'data-collection': block.id,
                    value: local.filters.get(block.id) ?? '',
                    placeholder: `Search ${text(block.title)}…`,
                    onInput: (event: Event) => {
                      local.collectionTools.set(block.id, true)
                      props.onFilter(block.id, (event.target as HTMLInputElement).value)
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
                      value: sort?.key ?? '',
                      onChange: (event: Event) => {
                        local.collectionTools.set(block.id, true)
                        props.onSort(block.id, (event.target as HTMLSelectElement).value, false)
                      },
                    },
                    h('option', { value: '' }, 'Supplied order'),
                    block.columns.map((column) =>
                      h('option', { key: column.key, value: column.key }, text(column.label)),
                    ),
                  ),
                ),
                sort
                  ? h(
                      'button',
                      {
                        type: 'button',
                        onClick: () => props.onSort(block.id, sort.key, !sort.descending),
                      },
                      sort.descending ? 'Descending' : 'Ascending',
                    )
                  : null,
              ),
            )
          : null,
      ),
      gallery
        ? h(
            'div',
            { class: 'application-gallery', 'aria-label': text(block.title) },
            rows.map((row) => {
              const record = rowRecord(block, row)
              const media = row.cells[gallery.media]
              const title = privateBrowserValue(
                gallery.title
                  ? (row.cells[gallery.title] ?? null)
                  : (row.cells[block.columns[0]!.key] ?? null),
              )
              const alt = gallery.alt ? privateBrowserValue(row.cells[gallery.alt] ?? null) : title
              return h(
                'article',
                {
                  key: row.id,
                  class: `application-gallery-card${local.selected === record.key && local.detailOpen ? ' selected' : ''}`,
                },
                media &&
                  typeof media === 'object' &&
                  (media.kind === 'artifact' || media.kind === 'input-artifact')
                  ? (props.renderMedia?.(media, record, alt) ?? props.renderValue(media, record))
                  : null,
                h('h5', {}, text(title)),
                gallery.description
                  ? h('p', {}, text(privateBrowserValue(row.cells[gallery.description] ?? null)))
                  : null,
                h(
                  'details',
                  { class: 'gallery-metadata' },
                  h('summary', {}, 'Fields and source'),
                  h(
                    'dl',
                    { class: 'fields' },
                    block.columns.map((column) =>
                      h(
                        'div',
                        { key: column.key },
                        h('dt', {}, text(column.label)),
                        h('dd', {}, props.renderValue(row.cells[column.key] ?? null, record)),
                      ),
                    ),
                  ),
                ),
                hasDetail(record) ? inspect(record, 'Open details') : null,
              )
            }),
          )
        : h(
            TableViewport,
            { label: collectionLabel(block) },
            h(
              'table',
              {},
              h(
                'thead',
                {},
                h(
                  'tr',
                  {},
                  block.columns.map((column) =>
                    h(
                      'th',
                      {
                        key: column.key,
                        scope: 'col',
                        class: conciseCell(column.label) ? 'concise-value' : '',
                      },
                      text(column.label),
                    ),
                  ),
                ),
              ),
              h(
                'tbody',
                {},
                rows.map((row) => {
                  const record = rowRecord(block, row)
                  return h(
                    'tr',
                    {
                      key: row.id,
                      class: local.selected === record.key && local.detailOpen ? 'selected' : '',
                    },
                    block.columns.map((column, index) =>
                      h(
                        'td',
                        {
                          key: column.key,
                          class: conciseCell(row.cells[column.key] ?? null) ? 'concise-value' : '',
                        },
                        index === 0 && hasDetail(record)
                          ? inspect(record, privateBrowserValue(row.cells[column.key] ?? null))
                          : props.renderValue(row.cells[column.key] ?? null, record),
                      ),
                    ),
                  )
                }),
              ),
            ),
          ),
      !rows.length
        ? h(
            'p',
            {},
            block.rows.length ? 'No matching supplied records.' : 'No records were supplied.',
          )
        : null,
    )
  }
  const renderSectionBlocks = (section: Section, sectionIndex: number, material?: boolean) =>
    section.blocks.flatMap((block, blockIndex) => {
      if (material !== undefined && isMaterial(block) !== material) return []
      if (block.kind === 'collection') return [collection(block)]
      const record = records.find(
        (item) => item.key === JSON.stringify(['block', sectionIndex, blockIndex]),
      )!
      return [
        h('div', { key: blockIndex, class: 'application-block' }, props.renderBlock(block, record)),
      ]
    })
  return h(
    'article',
    { class: 'application-page', 'aria-label': view.value.title },
    h(
      'header',
      { class: 'application-heading' },
      props.scope,
      h(
        'details',
        { class: 'application-about' },
        h('summary', {}, 'About this view'),
        h('p', {}, text(view.value.summary)),
        h('small', { class: 'secondary' }, text(view.sourceLabel)),
        props.identity,
      ),
    ),
    view.ended
      ? h('p', { class: 'unavailable-note application-ended', role: 'status' }, text(view.ended))
      : null,
    !view.value.presentation && view.value.summary
      ? h('p', { class: 'application-summary' }, text(view.value.summary))
      : null,
    hiddenSelection
      ? h(
          'div',
          { class: 'selection-notice', role: 'status' },
          h(
            'span',
            {},
            text(hiddenSelection.title),
            local.detailOpen
              ? ' is outside the current filters. Its details remain open.'
              : ' is outside the current filters. Its selection is preserved.',
          ),
          h(
            'button',
            {
              type: 'button',
              onClick: props.onClearFilters,
            },
            'Clear filters',
          ),
        )
      : null,
    view.value.presentation?.kind === 'document'
      ? h(DocumentPage, { ...props, renderCollection: collection })
      : h(
          'div',
          { class: 'application-sections' },
          view.value.sections.map((section, sectionIndex) =>
            h(
              'section',
              {
                key: sectionIndex,
                class: `application-section ${sectionPresentation(section)}`,
                'aria-label': section.title ? text(section.title) : `Section ${sectionIndex + 1}`,
              },
              section.title &&
                !(
                  section.blocks.length === 1 &&
                  section.blocks[0]?.kind === 'collection' &&
                  section.blocks[0].title === section.title
                )
                ? h('h3', {}, text(section.title))
                : null,
              sectionPresentation(section) === 'application-section-comparison'
                ? [
                    h(
                      'div',
                      { class: 'comparison-context' },
                      renderSectionBlocks(section, sectionIndex, false),
                    ),
                    h(
                      'div',
                      { class: 'comparison-material' },
                      renderSectionBlocks(section, sectionIndex, true),
                    ),
                  ]
                : renderSectionBlocks(section, sectionIndex),
            ),
          ),
        ),
  )
}

export function DocumentPage(
  props: ApplicationPageProps & { renderCollection: (block: Collection) => ComponentChildren },
): ComponentChildren {
  const { view, records } = props
  const document = view.value.presentation!
  const text = privateBrowserLiteral
  const owner = records[0]!
  const sectionId = (index: number) => `document-${encodeURIComponent(view.id)}-${index}`
  return h(
    'article',
    { class: 'application-document', 'aria-label': text(document.title) },
    h(
      'header',
      { class: `document-header${document.cover ? ' document-header-media' : ''}` },
      h(
        'div',
        { class: 'document-title' },
        document.label ? h('span', { class: 'document-label' }, text(document.label)) : null,
        h('h2', {}, text(document.title)),
        document.subtitle ? h('p', { class: 'document-subtitle' }, text(document.subtitle)) : null,
        h('p', { class: 'document-description' }, text(view.value.summary)),
        document.download
          ? h(
              'div',
              { class: 'document-download' },
              props.renderDownload?.(document.download.reference, owner, document.download.label),
              document.download.detail ? h('span', {}, text(document.download.detail)) : null,
            )
          : null,
      ),
      document.cover
        ? h(
            'div',
            { class: 'document-cover' },
            props.renderMedia?.(document.cover, owner, document.title),
          )
        : null,
    ),
    view.value.sections.some((section) => section.label)
      ? h(
          'nav',
          { class: 'document-outline', 'aria-label': 'Document contents' },
          view.value.sections.map((section, index) =>
            h(
              'button',
              {
                key: index,
                type: 'button',
                onClick: () => {
                  const target = globalThis.document.getElementById(sectionId(index))
                  target?.scrollIntoView({ block: 'start', behavior: 'instant' })
                  target?.focus({ preventScroll: true })
                },
              },
              section.label ? h('span', {}, text(section.label)) : null,
              text(section.title ?? `Section ${index + 1}`),
            ),
          ),
        )
      : null,
    view.value.sections.map((section, sectionIndex) =>
      h(
        'section',
        {
          key: sectionIndex,
          id: sectionId(sectionIndex),
          tabIndex: -1,
          class: 'document-section',
        },
        section.label ? h('span', { class: 'document-section-label' }, text(section.label)) : null,
        section.title ? h('h3', {}, text(section.title)) : null,
        section.blocks.map((block, blockIndex) => {
          if (block.kind === 'collection') return props.renderCollection(block)
          const record = records.find(
            (record) => record.key === JSON.stringify(['block', sectionIndex, blockIndex]),
          )!
          return h(
            'div',
            { key: blockIndex, class: 'document-block' },
            block.kind === 'content'
              ? h(
                  'figure',
                  { class: 'document-content' },
                  props.renderMedia?.(
                    block.reference,
                    record,
                    block.title ?? section.title ?? document.title,
                  ),
                  block.title ? h('figcaption', {}, text(block.title)) : null,
                )
              : props.renderBlock(block, record),
          )
        }),
      ),
    ),
  )
}

/** Formatting is literal presentation. Authored text never becomes HTML. */
export function FormattedReport({ block }: { block: Report }): ComponentChildren {
  const value = privateBrowserLiteral(block.text)
  const lines = block.format === 'diff' ? (value.match(/[^\n]*\n|[^\n]+$/g) ?? []) : []
  const content =
    lines.length && lines.length <= 2048
      ? lines.map((line, index) =>
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
          ),
        )
      : value
  return block.format && block.format !== 'plain'
    ? h('pre', { class: `report literal-report literal-${block.format}` }, content)
    : h('p', { class: 'report' }, value || '(Empty report)')
}

/** Captured bytes stay inert, with a readable fallback for every preview state. */
export function CapturedContent({
  reply,
  path,
  alt,
  unavailable,
}: {
  reply: DisplayPreviewReply | undefined
  path: string
  alt: string
  unavailable: string
}): ComponentChildren {
  if (reply?.state === 'image' && reply.image)
    return h('img', {
      src: `data:${reply.image.mime};base64,${reply.image.base64}`,
      alt: privateBrowserLiteral(alt),
      width: reply.image.width,
      height: reply.image.height,
      loading: 'lazy',
    })
  if (reply?.state === 'empty') return h('p', { class: 'secondary' }, 'The captured file is empty.')
  if (reply?.state !== 'text') return h('div', { class: 'media-placeholder' }, unavailable)
  const text = privateBrowserLiteral(reply.text ?? '')
  const format = detectDisplayTextFormat(path, text)
  const rows =
    !reply.clipped && (format === 'csv' || format === 'tsv')
      ? displayDelimitedRows(text, format === 'tsv' ? '\t' : ',')
      : undefined
  const raw =
    format === 'diff'
      ? h(FormattedReport, { block: { kind: 'report', format: 'diff', text } })
      : h(
          'pre',
          { class: 'captured-text' },
          displayTextTokens(text, format).map((token, index) =>
            h(
              'span',
              {
                key: index,
                class: `syntax-${token.role}`,
              },
              token.text,
            ),
          ),
        )
  return h(
    'div',
    { class: 'captured-document' },
    reply.clipped
      ? h(
          'p',
          { class: 'secondary' },
          'Captured excerpt; open the source to inspect available evidence.',
        )
      : null,
    rows
      ? h(
          'div',
          {
            class: 'csv-table',
            role: 'region',
            'aria-label': privateBrowserLiteral(alt),
            tabIndex: 0,
          },
          h(
            'table',
            {},
            h(
              'thead',
              {},
              h(
                'tr',
                {},
                rows[0]!.map((cell, index) => h('th', { key: index, scope: 'col' }, cell)),
              ),
            ),
            h(
              'tbody',
              {},
              rows.slice(1).map((row, index) =>
                h(
                  'tr',
                  { key: index },
                  row.map((cell, column) => h('td', { key: column }, cell)),
                ),
              ),
            ),
          ),
          h('details', {}, h('summary', {}, 'Raw captured text'), raw),
        )
      : raw,
  )
}
