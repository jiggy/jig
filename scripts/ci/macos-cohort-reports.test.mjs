import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  INSTALLED_STARTUP_TEST,
  NATIVE_PREREQUISITE_TESTS,
  planMacHostTests,
} from './macos-host-test-shards.mjs'
import { readMacReports, readMacRoleReport } from './test-reports.mjs'

const roots = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

const prerequisites = (build = '24H232') => ({
  kind: 'macos-host-prerequisites/1',
  arch: 'arm64',
  kernel: '24.6.0',
  build,
  bun: '1.4.4',
  revision: '38afee6c84fcf48c0edb2466aa4b27d287a59c30',
  processIdentityBytes: 56,
  coalitionIdentityBytes: 40,
  coalitionUsageBytes: 296,
  pidVersion: 1,
  backendQualified: false,
})
const xml = (files, child = '') =>
  `<testsuites tests="${files.length}">${files
    .map(
      (file) =>
        `<testcase file="${file}" classname="fixture" name="complete ${file}">${child}</testcase>`,
    )
    .join('')}</testsuites>`

// These inert inputs exercise the actual Git inventory and JUnit reader.
// They establish parser behavior, never native execution or release proof.
function fixture(plan = 'pull-request') {
  const repository = mkdtempSync(join(tmpdir(), 'jig-mac-cohort-reports-'))
  roots.push(repository)
  const git = (args) => execFileSync('git', ['-C', repository, ...args], { encoding: 'utf8' })
  git(['init', '--quiet'])
  const files = [
    ...NATIVE_PREREQUISITE_TESTS,
    INSTALLED_STARTUP_TEST,
    ...Array.from({ length: 12 }, (_, index) => `packages/jig/test/host/cohort-${index}.test.ts`),
    'packages/jig/test/macos/cohort-native.test.ts',
    'packages/display-web/test/cohort.test.ts',
  ]
  for (const file of files) {
    mkdirSync(dirname(join(repository, file)), { recursive: true })
    writeFileSync(join(repository, file), 'test("fixture case", () => {})\n')
  }
  git(['add', '.'])
  git([
    '-c',
    'user.name=Fixture',
    '-c',
    'user.email=fixture@example.invalid',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '--quiet',
    '-m',
    'fixture source inventory',
  ])
  const source = git(['rev-parse', 'HEAD']).trim()
  const evidenceDirectory = join(repository, 'evidence')
  const shards = planMacHostTests(files, 'arm64', { plan })
  const directories = shards.map((shard) => {
    const directory = join(evidenceDirectory, `macos-prerequisites-arm64-${shard.index}-${source}`)
    mkdirSync(directory, { recursive: true })
    writeFileSync(join(directory, 'prerequisites.json'), JSON.stringify(prerequisites()))
    writeFileSync(
      join(directory, `shard-${shard.index}.complete`),
      `${source} arm64 ${shard.index}\n`,
    )
    writeFileSync(
      join(directory, 'test-plan.json'),
      JSON.stringify({
        architecture: 'arm64',
        shard: shard.index,
        shardCount: shards.length,
        installed: shard.index === shards.length - 1,
        groups: shard.groups,
        nativeFiles: shard.index === 0 ? NATIVE_PREREQUISITE_TESTS : [],
      }),
    )
    for (const [index, group] of shard.groups.entries())
      writeFileSync(join(directory, `shard-${shard.index}-group-${index}.xml`), xml([group.file]))
    if (shard.index === 0)
      writeFileSync(join(directory, 'native-tests.xml'), xml(NATIVE_PREREQUISITE_TESTS))
    if (shard.index === shards.length - 1)
      writeFileSync(join(directory, 'installed-startup.xml'), xml([INSTALLED_STARTUP_TEST]))
    return directory
  })
  const options = { repository, source, targetId: 'macos-arm64', plan }
  return {
    ...options,
    files,
    shards,
    directories,
    evidenceDirectory,
    role: (role, changes = {}) =>
      readMacRoleReport({
        ...options,
        role,
        evidenceDirectory: directories[role],
        ...changes,
      }),
    complete: (changes = {}) =>
      readMacReports({ ...options, evidenceDirectory, detailed: true, ...changes }),
  }
}

test('three PR roles validate exact files without granting partial qualification', () => {
  const f = fixture()
  assert.equal(f.shards.length, 3)
  const roles = f.shards.map((shard) => f.role(shard.index))
  for (const [role, report] of roles.entries()) {
    assert.equal(report.role, role)
    assert.equal(report.revision, f.source)
    assert.equal(report.hostProfile.build, '24H232')
    assert.equal(report.shard.shard, role)
    assert.equal(Object.hasOwn(report, 'qualified'), false)
    assert.ok(report.executed > 0)
    assert.equal(report.skipped_reports, 0)
  }
  assert.equal(
    roles.reduce((sum, report) => sum + report.executed, 0),
    f.files.length,
  )
  const complete = f.complete()
  assert.equal(complete.qualified, true)
  assert.equal(complete.executed, f.files.length)
  assert.deepEqual(
    complete.shards,
    roles.map((report) => report.shard),
  )
})

test('complete ARM mode remains one full role and cannot accept a PR subset', () => {
  const complete = fixture('complete')
  assert.equal(complete.shards.length, 1)
  assert.equal(complete.complete().executed, complete.files.length)
  const partial = complete.role(0)
  assert.equal(Object.hasOwn(partial, 'qualified'), false)
  assert.equal(partial.executed, complete.files.length)
  const pr = fixture()
  assert.throws(() => pr.role(0, { plan: 'complete' }), /pinned source inventory/)
  assert.throws(() => pr.complete({ plan: 'complete' }), /pinned source inventory/)
})

test('admitted role profiles cannot combine into a complete mixed profile', () => {
  const f = fixture()
  writeFileSync(
    join(f.directories[1], 'prerequisites.json'),
    JSON.stringify(prerequisites('24G830')),
  )
  assert.equal(f.role(1).hostProfile.build, '24G830')
  assert.equal(f.role(0).hostProfile.build, '24H232')
  assert.throws(() => f.complete(), /cannot combine different host profiles/)
  for (const directory of f.directories)
    writeFileSync(join(directory, 'prerequisites.json'), JSON.stringify(prerequisites('24G830')))
  assert.equal(f.complete().hostProfile.build, '24G830')
})

test('empty, skipped, failed, repeated and foreign cases cannot validate a PR role', () => {
  const f = fixture()
  const role = 1
  const file = f.shards[role].groups[0].file
  const report = join(f.directories[role], `shard-${role}-group-0.xml`)
  for (const malformed of [
    xml([]),
    xml([file], '<skipped/>'),
    xml([file], '<failure/>'),
    xml([file, file]),
    xml(['packages/jig/test/host/foreign.test.ts']),
  ]) {
    writeFileSync(report, malformed)
    assert.throws(() => f.role(role))
    assert.throws(() => f.complete())
  }
})

test('a role must retain its exact complete plan and current source marker', () => {
  const f = fixture()
  const role = 1
  const path = join(f.directories[role], 'test-plan.json')
  const original = JSON.parse(readFileSync(path, 'utf8'))
  for (const changes of [
    { shard: 0 },
    { shardCount: 1 },
    { architecture: 'x64' },
    { installed: true },
    { nativeFiles: NATIVE_PREREQUISITE_TESTS },
    { groups: original.groups.slice(1) },
    { groups: [...original.groups].reverse() },
  ]) {
    writeFileSync(path, JSON.stringify({ ...original, ...changes }))
    assert.throws(() => f.role(role), /pinned source inventory/)
  }
  writeFileSync(path, JSON.stringify(original))
  writeFileSync(
    join(f.directories[role], `shard-${role}.complete`),
    `${'a'.repeat(40)} arm64 ${role}`,
  )
  assert.throws(() => f.role(role), /Stale Mac execution marker/)
})

test('native prerequisites and installed startup retain their owning PR roles', () => {
  const native = fixture()
  writeFileSync(
    join(native.directories[0], 'native-tests.xml'),
    xml(NATIVE_PREREQUISITE_TESTS.slice(1)),
  )
  assert.throws(() => native.role(0), /omits a planned file/)
  assert.doesNotThrow(() => native.role(1))
  const installed = fixture()
  rmSync(join(installed.directories[2], 'installed-startup.xml'))
  assert.throws(() => installed.role(2), /ENOENT/)
  assert.throws(() => installed.complete(), /ENOENT/)
})

test('missing roles and invalid role or plan selections cannot qualify', () => {
  const f = fixture()
  for (const role of [-1, 3, 0.5, '1'])
    assert.throws(() => f.role(0, { role }), /outside the selected plan/)
  assert.throws(() => f.role(0, { plan: 'other' }))
  assert.throws(() => f.role(0, { targetId: 'macos-x64' }))
  rmSync(f.directories[1], { recursive: true })
  assert.throws(() => f.complete(), /ENOENT/)
  assert.equal(Object.hasOwn(f.role(0), 'qualified'), false)
})

test('the aggregate CLI selects the PR plan explicitly and rejects an invalid plan', () => {
  const f = fixture()
  const script = fileURLToPath(new URL('./test-reports.mjs', import.meta.url))
  const args = [script, 'arm64', f.source, f.evidenceDirectory]
  const result = spawnSync(process.execPath, args, {
    cwd: f.repository,
    env: { ...process.env, JIG_MACOS_TEST_PLAN: 'pull-request' },
    encoding: 'utf8',
  })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(JSON.parse(result.stdout).shards.length, 3)
  const invalid = spawnSync(process.execPath, args, {
    cwd: f.repository,
    env: { ...process.env, JIG_MACOS_TEST_PLAN: 'other' },
    encoding: 'utf8',
  })
  assert.equal(invalid.status, 1)
  assert.equal(invalid.stdout, '')
})
