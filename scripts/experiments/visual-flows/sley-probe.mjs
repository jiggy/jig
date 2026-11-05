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
const observations = []
let handlerCalls = 0
let elementIdByName

function observedNode(name, handler) {
  return node((context) => {
    handlerCalls += 1
    observations.push({
      index: observations.length + 1,
      nodeId: elementIdByName.get(name),
      kind: 'handler-enter',
      label: name,
    })
    handler(context)
  }, { name })
}

const choose = observedNode('Choose route', (context) => {
  context.emit(context.state.reject ? 'reject' : 'draft')
})
const draft = observedNode('Draft', (context) => {
  context.state.attempts += 1
  context.emit('check')
})
const check = observedNode('Check', (context) => {
  if (context.state.attempts >= context.state.acceptAfter) context.emit('accepted')
  else if (context.state.attempts >= context.state.limit) context.emit('exhausted')
  else context.emit('revise')
})
const publish = observedNode('Publish result', (context) => {
  context.end({ outcome: 'done', attempts: context.state.attempts })
})
const refuse = observedNode('Request review', (context) => {
  context.end({ outcome: 'needs-review', attempts: context.state.attempts })
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
elementIdByName = new Map(description.elements.map((element) => [element.name, `sley:element:${element.element_id}`]))
assert.equal(elementIdByName.size, description.elements.length, 'this probe uses unique names to identify instrumented handlers')
const named = Object.fromEntries(description.elements.map((element) => [element.name, element]))
assert.deepEqual(named.Check.links, [{ action: 'revise', target_element_id: named.Draft.element_id }])
assert.deepEqual(description.scopes.find((scope) => scope.name === 'Draft / check loop').exits, ['accepted', 'exhausted'])
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
      assert.ok(!membership.has(id) || membership.get(id) === scope.scope_id, 'compiled placements have one owning scope')
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
    return {
      id: elementId(element.element_id),
      label: element.name,
      kind: element.kind,
      scopeId: membership.has(element.element_id) ? scopeId(membership.get(element.element_id)) : null,
      ...(element.kind === 'flow'
        ? { ownedScopeId: scopeId(element.owned_scope_id), declaredExits: scope.exits, concurrency: scope.concurrency, maxActivations: scope.max_activations }
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
    ...description.elements.flatMap((element) => element.links.map((link, index) => ({
      id: `sley:link:${element.element_id}:${index}`,
      source: elementId(element.element_id),
      target: elementId(link.target_element_id),
      action: link.action,
      label: link.action ?? 'unlabelled',
      meaning: 'declared-link',
    }))),
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
  { id: 'accepted-after-revision', label: 'Accepted after revision', input: { reject: false, attempts: 0, acceptAfter: 2, limit: 3 }, expected: ['Choose route', 'Draft', 'Check', 'Draft', 'Check', 'Publish result'], outcome: 'done' },
  { id: 'exhausted', label: 'Attempts exhausted', input: { reject: false, attempts: 0, acceptAfter: 5, limit: 2 }, expected: ['Choose route', 'Draft', 'Check', 'Draft', 'Check', 'Request review'], outcome: 'needs-review' },
  { id: 'rejected-before-drafting', label: 'Rejected before drafting', input: { reject: true, attempts: 0, acceptAfter: 1, limit: 2 }, expected: ['Choose route', 'Request review'], outcome: 'needs-review' },
]
const runs = []
for (const scenario of scenarios) {
  observations.length = 0
  const result = await compiled.start(scenario.input).result()
  assert.equal(result.status, 'completed')
  assert.deepEqual(observations.map((entry) => entry.label), scenario.expected)
  assert.equal(result.terminals[0].output.outcome, scenario.outcome)
  assert.equal(scenario.input.attempts, 0)
  const nodeCounts = Object.fromEntries(graph.nodes.filter((node) => node.kind === 'node').map((node) => [node.id, 0]))
  for (const entry of observations) nodeCounts[entry.nodeId] += 1
  runs.push({
    id: scenario.id,
    label: scenario.label,
    input: scenario.input,
    status: result.status,
    outcome: result.terminals[0].output.outcome,
    nodeCounts,
    observations: [...observations],
    transitionEvidence: 'unavailable',
    result,
  })
}
assert.deepEqual(compiled.describe(), description)

const data = {
  title: 'Sley: inspectable runtime topology',
  layer: 'runtime-topology',
  entry: 'sley:element:1',
  ...graph,
  runs,
  warnings: [
    { code: 'DECLARED_TOPOLOGY_ONLY', message: 'Declared links and scope exits do not prove which paths are feasible for a particular input.' },
    { code: 'CALLBACKS_OMITTED', message: 'describe() omits callbacks, recovery policies, and per-node emitted actions. Accepted/exhausted remain scope exits; no emitter edge was inferred.' },
    { code: 'NO_TRANSITION_TRACE', message: 'Sley has no public transition event API. Counts and ordered handler entries come from this probe. No edge traversal was inferred from adjacent observations.' },
    { code: 'NOT_FLOW_HOST_EVIDENCE', message: 'These are local Sley executions. They do not demonstrate FLOW invocation, Jig host execution, or mapping between Sley actions and FLOW outcomes.' },
  ],
  provenance: {
    producer: 'sley-probe.mjs',
    api: '@jigging/sley: Flow.compile().describe(), CompiledFlow.start().result()',
    descriptionSchemaVersion: 1,
    observationMethod: 'All five probe handlers record their own entry. Unique names map those handlers to one compiled snapshot. Observation indices are not runtime activation IDs.',
    originalVerification: {
      repository: 'https://github.com/jiggy/sley',
      commit: 'dc3600ae6c0c0bcab9ceb11b761026f8b1b28c4a',
      sourceVersion: '0.0.3',
      method: 'Unchanged upstream source built with Node type stripping; source-qualified, not npm artifact qualification.',
    },
    currentExecution: { node: process.version, dependency: 'Caller-supplied @jigging/sley. This script does not certify its installed version or artifact.' },
    checks: { handlersDuringInspection: 0, scenariosPassed: runs.length, descriptionDetached: true, descriptionStableAcrossRuns: true },
  },
}

await mkdir(outputDirectory, { recursive: true })
await writeFile(resolve(outputDirectory, 'sley-example.json'), `${JSON.stringify(data, null, 2)}\n`)
await writeFile(resolve(outputDirectory, 'sley-description.json'), `${JSON.stringify(description, null, 2)}\n`)
console.log(JSON.stringify({ outputDirectory, elements: graph.nodes.length, scopes: graph.scopes.length, declaredLinks: 6, scopeEntries: 2, handlersDuringInspection: 0, scenariosPassed: runs.length }, null, 2))
