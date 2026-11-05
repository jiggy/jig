import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { parse } from 'yaml'
import { approvedReviews, reviewedCandidate } from './native-preflight.mjs'

const source = 'a'.repeat(40),
  head = 'b'.repeat(40),
  repository = 'jiggy/jig'
const pr = {
  number: 90,
  user: { login: 'author' },
  state: 'open',
  draft: false,
  merge_commit_sha: source,
  base: { ref: 'main', sha: 'c'.repeat(40), repo: { full_name: repository } },
  head: { sha: head, ref: 'feature', repo: { full_name: repository } },
}
const run = {
  id: 12,
  run_attempt: 2,
  path: '.github/workflows/ci.yml',
  event: 'pull_request',
  head_sha: head,
  head_branch: 'feature',
  repository: { full_name: repository },
  head_repository: { full_name: repository },
}

const approval = {
  id: 7,
  state: 'APPROVED',
  commit_id: head,
  user: { login: 'maintainer', type: 'User' },
}
const reviews = [approval],
  permissions = { maintainer: 'write' }

test('native approval requires an independent authorized review of the exact current head', () => {
  assert.equal(approvedReviews(pr, reviews, permissions)[0].commit, head)
  for (const invalid of [
    [],
    [{ ...approval, commit_id: source }],
    [{ ...approval, state: 'COMMENTED' }],
    [{ ...approval, state: 'PENDING' }],
    [{ ...approval, state: 'DISMISSED' }],
    [{ ...approval, user: { login: 'author', type: 'User' } }],
    [{ ...approval, user: { login: 'maintainer', type: 'Bot' } }],
    [approval, { ...approval, id: 8, state: 'DISMISSED' }],
    [approval, { ...approval, id: 8, state: 'CHANGES_REQUESTED' }],
    [approval, { ...approval, id: 8, user: { login: 'other' }, state: 'CHANGES_REQUESTED' }],
  ])
    assert.throws(() => approvedReviews(pr, invalid, permissions))
  for (const permission of [undefined, 'read', 'triage', 'none'])
    assert.throws(() => approvedReviews(pr, reviews, { maintainer: permission }))
  // API order and later comments cannot conceal or invalidate the latest substantive review.
  assert.equal(
    approvedReviews(
      pr,
      [
        { ...approval, id: 8, state: 'COMMENTED' },
        approval,
        { ...approval, id: 6, state: 'CHANGES_REQUESTED' },
      ],
      permissions,
    ).length,
    1,
  )
  assert.throws(() =>
    approvedReviews({ ...pr, head: { ...pr.head, sha: source } }, reviews, permissions),
  )
})

test('reviewed native diagnostics require an exact open same-repository PR and canonical producer', () => {
  const options = { source, repository, number: 90, pr, run, reviews, permissions }
  assert.equal(reviewedCandidate(options).runAttempt, 2)
  for (const changed of [
    { ...pr, merge_commit_sha: head },
    { ...pr, state: 'closed' },
    { ...pr, draft: true },
    { ...pr, head: { ...pr.head, repo: { full_name: 'foreign/jig' } } },
    { ...pr, base: { ...pr.base, ref: 'other' } },
  ])
    assert.throws(() => reviewedCandidate({ ...options, pr: changed }))
  for (const changed of [
    { ...run, event: 'push' },
    { ...run, head_sha: source },
    { ...run, path: '.github/workflows/foreign.yml' },
    { ...run, head_repository: { full_name: 'foreign/jig' } },
  ])
    assert.throws(() => reviewedCandidate({ ...options, run: changed }))
})

test('live PR workflow is manual, guarded, protected and creates no qualification receipts', async () => {
  const workflow = parse(
    await readFile(
      new URL('../../.github/workflows/native-agent-preflight.yml', import.meta.url),
      'utf8',
    ),
  )
  assert.deepEqual(Object.keys(workflow.on), ['workflow_dispatch'])
  assert.equal(workflow.jobs.select.if, "github.ref == 'refs/heads/main'")
  assert.equal(workflow.jobs.diagnostic.environment, 'native-agent-api')
  assert.deepEqual(
    workflow.jobs.diagnostic.strategy.matrix.include.map(({ client }) => client),
    ['codex', 'claude', 'pi'],
  )
  const steps = workflow.jobs.diagnostic.steps
  const acquire = steps.findIndex(({ run }) => run?.includes('native-preflight.mjs acquire'))
  const recheck = steps.findIndex(({ run }) => run?.includes('native-preflight.mjs verify'))
  const secret = steps.findIndex(({ env }) => env?.OPENROUTER_API_KEY)
  assert.ok(acquire >= 0 && acquire < recheck && recheck < secret)
  assert.equal(workflow.jobs.diagnostic.defaults.run['working-directory'], 'trusted')
  for (const job of Object.values(workflow.jobs)) {
    for (const step of job.steps) {
      if (step.uses?.startsWith('actions/checkout')) {
        assert.equal(step.with.ref, '${{ github.workflow_sha }}')
        assert.equal(step.with['persist-credentials'], false)
      }
      if (step['working-directory']) assert.equal(step['working-directory'], 'trusted')
    }
  }
  assert.match(steps[secret].run, /scripts\/ci\/provision-github-rootless-host.sh run-delegated/)
  assert.match(steps[secret].run, /"OPENROUTER_API_KEY=\$OPENROUTER_API_KEY"/)
  assert.doesNotMatch(steps[secret].run, /GH_TOKEN|github.token/)
  assert.equal(steps[0].with.ref, '${{ github.workflow_sha }}')
  assert.equal(steps[secret].env.OPENROUTER_API_KEY, '${{ secrets.OPENROUTER_API_KEY }}')
  for (const job of Object.values(workflow.jobs)) {
    assert.equal(job.permissions['id-token'], undefined)
    assert.doesNotMatch(
      JSON.stringify(job),
      /QUALIFICATION\.json|candidate-provenance\.mjs qualification|native-qualification-/,
    )
    for (const step of job.steps) if (step.uses) assert.match(step.uses, /@[a-f0-9]{40}$/)
  }
})

test('production loads only workflow-revision tooling and never selects rehearsal mode', async () => {
  const workflow = parse(
    await readFile(new URL('../../.github/workflows/npm-publish.yml', import.meta.url), 'utf8'),
  )
  const publisher = workflow.jobs.publish_host
  const checkout = publisher.steps.find(({ uses }) => uses?.startsWith('actions/checkout'))
  assert.equal(checkout.with.ref, '${{ github.workflow_sha }}')
  assert.equal(checkout.with['persist-credentials'], false)
  assert.equal(checkout.with['sparse-checkout'], 'scripts/release')
  const release = publisher.steps.find(({ id }) => id === 'release')
  assert.match(release.run, /sh publisher\/scripts\/release\/publish\.sh/)
  assert.doesNotMatch(release.run, /--rehearsal/)
  assert.equal(workflow.jobs.npm_authentication.environment, 'npm')
  assert.equal(workflow.jobs.npm_authentication.permissions['id-token'], 'write')
  const rehearsal = parse(
    await readFile(
      new URL('../../.github/workflows/release-rehearsal.yml', import.meta.url),
      'utf8',
    ),
  )
  assert.deepEqual(rehearsal.permissions, { contents: 'read' })
  assert.doesNotMatch(JSON.stringify(rehearsal), /secrets\.|id-token|environment/)
})
