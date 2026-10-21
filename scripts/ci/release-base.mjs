#!/usr/bin/env node
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const revision = /^[0-9a-f]{40}$/

export function releaseBase({ repository = process.cwd(), env = process.env, event } = {}) {
  const git = (args) =>
    execFileSync('git', ['-C', repository, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 10000,
      maxBuffer: 1024 * 1024,
    }).trim()
  const commit = (value, label) => {
    assert.match(value ?? '', revision, `${label} must be a full commit SHA`)
    try {
      assert.equal(git(['rev-parse', '--verify', '--end-of-options', `${value}^{commit}`]), value)
    } catch {
      throw new Error(`${label} must identify an available commit`)
    }
    return value
  }
  const ancestor = (base, source, message) => {
    try {
      git(['merge-base', '--is-ancestor', base, source])
    } catch {
      throw new Error(message)
    }
  }
  const source = git(['rev-parse', 'HEAD'])
  assert.match(env.GITHUB_SHA ?? '', revision, 'The workflow source SHA is required')
  assert.equal(source, env.GITHUB_SHA, 'Workflow checkout changed')
  const parents = git(['rev-list', '--parents', '-n', '1', source]).split(' ').slice(1)

  if (env.GITHUB_EVENT_NAME === 'workflow_dispatch') {
    assert.ok(parents.length, 'Manual release checks require a source parent')
    return commit(parents[0], 'Manual source parent')
  }
  assert.ok(
    ['pull_request', 'push'].includes(env.GITHUB_EVENT_NAME),
    'Release comparison requires a pull request, push, or manual workflow event',
  )
  if (event === undefined) {
    assert.ok(env.GITHUB_EVENT_PATH, 'Release comparison requires the workflow event payload')
    event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8'))
  }
  if (env.GITHUB_EVENT_NAME === 'pull_request') {
    const base = commit(event.pull_request?.base?.sha, 'PR event base')
    const head = commit(event.pull_request?.head?.sha, 'PR event head')
    assert.equal(parents.length, 2, 'PR release checks require a complete two-parent merge')
    assert.equal(parents[1], head, 'PR merge head differs from the workflow event')
    ancestor(base, parents[0], 'PR event base is not an ancestor of the tested merge base')
    return commit(parents[0], 'Tested PR merge base')
  }
  assert.equal(event.after, source, 'Push source differs from the workflow event')
  const base = commit(event.before, 'Push previous revision')
  assert.notEqual(base, source, 'Push release checks require a previous revision')
  ancestor(base, source, 'Push previous revision is not an ancestor of the tested source')
  return base
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    assert.equal(process.argv.length, 2, 'release-base takes no arguments')
    console.log(releaseBase())
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
