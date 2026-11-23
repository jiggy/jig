import {
  compareObservedCalls,
  DISPLAY_RECORDED_CALL_ANCESTORS,
  DISPLAY_RECORDED_CALL_BYTES,
  DISPLAY_RECORDED_CALL_ROWS,
  type DisplayCallPathComparison,
  type DisplayRecordedComparison,
  type DisplayRecordedRun,
  displayCallPathComparison,
} from '@jigging/display-model'
import { asciiJsonString } from './cli-usage.js'
import { normalizePrivateRunFileIdentity } from './internal/root-run-files.js'
import { localName, readPrivateSavedCalls } from './internal/saved-call-evidence.js'
import type { PrivateSavedResult } from './internal/saved-result.js'
import type { JsonValue } from './json.js'

type Group = NonNullable<ReturnType<typeof compareObservedCalls>['rows'][number]['previous']>

function recorded(packet: PrivateSavedResult) {
  const { runId, callEvidence, status, outcome } = packet.record
  const calls = readPrivateSavedCalls(callEvidence, runId)
  const recordedStatus: DisplayRecordedRun['status'] =
    status === 'succeeded' || status === 'failed' ? status : 'lost'
  return {
    runId: typeof runId === 'string' && /^sha256:[0-9a-f]{64}$/.test(runId) ? runId : 'unknown',
    status: recordedStatus,
    outcome: localName(outcome) ? outcome : undefined,
    root: calls?.root,
    revision: calls?.revision,
    calls: calls?.calls ?? [],
    coverage: calls?.coverage ?? 'unavailable',
    omitted: calls?.omittedEvents ?? 0,
    invalid: calls === undefined && callEvidence !== undefined,
    filesComplete: packet.complete,
  }
}

type Recorded = ReturnType<typeof recorded>

function heading(label: string, run: Recorded, unplaced: number): string {
  const status = run.outcome ? `${run.status} · ${asciiJsonString(run.outcome)}` : run.status
  return [
    `${label} Run: ${run.runId}`,
    `  Root: ${run.root === undefined ? 'unknown' : asciiJsonString(run.root)}`,
    `  Approved revision: ${run.revision ?? 'unknown'}`,
    `  Recorded result: ${status}`,
    `  File verification: ${run.filesComplete ? 'consistent' : 'incomplete'}`,
    `  Call coverage: ${run.coverage}${run.invalid ? ' (invalid or mismatched record)' : ''}`,
    ...(run.omitted ? [`  Omitted events: ${run.omitted}`] : []),
    ...(unplaced ? [`  Calls without a matched path: ${unplaced}`] : []),
    ...(run.coverage === 'complete' && !run.calls.length ? ['  No calls observed.'] : []),
  ].join('\n')
}

function variants(group: Group | undefined, run: Recorded, root: string): string {
  if (group !== undefined)
    return [...group.variants]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, { target, state, outcome, count }]) =>
        [
          asciiJsonString(target),
          state,
          ...(outcome === undefined ? [] : [asciiJsonString(outcome)]),
          `×${count}`,
        ].join(' '),
      )
      .join(', ')
  if (run.coverage === 'unavailable') return 'Unavailable'
  if (root !== run.root) return 'Different root'
  return run.coverage === 'complete' ? 'None observed' : 'No retained match'
}

function recordedSubmittedIdentity(value: JsonValue | undefined): string | undefined {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== 2 ||
    !('digest' in value) ||
    !('attachments' in value) ||
    typeof value.digest !== 'string' ||
    !/^sha256:[0-9a-f]{64}$/.test(value.digest)
  )
    return
  try {
    // Packet input contains submitted read attachments only. Output intent is outside the identity.
    const { attachments } = normalizePrivateRunFileIdentity({
      attachments: value.attachments,
      output: false,
    })
    return JSON.stringify([value.digest, attachments])
  } catch {
    return undefined
  }
}

function browserRun(run: Recorded, callsUnplaced: number): DisplayRecordedRun {
  return {
    ...(run.runId === 'unknown' ? {} : { runId: run.runId }),
    ...(run.revision === undefined ? {} : { revision: run.revision }),
    ...(run.root === undefined ? {} : { root: run.root }),
    status: run.status,
    ...(run.outcome === undefined ? {} : { outcome: run.outcome }),
    filesComplete: run.filesComplete,
    invalidCalls: run.invalid,
    callCoverage: run.coverage,
    callsOmitted: run.omitted,
    callsRecorded: run.calls.length,
    callsUnplaced,
  }
}

/** Bound whole rows after comparison. A rejected row contributes no partial counts. */
function browserRows(compared: ReturnType<typeof compareObservedCalls>['rows']) {
  const rows: DisplayCallPathComparison[] = []
  let bytes = 2 // List delimiters.
  let nonmatchingOmitted = 0
  for (const row of compared) {
    if (
      rows.length < DISPLAY_RECORDED_CALL_ROWS &&
      row.group.ancestors.length <= DISPLAY_RECORDED_CALL_ANCESTORS
    ) {
      const projected = displayCallPathComparison(row)
      const size = Buffer.byteLength(JSON.stringify(projected)) + (rows.length ? 1 : 0)
      if (bytes + size <= DISPLAY_RECORDED_CALL_BYTES) {
        rows.push(projected)
        bytes += size
        continue
      }
    }
    if (!row.matches) nonmatchingOmitted += 1
  }
  return { rows, rowsOmitted: compared.length - rows.length, nonmatchingOmitted }
}

/** Plain literal comparison and a closed browser projection of the same captured claims. */
export function privateSavedCallComparison(earlier: PrivateSavedResult, later: PrivateSavedResult) {
  const before = recorded(earlier)
  const after = recorded(later)
  const { rows, beforeUnplaced, afterUnplaced } = compareObservedCalls(before, after)
  const beforeInput = recordedSubmittedIdentity(earlier.record.input)
  const afterInput = recordedSubmittedIdentity(later.record.input)
  const submittedIdentity =
    beforeInput === undefined || afterInput === undefined
      ? 'unknown'
      : beforeInput === afterInput
        ? 'same'
        : 'different'
  let text = [
    'Saved Run call comparison',
    'Local recorded claims. No work was started.',
    `Submitted input and attachments: ${submittedIdentity === 'unknown' ? 'unknown' : `${submittedIdentity} recorded identity`}`,
    '',
    heading('Earlier', before, beforeUnplaced.length),
    heading('Later', after, afterUnplaced.length),
    '',
    'Observed calls',
    '',
  ].join('\n')
  let bytes = Buffer.byteLength(text)
  let hidden = 0
  for (const { previous, current, group, matches } of rows) {
    const path = [
      group.root,
      ...group.ancestors.flatMap(({ slot, target }) => [slot, target]),
      group.slot,
    ]
      .map(asciiJsonString)
      .join(' → ')
    const finding = matches
      ? 'Matching retained observations'
      : previous && current
        ? 'Different retained observations'
        : 'Observed on one side'
    const row =
      [
        `${path} · ${finding}`,
        `  Earlier: ${variants(previous, before, group.root)}`,
        `  Later: ${variants(current, after, group.root)}`,
        '',
      ].join('\n') + '\n'
    const size = Buffer.byteLength(row)
    if (bytes + size > 24_000) {
      hidden += 1
      continue
    }
    text += row
    bytes += size
  }
  if (!rows.length) text += 'No calls with matched paths were retained.\n'
  if (hidden)
    text += `${hidden} call paths omitted from this excerpt. Inspect each packet with --calls for its full record.\n`
  return {
    text,
    browser: {
      earlier: browserRun(before, beforeUnplaced.length),
      later: browserRun(after, afterUnplaced.length),
      submittedIdentity,
      ...browserRows(rows),
    } satisfies DisplayRecordedComparison,
    complete:
      before.filesComplete &&
      after.filesComplete &&
      before.coverage === 'complete' &&
      after.coverage === 'complete' &&
      hidden === 0,
  }
}
