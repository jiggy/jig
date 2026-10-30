import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, test } from 'node:test'
import {
  INSTALLED_STARTUP_TEST,
  NATIVE_PREREQUISITE_TESTS,
  planMacHostTests,
} from './macos-host-test-shards.mjs'
import { parseBunTranscript, readMacReports } from './test-reports.mjs'

const roots = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
const file = 'packages/display-web/test/client.test.ts'
const plain = `bun test v1.3.3\n\n${file}:\n(pass) complete case [1.00ms]\n\n 1 pass\n 0 fail\n 2 expect() calls\nRan 1 test across 1 file. [2.00ms]\n`
const grouped = plain
  .replace(`${file}:`, `::group::${file}:`)
  .replace('\n 1 pass', '\n::endgroup::\n 1 pass')
const prerequisites = (arch) => ({
  kind: 'macos-host-prerequisites/1',
  arch,
  kernel: '24.6.0',
  build: arch === 'arm64' ? '24H232' : '24G830',
  bun: '1.4.2',
  revision: '744846f844374847c902b5e7fd59b4342a51ef99',
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
    new URL('./fixtures/bun-1.3.3-linux/display-source-github-groups.txt', import.meta.url),
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
function fixture(architecture) {
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
    // Exercise all four Intel shards despite the installed-consumer reservation.
    'packages/jig/test/host/root-agent-fences-specialist.test.ts',
    'packages/jig/test/host/installed-incident-brief.test.ts',
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
  const shards = planMacHostTests(files, architecture)
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
        nativeFiles: shard.index === 0 ? NATIVE_PREREQUISITE_TESTS : [],
      }),
    )
    for (const [index, group] of shard.groups.entries()) {
      const path = join(directory, `shard-${shard.index}-group-${index}.xml`)
      writeFileSync(path, xml([group.file]))
      reports.push(path)
    }
    if (shard.index === 0)
      writeFileSync(join(directory, 'native-tests.xml'), xml(NATIVE_PREREQUISITE_TESTS))
    if (shard.index === shards.length - 1)
      writeFileSync(join(directory, 'installed-startup.xml'), xml([INSTALLED_STARTUP_TEST]))
  }
  return { root, source, evidence, reports, directories, files, architecture }
}
test('both full Mac architecture readers own every report once including native and installed startup', () => {
  for (const arch of ['x64', 'arm64']) {
    const f = fixture(arch)
    assert.equal(
      readMacReports({
        repository: f.root,
        source: f.source,
        targetId: `macos-${arch}`,
        evidenceDirectory: f.evidence,
      }).count,
      f.files.length,
    )
  }
})
test('full Mac reports require the exact current host prerequisites from every shard', () => {
  for (const architecture of ['x64', 'arm64']) {
    const f = fixture(architecture)
    const path = join(f.directories.at(-1), 'prerequisites.json')
    const read = () =>
      readMacReports({
        repository: f.root,
        source: f.source,
        targetId: `macos-${architecture}`,
        evidenceDirectory: f.evidence,
      })
    for (const change of [
      { kind: 'macos-host-prerequisites/2' },
      { arch: architecture === 'x64' ? 'arm64' : 'x64' },
      { kernel: '24.7.0' },
      { build: architecture === 'arm64' ? '24H233' : '24H232' },
      { bun: '1.4.3' },
      { revision: 'different' },
      { backendQualified: true },
      { processIdentityBytes: 55 },
      { coalitionIdentityBytes: 39 },
      { coalitionUsageBytes: 288 },
      { pidVersion: -1 },
    ]) {
      writeFileSync(path, JSON.stringify({ ...prerequisites(architecture), ...change }))
      assert.throws(read, /Mac host prerequisites/)
    }
    writeFileSync(path, JSON.stringify({ ...prerequisites(architecture), pidVersion: 0 }))
    assert.equal(read().count, f.files.length)
    writeFileSync(path, 'not JSON')
    assert.throws(read, SyntaxError)
    rmSync(path)
    assert.throws(read, /ENOENT/)
  }
})
test('one complete ARM host qualifies only its observed admitted build', () => {
  for (const build of ['24G830', '24H232']) {
    const f = fixture('arm64')
    assert.equal(f.directories.length, 1)
    writeFileSync(
      join(f.directories[0], 'prerequisites.json'),
      JSON.stringify({ ...prerequisites('arm64'), build }),
    )
    const result = readMacReports({
      repository: f.root,
      source: f.source,
      targetId: 'macos-arm64',
      evidenceDirectory: f.evidence,
      detailed: true,
    })
    assert.equal(result.executed, f.files.length)
    assert.equal(result.shards.length, 1)
    assert.deepEqual(result.hostProfile, {
      arch: 'arm64',
      kernel: '24.6.0',
      build,
      bun: '1.4.2',
      revision: prerequisites('arm64').revision,
    })
  }
})
test('the complete ARM role requires both native and installed reports on its single host', () => {
  for (const missing of ['native-tests.xml', 'installed-startup.xml']) {
    const f = fixture('arm64')
    rmSync(join(f.directories[0], missing))
    assert.throws(
      () =>
        readMacReports({
          repository: f.root,
          source: f.source,
          targetId: 'macos-arm64',
          evidenceDirectory: f.evidence,
        }),
      /ENOENT/,
    )
  }
})
test('a partial ARM shard plan cannot qualify the complete single-host role', () => {
  const f = fixture('arm64')
  const path = join(f.directories[0], 'test-plan.json')
  const plan = JSON.parse(readFileSync(path, 'utf8'))
  plan.shardCount = 2
  plan.installed = false
  plan.groups = plan.groups.slice(0, Math.ceil(plan.groups.length / 2))
  writeFileSync(path, JSON.stringify(plan))
  assert.throws(
    () =>
      readMacReports({
        repository: f.root,
        source: f.source,
        targetId: 'macos-arm64',
        evidenceDirectory: f.evidence,
      }),
    /Mac command plan differs from its pinned source inventory/,
  )
})
test('full Mac reader rejects reordered plans even when every matching report remains complete', () => {
  for (const architecture of ['x64', 'arm64']) {
    const f = fixture(architecture)
    const shards = planMacHostTests(f.files, architecture)
    const shard = shards.find((item) => item.groups.length > 1)
    assert.ok(shard)
    const directory = join(
      f.evidence,
      `macos-prerequisites-${architecture}-${shard.index}-${f.source}`,
    )
    const path = join(directory, 'test-plan.json')
    const plan = JSON.parse(readFileSync(path, 'utf8'))
    const originalFirst = readFileSync(join(directory, `shard-${shard.index}-group-0.xml`))
    const originalSecond = readFileSync(join(directory, `shard-${shard.index}-group-1.xml`))
    ;[plan.groups[0], plan.groups[1]] = [plan.groups[1], plan.groups[0]]
    writeFileSync(path, JSON.stringify(plan))
    writeFileSync(join(directory, `shard-${shard.index}-group-0.xml`), originalSecond)
    writeFileSync(join(directory, `shard-${shard.index}-group-1.xml`), originalFirst)
    assert.throws(
      () =>
        readMacReports({
          repository: f.root,
          source: f.source,
          targetId: `macos-${architecture}`,
          evidenceDirectory: f.evidence,
        }),
      /Mac command plan differs from its pinned source inventory/,
    )
  }
})
test('full Mac reports reject skipped, duplicated, truncated and foreign cases without name or line exceptions', () => {
  for (const mutation of [
    (xml) => xml.replace('/>', '><skipped/></testcase>'),
    (xml) => xml.replace('tests="1"', 'tests="2"'),
    (xml) => xml.replace('<testcase', '<testcase file="foreign"/><testcase'),
    (xml) =>
      xml
        .replace('name="complete', 'name="changed')
        .replace('/>', '/><testcase file="foreign" name="invented"/>'),
  ]) {
    const f = fixture('x64')
    const report = f.reports[0]
    writeFileSync(report, mutation(readFileSync(report, 'utf8')))
    assert.throws(() =>
      readMacReports({
        repository: f.root,
        source: f.source,
        targetId: 'macos-x64',
        evidenceDirectory: f.evidence,
      }),
    )
  }
  const f = fixture('arm64')
  assert.throws(() =>
    readMacReports({
      repository: f.root,
      source: f.source,
      targetId: 'macos-arm64-witness',
      evidenceDirectory: f.evidence,
    }),
  )
})
