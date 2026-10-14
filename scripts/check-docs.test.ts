import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, copyFileSync, readFileSync, renameSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { headingIds, linkFindings, metadataFindings, renderedFindings, styleFindings } from './check-docs'

const roots: string[] = []
function fixture() { const directory = mkdtempSync(join(tmpdir(), 'jig-doc-check-')); roots.push(directory); return directory }
function put(root: string, path: string, text: string) {
  const destination = join(root, path)
  mkdirSync(resolve(destination, '..'), { recursive: true })
  writeFileSync(destination, text)
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

test('metadata permits custom landing layouts and refuses collapsed or invalid YAML', () => {
  expect(metadataFindings('page.md', '---\ntitle: Landing\n---\n<div>Landing</div>')).toEqual([])
  expect(metadataFindings('page.md', '# Specification\n')).toEqual([])
  for (const text of ['--- title: Landing ---\n', '---\ntitle: [broken\n---\n', '---\ntitle: ""\n---\n', 'No heading.']) {
    expect(metadataFindings('page.md', text).length).toBeGreaterThan(0)
  }
})
test('links check decoded paths, duplicate headings, references and actual anchors', () => {
  const root = fixture()
  put(root, 'Other Page.md', '# Terms\n## Same\n## Same\n')
  put(root, 'page.md', '# Here\n')
  const valid = '[target](Other%20Page.md#same-1)\n[reference]: Other%20Page.md#terms\n'
  expect(linkFindings('page.md', valid, root)).toEqual([])
  expect(linkFindings('page.md', '[missing](absent.md)\n[target](Other%20Page.md#absent)', root)).toHaveLength(2)
  expect(linkFindings('page.md', '```md\n[example](absent.md)\n```', root)).toEqual([])
})
test('shorter nested fences cannot expose example headings or links', () => {
  const text = '````md\n```ts\n# Example\n```\n[example](absent.md)\n````\n# Actual `value`\n'
  expect(headingIds(text)).toEqual(new Set(['actual-value']))
  expect(headingIds('---\ntitle: Hidden\n---\n# Actual\n')).toEqual(new Set(['actual']))
  expect(linkFindings('page.md', text, fixture())).toEqual([])
})
test('style checks preserve inherited paragraphs but reject additional copies and changed text', () => {
  const sentence = 'This description contains ' + 'additional '.repeat(26) + 'words.'
  const baseline = '# Heading\n\n' + sentence + '\n'
  expect(styleFindings('AGENTS.md', baseline, baseline)).toEqual([])
  expect(styleFindings('AGENTS.md', baseline + '\n' + sentence, baseline)).toHaveLength(1)
  expect(styleFindings('AGENTS.md', baseline.replace('description', 'instruction'), baseline)).toHaveLength(1)
})
test('style protects literal code while checking sentence and paragraph bounds', () => {
  expect(styleFindings('AGENTS.md', 'Use `foo; bar` with `version.1.2`.')).toEqual([])
  expect(styleFindings('AGENTS.md', 'Use the command; then inspect it.')).toHaveLength(1)
  expect(styleFindings('AGENTS.md', 'Check ' + 'all '.repeat(20) + 'values.')).toHaveLength(1)
  expect(styleFindings('AGENTS.md', 'A fact. '.repeat(7))).toHaveLength(1)
})
test('rendered checks verify cross-site routes, assets and actual emitted IDs', () => {
  const root = fixture()
  put(root, 'flow/index.html', '<h1 id="flow">FLOW</h1><a href="https://jig.md/guide/">Jig</a>')
  put(root, 'jig/index.html', '<h1 id="home">Jig</h1>')
  put(root, 'jig/guide/index.html', '<h1 id="guide">Guide</h1><a href="https://flow.jig.md/#flow">FLOW</a><img src="/mark.svg">')
  put(root, 'jig/mark.svg', '<svg/>')
  expect(renderedFindings(root)).toEqual([])
  put(root, 'jig/index.html', '<a href="/absent">Missing</a><a href="/guide/#absent">Wrong anchor</a>')
  expect(renderedFindings(root)).toHaveLength(2)
})
test('a missing built site cannot silently pass', () => {
  expect(() => renderedFindings(fixture())).toThrow('Missing built flow site')
})
test('the actual CLI rejects invalid baselines and checks new files against Git', () => {
  const root = fixture()
  const script = join(root, 'scripts/check-docs.ts')
  mkdirSync(join(root, 'scripts'))
  copyFileSync(resolve(import.meta.dirname, 'check-docs.ts'), script)
  put(root, 'docs/jig/guide/page.md', '# A page\n\nUse the command.\n')
  put(root, 'docs/jig/guide/legacy.md', '# Legacy\n\nThis sentence contains ' + 'additional '.repeat(26) + 'words.\n')
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'pipe' })
  git('init', '-q'); git('add', '.'); git('-c', 'user.name=Documentation check', '-c', 'user.email=docs@example.invalid', 'commit', '-qm', 'Baseline')
  const run = (...args: string[]) => spawnSync(process.execPath, [script, ...args], {
    cwd: root, encoding: 'utf8', env: { ...process.env, GITHUB_ACTIONS: '', DOCS_BASE_REVISION: '' },
  })
  expect(run().status).toBe(0)
  renameSync(join(root, 'docs/jig/guide/legacy.md'), join(root, 'docs/jig/guide/moved.md'))
  expect(run().status).toBe(0) // Moving an unchanged paragraph does not add a violation.
  expect(run('--base', 'not-a-commit').status).not.toBe(0)
  put(root, 'docs/jig/guide/new.md', '# New page\n\nRead the guide; start the work.\n')
  const failed = run()
  expect(failed.status).toBe(1)
  expect(failed.stderr).toContain('Remove prose semicolons')
})

test('CI checks source and rendered documentation before recording site success', () => {
  const workflow = Bun.YAML.parse(readFileSync(resolve(import.meta.dirname, '../.github/workflows/ci.yml'), 'utf8')) as any
  const steps = workflow.jobs.sites.steps
  const source = steps.findIndex((step: any) => step.run?.includes('bun test scripts/check-docs.test.ts'))
  const rendered = steps.findIndex((step: any) => step.run?.includes('bun scripts/check-docs.ts --sites'))
  const evidence = steps.findIndex((step: any) => step.run?.includes('job-evidence.mjs'))
  expect(source).toBeGreaterThan(-1)
  expect(rendered).toBeGreaterThan(source)
  expect(evidence).toBeGreaterThan(rendered)
  expect(steps[source].env.DOCS_BASE_REVISION).toBe(steps[rendered].env.DOCS_BASE_REVISION)
  expect(workflow.permissions).toEqual({ contents: 'read' })
})
