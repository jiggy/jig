import { compositionObservations, type DisplaySnapshot } from '@jigging/display-model'
import { h } from 'preact'
import { useRef, useState } from 'preact/hooks'
import { privateBrowserInvocationViews, privateBrowserLiteral } from './navigation.js'
import { privateBrowserObservationTime } from './observations.js'

type Call = DisplaySnapshot['calls'][number]
type ChildViews = ReturnType<typeof privateBrowserInvocationViews>

const quote = (value: string): string =>
  privateBrowserLiteral(JSON.stringify(value))
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029')

const unmatched = {
  'composition-unavailable': 'Admitted composition is unavailable.',
  'caller-unobserved': 'The caller has no exact correspondence to the configuration.',
  'slot-unavailable': 'The observed slot has no matching configured connection.',
  'identity-conflict': 'Conflicting identities prevent a configuration match.',
}

function investigationBrief(snapshot: DisplaySnapshot, call: Call, childViews: ChildViews): string {
  const observations = compositionObservations(snapshot)
  const match = observations.matches.find((item) => item.callId === call.id)
  const nodes = snapshot.composition?.state === 'available' ? snapshot.composition.nodes : []
  const caller = nodes.find((node) => node.id === match?.sourceNodeId)
  const target = nodes.find((node) => node.id === match?.targetNodeId)
  const reason = observations.unmatched.find((item) => item.callId === call.id)?.reason
  const coverage = [
    reason && unmatched[reason],
    snapshot.omissions.calls > 0 && `Omitted call observations: ${snapshot.omissions.calls}.`,
    (snapshot.omissions.journal.flow > 0 ||
      snapshot.omissions.journal.host > 0 ||
      snapshot.omissions.journal.diagnostic > 0) &&
      'Some reports or diagnostics were omitted.',
    snapshot.incomplete && snapshot.omissions.calls === 0 && 'Run observations are incomplete.',
    childViews.kind === 'unavailable' && childViews.label,
  ].filter(Boolean)

  return [
    'Investigate this observed Jig invocation.',
    caller ? `Configured caller: ${quote(caller.label)} (${caller.kind})` : undefined,
    `Observed caller: ${quote(call.sourceLabel)}`,
    `Slot: ${quote(call.slot)}`,
    target
      ? `Configured target: ${quote(target.label)} (${target.kind === 'resource' ? target.resourceKind : target.kind})`
      : undefined,
    `Operation: ${quote(call.operationId)} (caller-local)`,
    `First observed: ${privateBrowserObservationTime(call.firstObservedAt)}`,
    `Observed state: ${call.state}`,
    call.outcome === undefined ? undefined : `Application outcome: ${quote(call.outcome)}`,
    call.cause === undefined ? undefined : `Observed cause: ${quote(call.cause)}`,
    childViews.kind === 'available'
      ? `Reported views retained: ${childViews.views.length}`
      : undefined,
    `Coverage: Retained Run observations only.${coverage.length ? ` ${coverage.join(' ')}` : ''}`,
    'The exact target selector is unavailable here. Run `jig inspect --flow --topology --all` in the project.',
    'Use the caller and slot to locate the corresponding source. Confirm that the current wiring matches the observed Run.',
  ]
    .filter((line) => line !== undefined)
    .join('\n')
}

// Serialize clipboard writes even if the owner moves to another invocation during a write.
let writing = false

export function InvestigationBrief({
  snapshot,
  call,
  childViews,
  enabled,
}: {
  snapshot: DisplaySnapshot
  call: Call
  childViews: ChildViews
  enabled: boolean
}) {
  const scope = useRef({ revision: snapshot.revision, enabled })
  const [result, setResult] = useState<{ scope: typeof scope.current; message: string }>()
  if (scope.current.revision !== snapshot.revision || scope.current.enabled !== enabled)
    scope.current = { revision: snapshot.revision, enabled }

  async function copy(): Promise<void> {
    if (!enabled) return
    const selected = scope.current
    if (writing) {
      setResult({ scope: selected, message: 'Clipboard is busy. Try again.' })
      return
    }
    writing = true
    setResult({ scope: selected, message: 'Copying…' })
    let message: string
    try {
      await navigator.clipboard.writeText(investigationBrief(snapshot, call, childViews))
      message = 'Investigation brief copied.'
    } catch {
      message = 'Could not copy the investigation brief.'
    } finally {
      writing = false
    }
    if (scope.current === selected) setResult({ scope: selected, message })
  }

  return h(
    'div',
    { class: 'call-brief' },
    h(
      'button',
      {
        type: 'button',
        'aria-disabled': !enabled,
        'aria-describedby': enabled ? undefined : 'brief-unavailable',
        onClick: copy,
      },
      'Copy investigation brief',
    ),
    h(
      'span',
      { class: 'secondary' },
      h(
        'span',
        { role: 'status' },
        enabled && result?.scope === scope.current ? result.message : '',
      ),
      !enabled
        ? h('span', { id: 'brief-unavailable' }, 'Copy requires a current observation.')
        : null,
    ),
  )
}
