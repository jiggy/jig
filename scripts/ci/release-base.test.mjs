import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { releaseBase } from './release-base.mjs'

const script = fileURLToPath(new URL('./release-base.mjs', import.meta.url))

function fixture(t) {
  const repository = mkdtempSync(join(tmpdir(), 'jig-release-base-'))
  t.after(() => rmSync(repository, { recursive: true, force: true }))
  const git = (args) =>
    execFileSync('git', ['-C', repository, ...args], { encoding: 'utf8' }).trim()
  const commit = (message) => {
    git(['add', '--all'])
    git(['commit', '--quiet', '--allow-empty', '-m', message])
    return git(['rev-parse', 'HEAD'])
  }
  git(['init', '--quiet', '--initial-branch=main'])
  git(['config', 'user.name', 'Release Comparison Test'])
  git(['config', 'user.email', 'release-comparison@localhost'])
  git(['config', 'commit.gpgsign', 'false'])
  git(['config', 'core.hooksPath', '/dev/null'])
  writeFileSync(join(repository, 'README.md'), 'Initial source.\n')
  const initial = commit('Initial source')
  git(['checkout', '--quiet', '-b', 'feature'])
  writeFileSync(join(repository, 'feature.txt'), 'Feature change.\n')
  const head = commit('Feature change')
  git(['checkout', '--quiet', 'main'])
  writeFileSync(join(repository, 'target.txt'), 'Later main change.\n')
  const base = commit('Advance main')
  git(['merge', '--quiet', '--no-ff', '-m', 'Tested PR merge', 'feature'])
  const source = git(['rev-parse', 'HEAD'])
  return {
    repository,
    git,
    commit,
    initial,
    base,
    head,
    source,
    env: { GITHUB_EVENT_NAME: 'pull_request', GITHUB_SHA: source },
    event: { pull_request: { base: { sha: initial }, head: { sha: head } } },
  }
}

test('PR comparisons exclude later main changes by using the tested first parent', (t) => {
  const f = fixture(t)
  assert.equal(releaseBase(f), f.base)
  assert.deepEqual(f.git(['diff', '--name-only', f.initial, f.source]).split('\n'), [
    'feature.txt',
    'target.txt',
  ])
  assert.equal(f.git(['diff', '--name-only', releaseBase(f), f.source]), 'feature.txt')
})

test('matching PR bases work in detached checkouts without local branch names', (t) => {
  const f = fixture(t)
  f.git(['checkout', '--quiet', '--detach', f.source])
  f.git(['branch', '--delete', '--force', 'main', 'feature'])
  f.event.pull_request.base.sha = f.base
  assert.equal(releaseBase(f), f.base)
})

test('missing, changed, or unsupported workflow identities cannot select a baseline', (t) => {
  const f = fixture(t)
  for (const sha of [undefined, '', 'main'])
    assert.throws(
      () => releaseBase({ ...f, env: { ...f.env, GITHUB_SHA: sha } }),
      /workflow source SHA is required/,
    )
  assert.throws(
    () => releaseBase({ ...f, env: { ...f.env, GITHUB_SHA: f.head } }),
    /Workflow checkout changed/,
  )
  assert.throws(
    () => releaseBase({ ...f, env: { ...f.env, GITHUB_EVENT_NAME: 'schedule' } }),
    /requires a pull request, push, or manual workflow event/,
  )
  assert.throws(
    () => releaseBase({ ...f, event: undefined }),
    /requires the workflow event payload/,
  )
})

test('PR comparisons refuse mismatched heads and unavailable or unrelated target histories', (t) => {
  const f = fixture(t)
  const unrelated = f.git(['commit-tree', f.git(['rev-parse', 'HEAD^{tree}']), '-m', 'Unrelated'])
  for (const [base, head, expected] of [
    [f.initial, f.initial, /PR merge head differs/],
    [f.initial, undefined, /PR event head must be a full commit SHA/],
    [undefined, f.head, /PR event base must be a full commit SHA/],
    ['f'.repeat(40), f.head, /PR event base must identify an available commit/],
    [f.head, f.head, /PR event base is not an ancestor/],
    [unrelated, f.head, /PR event base is not an ancestor/],
  ])
    assert.throws(
      () =>
        releaseBase({
          ...f,
          event: { pull_request: { base: { sha: base }, head: { sha: head } } },
        }),
      expected,
    )
})

test('PR checks refuse linear and octopus commits instead of guessing a merge base', (t) => {
  const f = fixture(t)
  f.git(['checkout', '--quiet', '--detach', f.head])
  assert.throws(
    () => releaseBase({ ...f, env: { ...f.env, GITHUB_SHA: f.head } }),
    /complete two-parent merge/,
  )
  const third = f.git(['commit-tree', f.git(['rev-parse', 'HEAD^{tree}']), '-m', 'Third history'])
  const octopus = f.git([
    'commit-tree',
    f.git(['rev-parse', `${f.source}^{tree}`]),
    '-p',
    f.base,
    '-p',
    f.head,
    '-p',
    third,
    '-m',
    'Octopus source',
  ])
  f.git(['checkout', '--quiet', '--detach', octopus])
  assert.throws(
    () => releaseBase({ ...f, env: { ...f.env, GITHUB_SHA: octopus } }),
    /complete two-parent merge/,
  )
})

test('push checks retain the full event range and refuse unverified previous revisions', (t) => {
  const f = fixture(t)
  const middle = f.commit('First pushed commit')
  const source = f.commit('Second pushed commit')
  const options = {
    repository: f.repository,
    env: { GITHUB_EVENT_NAME: 'push', GITHUB_SHA: source },
    event: { before: f.source, after: source },
  }
  assert.equal(releaseBase(options), f.source)
  assert.notEqual(releaseBase(options), middle)
  assert.throws(
    () => releaseBase({ ...options, event: { before: f.source, after: middle } }),
    /Push source differs/,
  )
  const unrelated = f.git(['commit-tree', f.git(['rev-parse', 'HEAD^{tree}']), '-m', 'Unrelated'])
  for (const [before, expected] of [
    [undefined, /Push previous revision must be a full commit SHA/],
    ['0'.repeat(40), /Push previous revision must identify an available commit/],
    [source, /require a previous revision/],
    [unrelated, /Push previous revision is not an ancestor/],
  ])
    assert.throws(() => releaseBase({ ...options, event: { before, after: source } }), expected)
})

test('manual checks use the source first parent and fail for an initial commit', (t) => {
  const f = fixture(t)
  const env = { GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_SHA: f.source }
  assert.equal(releaseBase({ repository: f.repository, env }), f.base)
  f.git(['checkout', '--quiet', '--detach', f.initial])
  assert.throws(
    () => releaseBase({ repository: f.repository, env: { ...env, GITHUB_SHA: f.initial } }),
    /Manual release checks require a source parent/,
  )
})

test('the CLI reads the workflow event and returns no baseline after validation fails', (t) => {
  const f = fixture(t)
  const eventPath = join(f.repository, 'event.json')
  writeFileSync(eventPath, JSON.stringify(f.event))
  const options = {
    cwd: f.repository,
    env: { ...process.env, ...f.env, GITHUB_EVENT_PATH: eventPath },
    encoding: 'utf8',
  }
  const result = spawnSync(process.execPath, [script], options)
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout, `${f.base}\n`)
  f.event.pull_request.head.sha = f.initial
  writeFileSync(eventPath, JSON.stringify(f.event))
  const failure = spawnSync(process.execPath, [script], options)
  assert.equal(failure.status, 1)
  assert.equal(failure.stdout, '')
  assert.match(failure.stderr, /PR merge head differs/)
})
