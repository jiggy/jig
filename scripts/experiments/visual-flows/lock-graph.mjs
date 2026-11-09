/**
 * Research projection of the public Jig lock/1 value into a composition graph.
 *
 * This does not validate admission, contract compatibility, native qualification,
 * resource budgets, or control flow. It reads no files and executes no project
 * source. A route means "may invoke this configured target", never "runs next".
 * The input must be JSON data. Settings and resource payloads remain opaque.
 */

export const GRAPH_LIMITS = Object.freeze({ nodes: 4096, edges: 16384 })

const LOCAL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*(?![\s\S])/
const DIGEST = /^sha256:[0-9a-f]{64}$/
const GRANT_KINDS = new Set(['acp', 'http', 'command', 'evaluation'])
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0)
const own = (object, key) => Object.hasOwn(object, key)

export class GraphInputError extends TypeError {
  constructor(code, message) {
    super(message)
    this.name = 'GraphInputError'
    this.code = code
  }
}

function fail(code, message) {
  throw new GraphInputError(code, message)
}

function record(value, label, maximum = 65536) {
  if (
    value === null ||
    typeof value !== 'object' ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    fail('MALFORMED_INPUT', `${label} must be a JSON object.`)
  }
  const keys = Reflect.ownKeys(value)
  if (keys.length > maximum) {
    fail('INPUT_LIMIT', `${label} exceeds its entry limit.`)
  }
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (typeof key !== 'string' || !descriptor.enumerable || !own(descriptor, 'value')) {
      fail('MALFORMED_INPUT', `${label} must contain only JSON data properties.`)
    }
  }
  return keys.sort(compare)
}

function fields(value, label, required, allowed) {
  const keys = record(value, label)
  if (required.some((key) => !own(value, key)) || keys.some((key) => !allowed.includes(key))) {
    fail('MALFORMED_INPUT', `${label} has missing or unsupported fields.`)
  }
  return keys
}

function localName(value, label) {
  if (typeof value !== 'string' || value.length > 64 || !LOCAL_NAME.test(value)) {
    fail('MALFORMED_INPUT', `${label} must be a LocalName of 1–64 characters.`)
  }
  return value
}

function projectPath(value, label) {
  if (typeof value === 'string' && value.startsWith('npm:')) {
    if (value.length > 1024 || !/^npm:(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+(?![\s\S])/.test(value)) {
      fail('MALFORMED_INPUT', `${label} must use an npm package name without a version or subpath.`)
    }
    return value
  }
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > 1024 ||
    /[\\\u0000-\u001f\u007f]/.test(value) ||
    /^[a-zA-Z]:/.test(value) ||
    value.split('/').some((part) => part === '' || part === '.' || part === '..')
  ) {
    fail('MALFORMED_INPUT', `${label} must be a canonical project-relative path.`)
  }
  return value
}

function digest(value) {
  if (typeof value !== 'string' || value.length !== 71 || !DIGEST.test(value)) {
    fail('MALFORMED_INPUT', 'Package digest must be a sha256 digest.')
  }
  return value
}

function nameList(value, label) {
  if (!Array.isArray(value) || value.length > 256 || new Set(value).size !== value.length) {
    fail('MALFORMED_INPUT', `${label} must be a bounded list of unique LocalNames.`)
  }
  for (const name of value) localName(name, label)
}

function usesMap(value) {
  const slots = record(value, 'Package uses', 256)
  for (const slot of slots) {
    localName(slot, 'Invocation slot')
    const requirement = value[slot]
    const keys = record(requirement, 'Invocation requirement')
    if (keys.length === 0) continue
    fields(
      requirement,
      'Invocation requirement',
      ['id', 'version', 'digest'],
      ['id', 'version', 'digest', 'requires'],
    )
    if (
      typeof requirement.id !== 'string' ||
      !requirement.id ||
      typeof requirement.version !== 'string' ||
      !requirement.version
    ) {
      fail('MALFORMED_INPUT', 'Named invocation requirements need an ID and version.')
    }
    digest(requirement.digest)
    if (own(requirement, 'requires')) nameList(requirement.requires, 'Required features')
  }
  return slots
}

function slotKeys(value) {
  const keys = record(value, 'Target slots', 256)
  for (const slot of keys) localName(slot, 'Invocation slot')
  return keys
}

function attachmentMap(value) {
  const ports = record(value, 'Route attachment map', 8)
  if (!ports.length) fail('MALFORMED_INPUT', 'Route attachment map must not be empty.')
  const result = {}
  for (const port of ports) {
    localName(port, 'Attachment port')
    const mapping = value[port]
    const keys = record(mapping, 'Attachment mapping', 1)
    if (keys.length !== 1) fail('MALFORMED_INPUT', 'Attachment mapping must select one mode.')
    if (keys[0] === 'from') {
      result[port] = { from: localName(mapping.from, 'Source attachment port') }
    } else if (keys[0] === 'create' && mapping.create === true) {
      result[port] = { create: true }
    } else if (keys[0] === 'supplied' && mapping.supplied === 'read') {
      result[port] = { supplied: 'read' }
    } else {
      fail('MALFORMED_INPUT', 'Attachment mapping has an unsupported mode.')
    }
  }
  return result
}

function ordinaryTarget(value) {
  record(value, 'Ordinary target identity', 2)
  if (value.kind === 'flow') {
    fields(value, 'Flow target identity', ['kind', 'path'], ['kind', 'path'])
    return `flow:${projectPath(value.path, 'Flow target path')}`
  }
  if (value.kind === 'binding') {
    fields(value, 'Binding target identity', ['kind', 'id'], ['kind', 'id'])
    return `binding:${localName(value.id, 'Binding target ID')}`
  }
  fail('MALFORMED_INPUT', 'Expected an exact Flow or Binding target identity.')
}

function targetSelector(value) {
  if (typeof value !== 'string') fail('MALFORMED_INPUT', 'Root must be an exact target selector.')
  if (value.startsWith('npm:')) return `flow:${projectPath(value, 'Root npm target')}`
  if (value.startsWith('flow:npm:'))
    fail('MALFORMED_INPUT', 'Use npm:<package> for a dependency root selector.')
  if (value.startsWith('flow:')) return `flow:${projectPath(value.slice(5), 'Root Flow path')}`
  if (value.startsWith('binding:')) return `binding:${localName(value.slice(8), 'Root Binding ID')}`
  fail('MALFORMED_INPUT', 'Root must start with flow:, npm:, or binding:.')
}

function assertAcyclic(nodes, edges) {
  const incoming = new Map(nodes.map((node) => [node.id, 0]))
  const outgoing = new Map(nodes.map((node) => [node.id, []]))
  for (const edge of edges) {
    incoming.set(edge.target, incoming.get(edge.target) + 1)
    outgoing.get(edge.source).push(edge.target)
  }
  const ready = nodes.filter((node) => incoming.get(node.id) === 0).map((node) => node.id)
  for (let cursor = 0; cursor < ready.length; cursor++) {
    for (const target of outgoing.get(ready[cursor])) {
      incoming.set(target, incoming.get(target) - 1)
      if (incoming.get(target) === 0) ready.push(target)
    }
  }
  if (ready.length !== nodes.length)
    fail('CYCLIC_GRAPH', 'Configured target routes contain a cycle.')
}

/**
 * Project a parsed jig.lock object. With root, include only its reachable graph.
 * Without root, inventory every captured Flow and Binding. Non-direct packages
 * remain visible, but are not root targets and do not borrow Binding routes.
 *
 * Throws on malformed structural data, broken selected references, selected
 * cycles, same-package child routes, and output limits. Unmapped declared uses
 * remain unknown: implicit host-native resolution cannot be inferred here.
 * No claim of whole-lock conformance or current execution authority is made.
 */
export function projectGraph(lock, { root } = {}) {
  fields(
    lock,
    'Jig lock',
    ['packages', 'bindings'],
    ['packages', 'bindings', 'entrypoint', 'agentOverride'],
  )
  const packagePaths = record(lock.packages, 'Packages', 65536)
  const bindingIds = record(lock.bindings, 'Bindings', 4096)
  if (
    own(lock, 'entrypoint') &&
    (typeof lock.entrypoint !== 'string' ||
      lock.entrypoint.length < 1 ||
      lock.entrypoint.length > 16384)
  ) {
    fail('MALFORMED_INPUT', 'Entrypoint must be a bounded string.')
  }
  if (own(lock, 'agentOverride') && !['codex', 'claude', 'pi'].includes(lock.agentOverride)) {
    fail('MALFORMED_INPUT', 'Agent override has an unsupported client.')
  }

  const packages = new Map()
  for (const path of packagePaths) {
    projectPath(path, 'Package path')
    const value = lock.packages[path]
    fields(
      value,
      'Package entry',
      ['digest', 'directRun', 'uses'],
      ['digest', 'directRun', 'uses', 'slots', 'supports'],
    )
    if (typeof value.directRun !== 'boolean')
      fail('MALFORMED_INPUT', 'Package directRun must be boolean.')
    const slots = own(value, 'slots') ? slotKeys(value.slots) : []
    if (own(value, 'slots') && (!value.directRun || slots.length === 0)) {
      fail('MALFORMED_INPUT', 'Only a direct Flow may store a nonempty slots map.')
    }
    if (own(value, 'supports')) nameList(value.supports, 'Supported features')
    packages.set(path, {
      digest: digest(value.digest),
      directRun: value.directRun,
      uses: usesMap(value.uses),
      slots: value.slots ?? {},
    })
  }

  const bindings = new Map()
  for (const id of bindingIds) {
    localName(id, 'Binding ID')
    const value = lock.bindings[id]
    fields(
      value,
      'Binding entry',
      ['packagePath', 'settings', 'slots'],
      ['packagePath', 'settings', 'slots', 'attachments'],
    )
    projectPath(value.packagePath, 'Binding package path')
    if (!packages.has(value.packagePath))
      fail('MISSING_TARGET', 'A Binding refers to a missing package.')
    record(value.settings, 'Binding settings')
    slotKeys(value.slots)
    if (own(value, 'attachments')) record(value.attachments, 'Binding attachments', 8)
    bindings.set(id, { packagePath: value.packagePath, slots: value.slots })
  }

  const nodes = new Map()
  const queue = []
  const edges = []
  const warnings = []
  const selectedRoot = root === undefined ? undefined : targetSelector(root)

  function addNode(node) {
    if (nodes.has(node.id)) return
    if (nodes.size >= GRAPH_LIMITS.nodes)
      fail('GRAPH_LIMIT', 'Graph node limit exceeded. Select a smaller root graph.')
    nodes.set(node.id, node)
  }

  function addTarget(id, allowNonDirect = false) {
    if (nodes.has(id)) return
    let path
    let kind
    let label
    if (id.startsWith('binding:')) {
      const bindingId = id.slice(8)
      const binding = bindings.get(bindingId)
      if (!binding) fail('MISSING_TARGET', 'A selected route or root refers to a missing Binding.')
      path = binding.packagePath
      kind = 'binding'
      label = bindingId
    } else {
      path = id.slice(5)
      kind = 'flow'
      label = path
    }
    const pkg = packages.get(path)
    if (!pkg) fail('MISSING_TARGET', 'A selected route or root refers to a missing Flow package.')
    const runnable = kind === 'binding' || pkg.directRun
    if (!runnable && !allowNonDirect)
      fail('NOT_RUNNABLE', 'A selected Flow target has directRun:false.')
    addNode({
      id,
      kind,
      label,
      runnable,
      packagePath: path,
      packageDigest: pkg.digest,
      declaredUseCount: pkg.uses.length,
    })
    if (runnable) queue.push(id)
  }

  if (selectedRoot === undefined) {
    for (const path of packagePaths) addTarget(`flow:${path}`, true)
    for (const id of bindingIds) addTarget(`binding:${id}`)
  } else {
    addTarget(selectedRoot)
  }

  for (let cursor = 0; cursor < queue.length; cursor++) {
    const source = queue[cursor]
    const parent = nodes.get(source)
    const pkg = packages.get(parent.packagePath)
    const slots = parent.kind === 'binding' ? bindings.get(source.slice(8)).slots : pkg.slots
    for (const slot of [...new Set([...pkg.uses, ...Object.keys(slots)])].sort(compare)) {
      if (edges.length >= GRAPH_LIMITS.edges)
        fail('GRAPH_LIMIT', 'Graph edge limit exceeded. Select a smaller root graph.')
      const edge = {
        id: `edge:${source}:${slot}`,
        source,
        target: '',
        slot,
        meaning: 'may-invoke',
        evidence: 'lock-slot',
      }
      if (!own(slots, slot)) {
        edge.target = `unknown:${source}:${slot}`
        edge.evidence = 'unmapped-use'
        addNode({
          id: edge.target,
          kind: 'unknown',
          label: `${slot} (unmapped)`,
          runnable: false,
          reason: 'unmapped-use',
        })
        warnings.push({
          code: 'UNMAPPED_USE',
          node: source,
          slot,
          message:
            'No configured route is stored for this declared use. Implicit host-native resolution is not inferred.',
        })
      } else {
        const value = slots[slot]
        record(value, 'Slot target', 4)
        if (value.kind === 'grant') {
          if (parent.kind !== 'binding')
            fail('MALFORMED_INPUT', 'Direct Flow slots cannot store grants.')
          fields(
            value,
            'Grant target',
            ['kind', 'policy'],
            ['kind', 'policy', 'name', 'evaluation'],
          )
          record(value.policy, 'Grant policy')
          if (!GRANT_KINDS.has(value.policy.kind))
            fail('MALFORMED_INPUT', 'Grant policy has an unsupported kind.')
          if (own(value, 'name')) localName(value.name, 'Grant name')
          if (own(value, 'evaluation')) record(value.evaluation, 'Retained evaluation')
          edge.target = `grant:${source}:${slot}`
          addNode({
            id: edge.target,
            kind: 'grant',
            label: value.name ?? value.policy.kind,
            runnable: false,
            grantKind: value.policy.kind,
            ...(own(value, 'name') ? { grantName: value.name } : {}),
          })
        } else {
          if (value.kind === 'route') {
            if (parent.kind !== 'binding')
              fail('MALFORMED_INPUT', 'Direct Flow slots cannot store attachment routes.')
            fields(
              value,
              'Attachment route',
              ['kind', 'target', 'attachments'],
              ['kind', 'target', 'attachments'],
            )
            edge.target = ordinaryTarget(value.target)
            edge.attachments = attachmentMap(value.attachments)
          } else {
            edge.target = ordinaryTarget(value)
          }
          addTarget(edge.target)
          if (nodes.get(edge.target).runnable !== true)
            fail('NOT_RUNNABLE', 'A selected Flow target has directRun:false.')
          if (nodes.get(edge.target).packagePath === parent.packagePath) {
            fail('RECURSIVE_PACKAGE', "A configured child route selects the caller's own package.")
          }
        }
      }
      edges.push(edge)
    }
  }

  const resultNodes = [...nodes.values()].sort((a, b) => compare(a.id, b.id))
  edges.sort((a, b) => compare(a.id, b.id))
  warnings.sort((a, b) => compare(`${a.node}:${a.slot}`, `${b.node}:${b.slot}`))
  assertAcyclic(resultNodes, edges)
  return {
    nodes: resultNodes,
    edges,
    warnings,
    provenance: {
      source: 'jig.lock',
      semantics: 'configured-composition',
      scope: selectedRoot === undefined ? 'inventory' : 'root',
      ...(selectedRoot === undefined ? {} : { root: selectedRoot, rootSelector: root }),
      roots:
        selectedRoot === undefined
          ? resultNodes.filter((node) => node.runnable).map((node) => node.id)
          : [selectedRoot],
      approval: 'not-verified',
      controlFlow: 'not-analyzed',
      validation: 'structural-data-and-selected-routes-only',
      runnableMeaning:
        'The lock marks this identity as a Run target; current host eligibility is not verified.',
      redacted: [
        'settings',
        'grant-policy-payloads',
        'retained-evaluations',
        'binding-attachments',
        'entrypoint',
        'agentOverride',
      ],
    },
  }
}
