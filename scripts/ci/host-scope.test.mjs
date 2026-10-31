import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { checkHostJobs, hostScope, independentHostInput } from './host-scope.mjs'

function mergeFixture(t, paths) {
  const root = mkdtempSync(join(tmpdir(), 'jig-host-scope-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const git = (...args) =>
    execFileSync('git', ['-C', root, '-c', 'commit.gpgsign=false', ...args], {
      encoding: 'utf8',
    }).trim()
  git('init', '--quiet')
  git('config', 'user.name', 'fixture')
  git('config', 'user.email', 'fixture@example.invalid')
  writeFileSync(join(root, 'seed'), 'base')
  git('add', '.')
  git('commit', '--quiet', '-m', 'base')
  const base = git('rev-parse', 'HEAD'),
    branch = git('branch', '--show-current')
  git('checkout', '--quiet', '-b', 'proposal')
  for (const path of paths) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), 'changed')
  }
  git('add', '.')
  git('commit', '--quiet', '-m', 'proposal')
  const head = git('rev-parse', 'HEAD')
  git('checkout', '--quiet', branch)
  git('merge', '--quiet', '--no-ff', 'proposal', '-m', 'tested merge')
  const source = git('rev-parse', 'HEAD')
  return {
    repository: root,
    env: { GITHUB_EVENT_NAME: 'pull_request', GITHUB_SHA: source },
    event: { pull_request: { base: { sha: base }, head: { sha: head } } },
  }
}

test('verified independent PR inputs avoid native jobs while source, mixed and unknown changes stay full', async (t) => {
  for (const paths of [
    ['site/jig/public/new.svg'],
    ['docs/jig/guide/new.md'],
    ['packages/jiggy-flow/tests/new.py'],
    ['.agents/doctrine/jig.md'],
  ])
    assert.equal((await hostScope(mergeFixture(t, paths))).required, false)
  for (const paths of [
    ['packages/jig/src/change.ts'],
    ['scripts/ci/change.mjs'],
    ['new-owner/data.json'],
    ['site/jig/public/new.svg', 'packages/jig/src/change.ts'],
    ['docs/jig/spec/new.md'],
    ['packages/jiggy-reporting/src/jiggy/reporting/reporting.json'],
  ])
    assert.equal((await hostScope(mergeFixture(t, paths))).required, true)
})

test('unverified main, manual, unavailable and forged PR comparisons cannot omit host jobs', async (t) => {
  const f = mergeFixture(t, ['site/jig/public/new.svg'])
  for (const eventName of ['push', 'workflow_dispatch', 'merge_group'])
    assert.equal(
      (await hostScope({ ...f, env: { ...f.env, GITHUB_EVENT_NAME: eventName } })).required,
      true,
    )
  assert.equal((await hostScope({ ...f, event: {} })).required, true)
  assert.equal(
    (await hostScope({
      ...f,
      event: {
        pull_request: {
          base: { sha: f.event.pull_request.head.sha },
          head: f.event.pull_request.head,
        },
      },
    })).required,
    true,
  )
  await assert.rejects(
    () => hostScope({ ...f, env: { ...f.env, GITHUB_SHA: 'a'.repeat(40) } }),
    /checkout changed/,
  )
})

test('always-present host gates require successful scope and exactly complete or omitted role sets', () => {
  for (const [scope, jobs] of [
    ['linux', ['host-artifacts', 'host-suite', 'rootless-linux']],
    ['macos', ['host-artifacts', 'prerequisites', 'qualified-architecture']],
  ]) {
    for (const required of [true, false]) {
      const report = { required },
        statuses = {
          scope: 'success',
          ...Object.fromEntries(jobs.map((job) => [job, required ? 'success' : 'skipped'])),
        }
      assert.equal(checkHostJobs(scope, report, statuses), report)
      for (const state of ['failure', 'cancelled', required ? 'skipped' : 'success'])
        assert.throws(() => checkHostJobs(scope, report, { ...statuses, [jobs[0]]: state }))
      assert.throws(() => checkHostJobs(scope, report, { ...statuses, scope: 'failure' }))
      const missing = { ...statuses }
      delete missing[jobs[1]]
      assert.throws(() => checkHostJobs(scope, report, missing))
    }
  }
  assert.equal(independentHostInput('docs/flow/spec/run.md'), false)
})
