import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  currentSkillReferenceSource,
  skillReferenceArtifact,
  skillReferenceRun,
} from './skill-reference-run.mjs'

const options = { repository: 'jiggy/jig', defaultBranch: 'main' }
const repository = { id: 42, full_name: options.repository }
const revision = 'a'.repeat(40)
const run = {
  id: 17,
  run_attempt: 2,
  workflow_id: 6,
  path: '.github/workflows/sync-skill-references.yml',
  event: 'pull_request',
  status: 'completed',
  conclusion: 'success',
  repository,
  head_repository: repository,
  head_sha: revision,
  head_branch: 'feature',
  pull_requests: [
    {
      number: 8,
      head: { ref: 'feature', sha: revision, repo: repository },
      base: { ref: 'main', sha: 'b'.repeat(40), repo: repository },
    },
  ],
}
const pull = { ...run.pull_requests[0], state: 'open' }
const source = skillReferenceRun(run, options)
const artifact = {
  id: 123,
  name: `skill-references-${revision}-r17-a2`,
  expired: false,
  expires_at: new Date(Date.now() + 86_400_000).toISOString(),
  digest: `sha256:${'c'.repeat(64)}`,
  size_in_bytes: 1024,
  workflow_run: {
    id: run.id,
    repository_id: repository.id,
    head_repository_id: repository.id,
    head_sha: revision,
  },
}

test('selects one successful same-repository producer and its current open PR', () => {
  assert.deepEqual(source, {
    runId: '17',
    runAttempt: '2',
    workflowId: 6,
    repositoryId: 42,
    sourceRevision: revision,
    branch: 'feature',
    number: 8,
  })
  assert.equal(currentSkillReferenceSource(source, run, pull, options), true)
})

test('refuses foreign producers, other workflow events, invalid heads, and ambiguous PR association', () => {
  for (const change of [
    { event: 'pull_request_target' },
    { event: 'push' },
    { event: 'workflow_dispatch' },
    { status: 'in_progress' },
    { conclusion: 'failure' },
    { conclusion: 'cancelled' },
    { path: '.github/workflows/other.yml' },
    { id: '../other' },
    { run_attempt: 0 },
    { workflow_id: 0 },
    { repository: { ...repository, full_name: 'other/repo' } },
    { head_repository: { ...repository, full_name: 'contributor/jig' } },
    { head_repository: { ...repository, id: 43 } },
    { head_sha: 'bad-revision' },
    { head_branch: 'main' },
    { head_branch: 'feature\nother=true' },
    { pull_requests: [] },
    { pull_requests: [...run.pull_requests, ...run.pull_requests] },
    { pull_requests: [{ ...pull, base: { ...pull.base, ref: 'release' } }] },
    { pull_requests: [{ ...pull, head: { ...pull.head, sha: 'd'.repeat(40) } }] },
    { pull_requests: [{ ...pull, head: { ...pull.head, repo: { id: 43 } } }] },
  ])
    assert.throws(() => skillReferenceRun({ ...run, ...change }, options))
})

test('a later producer attempt, closed PR, retargeting, forks, and concurrent head changes refuse writing', () => {
  for (const change of [{ id: 18 }, { run_attempt: 3 }, { workflow_id: 7 }])
    assert.equal(currentSkillReferenceSource(source, { ...run, ...change }, pull, options), false)
  for (const change of [
    { number: 9 },
    { state: 'closed' },
    { head: { ...pull.head, sha: 'd'.repeat(40) } },
    { head: { ...pull.head, ref: 'renamed' } },
    { head: { ...pull.head, repo: { id: 43, full_name: 'contributor/jig' } } },
    { base: { ...pull.base, ref: 'release' } },
    { base: { ...pull.base, repo: { id: 43, full_name: 'other/repo' } } },
  ])
    assert.equal(currentSkillReferenceSource(source, run, { ...pull, ...change }, options), false)
})

test('selects the immutable artifact from the exact source run and attempt', () => {
  const oldAttempt = { ...artifact, id: 122, name: `skill-references-${revision}-r17-a1` }
  assert.equal(skillReferenceArtifact([oldAttempt, artifact], source), artifact)
  assert.equal(skillReferenceArtifact([oldAttempt], source), undefined)
  assert.equal(skillReferenceArtifact([], source), undefined)
  assert.throws(() => skillReferenceArtifact([artifact, artifact], source), /Ambiguous/)
})

test('refuses expired, foreign, malformed, and oversized artifacts before download', () => {
  for (const change of [
    { id: 0 },
    { expired: true },
    { expires_at: new Date(Date.now() - 1).toISOString() },
    { digest: 'missing' },
    { size_in_bytes: 0 },
    { size_in_bytes: 16 * 1024 * 1024 + 1 },
    { workflow_run: { ...artifact.workflow_run, id: 18 } },
    { workflow_run: { ...artifact.workflow_run, head_sha: 'd'.repeat(40) } },
    { workflow_run: { ...artifact.workflow_run, repository_id: 43 } },
    { workflow_run: { ...artifact.workflow_run, head_repository_id: 43 } },
  ])
    assert.throws(() => skillReferenceArtifact([{ ...artifact, ...change }], source))
})
