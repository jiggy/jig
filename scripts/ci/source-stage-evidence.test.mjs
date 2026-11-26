import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, test } from 'node:test'
import { readJUnitCases } from './test-reports.mjs'

const roots = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
const script = (file) => new URL(file, import.meta.url).pathname
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'jig-source-report-')))
  roots.push(root)
  return root
}
function write(root, path, contents) {
  mkdirSync(dirname(join(root, path)), { recursive: true })
  writeFileSync(join(root, path), contents)
  return join(root, path)
}
function python(root, name, args) {
  return spawnSync('python3', [script(name), ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
  })
}

test('Python catalog execution includes nested files without relying on unittest directory discovery', () => {
  const root = fixture()
  const files = ['sdk/tests/test_root.py', 'sdk/tests/nested/test_new.py']
  for (const [index, file] of files.entries())
    write(
      root,
      file,
      `import unittest\nclass Proof${index}(unittest.TestCase):\n def test_current(self): self.assertTrue(True)\n`,
    )
  const list = write(root, 'selected.files', files.join('\n'))
  const run = python(root, 'run-source-python.py', ['--files', list, '--group', 'sdk'])
  assert.equal(run.status, 0, run.stderr)
  assert.match(run.stderr, /Ran 2 tests/)
  assert.deepEqual(
    run.stdout.trim().split('\n'),
    files.map((file) => `CI Python source file complete: ${file}`),
  )
})
test('Python selected skipped, empty, repeated or failed registrations produce no completion markers', () => {
  for (const body of [
    'import unittest\n@unittest.skip("unexpected")\nclass Proof(unittest.TestCase):\n def test_skip(self): pass\n',
    'VALUE=1\n',
    'import unittest\nclass Proof(unittest.TestCase):\n def test_fail(self): self.fail("failure")\n',
  ]) {
    const root = fixture()
    write(root, 'sdk/test_bad.py', body)
    const list = write(root, 'selected.files', 'sdk/test_bad.py')
    const run = python(root, 'run-source-python.py', ['--files', list, '--group', 'sdk'])
    assert.notEqual(run.status, 0)
    assert.equal(run.stdout.includes('CI Python source file complete:'), false)
  }
  const root = fixture()
  write(
    root,
    'sdk/test_a.py',
    'import unittest\nclass A(unittest.TestCase):\n def test_ok(self): pass\n',
  )
  const list = write(root, 'selected.files', 'sdk/test_a.py\nsdk/test_a.py')
  assert.notEqual(
    python(root, 'run-source-python.py', ['--files', list, '--group', 'sdk']).status,
    0,
  )
})
test('actual Node reporter retains owning file identities and unexpected skip/failure outcomes', () => {
  for (const registration of [
    'test("successful",()=>{})',
    'test.skip("unexpected",()=>{})',
    'test("failed",()=>assert.fail("failure"))',
  ]) {
    const root = fixture()
    const file = write(
      root,
      'authoring/proof.node.mjs',
      `import {test} from 'node:test';import assert from 'node:assert/strict';${registration};`,
    )
    const report = join(root, 'node.xml')
    const run = spawnSync(
      process.execPath,
      [
        '--test',
        '--test-reporter',
        script('source-node-reporter.mjs'),
        `--test-reporter-destination=${report}`,
        file,
      ],
      {
        cwd: root,
        encoding: 'utf8',
        env: Object.fromEntries(
          Object.entries(process.env).filter(([key]) => key !== 'NODE_TEST_CONTEXT'),
        ),
      },
    )
    if (registration.includes('failed')) assert.notEqual(run.status, 0)
    else assert.equal(run.status, 0, run.stderr)
    const xml = readFileSync(report, 'utf8')
    assert.match(xml, /file="authoring\/proof.node.mjs"/)
    assert.match(xml, /tests="1"/)
    if (registration.includes('skip')) assert.match(xml, /<skipped\/>/)
    if (registration.includes('failed')) assert.match(xml, /<failure\/>/)
  }
  const root = fixture()
  const file = write(root, 'authoring/empty.node.mjs', 'export const value=1')
  const empty = spawnSync(
    process.execPath,
    [
      '--test',
      '--test-reporter',
      script('source-node-reporter.mjs'),
      `--test-reporter-destination=${join(root, 'empty.xml')}`,
      file,
    ],
    {
      cwd: root,
      encoding: 'utf8',
      env: Object.fromEntries(
        Object.entries(process.env).filter(([key]) => key !== 'NODE_TEST_CONTEXT'),
      ),
    },
  )
  assert.notEqual(empty.status, 0)
})

test('the source focus check rejects focused Bun registrations in imported helpers', () => {
  const root = fixture()
  const first = 'first.test.ts'
  const second = 'second.test.ts'
  const helper = 'helpers/nested fixtures/register.ts'
  const header = 'import { test } from "bun:test";'
  write(root, first, `${header}\nimport "./${helper}"; test("regular first case", () => {});`)
  write(root, second, `${header}\ntest("regular second case", () => {});`)
  const registration = write(root, helper, `${header}\ntest("helper case", () => {});`)
  const inventory = write(root, 'selected.files', `${first}\n${second}\n`)
  execFileSync('git', ['init', '-q'], { cwd: root })
  execFileSync('git', ['add', '--', first, second, helper], { cwd: root })
  write(root, '.gitignore', 'helpers/\n')
  const check = () =>
    spawnSync(process.execPath, [script('check-bun-test-focus.mjs')], {
      cwd: root,
      encoding: 'utf8',
    })
  const regular = check()
  assert.equal(regular.status, 0, regular.stderr)
  writeFileSync(registration, `${header}\ntest.only("focused helper case", () => {});`)

  const report = join(root, 'bun.xml')
  const runBun = (ci) =>
    spawnSync(
      'bun',
      [
        'test',
        '--parallel=4',
        '--reporter=junit',
        `--reporter-outfile=${report}`,
        `./${first}`,
        `./${second}`,
      ],
      { cwd: root, encoding: 'utf8', timeout: 10_000, env: { ...process.env, CI: ci } },
    )
  const hosted = runBun('true')
  assert.ifError(hosted.error)
  assert.equal(hosted.status, 1, hosted.stderr)
  assert.match(hosted.stderr, /\.only is disabled in CI environments/)

  // Without the runtime CI guard, both the runner and the report merger accept the incomplete result.
  const run = runBun('false')
  assert.ifError(run.error)
  assert.equal(run.status, 0, run.stderr)
  const output = join(root, 'merged.xml')
  const merged = python(root, 'merge-source-junit.py', [output, report, '--files', inventory])
  assert.equal(merged.status, 0, merged.stderr)
  assert.deepEqual(
    readJUnitCases(output)
      .map(({ name }) => name)
      .sort(),
    ['focused helper case', 'regular second case'],
  )

  const focused = check()
  assert.ifError(focused.error)
  assert.notEqual(focused.status, 0, focused.stderr)
  assert.match(focused.stdout + focused.stderr, /noFocusedTests/)
  assert.match(focused.stdout + focused.stderr, /nested fixtures\/register\.ts/)
})

test('real parallel Bun proof retains every selected file and rejects skips, failures and omissions', () => {
  const root = fixture()
  const first = 'first.test.ts'
  const second = 'second.test.ts'
  const passing =
    'import { test, expect } from "bun:test"; test("passed", () => expect(1).toBe(1));'
  write(root, first, passing)
  const other = write(root, second, passing)
  const inventory = write(root, 'selected.files', `${first}\n${second}\n`)
  const merge = (report, output) =>
    python(root, 'merge-source-junit.py', [output, report, '--files', inventory])
  for (const scenario of [
    { name: 'pass', registration: '', files: [first, second], bunStatus: 0 },
    {
      name: 'skip',
      registration: 'test.skip("skip", () => {});',
      files: [first, second],
      bunStatus: 0,
      rejection: /empty, failed or skipped source report/,
    },
    {
      name: 'fail',
      registration: 'test("fail", () => expect(1).toBe(2));',
      files: [first, second],
      bunStatus: 1,
      rejection: /empty, failed or skipped source report/,
    },
    {
      name: 'missing',
      registration: '',
      files: [first],
      bunStatus: 0,
      rejection: /source report does not cover its exact selected files/,
    },
  ]) {
    writeFileSync(other, `${passing}\n${scenario.registration}\n`)
    const report = join(root, `${scenario.name}.xml`)
    const output = join(root, `${scenario.name}-merged.xml`)
    const run = spawnSync(
      'bun',
      [
        'test',
        '--parallel=4',
        '--reporter=junit',
        `--reporter-outfile=${report}`,
        ...scenario.files.map((file) => `./${file}`),
      ],
      { cwd: root, encoding: 'utf8', timeout: 10_000 },
    )
    assert.equal(run.status, scenario.bunStatus, run.stderr)
    const merged = merge(report, output)
    if (scenario.rejection) {
      assert.equal(merged.status, 1, merged.stderr)
      assert.match(merged.stderr, scenario.rejection)
      assert.throws(() => readFileSync(output), { code: 'ENOENT' })
    } else {
      assert.equal(merged.status, 0, merged.stderr)
      assert.deepEqual(
        readJUnitCases(output)
          .map(({ file, name }) => [file, name])
          .sort(),
        [
          [first, 'passed'],
          [second, 'passed'],
        ],
      )
    }
  }
})

function copiedFixture() {
  const root = fixture()
  const body = 'test("current",()=>{})'
  const source = write(root, 'examples/application/test/current.test.ts', body)
  const copy = write(root, 'temporary/application/test/current.test.ts', body)
  const mapping = write(
    root,
    'mapping.json',
    JSON.stringify([{ source: 'examples/application/test/current.test.ts', copy }]),
  )
  const report = write(
    root,
    'application.xml',
    `<testsuites tests="1"><testcase file="${copy}" name="current"/></testsuites>`,
  )
  return { root, source, copy, mapping, report }
}
function normalize(f) {
  return python(f.root, 'normalize-source-junit.py', [
    '--report',
    f.report,
    '--mapping',
    f.mapping,
    '--repository',
    f.root,
  ])
}
test('application JUnit normalization changes only the file identity after exact source-byte verification', () => {
  const f = copiedFixture()
  const normalized = normalize(f)
  assert.equal(normalized.status, 0, normalized.stderr)
  const xml = readFileSync(f.report, 'utf8')
  assert.match(xml, /file="examples\/application\/test\/current.test.ts"/)
  assert.match(xml, /name="current"/)
  assert.match(xml, /tests="1"/)
})
test('application reports cannot qualify modified copies, missing or foreign files, aliases or skipped cases', () => {
  for (const mutate of [
    (f) => writeFileSync(f.copy, 'different bytes'),
    (f) => writeFileSync(f.report, '<testsuites tests="0"/>'),
    (f) =>
      writeFileSync(
        f.report,
        '<testsuites tests="1"><testcase file="foreign" name="invented"/></testsuites>',
      ),
    (f) =>
      writeFileSync(
        f.report,
        readFileSync(f.report, 'utf8').replace('/>', '><skipped/></testcase>'),
      ),
    (f) => {
      rmSync(f.copy)
      symlinkSync(f.source, f.copy)
    },
  ]) {
    const f = copiedFixture()
    mutate(f)
    assert.notEqual(normalize(f).status, 0)
  }
})
test('source report merge keeps every passing record and refuses skips, failures and declared count truncation', () => {
  for (const invalid of ['<skipped/>', '<failure/>', '<error/>']) {
    const root = fixture()
    const report = write(
      root,
      'bad.xml',
      `<testsuites tests="1"><testcase file="test.ts" name="case">${invalid}</testcase></testsuites>`,
    )
    assert.notEqual(
      python(root, 'merge-source-junit.py', [join(root, 'merged.xml'), report]).status,
      0,
    )
  }
  const root = fixture()
  const a = write(
    root,
    'a.xml',
    '<testsuites tests="1"><testcase file="a.ts" name="a"/></testsuites>',
  )
  const b = write(
    root,
    'b.xml',
    '<testsuites tests="1"><testcase file="b.ts" name="b"/></testsuites>',
  )
  const output = join(root, 'merged.xml')
  assert.equal(python(root, 'merge-source-junit.py', [output, a, b]).status, 0)
  assert.match(readFileSync(output, 'utf8'), /<testsuites tests="2">/)
  writeFileSync(b, '<testsuites tests="2"><testcase file="b.ts" name="b"/></testsuites>')
  assert.notEqual(python(root, 'merge-source-junit.py', [output, a, b]).status, 0)
})
