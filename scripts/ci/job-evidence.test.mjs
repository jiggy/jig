import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import {
  collectJobEvidence,
  executionInventory,
  observedCount,
  writeJobEvidence,
} from './job-evidence.mjs'

const source = '1'.repeat(40)
const helper = resolve(import.meta.dirname, 'job-evidence.mjs')
const nodeReport =
  '# tests 3\n# suites 0\n# pass 3\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n# duration_ms 10.0\n'
const bunReport =
  'bun test v1.3.3\n\npackages/jig/test/file-input.test.ts:\n(pass) portable [1.00ms]\n\n 1 pass\n 0 fail\n 4 expect() calls\nRan 1 test across 1 file. [10.00ms]\n'
const pythonReport =
  'test_example (consumer.Test) ... ok\n\n----------------------------------------------------------------------\nRan 3 tests in 0.010s\n\nOK\n'
const sourceProfile = 'ubuntu-24.04/bun-1.3.3/node-24/python-3.13'
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'jig-job-evidence-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  async function put(path, value) {
    const location = join(root, path)
    await mkdir(dirname(location), { recursive: true })
    await writeFile(location, typeof value === 'string' ? value : JSON.stringify(value))
    return location
  }
  return { root, put, json: async (path) => JSON.parse(await readFile(join(root, path), 'utf8')) }
}
const xml = (cases) =>
  `<testsuites tests="${[...cases.matchAll(/<testcase\b/g)].length}"><testsuite tests="999"><testsuite>${cases}</testsuite></testsuite></testsuites>`
const testcase = (name, child = '') =>
  `<testcase name="${name}" classname="suite" file="packages/jig/test/portable.test.ts" line="1">${child}</testcase>`

test('full source Python proof requires its exact files and the positive reporting suite', async (t) => {
  const f = await fixture(t)
  const files = [
    'packages/jiggy-flow/tests/test_one.py',
    'packages/jiggy-reporting/tests/test_two.py',
  ]
  const text =
    pythonReport + files.map((file) => `CI Python source file complete: ${file}\n`).join('')
  const transcript = await f.put('python.txt', text)
  assert.equal(
    (await observedCount({ transcript, targetId: 'source-python', testFiles: files })).count,
    3,
  )
  for (const bad of [
    text.replace(files[0], 'foreign.py'),
    text + `CI Python source file complete: ${files[0]}\n`,
    pythonReport,
    text.replace('OK\n', 'FAILED (failures=1)\n'),
  ]) {
    await f.put('python.txt', bad)
    await assert.rejects(() =>
      observedCount({ transcript, targetId: 'source-python', testFiles: files }),
    )
  }
})

test('full evidence writer binds current source and refuses unknown profiles or replacement', async (t) => {
  const f = await fixture(t)
  const transcript = await f.put('quick.txt', nodeReport)
  const output = join(f.root, 'quick.json')
  await writeJobEvidence({ id: 'quick-checks', transcript, output })
  assert.equal((await f.json('quick.json')).source, executionInventory().source)
  await assert.rejects(() => writeJobEvidence({ id: 'quick-checks', transcript, output }), /EEXIST/)
  await assert.rejects(() => writeJobEvidence({ id: 'unknown', transcript, output }), /Unknown/)
  for (const profiles of [['flow', 'flow'], ['unknown']])
    await assert.rejects(() => writeJobEvidence({ id: 'sites', profiles, transcript, output }))
})

test('full aggregate refuses missing, stale, skipped, cancelled and duplicate profile evidence', async (t) => {
  const f = await fixture(t)
  const inventory = executionInventory({ scope: 'ci' })
  const statuses = Object.fromEntries(inventory.targets.map((target) => [target.id, 'success']))
  const resultsPath = await f.put('statuses.json', statuses)
  const rows = inventory.targets.flatMap((target) =>
    target.runtimeProfiles.map((profile) => ({
      id: target.id,
      status: 'success',
      inventoryDigest: target.inventoryDigest,
      executedCount: 1,
      basis: 'test-cases',
      unexpectedSkips: 0,
      observedSkipped: 0,
      profiles: [profile],
      artifactsVerified: true,
      residueVerified: true,
    })),
  )
  const report = { schemaVersion: 1, source: inventory.source, results: rows }
  const collect = (output) =>
    collectJobEvidence({
      directory: join(f.root, 'reports'),
      resultsPath,
      output: join(f.root, output),
    })
  await f.put('reports/proof.json', report)
  await collect('complete.json')
  assert.equal((await f.json('complete.json')).results.length, inventory.targets.length)
  for (const changed of [
    { ...report, source: '2'.repeat(40) },
    { ...report, results: rows.slice(1) },
    { ...report, results: [...rows, rows[0]] },
    { ...report, results: [{ ...rows[0], executedCount: 0 }, ...rows.slice(1)] },
    { ...report, results: [{ ...rows[0], observedSkipped: 1 }, ...rows.slice(1)] },
  ]) {
    await f.put('reports/proof.json', changed)
    await assert.rejects(() => collect('refused.json'))
  }
  await f.put('reports/proof.json', report)
  for (const state of ['failure', 'cancelled', 'skipped']) {
    await f.put('statuses.json', { ...statuses, [inventory.targets[0].id]: state })
    await assert.rejects(() => collect('refused.json'), /did not succeed/)
  }
})

test('mixed successful Node, Bun and Python reports count cases, not job statuses', async (t) => {
  const f = await fixture(t)
  const transcript = await f.put('full.txt', nodeReport + bunReport + pythonReport)
  const observed = await observedCount({ transcript })
  assert.equal(observed.count, 7)
  assert.equal(observed.skipped, 0)
  assert.equal(observed.basis, 'test-cases')
})

test('failed or cancelled Node, Bun and unittest reports fail despite positive pass counts', async (t) => {
  const f = await fixture(t)
  for (const [i, text] of [
    nodeReport.replace('# fail 0', '# fail 1'),
    nodeReport.replace('# cancelled 0', '# cancelled 1'),
    bunReport.replace('0 fail', '1 fail'),
    pythonReport.replace('\nOK\n', '\nFAILED (errors=1)\n'),
  ].entries()) {
    const transcript = await f.put(`failed-${i}.txt`, text)
    await assert.rejects(() => observedCount({ transcript }))
  }
})

test('nested JUnit counts passed cases and refuses every skipped registration', async (t) => {
  const f = await fixture(t)
  const junit = await f.put('report.xml', xml(testcase('runs') + testcase('also runs')))
  const observed = await observedCount({ junit })
  assert.equal(observed.count, 2)
  assert.equal(observed.skipped, 0)
  assert.equal(observed.skippedCases, undefined)
  await f.put('report.xml', xml(testcase('runs') + testcase('conditional', '<skipped/>')))
  await assert.rejects(() => observedCount({ junit }))
  await f.put(
    'report.xml',
    xml(testcase('runs')).replace('<testsuite tests="999">', '<testsuite tests="999" skipped="1">'),
  )
  await assert.rejects(() => observedCount({ junit }))
})

test('JUnit failures, errors, incomplete totals and arbitrary roots are not successful test proof', async (t) => {
  const f = await fixture(t)
  for (const [i, text] of [
    xml(testcase('runs') + testcase('broken', '<failure/>')),
    xml(testcase('runs') + testcase('broken', '<error/>')),
    xml(testcase('runs')).replace('<testsuites tests="1">', '<testsuites tests="2">'),
    `<not-a-test-report>${testcase('runs')}</not-a-test-report>`,
    xml(''),
    xml(testcase('   ')),
  ].entries()) {
    const junit = await f.put(`bad-${i}.xml`, text)
    await assert.rejects(() => observedCount({ junit }))
  }
})

test('JUnit case identity cannot receive duplicate credit through a changed report line', async (t) => {
  const f = await fixture(t)
  for (const [index, second] of [
    testcase('runs'),
    testcase('runs').replace('line="1"', 'line="999"'),
  ].entries()) {
    const junit = await f.put(`repeated-${index}.xml`, xml(testcase('runs') + second))
    await assert.rejects(() => observedCount({ junit }))
  }
  const distinct = await f.put(
    'distinct.xml',
    xml(testcase('runs') + testcase('another registration')),
  )
  assert.equal((await observedCount({ junit: distinct })).count, 2)
})

test('source evidence observes complete Python suites and rejects prerequisite skips outside Bun JUnit', async (t) => {
  const f = await fixture(t)
  const junit = await f.put('source.xml', xml(testcase('runs')))
  const pythonTranscript = await f.put('source.txt', pythonReport)
  assert.equal((await observedCount({ junit, pythonTranscript })).count, 4)
  for (const text of [
    pythonReport.repeat(3),
    pythonReport.repeat(3) + pythonReport.replace('OK\n', 'OK (skipped=1)\n'),
    pythonReport.repeat(3) + pythonReport.replace('OK\n', 'FAILED (errors=1)\n'),
  ]) {
    await f.put('source.txt', text)
    await assert.rejects(() => observedCount({ junit, pythonTranscript }))
  }
})

test('site proof requires nonempty HTML from each explicitly claimed site', async (t) => {
  const f = await fixture(t)
  const pages = join(f.root, 'sites')
  await f.put('sites/flow/index.html', '<html>flow</html>')
  await assert.rejects(() => observedCount({ pages, profiles: ['flow', 'jig'] }))
  await f.put('sites/jig/index.html', '<html>jig</html>')
  assert.equal((await observedCount({ pages, profiles: ['flow', 'jig'] })).count, 2)
  await f.put('sites/jig/index.html', '')
  await assert.rejects(() => observedCount({ pages, profiles: ['flow', 'jig'] }))
})

test('Python build proof requires exactly one nonempty wheel and sdist per claimed package', async (t) => {
  const f = await fixture(t)
  const archives = join(f.root, 'archives')
  const profiles = ['jiggy-flow', 'jiggy-reporting']
  await f.put('archives/jiggy_flow-1.0.whl', 'wheel')
  await f.put('archives/jiggy_flow-1.0.tar.gz', 'sdist')
  await assert.rejects(() => observedCount({ archives, profiles }))
  await f.put('archives/jiggy_reporting-1.0.whl', 'wheel')
  await f.put('archives/jiggy_reporting-1.0.tar.gz', 'sdist')
  assert.equal((await observedCount({ archives, profiles })).count, 4)
  await f.put('archives/jiggy_reporting-1.0.whl', '')
  await assert.rejects(() => observedCount({ archives, profiles }), /Empty/)
  await f.put('archives/jiggy_reporting-1.0.whl', 'wheel')
  await f.put('archives/jiggy_flow-2.0.whl', 'extra')
  await assert.rejects(() => observedCount({ archives, profiles }), /wheel\/sdist pair/)
})

test('built page and archive evidence refuse symbolic links', async (t) => {
  const f = await fixture(t)
  await f.put('outside.html', '<html/>')
  await mkdir(join(f.root, 'pages'))
  await symlink(join(f.root, 'outside.html'), join(f.root, 'pages/index.html'))
  await assert.rejects(() => observedCount({ pages: join(f.root, 'pages') }), /links/)
  await mkdir(join(f.root, 'archives'))
  await symlink(join(f.root, 'outside.html'), join(f.root, 'archives/archive.whl'))
  await assert.rejects(() => observedCount({ archives: join(f.root, 'archives') }), /links/)
})

test('candidate execution requires the exact source, package profile and complete distinct obligations', async (t) => {
  const f = await fixture(t)
  const good = {
    schemaVersion: 1,
    commit: source,
    package: '@jigging/flow',
    gates: ['package-smoke', 'npm-install-import'],
  }
  const qualification = await f.put('candidate.json', good)
  assert.equal((await observedCount({ qualification, source, profiles: ['flow'] })).count, 2)
  const bad = [
    { ...good, commit: '2'.repeat(40) },
    { ...good, schemaVersion: 2 },
    { ...good, package: '@jigging/agent-method' },
    { ...good, gates: [] },
    { ...good, gates: ['package-smoke', 'package-smoke'] },
    { ...good, gates: [''] },
    { ...good, gates: ['package-smoke'] },
  ]
  for (const changed of bad) {
    await f.put('candidate.json', changed)
    await assert.rejects(() => observedCount({ qualification, source, profiles: ['flow'] }))
  }
})

test('Jig candidate evidence requires its six installed gates and refuses credit for Linux-owned baselines', async (t) => {
  const f = await fixture(t)
  const gates = [
    'display-model-package-smoke',
    'display-web-package-smoke',
    'display-tui-package-smoke',
    'package-smoke',
    'npm-local-install-help',
    'npm-global-install-help',
  ]
  const good = { schemaVersion: 1, commit: source, package: '@jigging/jig', gates }
  const qualification = await f.put('jig-candidate.json', good)
  assert.deepEqual(await observedCount({ qualification, source, profiles: ['jig'] }), {
    count: 6,
    skipped: 0,
    basis: 'qualified-artifacts',
  })
  const refused = [
    gates.slice(3),
    ...gates.map((_, index) => gates.filter((__, candidate) => candidate !== index)),
    [...gates, gates[0]],
    [gates[0], gates[0], ...gates.slice(2)],
    [...gates].reverse(),
    [...gates, 'display-unknown-package-smoke'],
    [...gates.slice(0, 4), 'operational-baseline-1', ...gates.slice(4)],
    [...gates.slice(0, 4), 'installed-hostile-baseline', ...gates.slice(4)],
    [
      ...gates.slice(0, 4),
      'operational-baseline-1',
      'installed-hostile-baseline',
      ...gates.slice(4),
    ],
  ]
  for (const omittedOrRepeated of refused) {
    await f.put('jig-candidate.json', { ...good, gates: omittedOrRepeated })
    await assert.rejects(
      () => observedCount({ qualification, source, profiles: ['jig'] }),
      /Incomplete candidate profile obligations/,
    )
  }
})

test('Mac summary requires completed source-bound canonical validation', async (t) => {
  const f = await fixture(t)
  const good = {
    qualified: true,
    revision: source,
    architecture: 'x64',
    failures: 0,
    errors: [],
    executed: 2,
    skipped_reports: 0,
    shards: [
      { shard: 0, executed: 1, failures: 0, skipped_reports: 0 },
      { shard: 1, executed: 1, failures: 0, skipped_reports: 0 },
    ],
  }
  const summary = await f.put('summary.json', good)
  assert.equal((await observedCount({ summary, source, targetId: 'macos-x64' })).count, 2)
  for (const changed of [
    { ...good, qualified: false },
    { ...good, qualified: undefined },
    { ...good, revision: '2'.repeat(40) },
    { ...good, architecture: 'arm64' },
    { ...good, failures: 1 },
    { ...good, errors: ['missing shard'] },
  ]) {
    await f.put('summary.json', changed)
    await assert.rejects(
      () => observedCount({ summary, source, targetId: 'macos-x64' }),
      /Failed or stale/,
    )
  }
})

test('per-command Bun manifests require complete distinct whole files without skip permissions', async (t) => {
  const f = await fixture(t)
  const files = ['packages/jig/test/host/one.test.ts', 'packages/jig/test/host/two.test.ts']
  const transcript = (file) =>
    `${file}:\n(pass) selected complete proof [1ms]\n\n1 pass\n0 fail\nRan 1 test across 1 file. [10ms]\n`
  await f.put('logs/yes.txt', transcript(files[0]))
  await f.put('logs/no.txt', transcript(files[1]))
  const commands = [
    { transcript: 'yes.txt', files: [files[0]] },
    { transcript: 'no.txt', files: [files[1]] },
  ]
  const transcriptManifest = await f.put('logs/manifest.json', { schemaVersion: 1, commands })
  const result = await observedCount({ transcriptManifest })
  assert.equal(result.count, 2)
  assert.equal(result.skipped, 0)
  assert.equal(result.skippedCases, undefined)
  await f.put('logs/manifest.json', { schemaVersion: 1, commands: [commands[0], commands[0]] })
  await assert.rejects(() => observedCount({ transcriptManifest }), /Repeated/)
  await f.put('logs/manifest.json', {
    schemaVersion: 1,
    commands: [{ ...commands[0], filter: { file: files[0], pattern: '^' } }],
  })
  await assert.rejects(() => observedCount({ transcriptManifest }), /without filters/)
  await f.put('logs/manifest.json', { schemaVersion: 1, commands: [commands[0]] })
  await f.put(
    'logs/yes.txt',
    transcript(files[0]).replace('1 pass\n0 fail', '1 pass\n1 skip\n0 fail'),
  )
  await assert.rejects(() => observedCount({ transcriptManifest }), /skipped/)
})

test('transcript manifests refuse path escape, links and relabeling tests as installed scripts', async (t) => {
  const f = await fixture(t)
  await f.put('outside.txt', bunReport)
  await f.put('logs/local.txt', bunReport)
  await symlink(join(f.root, 'outside.txt'), join(f.root, 'logs/link.txt'))
  const transcriptManifest = await f.put('logs/manifest.json', {})
  const commands = [
    { transcript: '../outside.txt', files: ['packages/jig/test/file-input.test.ts'] },
    { transcript: 'link.txt', files: ['packages/jig/test/file-input.test.ts'] },
    {
      transcript: 'local.txt',
      files: ['packages/jig/test/file-input.test.ts'],
      commandKind: 'installed-script',
    },
  ]
  for (const command of commands) {
    await f.put('logs/manifest.json', { schemaVersion: 1, commands: [command] })
    await assert.rejects(() => observedCount({ transcriptManifest }))
  }
})

test('installed-script records preserve completion without inventing passes and reject empty/failed output', async (t) => {
  const f = await fixture(t)
  await f.put('logs/tests.txt', bunReport)
  const commands = [
    { transcript: 'tests.txt', files: ['packages/jig/test/file-input.test.ts'] },
    {
      transcript: 'script.txt',
      files: ['packages/jig/test/package-smoke.ts'],
      commandKind: 'installed-script',
    },
  ]
  const transcriptManifest = await f.put('logs/manifest.json', { schemaVersion: 1, commands })
  await f.put(
    'logs/script.txt',
    'installed consumer complete\nCI installed script complete: packages/jig/test/package-smoke.ts\n',
  )
  assert.equal((await observedCount({ transcriptManifest })).count, 1)
  for (const output of ['', 'FAILED (errors=1)\n', '(skip) native installed startup\n']) {
    await f.put('logs/script.txt', output)
    await assert.rejects(() => observedCount({ transcriptManifest }))
  }
})
