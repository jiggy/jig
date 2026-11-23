import {
  boundDisplayCallComparison,
  compareObservedCalls,
  type DisplayCallPathComparison,
  type DisplayProjectRunEvidence,
  type DisplayRecordedComparison,
} from '@jigging/display-model'
import { type ComponentChildren, h } from 'preact'
import { privateBrowserLiteral } from './navigation.js'

type Call = DisplayProjectRunEvidence['calls'][number]
type CallEvidence = Pick<
  DisplayProjectRunEvidence,
  'calls' | 'callCoverage' | 'callsOmitted' | 'callPathsOmitted'
>
type CallSide = Readonly<{ root?: string | undefined; evidence: CallEvidence }>
const literal = (value: string) => h('bdi', { class: 'literal' }, privateBrowserLiteral(value))

type Coverage = Pick<CallEvidence, 'callCoverage' | 'callsOmitted' | 'callPathsOmitted'> & {
  callsRecorded: number
}
type ComparisonSide = Readonly<{
  root?: string | undefined
  callCoverage: CallEvidence['callCoverage']
}>

function coverage(evidence: Coverage, unplaced: number): string {
  const parts: string[] = [
    {
      complete: 'Complete recording',
      incomplete: 'Incomplete recording',
      unavailable: 'Recording unavailable',
    }[evidence.callCoverage],
  ]
  if (evidence.callsOmitted) parts.push(`${evidence.callsOmitted} omitted observations`)
  if (evidence.callPathsOmitted !== undefined)
    parts.push(
      `${evidence.callPathsOmitted} call paths withheld before comparison (settlement limit)`,
    )
  if (unplaced)
    parts.push(`${unplaced} ${unplaced === 1 ? 'call' : 'calls'} without a matched path`)
  if (evidence.callCoverage === 'complete' && !evidence.callsRecorded)
    parts.push('No calls observed')
  return parts.join(' · ')
}

function outcome(call: Pick<Call, 'state' | 'outcome'>): ComponentChildren {
  return [literal(call.state), call.outcome === undefined ? null : [' ', literal(call.outcome)]]
}

function variants(
  calls: DisplayCallPathComparison['earlier'],
  side: ComparisonSide,
  root: string,
  stale: boolean,
): ComponentChildren {
  if (!calls.length) {
    if (side.callCoverage === 'unavailable') return 'Unavailable'
    if (side.root !== root) return 'Different root'
    return !stale && side.callCoverage === 'complete' ? 'None observed' : 'No retained match'
  }
  return h(
    'ul',
    {},
    calls.map((value, index) =>
      h('li', { key: index }, literal(value.target), ' · ', outcome(value), ` ×${value.count}`),
    ),
  )
}

function unplacedCalls(label: string, calls: readonly Call[]): ComponentChildren {
  if (!calls.length) return null
  const rows = calls.slice(0, 8).map((call) => ({
    call,
    key: JSON.stringify([call.slot, call.caller, call.target, call.state, call.outcome]),
  }))
  rows.sort((a, b) => a.key.localeCompare(b.key))
  return h(
    'details',
    {},
    h('summary', {}, label, ' calls without a matched path'),
    calls.length > 8 ? h('p', {}, 'Showing eight of ', calls.length, ' observations.') : null,
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
  const {
    rows: compared,
    beforeUnplaced,
    afterUnplaced,
  } = compareObservedCalls(
    { root: earlier.root, calls: earlier.evidence.calls },
    { root: later.root, calls: later.evidence.calls },
  )

  const { rows, rowsOmitted, nonmatchingOmitted } = boundDisplayCallComparison(compared)
  return h(
    'section',
    { class: 'explorer-call-comparison' },
    h('h3', {}, 'Observed calls'),
    h(
      'p',
      { class: 'secondary' },
      'Earlier · ',
      coverage(
        { ...earlier.evidence, callsRecorded: earlier.evidence.calls.length },
        beforeUnplaced.length,
      ),
    ),
    h(
      'p',
      { class: 'secondary' },
      'Later · ',
      coverage(
        { ...later.evidence, callsRecorded: later.evidence.calls.length },
        afterUnplaced.length,
      ),
    ),
    omittedPaths(rowsOmitted, nonmatchingOmitted),
    comparisonTable(
      rows,
      { root: earlier.root, callCoverage: earlier.evidence.callCoverage },
      { root: later.root, callCoverage: later.evidence.callCoverage },
      stale,
      rowsOmitted,
    ),
    unplacedCalls('Earlier', beforeUnplaced),
    unplacedCalls('Later', afterUnplaced),
  )
}

function omittedPaths(total: number, nonmatching: number, guidance = ''): ComponentChildren {
  return total
    ? h(
        'p',
        { class: 'secondary' },
        `${total} call paths omitted from this browser comparison.`,
        nonmatching ? ` ${nonmatching} omitted paths lacked matching observations.` : '',
        guidance,
      )
    : null
}

function comparisonTable(
  rows: readonly DisplayCallPathComparison[],
  earlier: ComparisonSide,
  later: ComparisonSide,
  stale: boolean,
  omitted = 0,
): ComponentChildren {
  if (!rows.length)
    return h(
      'p',
      { class: 'secondary' },
      omitted
        ? 'No call paths fit in this browser comparison.'
        : 'No calls with matched paths were retained.',
    )
  return h(
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
      rows.map((row) =>
        h(
          'tr',
          { key: JSON.stringify([row.root, row.ancestors, row.caller, row.slot]) },
          h(
            'th',
            { scope: 'row' },
            literal(row.caller),
            ' · ',
            literal(row.slot),
            earlier.root === later.root ? null : h('small', {}, 'Root ', literal(row.root)),
            row.ancestors.length === 0
              ? null
              : h(
                  'small',
                  {},
                  'Via ',
                  row.ancestors.map(({ slot, target }, index) =>
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
            row.matches
              ? h('small', {}, 'Matching retained observations')
              : row.earlier.length && row.later.length
                ? h('small', {}, 'Different retained observations')
                : null,
          ),
          h('td', {}, variants(row.earlier, earlier, row.root, stale)),
          h('td', {}, variants(row.later, later, row.root, stale)),
        ),
      ),
    ),
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
    h(
      'section',
      { class: 'explorer-call-comparison' },
      h('h3', {}, 'Observed calls'),
      h('p', { class: 'secondary' }, 'Earlier · ', coverage(earlier, earlier.callsUnplaced)),
      h('p', { class: 'secondary' }, 'Later · ', coverage(later, later.callsUnplaced)),
      omittedPaths(
        comparison.rowsOmitted,
        comparison.nonmatchingOmitted,
        ' See the plain comparison for more recorded paths.',
      ),
      comparisonTable(comparison.rows, earlier, later, stale, comparison.rowsOmitted),
    ),
  )
}
