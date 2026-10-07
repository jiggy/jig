import type { JsonValue, RunResult } from '@jigging/flow'
import type { RepairInput } from 'factory-repair-flow/policy'
import { reportedText } from './files.ts'

type JobEvidence = {
  id: string
  label?: string
  issue?: string
  directory?: string
  status: string
  ready?: boolean
  stage?: string
  code?: string
  message?: string
  details?: JsonValue
  result?: RunResult
  routing?: { result?: { output?: { reason?: string } } }
  verification?: { proposal: number; changedPaths: string[]; acceptanceCases: string[] }
}

function displayData(value: string, maximum: number, location: string): string {
  let prefix = ''
  for (const scalar of [...value].slice(0, 512)) {
    if (JSON.stringify(reportedText(prefix + scalar)).length > maximum) break
    prefix += scalar
  }
  return reportedText(prefix) + (prefix === value ? '' : ` [truncated; ${location}]`)
}

export function jobPlan(
  job: { id: string; label?: string; directory: string; method?: string },
  input: RepairInput,
): string {
  return [
    jobLabel(job),
    `  Requested goal: ${displayData(input.issue, 600, 'full goal in job input')}`,
    `  Source: ${job.directory}; editable files: ${displayData(input.editPaths.join(', '), 320, 'full paths in job input')}.`,
    `  Approach: ${job.method === 'p1' ? 'one proposed fix; stop if checks fail' : job.method === 'p2' ? 'one proposed fix, with one correction if needed' : 'choose a reviewed approach allowing one or two proposed fixes'}.`,
    `  Checks: repository tests plus ${input.cases.length} independent CLI cases: ${displayData(input.cases.map((c) => c.id).join(', '), 320, 'full case IDs in check evidence')}.`,
    '  First: run the unchanged checks to see which expected behaviors fail.',
  ].join('\n')
}

export function jobLabel(job: { id: string; label?: string }): string {
  return job.label ?? job.id
}

export function repairActivity(
  job: { id: string; label?: string },
  phase: string,
  attempt: number,
  maximum: number,
  detail?: string,
): string {
  const action =
    {
      selecting: 'Choosing a repair approach',
      invoking: `Starting repair; up to ${maximum} proposed ${maximum === 1 ? 'fix' : 'fixes'}`,
      baseline: 'Running existing tests to reproduce the problem',
      proposal:
        attempt > 1
          ? `Asking the AI assistant for a correction (${attempt} of ${maximum})`
          : `Asking the AI assistant for a proposed fix (${attempt} of ${maximum})`,
      check: `Running tests against proposed fix ${attempt} of ${maximum}`,
      finished: 'Repair checks ended; verifying the returned evidence',
      command: `Running ${detail ?? 'a reviewed check command'}`,
      observed: 'Reviewing the worker check report',
      rejected:
        attempt < maximum
          ? 'Preparing a correction after the rejected proposal'
          : 'Returning proposal rejection evidence',
    }[phase] ?? 'Working on the repair'
  const label = `${jobLabel(job)}: ${action}`.replace(
    /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu,
    (character) => `\\u${character.codePointAt(0)!.toString(16).padStart(4, '0')}`,
  )
  return [...label].length <= 256 ? label : [...label].slice(0, 253).join('') + '...'
}

function object(value: JsonValue | undefined): Record<string, JsonValue> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

/** Reported causes stay bounded quoted data; detailed evidence remains in result.json. */
function cause(value: string): string {
  const scalars = [...value]
  let prefix = ''
  for (const scalar of scalars.slice(0, 512)) {
    const candidate = prefix + scalar
    if (JSON.stringify(reportedText(candidate)).length > 400) break
    prefix = candidate
  }
  return (
    reportedText(prefix) +
    (prefix !== value ? ' [truncated; full cause in retained job evidence]' : '')
  )
}

export function jobReport(
  value: JsonValue,
  filesConfirmed = true,
  context: { goal: number; paths: number; deliveryPending?: boolean; includeReason?: boolean } = {
    goal: 200,
    paths: 160,
  },
): string {
  const job = value as unknown as JobEvidence
  let explanation: string
  if (job.ready)
    explanation = context.deliveryPending
      ? 'A patch passed the checks; saving evidence for human review.'
      : filesConfirmed
        ? `A patch passed the checks. Review files/${job.id}/review.patch before applying it.`
        : 'A patch passed the checks. File delivery was not confirmed; inspect retained job evidence before applying changes.'
  else if (job.status === 'unrouted')
    explanation = 'No repair started because no approach was selected.'
  else if (job.status === 'failed') {
    const failure = object(object(job.details).failure)
    explanation =
      job.code === 'UNCERTAIN'
        ? 'The repair stopped with uncertain settlement. Confirm it has stopped before retrying.'
        : job.code === 'CANCELLED' || job.code === 'DEADLINE_EXCEEDED'
          ? 'The repair was stopped before completion.'
          : job.stage === 'routing'
            ? 'Could not choose a repair approach.'
            : job.stage === 'validation'
              ? 'The returned evidence failed independent verification.'
              : failure.stage === 'baseline'
                ? 'Could not finish running the existing checks.'
                : failure.stage === 'proposal'
                  ? 'Could not get a proposed fix from the AI assistant.'
                  : failure.stage === 'check'
                    ? 'Could not finish checking the proposed fix.'
                    : 'Could not finish the repair.'
    explanation += ' No verified patch is available.'
  } else explanation = 'The repair finished without a patch that passed all checks.'
  const reason =
    job.message ??
    (object(job.result?.output).reason as string | undefined) ??
    job.routing?.result?.output?.reason
  const lines = [`${jobLabel(job)}: ${explanation}`]
  if (typeof job.issue === 'string')
    lines.push(
      context.goal === 0
        ? '  Requested goal: see job.issue in result.json.'
        : `  Requested goal: ${displayData(job.issue, context.goal, 'full goal in retained job evidence')}`,
    )
  if (job.ready && job.verification) {
    const checked = job.verification
    lines.push(
      `  Verified: repository test command passed; ${checked.acceptanceCases.length}/${checked.acceptanceCases.length} independent acceptance cases passed (proposal ${checked.proposal}).`,
    )
    if (context.paths > 0)
      lines.push(
        `  Changed files: ${displayData(checked.changedPaths.join(', ') || 'none', context.paths, 'full paths in retained job evidence')}.`,
      )
  } else if (context.includeReason !== false && typeof reason === 'string')
    lines.push(`  Reported reason: ${cause(reason)}`)
  return lines.join('\n')
}

export function factoryReport(
  jobs: readonly JsonValue[],
  conflicting: boolean,
  filesConfirmed = true,
  expectedJobs = jobs.length,
): string {
  const ready = jobs.filter((job) => object(job).ready === true).length
  const render = (context: { goal: number; paths: number }, next = true) => {
    const lines = [
      `${ready} of ${expectedJobs} jobs produced a checked patch for review.`,
      ...(jobs.length < expectedJobs
        ? [
            `Observed outcomes are available for ${jobs.length} of ${expectedJobs} jobs; other jobs did not return verified evidence.`,
          ]
        : []),
      ...jobs.map((job) => jobReport(job, filesConfirmed, context)),
    ]
    if (conflicting)
      lines.push(
        'The proposed patches conflict. Resolve the overlap before applying either change.',
      )
    if (next && jobs.some((job) => object(job).status === 'failed'))
      lines.push('Review the reported causes and selected repair setup before trying again.')
    lines.push(
      filesConfirmed
        ? 'Full evidence: result.json. Saved job summaries: files/summary.txt. Changes have not been applied.'
        : 'Checkpoint and file delivery were not confirmed. Known job evidence is included in this failure result. Changes have not been applied.',
    )
    return lines.join('\n')
  }
  // The host's brief view has 2048 encoded characters. Shorten context before
  // essential blocking causes; full goals and verified facts remain in jobs.
  for (const context of [
    { goal: 200, paths: 160 },
    { goal: 100, paths: 80 },
    { goal: 40, paths: 0 },
    { goal: 0, paths: 0 },
  ]) {
    const report = render(context)
    if (JSON.stringify({ summary: report }).length <= 2048) return report
  }
  return render({ goal: 0, paths: 0 }, false)
}
