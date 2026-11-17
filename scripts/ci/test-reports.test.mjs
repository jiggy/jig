import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, test } from 'node:test'
import {
  createFrozenMacPlan,
  INSTALLED_STARTUP_TEST,
  NATIVE_PREREQUISITE_TESTS,
} from './macos-host-test-shards.mjs'
import { parseBunTranscript, readMacReports } from './test-reports.mjs'

const roots = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
const file = 'packages/display-web/test/client.test.ts'
const plain = `bun test v1.4.4\n\n${file}:\n(pass) complete case [1.00ms]\n\n 1 pass\n 0 fail\n 2 expect() calls\nRan 1 test across 1 file. [2.00ms]\n`
const grouped = plain
  .replace(`${file}:`, `::group::${file}:`)
  .replace('\n 1 pass', '\n::endgroup::\n 1 pass')
const prerequisites = (arch) => ({
  kind: 'macos-host-prerequisites/1',
  arch,
  kernel: '24.6.0',
  build: arch === 'arm64' ? '24H232' : '24G830',
  bun: '1.4.4',
  revision: '38afee6c84fcf48c0edb2466aa4b27d287a59c30',
  processIdentityBytes: 56,
  coalitionIdentityBytes: 40,
  coalitionUsageBytes: 296,
  pidVersion: 1,
  backendQualified: false,
})
test('completed plain and GitHub-grouped reports count exact owning cases', () => {
  for (const text of [plain, grouped])
    assert.deepEqual(parseBunTranscript(text, { files: [file] }), {
      count: 1,
      skipped: 0,
      filtered: 0,
      skippedCases: [],
      basis: 'test-cases',
    })
})
test('every selected skip, filter, failure and incomplete or foreign report refuses execution credit', () => {
  for (const text of [
    plain.replace('(pass)', '(skip)'),
    plain.replace('0 fail', '1 fail'),
    plain.replace('1 pass', '0 pass'),
    plain.replace('1 file', '2 files'),
    plain.replace(file, 'packages/display-web/test/foreign.test.ts'),
    plain.replace(' 0 fail', ' 2 filtered out\n 0 fail'),
    plain.replace('Ran 1 test across 1 file. [2.00ms]\n', ''),
    plain + '(pass) late\n',
    plain.replace(
      '(pass) complete case [1.00ms]',
      '(pass) complete case [1.00ms]\n(pass) complete case [2.00ms]',
    ),
  ])
    assert.throws(() => parseBunTranscript(text, { files: [file] }))
  assert.throws(() => parseBunTranscript(plain, { files: [file], filter: { file, pattern: '.*' } }))
  // The retained real mixed report contains skipped registrations; it now fails rather than inheriting a legacy permission table.
  const retained = readFileSync(
    new URL('./fixtures/bun-1.4.4-linux/display-source-github-groups.txt', import.meta.url),
    'utf8',
  )
  assert.throws(() => parseBunTranscript(retained, { files: [file] }))
})
test('GitHub group structure cannot conceal ownership, after-close cases or skipped recaps', () => {
  for (const text of [
    grouped.replace('::endgroup::\n', ''),
    grouped.replace('::group::', '::group::nested\n::group::'),
    grouped.replace('(pass) complete', '::endgroup::\n(pass) complete'),
    grouped.replace('::endgroup::', '::endgroup::\n::endgroup::'),
    grouped.replace('::endgroup::', '::endgroup::\n1 tests skipped:\n(skip) invented'),
    grouped.replace('::endgroup::', `${file}:\n::endgroup::`),
  ])
    assert.throws(() => parseBunTranscript(text, { files: [file] }))
})
test('installed scripts contribute no cases and require one exact declared completion marker', () => {
  const script = 'packages/jig/test/package-smoke.ts'
  const marker = 'CI installed script complete: packages/jig/test/package-smoke.ts'
  assert.equal(
    parseBunTranscript(marker + '\n', { files: [script], commandKind: 'installed-script' }).count,
    0,
  )
  for (const text of [
    '',
    marker + '\n' + marker,
    marker + '\n 1 fail',
    marker + '\n 1 skip',
    marker + '\nCI installed script complete: packages/display-model/test/package-smoke.ts',
  ])
    assert.throws(() =>
      parseBunTranscript(text, { files: [script], commandKind: 'installed-script' }),
    )
  assert.throws(() =>
    parseBunTranscript(marker, {
      files: ['packages/jig/test/unknown.ts'],
      commandKind: 'installed-script',
    }),
  )
})
function fixture(architecture = 'arm64') {
  const root = mkdtempSync(join(tmpdir(), 'jig-mac-whole-report-'))
  roots.push(root)
  execFileSync('git', ['-C', root, 'init', '--quiet'])
  execFileSync('git', ['-C', root, 'config', 'user.name', 'fixture'])
  execFileSync('git', ['-C', root, 'config', 'user.email', 'fixture@example.invalid'])
  const files = [
    ...NATIVE_PREREQUISITE_TESTS,
    INSTALLED_STARTUP_TEST,
    'packages/jig/test/macos/macos-guardian-storage.test.ts',
    'packages/jig/test/host/proof.test.ts',
    'packages/jig/test/host/installed-software-factory.test.ts',
    'packages/jig/test/host/root-agent-repair.test.ts',
    'packages/jig/test/host/root-agent-http-composition.test.ts',
    'packages/jig/test/host/root-agent-composition.test.ts',
    'packages/jig/test/host/root-agent-fences-specialist.test.ts',
    ...['replacement', 'commentary', 'budget', 'refused-successor'].map(
      (scenario) => `packages/jig/test/host/installed-incident-brief-${scenario}.test.ts`,
    ),
    'packages/jig/test/host/installed-host-foundation.test.ts',
    'packages/jig/test/host/root-agent-repair-batch.test.ts',
    'packages/jig/test/host/installed-workspace-provider.test.ts',
    'packages/jig/test/host/installed-package-provider.test.ts',
    'packages/jig/test/host/run-checkpoint-lifecycle.test.ts',
    'packages/jig/test/portable/plain.test.ts',
    'packages/display-model/test/view.test.ts',
  ]
  for (const file of files) {
    mkdirSync(dirname(join(root, file)), { recursive: true })
    writeFileSync(join(root, file), 'test("actual",()=>{})')
  }
  execFileSync('git', ['-C', root, 'add', '.'])
  execFileSync('git', ['-C', root, 'commit', '--quiet', '-m', 'current source'])
  const source = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  const evidence = join(root, 'evidence')
  const reports = []
  const directories = []
  const xml = (owned) =>
    `<testsuites tests="${owned.length}">${owned.map((file) => `<testcase file="${file}" classname="suite" name="complete ${file}"/>`).join('')}</testsuites>`
  const frozen = createFrozenMacPlan(files, architecture, {
    source,
    policy: { targetSeconds: 1200, minShards: 3, maxShards: 3 },
  })
  const planFile = join(root, 'PLAN.json')
  writeFileSync(planFile, JSON.stringify(frozen))
  const shards = frozen.shards
  for (const shard of shards) {
    const directory = join(evidence, `macos-prerequisites-${architecture}-${shard.index}-${source}`)
    mkdirSync(directory, { recursive: true })
    directories.push(directory)
    writeFileSync(
      join(directory, 'prerequisites.json'),
      JSON.stringify(prerequisites(architecture)),
    )
    writeFileSync(
      join(directory, `shard-${shard.index}.complete`),
      `${source} ${architecture} ${shard.index}`,
    )
    writeFileSync(
      join(directory, 'test-plan.json'),
      JSON.stringify({
        architecture,
        shard: shard.index,
        shardCount: shards.length,
        installed: shard.index === shards.length - 1,
        groups: shard.groups,
        nativeFiles: NATIVE_PREREQUISITE_TESTS,
      }),
    )
    for (const [index, group] of shard.groups.entries()) {
      const path = join(directory, `shard-${shard.index}-group-${index}.xml`)
      writeFileSync(path, xml([group.file]))
      reports.push(path)
    }
    writeFileSync(join(directory, 'native-tests.xml'), xml(NATIVE_PREREQUISITE_TESTS))
    if (shard.index === shards.length - 1)
      writeFileSync(join(directory, 'installed-startup.xml'), xml([INSTALLED_STARTUP_TEST]))
  }
  return { root, source, evidence, reports, directories, files, architecture, planFile, shards }
}
function options(f, extra = {}) {
  return {
    repository: f.root,
    source: f.source,
    targetId: 'macos-arm64',
    evidenceDirectory: f.evidence,
    planFile: f.planFile,
    macosMajor: 15,
    ...extra,
  }
}
test('complete generated ARM shards reconcile unique files and repeated native execution', () => {
  const f = fixture()
  const result = readMacReports(options(f, { detailed: true }))
  assert.equal(result.files, f.files.length)
  assert.equal(result.planned_files, f.files.length)
  assert.equal(
    result.executed,
    f.files.length + (f.shards.length - 1) * NATIVE_PREREQUISITE_TESTS.length,
  )
  assert.equal(result.hostProfiles.length, f.shards.length)
  assert.equal(result.shards.length, f.shards.length)
  assert.equal(readMacReports(options(f)).count, result.executed)
})
test('strict major coverage permits patch drift while each host retains validated prerequisites', () => {
  const f = fixture()
  const path = join(f.directories.at(-1), 'prerequisites.json')
  writeFileSync(
    path,
    JSON.stringify({ ...prerequisites('arm64'), kernel: '24.6.1', build: '24H233' }),
  )
  const report = readMacReports(options(f, { detailed: true }))
  assert.equal(report.hostProfiles.at(-1).build, '24H233')
  writeFileSync(
    path,
    JSON.stringify({ ...prerequisites('arm64'), kernel: '25.6.0', build: '25G332' }),
  )
  assert.throws(() => readMacReports(options(f, { macosMajor: 15 })), /major differs/)
  for (const change of [
    { arch: 'x64' },
    { bun: '1.4.3' },
    { revision: 'different' },
    { backendQualified: true },
    { processIdentityBytes: 55 },
    { coalitionIdentityBytes: 39 },
    { coalitionUsageBytes: 288 },
    { pidVersion: -1 },
  ]) {
    writeFileSync(path, JSON.stringify({ ...prerequisites('arm64'), ...change }))
    assert.throws(() => readMacReports(options(f)), /Mac host prerequisites/)
  }
})
test('every executing shard requires complete native baseline and the installed owner requires startup', () => {
  for (const [index, missing] of [
    [0, 'native-tests.xml'],
    [1, 'native-tests.xml'],
    [2, 'native-tests.xml'],
    [2, 'installed-startup.xml'],
  ]) {
    const f = fixture()
    rmSync(join(f.directories[index], missing))
    assert.throws(() => readMacReports(options(f)), /ENOENT/)
  }
})
test('frozen source inventory and command order cannot change after planning', () => {
  for (const mutation of [
    (p) => p.groups.reverse(),
    (p) => p.groups.pop(),
    (p) => p.nativeFiles.pop(),
    (p) => p.shardCount++,
  ]) {
    const f = fixture()
    const path = join(f.directories[0], 'test-plan.json')
    const plan = JSON.parse(readFileSync(path, 'utf8'))
    mutation(plan)
    writeFileSync(path, JSON.stringify(plan))
    assert.throws(() => readMacReports(options(f)), /Mac command plan differs/)
  }
  const f = fixture()
  const frozen = JSON.parse(readFileSync(f.planFile, 'utf8'))
  frozen.source = 'a'.repeat(40)
  writeFileSync(f.planFile, JSON.stringify(frozen))
  assert.throws(() => readMacReports(options(f)), /Frozen Mac plan differs/)
})
test('reports reject skipped, duplicated, truncated and foreign cases', () => {
  for (const mutation of [
    (xml) => xml.replace('/>', '><skipped/></testcase>'),
    (xml) => xml.replace('tests="1"', 'tests="2"'),
    (xml) => xml.replace('<testcase', '<testcase file="foreign"/><testcase'),
    (xml) =>
      xml
        .replace('name="complete', 'name="changed')
        .replace('/>', '/><testcase file="foreign" name="invented"/>'),
  ]) {
    const f = fixture()
    writeFileSync(f.reports[0], mutation(readFileSync(f.reports[0], 'utf8')))
    assert.throws(() => readMacReports(options(f)))
  }
  const f = fixture()
  assert.throws(() => readMacReports(options(f, { targetId: 'macos-x64' })))
})

function selectedReports(f, majors, extra = {}) {
  for (const [index, major] of majors.entries()) {
    writeFileSync(
      join(f.directories[index], 'prerequisites.json'),
      JSON.stringify({
        ...prerequisites('arm64'),
        kernel: major === 26 ? '25.6.0' : '24.6.1',
        build: major === 26 ? '25G332' : '24H233',
      }),
    )
  }
  return options(f, { macosMajor: undefined, selectedMajorsByShard: majors, ...extra })
}

test('explicit PR selections reconcile one complete mixed-major physical shard per frozen role', () => {
  const f = fixture()
  const selected = [15, 26, 15]
  const input = selectedReports(f, selected, { detailed: true })
  const report = readMacReports(input)
  assert.equal(report.files, f.files.length)
  assert.equal(report.planned_files, f.files.length)
  assert.equal(
    report.executed,
    f.files.length + (f.shards.length - 1) * NATIVE_PREREQUISITE_TESTS.length,
  )
  assert.deepEqual(
    report.shards.map(({ major, shard }) => [major, shard]),
    [
      [15, 0],
      [26, 1],
      [15, 2],
    ],
  )
  assert.deepEqual(
    report.hostProfiles.map(({ kernel }) => kernel),
    ['24.6.1', '25.6.0', '24.6.1'],
  )
  assert.equal(readMacReports({ ...input, detailed: false }).count, report.executed)
  assert.throws(
    () => readMacReports({ ...input, selectedMajorsByShard: undefined }),
    /require one supported/,
  )
  assert.throws(
    () => readMacReports({ ...input, macosMajor: 15, selectedMajorsByShard: undefined }),
    /major differs/,
  )
})

test('mixed PR reports require exact supported selections and each selected actual host major', () => {
  const f = fixture()
  const input = selectedReports(f, [15, 26, 15])
  const sparseSelection = [15, 26, 15]
  Reflect.deleteProperty(sparseSelection, 1)
  for (const selectedMajorsByShard of [
    null,
    {},
    [],
    [15, 26],
    [15, 26, 15, 26],
    [15, 14, 15],
    [15, '26', 15],
    sparseSelection,
  ]) {
    assert.throws(
      () => readMacReports({ ...input, selectedMajorsByShard }),
      /exactly one supported/,
    )
  }
  assert.throws(() => readMacReports({ ...input, macosMajor: 15 }), /exactly one supported/)
  assert.throws(
    () => readMacReports({ ...input, selectedMajorsByShard: [26, 15, 26] }),
    /major differs/,
  )
  for (const major of [undefined, null, 14, 27, '015', '15\n', [15]])
    assert.throws(() => readMacReports(options(f, { macosMajor: major })), /require one supported/)
})

test('mixed PR coverage cannot omit a worker baseline, installed proof or source identity', () => {
  for (const [index, file] of [
    [0, 'native-tests.xml'],
    [1, 'native-tests.xml'],
    [2, 'native-tests.xml'],
    [2, 'installed-startup.xml'],
  ]) {
    const f = fixture()
    const input = selectedReports(f, [26, 15, 26])
    rmSync(join(f.directories[index], file))
    assert.throws(() => readMacReports(input), /ENOENT/)
  }
  const f = fixture()
  const input = selectedReports(f, [26, 15, 26])
  writeFileSync(join(f.directories[1], 'shard-1.complete'), `${'b'.repeat(40)} arm64 1`)
  assert.throws(() => readMacReports(input), /Stale Mac execution marker/)
})
