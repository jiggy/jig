import type {
  DisplayCompositionNode,
  DisplayCompositionResourceKind,
  DisplaySnapshot,
} from '@jigging/display-model'
import { compositionObservations } from '@jigging/display-model'
import { type ComponentChildren, h } from 'preact'
import { privateCompositionLayout } from './composition.js'
import { privateBrowserLiteral } from './navigation.js'

type Props = {
  snapshot: DisplaySnapshot
  selectedNodeId?: string | undefined
  detailOpen: boolean
  referencesEnabled: boolean
  onSelect: (id: string) => void
  onClose: () => void
  onCall: (id: string) => void
  onObservedCalls: () => void
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
  node.kind === 'binding'
    ? 'Binding'
    : node.kind === 'flow'
      ? 'Flow'
      : resourceLabels[node.resourceKind]
const button = (label: ComponentChildren, action: () => void, props: Record<string, unknown> = {}) =>
  h('button', { type: 'button', onClick: action, ...props }, label)
const unmatchedReason = (reason: string): string =>
  reason === 'caller-unobserved'
    ? 'Caller relationship unavailable'
    : reason === 'slot-unavailable'
      ? 'Configured slot unavailable'
      : reason === 'identity-conflict'
        ? 'Conflicting invocation identities'
        : 'Composition unavailable'

/** An admitted component map, with observed requests kept separate from available connections. */
export function CompositionPage(props: Props): ComponentChildren {
  const { snapshot } = props
  const composition = snapshot.composition
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
      h('p', { class: 'secondary' }, 'Retained invocation observations remain available.'),
      button('Inspect observed calls', props.onObservedCalls),
    )

  const nodes = new Map(composition.nodes.map((node) => [node.id, node]))
  const attribution = compositionObservations(snapshot)
  const calls = new Map(snapshot.calls.map((call) => [call.id, call]))
  const requests = new Map<string, DisplaySnapshot['calls'][number][]>()
  const edgeCounts = new Map<string, number>()
  for (const match of attribution.matches) {
    const call = calls.get(match.callId)
    if (!call) continue
    if (!requests.has(match.targetNodeId)) requests.set(match.targetNodeId, [])
    requests.get(match.targetNodeId)!.push(call)
    edgeCounts.set(match.edgeId, (edgeCounts.get(match.edgeId) ?? 0) + 1)
  }
  const edgeCountLabel = (edgeId: string): string => {
    const count = edgeCounts.get(edgeId) ?? 0
    return count ? count + (count === 1 ? ' retained request' : ' retained requests') : 'No matching retained requests'
  }
  const selected = nodes.get(props.selectedNodeId ?? '')
  const chooserLabel = (node: DisplayCompositionNode): string => {
    if (node.id === composition.rootId) return node.label + ' · Run root'
    const incoming = composition.edges.filter((edge) => edge.target === node.id)
    const connection = incoming[0]
    return node.label + ' · ' + kindLabel(node) +
      (connection ? ' · from ' + nodes.get(connection.source)!.label + ' / ' + connection.slot : '') +
      (incoming.length > 1 ? ' (+' + (incoming.length - 1) + ' connections)' : '')
  }
  const selectedRequests = selected ? (requests.get(selected.id) ?? []) : []
  const layout = privateCompositionLayout({
    ...composition,
    nodes: composition.nodes.map((node) => ({ ...node, label: privateBrowserLiteral(node.label) })),
    edges: composition.edges.map((edge) => ({ ...edge, slot: privateBrowserLiteral(edge.slot) })),
  })
  const reasonCounts = new Map<string, number>()
  for (const item of attribution.unmatched)
    reasonCounts.set(item.reason, (reasonCounts.get(item.reason) ?? 0) + 1)

  return h(
    'div',
    { class: 'composition-page' + (selected && props.detailOpen ? ' inspecting' : '') },
    h(
      'section',
      { class: 'composition-main' },
      h(
        'div',
        { class: 'view-heading' },
        h('h2', {}, 'Available calls'),
        h('span', { class: 'secondary' }, composition.nodes.length + ' components'),
      ),
      h(
        'p',
        { class: 'composition-explanation', id: 'composition-explanation' },
        'Connections show which component a configured slot can call. They do not show execution order or internal decisions.',
      ),
      h(
        'div',
        { class: 'composition-controls' },
        h(
          'label',
          {},
          'Inspect a component',
          h(
            'select',
            {
              value: selected?.id ?? '',
              onChange: (event: Event) => {
                const id = (event.target as HTMLSelectElement).value
                if (id) props.onSelect(id)
              },
            },
            h('option', { value: '' }, 'Choose a component…'),
            composition.nodes.map((node) =>
              h('option', { key: node.id, value: node.id }, privateBrowserLiteral(chooserLabel(node))),
            ),
          ),
        ),
        h('span', { class: 'secondary' }, 'Badges count retained invocation requests.'),
        button('Observed calls', props.onObservedCalls),
      ),
      h(
        'div',
        {
          id: 'composition-scroll',
          class: 'composition-scroll',
          role: 'region',
          'aria-label': 'Available component calls. Scroll to explore the map.',
          'aria-describedby': 'composition-explanation',
          tabIndex: 0,
          onScroll: (event: Event) => {
            const viewport = event.currentTarget as HTMLElement
            props.onScroll(viewport.scrollLeft, viewport.scrollTop)
          },
        },
        h(
          'div',
          { class: 'composition-canvas', style: { width: layout.width, height: layout.height } },
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
              h(
                'marker',
                {
                  id: 'composition-arrow', markerWidth: 8, markerHeight: 8,
                  refX: 7, refY: 4, orient: 'auto', markerUnits: 'userSpaceOnUse',
                },
                h('path', { d: 'M 0 0 L 8 4 L 0 8 Z', fill: 'var(--secondary)' }),
              ),
            ),
            layout.routes.map((route) =>
              h(
                'g',
                { key: route.id },
                h('path', {
                  d: route.path,
                  class: 'composition-route' + (route.source === selected?.id || route.target === selected?.id ? ' related' : ''),
                  'marker-end': 'url(#composition-arrow)',
                }),
                h(
                  'text',
                  { x: route.labelX, y: route.labelY, class: 'composition-slot', 'text-anchor': 'middle' },
                  route.lines.map((line, index) =>
                    h('tspan', { key: index, x: route.labelX, dy: index ? 15 : 0 }, line),
                  ),
                ),
              ),
            ),
          ),
          layout.nodes.map((box) => {
            const node = nodes.get(box.id)!
            const count = requests.get(node.id)?.length ?? 0
            return button(
              h(
                'span',
                { class: 'composition-card-content' },
                h('small', { class: 'composition-kind' }, kindLabel(node)),
                h(
                  'strong',
                  { class: 'composition-label' },
                  box.labelLines.map((line, index) => h('span', { key: index }, literal(line))),
                ),
                h(
                  'span',
                  { class: 'composition-count' },
                  node.id === composition.rootId
                    ? 'Run root'
                    : count
                      ? count + (count === 1 ? ' retained request' : ' retained requests')
                      : 'No matching retained requests',
                ),
              ),
              () => props.onSelect(node.id),
              {
                key: node.id,
                class: 'composition-card' + (node.kind === 'resource' ? ' resource' : '') +
                  (node.kind === 'resource' && (node.resourceKind === 'run-checkpoint' || node.resourceKind === 'child-checkpoint') ? ' checkpoint' : '') +
                  (node.id === selected?.id ? ' selected' : ''),
                style: { left: box.x, top: box.y, width: box.width, height: box.height },
                'data-component': node.id,
                'aria-pressed': node.id === selected?.id,
                'aria-label': privateBrowserLiteral(node.label) + ', ' + kindLabel(node) + (node.id === composition.rootId ? ', Run root' : ', ' + count + ' matching retained requests'),
                onKeyDown: props.onNodeKeyDown,
              },
            )
          }),
        ),
      ),
      h(
        'p',
        { class: 'secondary composition-map-note' },
        'Select a component for its configured connections and matching invocation observations. Arrow keys move between components.',
      ),
      snapshot.omissions.calls
        ? h('p', { class: 'unavailable-note' }, snapshot.omissions.calls + ' call observations are omitted. Counts describe retained observations only.')
        : null,
      attribution.unmatched.length
        ? h(
            'details',
            { class: 'composition-attribution' },
            h('summary', {}, attribution.unmatched.length + (attribution.unmatched.length === 1 ? ' retained observation cannot' : ' retained observations cannot') + ' be placed on this map'),
            h('ul', {}, [...reasonCounts].map(([reason, count]) => h('li', { key: reason }, unmatchedReason(reason) + ': ' + count))),
            h('p', {}, 'Their known lifecycle remains visible in the observed-call view.'),
            button('Inspect observed calls', props.onObservedCalls),
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
              h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Caller'), h('th', { scope: 'col' }, 'Slot'), h('th', { scope: 'col' }, 'Target'), h('th', { scope: 'col' }, 'Retained requests'))),
              h(
                'tbody',
                {},
                composition.edges.map((edge) =>
                  h(
                    'tr',
                    { key: edge.id },
                    h('td', {}, button(literal(nodes.get(edge.source)!.label), () => props.onSelect(edge.source))),
                    h('td', {}, h('code', {}, literal(edge.slot))),
                    h('td', {}, button(literal(nodes.get(edge.target)!.label), () => props.onSelect(edge.target))),
                    h('td', {}, edgeCountLabel(edge.id)),
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
        h('p', {}, 'The host supplies this Run’s admitted composition. Internal steps, branch conditions, and data transformations are not included.'),
        h('p', {}, 'A matched request retains its observed state. It does not by itself establish that the target started or completed.'),
        h('p', {}, 'An absence of matching retained requests does not establish that a configured call was skipped.'),
      ),
    ),
    selected && props.detailOpen
      ? h(
          'aside',
          { class: 'composition-detail', 'aria-label': 'Selected component' },
          button('← Back to map', props.onClose, { class: 'back-to-records back-to-components' }),
          h('small', { class: 'composition-kind' }, kindLabel(selected)),
          h('h2', {}, literal(selected.label)),
          selected.id === composition.rootId
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
                      h('small', { class: 'source' }, ' · ', snapshot.workspace.facts.execution.provenance),
                      snapshot.workspace.facts.execution.clipped ? ' · retained fact clipped' : null,
                    )
                  : null,
                h('p', { class: 'secondary' }, 'This component is the Run root. Child invocation requests appear on their target components.'),
              )
            : null,
          h('h3', {}, 'Available calls'),
          composition.edges.some((edge) => edge.source === selected.id)
            ? h(
                'ul',
                { class: 'composition-route-list' },
                composition.edges.filter((edge) => edge.source === selected.id).map((edge) =>
                  h(
                    'li',
                    { key: edge.id },
                    h('code', {}, literal(edge.slot)),
                    button(literal(nodes.get(edge.target)!.label), () => props.onSelect(edge.target)),
                    h('small', { class: 'secondary' }, edgeCountLabel(edge.id)),
                  ),
                ),
              )
            : h('p', { class: 'secondary' }, 'No outgoing connections are supplied for this component.'),
          selected.id !== composition.rootId ? h('h3', {}, 'Observed invocation requests') : null,
          selected.id === composition.rootId ? null : selectedRequests.length
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
                        {},
                        h('strong', {}, literal(call.intent ?? call.slot)),
                        h('span', { class: 'composition-request-state call-' + call.state }, 'Observed state: ' + call.state),
                        h('small', {}, 'Operation: ', literal(call.operationId)),
                      ),
                      () => props.onCall(call.id),
                      {
                        'data-composition-call': call.id,
                        disabled: !props.referencesEnabled,
                        'aria-label': 'Inspect invocation ' + privateBrowserLiteral(call.operationId) + ': ' + privateBrowserLiteral(call.intent ?? call.slot),
                      },
                    ),
                  ),
                ),
              )
            : h('p', { class: 'secondary' }, 'No matching invocation observations are retained for this component.'),
          selectedRequests.length && !props.referencesEnabled
            ? h('p', { class: 'unavailable-note' }, 'Invocation links are unavailable while this observation is stale or incomplete.')
            : null,
          h(
            'details',
            {},
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
