import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

// These are two real implementations, not a substitute for an unavailable design mockup.
const output = resolve(process.argv[2])
const [baseline, current] = await Promise.all(
  ['baseline', 'current'].map(async (name) =>
    JSON.parse(await readFile(resolve(output, name, 'manifest.json'), 'utf8')),
  ),
)
assert(baseline.completed && current.completed, 'Both capture matrices must complete')
assert.equal(baseline.fixtureRevision, current.fixtureRevision, 'Use identical fixture source')
const key = (entry) => JSON.stringify([entry.material, entry.viewport, entry.theme])
assert.deepEqual(
  baseline.entries.map(key),
  current.entries.map(key),
  'Match every viewport and theme',
)
const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  )
const sections = current.entries
  .map((entry, index) => {
    const before = baseline.entries[index]
    for (const file of [before.file, entry.file]) assert(/^[a-z0-9-]+\.png$/.test(file))
    const missingMedia = before.unavailableMedia?.length
      ? ` · unavailable baseline preview: ${escape(before.unavailableMedia.join('; '))}`
      : before.loadingIncomplete
        ? ' · baseline media did not finish loading'
        : ''
    return `<section><h2>${escape(entry.material)} · ${entry.viewport.width}px · ${escape(entry.theme)}</h2><div class="pair"><figure><figcaption>Before #97 · ${escape(baseline.sourceRevision.slice(0, 8))}${before.unsupportedFocus ? ' · this focus control did not exist' : ''}${missingMedia}</figcaption><a href="baseline/${before.file}"><img loading="lazy" src="baseline/${before.file}" alt="Baseline ${escape(entry.material)}"></a></figure><figure><figcaption>Current · ${escape(current.sourceRevision.slice(0, 8))}</figcaption><a href="current/${entry.file}"><img loading="lazy" src="current/${entry.file}" alt="Current ${escape(entry.material)}"></a></figure></div></section>`
  })
  .join('\n')
await writeFile(
  resolve(output, 'index.html'),
  `<!doctype html><html lang="en"><meta charset="utf-8"><title>Workbench implementation comparison</title><style>body{font:14px system-ui;margin:24px;background:#eee;color:#222}.pair{display:grid;grid-template-columns:1fr 1fr;gap:16px}figure{margin:0;min-width:0}img{width:100%;height:auto}figcaption{padding:8px}section{margin-bottom:40px}h1{font-size:24px}h2{font-size:18px}</style><h1>Workbench implementation comparison</h1><p>Identical observations, viewports and themes. This compares real versions before and after #97 against the written design requirements; it does not assert similarity to an unavailable original mockup. Open each image for full-size inspection.</p>${sections}</html>`,
)
console.log(`Compared ${current.entries.length} matched states`)
