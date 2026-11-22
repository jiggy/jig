import type { DisplayProjectRunComparison, DisplayProjectRunEvidence } from '@jigging/display-model'
import { type ComponentChildren, h } from 'preact'
import { privateBrowserLiteral } from './navigation.js'

type Call = DisplayProjectRunEvidence['calls'][number]
type Step = Readonly<{ slot: string; target: string }>
type Variant = Pick<Call, 'state' | 'outcome'> & Readonly<{ target: string; count: number }>
type Group = {
  root: string
  caller: string
  slot: string
  ancestors: readonly Step[]
  variants: Map<string, Variant>
}

function groupCalls({ root, evidence }: DisplayProjectRunComparison) {
  const groups = new Map<string, Group>()
  const paths: (readonly Step[] | undefined)[] = []
  const unplaced: Call[] = []

  for (const call of evidence.calls) {
    const ancestors = call.parent === undefined ? [] : paths[call.parent - 1]
    const caller = ancestors?.at(-1)?.target ?? root
    if (!ancestors || call.caller !== caller || call.target === undefined) {
      paths.push(undefined)
      unplaced.push(call)
      continue
    }

    const { slot, target, state, outcome } = call
    paths.push([...ancestors, { slot, target }])
    const key = JSON.stringify([root, ancestors, caller, slot])
    let group = groups.get(key)
    if (!group) {
      group = { root, caller, slot, ancestors, variants: new Map() }
      groups.set(key, group)
    }
    const variant = JSON.stringify([target, state, outcome])
    group.variants.set(variant, {
      target,
      state,
      ...(outcome === undefined ? {} : { outcome }),
      count: (group.variants.get(variant)?.count ?? 0) + 1,
    })
  }
  return { groups, unplaced }
}

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
  group: Group | undefined,
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
  const before = groupCalls(earlier)
  const after = groupCalls(later)
  const groups = new Map([...before.groups, ...after.groups])
  const rows = [...groups]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, group]) => {
      const previous = before.groups.get(key)
      const current = after.groups.get(key)
      const matches =
        previous !== undefined &&
        current !== undefined &&
        previous.variants.size === current.variants.size &&
        [...previous.variants].every(
          ([id, value]) => current.variants.get(id)?.count === value.count,
        )
      return { key, previous, current, group, matches }
    })
  rows.sort((a, b) => Number(a.matches) - Number(b.matches))

  return h(
    'section',
    { class: 'explorer-call-comparison' },
    h('h3', {}, 'Observed calls'),
    h(
      'p',
      { class: 'secondary' },
      'Earlier · ',
      coverage(earlier.evidence, before.unplaced.length),
    ),
    h('p', { class: 'secondary' }, 'Later · ', coverage(later.evidence, after.unplaced.length)),
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
    unplacedCalls('Earlier', before.unplaced),
    unplacedCalls('Later', after.unplaced),
  )
}
