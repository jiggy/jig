import { expect, test } from 'bun:test'
import type { DisplaySnapshot } from '@jigging/display-model'
import { h, type VNode } from 'preact'
import { ApplicationPage } from '../src/application.js'
import { privateBrowserLocal, privateBrowserRecords } from '../src/navigation.js'

type TestNode = VNode<{
  children?: unknown
  'data-record'?: string
  onClick: () => void
  onInput: (event: { target: { value: string } }) => void
  onChange: (event: { target: { value: string } }) => void
}>
function nodes(value: unknown): TestNode[] {
  if (Array.isArray(value)) return value.flatMap(nodes)
  if (!value || typeof value !== 'object' || !('props' in value)) return []
  const node = value as TestNode
  return [node, ...nodes(node.props.children)]
}
function text(value: unknown): string {
  if (Array.isArray(value)) return value.map(text).join(' ')
  if (value && typeof value === 'object' && 'props' in value)
    return text((value as TestNode).props.children)
  return value == null ? '' : String(value)
}

test('application sections compose a full page with all columns and working inspection controls', () => {
  const view: DisplaySnapshot['views'][number] = {
    id: 'root-view',
    sourceId: 'root',
    sourceLabel: 'Root method',
    updatedAt: 0,
    value: {
      kind: 'view',
      id: 'application',
      title: 'My application',
      summary: 'The actual purpose',
      sections: [
        {
          title: '09:00–10:00',
          blocks: [{ kind: 'facts', items: [{ label: 'Cook', value: 'Alex' }] }],
        },
        {
          title: 'Team',
          blocks: [
            {
              kind: 'collection',
              id: 'people',
              title: 'Volunteers',
              columns: Array.from({ length: 8 }, (_, index) => ({
                key: `field-${index}`,
                label: `Column ${index}`,
                type: 'text' as const,
              })),
              rows: [
                {
                  id: 'alex',
                  cells: Object.fromEntries(
                    Array.from({ length: 8 }, (_, index) => [`field-${index}`, `Value ${index}`]),
                  ),
                },
              ],
              total: 6,
            },
          ],
        },
      ],
    },
  }
  const local = privateBrowserLocal()
  const records = privateBrowserRecords(view, local)
  let selection = '',
    query = '',
    sortKey = ''
  const props = {
    view,
    local,
    records,
    onSelect: (key: string) => {
      selection = key
    },
    onRecordKeyDown: () => {},
    onFilter: (_collection: string, value: string) => {
      query = value
    },
    onSort: (_collection: string, key: string) => {
      sortKey = key
    },
    renderBlock: () => h('p', {}, 'Cook: Alex'),
    renderValue: (value: unknown) => h('span', {}, String(value)),
  }
  const page = ApplicationPage(props)
  const rendered = text(page)
  expect(rendered).toContain('The actual purpose')
  expect(rendered).toContain('Cook: Alex')
  expect(rendered).toContain('Value 7')
  expect(rendered).toContain('6 reported')
  const elements = nodes(page)
  expect(elements.filter((node) => node.type === 'h3').map(text)).toEqual(['09:00–10:00', 'Team'])
  elements.find((node) => node.props['data-record'] === records.at(-1)!.key)!.props.onClick()
  expect(selection).toBe(records.at(-1)!.key)
  elements.find((node) => node.type === 'input')!.props.onInput({ target: { value: 'Alex' } })
  expect(query).toBe('Alex')
  elements.find((node) => node.type === 'select')!.props.onChange({ target: { value: 'field-7' } })
  expect(sortKey).toBe('field-7')
  local.filters.set('people', 'unmatched')
  const filtered = ApplicationPage({ ...props, records: privateBrowserRecords(view, local) })
  expect(text(filtered)).toContain('No matching supplied records.')
})
