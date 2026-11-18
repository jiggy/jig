import { record } from './internal/flow-inspection-scope.js'
import { PRIVATE_FLOW_CONTEXT_LIMITS } from './internal/inspection-policy.js'
import { canonicalJson, type JsonValue } from './json.js'

interface ConfiguredTarget {
  readonly id: string
  readonly implementation: string
  readonly settings: JsonValue
}

interface ConfiguredConnection {
  readonly from: string
  readonly slot: string
  readonly to: string
  readonly resource?: boolean
  readonly sites?: ReadonlySet<string> | undefined
}

/** Lead with facts that help a reader find the owner and other uses of a handoff. */
export function renderFlowOrientation(
  targets: readonly ConfiguredTarget[],
  connections: readonly ConfiguredConnection[],
  focus: string | undefined,
  options: {
    readonly text: (value: string) => string
    readonly target?: (id: string) => string
    readonly includeCallers: boolean
  },
): string[] {
  const selected = targets.find((target) => target.id === focus)
  if (!selected) return []
  const { text } = options
  const targetLabel = options.target ?? text
  const incoming = new Map<string, ConfiguredConnection[]>()
  for (const connection of connections) {
    if (connection.resource) continue
    const callers = incoming.get(connection.to) ?? []
    callers.push(connection)
    incoming.set(connection.to, callers)
  }
  const sourceLabel = (edge: ConfiguredConnection) => {
    const sites = [...(edge.sites ?? [])]
    if (!sites.length) return ''
    return (
      ' · ' +
      sites.slice(0, 2).map(text).join(', ') +
      (sites.length > 2 ? ` +${sites.length - 2}` : '')
    )
  }
  const callerLabel = (edge: ConfiguredConnection) =>
    targetLabel(edge.from) + ' · ' + text(edge.slot)
  const appendList = <T>(heading: string, items: readonly T[], label: (item: T) => string) => {
    if (!items.length) return
    lines.push('**' + heading + '**', '')
    for (const item of items.slice(0, 8)) lines.push('- ' + label(item))
    if (items.length > 8) lines.push(`- ${items.length - 8} more in the full topology.`)
    lines.push('')
  }

  const lines = [targetLabel(selected.id) + ' uses ' + text(selected.implementation) + '.', '']
  if (options.includeCallers) {
    appendList(
      'Configured callers',
      incoming.get(selected.id) ?? [],
      (edge) => callerLabel(edge) + sourceLabel(edge),
    )
    appendList(
      'Other configured uses of ' + text(selected.implementation),
      targets.filter(
        (target) => target.id !== selected.id && target.implementation === selected.implementation,
      ),
      (target) => {
        const callers = incoming.get(target.id) ?? []
        const via = callers.slice(0, 3).map(callerLabel).join(', ')
        const settings = settingsDifference(selected.settings, target.settings, text)
        return (
          targetLabel(target.id) +
          (via ? ' · called by ' + via : '') +
          (callers.length > 3 ? ` and ${callers.length - 3} more` : '') +
          settings
        )
      },
    )
  }
  appendList(
    'Configured handoffs',
    connections.filter((edge) => edge.from === selected.id),
    (edge) =>
      text(edge.slot) +
      ' → ' +
      (edge.resource ? text(edge.to) : targetLabel(edge.to)) +
      sourceLabel(edge),
  )
  return lines
}

function settingsDifference(
  focus: JsonValue,
  alternative: JsonValue,
  text: (value: string) => string,
): string {
  const original = record(focus)
  const changes = record(alternative)
  const keys = [...new Set([...Object.keys(original), ...Object.keys(changes)])].sort()
  const differences = keys.filter((key) => {
    if (!Object.hasOwn(original, key) || !Object.hasOwn(changes, key)) return true
    return !Buffer.from(canonicalJson(original[key]!)).equals(canonicalJson(changes[key]!))
  })
  if (!differences.length) return ''
  const message = differences
    .map(
      (key) => key + ' = ' + (Object.hasOwn(changes, key) ? JSON.stringify(changes[key]) : 'unset'),
    )
    .join(', ')
  return (
    ' · settings differ: ' +
    (Buffer.byteLength(message) > PRIVATE_FLOW_CONTEXT_LIMITS.inlineValueBytes
      ? 'see topology'
      : text(message))
  )
}
