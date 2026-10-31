import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'

const fixture = new URL('../fixtures/host-test-timing.mjs', import.meta.url).href
function observe(program, enabled) {
  const result = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
    import { startHostTestTiming } from ${JSON.stringify(fixture)};
    ${program}
  `,
    ],
    {
      env: { ...process.env, JIG_HOST_TEST_TIMING: enabled ? '1' : '' },
      encoding: 'utf8',
      timeout: 5000,
    },
  )
  assert.ifError(result.error)
  assert.equal(result.status, 0, result.stderr)
  return result.stderr.trim()
    ? result.stderr
        .trim()
        .split('\n')
        .map((line) => {
          assert.ok(line.startsWith('host-test-timing '))
          return JSON.parse(line.slice('host-test-timing '.length))
        })
    : []
}

test('host timing is opt-in and observes elapsed work through fixed labels', () => {
  const program = `const finish = startHostTestTiming('workspace', 'review-command');
    await new Promise(resolve => setTimeout(resolve, 5)); finish(); finish('failed');`
  assert.deepEqual(observe(program, false), [])
  const records = observe(program, true)
  assert.equal(records.length, 1)
  assert.deepEqual(Object.keys(records[0]).sort(), ['elapsedMs', 'outcome', 'phase', 'suite'])
  assert.equal(records[0].suite, 'workspace')
  assert.equal(records[0].phase, 'review-command')
  assert.equal(records[0].outcome, 'returned')
  assert.ok(Number.isSafeInteger(records[0].elapsedMs) && records[0].elapsedMs >= 0)
})

test('host timing bounds output and excludes supplied labels and failure payloads', () => {
  const records = observe(
    `
    startHostTestTiming('private consumer path', 'review-command')();
    startHostTestTiming('foundation', 'private input')();
    for (let index = 0; index < 110; index++)
      startHostTestTiming('foundation', 'fixture-command')(new Error('private response'));
  `,
    true,
  )
  assert.equal(records.length, 97)
  assert.deepEqual(records.at(-1), { suite: 'foundation', status: 'truncated' })
  assert.ok(records.slice(0, -1).every((record) => record.outcome === 'failed'))
  assert.ok(!JSON.stringify(records).includes('private'))
})
