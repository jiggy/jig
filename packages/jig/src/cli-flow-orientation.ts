import { cliShellWord } from './cli-discovery.js'
import { record } from './internal/flow-inspection-scope.js'
import { PRIVATE_FLOW_CONTEXT_LIMITS } from './internal/inspection-policy.js'
import { canonicalJson, type JsonValue } from './json.js'

interface ConfiguredTarget {
  readonly id: string
  readonly implementation: string
  readonly settings: JsonValue
  readonly declarationPath?: string
  readonly settingsSchemaPath?: string | null
  readonly slots?: ReadonlyMap<string, string>
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

const plainSelector = /^[A-Za-z0-9@._:/-]+$/

function targetInspectionCommand(id: string, approved = false): string | undefined {
  if (/[\p{Cc}\p{Cf}\u2028\u2029]/u.test(id)) return
  const operand = plainSelector.test(id) ? id : cliShellWord(id)
  return `jig inspect --flow${approved ? ' --approved' : ''} ${operand}`
}

export function renderFlowNavigationIndex(
  targets: readonly ConfiguredTarget[],
  connections: readonly ConfiguredConnection[],
  text: (value: string) => string,
): string[] {
  if (!targets.length) return ['No configured targets.', '']
  const outgoing = new Map<string, ConfiguredConnection[]>()
  for (const connection of connections) {
    const slots = outgoing.get(connection.from) ?? []
    slots.push(connection)
    outgoing.set(connection.from, slots)
  }
  const incoming = configuredCallers(connections)
  const packages = new Map<string, ConfiguredTarget[]>()
  for (const target of targets) {
    const uses = packages.get(target.implementation) ?? []
    uses.push(target)
    packages.set(target.implementation, uses)
  }
  const rank = (target: ConfiguredTarget) => {
    if (!outgoing.get(target.id)?.some((slot) => !slot.resource)) return 2
    return incoming.has(target.id) ? 1 : 0
  }
  const groups = [...packages].map(([name, uses]) => ({
    name,
    uses: uses.sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id)),
    rank: Math.min(...uses.map(rank)),
  }))
  groups.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name))
  const lines = [
    `${targets.length} configured targets across ${packages.size} packages. No declared entrypoint.`,
    '',
    'Find a caller or shared package below and run its target command. Slots show configured selections.',
    'Use `jig inspect --flow --all` for application behavior.',
    '',
    '| Package | Inspect a target | Configured slots |',
    '| --- | --- | --- |',
  ]
  for (const { name, uses } of groups) {
    for (const use of uses) {
      const command = targetInspectionCommand(use.id)
      const target =
        command === undefined
          ? text(use.id)
          : plainSelector.test(use.id)
            ? `\`${command}\``
            : text(command)
      const slots = outgoing.get(use.id)?.map((edge) => `${text(edge.slot)} → ${text(edge.to)}`)
      lines.push(`| ${text(name)} | ${target} | ${slots?.join(' · ') || '—'} |`)
    }
  }
  return [...lines, '']
}

export function renderFlowPackageUses(
  packagePath: string,
  targets: readonly ConfiguredTarget[],
  connections: readonly ConfiguredConnection[],
  text: (value: string) => string,
  approved = false,
): string[] {
  const lines = ['## ' + text(packagePath), '']
  const uses = targets.filter((target) => target.implementation === packagePath)
  if (!uses.length) return [...lines, 'No configured uses.', '']
  const incoming = configuredCallers(connections)
  const settings = uses.map((target) => record(target.settings))
  const different = settings.length === 1 ? Object.keys(settings[0]!) : differingKeys(settings)
  for (const [index, use] of uses.entries()) {
    lines.push('### ' + text(use.id), '')
    const command = targetInspectionCommand(use.id, approved)
    if (command !== undefined) lines.push('    ' + command, '')
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
    readonly declarationLink?: (path: string) => string
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
    const otherUses = targets.filter(
      (target) => target.id !== selected.id && target.implementation === selected.implementation,
    )
    const declaration =
      selected.declarationPath === undefined
        ? undefined
        : options.declarationLink?.(selected.declarationPath)
    if (declaration !== undefined) {
      const settings = record(selected.settings)
      const keys = otherUses.length
        ? differingKeys([settings, ...otherUses.map((target) => record(target.settings))])
        : Object.keys(settings).sort()
      lines.push(
        '**Binding declaration** · ' +
          declaration +
          (keys.length
            ? (otherUses.length ? ' · settings that differ: ' : ' · settings: ') +
              settingsText(settings, keys, PRIVATE_FLOW_CONTEXT_LIMITS.inlineValueBytes, text)
            : ''),
        '',
      )
    }
    const callers = incoming.get(selected.id) ?? []
    appendList('Configured callers', callers, (edge) => {
      const path = targets.find(({ id }) => id === edge.from)?.declarationPath
      const wiring = path === undefined ? undefined : options.declarationLink?.(path)
      return callerLabel(edge) + sourceLabel(edge, text) + (wiring ? ' · wiring ' + wiring : '')
    })
    if (declaration !== undefined && callers.length > 1)
      lines.push(
        'These caller slots share this Binding’s settings and child slot selections. To vary configuration for one caller slot, have it select a separate Binding of this Flow.',
        '',
      )
    appendList('Other configured uses of ' + text(selected.implementation), otherUses, (target) => {
      const callers = incoming.get(target.id) ?? []
      const via = callers.slice(0, 3).map(callerLabel).join(', ')
      const settings = settingsDifference(selected.settings, target.settings, text)
      const peerDeclaration =
        target.declarationPath === undefined
          ? undefined
          : options.declarationLink?.(target.declarationPath)
      return (
        targetLabel(target.id) +
        (via ? ' · called by ' + via : '') +
        (callers.length > 3 ? ` and ${callers.length - 3} more` : '') +
        settings +
        (declaration !== undefined && selected.slots && target.slots
          ? slotDifference(selected.slots, target.slots, text)
          : '') +
        (peerDeclaration ? (settings ? '' : ' · same settings') + ' · ' + peerDeclaration : '')
      )
    })
    if (
      options.declarationLink &&
      declaration &&
      selected.settingsSchemaPath !== undefined &&
      otherUses.some((use) => use.declarationPath !== undefined)
    ) {
      const schema = selected.settingsSchemaPath
      const schemaFact =
        schema === null
          ? 'This Flow has no settings schema. Declare the value in its `settings.schema.json` before setting it in the Binding.'
          : 'Settings schema · ' + options.declarationLink(schema) + '.'
      lines.push(
        '**Per-Binding behavior** · Set `settings` in the affected Binding and read the value in the shared Flow through `run.settings`. The invocation supplies `run.input` separately.',
        schemaFact,
        '',
      )
    }
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

function slotDifference(
  focus: ReadonlyMap<string, string>,
  alternative: ReadonlyMap<string, string>,
  text: (value: string) => string,
): string {
  const changed = [...new Set([...focus.keys(), ...alternative.keys()])]
    .filter((slot) => focus.get(slot) !== alternative.get(slot))
    .sort()
  if (!changed.length) return ' · same slot selections'
  const listed = changed.slice(0, 3).map(text).join(', ')
  return (
    ' · different slot selections: ' +
    listed +
    (changed.length > 3 ? ` +${changed.length - 3}` : '')
  )
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
