import { execFileSync } from 'node:child_process'
import {
  collectPage,
  nativeCreationBoundary,
  newerNative,
  validateArtifact,
  validateJobs,
  validateLatestPush,
  validateNativeArtifacts,
  validateRun,
  validateSnapshot,
} from './qualification-policy.mjs'

const snapshot = JSON.parse(process.env.QUALIFICATION_SNAPSHOT ?? 'null')
const repository = process.env.GITHUB_REPOSITORY
validateSnapshot(snapshot, {
  repository,
  group: process.env.RELEASE_GROUP,
  source: process.env.SOURCE_REVISION,
  receipt: process.env.EXPECTED_RECEIPT_SHA256,
})
const api = (path) =>
  JSON.parse(
    execFileSync('gh', ['api', path], {
      encoding: 'utf8',
      timeout: 60_000,
      maxBuffer: 16 * 1024 * 1024,
    }),
  )
const list = (path, key) => {
  const values = []
  for (let page = 1; page <= 10; page++) {
    const result = api(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`)
    if (collectPage(result, key, values, page)) return values
  }
}
for (const expected of snapshot.runs) {
  const current = api(`repos/${repository}/actions/runs/${expected.runId}`)
  validateRun(expected, current, repository)
  const jobs = list(
    `repos/${repository}/actions/runs/${expected.runId}/attempts/${expected.runAttempt}/jobs`,
    'jobs',
  )
  validateJobs(expected, jobs)
  if (expected.event === 'push') {
    const query = new URLSearchParams({
      branch: 'main',
      event: 'push',
      head_sha: snapshot.sourceRevision,
    })
    const runs = list(
      `repos/${repository}/actions/workflows/${expected.workflowPath.split('/').at(-1)}/runs?${query}`,
      'workflow_runs',
    )
    validateLatestPush(snapshot, expected, runs)
  } else {
    const query = new URLSearchParams({ created: `>=${nativeCreationBoundary(current)}` })
    const runs = list(
      `repos/${repository}/actions/workflows/native-agent-api-qualification.yml/runs?${query}`,
      'workflow_runs',
    )
    for (const run of runs) {
      if (!newerNative(snapshot, expected, run)) continue
      validateNativeArtifacts(snapshot, run, [])
      const artifacts = list(`repos/${repository}/actions/runs/${run.id}/artifacts`, 'artifacts')
      validateNativeArtifacts(snapshot, run, artifacts)
    }
  }
}
for (const expected of snapshot.artifacts)
  validateArtifact(expected, api(`repos/${repository}/actions/artifacts/${expected.artifactId}`))
