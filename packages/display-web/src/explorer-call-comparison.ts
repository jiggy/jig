import {
  compareObservedCalls,
  type DisplayProjectRunComparison,
  type DisplayProjectRunEvidence,
} from '@jigging/display-model'
import { type ComponentChildren, h } from 'preact'
import { privateBrowserLiteral } from './navigation.js'

type Call = DisplayProjectRunEvidence['calls'][number]
const literal = (value: string) => h('bdi', { class: 'literal' }, privateBrowserLiteral(value))

function coverage(evidence: DisplayProjectRunEvidence, unplaced: number): string {
  const parts: string[] = [
    {
      complete: 'Complete recording',
      incomplete: 'Incomplete recording',
      unavailable: 'Recording unavailable',
    }[evidence.callCoverage],
  ]
  if (evidence.callsOmitted) parts.push(`${evidence.callsOmitted} omitted observations`)
  if (unplaced)
    parts.push(`${unplaced} ${unplaced === 1 ? 'call' : 'calls'} without a matched path`)
  if (evidence.callCoverage === 'complete' && !evidence.calls.length)
    parts.push('No calls observed')
  return parts.join(' · ')
}

function outcome(call: Pick<Call, 'state' | 'outcome'>): ComponentChildren {
  return [literal(call.state), call.outcome === undefined ? null : [' ', literal(call.outcome)]]
}

function variants(
  group: ReturnType<typeof compareObservedCalls>['rows'][number]['previous'],
  evidence: DisplayProjectRunEvidence,
): ComponentChildren {
  if (!group) {
    if (evidence.callCoverage === 'unavailable') return 'Unavailable'
    return evidence.callCoverage === 'complete' ? 'None observed' : 'No retained match'
  }
  return h(
    'ul',
    {},
    [...group.variants]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) =>
        h('li', { key }, literal(value.target), ' · ', outcome(value), ` ×${value.count}`),
      ),
  )
}

function unplacedCalls(label: string, calls: readonly Call[]): ComponentChildren {
  if (!calls.length) return null
  const rows = calls.map((call) => ({
    call,
    key: JSON.stringify([call.slot, call.caller, call.target, call.state, call.outcome]),
  }))
  rows.sort((a, b) => a.key.localeCompare(b.key))
  return h(
    'details',
    {},
    h('summary', {}, label, ' calls without a matched path'),
    h(
      'ul',
      {},
      rows.map(({ call }, index) =>
        h(
          'li',
          { key: index },
          call.caller === undefined ? null : [literal(call.caller), ' · '],
          literal(call.slot),
          call.target === undefined ? null : [' · ', literal(call.target)],
          ' · ',
          outcome(call),
        ),
      ),
    ),
  )
}

export function ExplorerCallComparison({
  earlier,
  later,
}: Readonly<{
  earlier: DisplayProjectRunComparison
  later: DisplayProjectRunComparison
}>): ComponentChildren {
  const { rows, beforeUnplaced, afterUnplaced } = compareObservedCalls(
    { root: earlier.root, calls: earlier.evidence.calls },
    { root: later.root, calls: later.evidence.calls },
  )

  return h(
    'section',
    { class: 'explorer-call-comparison' },
    h('h3', {}, 'Observed calls'),
    h('p', { class: 'secondary' }, 'Earlier · ', coverage(earlier.evidence, beforeUnplaced.length)),
    h('p', { class: 'secondary' }, 'Later · ', coverage(later.evidence, afterUnplaced.length)),
    rows.length === 0
      ? null
      : h(
          'table',
          { 'aria-label': 'Compare observed calls' },
          h(
            'thead',
            {},
            h(
              'tr',
              {},
              h('th', { scope: 'col' }, 'Caller and slot'),
              h('th', { scope: 'col' }, 'Earlier'),
              h('th', { scope: 'col' }, 'Later'),
            ),
          ),
          h(
            'tbody',
            {},
            rows.map(({ key, previous, current, group, matches }) =>
              h(
                'tr',
                { key },
                h(
                  'th',
                  { scope: 'row' },
                  literal(group.caller),
                  ' · ',
                  literal(group.slot),
                  earlier.root === later.root || group.ancestors.length === 0
                    ? null
                    : h('small', {}, 'Root ', literal(group.root)),
                  group.ancestors.length === 0
                    ? null
                    : h(
                        'small',
                        {},
                        'Via ',
                        group.ancestors.map(({ slot, target }, index) =>
                          h(
                            'span',
                            { key: index },
                            index === 0 ? null : ' → ',
                            literal(slot),
                            ' → ',
                            literal(target),
                          ),
                        ),
                      ),
                  matches
                    ? h('small', {}, 'Matching retained observations')
                    : previous && current
                      ? h('small', {}, 'Different retained observations')
                      : null,
                ),
                h('td', {}, variants(previous, earlier.evidence)),
                h('td', {}, variants(current, later.evidence)),
              ),
            ),
          ),
        ),
    unplacedCalls('Earlier', beforeUnplaced),
    unplacedCalls('Later', afterUnplaced),
  )
}
