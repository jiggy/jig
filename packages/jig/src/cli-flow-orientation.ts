import { record } from './internal/flow-inspection-scope.js'
import { PRIVATE_FLOW_CONTEXT_LIMITS } from './internal/inspection-policy.js'
import { canonicalJson, type JsonValue } from './json.js'

interface ConfiguredTarget {
  readonly id: string
  readonly implementation: string
  readonly settings: JsonValue
}

export interface ConfiguredConnection {
  readonly from: string
  readonly slot: string
  readonly to: string
  readonly resource?: boolean
  readonly sites?: ReadonlySet<string> | undefined
}

function sourceLabel(edge: ConfiguredConnection, text: (value: string) => string): string {
  const sites = [...(edge.sites ?? [])]
  if (!sites.length) return ''
  return (
    ' · ' +
    sites.slice(0, 2).map(text).join(', ') +
    (sites.length > 2 ? ` +${sites.length - 2}` : '')
  )
}

function configuredCallers(connections: readonly ConfiguredConnection[]) {
  const incoming = new Map<string, ConfiguredConnection[]>()
  for (const connection of connections) {
    if (connection.resource) continue
    const callers = incoming.get(connection.to) ?? []
    callers.push(connection)
    incoming.set(connection.to, callers)
  }
  return incoming
}

export function renderFlowPackageUses(
  packagePath: string,
  targets: readonly ConfiguredTarget[],
  connections: readonly ConfiguredConnection[],
  text: (value: string) => string,
): string[] {
  const lines = ['## ' + text(packagePath), '']
  const uses = targets.filter((target) => target.implementation === packagePath)
  if (!uses.length) return [...lines, 'No configured uses.', '']
  const incoming = configuredCallers(connections)
  const settings = uses.map((target) => record(target.settings))
  const different = settings.length === 1 ? Object.keys(settings[0]!) : differingKeys(settings)
  for (const [index, use] of uses.entries()) {
    lines.push('### ' + text(use.id), '')
    if (different.length)
      lines.push(
        (uses.length === 1 ? 'Settings: ' : 'Settings that differ: ') +
          settingsText(settings[index]!, different, 512, text) +
          '.',
        '',
      )
    const callers = incoming.get(use.id) ?? []
    if (!callers.length) lines.push('No configured callers.')
    else
      for (const caller of callers)
        lines.push('- ' + text(caller.from) + ' · ' + text(caller.slot) + sourceLabel(caller, text))
    lines.push('')
  }
  return lines
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
  const incoming = configuredCallers(connections)
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
      (edge) => callerLabel(edge) + sourceLabel(edge, text),
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
      sourceLabel(edge, text),
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
  const differences = differingKeys([original, changes])
  if (!differences.length) return ''
  return (
    ' · settings differ: ' +
    settingsText(changes, differences, PRIVATE_FLOW_CONTEXT_LIMITS.inlineValueBytes, text)
  )
}

function differingKeys(settings: readonly Record<string, JsonValue>[]): string[] {
  const keys = [...new Set(settings.flatMap(Object.keys))].sort()
  const baseline = settings[0]!
  return keys.filter((key) => {
    const reference = Object.hasOwn(baseline, key)
      ? Buffer.from(canonicalJson(baseline[key]!))
      : undefined
    return settings
      .slice(1)
      .some((row) =>
        Object.hasOwn(row, key)
          ? reference === undefined || !reference.equals(canonicalJson(row[key]!))
          : reference !== undefined,
      )
  })
}

function settingsText(
  settings: Record<string, JsonValue>,
  keys: readonly string[],
  limit: number,
  text: (value: string) => string,
): string {
  const message = keys
    .map(
      (key) =>
        key + ' = ' + (Object.hasOwn(settings, key) ? JSON.stringify(settings[key]) : 'unset'),
    )
    .join(', ')
  return Buffer.byteLength(message) > limit ? 'see --json' : text(message)
}
