import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, test } from 'node:test'

const affectedManifest = JSON.parse(readFileSync(new URL('./test-suites.json', import.meta.url)))

import {
  discoverRepositoryTests,
  filesForTarget,
  gitRepositoryTests,
  reconcileSuiteInventory,
} from './suite-inventory.mjs'

const roots = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'jig-suite-inventory-'))
  roots.push(root)
  execFileSync('git', ['-C', root, 'init', '--quiet'])
  execFileSync('git', ['-C', root, 'config', 'user.email', 'fixture@example.invalid'])
  execFileSync('git', ['-C', root, 'config', 'user.name', 'fixture'])
  return root
}
function write(root, path, body = 'test("case",()=>{})') {
  mkdirSync(dirname(join(root, path)), { recursive: true })
  writeFileSync(join(root, path), body)
}

test('local discovery observes additions and deletions while pinned Git inventory keeps exact regular source', () => {
  const root = fixture()
  const retained = 'packages/jig/test/portable/retained.test.ts'
  write(root, retained)
  execFileSync('git', ['-C', root, 'add', '.'])
  execFileSync('git', ['-C', root, 'commit', '--quiet', '-m', 'source'])
  rmSync(join(root, retained))
  const fresh = 'packages/display-web/test/nested/fresh.spec.mjs'
  write(root, fresh)
  write(root, 'packages/display-web/test/node_modules/dependency.test.ts')
  write(root, 'packages/display-web/test/.hidden/secret.test.ts')
  symlinkSync(join(root, fresh), join(root, 'packages/display-web/test/alias.test.ts'))
  assert.deepEqual(discoverRepositoryTests(root, affectedManifest), [fresh])
  assert.deepEqual(gitRepositoryTests(root, 'HEAD'), [retained])
  execFileSync('git', ['-C', root, 'add', '--all'])
  execFileSync('git', ['-C', root, 'commit', '--quiet', '-m', 'new inventory'])
  assert.throws(() => gitRepositoryTests(root, 'HEAD'), /symbolic link/)
})

test('whole-file profile ownership excludes inapplicable roles and gives compact targets exactly their witness', () => {
  const files = [
    'packages/jig/test/portable/plain.test.ts',
    'packages/jig/test/linux/pure.test.ts',
    'packages/jig/test/linux-host/authority.test.ts',
    'packages/jig/test/macos/native.test.ts',
    'packages/jig/test/macos-23E224/observer.test.ts',
    'packages/jig/test/host/package-provider-observation.test.ts',
    'packages/jig/test/live/client.test.ts',
    'packages/jig/test/startup/native-agent-startup.test.ts',
    'packages/agent-method/test/method.test.ts',
    'packages/display-tui/test/native.test.ts',
    'packages/jig/test/experimental/image-preview.test.ts',
  ]
  assert.deepEqual(reconcileSuiteInventory(files, affectedManifest).errors, [])
  const filesFor = (target, profile) => filesForTarget(files, target, affectedManifest, profile)
  assert.ok(!filesFor('source-portable', 'portable').includes(files[1]))
  assert.ok(filesFor('source-portable', 'portable-linux').includes(files[1]))
  assert.deepEqual(filesFor('source-protocol'), ['packages/agent-method/test/method.test.ts'])
  assert.ok(filesFor('linux').includes(files[2]))
  assert.ok(!filesFor('linux').includes(files[3]))
  assert.ok(filesFor('macos-x64').includes(files[3]))
  assert.ok(!filesFor('macos-x64').includes(files[4]))
  assert.ok(filesFor('macos-x64', 'macos-23E224').includes(files[4]))
  assert.ok(!filesFor('macos-x64').includes(files[6]))
  assert.ok(filesFor('macos-x64').includes(files[7]))
  assert.deepEqual(filesFor('macos-arm64'), filesFor('macos-x64'))
  assert.deepEqual(filesFor('macos-arm64', 'macos-24H232'), filesFor('macos-x64', 'macos-24G830'))
  assert.ok(filesFor('linux').includes(files[5]))
  assert.ok(filesFor('macos-x64').includes(files[5]))
  for (const target of ['source-portable', 'source-protocol', 'linux', 'macos-x64', 'macos-arm64'])
    assert.ok(!filesFor(target).includes(files[10]))
  assert.equal(
    reconcileSuiteInventory(files, affectedManifest).ownership[files[10]],
    'image-thread-candidate',
  )
})

test('Reporting additions retain distinct JavaScript and Python source owners', () => {
  const files = [
    'packages/reporting/test/wire.test.ts',
    'packages/reporting/test/nested/future.test.ts',
    'packages/jiggy-reporting/tests/test_wire.py',
    'packages/jiggy-reporting/tests/nested/test_future.py',
  ]
  const inventory = reconcileSuiteInventory(files, affectedManifest)
  assert.deepEqual(inventory.errors, [])
  assert.deepEqual(inventory.ownership, {
    [files[0]]: 'reporting',
    [files[1]]: 'reporting',
    [files[2]]: 'python-reporting',
    [files[3]]: 'python-reporting',
  })
  assert.deepEqual(
    filesForTarget(files, 'source-protocol', affectedManifest),
    files.slice(0, 2).sort(),
  )
  assert.deepEqual(filesForTarget(files, 'source-python', affectedManifest), files.slice(2).sort())
  for (const target of ['source-portable', 'linux', 'macos-x64', 'macos-arm64'])
    assert.deepEqual(filesForTarget(files, target, affectedManifest), [])
  assert.match(
    reconcileSuiteInventory(
      ['packages/unreviewed-reporting/test/wire.test.ts'],
      affectedManifest,
    ).errors.join('\n'),
    /Unowned/,
  )
})

test('unowned, ambiguous, duplicate and symlink tests cannot inherit suite execution from neighboring paths', () => {
  const known = 'packages/jig/test/portable/known.test.ts'
  for (const file of ['packages/jig/test/new.test.ts', 'packages/new-package/test/new.test.ts'])
    assert.match(reconcileSuiteInventory([file], affectedManifest).errors.join('\n'), /Unowned/)
  assert.match(
    reconcileSuiteInventory([known, known], affectedManifest).errors.join('\n'),
    /Repeated/,
  )
  assert.match(
    reconcileSuiteInventory([{ path: known, mode: '120000' }], affectedManifest).errors.join('\n'),
    /Non-regular/,
  )
  const changed = structuredClone(affectedManifest)
  changed.testSuites.push({
    id: 'conflict',
    roots: ['packages/jig/test/portable/'],
    profiles: ['portable-linux'],
  })
  assert.match(reconcileSuiteInventory([known], changed).errors.join('\n'), /Ambiguous/)
  const fixture = 'examples/tested-patch/fixtures/project/test/project.test.ts'
  assert.deepEqual(reconcileSuiteInventory([fixture], affectedManifest).tests, [])
})
