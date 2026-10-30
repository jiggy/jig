import assert from 'node:assert/strict'
import { test } from 'node:test'
import { balanceWholeFiles, HOST_TEST_DURATIONS, hostTestSeconds } from './host-test-scheduling.mjs'

test('whole-file costs balance uneven work independently of input order', () => {
  const seconds = { a: 100, b: 80, c: 60, d: 40, e: 20, f: 10 }
  const files = Object.keys(seconds)
  const plan = balanceWholeFiles(files, 3, (file) => seconds[file])
  assert.deepEqual(
    plan.map((shard) => shard.groups.map(({ file }) => file)),
    [
      ['a', 'f'],
      ['b', 'e'],
      ['c', 'd'],
    ],
  )
  assert.deepEqual(
    plan.map((shard) => shard.estimatedSeconds),
    [110, 100, 100],
  )
  assert.deepEqual(
    balanceWholeFiles(files.reverse(), 3, (file) => seconds[file]),
    plan,
  )
  assert.deepEqual(
    plan.flatMap((shard) => shard.groups.map(({ file }) => file)).sort(),
    Object.keys(seconds).sort(),
  )
})

test('fixed native and installed work consumes capacity before ordinary files', () => {
  const plan = balanceWholeFiles(['a', 'b', 'c', 'd'], 2, () => 20, [30, 50])
  assert.deepEqual(
    plan.map((shard) => shard.estimatedSeconds),
    [90, 70],
  )
  assert.equal(plan.flatMap((shard) => shard.groups).length, 4)
})

test('unknown lifecycle files receive a conservative estimate without losing membership', () => {
  const host = 'packages/jig/test/host/future.test.ts'
  const portable = 'packages/jig/test/portable/future.test.ts'
  for (const profile of ['linux', 'x64', 'arm64']) {
    assert.equal(hostTestSeconds(host, profile), 60)
    assert.equal(hostTestSeconds(portable, profile), 2)
    const plan = balanceWholeFiles([host, portable], 2, (file) => hostTestSeconds(file, profile))
    assert.deepEqual(
      plan.flatMap((shard) => shard.groups.map(({ file }) => file)).sort(),
      [host, portable].sort(),
    )
  }
})

test('successful historical Linux costs replay below filename-modulo completion time', () => {
  const files = Object.keys(HOST_TEST_DURATIONS.fileSeconds.linux).sort()
  const modulo = [0, 0, 0]
  files.forEach((file, index) => {
    modulo[index % 3] += hostTestSeconds(file, 'linux')
  })
  const plan = balanceWholeFiles(files, 3, (file) => hostTestSeconds(file, 'linux'))
  assert.ok(Math.max(...plan.map((shard) => shard.estimatedSeconds)) < Math.max(...modulo))
  assert.equal(
    plan.reduce((sum, shard) => sum + shard.estimatedSeconds, 0),
    modulo.reduce((sum, seconds) => sum + seconds, 0),
  )
})

test('invalid costs and incomplete whole-file partitions refuse scheduling', () => {
  assert.throws(() => balanceWholeFiles(['a', 'a'], 2, () => 1), /repeats/)
  assert.throws(() => balanceWholeFiles(['a'], 2, () => 1), /nonempty/)
  for (const count of [0, 1.5, NaN]) assert.throws(() => balanceWholeFiles(['a'], count, () => 1))
  for (const seconds of [0, -1, NaN, Infinity]) {
    assert.throws(() => balanceWholeFiles(['a'], 1, () => seconds), /duration/)
    assert.throws(
      () => hostTestSeconds('a', 'linux', { fileSeconds: { linux: { a: seconds } } }),
      /duration/,
    )
  }
  assert.throws(() => balanceWholeFiles(['a'], 1, () => 1, [-1]), /fixed/)
  assert.throws(() => hostTestSeconds('a', 'other'), /profile/)
})
