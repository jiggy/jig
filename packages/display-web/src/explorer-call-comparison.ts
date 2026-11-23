import {
  compareObservedCalls,
  type DisplayProjectRunEvidence,
  type DisplayRecordedComparison,
} from '@jigging/display-model'
import { type ComponentChildren, h } from 'preact'
import { privateBrowserLiteral } from './navigation.js'

type Call = DisplayProjectRunEvidence['calls'][number]
type CallEvidence = Pick<DisplayProjectRunEvidence, 'calls' | 'callCoverage' | 'callsOmitted'>
type CallSide = Readonly<{ root?: string | undefined; evidence: CallEvidence }>
const literal = (value: string) => h('bdi', { class: 'literal' }, privateBrowserLiteral(value))

function coverage(evidence: CallEvidence, unplaced: number): string {
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
  side: CallSide,
  root: string,
  stale: boolean,
): ComponentChildren {
  if (!group) {
    const { evidence } = side
    if (evidence.callCoverage === 'unavailable') return 'Unavailable'
    if (side.root !== root) return 'Different root'
    return !stale && evidence.callCoverage === 'complete' ? 'None observed' : 'No retained match'
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

export function ObservedCallComparison({
  earlier,
  later,
  stale = false,
}: Readonly<{
  earlier: CallSide
  later: CallSide
  stale?: boolean
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
      ? h('p', { class: 'secondary' }, 'No calls with matched paths were retained.')
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
                  earlier.root === later.root ? null : h('small', {}, 'Root ', literal(group.root)),
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
                h('td', {}, variants(previous, earlier, group.root, stale)),
                h('td', {}, variants(current, later, group.root, stale)),
              ),
            ),
          ),
        ),
    unplacedCalls('Earlier', beforeUnplaced),
    unplacedCalls('Later', afterUnplaced),
  )
}

export function SavedRunComparison({
  comparison,
  stale,
}: {
  comparison: DisplayRecordedComparison
  stale: boolean
}): ComponentChildren {
  const { earlier, later, submittedIdentity } = comparison
  const runs = [earlier, later]
  const rows = [
    { label: 'Run', cells: runs.map((run) => run.runId ?? 'Unknown') },
    { label: 'Root', cells: runs.map((run) => run.root ?? 'Unknown') },
    { label: 'Approved revision', cells: runs.map((run) => run.revision ?? 'Unknown') },
    {
      label: 'Recorded result',
      cells: runs.map((run) => [run.status, run.outcome].filter(Boolean).join(' · ')),
    },
    {
      label: 'File verification',
      cells: runs.map((run) => (run.filesComplete ? 'Consistent' : 'Incomplete')),
    },
  ]
  return h(
    'section',
    { class: 'explorer-comparison saved-run-comparison' },
    h(
      'p',
      {},
      'These packets contain local recorded claims. File consistency does not authenticate them.',
    ),
    h(
      'p',
      {},
      'Submitted input and attachments: ',
      h(
        'strong',
        {},
        submittedIdentity === 'unknown' ? 'unknown' : `${submittedIdentity} recorded identity`,
      ),
    ),
    h(
      'table',
      { 'aria-label': 'Saved Run identities' },
      h(
        'thead',
        {},
        h(
          'tr',
          {},
          h('th', { scope: 'col' }, 'Evidence'),
          h('th', { scope: 'col' }, 'Earlier'),
          h('th', { scope: 'col' }, 'Later'),
        ),
      ),
      h(
        'tbody',
        {},
        rows.map(({ label, cells }) =>
          h(
            'tr',
            { key: label },
            h('th', { scope: 'row' }, label),
            cells.map((cell, index) => h('td', { key: index }, literal(cell))),
          ),
        ),
      ),
    ),
    ...runs.flatMap((run, index) =>
      run.invalidCalls
        ? [
            h(
              'p',
              { class: 'secondary', key: index },
              index ? 'Later' : 'Earlier',
              ' call record is invalid or belongs to a different Run.',
            ),
          ]
        : [],
    ),
    h(ObservedCallComparison, {
      earlier: { root: earlier.root, evidence: earlier },
      later: { root: later.root, evidence: later },
      stale,
    }),
  )
}
