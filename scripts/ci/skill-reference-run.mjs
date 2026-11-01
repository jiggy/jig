import { appendFile, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  downloadArtifactDirectory,
  githubClient,
  paginated,
  verifyArtifactMetadata,
} from './candidate-transfer.mjs'

const workflowPath = '.github/workflows/sync-skill-references.yml'
const positive = (value) => Number.isSafeInteger(value) && value > 0
const revision = /^[0-9a-f]{40}$/

export function skillReferenceRun(run, { repository, defaultBranch }) {
  if (
    !run ||
    !positive(run.id) ||
    !positive(run.run_attempt) ||
    !positive(run.workflow_id) ||
    run.path !== workflowPath ||
    run.event !== 'pull_request' ||
    run.status !== 'completed' ||
    run.conclusion !== 'success' ||
    run.repository?.full_name !== repository ||
    run.head_repository?.full_name !== repository ||
    !positive(run.repository?.id) ||
    run.head_repository?.id !== run.repository.id ||
    !revision.test(run.head_sha ?? '') ||
    typeof run.head_branch !== 'string' ||
    /[\r\n]/.test(run.head_branch) ||
    !run.head_branch ||
    run.head_branch === defaultBranch ||
    !Array.isArray(run.pull_requests)
  )
    throw new Error('The producer must be a successful same-repository pull_request run')
  const pulls = run.pull_requests.filter(
    (pull) =>
      positive(pull.number) &&
      pull.head?.sha === run.head_sha &&
      pull.head.ref === run.head_branch &&
      pull.head.repo?.id === run.repository.id &&
      pull.base?.ref === defaultBranch &&
      pull.base.repo?.id === run.repository.id,
  )
  if (pulls.length !== 1)
    throw new Error('The producer must identify exactly one matching pull request')
  return {
    runId: String(run.id),
    runAttempt: String(run.run_attempt),
    workflowId: run.workflow_id,
    repositoryId: run.repository.id,
    sourceRevision: run.head_sha,
    branch: run.head_branch,
    number: pulls[0].number,
  }
}

export function currentSkillPull(pull, source, { repository, defaultBranch }) {
  return (
    pull?.number === source.number &&
    pull.state === 'open' &&
    pull.head?.sha === source.sourceRevision &&
    pull.head.ref === source.branch &&
    pull.head.ref !== defaultBranch &&
    pull.head.repo?.id === source.repositoryId &&
    pull.head.repo.full_name === repository &&
    pull.base?.ref === defaultBranch &&
    pull.base.repo?.id === source.repositoryId &&
    pull.base.repo.full_name === repository
  )
}

export function currentSkillReferenceSource(source, run, pull, options) {
  const observed = skillReferenceRun(run, options)
  return (
    JSON.stringify(observed) === JSON.stringify(source) && currentSkillPull(pull, source, options)
  )
}

export function skillReferenceArtifact(artifacts, source) {
  const name = `skill-references-${source.sourceRevision}-r${source.runId}-a${source.runAttempt}`
  const matches = artifacts.filter((artifact) => artifact.name === name)
  if (!matches.length) return undefined
  if (matches.length !== 1) throw new Error('Ambiguous generated-reference artifact')
  const artifact = verifyArtifactMetadata(matches[0], {
    name,
    runId: Number(source.runId),
    headSha: source.sourceRevision,
  })
  if (
    artifact.workflow_run.repository_id !== source.repositoryId ||
    artifact.workflow_run.head_repository_id !== source.repositoryId ||
    !positive(artifact.size_in_bytes) ||
    artifact.size_in_bytes > 16 * 1024 * 1024
  )
    throw new Error('Generated-reference artifact has an invalid repository or size')
  return artifact
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [destination, ...extra] = process.argv.slice(2)
    if (!destination || extra.length) throw new Error('usage: skill-reference-run.mjs DESTINATION')
    const repository = process.env.GITHUB_REPOSITORY
    const client = githubClient(repository)
    const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8'))
    if (process.env.GITHUB_EVENT_NAME !== 'workflow_run' || event.action !== 'completed')
      throw new Error('Expected a completed workflow_run event')
    const options = { repository, defaultBranch: event.repository?.default_branch }
    if (event.repository?.full_name !== repository || !options.defaultBranch)
      throw new Error('The workflow event belongs to a different repository')
    const expected = skillReferenceRun(event.workflow_run, options)
    const runPath = `repos/${repository}/actions/runs/${expected.runId}`
    const pullPath = `repos/${repository}/pulls/${expected.number}`
    const current = async () =>
      currentSkillReferenceSource(
        expected,
        await client.api(runPath),
        await client.api(pullPath),
        options,
      )
    if (!(await current())) {
      console.log('A newer producer or changed pull request supersedes this synchronization.')
      await appendFile(process.env.GITHUB_OUTPUT, 'ready=false\n')
    } else {
      const artifact = skillReferenceArtifact(
        await paginated(client, `${runPath}/artifacts`, 'artifacts'),
        expected,
      )
      if (!artifact) {
        console.log('This producer retained no reference changes.')
        await appendFile(process.env.GITHUB_OUTPUT, 'ready=false\n')
      } else {
        await downloadArtifactDirectory(client, artifact, destination)
        if (!(await current())) {
          console.log('A newer producer or changed pull request supersedes this synchronization.')
          await appendFile(process.env.GITHUB_OUTPUT, 'ready=false\n')
        } else {
          await appendFile(
            process.env.GITHUB_OUTPUT,
            Object.entries({
              ready: 'true',
              'pr-head-sha': expected.sourceRevision,
              'pr-branch': expected.branch,
              'source-run-id': expected.runId,
              'source-run-attempt': expected.runAttempt,
            })
              .map(([key, value]) => `${key}=${value}\n`)
              .join(''),
          )
        }
      }
    }
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
