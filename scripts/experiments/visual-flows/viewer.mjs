/** Read-only renderer for already redacted graph data. It embeds that snapshot in JSON. */
export function graphRoots(graph) {
  const known = new Set(graph.nodes.map(node => node.id))
  const explicit = [graph.entry, graph.root, graph.provenance?.root].filter(id => known.has(id))
  if (explicit.length) return [...new Set(explicit)]
  const targets = new Set(graph.edges.map(edge => edge.target ?? edge.to))
  const structural = graph.nodes.filter(node => !targets.has(node.id)).map(node => node.id)
  if (structural.length) return structural
  // Inventory roots are available Run targets, including targets with callers.
  // They are not all structural roots. A cyclic graph needs only a layout seed.
  const candidate = (graph.provenance?.roots || []).find(id => known.has(id))
  return [candidate ?? graph.nodes[0]?.id].filter(id => id !== undefined)
}

export function edgeLabel(edge) {
  return edge.label ?? edge.slot ?? edge.action ?? (edge.meaning === 'scope-entry' ? 'entry' : 'unlabelled')
}

export function scopeExits(graph, node) {
  if (Array.isArray(node.declaredExits)) return node.declaredExits
  if (Array.isArray(node.exits)) return node.exits
  const scope = (graph.scopes || []).find(item => item.owner === node.id || item.ownerElementId === node.id)
  return scope?.declaredExits ?? scope?.exits ?? []
}

export function isRuntimeGraph(graph) {
  return graph.layer === 'runtime-topology' || graph.provenance?.semantics === 'declared-runtime-topology'
}

export function displayNodeKind(node, graph) {
  if (node.kind === 'grant') return 'Host resource'
  if (node.kind === 'unknown') return 'Unresolved'
  if (node.kind === 'external') return 'External package'
  if (node.kind === 'binding') return 'Binding'
  if (node.kind === 'flow') return isRuntimeGraph(graph) ? 'Scope' : node.runnable === false ? 'Flow · not direct' : 'Flow'
  return node.kind === 'scope' ? 'Scope' : node.kind === 'node' ? 'Step' : node.kind
}

export function nodeSource(node) {
  return node.location ?? node.source ?? (typeof node.evidence === 'object' ? node.evidence : undefined)
}

export function evidenceText(graph) {
  if (isRuntimeGraph(graph)) {
    const measured = graph.provenance?.checks?.handlersDuringInspection === 0
    return {
      heading: graph.runs?.length ? 'Declared topology + recorded probe runs' : 'Declared runtime topology',
      text: (measured ? 'The recorded probe reports zero handler entries during inspection. ' : 'This viewer does not verify how the runtime description was obtained. ') + 'Highlights show recorded handler entries. Edge traversal is not inferred.',
    }
  }
  return {
    heading: graph.provenance?.source === 'jig.lock' ? 'Generated from the supplied lock' : 'Generated from supplied declarations',
    text: 'Connections describe available calls. They do not prove execution order, use, or approval.',
  }
}

export function edgeGeometry(edge, index, positions, lane = 0) {
  const a = positions.get(edge.source ?? edge.from), b = positions.get(edge.target ?? edge.to)
  if (!a || !b) return null
  const ax = a.x + 100, ay = a.y + 81, bx = b.x + 100, by = b.y
  let points, labelX, labelY, labelWidth = 200
  if (by > ay + 12) {
    const mid = (ay + by) / 2, offset = lane * 16
    points = [[ax + offset, ay], [ax + offset, mid], [bx + offset, mid], [bx + offset, by]]
    labelX = (ax + bx) / 2 + offset
    labelY = mid - 6 + offset
  } else if (by === a.y) {
    const right = b.x > a.x, start = right ? a.x + 200 : a.x, end = right ? b.x : b.x + 200
    const gap = Math.abs(b.x - a.x) - 200
    if (gap >= 80 && gap < 200) {
      // Adjacent siblings have a clear gutter. Keep this edge below the
      // incoming-label zone instead of arching into the preceding row.
      const mid = (start + end) / 2, line = a.y + 41 + lane * 12
      points = [[start, line], [mid, line], [mid, line], [end, line]]
      labelX = mid; labelY = line - 8; labelWidth = gap - 16
    } else {
      // An intervening card (or a self-loop) needs an outer route.
      const curve = a.y - 40 - (index % 3) * 14 - lane * 12
      points = [[start, a.y + 35], [start, curve], [end, curve], [end, b.y + 35]]
      labelX = (start + end) / 2
      labelY = curve + 13
    }
  } else {
    const bend = Math.max(a.x + 200, b.x + 200) + 40 + (index % 3) * 16 + lane * 12
    points = [[a.x + 200, a.y + 48], [bend, a.y + 48], [bend, b.y + 35], [b.x + 200, b.y + 35]]
    labelX = bend + 3
    labelY = (a.y + b.y) / 2 + 38 + lane * 16
  }
  // A cubic Bezier stays inside its control-point hull. Include label margins
  // and the arrowhead, rather than fitting only the node rectangles.
  const xs = points.map(point => point[0]), ys = points.map(point => point[1])
  return {
    path: `M ${points[0].join(' ')} C ${points[1].join(' ')}, ${points[2].join(' ')}, ${points[3].join(' ')}`,
    labelX, labelY, labelWidth,
    bounds: {
      left: Math.min(...xs, labelX - 110) - 12,
      right: Math.max(...xs, labelX + 110) + 12,
      top: Math.min(...ys, labelY - 14) - 12,
      bottom: Math.max(...ys, labelY + 8) + 12,
    },
  }
}

export function layoutGraph(graph) {
  const adjacent = new Map(graph.nodes.map(node => [node.id, []]))
  for (const edge of graph.edges) {
    const source = edge.source ?? edge.from, target = edge.target ?? edge.to
    if (adjacent.has(source) && adjacent.has(target)) adjacent.get(source).push(target)
  }
  const rank = new Map(), queue = graphRoots(graph)
  for (const id of queue) rank.set(id, 0)
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const id = queue[cursor]
    for (const target of adjacent.get(id) || []) if (!rank.has(target)) { rank.set(target, rank.get(id) + 1); queue.push(target) }
  }
  const levels = new Map()
  for (const node of graph.nodes) {
    const level = rank.get(node.id) ?? 0
    if (!levels.has(level)) levels.set(level, [])
    levels.get(level).push(node)
  }
  const columns = Math.max(1, ...[...levels.values()].map(nodes => Math.min(nodes.length, 4)))
  const gap = 96, stride = 200 + gap
  const width = Math.max(660, columns * 200 + (columns - 1) * gap + 166), positions = new Map()
  let y = 54
  for (const [level, nodes] of [...levels].sort((a, b) => a[0] - b[0])) {
    for (let start = 0; start < nodes.length; start += 4) {
      const row = nodes.slice(start, start + 4), total = row.length * 200 + (row.length - 1) * gap
      row.forEach((node, index) => positions.set(node.id, { x: (width - total) / 2 + index * stride, y, width: 200, height: 81, rank: level }))
      y += 153
    }
  }
  const pairs = new Map(), pairKey = edge => JSON.stringify([edge.source ?? edge.from, edge.target ?? edge.to])
  for (const edge of graph.edges) { const key = pairKey(edge); pairs.set(key, (pairs.get(key) || 0) + 1) }
  const occurrences = new Map(), edgePaths = new Map()
  let left = 0, top = 0, right = width, bottom = Math.max(410, y - 45)
  graph.edges.forEach((edge, index) => {
    const key = pairKey(edge), occurrence = occurrences.get(key) || 0, count = pairs.get(key)
    occurrences.set(key, occurrence + 1)
    const lane = (occurrence - (count - 1) / 2) * Math.min(1, 4 / Math.max(1, count - 1))
    const geometry = edgeGeometry(edge, index, positions, lane)
    if (!geometry) return
    edgePaths.set(edge.id, geometry)
    left = Math.min(left, geometry.bounds.left); top = Math.min(top, geometry.bounds.top)
    right = Math.max(right, geometry.bounds.right); bottom = Math.max(bottom, geometry.bounds.bottom)
  })
  return {
    positions, edgePaths,
    dimensions: { x: Math.floor(left) - 16, y: Math.floor(top) - 16, width: Math.ceil(right - left) + 32, height: Math.ceil(bottom - top) + 32 },
  }
}

function validateGraphs(items) {
  if (!Array.isArray(items) || items.length === 0 || items.length > 64) throw new TypeError('Supply between one and 64 graph examples.')
  for (const item of items) {
    const graph = item?.graph
    if (!item || typeof item.title !== 'string' || !graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) throw new TypeError('Each example needs a title and a graph with nodes and edges.')
    if (graph.nodes.length > 4096 || graph.edges.length > 16384) throw new TypeError('Graph exceeds the viewer limits.')
    const ids = new Set(), edgeIds = new Set()
    for (const node of graph.nodes) {
      if (!node || typeof node.id !== 'string' || !node.id || ids.has(node.id) || typeof node.kind !== 'string' || !node.kind) throw new TypeError('Graph nodes need unique string IDs and a kind.')
      if (node.runnable !== undefined && typeof node.runnable !== 'boolean') throw new TypeError('Node runnable flags must be boolean.')
      if (['label', 'name'].some(key => node[key] !== undefined && typeof node[key] !== 'string')) throw new TypeError('Node labels must be strings.')
      if (['declaredExits', 'exits'].some(key => node[key] !== undefined && !Array.isArray(node[key]))) throw new TypeError('Node scope exits must be arrays.')
      ids.add(node.id)
    }
    for (const edge of graph.edges) {
      if (!edge || typeof edge.id !== 'string' || !edge.id || edgeIds.has(edge.id) || !ids.has(edge.source ?? edge.from) || !ids.has(edge.target ?? edge.to) || typeof edge.meaning !== 'string') throw new TypeError('Graph edges need unique IDs, known endpoints, and a meaning.')
      if (['label', 'slot', 'action'].some(key => edge[key] !== undefined && edge[key] !== null && typeof edge[key] !== 'string')) throw new TypeError('Edge labels must be strings.')
      edgeIds.add(edge.id)
    }
    if (graph.warnings !== undefined && (!Array.isArray(graph.warnings) || graph.warnings.some(warning => typeof warning !== 'string' && (!warning || typeof (warning.message ?? warning.code) !== 'string')))) throw new TypeError('Graph warnings must contain text diagnostics.')
    if (graph.scopes !== undefined && (!Array.isArray(graph.scopes) || graph.scopes.some(scope => !scope || !Array.isArray(scope.declaredExits ?? scope.exits ?? []) || (scope.declaredExits ?? scope.exits ?? []).some(exit => typeof exit !== 'string')))) throw new TypeError('Scope exits must contain strings.')
    for (const node of graph.nodes) if (!Array.isArray(scopeExits(graph, node)) || scopeExits(graph, node).some(exit => typeof exit !== 'string')) throw new TypeError('Node scope exits must contain strings.')
    if (graph.runs !== undefined && (!Array.isArray(graph.runs) || graph.runs.some(run => !run || typeof run !== 'object' || (run.observations !== undefined && (!Array.isArray(run.observations) || run.observations.some(entry => typeof entry !== 'string' && (!entry || typeof entry !== 'object')))) || (run.nodeCounts !== undefined && (!run.nodeCounts || typeof run.nodeCounts !== 'object' || Array.isArray(run.nodeCounts) || Object.entries(run.nodeCounts).some(([id, count]) => !ids.has(id) || !Number.isSafeInteger(count) || count < 0)))))) throw new TypeError('Runs must contain valid observations and node counts.')
    if (item.revision !== undefined && typeof item.revision !== 'string') throw new TypeError('Source revisions must be strings.')
    if (graph.provenance?.roots !== undefined && (!Array.isArray(graph.provenance.roots) || graph.provenance.roots.some(id => typeof id !== 'string'))) throw new TypeError('Graph root inventories must contain strings.')
    if ([graph.entry, graph.root, graph.provenance?.root].some(id => id !== undefined && !ids.has(id))) throw new TypeError('A selected graph root must identify a known node.')
  }
}

export function renderExplorer({ title = 'Visual FLOW experiment', graphs }) {
  validateGraphs(graphs)
  const escapeHtml = (value) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
  const data = JSON.stringify(graphs).replaceAll('<', '\\u003c').replaceAll('>', '\\u003e').replaceAll('&', '\\u0026').replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029')
  return String.raw`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'">
<title>${escapeHtml(title)}</title><style>
:root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#21352e;background:#f3f4ee;font-synthesis:none;--green:#286b4e;--ink:#193b2e;--muted:#627369;--line:#d9e0d5;--accent:#e3ed69}*{box-sizing:border-box}body{margin:0}button,select{font:inherit}button,select,a{touch-action:manipulation}button{cursor:pointer}button:focus-visible,select:focus-visible,a:focus-visible,[role=button]:focus-visible{outline:3px solid #d4bc35;outline-offset:4px}header{display:flex;align-items:center;gap:16px;min-height:82px;border-bottom:1px solid var(--line);padding:20px 30px;background:#fbfcf7}.mark{background:var(--ink);color:#f1f596;display:grid;place-items:center;width:40px;height:40px;font-weight:800;border-radius:12px;font-size:23px}h1{font-size:21px;letter-spacing:-.6px;margin:0;font-weight:690}.eyebrow{font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:var(--muted);font-weight:750}.header-copy .eyebrow{margin-bottom:4px}.tag{font-size:11px;color:var(--green);border:1px solid #c0d5bc;border-radius:30px;padding:6px 10px;margin-left:auto;background:#f0f5e8;white-space:nowrap}.layout{display:grid;grid-template-columns:234px minmax(0,1fr) 300px;min-height:calc(100vh - 82px)}.sidebar{padding:26px 18px;border-right:1px solid var(--line);background:#f9faf4}.sidebar h2{margin:0 10px 12px}.group-label{font-size:11px;letter-spacing:1px;text-transform:uppercase;color:var(--muted);font-weight:700;margin:28px 10px 10px}.example{display:block;width:100%;text-align:left;border:0;background:transparent;border-radius:9px;padding:13px 12px;color:#465b4e;margin-bottom:5px}.example strong{font-size:13px;display:block}.example small{display:block;margin-top:5px;font-size:11px;color:#7a887e}.example.active{background:#e2e9d9;color:var(--ink);box-shadow:inset 3px 0 var(--green)}.example:hover{background:#edf0e5}.sidebar-note{border-top:1px solid var(--line);margin:26px 10px 0;padding-top:18px;font-size:12px;line-height:1.65;color:var(--muted)}main{min-width:0}.intro{padding:27px 30px 20px;background:#f9faf4;border-bottom:1px solid var(--line)}.title-row{display:flex;gap:20px;align-items:flex-start;justify-content:space-between}h2{font-size:25px;letter-spacing:-.7px;margin:6px 0 10px}.intro p{font-size:13px;color:var(--muted);line-height:1.65;max-width:750px;margin:0}.stats{display:flex;gap:22px;margin-top:19px}.stat{display:flex;gap:7px;align-items:baseline;font-size:11px;color:var(--muted)}.stat strong{font-size:20px;letter-spacing:-.5px;color:var(--ink)}.toolbar{display:flex;gap:12px;align-items:center;justify-content:space-between;padding:12px 22px;border-bottom:1px solid var(--line);background:#fffef9;flex-wrap:wrap}.legend{display:flex;gap:14px;align-items:center;flex-wrap:wrap;font-size:11px;color:var(--muted)}.legend span{display:flex;align-items:center;gap:6px}.key{width:8px;height:8px;border-radius:50%;background:#307252}.key.binding{background:#71659a}.key.grant{background:#af883a}.key.unknown{background:#a3a59a}.controls{display:flex;gap:5px}.controls button,.button{background:#fffef8;border:1px solid #d6ddcf;border-radius:7px;color:#37533f;padding:7px 11px;font-size:12px}.controls button:hover,.button:hover{background:#eef3e6}#diagram-wrap{position:relative;background-color:#f4f5ef;background-image:radial-gradient(#d4dcce .7px,transparent .7px);background-size:18px 18px;min-height:520px;height:calc(100vh - 360px);max-height:1000px;overflow:hidden}#diagram{display:block;width:100%;height:100%;min-height:520px;user-select:none;touch-action:none}.graph-node{cursor:pointer}.graph-node rect.node{fill:#fffef9;stroke:#c9d4c4;stroke-width:1.3;filter:drop-shadow(0 3px 5px #163d2110)}.graph-node:hover rect.node,.graph-node.selected rect.node{stroke:#37754f;stroke-width:2.6}.graph-node.selected rect.node{fill:#f9fcea}.graph-node .node-title{font-size:13px;font-weight:650;fill:#233e2c}.graph-node .node-kind{font-size:9px;font-weight:700;letter-spacing:.9px;fill:#76846f}.graph-node .node-subtitle{font-size:10px;fill:#7b8677}.graph-node .node-symbol{font-size:12px;font-weight:800;fill:#fff}.edge{fill:none;stroke:#93a58b;stroke-width:1.6}.edge.related{stroke:#3d794e;stroke-width:2.4}.edge.scope-entry{stroke-dasharray:4 5}.edge.unresolved{stroke-dasharray:3 5;stroke:#a0a393}.edge-label{font-size:10px;fill:#66795c;paint-order:stroke;stroke:#f4f5ef;stroke-width:6px;stroke-linejoin:round}.node-count{fill:#dfe976;stroke:#f4f5ef;stroke-width:2}.node-count-text{font-size:10px;font-weight:750;fill:#2d4d35}.graph-node.observed rect.node{fill:#f7fbd9;stroke:#749539;stroke-width:2}.footer-note{border-top:1px solid var(--line);padding:15px 24px;color:var(--muted);font-size:11px;line-height:1.65;background:#f9faf4}.detail{background:#fffef9;border-left:1px solid var(--line);padding:28px 22px;overflow-wrap:anywhere}.detail h2{font-size:19px;letter-spacing:-.5px;line-height:1.4}.detail h3{font-size:11px;text-transform:uppercase;letter-spacing:1px;color:var(--muted);margin:26px 0 10px}.detail p{font-size:12px;line-height:1.7;color:#66765f}.detail code{font-size:11px;color:#4a6250;line-height:1.7}.detail a{color:#326b4a}.pill{display:inline-block;border:1px solid #d4dfc8;border-radius:5px;padding:4px 7px;margin:3px 3px 3px 0;font-size:11px;background:#f5f7ed}.route{padding:9px 0;border-bottom:1px solid #e5e9de;font-size:12px}.route strong{font-size:11px;display:block;margin-bottom:4px}.route small{font-size:11px;color:#71806a}.notice{padding:13px;border:1px solid #e2dcc3;border-radius:8px;background:#f7f4e8;margin:15px 0;font-size:12px;line-height:1.65;color:#7b704a}.evidence{background:#eef3e3;border-radius:8px;padding:13px;margin-top:20px;font-size:11px;line-height:1.7;color:#526846}.evidence strong{display:block;color:#3d5b35;margin-bottom:3px}.runs{display:none;background:#eef3e3;padding:13px 24px;border-bottom:1px solid var(--line);gap:10px;align-items:center;flex-wrap:wrap}.runs label{font-size:12px;font-weight:650}.runs select{max-width:100%;border:1px solid #c8d4bb;border-radius:6px;background:#fbfdf5;padding:7px;font-size:12px;color:#355130}.runs small{font-size:11px;color:#64745a}.trace{font-size:12px;line-height:1.75}.trace-item{display:flex;gap:8px;align-items:flex-start;margin-bottom:6px}.trace-item span{display:inline-flex;min-width:21px;justify-content:center;border:1px solid #d4dfc4;border-radius:4px;color:#758468;font-size:10px}.sr-only{position:absolute;width:1px;height:1px;margin:-1px;overflow:hidden;clip:rect(0,0,0,0)}.mobile-detail{display:none}button:disabled{opacity:.5;cursor:default}@media(min-width:1550px){.layout{grid-template-columns:250px minmax(0,1fr) 330px}.intro{padding:32px 38px}.sidebar{padding:30px 20px}}@media(max-width:1150px){.layout{grid-template-columns:198px minmax(0,1fr)}.detail{grid-column:2;border-left:0;border-top:1px solid var(--line);display:grid;grid-template-columns:1fr 1fr;gap:20px}.detail>section{min-width:0}#diagram-wrap{height:560px}.sidebar{grid-row:1 / 3}header{padding:16px 22px}.intro{padding:24px}.detail h2{margin-top:4px}}@media(max-width:700px){header{padding:14px 16px;gap:10px}h1{font-size:17px}.tag{font-size:9px;padding:5px 8px}.layout{display:block}.sidebar{padding:14px 12px;border-right:0;border-bottom:1px solid var(--line)}.sidebar h2,.group-label,.sidebar-note{display:none}#examples{display:flex;gap:8px;overflow:auto}.example{width:auto;min-width:155px;flex-shrink:0;margin:0;padding:10px}.example small{font-size:10px}.intro{padding:22px 20px}.title-row{gap:10px}h2{font-size:23px}.intro p{font-size:12px}.toolbar{padding:10px 16px}.legend{gap:10px}.stats{gap:20px}.detail{display:block;padding:20px}.detail>section{margin-bottom:22px}#diagram-wrap{height:470px;min-height:470px}#diagram{min-height:470px}.runs{padding:12px 16px}.footer-note{padding:13px 18px}.button{font-size:11px;padding:7px 9px}}@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important}}
</style></head><body>
<header><div class="mark" aria-hidden="true">ƒ</div><div class="header-copy"><div class="eyebrow">Jig / FLOW · research</div><h1>See the work take shape</h1></div><span class="tag">Read-only experiment</span></header>
<div class="layout"><nav class="sidebar" aria-label="Example workflows"><h2 class="eyebrow">Explore the evidence</h2><div id="examples"></div><p class="sidebar-note">Code and configuration remain the source of truth. These diagrams are generated views.<br><br>Select a component to inspect its connections and the limits of the evidence.</p></nav>
<main><section class="intro"><div class="title-row"><div><div id="graph-kind" class="eyebrow"></div><h2 id="graph-title"></h2></div><button class="button" id="export">Export graph JSON</button></div><p id="summary"></p><div class="stats" id="stats"></div></section>
<section class="runs" id="runs"><label for="run-select">Recorded probe run</label><select id="run-select"><option value="">Declared topology only</option></select><small>Highlights show handler entries. Edges remain declarations.</small></section>
<div class="toolbar"><div class="legend" id="legend"></div><div class="controls"><button id="zoom-out" aria-label="Zoom out">−</button><button id="zoom-in" aria-label="Zoom in">+</button><button id="fit">Fit</button></div></div>
<div id="diagram-wrap"><svg id="diagram" xmlns="http://www.w3.org/2000/svg" role="group" aria-label="Generated workflow graph. Select a component for details."><defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="userSpaceOnUse"><path d="M 0 0 L 8 4 L 0 8 Z" fill="#93a58b"/></marker><marker id="arrow-active" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="userSpaceOnUse"><path d="M 0 0 L 8 4 L 0 8 Z" fill="#3d794e"/></marker></defs><g id="canvas"></g></svg></div>
<div class="footer-note" id="footer"></div></main><aside class="detail" id="detail" aria-label="Component details" aria-live="polite"></aside></div>
<script id="graph-data" type="application/json">${data}</script>
<script>
'use strict';
const graphRoots=${graphRoots.toString()};
const edgeLabel=${edgeLabel.toString()};
const scopeExits=${scopeExits.toString()};
const isRuntimeGraph=${isRuntimeGraph.toString()};
const displayNodeKind=${displayNodeKind.toString()};
const nodeSource=${nodeSource.toString()};
const evidenceText=${evidenceText.toString()};
const edgeGeometry=${edgeGeometry.toString()};
const layoutGraph=${layoutGraph.toString()};
const DATA=JSON.parse(document.getElementById('graph-data').textContent);
const $=id=>document.getElementById(id), NS='http://www.w3.org/2000/svg';
let current=0, selected=null, runIndex='', positions=new Map(), edgePaths=new Map(), dimensions={x:0,y:0,width:900,height:600}, view={x:0,y:0,width:900,height:600}, drag=null;
const h=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e};
const s=(tag,attrs={},text)=>{const e=document.createElementNS(NS,tag);for(const [k,v] of Object.entries(attrs))e.setAttribute(k,String(v));if(text!==undefined)e.textContent=text;return e};
const getGraph=()=>DATA[current].graph;
const warningText=w=>typeof w==='string'?w:w.message||w.code||'Unspecified evidence limitation';
const isRuntime=()=>isRuntimeGraph(getGraph());
const edgeFrom=e=>e.source??e.from, edgeTo=e=>e.target??e.to;
const short=(v,n=29)=>{const t=String(v??'');return t.length>n?t.slice(0,n-1)+'…':t};
const nodeKind=n=>displayNodeKind(n,getGraph());
const color=n=>n.kind==='binding'?'#77679e':n.kind==='grant'?'#af883a':n.kind==='unknown'||n.kind==='external'?'#929c85':'#39754f';
function addSection(parent,title,text){const heading=h('h3',title);parent.append(heading);if(text!==undefined)parent.append(h('p',text));return heading}
function layout(g){const result=layoutGraph(g);positions=result.positions;dimensions=result.dimensions;edgePaths=result.edgePaths;}
function pathFor(e){return edgePaths.get(e.id);}
function fitText(element,width){if(element.getComputedTextLength()>width){element.setAttribute('textLength',width);element.setAttribute('lengthAdjust','spacingAndGlyphs');}}
function nodeCounts(){if(runIndex==='')return {};const r=getGraph().runs[Number(runIndex)];return r.nodeCounts||{}}
function draw(){const g=getGraph(),layer=$('canvas'),counts=nodeCounts();layer.replaceChildren();g.edges.forEach((e,i)=>{const p=pathFor(e,i);if(!p)return;const related=selected&&(edgeFrom(e)===selected||edgeTo(e)===selected);const cls=['edge',related?'related':'',e.meaning==='scope-entry'?'scope-entry':'',String(e.evidence).includes('unmapped')?'unresolved':''].join(' ');const path=s('path',{d:p.path,class:cls,'marker-end':related?'url(#arrow-active)':'url(#arrow)'});const title=s('title',{},String(edgeLabel(e))+' · '+e.meaning);path.append(title);layer.append(path);layer.append(s('text',{x:p.labelX,y:p.labelY,'text-anchor':'middle',class:'edge-label','data-fit-width':p.labelWidth},short(edgeLabel(e),27)))});
 for(const n of g.nodes){const p=positions.get(n.id),count=Object.hasOwn(counts,n.id)?counts[n.id]:0,group=s('g',{class:'graph-node'+(selected===n.id?' selected':'')+(count?' observed':''),transform:'translate('+p.x+','+p.y+')',role:'button',tabindex:'0','aria-label':(n.label||n.name||n.id)+', '+nodeKind(n)+(count?', entered '+count+' times':'')});group.append(s('rect',{width:200,height:81,rx:11,class:'node'}));group.append(s('rect',{x:12,y:14,width:23,height:23,rx:7,fill:color(n)}));group.append(s('text',{x:23.5,y:30,'text-anchor':'middle',class:'node-symbol'},n.kind==='binding'?'B':n.kind==='grant'?'↗':n.kind==='unknown'?'?':n.kind==='external'?'↗':n.kind==='flow'&&isRuntime()?'◇':'ƒ'));group.append(s('text',{x:44,y:25,class:'node-kind'},nodeKind(n).toUpperCase()));group.append(s('text',{x:13,y:51,class:'node-title'},short(n.label||n.name||n.id,26)));const subtitle=n.packagePath||n.package||n.source?.path||n.id;group.append(s('text',{x:13,y:68,class:'node-subtitle'},short(subtitle,32)));if(count){group.append(s('circle',{cx:190,cy:7,r:13,class:'node-count'}));group.append(s('text',{x:190,y:11,'text-anchor':'middle',class:'node-count-text'},count>999?'999+':count+'×'))}group.append(s('title',{},(n.label||n.id)+'\n'+subtitle));group.addEventListener('click',()=>{selected=n.id;draw();details()});group.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();selected=n.id;draw();details()}});layer.append(group)}
 for(const label of layer.querySelectorAll('.node-title,.node-subtitle'))fitText(label,174);for(const label of layer.querySelectorAll('.edge-label'))fitText(label,Number(label.getAttribute('data-fit-width'))||200);
}
function applyView(){$('diagram').setAttribute('viewBox',[view.x,view.y,view.width,view.height].join(' '))}
function fit(){view={...dimensions};applyView()}
function zoom(factor){const nw=view.width*factor,nh=view.height*factor;if(nw<200||nw>dimensions.width*5)return;view.x+=(view.width-nw)/2;view.y+=(view.height-nh)/2;view.width=nw;view.height=nh;applyView()}
function details(){const g=getGraph(),d=$('detail');d.replaceChildren();const first=h('section'),second=h('section');d.append(first,second);const n=g.nodes.find(x=>x.id===selected);first.append(h('div',n?'Selected component':'About this graph','eyebrow'));first.append(h('h2',n?n.label||n.name||n.id:'A view of the evidence'));
 if(n){first.append(h('code',n.id));addSection(first,'Meaning',n.reason||n.description||(n.kind==='binding'?'A configured use of a package. Its routes remain distinct from other uses of the same package.':n.kind==='grant'?'A configured host resource. Policy values and credentials are not shown.':n.kind==='unknown'?'The available source does not establish this target.':n.kind==='external'?'This package is referenced, but its contents are outside this source snapshot.':isRuntime()?'An element reported by the runtime’s compiled description.':'A reusable method. Its internal ordering and decisions are not represented here.'));
 if(n.kind==='flow'&&n.runnable===false)first.append(h('div','This package is not a direct Run target in the lock. A Binding may configure a separate use.','notice'));
 const routes=g.edges.filter(e=>edgeFrom(e)===n.id);addSection(first,isRuntime()?'Declared links':'Configured calls');if(!routes.length)first.append(h('p','No outgoing relationships are represented in this view.'));for(const e of routes){const target=g.nodes.find(x=>x.id===edgeTo(e));const row=h('div',undefined,'route');row.append(h('strong',edgeLabel(e)));row.append(h('div',target?.label||target?.name||edgeTo(e)));row.append(h('small',e.meaning==='may-invoke'?'May invoke · ordering unspecified':e.meaning));if(e.attachments)row.append(h('p','File ports: '+Object.keys(e.attachments).join(', ')));first.append(row)}
 const exits=scopeExits(g,n);if(exits?.length){addSection(first,'Declared scope exits');for(const exit of exits)first.append(h('span',exit,'pill'));first.append(h('p','The description does not identify every callback that can emit these exits.'))}
 const source=nodeSource(n);if(source&&typeof source==='object'){addSection(second,'Source');second.append(h('code',source.path||source.file||JSON.stringify(source)));if(source.line)second.append(h('p','Line '+source.line+(source.column?' · column '+source.column:'')));}
 if(n.packagePath){addSection(second,'Package');second.append(h('code',n.packagePath))}if(n.packageDigest){addSection(second,'Recorded package digest');second.append(h('code',n.packageDigest));second.append(h('p','The viewer has not verified these package bytes.'))}
 }else first.append(h('p',DATA[current].summary||'Select a component to inspect its declared relationships.'));
 const selectedRun=runIndex===''?null:g.runs[Number(runIndex)];if(selectedRun){addSection(second,'Actual probe observations');const list=h('div',undefined,'trace');const observations=selectedRun.observations||[];observations.forEach((entry,i)=>{const row=h('div',undefined,'trace-item');row.append(h('span',String(i+1)));row.append(h('div',typeof entry==='string'?entry:entry.label||entry.name||entry.nodeId||entry.elementId||JSON.stringify(entry)));list.append(row)});second.append(list);if(selectedRun.outcome)second.append(h('p','Result: '+selectedRun.outcome));}
 const warnings=(g.warnings||[]).filter(w=>!n||!w.node||w.node===n.id);if(warnings.length){addSection(second,'What remains unknown');for(const w of warnings.slice(0,8))second.append(h('div',warningText(w),'notice'));if(warnings.length>8)second.append(h('p',(warnings.length-8)+' more diagnostics are included in the JSON.'))}
 const ev=h('div',undefined,'evidence'),evidence=evidenceText(g);ev.append(h('strong',evidence.heading));ev.append(h('div',evidence.text));if(DATA[current].revision)ev.append(h('div','Source revision '+DATA[current].revision.slice(0,12)));second.append(ev);
}
function choose(index){current=index;selected=null;runIndex='';const item=DATA[current],g=item.graph;$('graph-title').textContent=item.title;$('graph-kind').textContent=isRuntime()?'Experiment 02 / runtime-owned structure':g.provenance?.source==='jig.lock'?'Experiment 01 / configured composition':'Experiment 01 / composition from source';$('summary').textContent=item.summary||'';const stats=$('stats');stats.replaceChildren();for(const [value,label] of [[g.nodes.length,'components'],[g.edges.length,'relationships'],[(g.warnings||[]).length,'diagnostics']]){const el=h('div',undefined,'stat');el.append(h('strong',String(value)),h('span',label));stats.append(el)}
 const legend=$('legend');legend.replaceChildren();for(const [cls,name] of isRuntime()?[['','Runtime element'],['unknown','Dashed: scope entry']]:[['','Flow'],['binding','Binding'],['grant','Resource'],['unknown','External / unknown']]){const span=h('span');span.append(h('i',undefined,'key '+cls),document.createTextNode(name));legend.append(span)}
 $('footer').textContent=isRuntime()?'Solid links come from the supplied runtime description. Dashed links mark scope entry. Scope exit names are shown in component details; callback-to-exit paths are not inferred.':'Each arrow means “may invoke through this slot.” A diagram from authored source is unreviewed. Internal order, branches, concurrency, repeats, and approval remain unspecified.';
 const select=$('run-select');select.replaceChildren(new Option('Declared topology only',''));(g.runs||[]).forEach((r,i)=>select.add(new Option(r.title||r.label||r.name,String(i))));$('runs').style.display=g.runs?.length?'flex':'none';document.querySelectorAll('.example').forEach((b,i)=>{b.classList.toggle('active',i===index);b.setAttribute('aria-current',i===index?'true':'false')});layout(g);draw();fit();details();
}
DATA.forEach((item,i)=>{const button=h('button',undefined,'example');button.append(h('strong',item.title),h('small',item.subtitle||'Authored composition'));button.addEventListener('click',()=>choose(i));$('examples').append(button)});
$('zoom-in').onclick=()=>zoom(.8);$('zoom-out').onclick=()=>zoom(1.25);$('fit').onclick=fit;$('run-select').onchange=()=>{runIndex=$('run-select').value;draw();details()};
$('export').onclick=()=>{const blob=new Blob([JSON.stringify(getGraph(),null,2)+'\n'],{type:'application/json'}),url=URL.createObjectURL(blob),a=h('a');a.href=url;a.download=(DATA[current].id||'flow-graph')+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)};
$('diagram').addEventListener('pointerdown',e=>{if(e.target.closest('.graph-node'))return;drag={x:e.clientX,y:e.clientY,view:{...view}};$('diagram').setPointerCapture(e.pointerId)});$('diagram').addEventListener('pointermove',e=>{if(!drag)return;const r=$('diagram').getBoundingClientRect(),scale=Math.max(drag.view.width/r.width,drag.view.height/r.height);view.x=drag.view.x-(e.clientX-drag.x)*scale;view.y=drag.view.y-(e.clientY-drag.y)*scale;applyView()});$('diagram').addEventListener('pointerup',()=>drag=null);$('diagram').addEventListener('pointercancel',()=>drag=null);$('diagram').addEventListener('wheel',e=>{if(!e.ctrlKey&&!e.metaKey)return;e.preventDefault();zoom(e.deltaY>0?1.1:.9)},{passive:false});
choose(0);
</script></body></html>`
}
