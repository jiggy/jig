import assert from 'node:assert/strict'
import test from 'node:test'
import { GRAPH_LIMITS, GraphInputError, projectGraph } from './lock-graph.mjs'

const DIGEST = `sha256:${'a'.repeat(64)}`
const pkg = (overrides = {}) => ({ digest: DIGEST, directRun: true, uses: {}, ...overrides })
const binding = (packagePath, slots = {}, extra = {}) => ({
  packagePath,
  settings: {},
  slots,
  ...extra,
})
const flow = (path) => ({ kind: 'flow', path })
const bound = (id) => ({ kind: 'binding', id })
const checkError = (code) => (error) => error instanceof GraphInputError && error.code === code

test('keeps distinct Bindings of one package and an unavailable direct identity', () => {
  const graph = projectGraph({
    packages: { 'flows/review': pkg({ directRun: false }), 'flows/check': pkg() },
    bindings: {
      strict: binding(
        'flows/review',
        { check: flow('flows/check') },
        { settings: { strict: true } },
      ),
      relaxed: binding(
        'flows/review',
        { check: flow('flows/check') },
        { settings: { strict: false } },
      ),
    },
  })
  assert.deepEqual(
    graph.nodes.map((node) => node.id),
    ['binding:relaxed', 'binding:strict', 'flow:flows/check', 'flow:flows/review'],
  )
  assert.equal(graph.nodes.find((node) => node.id === 'flow:flows/review').runnable, false)
  assert.deepEqual(graph.provenance.roots, [
    'binding:relaxed',
    'binding:strict',
    'flow:flows/check',
  ])
  assert.equal(graph.edges.length, 2)
  assert.equal(
    graph.edges.some((edge) => edge.source === 'flow:flows/review'),
    false,
  )
})

test('root view contains only reachable targets and scoped dependencies', () => {
  const graph = projectGraph(
    {
      packages: {
        'flows/parent': pkg({ directRun: false }),
        'flows/child': pkg(),
        'flows/unrelated': pkg(),
      },
      bindings: {
        parent: binding('flows/parent', { child: flow('flows/child') }),
        other: binding('flows/unrelated'),
      },
    },
    { root: 'binding:parent' },
  )
  assert.deepEqual(
    graph.nodes.map((node) => node.id),
    ['binding:parent', 'flow:flows/child'],
  )
  assert.deepEqual(graph.provenance.roots, ['binding:parent'])
  assert.equal(graph.provenance.root, 'binding:parent')
  assert.equal(graph.provenance.scope, 'root')
})

test('public npm selectors resolve retained dependency addresses without importing packages', () => {
  const lock = {
    packages: {
      'flows/parent': pkg({
        uses: { agent: {} },
        slots: { agent: flow('npm:@jigging/agent-acp') },
      }),
      'npm:@jigging/agent-acp': pkg(),
    },
    bindings: {},
  }
  const graph = projectGraph(lock, { root: 'npm:@jigging/agent-acp' })
  assert.deepEqual(
    graph.nodes.map((node) => node.id),
    ['flow:npm:@jigging/agent-acp'],
  )
  assert.equal(graph.provenance.root, 'flow:npm:@jigging/agent-acp')
  assert.equal(graph.provenance.rootSelector, 'npm:@jigging/agent-acp')
  assert.equal(
    projectGraph(lock, { root: 'flow:flows/parent' }).edges[0].target,
    'flow:npm:@jigging/agent-acp',
  )
  for (const root of [
    'flow:npm:@jigging/agent-acp',
    'npm:@jigging/agent-acp@1.0.0',
    'npm:@jigging/agent-acp/private',
  ]) {
    assert.throws(() => projectGraph(lock, { root }), checkError('MALFORMED_INPUT'))
  }
})

test('preserves separate slots to one target without inventing sequence', () => {
  const graph = projectGraph(
    {
      packages: { 'flows/parent': pkg(), 'flows/child': pkg() },
      bindings: {
        parent: binding('flows/parent', {
          first: flow('flows/child'),
          second: flow('flows/child'),
        }),
      },
    },
    { root: 'binding:parent' },
  )
  assert.equal(graph.edges.length, 2)
  assert.equal(new Set(graph.edges.map((edge) => edge.id)).size, 2)
  assert.deepEqual(
    graph.edges.map((edge) => edge.slot),
    ['first', 'second'],
  )
  assert.ok(
    graph.edges.every(
      (edge) => edge.source === 'binding:parent' && edge.target === 'flow:flows/child',
    ),
  )
  assert.ok(graph.edges.every((edge) => edge.meaning === 'may-invoke'))
  assert.equal(graph.provenance.controlFlow, 'not-analyzed')
})

test("direct Flow uses its resolved defaults instead of borrowing a Binding's routes", () => {
  const lock = {
    packages: {
      'flows/parent': pkg({ uses: { child: {} }, slots: { child: flow('flows/default') } }),
      'flows/default': pkg(),
      'flows/override': pkg(),
    },
    bindings: { configured: binding('flows/parent', { child: flow('flows/override') }) },
  }
  assert.equal(
    projectGraph(lock, { root: 'flow:flows/parent' }).edges[0].target,
    'flow:flows/default',
  )
  assert.equal(
    projectGraph(lock, { root: 'binding:configured' }).edges[0].target,
    'flow:flows/override',
  )
})

test('grant identities are caller-and-slot scoped; sensitive payloads never appear', () => {
  const secret = 'DO-NOT-EMIT-private-data'
  const grant = {
    kind: 'grant',
    name: 'shared-service',
    policy: {
      kind: 'http',
      url: `https://private.invalid/${secret}`,
      bearerEnv: secret,
      bodySchema: { const: secret },
    },
    evaluation: {
      recipe: secret,
      configuration: { compiler: secret },
      layout: { members: [secret] },
    },
  }
  const lock = {
    entrypoint: `binding:a --input '${secret}'`,
    agentOverride: 'codex',
    packages: { 'flows/request': pkg({ directRun: false }) },
    bindings: {
      a: binding(
        'flows/request',
        { service: grant, second: grant },
        {
          settings: { token: secret, nested: { secret } },
          attachments: { source: { source: secret, files: [{ path: secret }], digest: DIGEST } },
        },
      ),
      b: binding('flows/request', { service: grant }),
    },
  }
  const graph = projectGraph(lock)
  const grants = graph.nodes.filter((node) => node.kind === 'grant')
  assert.equal(grants.length, 3)
  assert.equal(new Set(grants.map((node) => node.id)).size, 3)
  assert.ok(
    grants.every((node) => node.grantKind === 'http' && node.grantName === 'shared-service'),
  )
  const encoded = JSON.stringify(graph)
  assert.equal(encoded.includes(secret), false)
  assert.equal(encoded.includes('private.invalid'), false)
  assert.equal(encoded.includes('bearerEnv'), false)
  assert.equal(encoded.includes('"policy"'), false)
  assert.equal(encoded.includes('"files"'), false)
  assert.equal(graph.provenance.approval, 'not-verified')
})

test('attachment route copies only safe port mappings and unwraps ordinary targets', () => {
  const mapping = {
    source: { from: 'input' },
    result: { create: true },
    context: { supplied: 'read' },
  }
  const graph = projectGraph(
    {
      packages: {
        'flows/parent': pkg({ directRun: false }),
        'flows/child': pkg({ directRun: false }),
      },
      bindings: {
        parent: binding('flows/parent', {
          child: { kind: 'route', target: bound('child'), attachments: mapping },
        }),
        child: binding('flows/child'),
      },
    },
    { root: 'binding:parent' },
  )
  assert.equal(graph.edges[0].target, 'binding:child')
  assert.deepEqual(graph.edges[0].attachments, mapping)
  graph.edges[0].attachments.source.from = 'changed'
  assert.equal(mapping.source.from, 'input')
})

test('unmapped declared requirements become unknown, including possible native checkpoints', () => {
  const graph = projectGraph(
    {
      packages: {
        'flows/parent': pkg({
          uses: {
            checkpoint: {
              id: 'https://jig.md/contracts/run-checkpoint',
              version: '0.0.1',
              digest: DIGEST,
            },
            child: {},
          },
        }),
      },
      bindings: {},
    },
    { root: 'flow:flows/parent' },
  )
  assert.equal(graph.nodes.filter((node) => node.kind === 'unknown').length, 2)
  assert.equal(graph.warnings.length, 2)
  assert.ok(graph.warnings.every((warning) => warning.code === 'UNMAPPED_USE'))
  assert.ok(graph.edges.every((edge) => edge.evidence === 'unmapped-use'))
  assert.equal(
    graph.nodes.some((node) => node.kind === 'grant'),
    false,
  )
})

test('an undeclared explicit Binding route is still visible', () => {
  const graph = projectGraph(
    {
      packages: { 'flows/parent': pkg(), 'flows/child': pkg() },
      bindings: { parent: binding('flows/parent', { child: flow('flows/child') }) },
    },
    { root: 'binding:parent' },
  )
  assert.equal(graph.edges.length, 1)
  assert.deepEqual(graph.warnings, [])
})

test('empty uses is valid; a missing required uses field fails', () => {
  assert.equal(projectGraph({ packages: { 'flows/leaf': pkg() }, bindings: {} }).edges.length, 0)
  const missing = pkg()
  delete missing.uses
  assert.throws(
    () => projectGraph({ packages: { 'flows/leaf': missing }, bindings: {} }),
    checkError('MALFORMED_INPUT'),
  )
})

test('missing referenced targets, missing packages, and unknown roots fail explicitly', () => {
  const base = { packages: { 'flows/parent': pkg() }, bindings: {} }
  assert.throws(() => projectGraph(base, { root: 'binding:missing' }), checkError('MISSING_TARGET'))
  assert.throws(
    () => projectGraph(base, { root: 'flow:flows/missing' }),
    checkError('MISSING_TARGET'),
  )
  for (const target of [flow('flows/missing'), bound('missing')]) {
    assert.throws(
      () =>
        projectGraph({ ...base, bindings: { parent: binding('flows/parent', { child: target }) } }),
      checkError('MISSING_TARGET'),
    )
  }
  assert.throws(
    () => projectGraph({ ...base, bindings: { bad: binding('flows/missing') } }),
    checkError('MISSING_TARGET'),
  )
})

test('directRun:false cannot be used as root or child, even when inventory already contains it', () => {
  const lock = {
    packages: { 'flows/parent': pkg(), 'flows/child': pkg({ directRun: false }) },
    bindings: { parent: binding('flows/parent', { child: flow('flows/child') }) },
  }
  assert.throws(() => projectGraph(lock, { root: 'flow:flows/child' }), checkError('NOT_RUNNABLE'))
  assert.throws(() => projectGraph(lock), checkError('NOT_RUNNABLE'))
  assert.throws(() => projectGraph(lock, { root: 'binding:parent' }), checkError('NOT_RUNNABLE'))
})

test('cycles through distinct packages fail without recursive traversal', () => {
  const lock = {
    packages: { 'flows/a': pkg(), 'flows/b': pkg(), 'flows/c': pkg() },
    bindings: {
      a: binding('flows/a', { next: bound('b') }),
      b: binding('flows/b', { next: bound('c') }),
      c: binding('flows/c', { next: bound('a') }),
    },
  }
  assert.throws(() => projectGraph(lock, { root: 'binding:a' }), checkError('CYCLIC_GRAPH'))
})

test('same-package child routes are invalid even between distinct Bindings', () => {
  const lock = {
    packages: { 'flows/shared': pkg() },
    bindings: {
      a: binding('flows/shared', { child: bound('b') }),
      b: binding('flows/shared'),
    },
  }
  assert.throws(() => projectGraph(lock, { root: 'binding:a' }), checkError('RECURSIVE_PACKAGE'))
})

test('malformed slot identities fail rather than becoming plausible graph edges', () => {
  for (const target of [
    null,
    'flow:flows/child',
    { kind: 'magic', path: 'flows/child' },
    { kind: 'flow' },
    { kind: 'flow', path: '../child' },
    { kind: 'binding', id: 'Bad ID' },
    { kind: 'flow', path: 'flows/child', extra: true },
    { kind: 'grant', policy: {} },
    {
      kind: 'route',
      target: flow('flows/child'),
      attachments: { source: { from: 'input', create: true } },
    },
    { kind: 'route', target: flow('flows/child'), attachments: {} },
    {
      kind: 'route',
      target: { kind: 'grant', policy: { kind: 'acp' } },
      attachments: { source: { from: 'input' } },
    },
  ]) {
    const lock = {
      packages: { 'flows/parent': pkg(), 'flows/child': pkg() },
      bindings: { parent: binding('flows/parent', { child: target }) },
    }
    assert.throws(
      () => projectGraph(lock, { root: 'binding:parent' }),
      (error) => error instanceof GraphInputError,
    )
  }
})

test('direct defaults cannot hold native grants or attachment route wrappers', () => {
  for (const target of [
    { kind: 'grant', policy: { kind: 'acp', client: 'codex' } },
    { kind: 'route', target: flow('flows/child'), attachments: { source: { from: 'input' } } },
  ]) {
    const lock = {
      packages: {
        'flows/parent': pkg({ uses: { child: {} }, slots: { child: target } }),
        'flows/child': pkg(),
      },
      bindings: {},
    }
    assert.throws(() => projectGraph(lock), checkError('MALFORMED_INPUT'))
  }
})

test('malformed input and errors do not echo sensitive values', () => {
  const secret = 'SECRET-invalid-policy-kind'
  const lock = {
    packages: { 'flows/a': pkg() },
    bindings: { a: binding('flows/a', { service: { kind: 'grant', policy: { kind: secret } } }) },
  }
  assert.throws(
    () => projectGraph(lock),
    (error) => error instanceof GraphInputError && !error.message.includes(secret),
  )
  for (const invalid of [
    null,
    [],
    { packages: [], bindings: {} },
    { packages: {}, bindings: {}, extra: secret },
  ]) {
    assert.throws(
      () => projectGraph(invalid),
      (error) => error instanceof GraphInputError,
    )
  }
})

test('object accessors are rejected without evaluating them', () => {
  let accessed = false
  const lock = { bindings: {} }
  Object.defineProperty(lock, 'packages', {
    enumerable: true,
    get() {
      accessed = true
      throw new Error('executed')
    },
  })
  assert.throws(() => projectGraph(lock), checkError('MALFORMED_INPUT'))
  assert.equal(accessed, false)
})

test('special JSON keys cannot escape their dictionary scope', () => {
  const lock = JSON.parse(
    `{"packages":{"__proto__":{"digest":"${DIGEST}","directRun":true,"uses":{"constructor":{}}}},"bindings":{}}`,
  )
  const graph = projectGraph(lock)
  assert.equal(graph.edges[0].target, 'unknown:flow:__proto__:constructor')
  assert.equal(graph.warnings[0].slot, 'constructor')
})

test('output is deterministic and input is unchanged', () => {
  const a = {
    packages: { 'flows/z': pkg(), 'flows/a': pkg({ directRun: false }) },
    bindings: {
      a: binding(
        'flows/a',
        { z: flow('flows/z'), b: flow('flows/z') },
        { settings: { untouched: true } },
      ),
    },
  }
  const before = JSON.stringify(a)
  const b = {
    bindings: {
      a: binding(
        'flows/a',
        { b: flow('flows/z'), z: flow('flows/z') },
        { settings: { unrelated: 'different-secret' } },
      ),
    },
    packages: { 'flows/a': pkg({ directRun: false }), 'flows/z': pkg() },
  }
  assert.deepEqual(projectGraph(a), projectGraph(b))
  assert.equal(JSON.stringify(a), before)
})

test('large linear graph traversal does not depend on the JavaScript call stack', () => {
  const packages = {}
  const count = 3000
  for (let index = 0; index < count; index++) {
    packages[`flows/p${index}`] =
      index + 1 === count
        ? pkg()
        : pkg({ uses: { next: {} }, slots: { next: flow(`flows/p${index + 1}`) } })
  }
  const graph = projectGraph({ packages, bindings: {} }, { root: 'flow:flows/p0' })
  assert.equal(graph.nodes.length, count)
  assert.equal(graph.edges.length, count - 1)
})

test('inventory node budget fails explicitly; a small selected root still works', () => {
  const packages = {}
  for (let index = 0; index <= GRAPH_LIMITS.nodes; index++) packages[`flows/p${index}`] = pkg()
  const lock = { packages, bindings: {} }
  assert.throws(() => projectGraph(lock), checkError('GRAPH_LIMIT'))
  assert.equal(projectGraph(lock, { root: 'flow:flows/p0' }).nodes.length, 1)
})

test('edge budget fails explicitly instead of silently dropping configured routes', () => {
  const slots = {}
  for (let index = 0; index < 256; index++) slots[`s${index}`] = flow('flows/leaf')
  const bindings = {}
  for (let index = 0; index <= GRAPH_LIMITS.edges / 256; index++)
    bindings[`b${index}`] = binding('flows/parent', slots)
  const lock = {
    packages: { 'flows/parent': pkg({ directRun: false }), 'flows/leaf': pkg() },
    bindings,
  }
  assert.throws(() => projectGraph(lock), checkError('GRAPH_LIMIT'))
  assert.equal(projectGraph(lock, { root: 'binding:b0' }).edges.length, 256)
})

test('root view does not claim validation of unrelated routes', () => {
  const lock = {
    packages: { 'flows/ok': pkg(), 'flows/bad': pkg() },
    bindings: { bad: binding('flows/bad', { missing: flow('flows/missing') }) },
  }
  const graph = projectGraph(lock, { root: 'flow:flows/ok' })
  assert.equal(graph.nodes.length, 1)
  assert.equal(graph.provenance.validation, 'structural-data-and-selected-routes-only')
  assert.throws(() => projectGraph(lock), checkError('MISSING_TARGET'))
})
