import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
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
