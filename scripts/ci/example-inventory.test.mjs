import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { EXAMPLE_E2E_TEST, EXAMPLE_HOST_TESTS, exampleInventory } from '../example-inventory.mjs'

const repository = fileURLToPath(new URL('../../', import.meta.url))
const script = join(repository, 'scripts/example-inventory.mjs')
const canonicalManifest = JSON.parse(
  readFileSync(new URL('./test-suites.json', import.meta.url), 'utf8'),
)
const roots = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function put(root, path, value = 'test("example", () => {})\n') {
  mkdirSync(dirname(join(root, path)), { recursive: true })
  writeFileSync(join(root, path), value)
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'jig-example-inventory-'))
  roots.push(root)
  execFileSync('git', ['-C', root, 'init', '--quiet'])
  put(root, 'scripts/ci/test-suites.json', JSON.stringify(canonicalManifest))
  put(root, EXAMPLE_E2E_TEST)
  for (const [name, hostTests] of Object.entries(EXAMPLE_HOST_TESTS)) {
    put(root, `examples/${name}/package.json`, JSON.stringify({ name, private: true }))
    put(root, `examples/${name}/jig.ts`, 'export default {}\n')
    put(root, `examples/${name}/test/application.test.ts`)
    for (const path of hostTests) put(root, path)
  }
  return root
}

test('every authored example has application and native execution coverage', () => {
  const examples = exampleInventory(repository)
  assert.deepEqual(
    examples.map(({ name }) => name),
    Object.keys(EXAMPLE_HOST_TESTS).sort(),
  )
  for (const example of examples) {
    assert.ok(example.sourceTests.length)
    assert.ok(example.hostTests.length)
    assert.equal(example.e2eTest, EXAMPLE_E2E_TEST)
  }
})

test('inventory discovers complete real filesystem projects in stable order', () => {
  const examples = exampleInventory(fixture())
  assert.deepEqual(
    examples.map(({ name }) => name),
    Object.keys(EXAMPLE_HOST_TESTS).sort(),
  )
  assert.ok(examples.every((example) => example.sourceTests.length === 1))
})

test('new and removed example directories cannot escape coverage registration', () => {
  const root = fixture()
  put(root, 'examples/new-example/package.json', '{"name":"new-example"}')
  put(root, 'examples/new-example/jig.ts', 'export default {}')
  put(root, 'examples/new-example/test/application.test.ts')
  assert.throws(() => exampleInventory(root), /No installed-host coverage.*new-example/)
  rmSync(join(root, 'examples/new-example'), { recursive: true })
  rmSync(join(root, 'examples/support-case'), { recursive: true })
  assert.throws(() => exampleInventory(root), /Stale example coverage: support-case/)
})

test('required authored inputs and actual application tests cannot disappear', () => {
  for (const path of ['package.json', 'jig.ts', 'test']) {
    const root = fixture()
    rmSync(join(root, 'examples/contact-import', path), { recursive: true })
    assert.throws(() => exampleInventory(root), /Missing example input/)
  }
  const root = fixture()
  rmSync(join(root, 'examples/contact-import/test/application.test.ts'))
  assert.throws(() => exampleInventory(root), /Example has no application tests: contact-import/)
})

test('linked example directories and authored entrypoints are refused', () => {
  const root = fixture()
  symlinkSync(join(root, 'examples/contact-import'), join(root, 'examples/alias'))
  assert.throws(() => exampleInventory(root), /Linked example input/)
  rmSync(join(root, 'examples/alias'))
  rmSync(join(root, 'examples/contact-import/jig.ts'))
  symlinkSync(
    join(root, 'examples/support-case/jig.ts'),
    join(root, 'examples/contact-import/jig.ts'),
  )
  assert.throws(() => exampleInventory(root), /Required regular file/)
})

test('missing host files and target exclusions invalidate execution coverage', () => {
  const root = fixture()
  const hostTest = EXAMPLE_HOST_TESTS['contact-import'][0]
  rmSync(join(root, hostTest))
  assert.throws(
    () => exampleInventory(root),
    /Missing example input|outside required native targets/,
  )

  const other = fixture()
  const manifest = structuredClone(canonicalManifest)
  manifest.targets.find(({ id }) => id === 'linux').suiteIds = manifest.targets
    .find(({ id }) => id === 'linux')
    .suiteIds.filter((id) => id !== 'jig-host')
  put(other, 'scripts/ci/test-suites.json', JSON.stringify(manifest))
  assert.throws(() => exampleInventory(other), /outside required native targets/)
})

test('application tests must remain selected by the source application target', () => {
  const root = fixture()
  const manifest = structuredClone(canonicalManifest)
  manifest.targets.find(({ id }) => id === 'source-applications').suiteIds = []
  put(root, 'scripts/ci/test-suites.json', JSON.stringify(manifest))
  assert.throws(() => exampleInventory(root), /outside the complete application stage/)
})

test('end-to-end execution is mandatory in the complete Linux target', () => {
  const root = fixture()
  rmSync(join(root, EXAMPLE_E2E_TEST))
  assert.throws(() => exampleInventory(root), /Missing example input|end-to-end suite/)

  const other = fixture()
  const manifest = structuredClone(canonicalManifest)
  const linux = manifest.targets.find(({ id }) => id === 'linux')
  linux.suiteIds = linux.suiteIds.filter((id) => id !== 'linux-host')
  put(other, 'scripts/ci/test-suites.json', JSON.stringify(manifest))
  assert.throws(() => exampleInventory(other), /end-to-end suite/)
})

test('CLI emits names or structured coverage and refuses invalid arguments', () => {
  const root = fixture()
  const run = (...args) =>
    spawnSync(process.execPath, [script, '--root', root, ...args], { encoding: 'utf8' })
  const names = run('--format', 'names')
  assert.equal(names.status, 0, names.stderr)
  assert.deepEqual(names.stdout.trim().split('\n'), Object.keys(EXAMPLE_HOST_TESTS).sort())
  const json = run('--format', 'json')
  assert.equal(json.status, 0, json.stderr)
  assert.deepEqual(JSON.parse(json.stdout), exampleInventory(root))
  for (const args of [
    ['--format', 'other'],
    ['--format'],
    ['--unknown', 'value'],
    ['--format', 'names', '--format', 'json'],
  ]) {
    const refused = run(...args)
    assert.equal(refused.status, 1)
    assert.equal(refused.stdout, '')
    assert.match(refused.stderr, /Example inventory refused/)
  }
})
