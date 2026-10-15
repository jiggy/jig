import type { DisplaySnapshot } from '@jigging/display-model'
import type { DetailBlock, Value } from '@jigging/reporting'
import { type ComponentChildren, h } from 'preact'
import {
  type PrivateBrowserLocal,
  type PrivateBrowserRecord,
  privateBrowserLiteral,
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
  onSort: (collection: string, key: string, descending: boolean) => void
  renderBlock: (block: DetailBlock, record: PrivateBrowserRecord) => ComponentChildren
  renderValue: (value: Value, record: PrivateBrowserRecord) => ComponentChildren
}

/** Authored order and sections form the page; detail remains a separate inspection. */
export function ApplicationPage(props: ApplicationPageProps): ComponentChildren {
  const { view, local, records } = props
  const text = privateBrowserLiteral
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
  return h(
    'article',
    { class: 'application-page', 'aria-label': view.value.title },
    h(
      'header',
      { class: 'application-heading' },
      h('h2', {}, text(view.value.title)),
      h('p', { class: 'application-summary' }, text(view.value.summary)),
      h(
        'small',
        { class: 'secondary' },
        text(view.sourceLabel),
        ' · ',
        text(view.ended ?? 'Application reported'),
      ),
      inspect(records[0]!, 'Inspect summary'),
    ),
    h(
      'div',
      { class: 'application-sections' },
      view.value.sections.map((section, sectionIndex) =>
        h(
          'section',
          {
            key: sectionIndex,
            class: `application-section ${sectionIndex === 0 || section.blocks.some((block) => block.kind === 'collection') ? 'application-section-wide' : ''}`,
            'aria-label': section.title ? text(section.title) : `Section ${sectionIndex + 1}`,
          },
          section.title ? h('h3', {}, text(section.title)) : null,
          section.blocks.map((block, blockIndex) => {
            if (block.kind !== 'collection') {
              const record = records.find(
                (item) => item.key === JSON.stringify(['block', sectionIndex, blockIndex]),
              )!
              return h(
                'div',
                { key: blockIndex, class: 'application-block' },
                props.renderBlock(block, record),
                inspect(record, `Inspect ${block.kind === 'progress' ? block.label : block.kind}`),
              )
            }
            const sort = local.sorts.get(block.id)
            const rows = privateBrowserRows(block, local)
            return h(
              'div',
              { key: block.id, class: 'application-collection' },
              h('h4', {}, text(block.title)),
              h(
                'p',
                { class: 'secondary' },
                `${rows.length} of ${block.rows.length} retained records${block.total === undefined ? '' : ` / ${block.total} reported`}`,
              ),
              h(
                'div',
                { class: 'collection-controls' },
                h(
                  'label',
                  {},
                  'Filter supplied records',
                  h('input', {
                    value: local.filters.get(block.id) ?? '',
                    placeholder: 'Find a record…',
                    onInput: (event: Event) =>
                      props.onFilter(block.id, (event.target as HTMLInputElement).value),
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
                      onChange: (event: Event) =>
                        props.onSort(block.id, (event.target as HTMLSelectElement).value, false),
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
              h(
                'div',
                {
                  class: 'application-table',
                  role: 'region',
                  'aria-label': text(block.title),
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
                      block.columns.map((column) =>
                        h('th', { key: column.key, scope: 'col' }, text(column.label)),
                      ),
                    ),
                  ),
                  h(
                    'tbody',
                    {},
                    rows.map((row) => {
                      const record = records.find(
                        (item) => item.key === privateBrowserRowKey(block.id, row.id),
                      )!
                      return h(
                        'tr',
                        {
                          key: row.id,
                          class:
                            local.selected === record.key && local.detailOpen ? 'selected' : '',
                        },
                        block.columns.map((column, index) =>
                          h(
                            'td',
                            { key: column.key },
                            index === 0
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
                    block.rows.length
                      ? 'No matching supplied records.'
                      : 'No records were supplied.',
                  )
                : null,
            )
          }),
        ),
      ),
    ),
  )
}
