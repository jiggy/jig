import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  MAC_HOST_POLICY,
  readMacHostPrerequisites,
  requireMacHostPrerequisites,
} from './macos-host-profiles.mjs'

function evidence(architecture, build) {
  return {
    kind: 'macos-host-prerequisites/1',
    arch: architecture,
    kernel: '24.6.0',
    build,
    bun: '1.4.4',
    revision: '38afee6c84fcf48c0edb2466aa4b27d287a59c30',
    processIdentityBytes: 56,
    coalitionIdentityBytes: 40,
    coalitionUsageBytes: 296,
    pidVersion: 0,
    backendQualified: false,
  }
}

test('ARM admission records differing OS builds and pins the executable runtime', () => {
  assert.ok(Object.isFrozen(MAC_HOST_POLICY))
  assert.deepEqual(MAC_HOST_POLICY.releaseMajors, [15, 26])
  for (const [kernel, build] of [
    ['24.6.0', '24G830'],
    ['24.6.1', '24H233'],
    ['25.6.0', '25G332'],
  ]) {
    const observed = { ...evidence('arm64', build), kernel }
    assert.equal(requireMacHostPrerequisites(observed, 'arm64'), observed)
    assert.equal(observed.backendQualified, false)
  }
  for (const change of [
    { arch: 'x64' },
    { kernel: '23.6.0' },
    { kernel: '24.6' },
    { kernel: '24.6.0\n' },
    { build: 'invalid' },
    { build: '24G830\n' },
    { bun: '1.4.5' },
    { revision: 'changed' },
  ])
    assert.throws(() =>
      requireMacHostPrerequisites({ ...evidence('arm64', '24G830'), ...change }, 'arm64'),
    )
  assert.throws(() => requireMacHostPrerequisites(evidence('arm64', '24G830'), 'x64'))
})

test('candidate identity never substitutes for complete native prerequisite evidence', () => {
  for (const build of ['24G830', '24H232']) {
    const observed = evidence('arm64', build)
    for (const mutation of [
      { kind: 'other' },
      { arch: 'x64' },
      { processIdentityBytes: 55 },
      { coalitionIdentityBytes: 41 },
      { coalitionUsageBytes: 295 },
      { pidVersion: -1 },
      { pidVersion: 1.5 },
      { pidVersion: Number.MAX_SAFE_INTEGER + 1 },
      { pidVersion: undefined },
      { backendQualified: true },
      { backendQualified: undefined },
    ])
      assert.throws(() => requireMacHostPrerequisites({ ...observed, ...mutation }, 'arm64'))
    assert.throws(() => requireMacHostPrerequisites(observed, 'x64'))
  }
  assert.throws(() => requireMacHostPrerequisites(null, 'arm64'))
})

test('descriptor-bound prerequisites accept observed ARM builds and refuse unsafe files', () => {
  const root = mkdtempSync(join(tmpdir(), 'jig-profile-reader-'))
  try {
    const path = join(root, 'prerequisites.json')
    for (const build of ['24G830', '24H232']) {
      const record = evidence('arm64', build)
      writeFileSync(path, JSON.stringify(record).padEnd(8192))
      assert.deepEqual(readMacHostPrerequisites(path, 'arm64'), record)
      writeFileSync(path, JSON.stringify(record).padEnd(8193))
      assert.throws(() => readMacHostPrerequisites(path, 'arm64'), /bounded regular file/)
    }
    symlinkSync(path, join(root, 'linked.json'))
    assert.throws(() => readMacHostPrerequisites(join(root, 'linked.json'), 'arm64'), /ELOOP/)
    const directory = join(root, 'directory')
    mkdirSync(directory)
    assert.throws(() => readMacHostPrerequisites(directory, 'arm64'), /bounded regular file/)
    const fifo = join(root, 'fifo')
    const created = spawnSync('mkfifo', [fifo], { encoding: 'utf8' })
    assert.equal(created.status, 0, created.stderr)
    const result = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `import { readMacHostPrerequisites } from ${JSON.stringify(new URL('./macos-host-profiles.mjs', import.meta.url).href)}; readMacHostPrerequisites(process.argv[1], 'arm64')`,
        fifo,
      ],
      { encoding: 'utf8', timeout: 5000 },
    )
    assert.equal(result.error, undefined, String(result.error))
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /bounded regular file/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
