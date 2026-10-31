#!/usr/bin/env node
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { appendFileSync, readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { releaseState } from '../release/state.mjs'

const revision = /^[0-9a-f]{40}$/
const roles = {
  linux: ['scope', 'host-artifacts', 'host-suite', 'rootless-linux'],
  macos: ['scope', 'host-artifacts', 'prerequisites', 'qualified-architecture'],
}

// These inputs do not enter a Jig native host or its npm artifacts. Everything
// else, including mixed changes and the shared Reporting descriptor, stays full.
export function independentHostInput(path) {
  if (path === 'packages/jiggy-reporting/src/jiggy/reporting/reporting.json') return false
  if (path.startsWith('site/')) return true
  if (/^docs\/(?:flow|jig)\/spec\//.test(path)) return false
  if (path.startsWith('docs/')) return true
  if (/^packages\/jiggy-(?:flow|reporting)\//.test(path)) return true
  if (/^\.agents\/(?:doctrine|coordination)\/.+\.md$/.test(path)) return true
  return ['README.md', 'CONTRIBUTING.md', 'AGENTS.md'].includes(path)
}

export async function hostScope({ scope, repository = process.cwd(), env = process.env, event } = {}) {
  const git = (args) =>
    execFileSync('git', ['-C', repository, ...args], {
      encoding: 'utf8',
      timeout: 10000,
      maxBuffer: 16 * 1024 * 1024,
    })
  const source = git(['rev-parse', 'HEAD']).trim()
  assert.match(source, revision)
  if (env.GITHUB_SHA !== undefined)
    assert.equal(source, env.GITHUB_SHA, 'Workflow checkout changed')
  const full = (reason) => ({ source, required: true, reason })
  if (scope === 'macos' && env.GITHUB_EVENT_NAME === 'push' && env.GITHUB_REF === 'refs/heads/main') {
    try {
      event ??= JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8'))
      assert.equal(event.ref, 'refs/heads/main')
      assert.equal(event.after, source)
      assert.equal(event.deleted, false)
      assert.ok(env.GITHUB_REPOSITORY)
      assert.equal(event.repository?.full_name, env.GITHUB_REPOSITORY)
      const state = await releaseState(repository, source)
      if (state.eligible) return full('Eligible generated release requires complete host qualification')
      assert.ok(['feature-source', 'pending-changesets', 'stale-release-plan'].includes(state.reason))
      return { source, required: false, reason: `Nonrelease main source: ${state.reason}` }
    } catch {
      return full('A complete trusted main release comparison could not be established')
    }
  }
  if (env.GITHUB_EVENT_NAME !== 'pull_request')
    return full('Manual and unverified events require complete host qualification')
  try {
    event ??= JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8'))
    const base = event.pull_request?.base?.sha
    const head = event.pull_request?.head?.sha
    assert.match(base, revision)
    assert.match(head, revision)
    const parents = git(['rev-list', '--parents', '-n', '1', source]).trim().split(' ').slice(1)
    assert.equal(parents.length, 2, 'PR must test its complete merge state')
    assert.equal(parents[0], base)
    assert.equal(parents[1], head)
    git(['merge-base', '--is-ancestor', base, source])
    const paths = git(['diff', '--no-ext-diff', '--no-renames', '--name-only', '-z', base, source])
      .split('\0')
      .filter(Boolean)
    if (!paths.length || !paths.every(independentHostInput))
      return full('Source, shared, mixed or uncertain inputs require full host qualification')
    return {
      source,
      base,
      required: false,
      reason: 'Only independent site, documentation or Python inputs changed',
      changedFiles: paths.length,
    }
  } catch {
    return full('A complete trusted PR comparison could not be established')
  }
}

export function checkHostJobs(scope, report, statuses) {
  assert.ok(roles[scope], 'Unknown host scope')
  assert.deepEqual(
    Object.keys(statuses).sort(),
    [...roles[scope]].sort(),
    'Incomplete host job result set',
  )
  assert.equal(statuses.scope, 'success', 'Host scope check failed')
  for (const role of roles[scope].slice(1))
    assert.equal(
      statuses[role],
      report.required ? 'success' : 'skipped',
      `Unexpected host job result: ${role}`,
    )
  return report
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const options = {}
    for (let index = 2; index < process.argv.length; index += 2) {
      const key = process.argv[index],
        value = process.argv[index + 1]
      assert.ok(
        ['--scope', '--github-output', '--results'].includes(key) &&
          value &&
          options[key] === undefined,
        'Invalid host scope options',
      )
      options[key] = value
    }
    assert.ok(roles[options['--scope']], 'Declare linux or macos scope')
    const report = await hostScope({ scope: options['--scope'] })
    if (options['--results'])
      checkHostJobs(
        options['--scope'],
        report,
        JSON.parse(readFileSync(options['--results'], 'utf8')),
      )
    if (options['--github-output'])
      appendFileSync(options['--github-output'], `required=${report.required}\n`)
    console.log(JSON.stringify(report, null, 2))
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
