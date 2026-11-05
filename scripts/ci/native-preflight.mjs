// Trusted main-workflow selection for explicitly reviewed PR diagnostics.
import { appendFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { acquireCandidate, githubClient, validateWorkflowRun } from './candidate-transfer.mjs'

export function reviewedCandidate({ pr, run, source, repository, number }) {
  if (
    !/^[0-9a-f]{40}$/.test(source ?? '') ||
    !Number.isSafeInteger(number) ||
    number <= 0 ||
    pr.number !== number ||
    pr.state !== 'open' ||
    pr.draft === true ||
    pr.base?.repo?.full_name !== repository ||
    pr.base?.ref !== 'main' ||
    pr.head?.repo?.full_name !== repository ||
    pr.merge_commit_sha !== source ||
    !/^[0-9a-f]{40}$/.test(pr.head?.sha ?? '')
  )
    throw Error('Select an open reviewed same-repository PR and its exact current merge revision')
  const expected = {
    repository,
    workflowPath: '.github/workflows/ci.yml',
    event: 'pull_request',
    headSha: pr.head.sha,
    headBranch: pr.head.ref,
    headRepository: repository,
  }
  validateWorkflowRun(run, expected)
  return {
    source,
    head: pr.head.sha,
    base: pr.base.sha,
    expected,
    runId: run.id,
    runAttempt: run.run_attempt,
  }
}

async function main() {
  if (
    process.env.GITHUB_REF !== 'refs/heads/main' ||
    process.env.GITHUB_EVENT_NAME !== 'workflow_dispatch'
  )
    throw Error('Native preflight requires an explicit main-workflow dispatch')
  const [mode, destination] = process.argv.slice(2)
  if (
    !['select', 'acquire'].includes(mode) ||
    (mode === 'acquire' && !destination) ||
    (mode === 'select' && destination)
  )
    throw Error('Use native-preflight.mjs select or acquire OUTPUT')
  const repository = process.env.GITHUB_REPOSITORY
  const number = Number(process.env.PREFLIGHT_PULL_REQUEST)
  const runId = Number(process.env.PREFLIGHT_PRODUCER_RUN)
  if (!Number.isSafeInteger(runId) || runId <= 0)
    throw Error('A canonical CI producer run ID is required')
  const client = githubClient(repository)
  const select = async () =>
    reviewedCandidate({
      repository,
      number,
      source: process.env.PREFLIGHT_SOURCE,
      pr: await client.api(`repos/${repository}/pulls/${number}`),
      run: await client.api(`repos/${repository}/actions/runs/${runId}`),
    })
  const target = await select()
  if (mode === 'acquire') {
    if (String(target.runAttempt) !== process.env.PREFLIGHT_PRODUCER_ATTEMPT)
      throw Error('The reviewed producer attempt changed during protected approval')
    await acquireCandidate({
      destination: resolve(destination),
      sourceRevision: target.source,
      producerRunId: runId,
      expected: target.expected,
      client,
      timeoutSeconds: 300,
      producerTimeoutSeconds: 1800,
      afterQuick: true,
    })
    if (JSON.stringify(await select()) !== JSON.stringify(target))
      throw Error('The reviewed PR or producer changed during acquisition')
  }
  if (process.env.GITHUB_OUTPUT)
    await appendFile(
      process.env.GITHUB_OUTPUT,
      `source_revision=${target.source}\nproducer_run_attempt=${target.runAttempt}\n`,
    )
  const summary =
    `## Reviewed native preflight\n\nPR: #${number}\n\nExact tested merge: ${target.source}\n\n` +
    `Canonical CI producer: ${runId}, attempt ${target.runAttempt}\n\n` +
    'This manually selected diagnostic creates no release qualification receipt.\n'
  process.stdout.write(summary)
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, summary)
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main()
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
