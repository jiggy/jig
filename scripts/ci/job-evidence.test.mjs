import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import { collectJobEvidence, observedCount, writeJobEvidence } from './job-evidence.mjs'

const source = '1'.repeat(40)
const helper = resolve(import.meta.dirname, 'job-evidence.mjs')
const nodeReport =
  '# tests 3\n# suites 0\n# pass 3\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n# duration_ms 10.0\n'
const bunReport =
  'bun test v1.3.3\n\npackages/jig/test/file-input.test.ts:\n(pass) portable [1.00ms]\n\n 1 pass\n 0 fail\n 4 expect() calls\nRan 1 test across 1 file. [10.00ms]\n'
const pythonReport =
  'test_example (consumer.Test) ... ok\n\n----------------------------------------------------------------------\nRan 3 tests in 0.010s\n\nOK\n'
const sourceProfile = 'ubuntu-24.04/bun-1.3.3/node-24/python-3.13'
const target = (
  id = 'quick-checks',
  profiles = ['ubuntu-24.04/node-24/bun-1.3.3'],
  selected = true,
) => ({
  id,
  scope: 'ci',
  selected,
  runtimeProfiles: profiles,
  inventoryDigest: `inventory-${id}`,
  omissionReason: selected ? null : 'proven isolated ownership',
})
const plan = (targets = [target()]) => ({
  schemaVersion: 1,
  planDigest: 'plan-identity',
  identity: { head: source },
  targets,
})
const row = (t, profile = t.runtimeProfiles[0]) => ({
  id: t.id,
  status: 'success',
  inventoryDigest: t.inventoryDigest,
  executedCount: 3,
  basis: 'test-cases',
  unexpectedSkips: 0,
  observedSkipped: 0,
  profiles: [profile],
  artifactsVerified: true,
  residueVerified: true,
})
const report = (results) => ({ schemaVersion: 1, source, planDigest: 'plan-identity', results })
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

test('mixed successful Node, Bun and Python reports count cases, not job statuses', async (t) => {
  const f = await fixture(t)
  const transcript = await f.put('full.txt', nodeReport + bunReport + pythonReport)
  const observed = await observedCount({ transcript })
  assert.equal(observed.count, 7)
  assert.equal(observed.skipped, 0)
  assert.equal(observed.basis, 'test-cases')
})

test('Python source proof binds all selected files exactly once and all four positive suites', async (t) => {
  const f = await fixture(t)
  const files = [
    'packages/jiggy-flow/tests/test_one.py',
    'packages/jiggy-reporting/tests/test_two.py',
    'packages/jiggy-flow/tests/test_three.py',
  ]
  const t1 = { ...target('source-python', [sourceProfile]), testInventory: files }
  const planPath = await f.put('plan.json', plan([t1]))
  const markers = files.map((file) => `CI Python source file complete: ${file}\n`).join('')
  const valid = pythonReport.repeat(4) + markers
  const transcript = await f.put('python-source.txt', valid)
  await writeJobEvidence({ planPath, id: t1.id, transcript, output: join(f.root, 'valid.json') })
  assert.equal((await f.json('valid.json')).results[0].executedCount, 12)
  for (const [label, text] of [
    ['missing', valid.replace(`CI Python source file complete: ${files[0]}\n`, '')],
    ['duplicate', valid + `CI Python source file complete: ${files[0]}\n`],
    ['foreign', valid.replace(files[0], 'packages/foreign/tests/test_one.py')],
    ['old-unbound', pythonReport.repeat(4)],
    ['short', pythonReport.repeat(3) + markers],
    ['extra', pythonReport.repeat(5) + markers],
    ['empty-suite', valid.replace('Ran 3 tests', 'Ran 0 tests')],
    ['skipped', valid.replace('OK\n', 'OK (skipped=1)\n')],
    ['failed', valid.replace('OK\n', 'FAILED (failures=1)\n')],
  ]) {
    const bad = await f.put(`${label}.txt`, text)
    await assert.rejects(() =>
      writeJobEvidence({
        planPath,
        id: t1.id,
        transcript: bad,
        output: join(f.root, `${label}.json`),
      }),
    )
  }
  const absentInventory = await f.put(
    'absent-inventory.json',
    plan([target('source-python', [sourceProfile])]),
  )
  await assert.rejects(
    () =>
      writeJobEvidence({
        planPath: absentInventory,
        id: t1.id,
        transcript,
        output: join(f.root, 'absent.json'),
      }),
    /file inventory/,
  )
})

test('Windows CRLF installed Python reporting works with no python3 executable', async (t) => {
  const f = await fixture(t)
  const installed = target('python-installed', [
    'windows-2022/python-3.13',
    'ubuntu-24.04/python-3.14',
  ])
  const planPath = await f.put('plan.json', plan([installed]))
  const transcript = await f.put(
    'windows.txt',
    (pythonReport + pythonReport.replace('Ran 3 tests', 'Ran 5 tests')).replaceAll('\n', '\r\n'),
  )
  execFileSync(
    process.execPath,
    [
      helper,
      '--plan',
      planPath,
      '--id',
      'python-installed',
      '--profile',
      'windows-2022/python-3.13',
      '--transcript',
      transcript,
      '--artifacts',
      '--output',
      join(f.root, 'windows.json'),
    ],
    { env: { ...process.env, PATH: '/no-python-executable' }, stdio: ['ignore', 'pipe', 'pipe'] },
  )
  const result = (await f.json('windows.json')).results[0]
  assert.equal(result.executedCount, 8)
  assert.deepEqual(result.profiles, ['windows-2022/python-3.13'])
  assert.equal(result.artifactsVerified, true)
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

test('terminal completion is required; orphan pass or Ran lines cannot prove execution', async (t) => {
  const f = await fixture(t)
  const planPath = await f.put('plan.json', plan())
  for (const [i, text] of ['# pass 3\n', ' 3 pass\n', 'Ran 3 tests in 0.1s\n'].entries()) {
    const transcript = await f.put(`partial-${i}.txt`, text)
    await assert.rejects(() =>
      writeJobEvidence({
        planPath,
        id: 'quick-checks',
        transcript,
        output: join(f.root, `partial-${i}.json`),
      }),
    )
  }
})

test('zero or all-skipped reports cannot produce successful selected evidence', async (t) => {
  const f = await fixture(t)
  const planPath = await f.put('plan.json', plan())
  for (const [i, text] of [
    nodeReport.replaceAll('3', '0'),
    nodeReport.replace('# pass 3', '# pass 0').replace('# skipped 0', '# skipped 3'),
  ].entries()) {
    const transcript = await f.put(`zero-${i}.txt`, text)
    await assert.rejects(
      () =>
        writeJobEvidence({
          planPath,
          id: 'quick-checks',
          transcript,
          output: join(f.root, `zero-${i}.json`),
        }),
      /nonempty|skipped/,
    )
  }
})

test('unittest skips cannot produce selected installed consumer evidence', async (t) => {
  const f = await fixture(t)
  const t1 = target('python-installed', ['windows-2022/python-3.13'])
  const planPath = await f.put('plan.json', plan([t1]))
  const transcript = await f.put('skipped.txt', pythonReport.replace('OK\n', 'OK (skipped=1)\n'))
  await assert.rejects(() => observedCount({ transcript }), /skipped/)
  await assert.rejects(
    () => writeJobEvidence({ planPath, id: t1.id, transcript, output: join(f.root, 'proof.json') }),
    /skipped/,
  )
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

test('a policy label cannot authorize a newly skipped portable JUnit case', async (t) => {
  const f = await fixture(t)
  const sourceTarget = target('source-portable', [sourceProfile])
  const planPath = await f.put('plan.json', plan([sourceTarget]))
  const junit = await f.put(
    'skips.xml',
    xml(testcase('runs') + testcase('new portable regression', '<skipped/>')),
  )
  for (const skipPolicy of [undefined, 'source-platform-opt-in', 'accept-all-skips'])
    await assert.rejects(() =>
      writeJobEvidence({
        planPath,
        id: 'source-portable',
        junit,
        skipPolicy,
        repository: f.root,
        output: join(f.root, `${skipPolicy}.json`),
      }),
    )
})

test('source evidence observes complete Python suites and rejects prerequisite skips outside Bun JUnit', async (t) => {
  const f = await fixture(t)
  const junit = await f.put('source.xml', xml(testcase('runs')))
  const pythonTranscript = await f.put('source.txt', pythonReport.repeat(4))
  assert.equal((await observedCount({ junit, pythonTranscript })).count, 13)
  for (const text of [
    pythonReport.repeat(3),
    pythonReport.repeat(3) + pythonReport.replace('OK\n', 'OK (skipped=1)\n'),
    pythonReport.repeat(3) + pythonReport.replace('OK\n', 'FAILED (errors=1)\n'),
  ]) {
    await f.put('source.txt', text)
    await assert.rejects(() => observedCount({ junit, pythonTranscript }))
  }
})

test('multi-profile targets require observed explicit profiles and reject unknown or repeated profiles', async (t) => {
  const f = await fixture(t)
  const sites = target('sites', ['flow', 'jig'])
  const planPath = await f.put('plan.json', plan([sites]))
  const transcript = await f.put('full.txt', nodeReport)
  for (const profiles of [undefined, ['flow', 'flow'], ['flow', 'unrecognized']])
    await assert.rejects(() =>
      writeJobEvidence({
        planPath,
        id: 'sites',
        profiles,
        transcript,
        output: join(f.root, 'proof.json'),
      }),
    )
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
  const jig = target('npm-candidate', ['jig'])
  const planPath = await f.put('plan.json', plan([jig]))
  const output = join(f.root, 'evidence/jig.json')
  await mkdir(dirname(output))
  await writeJobEvidence({
    planPath,
    id: jig.id,
    output,
    qualification,
    profile: 'jig',
    artifacts: true,
  })
  const evidence = await f.json('evidence/jig.json')
  assert.equal(evidence.source, source)
  assert.equal(evidence.planDigest, 'plan-identity')
  assert.equal(evidence.results[0].executedCount, 6)
  assert.deepEqual(evidence.results[0].profiles, ['jig'])
  assert.equal(evidence.results[0].artifactsVerified, true)
  const resultsPath = await f.put('statuses.json', { [jig.id]: 'success' })
  await collectJobEvidence({
    planPath,
    directory: dirname(output),
    resultsPath,
    output: join(f.root, 'collected.json'),
  })
  assert.deepEqual(await f.json('collected.json'), {
    ...evidence,
    results: [{ ...evidence.results[0], residueVerified: false }],
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

test('Mac summary needs qualified true, matching source/architecture, and actual owning JUnit evidence', async (t) => {
  const f = await fixture(t)
  const good = {
    qualified: true,
    revision: source,
    architecture: 'x64',
    failures: 0,
    errors: [],
    executed: 2,
    skipped_reports: 0,
  }
  const summary = await f.put('summary.json', good)
  await assert.rejects(
    () => observedCount({ summary, source, targetId: 'macos-x64' }),
    /owning Mac/,
  )
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

test('retained filtered Bun reports cannot qualify a selected whole-file execution', async (t) => {
  const f = await fixture(t)
  const file = 'packages/jig/test/package-provider-host.test.ts'
  const patterns = ['^packed project dependencies ', '^(?!packed project dependencies )']
  for (const name of ['packed', 'ordinary'])
    await f.put(
      `logs/${name}.txt`,
      await readFile(
        new URL(`./fixtures/bun-1.3.3-linux/provider-${name}.txt`, import.meta.url),
        'utf8',
      ),
    )
  const commands = ['packed', 'ordinary'].map((name, index) => ({
    transcript: `${name}.txt`,
    files: [file],
    filter: { file, pattern: patterns[index] },
  }))
  const transcriptManifest = await f.put('logs/manifest.json', { schemaVersion: 1, commands })
  await assert.rejects(() => observedCount({ transcriptManifest }), /without filters/)
  const planPath = await f.put('plan.json', plan())
  await assert.rejects(
    () =>
      writeJobEvidence({
        planPath,
        id: 'quick-checks',
        transcriptManifest,
        output: join(f.root, 'evidence.json'),
      }),
    /without filters/,
  )
  await f.put('logs/manifest.json', {
    schemaVersion: 1,
    commands: [{ transcript: commands[0].transcript, files: [file] }],
  })
  await assert.rejects(() => observedCount({ transcriptManifest }), /filtered/)
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

test('partial display witness requires its exact script completion and real zero-skip observation cases', async (t) => {
  const f = await fixture(t)
  const selected = target('linux-witness', ['ubuntu-24.04/bun-1.3.3/node-24/python-3.13'])
  selected.testInventory = ['packages/jig/test/host/package-provider-observation.test.ts']
  const planPath = await f.put('plan.json', plan([selected]))
  const marker = 'Installed display witness passed with unchanged frozen archives.'
  const script = 'packages/jig/test/installed-display-smoke.ts'
  await f.put('logs/display.txt', `${marker}\n`)
  const command = { transcript: 'display.txt', files: [script], commandKind: 'installed-script' }
  const transcriptManifest = await f.put('logs/manifest.json', {
    schemaVersion: 1,
    commands: [command],
  })
  const observation = (name, child = '') =>
    testcase(name, child).replace('packages/jig/test/portable.test.ts', selected.testInventory[0])
  const junit = await f.put(
    'observation.xml',
    xml(observation('real four-mode installed observation')),
  )
  assert.equal((await observedCount({ transcriptManifest })).count, 0)
  assert.equal((await observedCount({ transcriptManifest, junit })).count, 1)
  await writeJobEvidence({
    planPath,
    id: selected.id,
    junit,
    transcriptManifest,
    artifacts: true,
    residue: true,
    output: join(f.root, 'witness.json'),
  })
  const proof = (await f.json('witness.json')).results[0]
  assert.equal(proof.executedCount, 1)
  assert.equal(proof.observedSkipped, 0)
  assert.equal(proof.artifactsVerified, true)
  assert.equal(proof.residueVerified, true)
  await assert.rejects(
    () =>
      writeJobEvidence({
        planPath,
        id: selected.id,
        transcriptManifest,
        output: join(f.root, 'script-only.json'),
      }),
    /nonempty/,
  )
  for (const output of [
    `${marker}\n${marker}\n`,
    'CI installed script complete: packages/jig/test/package-smoke.ts\n',
    `${marker}\n(skip) skipped display\n`,
  ]) {
    await f.put('logs/display.txt', output)
    await assert.rejects(() => observedCount({ transcriptManifest, junit }))
  }
  await f.put('logs/display.txt', `${marker}\n`)
  await f.put('observation.xml', xml(observation('not executed', '<skipped/>')))
  await assert.rejects(() => observedCount({ transcriptManifest, junit }))
  await f.put('observation.xml', xml(testcase('foreign positive report')))
  await assert.rejects(
    () =>
      writeJobEvidence({
        planPath,
        id: selected.id,
        junit,
        transcriptManifest,
        output: join(f.root, 'foreign.json'),
      }),
    /selected target inventory/,
  )
  await f.put('observation.xml', xml(observation('real observation')))
  await f.put('logs/tests.txt', bunReport)
  await f.put('logs/manifest.json', {
    schemaVersion: 1,
    commands: [{ transcript: 'tests.txt', files: ['packages/jig/test/file-input.test.ts'] }],
  })
  await assert.rejects(() => observedCount({ transcriptManifest, junit }), /one owning/)
})

test('writer refuses omitted targets and overwriting evidence from a prior attempt', async (t) => {
  const f = await fixture(t)
  const planPath = await f.put(
    'plan.json',
    plan([target(), target('sites', ['flow', 'jig'], false)]),
  )
  const transcript = await f.put('full.txt', nodeReport)
  await assert.rejects(
    () =>
      writeJobEvidence({ planPath, id: 'sites', transcript, output: join(f.root, 'sites.json') }),
    /selected target/,
  )
  const output = join(f.root, 'quick.json')
  await writeJobEvidence({ planPath, id: 'quick-checks', transcript, output })
  await assert.rejects(
    () => writeJobEvidence({ planPath, id: 'quick-checks', transcript, output }),
    /EEXIST/,
  )
})

test('collection reconciles actual profile rows and explicit authorized omissions', async (t) => {
  const f = await fixture(t)
  const selected = target('python-installed', [
    'windows-2022/python-3.13',
    'ubuntu-24.04/python-3.14',
  ])
  const omitted = target('sites', ['flow', 'jig'], false)
  const planPath = await f.put('plan.json', plan([selected, omitted]))
  const resultsPath = await f.put('results.json', {
    'python-installed': 'success',
    sites: 'skipped',
  })
  await f.put('reports/windows/report.json', report([row(selected, selected.runtimeProfiles[0])]))
  await f.put('reports/linux/report.json', report([row(selected, selected.runtimeProfiles[1])]))
  const output = join(f.root, 'collected.json')
  await collectJobEvidence({ planPath, directory: join(f.root, 'reports'), resultsPath, output })
  const evidence = await f.json('collected.json')
  assert.equal(evidence.results[0].executedCount, 6)
  assert.equal(evidence.results[0].observedFiltered, undefined)
  assert.equal(evidence.results[0].observedSkipped, 0)
  assert.deepEqual(evidence.results[0].profiles.sort(), [...selected.runtimeProfiles].sort())
  assert.deepEqual(evidence.results[1], {
    id: 'sites',
    status: 'skipped',
    omissionReason: omitted.omissionReason,
  })
})

test('collection rejects missing, failed, cancelled, stale, empty and duplicate profile proof', async (t) => {
  const f = await fixture(t)
  const selected = target()
  const planPath = await f.put('plan.json', plan([selected]))
  const resultsPath = await f.put('results.json', { 'quick-checks': 'success' })
  await mkdir(join(f.root, 'reports'))
  const collect = () =>
    collectJobEvidence({
      planPath,
      directory: join(f.root, 'reports'),
      resultsPath,
      output: join(f.root, 'collected.json'),
    })
  await assert.rejects(collect, /Missing execution reports/)
  const good = report([row(selected)])
  for (const changed of [
    { ...good, source: '2'.repeat(40) },
    { ...good, planDigest: 'stale' },
    { ...good, schemaVersion: 2 },
    report([{ ...row(selected), executedCount: 0 }]),
    ...[1, -1, null, undefined, '0'].map((observedSkipped) =>
      report([{ ...row(selected), observedSkipped }]),
    ),
    report([{ ...row(selected), unexpectedSkips: 1 }]),
    report([{ ...row(selected), observedFiltered: 1 }]),
    report([{ ...row(selected), skipPolicy: 'source-platform-opt-in' }]),
    report([{ ...row(selected), skippedCases: [] }]),
    report([{ ...row(selected), skippedCaseDigest: 'legacy-proof' }]),
    report([{ ...row(selected), profiles: [] }]),
    report([{ ...row(selected), profiles: ['foreign-profile'] }]),
    report([{ ...row(selected), status: 'skipped' }]),
    report([row(selected), row(selected)]),
    report([{ ...row(selected), id: 'unknown' }]),
  ]) {
    await f.put('reports/proof.json', changed)
    await assert.rejects(collect)
  }
  await f.put('reports/proof.json', good)
  for (const status of ['failure', 'cancelled', 'skipped', undefined]) {
    await f.put('results.json', { 'quick-checks': status })
    await assert.rejects(collect, /did not succeed/)
  }
})

test('an omitted target requires a skipped job status alongside successful selected proof', async (t) => {
  const f = await fixture(t)
  const selected = target()
  const omitted = target('sites', ['flow', 'jig'], false)
  const planPath = await f.put('plan.json', plan([selected, omitted]))
  await f.put('reports/quick.json', report([row(selected)]))
  const resultsPath = await f.put('results.json', { 'quick-checks': 'success', sites: 'success' })
  await assert.rejects(
    () =>
      collectJobEvidence({
        planPath,
        resultsPath,
        directory: join(f.root, 'reports'),
        output: join(f.root, 'proof.json'),
      }),
    /Unexpected execution/,
  )
})
