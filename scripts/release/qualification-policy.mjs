// Pure comparisons of GitHub metadata. These functions create no execution evidence.
export function validateSnapshot(snapshot, context) {
  if (
    snapshot?.schemaVersion !== 1 ||
    snapshot.repository !== context.repository ||
    snapshot.group !== 'host' ||
    context.group !== 'host' ||
    snapshot.sourceRevision !== context.source ||
    !/^[0-9a-f]{40}$/.test(snapshot.sourceRevision ?? '') ||
    snapshot.candidate?.receiptSha256 !== context.receipt ||
    !Array.isArray(snapshot.runs) ||
    snapshot.runs.length !== 4 ||
    !Array.isArray(snapshot.artifacts) ||
    snapshot.artifacts.length !== 7
  )
    throw Error('Invalid authorized qualification snapshot')
}
export function validateRun(expected, current, repository) {
  if (
    current.id !== expected.runId ||
    current.run_attempt !== expected.runAttempt ||
    current.status !== 'completed' ||
    current.conclusion !== 'success' ||
    current.repository?.full_name !== repository ||
    current.path !== expected.workflowPath ||
    current.event !== expected.event ||
    current.head_sha !== expected.headSha ||
    current.head_branch !== expected.headBranch ||
    current.head_repository?.full_name !== expected.headRepository
  )
    throw Error('Qualification run changed after authorization')
}
export function validateJobs(expected, jobs) {
  if (!Array.isArray(expected.jobs) || !expected.jobs.length)
    throw Error('Missing qualification job obligations')
  for (const proof of expected.jobs) {
    const matching = jobs.filter((job) => job.name === proof.name)
    if (
      proof.runId !== expected.runId ||
      proof.runAttempt !== expected.runAttempt ||
      matching.length !== 1 ||
      matching[0].id !== proof.jobId ||
      matching[0].status !== 'completed' ||
      matching[0].conclusion !== 'success' ||
      (matching[0].run_attempt !== undefined && matching[0].run_attempt !== expected.runAttempt)
    )
      throw Error('Qualification job changed after authorization')
  }
}
export function validateLatestPush(snapshot, expected, runs) {
  const latest = runs
    .filter(
      (run) =>
        run.path === expected.workflowPath &&
        run.event === 'push' &&
        run.head_sha === snapshot.sourceRevision &&
        run.head_branch === 'main' &&
        run.repository?.full_name === snapshot.repository &&
        run.head_repository?.full_name === snapshot.repository,
    )
    .sort((a, b) => b.id - a.id)[0]
  if (latest?.id !== expected.runId || latest.run_attempt !== expected.runAttempt)
    throw Error('A newer source qualification superseded authorization')
}
export function nativeCreationBoundary(current, now = Date.now()) {
  const created = Date.parse(current.created_at)
  if (
    typeof current.created_at !== 'string' ||
    !Number.isFinite(created) ||
    created > now ||
    new Date(created).toISOString().replace('.000Z', 'Z') !==
      current.created_at.replace('.000Z', 'Z')
  )
    throw Error('Missing valid native qualification creation time')
  return current.created_at
}
export function newerNative(snapshot, expected, run) {
  return (
    run.id > expected.runId &&
    run.path === expected.workflowPath &&
    run.head_branch === 'main' &&
    run.repository?.full_name === snapshot.repository &&
    run.head_repository?.full_name === snapshot.repository &&
    ['workflow_run', 'workflow_dispatch'].includes(run.event)
  )
}
export function validateNativeArtifacts(snapshot, run, artifacts) {
  if (run.event === 'workflow_dispatch' && run.head_sha === snapshot.sourceRevision)
    throw Error('A newer manual native qualification superseded authorization')
  for (const artifact of artifacts) {
    const match =
      /^native-(?:inputs|qualification)-(?:codex|claude|pi)-([0-9a-f]{40})-r([1-9][0-9]*)-a[1-9][0-9]*$/.exec(
        artifact.name ?? '',
      )
    if (match && match[1] === snapshot.sourceRevision && match[2] === String(run.id))
      throw Error('A newer native qualification superseded authorization')
  }
}
export function validateArtifact(expected, current, now = Date.now()) {
  if (
    current.id !== expected.artifactId ||
    current.name !== expected.name ||
    current.digest !== expected.digest ||
    current.expired !== false ||
    !Number.isFinite(Date.parse(current.expires_at)) ||
    Date.parse(current.expires_at) <= now ||
    current.workflow_run?.id !== expected.runId ||
    current.workflow_run?.head_sha !== expected.headSha
  )
    throw Error('Qualification artifact changed or expired after authorization')
}
export function collectPage(result, key, values, page) {
  if (!Array.isArray(result[key])) throw Error('Malformed GitHub evidence response')
  values.push(...result[key])
  if (result[key].length < 100) return true
  if (page >= 10) throw Error('GitHub evidence pagination exceeded its bound')
  return false
}
