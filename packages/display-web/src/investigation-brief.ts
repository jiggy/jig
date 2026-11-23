import {
  compositionObservations,
  type DisplayCompositionNode,
  type DisplaySnapshot,
} from '@jigging/display-model'
import { h } from 'preact'
import { useRef, useState } from 'preact/hooks'
import { type privateBrowserInvocationViews, privateBrowserLiteral } from './navigation.js'
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

function canInspectRoot(root: string): boolean {
  // Accept only exact selectors that can be pasted as one unquoted shell word.
  if (/[^A-Za-z0-9@./:_-]/.test(root)) return false
  if (root.startsWith('binding:'))
    return root.length <= 72 && /^binding:[a-z0-9]+(?:-[a-z0-9]+)*$/.test(root)
  if (root.startsWith('npm:'))
    return (
      root.length <= 218 &&
      /^npm:(?:@[a-z0-9][a-z0-9._-]*\/)?[A-Za-z0-9][A-Za-z0-9._-]*$/.test(root)
    )
  if (!root.startsWith('flow:') || root.length > 1029) return false

  const segments = root.slice(5).split('/')
  return (
    segments.length <= 64 &&
    segments.every(
      (segment) => segment !== '.' && segment !== '..' && /^[A-Za-z0-9._-]{1,255}$/.test(segment),
    )
  )
}

function topologyCommand(root: string): string {
  return canInspectRoot(root)
    ? `Run \`jig inspect --flow --topology ${root}\` in the project.`
    : 'The exact target selector is unavailable here. Run `jig inspect --flow --topology --all` in the project.'
}

function component(node: DisplayCompositionNode): string {
  return `${quote(node.label)} (${node.kind === 'resource' ? node.resourceKind : node.kind})`
}

function investigationBrief(snapshot: DisplaySnapshot, call: Call, childViews: ChildViews): string {
  const root = snapshot.workspace.target
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
    `Run root: ${quote(root)}`,
    caller ? `Configured caller: ${component(caller)}` : undefined,
    `Observed caller: ${quote(call.sourceLabel)}`,
    `Slot: ${quote(call.slot)}`,
    target ? `Configured target: ${component(target)}` : undefined,
    `Operation: ${quote(call.operationId)} (caller-local)`,
    `First observed: ${privateBrowserObservationTime(call.firstObservedAt)}`,
    `Observed state: ${call.state}`,
    call.outcome === undefined ? undefined : `Application outcome: ${quote(call.outcome)}`,
    call.cause === undefined ? undefined : `Observed cause: ${quote(call.cause)}`,
    childViews.kind === 'available'
      ? `Reported views retained: ${childViews.views.length}`
      : undefined,
    `Coverage: Retained Run observations only.${coverage.length ? ` ${coverage.join(' ')}` : ''}`,
    topologyCommand(root),
    'Find the caller and slot in the topology. Check the caller source to confirm that the current wiring matches the observed Run.',
  ]
    .filter((line) => line !== undefined)
    .join('\n')
}

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
  return h(CopyBrief, {
    revision: snapshot.revision,
    enabled,
    label: 'Copy investigation brief',
    name: 'investigation brief',
    unavailableId: 'brief-unavailable',
    showUnavailable: true,
    text: () => investigationBrief(snapshot, call, childViews),
  })
}

export function ConfiguredRouteBrief({
  snapshot,
  caller,
  target,
  slot,
  callerSlots,
  count,
  states,
  unmatchedCount,
  enabled,
}: {
  snapshot: DisplaySnapshot
  caller: DisplayCompositionNode
  target: DisplayCompositionNode
  slot: string
  callerSlots: readonly string[]
  count: number
  states: string
  unmatchedCount: number
  enabled: boolean
}) {
  const root = snapshot.workspace.target
  const text = () => {
    const coverage = [
      'Counts cover matching retained requests only.',
      snapshot.omissions.calls > 0 && `Omitted call observations: ${snapshot.omissions.calls}.`,
      snapshot.incomplete && 'Run observations are incomplete.',
      unmatchedCount > 0 && `Unmatched retained call observations: ${unmatchedCount}.`,
    ].filter(Boolean)
    return [
      'Investigate this configured Jig route.',
      `Run root: ${quote(root)}`,
      `Configured caller: ${component(caller)}`,
      `Slot: ${quote(slot)}`,
      `Configured target: ${component(target)}`,
      `Configured slots from Run root: ${[...callerSlots, slot].map(quote).join(' → ')}`,
      `Matching retained requests: ${count}${states ? ` (${states})` : ''}.`,
      `Coverage: ${coverage.join(' ')}`,
      topologyCommand(root),
      'Follow the configured slots in the topology. Check the caller source to understand when it makes this call.',
    ].join('\n')
  }
  return h(CopyBrief, {
    revision: snapshot.revision,
    enabled,
    label: 'Copy route brief',
    name: 'route brief',
    ariaLabel: `Copy route brief for ${privateBrowserLiteral(slot)}`,
    unavailableId: 'route-brief-unavailable',
    text,
  })
}

// Serialize writes across both kinds of brief and across changes in selection.
let writing = false

function CopyBrief({
  revision,
  enabled,
  label,
  name,
  ariaLabel,
  unavailableId,
  showUnavailable,
  text,
}: {
  revision: number
  enabled: boolean
  label: string
  name: 'investigation brief' | 'route brief'
  ariaLabel?: string
  unavailableId: string
  showUnavailable?: boolean
  text: () => string
}) {
  const scope = useRef({ revision, enabled })
  const [result, setResult] = useState<{ scope: typeof scope.current; message: string }>()
  if (scope.current.revision !== revision || scope.current.enabled !== enabled)
    scope.current = { revision, enabled }

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
      await navigator.clipboard.writeText(text())
      message = name === 'route brief' ? 'Route brief copied.' : 'Investigation brief copied.'
    } catch {
      message = `Could not copy the ${name}.`
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
        'aria-label': ariaLabel,
        'aria-disabled': !enabled,
        'aria-describedby': enabled ? undefined : unavailableId,
        onClick: copy,
      },
      label,
    ),
    h(
      'span',
      { class: 'secondary' },
      h(
        'span',
        { role: 'status' },
        enabled && result?.scope === scope.current ? result.message : '',
      ),
      !enabled && showUnavailable
        ? h('span', { id: unavailableId }, 'Copy requires a current observation.')
        : null,
    ),
  )
}
