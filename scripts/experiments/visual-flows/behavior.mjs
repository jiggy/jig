/** Pure presentation helpers for the experiment's already-redacted JSON evidence. */
export function valueChanges(before, after) {
  const changes = [],
    pending = [
      {
        before,
        after,
        beforePresent: before !== undefined,
        afterPresent: after !== undefined,
        path: '$',
        depth: 0,
      },
    ]
  let inspected = 0,
    truncated = false
  while (pending.length) {
    if (++inspected > 4096 || changes.length >= 128) {
      truncated = true
      break
    }
    const item = pending.pop(),
      a = item.before,
      b = item.after
    if (item.beforePresent === item.afterPresent && Object.is(a, b)) continue
    const objectA = a !== null && typeof a === 'object',
      objectB = b !== null && typeof b === 'object'
    if (
      item.beforePresent &&
      item.afterPresent &&
      objectA &&
      objectB &&
      Array.isArray(a) === Array.isArray(b)
    ) {
      if (item.depth >= 12) {
        truncated = true
        continue
      }
      const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()
      if (keys.length + pending.length > 4096) {
        truncated = true
        continue
      }
      for (let index = keys.length - 1; index >= 0; index--) {
        const key = keys[index]
        const member = Array.isArray(a)
          ? '[' + key + ']'
          : /^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(key)
            ? '.' + key
            : '[' + JSON.stringify(key) + ']'
        pending.push({
          before: a[key],
          after: b[key],
          beforePresent: Object.hasOwn(a, key),
          afterPresent: Object.hasOwn(b, key),
          path: item.path + member,
          depth: item.depth + 1,
        })
      }
      continue
    }
    changes.push({
      path: item.path,
      before: a,
      after: b,
      beforePresent: item.beforePresent,
      afterPresent: item.afterPresent,
    })
  }
  return { changes, truncated }
}

export function nodeOccurrences(graph, run, nodeId) {
  if (!graph?.nodes?.some((node) => node.id === nodeId)) return []
  return (run?.observations || []).filter(
    (observation) =>
      observation && typeof observation === 'object' && observation.nodeId === nodeId,
  )
}

export function caseComparison(graph, left, right) {
  const known = new Set(graph.nodes.map((node) => node.id))
  const leftEntries = left?.observations || [],
    rightEntries = right?.observations || []
  const identity = (entry) =>
    entry && typeof entry === 'object' && known.has(entry.nodeId) ? entry.nodeId : undefined
  const counts = (entries) => {
    const result = Object.create(null)
    for (const entry of entries) {
      const id = identity(entry)
      if (id !== undefined) result[id] = (result[id] || 0) + 1
    }
    return result
  }
  // These are handler-entry records, not a runtime transition stream.
  let commonPrefix = 0,
    decisionDifference = null
  while (commonPrefix < Math.min(leftEntries.length, rightEntries.length)) {
    const a = leftEntries[commonPrefix],
      b = rightEntries[commonPrefix],
      id = identity(a)
    if (id === undefined || id !== identity(b)) break
    const decision = (entry) => ({
      ...(Object.hasOwn(entry, 'conditions')
        ? {
            conditions: entry.conditions.map((condition) => ({
              id: condition.id,
              result: condition.result,
            })),
          }
        : {}),
      ...(Object.hasOwn(entry, 'action') ? { action: entry.action } : {}),
      ...(Object.hasOwn(entry, 'terminal') ? { terminal: entry.terminal } : {}),
    })
    const difference = valueChanges(decision(a), decision(b))
    if (!decisionDifference && (difference.changes.length || difference.truncated)) {
      decisionDifference = { position: commonPrefix + 1, left: a, right: b, changes: difference }
    }
    commonPrefix++
  }
  const a = leftEntries[commonPrefix] ?? null,
    b = rightEntries[commonPrefix] ?? null
  const firstDifference =
    a === null && b === null
      ? null
      : {
          position: commonPrefix + 1,
          left: a,
          right: b,
          reason:
            a === null
              ? 'left-ended'
              : b === null
                ? 'right-ended'
                : identity(a) === undefined || identity(b) === undefined
                  ? 'unattributed-observation'
                  : 'different-node',
        }
  // Runtime bookkeeping and status are not substitutes for a captured output value.
  const result = (run) => (run && Object.hasOwn(run, 'output') ? run.output : undefined)
  return {
    inputChanges: valueChanges(left?.input, right?.input),
    outputChanges: valueChanges(result(left), result(right)),
    commonPrefix,
    firstDifference,
    decisionDifference,
    leftVisits: counts(leftEntries),
    rightVisits: counts(rightEntries),
  }
}

export function evidenceGaps(graph, { nodeId, run } = {}) {
  const runtime =
    graph.layer === 'runtime-topology' ||
    graph.provenance?.semantics === 'declared-runtime-topology'
  const node = graph.nodes.find((item) => item.id === nodeId),
    gaps = []
  if (!runtime)
    gaps.push(
      'Configured calls do not establish execution order or the conditions inside a component.',
    )
  if (graph.provenance?.approval === 'not-verified')
    gaps.push('Local approval was not verified by this projection.')
  if (!run)
    gaps.push(
      'This view has no selected execution evidence. Available connections do not establish which calls occurred.',
    )
  else {
    if (runtime)
      gaps.push(
        'Highlights show recorded handler entries. The runtime transition stream was not captured.',
      )
    const entries = node
      ? nodeOccurrences(graph, run, node.id)
      : (run.observations || []).filter((entry) => entry && typeof entry === 'object')
    if (node && !entries.length)
      gaps.push(
        'No entry for this component was recorded in this case. That does not establish that it is unreachable.',
      )
    if (entries.some((entry) => !Object.hasOwn(entry, 'before') || !Object.hasOwn(entry, 'after')))
      gaps.push('Before and after values were not captured for every shown observation.')
    if (!entries.length || entries.some((entry) => !Array.isArray(entry.conditions)))
      gaps.push('Condition evaluations were not captured for every shown observation.')
    gaps.push(
      'An omitted condition is not a recorded false result. The case does not cover other inputs.',
    )
  }
  if (node?.kind === 'grant')
    gaps.push('A configured resource does not prove that an external effect occurred.')
  if (typeof node?.reason === 'string' && node.reason) gaps.push(node.reason)
  else if (node?.kind === 'unknown' || node?.kind === 'external')
    gaps.push('This snapshot does not resolve the implementation of this component.')
  if (runtime && (node?.declaredExits?.length || node?.exits?.length))
    gaps.push('Declared scope exits do not identify every handler that can emit them.')
  return gaps
}

export function investigationContext(item, { nodeId, runId, compareRunId, observationIndex } = {}) {
  const graph = item.graph,
    node = graph.nodes.find((entry) => entry.id === nodeId)
  const run = graph.runs?.find((entry) => entry.id === runId),
    other = graph.runs?.find((entry) => entry.id === compareRunId)
  const lines = ['Jig application investigation', 'Application: ' + item.title]
  const json = (value) => {
    const text = JSON.stringify(value, null, 2)
    if (text === undefined) return 'Not captured'
    return text.length > 6000 ? text.slice(0, 6000) + '\n[Value display truncated]' : text
  }
  const source = (entry) => {
    const location = entry?.location ?? entry?.source
    return location && typeof location === 'object'
      ? {
          path: location.path,
          line: location.line,
          column: location.column,
          symbol: location.symbol,
        }
      : undefined
  }
  if (item.revision) lines.push('Source revision label: ' + item.revision)
  const verification = graph.provenance?.originalVerification
  if (verification)
    lines.push(
      'Recorded runtime source verification: ' +
        json({
          repository: verification.repository,
          commit: verification.commit,
          sourceVersion: verification.sourceVersion,
          method: verification.method,
        }),
    )
  if (graph.provenance)
    lines.push(
      'Projection qualifiers: ' +
        json({
          source: graph.provenance.source,
          semantics: graph.provenance.semantics,
          approval: graph.provenance.approval,
          controlFlow: graph.provenance.controlFlow,
          completeness: graph.provenance.completeness,
        }),
    )
  if (graph.root ?? graph.entry ?? graph.provenance?.root)
    lines.push('Root: ' + (graph.root ?? graph.entry ?? graph.provenance.root))
  if (node) {
    lines.push(
      'Component: ' + (node.label ?? node.name ?? node.id),
      'Component identity: ' + node.id,
      'Kind: ' + node.kind,
    )
    if (node.packagePath) lines.push('Package: ' + node.packagePath)
    if (node.description) lines.push('Authored description: ' + node.description)
    if (node.descriptionSource) lines.push('Description provenance: ' + node.descriptionSource)
    if (source(node)) lines.push('Source: ' + json(source(node)))
    const routes = graph.edges
      .filter((edge) => (edge.source ?? edge.from) === node.id)
      .slice(0, 32)
      .map((edge) => ({
        target: edge.target ?? edge.to,
        label: edge.label ?? edge.slot ?? edge.action,
        meaning: edge.meaning,
      }))
    lines.push('Available relationships (not observed traversal): ' + json(routes))
  }
  if (run) {
    lines.push(
      'Recorded case: ' + (run.label ?? run.id),
      'Case identity: ' + run.id,
      'Input: ' + json(run.input),
    )
    lines.push(
      'Recorded result: ' +
        json({ status: run.status, outcome: run.outcome, output: run.output, result: run.result }),
    )
    const entries = node
      ? nodeOccurrences(graph, run, node.id)
      : (run.observations || []).filter((entry) => entry && typeof entry === 'object')
    const requested = observationIndex !== undefined && observationIndex !== null
    const selected = requested
      ? entries.find((entry) => entry.index === observationIndex)
      : undefined
    const shown = selected ? [selected] : requested ? [] : entries.slice(0, 8)
    if (requested && !selected)
      lines.push('The requested observation identity is not present in this component and case.')
    lines.push(
      'Recorded observations: ' +
        json(
          shown.map((entry) => ({
            index: entry.index,
            nodeId: entry.nodeId,
            kind: entry.kind,
            occurrenceId: entry.occurrenceId,
            before: entry.before,
            after: entry.after,
            conditions: entry.conditions,
            action: entry.action,
            terminal: entry.terminal,
            source: source(entry),
          })),
        ),
    )
    if (!selected && entries.length > shown.length)
      lines.push('Observation excerpt: ' + shown.length + ' of ' + entries.length + '.')
    if (other) {
      const comparison = caseComparison(graph, run, other)
      lines.push(
        'Comparison case: ' + (other.label ?? other.id),
        'Comparison input: ' + json(other.input),
      )
      lines.push(
        'Input changes: ' + json(comparison.inputChanges),
        'Output changes: ' + json(comparison.outputChanges),
      )
      const indexes = (difference) =>
        ' Retained indexes: ' +
        (difference.left?.index ?? 'unavailable') +
        ' / ' +
        (difference.right?.index ?? 'unavailable') +
        '.'
      if (comparison.decisionDifference)
        lines.push(
          'First difference in recorded decision evidence: record position ' +
            comparison.decisionDifference.position +
            '.' +
            indexes(comparison.decisionDifference),
        )
      if (comparison.firstDifference)
        lines.push(
          'First differing handler entry: record position ' +
            comparison.firstDifference.position +
            ' (' +
            comparison.firstDifference.reason +
            ').' +
            indexes(comparison.firstDifference),
        )
      lines.push(
        'A comparison describes these records. It does not establish which changed input caused a difference.',
      )
    }
  }
  const diagnostics = (graph.warnings || []).filter(
    (warning) => typeof warning === 'string' || !node || !warning.node || warning.node === node.id,
  )
  if (diagnostics.length)
    lines.push(
      'Relevant projection diagnostics: ' +
        json(
          diagnostics.slice(0, 8).map((warning) =>
            typeof warning === 'string'
              ? warning
              : {
                  code: warning.code,
                  message: warning.message,
                  node: warning.node,
                  slot: warning.slot,
                },
          ),
        ),
    )
  if (diagnostics.length > 8) lines.push('Diagnostic excerpt: 8 of ' + diagnostics.length + '.')
  lines.push('Evidence limits:', ...evidenceGaps(graph, { nodeId, run }).map((gap) => '- ' + gap))
  lines.push('Investigation request: [Describe the behavior you want to understand or change.]')
  const text = lines.join('\n\n')
  return text.length > 24000 ? text.slice(0, 23960) + '\n[Investigation context truncated]' : text
}
