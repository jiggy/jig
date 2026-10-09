import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import {
  authorizeExpectedSkips,
  bunCaseFullName,
  parseBunTranscript,
  readMacSkippedCases,
  skippedCaseDigest,
} from './expected-skips.mjs'
import {
  NAMED_TEST_GROUPS,
  NATIVE_PREREQUISITE_TESTS,
  planMacHostTests,
} from './macos-host-test-shards.mjs'

const repository = resolve(import.meta.dirname, '../..')
const sourceProfile = 'ubuntu-24.04/bun-1.3.3/node-24/python-3.13'
const linuxProfile = 'ubuntu-24.04/x64/bun-1.3.3/rootless'
const inputFile = 'packages/jig/test/file-input.test.ts'
const providerFile = 'packages/jig/test/package-provider-host.test.ts'
const rootFile = 'packages/jig/test/root-agent-run-lifecycle.test.ts'
function git(root, args) {
  return execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' },
  }).trim()
}
function write(root, path, content) {
  mkdirSync(dirname(join(root, path)), { recursive: true })
  writeFileSync(join(root, path), content)
}
function commit(root) {
  git(root, ['add', '.'])
  git(root, ['-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture'])
  return git(root, ['rev-parse', 'HEAD'])
}
function fixture(files, run) {
  const root = mkdtempSync(join(tmpdir(), 'jig-expected-skips-'))
  git(root, ['init', '-q'])
  git(root, ['config', 'user.name', 'Test'])
  git(root, ['config', 'user.email', 'test@example.invalid'])
  for (const file of files) write(root, file, readFileSync(join(repository, file)))
  try {
    return run({ root, source: commit(root) })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}
function authorize(f, skippedCases, extra = {}) {
  return authorizeExpectedSkips({
    repository: f.root,
    source: f.source,
    targetId: 'source-tests',
    profile: sourceProfile,
    skipPolicy: 'source-platform-opt-in',
    skippedCases,
    ...extra,
  })
}
const macInputCase = {
  file: inputFile,
  classname: '',
  name: 'Mac capture refuses case variants of private Jig state',
}

test('unchanged reviewed conditional case is retained and bound to runtime in its digest', () =>
  fixture([inputFile], (f) => {
    const result = authorize(f, [macInputCase])
    assert.equal(result.observedSkipped, 1)
    assert.equal(result.unexpectedSkips, 0)
    assert.equal(result.skippedCases[0].profile, sourceProfile)
    assert.equal(result.skippedCaseDigest, skippedCaseDigest(result.skippedCases))
  }))

test('a modified skip file must receive explicit reviewed inventory approval', () =>
  fixture([inputFile], (f) => {
    write(
      f.root,
      inputFile,
      readFileSync(join(f.root, inputFile), 'utf8') +
        '\ntest.skip("new portable regression",()=>{})\n',
    )
    f.source = commit(f.root)
    assert.throws(() => authorize(f, [macInputCase]), /Changed or unavailable/)
  }))

test('unchanged mixed platform file cannot authorize its portable or Linux-only case on source Linux', () =>
  fixture([inputFile], (f) => {
    for (const name of [
      'captures selected binary and empty files into sealed anonymous input',
      'duplicates sealed inputs above every child stdio destination without changing bytes',
    ])
      assert.throws(() => authorize(f, [{ ...macInputCase, name }]), /Unexpected skipped case/)
  }))

test('new file, unresolved revision, missing name, traversal and repeat identities fail closed', () =>
  fixture([inputFile], (f) => {
    const badCases = [
      [{ ...macInputCase, file: 'packages/jig/test/new-portable.test.ts' }],
      [{ ...macInputCase, file: '../file-input.test.ts' }],
      [{ ...macInputCase, file: '/tmp/file-input.test.ts' }],
      [{ ...macInputCase, name: '' }],
      [macInputCase, macInputCase],
    ]
    for (const cases of badCases) assert.throws(() => authorize(f, cases))
    assert.throws(() => authorize(f, [macInputCase], { source: '0'.repeat(40) }), /unavailable/)
    assert.throws(() => authorize(f, [macInputCase], { skipPolicy: 'trust-all-skips' }), /Unknown/)
    assert.throws(
      () => authorize(f, [macInputCase], { profile: 'windows-2022/python-3.13' }),
      /Unknown/,
    )
  }))

test('the same platform case is forbidden in prerequisite and installed-startup proof', () =>
  fixture([inputFile], (f) => {
    for (const commandKind of ['native-prerequisites', 'installed-startup', 'unknown'])
      assert.throws(
        () => authorize(f, [{ ...macInputCase, commandKind }]),
        /must execute without skips/,
      )
  }))

test('hosted 24G830 explicitly accounts for the Intel 23E224-only observer case without waiving startup', () =>
  fixture(['packages/jig/test/macos-preferences-observer.test.ts'], (f) => {
    const item = {
      file: 'packages/jig/test/macos-preferences-observer.test.ts',
      classname: '',
      name: 'actual preference observer refuses caller sandboxes and synthetic managed policy, and expires after parent loss',
    }
    for (const architecture of ['x64', 'arm64']) {
      const extra = {
        targetId: `macos-${architecture}`,
        profile: `macos-24G830/${architecture}/bun-1.4.2`,
        skipPolicy: 'host-partitions-and-platform',
      }
      assert.equal(authorize(f, [item], extra).observedSkipped, 1)
      assert.throws(() => authorize(f, [{ ...item, commandKind: 'installed-startup' }], extra))
      assert.throws(() =>
        authorize(f, [{ ...item, name: 'portable preferences regression' }], extra),
      )
    }
  }))

test('Linux complementary partitions authorize only cases outside their individual owning filter', () =>
  fixture([providerFile], (f) => {
    const packed = {
      file: providerFile,
      classname: '',
      name: 'packed project dependencies are retained',
    }
    const other = {
      file: providerFile,
      classname: '',
      name: 'installed CLI reviews unchanged project bytes',
    }
    const extra = {
      targetId: 'linux',
      profile: linuxProfile,
      skipPolicy: 'host-partitions-and-platform',
    }
    const yes = '^packed project dependencies ',
      no = '^(?!packed project dependencies )'
    const skips = [
      { ...other, filter: { file: providerFile, pattern: yes } },
      { ...packed, filter: { file: providerFile, pattern: no } },
    ]
    assert.equal(authorize(f, skips, extra).observedSkipped, 2)
    assert.throws(
      () => authorize(f, [{ ...packed, filter: { file: providerFile, pattern: yes } }], extra),
      /Unexpected skipped/,
    )
    assert.throws(
      () => authorize(f, [{ ...other, filter: { file: providerFile, pattern: no } }], extra),
      /Unexpected skipped/,
    )
    assert.throws(
      () => authorize(f, [{ ...packed, filter: { file: providerFile, pattern: '.*' } }], extra),
      /owning command/,
    )
    assert.throws(
      () => authorize(f, [{ ...packed, filter: { file: inputFile, pattern: no } }], extra),
      /owning command/,
    )
  }))

test('Mac filters require their owning reviewed pattern; selected ordinary lifecycle proof may not skip', () =>
  fixture([rootFile], (f) => {
    const pattern = NAMED_TEST_GROUPS.get(rootFile)[1].pattern
    const ordinary = {
      file: rootFile,
      classname: '',
      name: 'constructs unchanged packed HTTP Agent method siblings',
    }
    const extra = {
      targetId: 'macos-x64',
      profile: 'macos-24G830/x64/bun-1.4.2',
      skipPolicy: 'host-partitions-and-platform',
    }
    assert.equal(
      authorize(f, [{ ...ordinary, filter: { file: rootFile, pattern } }], extra).observedSkipped,
      1,
    )
    assert.throws(
      () =>
        authorize(
          f,
          [
            {
              ...ordinary,
              filter: { file: rootFile, pattern: NAMED_TEST_GROUPS.get(rootFile)[0].pattern },
            },
          ],
          extra,
        ),
      /Unexpected skipped/,
    )
  }))

test('Bun nested JUnit and transcript names normalize to the same filter spelling', () => {
  assert.equal(bunCaseFullName({ classname: 'inner > outer', name: 'case' }), 'outer inner case')
  const text =
    'bun test v1.3.3\n\npackages/jig/test/file-input.test.ts:\n(skip) outer > inner > case\n(pass) ordinary [1.00ms]\n\n 1 pass\n 1 skip\n 0 fail\nRan 2 tests across 1 file. [10.00ms]\n'
  const parsed = parseBunTranscript(text, { files: [inputFile] })
  assert.equal(parsed.count, 1)
  assert.equal(parsed.skipped, 1)
  assert.equal(bunCaseFullName(parsed.skippedCases[0]), 'outer inner case')
})

test('Bun reporter preserves Windows CRLF and ANSI identities without accepting incomplete or failed reports', () => {
  const clean = `bun test v1.3.3\n\n${inputFile}:\n(skip) ${macInputCase.name}\n(pass) portable [1.00ms]\n\n 1 pass\n 1 skip\n 0 fail\nRan 2 tests across 1 file. [10.00ms]\n`
  assert.equal(
    parseBunTranscript(clean.replaceAll('\n', '\r\n').replace('(skip)', '\x1b[33m(skip)\x1b[0m'), {
      files: [inputFile],
    }).skipped,
    1,
  )
  assert.equal(
    parseBunTranscript(clean.replace('0 fail\n', '0 fail\n 32 expect() calls\n'), {
      files: [inputFile],
    }).count,
    1,
  )
  for (const text of [
    clean.replace('0 fail', '1 fail'),
    clean.replace('Ran 2 tests across 1 file.', 'process killed'),
    clean.replace('1 skip', '2 skip'),
    clean + clean,
    clean.replace(`${inputFile}:\n`, ''),
    clean.replace(inputFile, providerFile),
  ])
    assert.throws(() => parseBunTranscript(text, { files: [inputFile] }))
})

test('completed installed CLI transcripts do not invent passing test counts', () => {
  const files = ['packages/jig/test/package-smoke.ts']
  const marker = 'CI installed script complete: packages/jig/test/package-smoke.ts\n'
  assert.equal(
    parseBunTranscript(`packed CLI probe complete\n${marker}`, {
      files,
      commandKind: 'installed-script',
    }).count,
    0,
  )
  for (const text of [
    '',
    'packed CLI probe complete\n',
    marker + marker,
    'CI installed script complete: scripts/other.ts\n',
    `1 pass\n0 fail\n${marker}`,
    `FAILED (errors=1)\n${marker}`,
    `(skip) native startup\n${marker}`,
  ])
    assert.throws(() => parseBunTranscript(text, { files, commandKind: 'installed-script' }))
  assert.throws(() =>
    parseBunTranscript('complete\n', { files: [inputFile], commandKind: 'installed-script' }),
  )
  assert.throws(() => parseBunTranscript('complete\n', { files: [] }), /owning command files/)
})

const xml = (file, name, child = '', classname = '') =>
  `<testsuites><testsuite><testcase file="${file}" classname="${classname}" name="${name}" line="1">${child}</testcase></testsuite></testsuites>`
function hostFixture(f) {
  const files = [...NATIVE_PREREQUISITE_TESTS, rootFile, providerFile, inputFile].sort()
  const architecture = 'arm64'
  const shards = planMacHostTests(files, architecture)
  const evidenceDirectory = join(f.root, 'evidence')
  for (const shard of shards) {
    const prefix = `evidence/macos-prerequisites-${architecture}-${shard.index}-${f.source}`
    const plan = {
      architecture,
      shard: shard.index,
      shardCount: shards.length,
      installed: shard.index === shards.length - 1,
      groups: shard.groups,
      nativeFiles: shard.index === 0 ? NATIVE_PREREQUISITE_TESTS : [],
    }
    write(f.root, `${prefix}/test-plan.json`, JSON.stringify(plan))
    write(
      f.root,
      `${prefix}/shard-${shard.index}.complete`,
      `${f.source} ${architecture} ${shard.index}`,
    )
    for (const [i, group] of shard.groups.entries()) {
      let name = 'portable case'
      if (group.file === rootFile && group.pattern) {
        const n = NAMED_TEST_GROUPS.get(rootFile).findIndex(
          (entry) => entry.pattern === group.pattern,
        )
        name = [
          'portable case',
          'private contained Agent Run lifecycle runs two unchanged packed HTTP Agents through simultaneous deep specialist branches',
          'contained repair file application ordinary case',
          'contained repair file application exports batch repair evidence sample',
          'private contained Agent Run lifecycle fences ordinary case',
          'private contained Agent Run lifecycle fences root Agent Run sample',
          'private contained Agent Run lifecycle fences root Agent ACP sample',
        ][n]
      }
      if (group.file === providerFile && group.pattern.startsWith('^installed'))
        name = 'installed CLI reviews ordinary project'
      write(f.root, `${prefix}/shard-${shard.index}-group-${i}.xml`, xml(group.file, name))
    }
    if (shard.index === 0)
      write(
        f.root,
        `${prefix}/native-tests.xml`,
        '<testsuites>' +
          NATIVE_PREREQUISITE_TESTS.map((file) => xml(file, 'native prerequisite')).join('') +
          '</testsuites>',
      )
    if (plan.installed)
      write(
        f.root,
        `${prefix}/installed-startup.xml`,
        xml('packages/jig/test/native-agent-startup.test.ts', 'native installed client'),
      )
  }
  return {
    repository: f.root,
    source: f.source,
    targetId: 'macos-arm64',
    evidenceDirectory,
    shards,
  }
}

test('Mac reading reconstructs source membership and all current revision command reports', () =>
  fixture([...NATIVE_PREREQUISITE_TESTS, rootFile, providerFile, inputFile], (f) => {
    const options = hostFixture(f)
    const result = readMacSkippedCases(options)
    assert.equal(result.skipped, 0)
    assert.equal(
      result.count,
      options.shards.reduce((sum, shard) => sum + shard.groups.length, 0) +
        NATIVE_PREREQUISITE_TESTS.length +
        1,
    )
    const dir = join(options.evidenceDirectory, `macos-prerequisites-arm64-0-${f.source}`)
    const plan = JSON.parse(readFileSync(join(dir, 'test-plan.json'), 'utf8'))
    plan.groups.pop()
    writeFileSync(join(dir, 'test-plan.json'), JSON.stringify(plan))
    assert.throws(() => readMacSkippedCases(options), /exact source inventory/)
  }))

test('Mac native-startup skips, stale shard markers and missing owning reports never qualify', () =>
  fixture([...NATIVE_PREREQUISITE_TESTS, rootFile, providerFile, inputFile], (f) => {
    const options = hostFixture(f)
    const last = options.shards.length - 1
    const dir = join(options.evidenceDirectory, `macos-prerequisites-arm64-${last}-${f.source}`)
    writeFileSync(
      join(dir, 'installed-startup.xml'),
      xml(
        'packages/jig/test/native-agent-startup.test.ts',
        'native installed client',
        '<skipped/>',
      ),
    )
    assert.throws(() => readMacSkippedCases(options), /may not skip/)
    writeFileSync(join(dir, `shard-${last}.complete`), 'stale')
    assert.throws(() => readMacSkippedCases(options), /Stale Mac/)
    writeFileSync(join(dir, `shard-${last}.complete`), `${f.source} arm64 ${last}`)
    rmSync(join(dir, 'installed-startup.xml'))
    assert.throws(() => readMacSkippedCases(options))
  }))
