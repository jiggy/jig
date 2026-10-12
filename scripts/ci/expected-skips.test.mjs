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
const parameterizedCases = [
  {
    file: 'packages/jig/test/project-author-evaluator.test.ts',
    classname: 'finite isolated author declaration batches',
    name: 'blocking guest execution is fenced at the entry deadline (batch: %s)',
    line: '97',
  },
  {
    file: 'packages/jig/test/bun-native-preparation.test.ts',
    classname: 'private contained Bun dependency preparation',
    name: 'recovers preparation after coordinator loss (resolve=%s)',
    line: '336',
  },
]
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

const sourceProviderHostCases = [
  'installed software factory delivers complete blocked and checked dashboard views',
  'installed typed views preserve clean and lost automatic and explicit observation',
  'installed CLI reviews and runs a workspace dependency (application: member)',
  'installed CLI reviews and runs a workspace dependency (application: root)',
  'installed CLI reviews and runs a workspace dependency (application: nested)',
  'packed read attachments preserve empty roots and maximum relative paths',
  'packed project entrypoint uses fresh reviewed data and immutable execution',
  'packed project dependencies uses fresh reviewed data and immutable execution',
]

test('source Linux authorizes only the eight reviewed provider host cases at frozen source', () =>
  fixture([providerFile], (f) => {
    const cases = sourceProviderHostCases.map((name) => ({ file: providerFile, name }))
    const proof = authorize(f, cases)
    assert.equal(proof.observedSkipped, 8)
    assert.equal(proof.unexpectedSkips, 0)
    assert.deepEqual(
      proof.skippedCases.map((item) => item.name),
      sourceProviderHostCases,
    )
    assert.equal(proof.skippedCaseDigest, skippedCaseDigest(proof.skippedCases))
  }))

test('the required portable provider observation grammar cases cannot inherit host skip permission', () =>
  fixture([providerFile], (f) => {
    for (const name of [
      'factory automatic observation accepts complete views or exact truthful loss and rejects malformed evidence',
      'factory explicit observation preserves exact channel ordering and rejects malformed evidence',
    ])
      assert.throws(() => authorize(f, [{ file: providerFile, name }]), /Unexpected skipped case/)
  }))

test('reviewed provider host skips do not authorize future cases, neighboring names or invented placeholders', () =>
  fixture([providerFile], (f) => {
    for (const name of [
      'installed new provider regression',
      'installed automatic plain typed views end cleanly and report declared observation loss',
      `${sourceProviderHostCases[0]} without observing updates`,
      'installed CLI reviews and runs a workspace dependency (application: future)',
      'installed CLI reviews and runs a workspace dependency (application: %s)',
      'packed project %s uses fresh reviewed data and immutable execution',
    ])
      assert.throws(() => authorize(f, [{ file: providerFile, name }]), /Unexpected skipped case/)
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

test('frozen skipped test.each registrations retain identical reporter names with a reviewed cap', () =>
  fixture(
    parameterizedCases.map((item) => item.file),
    (f) => {
      // Captured Bun JUnit reports use literal placeholders even though each
      // declaration registers false and true; their line attributes also match.
      const cases = parameterizedCases.flatMap((item) => [item, { ...item }])
      const proof = authorize(f, cases)
      assert.equal(proof.observedSkipped, 4)
      assert.deepEqual(
        proof.skippedCases.map((item) => item.line),
        ['97', '97', '336', '336'],
      )
      assert.equal(proof.skippedCaseDigest, skippedCaseDigest(proof.skippedCases))
      assert.deepEqual(authorize(f, proof.skippedCases), proof)
      for (const item of parameterizedCases) {
        assert.throws(() => authorize(f, [item, item, item]), /multiplicity/)
        for (const forged of [
          { ...item, line: String(Number(item.line) + 1) },
          { ...item, line: undefined },
        ])
          assert.throws(() => authorize(f, [item, forged]))
        for (const forged of [
          { ...item, classname: `${item.classname} neighboring suite` },
          { ...item, name: `${item.name} neighboring case` },
        ])
          assert.throws(() => authorize(f, [forged, forged]), /multiplicity/)
        // Neither an invented ordinal nor a claimed count changes the cap.
        assert.throws(
          () =>
            authorize(f, [
              item,
              { ...item, occurrence: 2 },
              { ...item, occurrence: 3, maxOccurrences: 100 },
            ]),
          /multiplicity/,
        )
      }
    },
  ))

test('reporter line changes cannot create extra identities for ordinary reviewed skips', () =>
  fixture([inputFile], (f) => {
    assert.throws(
      () =>
        authorize(f, [
          { ...macInputCase, line: '110' },
          { ...macInputCase, line: '111' },
        ]),
      /multiplicity/,
    )
    assert.throws(() => authorize(f, [{ ...macInputCase, line: 'not-a-line' }]), /source line/)
  }))

test('parameterized allowances remain frozen to their source and owning host policy', () =>
  fixture(
    parameterizedCases.map((item) => item.file),
    (f) => {
      const [author, preparation] = parameterizedCases
      for (const architecture of ['x64', 'arm64']) {
        const extra = {
          targetId: `macos-${architecture}`,
          profile: `macos-24G830/${architecture}/bun-1.4.2`,
          skipPolicy: 'host-partitions-and-platform',
        }
        assert.equal(authorize(f, [preparation, preparation], extra).observedSkipped, 2)
        assert.throws(() => authorize(f, [author, author], extra), /Unexpected skipped/)
        assert.throws(() => authorize(f, [preparation, preparation, preparation], extra))
        assert.throws(() =>
          authorize(f, [{ ...preparation, commandKind: 'native-prerequisites' }], extra),
        )
      }
      assert.throws(() =>
        authorize(f, [preparation], {
          targetId: 'linux',
          profile: linuxProfile,
          skipPolicy: 'host-partitions-and-platform',
        }),
      )
      write(f.root, preparation.file, `${readFileSync(join(f.root, preparation.file), 'utf8')}\n`)
      f.source = commit(f.root)
      assert.throws(() => authorize(f, [preparation, preparation]), /Changed or unavailable/)
    },
  ))

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

// Retained verbatim from the qualified Linux Bun 1.3.3 PR run 37923230351,
// attempt 1. These are reports, not substitutes for fresh test execution.
const linuxTranscript = (name) =>
  readFileSync(new URL(`./fixtures/bun-1.3.3-linux/${name}.txt`, import.meta.url), 'utf8')
const providerFilter = (pattern) => ({
  files: [providerFile],
  filter: { file: providerFile, pattern },
})
const packedPattern = '^packed project dependencies '
const ordinaryPattern = '^(?!packed project dependencies )'

test('retained Bun 1.3.3 skip recap preserves five original owning case identities', () => {
  const text = linuxTranscript('root-agent-lifecycle')
  const parsed = parseBunTranscript(text, { files: [rootFile] })
  assert.equal(parsed.count, 22)
  assert.equal(parsed.skipped, 5)
  assert.equal(parsed.filtered, 0)
  assert.equal(parsed.skippedCases.length, 5)
  assert.ok(parsed.skippedCases.every((item) => item.file === rootFile))
  fixture([rootFile], (f) => {
    assert.equal(
      authorize(f, parsed.skippedCases, {
        targetId: 'linux',
        profile: linuxProfile,
        skipPolicy: 'host-partitions-and-platform',
      }).observedSkipped,
      5,
    )
  })
})

test('Bun recaps require the exact primary skip multiset and terminate execution', () => {
  const text = linuxTranscript('root-agent-lifecycle')
  const [primary, terminal] = text.split('\n5 tests skipped:\n')
  const [names, footer] = terminal.split('\n\n 22 pass')
  const rows = names.split('\n')
  const replaceRecap = (value) => `${primary}\n5 tests skipped:\n${value}\n\n 22 pass${footer}`
  for (const altered of [
    replaceRecap(rows.slice(1).join('\n')),
    replaceRecap([rows[0], rows[0], ...rows.slice(2)].join('\n')),
    replaceRecap(names.replace('ordinary ACP Agent', 'unreviewed Agent')),
    text.replace('5 tests skipped:', '6 tests skipped:'),
    replaceRecap(`${names}\n5 tests skipped:\n${names}`),
    replaceRecap(`${names}\n(pass) forged after recap [1ms]`),
    replaceRecap(`${names}\n${rootFile}:`),
    replaceRecap(`${names}\nunexpected recap record`),
    `${text}(pass) forged after footer [1ms]\n`,
    text + text,
    text.replace('Ran 27 tests', 'Ran 28 tests'),
    text.replace('across 1 file.', 'across 2 files.'),
    text.replace(' 22 pass', ' 23 pass').replace('Ran 27 tests', 'Ran 28 tests'),
    text.replace('(pass) contact-import', 'contact-import'),
  ])
    assert.throws(() => parseBunTranscript(altered, { files: [rootFile] }))
})

test('optional recap preserves single skips and file ownership across multiple headers', () => {
  const primary = `${inputFile}:\n(skip) first > selected\n(pass) first > portable [1ms]\n${rootFile}:\n(skip) second > native\n(pass) second > portable [2ms]\n`
  const footer = '\n2 pass\n2 skip\n0 fail\nRan 4 tests across 2 files. [10ms]\n'
  const recap = '\n2 tests skipped:\n(skip) second > native\n(skip) first > selected\n'
  const options = { files: [inputFile, rootFile] }
  const parsed = parseBunTranscript(primary + recap + footer, options)
  assert.deepEqual(
    parsed.skippedCases.map((item) => item.file),
    [inputFile, rootFile],
  )
  assert.deepEqual(parseBunTranscript(primary + footer, options), parsed)
  const single = `${inputFile}:\n(skip) first > native\n(pass) portable [1ms]\n\n1 pass\n1 skip\n0 fail\nRan 2 tests across 1 file. [10ms]\n`
  assert.equal(parseBunTranscript(single, { files: [inputFile] }).skipped, 1)
  assert.equal(
    parseBunTranscript(
      single.replace('\n\n1 pass', '\n\n1 test skipped:\n(skip) first > native\n\n1 pass'),
      {
        files: [inputFile],
      },
    ).skipped,
    1,
  )
})

test('retained Bun 1.3.3 provider partitions keep filtered registrations out of execution and skips', () => {
  const packed = parseBunTranscript(
    linuxTranscript('provider-packed'),
    providerFilter(packedPattern),
  )
  const ordinary = parseBunTranscript(
    linuxTranscript('provider-ordinary'),
    providerFilter(ordinaryPattern),
  )
  assert.equal(packed.count, 1)
  assert.equal(packed.filtered, 6)
  assert.equal(ordinary.count, 6)
  assert.equal(ordinary.filtered, 1)
  assert.equal(packed.skipped + ordinary.skipped, 0)
  assert.deepEqual(packed.skippedCases, [])
  assert.deepEqual(ordinary.skippedCases, [])
})

test('filtered Bun reports require exact reviewed owner and every primary pass to match its filter', () => {
  const packed = linuxTranscript('provider-packed')
  const ordinary = linuxTranscript('provider-ordinary')
  for (const [text, options] of [
    [packed, { files: [providerFile] }],
    [packed, providerFilter('')],
    [packed, providerFilter('.*')],
    [packed, { files: [providerFile], filter: { file: inputFile, pattern: packedPattern } }],
    [
      packed,
      { files: [providerFile, inputFile], filter: { file: providerFile, pattern: packedPattern } },
    ],
    [packed, providerFilter(ordinaryPattern)],
    [ordinary, providerFilter(packedPattern)],
    [packed.replace('Ran 1 test', 'Ran 7 tests'), providerFilter(packedPattern)],
    [
      packed.replace('1 pass', '7 pass').replace('Ran 1 test', 'Ran 7 tests'),
      providerFilter(packedPattern),
    ],
    [packed.replace(' 6 filtered out', ' 6 skip'), providerFilter(packedPattern)],
    [packed.replace('across 1 file.', 'across 2 files.'), providerFilter(packedPattern)],
    [packed.replace('0 fail', '1 fail'), providerFilter(packedPattern)],
    [
      packed.replace('Ran 1 test across 1 file.', 'process interrupted'),
      providerFilter(packedPattern),
    ],
    [
      packed.replace('packed project dependencies uses', 'other project dependencies uses'),
      providerFilter(packedPattern),
    ],
  ])
    assert.throws(() => parseBunTranscript(text, options))
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

const xmlAttribute = (value) =>
  value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;')
const xml = (file, name, child = '', classname = '', line = '1') =>
  `<testsuites><testsuite><testcase file="${file}" classname="${xmlAttribute(classname)}" name="${xmlAttribute(name)}" line="${line}">${child}</testcase></testsuite></testsuites>`
function hostFixture(f, additionalFiles = []) {
  const files = [
    ...NATIVE_PREREQUISITE_TESTS,
    rootFile,
    providerFile,
    inputFile,
    ...additionalFiles,
  ].sort()
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
function groupReportPath(options, source, file) {
  const shard = options.shards.find((entry) => entry.groups.some((group) => group.file === file))
  const group = shard.groups.findIndex((entry) => entry.file === file)
  return join(
    options.evidenceDirectory,
    `macos-prerequisites-arm64-${shard.index}-${source}`,
    `shard-${shard.index}-group-${group}.xml`,
  )
}

// Actual Bun1.4.2 JUnit labels for the four wide/little combinations and the
// boolean universal pair retain their literal placeholders and declaration lines.
const metadataFile = 'packages/jig/test/macos-agent-runtime.test.ts'
const metadataCases = [
  {
    name: 'reads universal metadata (wide=%s little=%s)',
    classname: 'bounded static Mach-O metadata',
    line: '51',
    count: 4,
  },
  {
    name: 'accepts baseline LIB64 metadata (universal=%s)',
    classname: 'bounded static Mach-O metadata',
    line: '77',
    count: 2,
  },
]
function metadataReport(counts = [4, 2], lines = ['51', '77']) {
  return (
    '<testsuites>' +
    metadataCases
      .map((item, index) =>
        xml(metadataFile, item.name, '', item.classname, lines[index]).repeat(counts[index]),
      )
      .join('') +
    '</testsuites>'
  )
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

test('Mac owning JUnit keeps the real identical parameterized skip attributes for independent authorization', () => {
  const item = parameterizedCases[1]
  return fixture(
    [...NATIVE_PREREQUISITE_TESTS, rootFile, providerFile, inputFile, item.file],
    (f) => {
      const options = hostFixture(f, [item.file])
      const shard = options.shards.find((entry) =>
        entry.groups.some((group) => group.file === item.file),
      )
      const group = shard.groups.findIndex((entry) => entry.file === item.file)
      const path = join(
        options.evidenceDirectory,
        `macos-prerequisites-arm64-${shard.index}-${f.source}`,
        `shard-${shard.index}-group-${group}.xml`,
      )
      const report = xml(item.file, item.name, '<skipped/>', item.classname, item.line)
      writeFileSync(path, `<testsuites>${report}${report}</testsuites>`)
      const result = readMacSkippedCases(options)
      assert.equal(result.skipped, 2)
      assert.deepEqual(
        result.skippedCases.map((entry) => entry.line),
        ['336', '336'],
      )
      assert.equal(
        authorize(f, result.skippedCases, {
          targetId: 'macos-arm64',
          profile: 'macos-24G830/arm64/bun-1.4.2',
          skipPolicy: 'host-partitions-and-platform',
        }).observedSkipped,
        2,
      )
      writeFileSync(path, `<testsuites>${report}${report}${report}</testsuites>`)
      assert.throws(() =>
        authorize(f, readMacSkippedCases(options).skippedCases, {
          targetId: 'macos-arm64',
          profile: 'macos-24G830/arm64/bun-1.4.2',
          skipPolicy: 'host-partitions-and-platform',
        }),
      )
    },
  )
})

test('Mac ordinary parameterized reports count every declared execution without deduplicating names', () =>
  fixture(
    [
      ...NATIVE_PREREQUISITE_TESTS,
      rootFile,
      providerFile,
      inputFile,
      metadataFile,
      parameterizedCases[0].file,
    ],
    (f) => {
      const author = parameterizedCases[0]
      const options = hostFixture(f, [metadataFile, author.file])
      writeFileSync(groupReportPath(options, f.source, metadataFile), metadataReport())
      writeFileSync(
        groupReportPath(options, f.source, author.file),
        `<testsuites>${xml(author.file, author.name, '', author.classname, author.line).repeat(2)}</testsuites>`,
      )
      const result = readMacSkippedCases(options)
      assert.equal(result.skipped, 0)
      assert.equal(
        result.count,
        options.shards.reduce((sum, shard) => sum + shard.groups.length, 0) +
          NATIVE_PREREQUISITE_TESTS.length +
          1 +
          5 +
          1,
      )
    },
  ))

test('Mac parameterized reports reject extra, missing, relined or invented executions', () =>
  fixture([...NATIVE_PREREQUISITE_TESTS, rootFile, providerFile, inputFile, metadataFile], (f) => {
    const options = hostFixture(f, [metadataFile])
    const path = groupReportPath(options, f.source, metadataFile)
    const valid = metadataReport()
    for (const invalid of [
      metadataReport([5, 2]),
      metadataReport([3, 2]),
      metadataReport([0, 2]),
      metadataReport([4, 2], ['52', '77']),
      valid.replace('line="51"', 'line="99"'),
      valid.replaceAll('wide=%s little=%s', 'wide=%s little=%s neighboring case'),
    ]) {
      writeFileSync(path, invalid)
      assert.throws(() => readMacSkippedCases(options))
    }
    writeFileSync(path, valid)
    write(f.root, metadataFile, `${readFileSync(join(f.root, metadataFile), 'utf8')}\n`)
    f.source = commit(f.root)
    const changed = hostFixture(f, [metadataFile])
    writeFileSync(groupReportPath(changed, f.source, metadataFile), valid)
    assert.throws(() => readMacSkippedCases(changed), /Changed or unavailable.*multiplicity source/)
  }))

test('ordinary duplicate pass names do not gain identity from supplied lines', () =>
  fixture([...NATIVE_PREREQUISITE_TESTS, rootFile, providerFile, inputFile], (f) => {
    const options = hostFixture(f)
    const path = groupReportPath(options, f.source, inputFile)
    writeFileSync(
      path,
      `<testsuites>${xml(inputFile, 'portable case', '', '', '1')}${xml(inputFile, 'portable case', '', '', '2')}</testsuites>`,
    )
    assert.throws(() => readMacSkippedCases(options), /exceeds.*multiplicity/)
  }))

test('Mac passed-case allowances cannot authorize a repeated owning command or native prerequisite', () => {
  const startupFile = 'packages/jig/test/native-agent-startup.test.ts'
  return fixture(
    [...NATIVE_PREREQUISITE_TESTS, rootFile, providerFile, inputFile, startupFile],
    (f) => {
      const options = hostFixture(f, [startupFile])
      const path = groupReportPath(options, f.source, startupFile)
      writeFileSync(path, xml(startupFile, 'native installed client', '', '', '99'))
      assert.throws(() => readMacSkippedCases(options), /across owning commands/)
      writeFileSync(path, xml(startupFile, 'portable case'))
      const nativePath = join(
        options.evidenceDirectory,
        `macos-prerequisites-arm64-0-${f.source}`,
        'native-tests.xml',
      )
      const first = NATIVE_PREREQUISITE_TESTS[0]
      writeFileSync(
        nativePath,
        '<testsuites>' +
          NATIVE_PREREQUISITE_TESTS.map((file) => xml(file, 'native prerequisite')).join('') +
          xml(first, 'native prerequisite', '', '', '99') +
          '</testsuites>',
      )
      assert.throws(() => readMacSkippedCases(options), /exceeds.*multiplicity/)
    },
  )
})

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
