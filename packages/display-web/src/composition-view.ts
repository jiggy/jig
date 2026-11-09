import type {
  DisplayComposition,
  DisplayCompositionNode,
  DisplayCompositionResourceKind,
  DisplaySnapshot,
} from '@jigging/display-model'
import { compositionObservations } from '@jigging/display-model'
import { type ComponentChildren, h } from 'preact'
import {
  privateCompositionFocusedRequests,
  privateCompositionLayout,
  privateCompositionRequestRows,
  privateCompositionRequestStateLabel,
  privateCompositionRequestSummary,
  type PrivateCompositionRequestFocus,
  type PrivateCompositionRequestSummary,
} from './composition.js'
import { privateBrowserLiteral } from './navigation.js'

type Props = (
  | { snapshot: DisplaySnapshot; composition?: never }
  | { snapshot?: never; composition: DisplayComposition }
) & {
  selectedNodeId?: string | undefined
  detailOpen: boolean
  referencesEnabled?: boolean
  scale: number
  onScale: (action: 'in' | 'out' | 'fit' | 'actual') => void
  onSelect: (id: string) => void
  onClose: () => void
  onCall?: (id: string) => void
  onObservedCalls?: () => void
  requestFocus?: PrivateCompositionRequestFocus
  onRequestFocus?: (focus: PrivateCompositionRequestFocus) => void
  onNodeKeyDown: (event: KeyboardEvent) => void
  onScroll: (left: number, top: number) => void
}

const literal = (value: string): ComponentChildren =>
  h('bdi', { class: 'literal' }, privateBrowserLiteral(value))
const resourceLabels: Record<DisplayCompositionResourceKind, string> = {
  'http-request': 'HTTP request',
  'project-command': 'Project command',
  'project-evaluation': 'Project evaluation',
  'finite-acp': 'Agent conversation',
  'run-checkpoint': 'Save checkpoint',
  'child-checkpoint': 'Read child checkpoint',
}
const kindLabel = (node: DisplayCompositionNode): string =>
  node.kind === 'resource'
    ? resourceLabels[node.resourceKind]
    : node.kind === 'binding'
      ? 'Binding'
      : 'Flow'
const button = (
  label: ComponentChildren,
  action: () => void,
  props: Record<string, unknown> = {},
) => h('button', { type: 'button', onClick: action, ...props }, label)
const iconPaths = {
  flow: 'M 4 4 H 10 V 10 H 4 Z M 14 14 H 20 V 20 H 14 Z M 14 4 H 20 V 10 H 14 Z M 10 7 H 14 M 7 10 V 17 H 14',
  binding: 'M 8 4 H 16 L 21 12 L 16 20 H 8 L 3 12 Z M 8 12 H 16 M 13 9 L 16 12 L 13 15',
  resource: 'M 4 7 L 12 3 L 20 7 V 17 L 12 21 L 4 17 Z M 4 7 L 12 11 L 20 7 M 12 11 V 21',
  close: 'M 6 6 L 18 18 M 18 6 L 6 18',
  minus: 'M 5 12 H 19',
  plus: 'M 5 12 H 19 M 12 5 V 19',
  fit: 'M 9 4 H 4 V 9 M 15 4 H 20 V 9 M 20 15 V 20 H 15 M 9 20 H 4 V 15',
  arrow: 'M 5 12 H 19 M 14 7 L 19 12 L 14 17',
}
const icon = (name: keyof typeof iconPaths): ComponentChildren =>
  h(
    'svg',
    {
      viewBox: '0 0 24 24',
      width: 18,
      height: 18,
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': 1.5,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      'aria-hidden': true,
    },
    h('path', { d: iconPaths[name] }),
  )
const unmatchedReason = (reason: string): string =>
  reason === 'caller-unobserved'
    ? 'Caller relationship unavailable'
    : reason === 'slot-unavailable'
      ? 'Configured slot unavailable'
      : reason === 'identity-conflict'
        ? 'Conflicting invocation identities'
        : 'Composition unavailable'
const requestSummaryText = (summary: PrivateCompositionRequestSummary): string =>
  privateCompositionRequestRows(summary)
    .flat()
    .map(({ state, count }) => count + ' ' + privateCompositionRequestStateLabel(state))
    .join(', ')
const requestSummary = (
  summary: PrivateCompositionRequestSummary,
  attributes: Record<string, unknown> = {},
): ComponentChildren =>
  h(
    'span',
    { class: 'composition-request-summary', ...attributes },
    privateCompositionRequestRows(summary).map((row, index) =>
      h(
        'span',
        { class: 'composition-state-row', key: index },
        row.flatMap(({ state, count }, entry) => [
          entry
            ? h('span', { class: 'composition-state-separator', key: state + '-separator' }, ' · ')
            : null,
          h(
            'span',
            {
              key: state,
              class: 'composition-state composition-state-' + state,
              'data-request-state': state,
            },
            count + ' ' + privateCompositionRequestStateLabel(state),
          ),
        ]),
      ),
    ),
  )

/** Configuration is readable before a Run. Supplied Run observations remain a separate layer. */
export function CompositionPage(props: Props): ComponentChildren {
  const { snapshot } = props
  const composition = snapshot?.composition ?? props.composition
  if (composition?.state !== 'available')
    return h(
      'section',
      { class: 'single composition-unavailable' },
      h('h2', {}, 'Application map unavailable'),
      h(
        'p',
        {},
        composition?.state === 'unavailable' && composition.reason === 'limit'
          ? 'This admitted composition exceeds the display limit. No partial map is shown.'
          : 'The host did not supply a readable admitted composition for this map.',
      ),
      snapshot
        ? h('p', { class: 'secondary' }, 'Retained invocation observations remain available.')
        : null,
      snapshot ? button('Inspect observed calls', () => props.onObservedCalls?.()) : null,
    )

  const nodes = new Map(composition.nodes.map((node) => [node.id, node]))
  const attribution = snapshot ? compositionObservations(snapshot) : undefined
  const calls = new Map(snapshot?.calls.map((call) => [call.id, call]) ?? [])
  const requests = new Map<string, DisplaySnapshot['calls'][number][]>()
  const edgeRequests = new Map<string, DisplaySnapshot['calls'][number][]>()
  for (const match of attribution?.matches ?? []) {
    const call = calls.get(match.callId)
    if (!call) continue
    if (!requests.has(match.targetNodeId)) requests.set(match.targetNodeId, [])
    requests.get(match.targetNodeId)!.push(call)
    if (!edgeRequests.has(match.edgeId)) edgeRequests.set(match.edgeId, [])
    edgeRequests.get(match.edgeId)!.push(call)
  }
  const summaries = new Map(
    composition.nodes.map((node) => [
      node.id,
      privateCompositionRequestSummary(requests.get(node.id) ?? []),
    ]),
  )
  const edgeSummaries = new Map(
    composition.edges.map((edge) => [
      edge.id,
      privateCompositionRequestSummary(edgeRequests.get(edge.id) ?? []),
    ]),
  )
  const allRequests = privateCompositionRequestSummary([...requests.values()].flat())
  const requestFocus = snapshot ? (props.requestFocus ?? 'all') : 'all'
  const edgeCountLabel = (edgeId: string): string => {
    const count = edgeRequests.get(edgeId)?.length ?? 0
    return count
      ? count + (count === 1 ? ' retained request' : ' retained requests')
      : 'No matching retained requests'
  }
  const selected = nodes.get(props.selectedNodeId ?? '')
  const labelCounts = new Map<string, number>()
  for (const node of composition.nodes)
    labelCounts.set(node.label, (labelCounts.get(node.label) ?? 0) + 1)
  const chooserLabel = (node: DisplayCompositionNode): string => {
    if (node.id === composition.rootId)
      return node.label + (snapshot ? ' · Run root' : ' · Selected root')
    if (labelCounts.get(node.label) === 1) return node.label + ' · ' + kindLabel(node)
    const incoming = composition.edges.filter((edge) => edge.target === node.id)
    const connection = incoming[0]
    return (
      node.label +
      ' · ' +
      kindLabel(node) +
      (connection
        ? ' · from ' + nodes.get(connection.source)!.label + ' / ' + connection.slot
        : '') +
      (incoming.length > 1 ? ' (+' + (incoming.length - 1) + ' connections)' : '')
    )
  }
  const selectedRequests = selected ? (requests.get(selected.id) ?? []) : []
  const incoming = selected ? composition.edges.filter((edge) => edge.target === selected.id) : []
  const outgoing = selected ? composition.edges.filter((edge) => edge.source === selected.id) : []
  const layout = privateCompositionLayout(
    {
      ...composition,
      nodes: composition.nodes.map((node) => ({
        ...node,
        label: privateBrowserLiteral(node.label),
      })),
      edges: composition.edges.map((edge) => ({ ...edge, slot: privateBrowserLiteral(edge.slot) })),
    },
    snapshot !== undefined,
  )
  const reasonCounts = new Map<string, number>()
  for (const item of attribution?.unmatched ?? [])
    reasonCounts.set(item.reason, (reasonCounts.get(item.reason) ?? 0) + 1)

  const canvas = h(
    'div',
    {
      class: 'composition-canvas',
      style: {
        width: layout.width + 'px',
        height: layout.height + 'px',
        transform: 'scale(' + props.scale + ')',
        transformOrigin: '0 0',
      },
    },
    h(
      'svg',
      {
        class: 'composition-lines',
        width: layout.width,
        height: layout.height,
        viewBox: '0 0 ' + layout.width + ' ' + layout.height,
        'aria-hidden': true,
      },
      h(
        'defs',
        {},
        ['configured', 'observed', 'selected'].map((kind) =>
          h(
            'marker',
            {
              key: kind,
              id: 'composition-arrow-' + kind,
              markerWidth: 7,
              markerHeight: 7,
              refX: 9,
              refY: 3.5,
              orient: 'auto',
              markerUnits: 'userSpaceOnUse',
            },
            h('path', {
              d: 'M 0 0 L 7 3.5 L 0 7 Z',
              fill:
                kind === 'selected'
                  ? 'var(--accent)'
                  : kind === 'observed'
                    ? 'var(--text)'
                    : 'var(--secondary)',
            }),
          ),
        ),
      ),
      layout.routes.map((route) => {
        const related = route.source === selected?.id || route.target === selected?.id
        const observed = route.edgeIds.some((id) => (edgeRequests.get(id)?.length ?? 0) > 0)
        const focused =
          snapshot &&
          route.edgeIds.some(
            (id) => privateCompositionFocusedRequests(edgeSummaries.get(id)!, requestFocus) > 0,
          )
        const labelLeft = route.labelX - route.labelWidth / 2
        return h(
          'g',
          {
            key: route.id,
            class:
              'composition-connection' +
              (related ? ' related' : '') +
              (observed ? ' observed' : '') +
              (focused ? ' request-focused' : '') +
              (snapshot && requestFocus !== 'all' && !focused ? ' outside-request-focus' : ''),
          },
          h(
            'title',
            {},
            route.edgeIds
              .map((id) => {
                const edge = composition.edges.find((item) => item.id === id)!
                return (
                  privateBrowserLiteral(edge.slot) +
                  (snapshot
                    ? ': ' +
                      edgeCountLabel(id) +
                      (requestSummaryText(edgeSummaries.get(id)!)
                        ? ' · ' + requestSummaryText(edgeSummaries.get(id)!)
                        : '')
                    : '')
                )
              })
              .join('\n'),
          ),
          h('path', {
            d: route.path,
            class: 'composition-route',
            'marker-end':
              'url(#composition-arrow-' +
              (related ? 'selected' : focused ? 'observed' : 'configured') +
              ')',
          }),
          h('circle', { class: 'composition-port', cx: route.sourceX, cy: route.sourceY, r: 3 }),
          h('rect', {
            class: 'composition-slot-background',
            x: labelLeft,
            y: route.labelTop,
            width: route.labelWidth,
            height: route.labelHeight,
            rx: 6,
          }),
          route.lines.map((line, index) => {
            const edgeId = route.lineEdgeIds[index]
            const y = route.labelY + index * 15
            return h(
              'g',
              { key: index },
              h('text', { x: labelLeft + 10, y, class: 'composition-slot' }, line),
              edgeId && snapshot
                ? h(
                    'text',
                    {
                      x: labelLeft + route.labelWidth - 10,
                      y,
                      class: 'composition-slot-count',
                      'text-anchor': 'end',
                      'data-composition-edge': edgeId,
                    },
                    edgeRequests.get(edgeId)?.length ?? 0,
                  )
                : null,
            )
          }),
          route.requestRows.map(({ edgeId, line }) =>
            h(
              'g',
              {
                key: edgeId,
                'data-composition-edge-states': edgeId,
                class:
                  'composition-slot-states' +
                  (privateCompositionFocusedRequests(edgeSummaries.get(edgeId)!, requestFocus)
                    ? ' request-focused'
                    : ''),
              },
              privateCompositionRequestRows(edgeSummaries.get(edgeId)!).map((row, index) =>
                h(
                  'text',
                  {
                    key: index,
                    x: labelLeft + 10,
                    y: route.labelY + (line + index) * 15,
                    class: 'composition-state-row',
                  },
                  row.flatMap(({ state, count }, entry) => [
                    entry
                      ? h(
                          'tspan',
                          { class: 'composition-state-separator', key: state + '-separator' },
                          ' · ',
                        )
                      : null,
                    h(
                      'tspan',
                      {
                        key: state,
                        class: 'composition-state composition-state-' + state,
                        'data-request-state': state,
                      },
                      count + ' ' + privateCompositionRequestStateLabel(state),
                    ),
                  ]),
                ),
              ),
            ),
          ),
        )
      }),
    ),
    layout.nodes.map((box) => {
      const node = nodes.get(box.id)!
      const count = requests.get(node.id)?.length ?? 0
      const summary = summaries.get(node.id)!
      const focused = snapshot && privateCompositionFocusedRequests(summary, requestFocus) > 0
      const childCount = composition.edges.filter((edge) => edge.source === node.id).length
      return button(
        h(
          'span',
          { class: 'composition-card-content' },
          h(
            'span',
            { class: 'composition-card-heading' },
            h('span', { class: 'composition-card-icon' }, icon(node.kind)),
            h('small', { class: 'composition-kind' }, kindLabel(node)),
            node.id === composition.rootId
              ? h(
                  'span',
                  { class: 'composition-root-badge' },
                  snapshot ? 'Run root' : 'Selected root',
                )
              : null,
          ),
          h(
            'strong',
            { class: 'composition-label' },
            box.labelLines.map((line, index) => h('span', { key: index }, literal(line))),
          ),
          h(
            'span',
            { class: 'composition-count' },
            !snapshot || node.id === composition.rootId
              ? childCount + (childCount === 1 ? ' configured call' : ' configured calls')
              : h('span', {}, h('strong', {}, count), count === 1 ? ' request' : ' requests'),
          ),
          snapshot && node.id !== composition.rootId
            ? requestSummary(summary, { 'data-composition-node-states': node.id })
            : null,
        ),
        () => props.onSelect(node.id),
        {
          key: node.id,
          class:
            'composition-card' +
            (node.kind === 'resource' ? ' resource' : '') +
            (node.kind === 'resource' &&
            (node.resourceKind === 'run-checkpoint' || node.resourceKind === 'child-checkpoint')
              ? ' checkpoint'
              : '') +
            (snapshot && node.id !== composition.rootId
              ? (count ? ' observed' : ' unobserved') +
                (focused ? ' request-focused' : '') +
                (requestFocus !== 'all' && !focused ? ' outside-request-focus' : '')
              : '') +
            (node.id === selected?.id ? ' selected' : ''),
          style: {
            left: box.x + 'px',
            top: box.y + 'px',
            width: box.width + 'px',
            height: box.height + 'px',
          },
          'data-component': node.id,
          'aria-pressed': node.id === selected?.id,
          'aria-label':
            privateBrowserLiteral(node.label) +
            ', ' +
            kindLabel(node) +
            (node.id === composition.rootId
              ? snapshot
                ? ', Run root'
                : ', Selected root'
              : snapshot
                ? ', ' +
                  count +
                  ' matching retained requests' +
                  (count ? ', ' + requestSummaryText(summary) : '')
                : ''),
          onKeyDown: props.onNodeKeyDown,
        },
      )
    }),
  )

  return h(
    'div',
    {
      class:
        'composition-page' +
        (selected && props.detailOpen ? ' inspecting' : '') +
        (snapshot ? ' composition-run request-focus-' + requestFocus : ''),
    },
    h(
      'section',
      { class: 'composition-main' },
      h(
        'div',
        { class: 'composition-controls' },
        h(
          'div',
          { class: 'composition-summary' },
          icon('flow'),
          h(
            'strong',
            {},
            composition.nodes.length +
              (composition.nodes.length === 1 ? ' component' : ' components'),
          ),
          h(
            'span',
            { class: 'secondary' },
            '· ' +
              composition.edges.length +
              (composition.edges.length === 1 ? ' connection' : ' connections'),
          ),
        ),
        h(
          'div',
          { class: 'composition-chooser' },
          h(
            'select',
            {
              'aria-label': 'Find a component',
              value: selected?.id ?? '',
              onChange: (event: Event) => {
                const id = (event.target as HTMLSelectElement).value
                if (id) props.onSelect(id)
              },
            },
            h('option', { value: '' }, 'Find a component…'),
            composition.nodes.map((node) =>
              h(
                'option',
                { key: node.id, value: node.id },
                privateBrowserLiteral(chooserLabel(node)),
              ),
            ),
          ),
        ),
        snapshot ? button('Observed calls', () => props.onObservedCalls?.()) : null,
      ),
      snapshot
        ? h(
            'div',
            { class: 'composition-observation-tools' },
            h(
              'div',
              {
                class: 'composition-request-focus',
                role: 'group',
                'aria-label': 'Focus matching retained requests',
              },
              (
                [
                  ['all', 'All requests'],
                  ['active', 'Active'],
                  ['attention', 'Needs attention'],
                ] as const
              ).map(([focus, label]) =>
                button(
                  h(
                    'span',
                    {},
                    label,
                    ' ',
                    h(
                      'span',
                      { class: 'composition-focus-count' },
                      privateCompositionFocusedRequests(allRequests, focus),
                    ),
                  ),
                  () => props.onRequestFocus?.(focus),
                  {
                    key: focus,
                    'data-request-focus': focus,
                    'aria-pressed': requestFocus === focus,
                    'aria-label':
                      label + ' ' + privateCompositionFocusedRequests(allRequests, focus),
                    title:
                      focus === 'attention'
                        ? 'Matching retained requests that are failed or uncertain'
                        : focus === 'active'
                          ? 'Matching retained requests observed as active'
                          : 'All matching retained requests',
                  },
                ),
              ),
            ),
            h(
              'span',
              { class: 'composition-focus-note' },
              'All configured connections stay visible.',
            ),
          )
        : null,
      h(
        'div',
        { class: 'composition-map-shell', style: { '--composition-height': layout.height + 'px' } },
        h(
          'div',
          {
            id: 'composition-scroll',
            class: 'composition-scroll',
            role: 'region',
            'aria-label': 'Application components and configured calls. Scroll to explore the map.',
            'aria-describedby': 'composition-explanation',
            'data-composition-width': layout.width,
            'data-composition-height': layout.height,
            'data-composition-scale': props.scale,
            tabIndex: 0,
            onScroll: (event: Event) => {
              const viewport = event.currentTarget as HTMLElement
              props.onScroll(viewport.scrollLeft, viewport.scrollTop)
            },
          },
          h(
            'div',
            { class: 'composition-world' },
            h(
              'div',
              {
                class: 'composition-scaled',
                style: {
                  width: layout.width * props.scale + 'px',
                  height: layout.height * props.scale + 'px',
                },
              },
              canvas,
            ),
          ),
        ),
        h(
          'div',
          { class: 'composition-zoom', role: 'group', 'aria-label': 'Map zoom' },
          button(icon('minus'), () => props.onScale('out'), {
            title: 'Zoom out',
            'aria-label': 'Zoom out',
          }),
          button(Math.round(props.scale * 100) + '%', () => props.onScale('actual'), {
            class: 'composition-zoom-value',
            title: 'Show at 100%',
            'aria-label':
              'Zoom ' + Math.round(props.scale * 100) + ' percent. Reset to 100 percent.',
          }),
          button(icon('plus'), () => props.onScale('in'), {
            title: 'Zoom in',
            'aria-label': 'Zoom in',
          }),
          button(h('span', {}, icon('fit'), 'Fit'), () => props.onScale('fit'), {
            class: 'composition-fit',
            title: 'Fit the whole map',
            'aria-label': 'Fit the whole map',
          }),
        ),
      ),
      h(
        'div',
        { class: 'composition-map-note', id: 'composition-explanation' },
        h(
          'span',
          {},
          h('i', { class: 'composition-line-key', 'aria-hidden': true }),
          'Configured calls',
        ),
        snapshot
          ? h(
              'span',
              {},
              h('i', { class: 'composition-line-key observed', 'aria-hidden': true }),
              'Matching retained requests',
            )
          : null,
        snapshot
          ? h('span', {}, 'Counts show retained requests')
          : h('span', {}, 'Approved configuration'),
        h('span', { class: 'composition-map-hint' }, 'Select a component to inspect'),
      ),
      snapshot?.omissions.calls
        ? h(
            'p',
            { class: 'unavailable-note' },
            snapshot.omissions.calls +
              ' call observations are omitted. Counts describe retained observations only.',
          )
        : null,
      attribution?.unmatched.length
        ? h(
            'details',
            { class: 'composition-attribution' },
            h(
              'summary',
              {},
              attribution.unmatched.length +
                (attribution.unmatched.length === 1
                  ? ' retained observation cannot'
                  : ' retained observations cannot') +
                ' be placed on this map',
            ),
            h(
              'ul',
              {},
              [...reasonCounts].map(([reason, count]) =>
                h('li', { key: reason }, unmatchedReason(reason) + ': ' + count),
              ),
            ),
            h('p', {}, 'Their known lifecycle remains visible in the observed-call view.'),
            button('Inspect observed calls', () => props.onObservedCalls?.()),
          )
        : null,
      h(
        'details',
        { class: 'composition-connections' },
        h('summary', {}, 'All configured connections (' + composition.edges.length + ')'),
        composition.edges.length
          ? h(
              'table',
              {},
              h(
                'thead',
                {},
                h(
                  'tr',
                  {},
                  h('th', { scope: 'col' }, 'Caller'),
                  h('th', { scope: 'col' }, 'Slot'),
                  h('th', { scope: 'col' }, 'Target'),
                  snapshot ? h('th', { scope: 'col' }, 'Retained requests') : null,
                ),
              ),
              h(
                'tbody',
                {},
                composition.edges.map((edge) =>
                  h(
                    'tr',
                    { key: edge.id },
                    h(
                      'td',
                      {},
                      button(literal(nodes.get(edge.source)!.label), () =>
                        props.onSelect(edge.source),
                      ),
                    ),
                    h('td', {}, h('code', {}, literal(edge.slot))),
                    h(
                      'td',
                      {},
                      button(literal(nodes.get(edge.target)!.label), () =>
                        props.onSelect(edge.target),
                      ),
                    ),
                    snapshot
                      ? h(
                          'td',
                          {},
                          edgeCountLabel(edge.id),
                          requestSummary(edgeSummaries.get(edge.id)!),
                        )
                      : null,
                  ),
                ),
              ),
            )
          : h('p', {}, 'This composition contains no configured child connections.'),
      ),
      h(
        'details',
        { class: 'composition-about' },
        h('summary', {}, 'About this map'),
        h(
          'p',
          {},
          'Connections show which component a configured slot can call. They do not show execution order or internal decisions.',
        ),
        h(
          'p',
          {},
          snapshot
            ? 'The host supplies this Run’s admitted composition. Internal steps, branch conditions, and data transformations are not included.'
            : 'The host supplies the locally approved configuration. Internal steps, branch conditions, and data transformations are not included.',
        ),
        snapshot
          ? h(
              'p',
              {},
              'A matched request retains its observed state. It does not by itself establish that the target started or completed.',
            )
          : h(
              'p',
              {},
              'Run validates the selected approval again before work begins. This map does not establish source freshness or launch readiness.',
            ),
        snapshot
          ? h(
              'p',
              {},
              'An absence of matching retained requests does not establish that a configured call was skipped.',
            )
          : null,
        snapshot
          ? h(
              'p',
              {},
              'Active highlights requests observed as active. Needs attention highlights failed or uncertain requests. Cancel requested remains a separate observation. Returned does not establish application success.',
            )
          : null,
        h(
          'p',
          {},
          'Use arrow keys to move between components. Zoom or Fit changes only the view. Component positions are not editable.',
        ),
      ),
    ),
    selected && props.detailOpen
      ? h(
          'aside',
          { class: 'composition-detail', 'aria-label': 'Selected component' },
          button('← Back to map', props.onClose, { class: 'back-to-records back-to-components' }),
          h(
            'header',
            { class: 'composition-detail-heading' },
            h('span', { class: 'composition-card-icon' }, icon(selected.kind)),
            h('small', { class: 'composition-kind' }, kindLabel(selected)),
            button(icon('close'), props.onClose, {
              class: 'composition-detail-close',
              title: 'Close component details',
              'aria-label': 'Close component details',
            }),
          ),
          h(
            'h2',
            { id: 'composition-detail-title', class: 'composition-detail-title', tabIndex: -1 },
            literal(selected.label),
          ),
          snapshot?.omissions.calls
            ? h(
                'p',
                { class: 'unavailable-note' },
                snapshot.omissions.calls + ' call observations are omitted from this run.',
              )
            : null,
          snapshot && selected.id === composition.rootId
            ? h(
                'section',
                { class: 'composition-root-observation' },
                h('h3', {}, 'Run observation'),
                h('p', {}, 'Run phase: ', snapshot.workspace.phase),
                h('p', {}, literal(snapshot.workspace.hostStage)),
                snapshot.workspace.facts?.execution
                  ? h(
                      'p',
                      {},
                      literal(snapshot.workspace.facts.execution.value),
                      h(
                        'small',
                        { class: 'source' },
                        ' · ',
                        snapshot.workspace.facts.execution.provenance,
                      ),
                      snapshot.workspace.facts.execution.clipped
                        ? ' · retained fact clipped'
                        : null,
                    )
                  : null,
                h(
                  'p',
                  { class: 'secondary' },
                  'Run root. Child requests appear on their target components.',
                ),
              )
            : null,
          snapshot && selected.id !== composition.rootId
            ? h(
                'section',
                { class: 'composition-detail-section' },
                h(
                  'h3',
                  {},
                  'Requests in this run',
                  h('span', { class: 'composition-section-count' }, selectedRequests.length),
                ),
                h(
                  'p',
                  { class: 'composition-retained-note secondary' },
                  'Counts show retained requests.',
                ),
                requestSummary(summaries.get(selected.id)!),
                selectedRequests.length
                  ? h(
                      'ol',
                      { class: 'composition-requests' },
                      selectedRequests.map((call) =>
                        h(
                          'li',
                          { key: call.id },
                          button(
                            h(
                              'span',
                              { class: 'composition-request-content' },
                              h('strong', {}, literal(call.intent ?? call.slot)),
                              h(
                                'span',
                                { class: 'composition-request-state call-' + call.state },
                                'Observed state: ' + call.state,
                              ),
                              h(
                                'small',
                                { class: 'secondary' },
                                'Operation: ',
                                literal(call.operationId),
                              ),
                            ),
                            () => props.onCall?.(call.id),
                            {
                              'data-composition-call': call.id,
                              disabled: !props.referencesEnabled,
                              'aria-label':
                                'Inspect invocation ' +
                                privateBrowserLiteral(call.operationId) +
                                ': ' +
                                privateBrowserLiteral(call.intent ?? call.slot) +
                                '. Observed state: ' +
                                call.state,
                            },
                          ),
                        ),
                      ),
                    )
                  : h(
                      'p',
                      { class: 'secondary' },
                      'No matching invocation observations are retained for this component.',
                    ),
                selectedRequests.length && !props.referencesEnabled
                  ? h(
                      'p',
                      { class: 'unavailable-note' },
                      'Invocation links are unavailable while this observation is stale or incomplete.',
                    )
                  : null,
              )
            : null,
          incoming.length
            ? h(
                'section',
                { class: 'composition-detail-section' },
                h('h3', {}, 'Configured callers'),
                h(
                  'ul',
                  { class: 'composition-route-list composition-incoming' },
                  incoming.map((edge) =>
                    h(
                      'li',
                      { key: edge.id },
                      button(
                        h('span', {}, literal(nodes.get(edge.source)!.label), icon('arrow')),
                        () => props.onSelect(edge.source),
                      ),
                      h(
                        'div',
                        { class: 'composition-connection-meta' },
                        h('code', {}, literal(edge.slot)),
                        snapshot
                          ? h('small', { class: 'secondary' }, edgeCountLabel(edge.id))
                          : null,
                        snapshot ? requestSummary(edgeSummaries.get(edge.id)!) : null,
                      ),
                    ),
                  ),
                ),
              )
            : null,
          h(
            'section',
            { class: 'composition-detail-section' },
            h(
              'h3',
              {},
              'Configured calls',
              h('span', { class: 'composition-section-count' }, outgoing.length),
            ),
            outgoing.length
              ? h(
                  'ul',
                  { class: 'composition-route-list' },
                  outgoing.map((edge) =>
                    h(
                      'li',
                      { key: edge.id },
                      h('code', {}, literal(edge.slot)),
                      button(
                        h('span', {}, literal(nodes.get(edge.target)!.label), icon('arrow')),
                        () => props.onSelect(edge.target),
                      ),
                      snapshot ? h('small', { class: 'secondary' }, edgeCountLabel(edge.id)) : null,
                      snapshot ? requestSummary(edgeSummaries.get(edge.id)!) : null,
                    ),
                  ),
                )
              : h('p', { class: 'secondary' }, 'No configured child calls.'),
          ),
          h(
            'details',
            { class: 'composition-identity' },
            h('summary', {}, 'Component identity'),
            h('code', {}, literal(selected.id)),
            selected.kind === 'resource'
              ? h('p', {}, 'Native resource kind: ', h('code', {}, selected.resourceKind))
              : null,
            h('p', { class: 'secondary' }, 'Identity is distinct from the display label.'),
          ),
        )
      : null,
  )
}
