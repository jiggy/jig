/**
 * Inspect and exercise Sley through its ordinary public package import.
 * Usage: node sley-probe.mjs OUTPUT_DIRECTORY
 * The caller supplies the @jigging/sley dependency.
 *
 * Original experiment: unchanged Sley 0.0.3 source, commit
 * dc3600ae6c0c0bcab9ceb11b761026f8b1b28c4a, built with Node 24.22.1
 * type stripping. This is source-qualified evidence, not npm artifact
 * qualification. A later run uses the dependency installed by its caller.
 *
 * describe() omits callbacks and per-node emitted actions. Scope exit names
 * are preserved as scope metadata; this probe invents no emitter edges.
 * Handler observations below are probe instrumentation, not a Sley event API.
 * State, condition, action and terminal records describe these authored handlers;
 * they do not add runtime transition events or recover omitted graph edges.
 */
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { Flow, node } from '@jigging/sley'

const args = process.argv.slice(2)
if (args.length !== 1) {
  console.error('Usage: node sley-probe.mjs OUTPUT_DIRECTORY')
  process.exit(2)
}
const outputDirectory = resolve(args[0])
const sourcePath = 'scripts/experiments/visual-flows/sley-probe.mjs'
const authoredDescriptions = new Map([
  [
    'Review pipeline',
    {
      symbol: 'compiled',
      description: 'Runs the local decision example and returns a done or needs-review value.',
    },
  ],
  [
    'Choose route',
    {
      symbol: 'choose',
      description:
        'Reads the reject flag and emits reject or draft without changing the probe state.',
    },
  ],
  [
    'Draft / check loop',
    {
      symbol: 'improvement',
      description: 'Groups Draft and Check with declared accepted and exhausted scope exits.',
    },
  ],
  ['Draft', { symbol: 'draft', description: 'Increments the attempt count and emits check.' }],
  [
    'Check',
    {
      symbol: 'check',
      description:
        'Checks the acceptance threshold first. If acceptance is false, checks the attempt limit before emitting exhausted or revise.',
    },
  ],
  [
    'Publish result',
    {
      symbol: 'publish',
      description:
        'Returns the done value and attempt count locally. It performs no external publication.',
    },
  ],
  [
    'Request review',
    {
      symbol: 'refuse',
      description: 'Returns the needs-review value and attempt count from this local example.',
    },
  ],
])
const observations = []
let handlerCalls = 0
let elementIdByName

// These four scalar values are the complete state of this authored fixture.
// Copy them now; retaining the mutable runtime state would rewrite earlier evidence.
function snapshotState(state) {
  return Object.freeze({
    reject: state.reject,
    attempts: state.attempts,
    acceptAfter: state.acceptAfter,
    limit: state.limit,
  })
}

function observedNode(name, handler) {
  const authored = authoredDescriptions.get(name)
  assert.ok(authored)
  return node(
    (context) => {
      handlerCalls += 1
      const index = observations.length + 1
      const observation = {
        index,
        occurrenceId: `occurrence:${index}`,
        nodeId: elementIdByName.get(name),
        kind: 'handler-enter',
        label: name,
        before: snapshotState(context.state),
        conditions: [],
        source: { path: sourcePath, symbol: authored.symbol },
      }
      observations.push(observation)
      handler(context, observation)
      observation.after = snapshotState(context.state)
    },
    { name },
  )
}

const choose = observedNode('Choose route', (context, observation) => {
  const reject = context.state.reject
  observation.conditions.push({
    id: 'route.reject',
    label: 'Input rejects drafting',
    expression: 'state.reject',
    values: { reject },
    result: reject,
  })
  const action = reject ? 'reject' : 'draft'
  context.emit(action)
  observation.action = action
})
const draft = observedNode('Draft', (context, observation) => {
  context.state.attempts += 1
  context.emit('check')
  observation.action = 'check'
})
const check = observedNode('Check', (context, observation) => {
  const attempts = context.state.attempts
  const acceptAfter = context.state.acceptAfter
  const accepted = attempts >= acceptAfter
  observation.conditions.push({
    id: 'check.acceptance',
    label: 'Acceptance threshold reached',
    expression: 'state.attempts >= state.acceptAfter',
    values: { attempts, acceptAfter },
    result: accepted,
  })
  let action
  if (accepted) action = 'accepted'
  else {
    const limit = context.state.limit
    const exhausted = attempts >= limit
    observation.conditions.push({
      id: 'check.limit',
      label: 'Attempt limit reached',
      expression: 'state.attempts >= state.limit',
      values: { attempts, limit },
      result: exhausted,
    })
    action = exhausted ? 'exhausted' : 'revise'
  }
  context.emit(action)
  observation.action = action
})
const publish = observedNode('Publish result', (context, observation) => {
  const terminal = { outcome: 'done', attempts: context.state.attempts }
  context.end(terminal)
  observation.terminal = { ...terminal }
})
const refuse = observedNode('Request review', (context, observation) => {
  const terminal = { outcome: 'needs-review', attempts: context.state.attempts }
  context.end(terminal)
  observation.terminal = { ...terminal }
})

draft.link(check, 'check')
check.link(draft, 'revise')
const improvement = new Flow(draft, {
  name: 'Draft / check loop',
  exits: ['accepted', 'exhausted'],
  maxActivations: 8,
})
choose.link(improvement, 'draft')
choose.link(refuse, 'reject')
improvement.link(publish, 'accepted')
improvement.link(refuse, 'exhausted')
const compiled = new Flow(choose, {
  name: 'Review pipeline',
  maxActivations: 12,
}).compile()
const description = compiled.describe()

assert.equal(handlerCalls, 0, 'inspection must not execute handlers')
assert.equal(description.schema_version, 1)
assert.equal(description.scopes.length, 2)
assert.equal(description.elements.length, 7)
elementIdByName = new Map(
  description.elements.map((element) => [element.name, `sley:element:${element.element_id}`]),
)
assert.equal(
  elementIdByName.size,
  description.elements.length,
  'this probe uses unique names to identify instrumented handlers',
)
const named = Object.fromEntries(description.elements.map((element) => [element.name, element]))
assert.deepEqual(named.Check.links, [
  { action: 'revise', target_element_id: named.Draft.element_id },
])
assert.deepEqual(description.scopes.find((scope) => scope.name === 'Draft / check loop').exits, [
  'accepted',
  'exhausted',
])
const detached = compiled.describe()
detached.elements[0].name = 'Changed viewer copy'
assert.equal(compiled.describe().elements[0].name, 'Review pipeline')

function normalize(description) {
  const elementId = (id) => `sley:element:${id}`
  const scopeId = (id) => `sley:scope:${id}`
  const elements = new Map(description.elements.map((element) => [element.element_id, element]))
  const scopes = new Map(description.scopes.map((scope) => [scope.scope_id, scope]))
  const membership = new Map()
  for (const scope of description.scopes) {
    const pending = [scope.entry_element_id]
    const visited = new Set()
    while (pending.length > 0) {
      const id = pending.pop()
      if (visited.has(id)) continue
      visited.add(id)
      assert.ok(
        !membership.has(id) || membership.get(id) === scope.scope_id,
        'compiled placements have one owning scope',
      )
      membership.set(id, scope.scope_id)
      const element = elements.get(id)
      assert.ok(element, 'link target must name an element')
      // A nested Flow's outward links belong to its containing scope.
      // Its internal entry is visited separately via owned_scope_id.
      pending.push(...element.links.map((link) => link.target_element_id))
    }
  }
  const nodes = description.elements.map((element) => {
    const scope = scopes.get(element.owned_scope_id)
    const authored = authoredDescriptions.get(element.name)
    assert.ok(authored, 'every probe element has an explicitly authored description')
    return {
      id: elementId(element.element_id),
      label: element.name,
      kind: element.kind,
      description: authored.description,
      descriptionSource: 'probe-authored',
      source: { path: sourcePath, symbol: authored.symbol },
      scopeId: membership.has(element.element_id)
        ? scopeId(membership.get(element.element_id))
        : null,
      ...(element.kind === 'flow'
        ? {
            ownedScopeId: scopeId(element.owned_scope_id),
            declaredExits: scope.exits,
            concurrency: scope.concurrency,
            maxActivations: scope.max_activations,
          }
        : { maxAttempts: element.max_attempts }),
    }
  })
  const edges = [
    ...description.scopes.map((scope) => ({
      id: `sley:entry:${scope.scope_id}`,
      source: elementId(scope.owner_element_id),
      target: elementId(scope.entry_element_id),
      action: null,
      label: 'entry',
      meaning: 'scope-entry',
    })),
    ...description.elements.flatMap((element) =>
      element.links.map((link, index) => ({
        id: `sley:link:${element.element_id}:${index}`,
        source: elementId(element.element_id),
        target: elementId(link.target_element_id),
        action: link.action,
        label: link.action ?? 'unlabelled',
        meaning: 'declared-link',
      })),
    ),
  ]
  assert.equal(edges.filter((edge) => edge.meaning === 'declared-link').length, 6)
  assert.equal(edges.filter((edge) => edge.meaning === 'scope-entry').length, 2)
  return {
    nodes,
    edges,
    scopes: description.scopes.map((scope) => ({
      id: scopeId(scope.scope_id),
      label: scope.name,
      owner: elementId(scope.owner_element_id),
      parent: scope.parent_scope_id === null ? null : scopeId(scope.parent_scope_id),
      entry: elementId(scope.entry_element_id),
      declaredExits: scope.exits,
      concurrency: scope.concurrency,
      maxActivations: scope.max_activations,
    })),
  }
}

const graph = normalize(description)
const scenarios = [
  {
    id: 'accepted-after-revision',
    label: 'Accepted after revision',
    input: snapshotState({ reject: false, attempts: 0, acceptAfter: 2, limit: 3 }),
    expected: ['Choose route', 'Draft', 'Check', 'Draft', 'Check', 'Publish result'],
    actions: ['draft', 'check', 'revise', 'check', 'accepted', null],
    states: [
      [0, 0],
      [0, 1],
      [1, 1],
      [1, 2],
      [2, 2],
      [2, 2],
    ],
    checks: [[false, false], [true]],
    outcome: 'done',
    attempts: 2,
  },
  {
    id: 'exhausted',
    label: 'Attempts exhausted',
    input: snapshotState({ reject: false, attempts: 0, acceptAfter: 5, limit: 2 }),
    expected: ['Choose route', 'Draft', 'Check', 'Draft', 'Check', 'Request review'],
    actions: ['draft', 'check', 'revise', 'check', 'exhausted', null],
    states: [
      [0, 0],
      [0, 1],
      [1, 1],
      [1, 2],
      [2, 2],
      [2, 2],
    ],
    checks: [
      [false, false],
      [false, true],
    ],
    outcome: 'needs-review',
    attempts: 2,
  },
  {
    id: 'rejected-before-drafting',
    label: 'Rejected before drafting',
    input: snapshotState({ reject: true, attempts: 0, acceptAfter: 1, limit: 2 }),
    expected: ['Choose route', 'Request review'],
    actions: ['reject', null],
    states: [
      [0, 0],
      [0, 0],
    ],
    checks: [],
    outcome: 'needs-review',
    attempts: 0,
  },
  {
    id: 'accepted-first-attempt',
    label: 'Accepted on first attempt',
    input: snapshotState({ reject: false, attempts: 0, acceptAfter: 1, limit: 3 }),
    expected: ['Choose route', 'Draft', 'Check', 'Publish result'],
    actions: ['draft', 'check', 'accepted', null],
    states: [
      [0, 0],
      [0, 1],
      [1, 1],
      [1, 1],
    ],
    checks: [[true]],
    outcome: 'done',
    attempts: 1,
  },
  {
    id: 'accepted-at-limit',
    label: 'Accepted at the attempt limit',
    input: snapshotState({ reject: false, attempts: 0, acceptAfter: 2, limit: 2 }),
    expected: ['Choose route', 'Draft', 'Check', 'Draft', 'Check', 'Publish result'],
    actions: ['draft', 'check', 'revise', 'check', 'accepted', null],
    states: [
      [0, 0],
      [0, 1],
      [1, 1],
      [1, 2],
      [2, 2],
      [2, 2],
    ],
    checks: [[false, false], [true]],
    outcome: 'done',
    attempts: 2,
  },
]

function summarizeRun(result, entries) {
  const terminal = result.terminals[0].output
  const returned = `Returned ${terminal.outcome} after ${terminal.attempts} draft attempt${terminal.attempts === 1 ? '' : 's'}.`
  const decision = entries.findLast(
    (entry) =>
      entry.action === 'accepted' || entry.action === 'exhausted' || entry.action === 'reject',
  )
  const recorded = new Map(decision.conditions.map((condition) => [condition.id, condition.result]))
  if (decision.action === 'reject')
    return `${returned} The reject condition was ${recorded.get('route.reject')}.`
  if (decision.action === 'exhausted')
    return `${returned} At attempt ${decision.before.attempts}, acceptance was ${recorded.get('check.acceptance')} and the limit condition was ${recorded.get('check.limit')}.`
  assert.equal(recorded.get('check.acceptance'), true)
  assert.equal(recorded.has('check.limit'), false)
  return `${returned} Acceptance passed at attempt ${decision.before.attempts} (limit ${decision.before.limit}); no limit evaluation was recorded for that check.`
}

const runs = []
for (const scenario of scenarios) {
  observations.length = 0
  const initialInput = snapshotState(scenario.input)
  const result = await compiled.start(scenario.input).result()
  assert.equal(result.status, 'completed')
  assert.deepEqual(
    observations.map((entry) => entry.label),
    scenario.expected,
  )
  assert.equal(result.terminals.length, 1)
  assert.equal(result.terminals[0].hasOutput, true)
  assert.ok(Object.hasOwn(result.terminals[0], 'output'))
  const output = structuredClone(result.terminals[0].output)
  assert.deepEqual(output, { outcome: scenario.outcome, attempts: scenario.attempts })
  assert.notEqual(output, result.terminals[0].output)
  assert.deepEqual(result.state, { ...initialInput, attempts: scenario.attempts })
  assert.deepEqual(
    scenario.input,
    initialInput,
    'executing the graph must leave every input value unchanged',
  )
  assert.ok(Object.isFrozen(scenario.input))
  assert.deepEqual(
    observations.map((entry) => entry.action ?? null),
    scenario.actions,
  )
  assert.deepEqual(
    observations.map((entry) => [entry.before, entry.after]),
    scenario.states.map(([before, after]) => [
      { ...initialInput, attempts: before },
      { ...initialInput, attempts: after },
    ]),
    'earlier state snapshots must retain their values after later handler mutations',
  )
  const checks = observations.filter((entry) => entry.label === 'Check')
  assert.deepEqual(
    checks.map((entry) => entry.conditions.map((condition) => [condition.id, condition.result])),
    scenario.checks.map((values) =>
      values.map((result, index) => [index === 0 ? 'check.acceptance' : 'check.limit', result]),
    ),
    'only evaluated conditions appear, in their authored order',
  )
  for (const [index, entry] of observations.entries()) {
    assert.equal(entry.index, index + 1)
    assert.equal(entry.occurrenceId, `occurrence:${index + 1}`)
    assert.deepEqual(entry.source, graph.nodes.find((node) => node.id === entry.nodeId).source)
    assert.notEqual(entry.before, scenario.input)
    assert.notEqual(entry.after, scenario.input)
    assert.notEqual(entry.before, entry.after)
    assert.ok(Object.isFrozen(entry.before) && Object.isFrozen(entry.after))
    if (entry.label === 'Choose route') {
      assert.deepEqual(entry.conditions, [
        {
          id: 'route.reject',
          label: 'Input rejects drafting',
          expression: 'state.reject',
          values: { reject: initialInput.reject },
          result: initialInput.reject,
        },
      ])
    } else if (entry.label === 'Check') {
      for (const condition of entry.conditions) {
        assert.equal(typeof condition.result, 'boolean')
        assert.deepEqual(
          condition.values,
          condition.id === 'check.acceptance'
            ? { attempts: entry.before.attempts, acceptAfter: initialInput.acceptAfter }
            : { attempts: entry.before.attempts, limit: initialInput.limit },
        )
      }
      if (entry.action === 'accepted')
        assert.deepEqual(
          entry.conditions.map((condition) => condition.id),
          ['check.acceptance'],
        )
    } else assert.deepEqual(entry.conditions, [])
    const terminalHandler = entry.label === 'Publish result' || entry.label === 'Request review'
    assert.equal(Object.hasOwn(entry, 'terminal'), terminalHandler)
    assert.equal(Object.hasOwn(entry, 'action'), !terminalHandler)
    if (terminalHandler) assert.deepEqual(entry.terminal, output)
  }
  assert.throws(() => {
    observations[0].before.attempts = -1
  }, TypeError)
  assert.throws(() => {
    observations.at(-1).after.attempts = -1
  }, TypeError)
  assert.deepEqual(observations[0].before, initialInput)
  assert.equal(observations.at(-1).after.attempts, scenario.attempts)
  const nodeCounts = Object.fromEntries(
    graph.nodes.filter((node) => node.kind === 'node').map((node) => [node.id, 0]),
  )
  for (const entry of observations) nodeCounts[entry.nodeId] += 1
  runs.push({
    id: scenario.id,
    label: scenario.label,
    input: scenario.input,
    status: result.status,
    outcome: output.outcome,
    hasOutput: result.terminals[0].hasOutput,
    output,
    summary: summarizeRun(result, observations),
    nodeCounts,
    observations: [...observations],
    transitionEvidence: 'unavailable',
    result,
  })
}
const atLimit = runs.find((run) => run.id === 'accepted-at-limit')
const boundaryCheck = atLimit.observations.findLast((entry) => entry.label === 'Check')
assert.equal(boundaryCheck.before.attempts, 2)
assert.equal(boundaryCheck.before.acceptAfter, 2)
assert.equal(boundaryCheck.before.limit, 2)
assert.equal(boundaryCheck.action, 'accepted')
assert.deepEqual(
  boundaryCheck.conditions.map((condition) => [condition.id, condition.result]),
  [['check.acceptance', true]],
)
assert.equal(atLimit.nodeCounts[elementIdByName.get('Request review')], 0)
const rejected = runs.find((run) => run.id === 'rejected-before-drafting')
assert.equal(rejected.nodeCounts[elementIdByName.get('Draft')], 0)
assert.equal(rejected.nodeCounts[elementIdByName.get('Check')], 0)
assert.ok(
  rejected.observations.every((entry) =>
    entry.conditions.every((condition) => condition.id === 'route.reject'),
  ),
)
assert.equal(
  handlerCalls,
  runs.reduce((count, run) => count + run.observations.length, 0),
)
assert.deepEqual(compiled.describe(), description)

const data = {
  title: 'Sley: inspectable runtime topology',
  layer: 'runtime-topology',
  entry: 'sley:element:1',
  ...graph,
  runs,
  warnings: [
    {
      code: 'DECLARED_TOPOLOGY_ONLY',
      message:
        'Declared links and scope exits do not prove which paths are feasible for a particular input.',
    },
    {
      code: 'CALLBACKS_OMITTED',
      message:
        'describe() omits callbacks, recovery policies, and per-node emitted actions. Accepted/exhausted remain scope exits; no emitter edge was inferred.',
    },
    {
      code: 'NO_TRANSITION_TRACE',
      message:
        'Sley has no public transition event API. Handler entries, state snapshots, evaluated conditions, emitted actions and terminal requests come from this probe instrumentation. No edge traversal was inferred.',
    },
    {
      code: 'NOT_FLOW_HOST_EVIDENCE',
      message:
        'These are local Sley executions. They do not demonstrate FLOW invocation, Jig host execution, or mapping between Sley actions and FLOW outcomes.',
    },
  ],
  provenance: {
    producer: 'sley-probe.mjs',
    api: '@jigging/sley: Flow.compile().describe(), CompiledFlow.start().result()',
    descriptionSchemaVersion: 1,
    observationMethod:
      'All five probe handlers record their own entry, detached before/after state, evaluated conditions and successful emit/end calls. Only conditions actually evaluated are recorded. Unique names map handlers to one compiled snapshot. Indices and occurrence IDs are local to each run, not runtime activation IDs. These records do not establish runtime transitions or external effects.',
    originalVerification: {
      repository: 'https://github.com/jiggy/sley',
      commit: 'dc3600ae6c0c0bcab9ceb11b761026f8b1b28c4a',
      sourceVersion: '0.0.3',
      method:
        'Unchanged upstream source built with Node type stripping; source-qualified, not npm artifact qualification.',
    },
    currentExecution: {
      node: process.version,
      dependency:
        'Caller-supplied @jigging/sley. This script does not certify its installed version or artifact.',
    },
    checks: {
      handlersDuringInspection: 0,
      scenariosPassed: runs.length,
      descriptionDetached: true,
      descriptionStableAcrossRuns: true,
      inputUnchanged: true,
      snapshotsDetachedAndFrozen: true,
      acceptanceAtLimitVerified: true,
      shortCircuitedConditionsAbsent: true,
    },
  },
}

await mkdir(outputDirectory, { recursive: true })
await writeFile(resolve(outputDirectory, 'sley-example.json'), `${JSON.stringify(data, null, 2)}\n`)
await writeFile(
  resolve(outputDirectory, 'sley-description.json'),
  `${JSON.stringify(description, null, 2)}\n`,
)
console.log(
  JSON.stringify(
    {
      outputDirectory,
      elements: graph.nodes.length,
      scopes: graph.scopes.length,
      declaredLinks: 6,
      scopeEntries: 2,
      handlersDuringInspection: 0,
      scenariosPassed: runs.length,
    },
    null,
    2,
  ),
)
