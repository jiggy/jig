import { constants } from 'node:fs'
import { lstat, open, readdir, realpath } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const LIMITS = Object.freeze({ bytes: 512 * 1024, totalBytes: 8 * 1024 * 1024, files: 512, entries: 4096, tokens: 100000, depth: 64, nodes: 4096, edges: 8192 })
const LOCAL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const FLOW_ENTRYPOINT = /^FLOW\.[a-z0-9]{1,16}(?![\s\S])/
const GRANT_KINDS = new Set(['acp', 'http', 'command', 'evaluation'])
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const pointerPart = value => value.replaceAll('~', '~0').replaceAll('/', '~1')

export class UnsupportedSourceError extends Error {
  constructor(file, token, message) {
    super(`${file}:${token.line}:${token.column}: ${message}`)
    this.name = 'UnsupportedSourceError'
  }
}

class Discovery {
  constructor(roots) { this.roots = roots }
}

// This recognizes a small data grammar. It never loads the imported module.
function tokenize(source, file) {
  if (typeof source !== 'string' || Buffer.byteLength(source) > LIMITS.bytes) throw new Error(`${file}: source exceeds the byte limit`)
  const tokens = []
  let index = 0, line = 1, column = 1
  const location = () => ({ line, column })
  const fail = message => { throw new UnsupportedSourceError(file, location(), message) }
  const take = () => { const ch = source[index++]; if (ch === '\n') { line++; column = 1 } else column++; return ch }
  while (index < source.length) {
    const ch = source[index]
    if (/\s/u.test(ch)) { take(); continue }
    if (source.startsWith('//', index)) { while (index < source.length && source[index] !== '\n') take(); continue }
    if (source.startsWith('/*', index)) {
      take(); take()
      while (index < source.length && !source.startsWith('*/', index)) take()
      if (index === source.length) fail('Unterminated comment')
      take(); take(); continue
    }
    const token = { ...location() }
    if (ch === '"' || ch === "'") {
      const quote = take()
      let value = '', closed = false
      while (index < source.length) {
        const current = take()
        if (current === quote) { closed = true; break }
        if (current === '\n' || current === '\r' || current === '\u2028' || current === '\u2029') fail('Raw line breaks in strings are unsupported')
        if (current !== '\\') { value += current; continue }
        if (index === source.length) fail('Unterminated string escape')
        const escaped = take()
        const escapes = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', '\\': '\\', "'": "'", '"': '"', '/': '/' }
        if (Object.hasOwn(escapes, escaped)) { value += escapes[escaped]; continue }
        if (escaped === '0' && !/[0-9]/.test(source[index] ?? '')) { value += '\0'; continue }
        if (escaped === 'x' || escaped === 'u') {
          const length = escaped === 'x' ? 2 : 4
          const digits = source.slice(index, index + length)
          if (!new RegExp(`^[0-9a-fA-F]{${length}}$`).test(digits)) fail('Only fixed-width hexadecimal string escapes are supported')
          for (let n = 0; n < length; n++) take()
          value += String.fromCharCode(Number.parseInt(digits, 16)); continue
        }
        fail('Unsupported string escape')
      }
      if (!closed) fail('Unterminated string')
      tokens.push({ ...token, type: 'string', value })
    } else if (/[A-Za-z_$]/.test(ch)) {
      let value = take()
      while (index < source.length && /[A-Za-z0-9_$]/.test(source[index])) value += take()
      tokens.push({ ...token, type: 'identifier', value })
    } else if (/[0-9-]/.test(ch)) {
      const number = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(source.slice(index))?.[0]
      if (!number) fail('Unsupported numeric expression')
      for (let n = 0; n < number.length; n++) take()
      const value = Number(number)
      if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))) fail('Number is outside the JSON value range')
      tokens.push({ ...token, type: 'number', value })
    } else if ('{}[]():,;'.includes(ch)) tokens.push({ ...token, type: take(), value: ch })
    else fail('Unsupported source syntax; only literal declarations are analyzed')
    if (tokens.length > LIMITS.tokens) fail('Source token limit exceeded')
  }
  tokens.push({ type: 'eof', value: '', line, column })
  return tokens
}

/** Parse only named SDK imports and one literal default declaration. No evaluation. */
export function parseAuthoredModule(source, { file = '<source>', helper } = {}) {
  const tokens = tokenize(source, file), imports = new Set(), locations = new Map()
  let position = 0, selectedHelper
  const peek = () => tokens[position]
  const fail = message => { throw new UnsupportedSourceError(file, peek(), message) }
  const accept = value => { if (peek().value === value && peek().type !== 'string') { position++; return true } return false }
  const expect = value => { if (!accept(value)) fail(`Expected ${value}; unsupported declaration syntax`) }
  const string = () => { if (peek().type !== 'string') fail('Expected a string literal'); return tokens[position++].value }
  function value(pointer, depth = 0) {
    if (depth > LIMITS.depth) fail('Literal nesting limit exceeded')
    locations.set(pointer, { path: file, line: peek().line, column: peek().column })
    if (peek().type === 'string' || peek().type === 'number') return tokens[position++].value
    if (accept('true')) return true
    if (accept('false')) return false
    if (accept('null')) return null
    if (accept('{')) {
      const result = Object.create(null)
      if (accept('}')) return result
      do {
        const keyToken = peek()
        if (!['identifier', 'string'].includes(keyToken.type)) fail('Expected a literal property name; computed properties and spreads are unsupported')
        position++
        if (Object.hasOwn(result, keyToken.value)) fail('Duplicate property names are unsupported')
        expect(':')
        result[keyToken.value] = value(`${pointer}/${pointerPart(keyToken.value)}`, depth + 1)
        if (accept('}')) return result
        expect(',')
        if (accept('}')) return result
      } while (true)
    }
    if (accept('[')) {
      const result = []
      if (accept(']')) return result
      do {
        result.push(value(`${pointer}/${result.length}`, depth + 1))
        if (accept(']')) return result
        expect(',')
        if (accept(']')) return result
      } while (true)
    }
    if (accept('discover')) {
      if (selectedHelper !== 'defineJig' || !imports.has('discover') || !['/flows', '/bindings', '/grants'].includes(pointer)) fail('discover is supported only for project membership')
      expect('(')
      const roots = value(`${pointer}/roots`, depth + 1)
      accept(','); expect(')')
      const list = typeof roots === 'string' ? [roots] : roots
      if (!Array.isArray(list) || list.length === 0 || list.some(root => typeof root !== 'string')) fail('discover requires literal roots')
      return new Discovery(list)
    }
    fail('Expected a JSON-like literal; identifiers, calls, templates and expressions are unsupported')
  }
  while (accept('import')) {
    expect('{')
    do {
      const name = peek()
      if (name.type !== 'identifier' || !['defineJig', 'defineBinding', 'discover'].includes(name.value) || imports.has(name.value)) fail('Only distinct named Jig declaration helpers are supported')
      imports.add(name.value); position++
      if (accept('}')) break
      expect(',')
      if (accept('}')) break
    } while (true)
    expect('from')
    if (string() !== '@jigging/jig') fail('Only @jigging/jig helper imports are recognized')
    accept(';')
  }
  expect('export'); expect('default')
  selectedHelper = peek().value
  if (!['defineJig', 'defineBinding'].includes(selectedHelper) || !imports.has(selectedHelper) || (helper && selectedHelper !== helper)) fail('Expected the imported declaration helper')
  position++; expect('(')
  const parsed = value('')
  if (!object(parsed) || parsed instanceof Discovery) fail('A declaration requires a literal object')
  accept(','); expect(')'); accept(';')
  if (peek().type !== 'eof') fail('Additional module statements are unsupported')
  const allowed = selectedHelper === 'defineJig'
    ? ['flows', 'bindings', 'grants', 'defaultProviders', 'entrypoint', 'limits']
    : ['package', 'settings', 'slots', 'attachments']
  if (Object.keys(parsed).some(key => !allowed.includes(key))) fail('Unknown declaration fields are unsupported')
  return { helper: selectedHelper, value: parsed, locations }
}

function projectPath(raw) {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 1024 || raw.includes('\\') || /[\u0000-\u001f*?\[\]{}]/u.test(raw)) throw new Error('Expected a bounded literal project-relative path')
  let clean = raw
  while (clean.startsWith('./')) clean = clean.slice(2)
  clean = clean.replace(/\/$/, '')
  if (!clean || path.posix.isAbsolute(clean) || clean.split('/').some(part => !part || part === '.' || part === '..' || ['.jig', '.git', 'node_modules'].includes(part))) throw new Error('Project paths must remain inside ordinary authored source')
  return clean
}

function packagePath(raw) {
  if (typeof raw === 'string' && /^npm:(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/.test(raw)) return raw
  return projectPath(raw)
}

function selector(raw) {
  if (typeof raw !== 'string') throw new Error('Expected a literal target selector')
  if (raw.startsWith('binding:') && LOCAL_NAME.test(raw.slice(8))) return `binding:${raw.slice(8)}`
  if (raw.startsWith('npm:')) return `flow:${packagePath(raw)}`
  if (raw.startsWith('flow:') && !raw.startsWith('flow:npm:')) return `flow:${projectPath(raw.slice(5))}`
  throw new Error('Unsupported target selector')
}

async function sourceReader(directory) {
  const root = await realpath(directory), cache = new Map()
  let totalBytes = 0, files = 0, entries = 0
  async function checked(relative) {
    const clean = projectPath(relative)
    let absolute = root
    for (const part of clean.split('/')) {
      absolute = path.join(absolute, part)
      if ((await lstat(absolute)).isSymbolicLink()) throw new Error('Symlink source paths are unsupported')
    }
    return absolute
  }
  return {
    async read(relative) {
      if (cache.has(relative)) return cache.get(relative)
      if (++files > LIMITS.files) throw new Error('Source file limit exceeded')
      const absolute = await checked(relative)
      const handle = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW)
      try {
        if (!(await handle.stat()).isFile()) throw new Error('Source is not a regular file')
        const buffer = Buffer.alloc(LIMITS.bytes + 1)
        let size = 0
        while (size < buffer.length) {
          const { bytesRead } = await handle.read(buffer, size, buffer.length - size, size)
          if (!bytesRead) break
          size += bytesRead
        }
        if (size > LIMITS.bytes || (totalBytes += size) > LIMITS.totalBytes) throw new Error('Source byte limit exceeded')
        const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, size))
        cache.set(relative, text)
        return text
      } finally { await handle.close() }
    },
    async discover(roots, kind) {
      const found = [], seenRoots = new Set()
      for (const root of roots) {
        const relative = projectPath(root)
        if (seenRoots.has(relative)) throw new Error('Duplicate source discovery roots')
        seenRoots.add(relative)
        let items
        try { items = await readdir(await checked(relative), { withFileTypes: true }) }
        catch (error) { if (error.code === 'ENOENT') continue; throw error }
        entries += items.length
        if (entries > LIMITS.entries) throw new Error('Source discovery entry limit exceeded')
        for (const item of items.sort((a, b) => compare(a.name, b.name))) {
          const member = `${relative}/${item.name}`
          // Jig discovery selects immediate children, never descendants or the root itself.
          if (kind === 'flows') {
            if (!item.isDirectory()) continue
            const contents = await readdir(await checked(member), { withFileTypes: true })
            entries += contents.length
            if (entries > LIMITS.entries) throw new Error('Source discovery entry limit exceeded')
            if (contents.some(file => file.isFile() && FLOW_ENTRYPOINT.test(file.name))) found.push(member)
          } else {
            const extension = kind === 'bindings' ? '.ts' : '.json'
            if (!item.name.endsWith(extension)) continue
            if (!item.isFile() || !LOCAL_NAME.test(item.name.slice(0, -extension.length))) throw new Error('Invalid discovered declaration member')
            found.push(member)
          }
        }
      }
      if (new Set(found).size !== found.length) throw new Error('Duplicate discovered members')
      return found.sort(compare)
    },
  }
}

function safeAttachments(value) {
  if (!object(value) || Object.keys(value).length > 8) throw new Error('Unsupported attachment map')
  const result = Object.create(null)
  for (const [name, mapping] of Object.entries(value)) {
    if (!LOCAL_NAME.test(name) || !object(mapping) || Object.keys(mapping).length !== 1) throw new Error('Unsupported attachment map')
    if (Object.hasOwn(mapping, 'from') && typeof mapping.from === 'string' && LOCAL_NAME.test(mapping.from)) result[name] = { from: mapping.from }
    else if (mapping.supplied === 'read') result[name] = { supplied: 'read' }
    else if (mapping.create === true) result[name] = { create: true }
    else throw new Error('Unsupported attachment mapping')
  }
  return result
}

/** Read authored declarations and metadata without importing or executing them. */
export async function extractSourceGraph(directory, { root: selectedRoot, inventory = false } = {}) {
  const reader = await sourceReader(directory)
  const project = parseAuthoredModule(await reader.read('jig.ts'), { file: 'jig.ts', helper: 'defineJig' })
  const nodes = new Map(), edges = [], warnings = [], bindings = new Map(), metadata = new Map(), grants = new Map()
  const warn = (code, message, node, slot) => warnings.push({ code, ...(node ? { node } : {}), ...(slot ? { slot } : {}), message })
  function addNode(node) {
    if (!nodes.has(node.id)) nodes.set(node.id, node)
    if (nodes.size > LIMITS.nodes) throw new Error('Graph node limit exceeded')
    return node.id
  }
  function addEdge(source, target, slot, evidence, sourceLocation, attachments) {
    edges.push({ id: `${source}#${slot}`, source, target, slot, meaning: 'may-invoke', evidence, ...(sourceLocation ? { location: sourceLocation } : {}), ...(attachments ? { attachments } : {}) })
    if (edges.length > LIMITS.edges) throw new Error('Graph edge limit exceeded')
  }
  function unresolved(node, slot, reason, location) {
    const id = addNode({ id: `unknown:${node}:${slot}`, kind: 'unknown', label: `${slot} · unresolved`, reason })
    addEdge(node, id, slot, 'unmapped-use', location)
    warn('UNRESOLVED_SLOT', reason, node, slot)
  }
  async function members(kind) {
    const value = project.value[kind]
    if (value === undefined) return []
    if (value instanceof Discovery) {
      try { return await reader.discover(value.roots, kind) }
      catch { warn('DISCOVERY_UNAVAILABLE', `${kind} discovery could not be completed; membership is incomplete`); return [] }
    }
    if (!Array.isArray(value) || value.some(member => typeof member !== 'string')) throw new Error(`${kind} must contain literal membership or discover(...)`)
    return [...new Set(value.map(member => kind === 'flows' ? packagePath(member) : projectPath(member)))].sort(compare)
  }
  const flowMembers = new Set(await members('flows'))
  for (const member of await members('grants')) {
    const name = path.posix.basename(member, '.json')
    if (grants.has(name)) throw new Error('Duplicate grant identifiers in membership')
    try { grants.set(name, JSON.parse(await reader.read(member))) }
    catch { warn('GRANT_SOURCE_UNAVAILABLE', 'A selected grant declaration could not be read') }
  }
  async function meta(packageName) {
    if (metadata.has(packageName)) return metadata.get(packageName)
    let value
    if (!packageName.startsWith('npm:')) {
      try {
        value = JSON.parse(await reader.read(`${packageName}/FLOW.meta.json`))
        if (!object(value) || (value.uses !== undefined && (!object(value.uses) || Object.keys(value.uses).length > 256))) throw new Error('Unsupported metadata')
      } catch { value = undefined }
    }
    metadata.set(packageName, value)
    return value
  }
  for (const packageName of flowMembers) {
    const info = await meta(packageName)
    const id = `flow:${packageName}`
    addNode({ id, kind: 'flow', label: typeof info?.name === 'string' ? info.name : packageName, packagePath: packageName, ...(info ? { location: { path: `${packageName}/FLOW.meta.json`, line: 1 } } : { reason: 'Package metadata is unavailable; implementation is opaque' }) })
    if (!info) warn('OPAQUE_PACKAGE', 'Package metadata is unavailable; no internal requirements are inferred', id)
  }
  for (const member of await members('bindings')) {
    const name = path.posix.basename(member, '.ts'), id = `binding:${name}`
    if (!LOCAL_NAME.test(name) || bindings.has(id)) throw new Error('Invalid or duplicate Binding identifier')
    try {
      const parsed = parseAuthoredModule(await reader.read(member), { file: member, helper: 'defineBinding' })
      const packageName = packagePath(parsed.value.package)
      if (parsed.value.slots !== undefined && (!object(parsed.value.slots) || Object.keys(parsed.value.slots).length > 256)) throw new Error('Unsupported slots')
      bindings.set(id, { ...parsed, packageName })
      const info = await meta(packageName)
      addNode({ id, kind: 'binding', label: name, packagePath: packageName, location: parsed.locations.get(''), ...(!info ? { reason: 'Package metadata is unavailable; implementation is opaque' } : {}) })
      if (!info) warn('OPAQUE_PACKAGE', 'Package metadata is unavailable; authored slots are shown without checking the implementation', id)
    } catch (error) {
      bindings.set(id, undefined)
      addNode({ id, kind: 'unknown', label: name, reason: 'Binding declaration is unavailable or outside the supported literal subset', location: { path: member, line: 1 } })
      warn('UNSUPPORTED_BINDING', error instanceof UnsupportedSourceError ? error.message : 'Binding declaration could not be read or analyzed', id)
    }
  }
  const defaults = project.value.defaultProviders ?? {}
  if (!object(defaults) || Object.keys(defaults).length > 256 || Object.values(defaults).some(value => typeof value !== 'string')) throw new Error('defaultProviders must be a literal selector map')
  function targetNode(raw) {
    const id = selector(raw)
    if (!nodes.has(id)) {
      const external = id.startsWith('flow:npm:')
      addNode({ id, kind: external ? 'flow' : 'unknown', label: raw, ...(external ? { packagePath: id.slice(5) } : {}), reason: external ? 'External package implementation was not inspected' : 'Target is absent from the analyzed project membership' })
      warn(external ? 'OPAQUE_PACKAGE' : 'TARGET_UNAVAILABLE', external ? 'External package implementation was not inspected' : 'The selected target is absent from the analyzed membership', id)
    }
    return id
  }
  function selection(node, slot, raw, evidence, location) {
    try {
      if (typeof raw === 'string' && !raw.startsWith('grant:')) { addEdge(node, targetNode(raw), slot, evidence, location); return }
      if (object(raw) && Object.hasOwn(raw, 'target')) {
        if (Object.keys(raw).some(key => !['target', 'attachments'].includes(key))) throw new Error('Unsupported route')
        addEdge(node, targetNode(raw.target), slot, evidence, location, safeAttachments(raw.attachments)); return
      }
      const grantName = typeof raw === 'string' && raw.startsWith('grant:') ? raw.slice(6) : undefined
      if (grantName && !LOCAL_NAME.test(grantName)) throw new Error('Unsupported grant name')
      const policy = grantName ? grants.get(grantName) : raw
      if (!object(policy) || !GRANT_KINDS.has(policy.kind)) { unresolved(node, slot, 'Grant policy is unavailable or unsupported', location); return }
      const id = addNode({ id: `grant:${node}:${slot}`, kind: 'grant', label: `${policy.kind} · ${slot}`, grantKind: policy.kind, ...(grantName ? { grantName } : {}) })
      addEdge(node, id, slot, evidence, location)
    } catch { unresolved(node, slot, 'The authored route is outside the supported literal subset', location) }
  }
  async function requirement(node, slot, use, packageName, location) {
    if (!object(use) || typeof use.contract !== 'string') { unresolved(node, slot, 'No explicit route was authored for this requirement', location); return }
    let contract
    try {
      const relative = projectPath(use.contract)
      contract = JSON.parse(await reader.read(`${packageName}/${relative}`))
      if (!object(contract) || typeof contract.id !== 'string' || typeof contract.version !== 'string') throw new Error('Missing named identity')
    } catch { unresolved(node, slot, 'Referenced contract identity is unavailable; no default is inferred', location); return }
    const chosen = defaults[contract.id]
    if (chosen === undefined) { unresolved(node, slot, 'No explicit project default was found; automatic or native resolution is not analyzed', location); return }
    selection(node, slot, chosen, 'source-default-selection', location)
    warn('DEFAULT_NOT_VERIFIED', 'Default selected by authored contract ID only; exact interface, features and eligibility were not validated', node, slot)
  }
  for (const [id, node] of [...nodes]) {
    if (!['flow', 'binding'].includes(node.kind)) continue
    const binding = bindings.get(id)
    const slots = binding?.value.slots ?? {}
    const info = await meta(node.packagePath)
    for (const [slot, raw] of Object.entries(slots)) {
      if (!LOCAL_NAME.test(slot)) throw new Error('Invalid authored slot name')
      selection(id, slot, raw, 'source-slot', binding.locations.get(`/slots/${pointerPart(slot)}`))
    }
    for (const [slot, use] of Object.entries(info?.uses ?? {})) {
      if (!LOCAL_NAME.test(slot)) throw new Error('Invalid metadata slot name')
      if (!Object.hasOwn(slots, slot)) await requirement(id, slot, use, node.packagePath, { path: `${node.packagePath}/FLOW.meta.json`, line: 1 })
    }
  }
  let root
  if (!inventory) {
    if (selectedRoot !== undefined) root = selector(selectedRoot)
    else if (typeof project.value.entrypoint === 'string') {
      const first = project.value.entrypoint.trim().split(/\s+/u)[0]
      try { root = selector(first) } catch { warn('ENTRYPOINT_UNRESOLVED', 'Entrypoint selector could not be read; showing the analyzed inventory') }
    }
  }
  if (root && !nodes.has(root)) {
    addNode({ id: root, kind: 'unknown', label: selectedRoot ?? root, reason: 'Root is absent from the analyzed project membership' })
    warn('ROOT_UNAVAILABLE', 'Root is absent from the analyzed project membership', root)
  }
  const retained = new Set(), outgoing = new Map()
  for (const edge of edges) { const list = outgoing.get(edge.source) ?? []; list.push(edge.target); outgoing.set(edge.source, list) }
  const queue = root ? [root] : [...nodes.keys()]
  while (queue.length) { const id = queue.pop(); if (retained.has(id)) continue; retained.add(id); queue.push(...(outgoing.get(id) ?? [])) }
  const selectedNodes = [...nodes.values()].filter(node => retained.has(node.id)).sort((a, b) => compare(a.id, b.id))
  const selectedEdges = edges.filter(edge => retained.has(edge.source)).sort((a, b) => compare(a.id, b.id))
  const selectedWarnings = warnings.filter(warning => !warning.node || retained.has(warning.node))
  return {
    nodes: selectedNodes,
    edges: selectedEdges,
    warnings: selectedWarnings,
    provenance: {
      source: 'jig.ts and selected authored source', semantics: 'authored-composition', scope: root ? 'root' : 'inventory', ...(root ? { root } : {}), roots: root ? [root] : selectedNodes.filter(node => !selectedEdges.some(edge => edge.target === node.id)).map(node => node.id),
      approval: 'not-verified', controlFlow: 'not-analyzed',
      completeness: 'literal declarations only; no eligibility, automatic provider inference or contract-closure validation',
      redacted: ['settings values', 'grant policy values', 'attachment source paths and manifests', 'entrypoint arguments'],
    },
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const [directory, ...args] = process.argv.slice(2)
    if (!directory) throw new Error('Usage: node source-graph.mjs PROJECT [--root SELECTOR | --inventory]')
    let root, inventory = false
    for (let index = 0; index < args.length; index++) {
      if (args[index] === '--root' && args[index + 1] && root === undefined) root = args[++index]
      else if (args[index] === '--inventory' && !inventory) inventory = true
      else throw new Error('Unsupported source-graph argument')
    }
    if (root && inventory) throw new Error('Choose either --root or --inventory')
    process.stdout.write(JSON.stringify(await extractSourceGraph(directory, { root, inventory }), null, 2) + '\n')
  } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1 }
}
