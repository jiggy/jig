import type { JsonValue, RunResult } from '@jigging/flow'
import { reportedText } from './files.ts'

type JobEvidence = {
  id: string
  label?: string
  status: string
  ready?: boolean
  stage?: string
  code?: string
  message?: string
  details?: JsonValue
  result?: RunResult
  routing?: { result?: { output?: { reason?: string } } }
}

export function jobLabel(job: { id: string; label?: string }): string {
  return job.label ?? job.id
}

export function repairActivity(
  job: { id: string; label?: string },
  phase: string,
  attempt: number,
  maximum: number,
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
    }[phase] ?? 'Working on the repair'
  return `${jobLabel(job)}: ${action}`
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

export function jobReport(value: JsonValue, filesConfirmed = true): string {
  const job = value as unknown as JobEvidence
  let explanation: string
  if (job.ready)
    explanation = filesConfirmed
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
  return `${jobLabel(job)}: ${explanation}${typeof reason === 'string' ? `\n  Reported reason: ${cause(reason)}` : ''}`
}

export function factoryReport(
  jobs: readonly JsonValue[],
  conflicting: boolean,
  filesConfirmed = true,
  expectedJobs = jobs.length,
): string {
  const ready = jobs.filter((job) => object(job).ready === true).length
  const lines = [
    `${ready} of ${expectedJobs} jobs produced a checked patch for review.`,
    ...(jobs.length < expectedJobs
      ? [
          `Observed outcomes are available for ${jobs.length} of ${expectedJobs} jobs; other jobs did not return verified evidence.`,
        ]
      : []),
    ...jobs.map((job) => jobReport(job, filesConfirmed)),
  ]
  if (conflicting)
    lines.push('The proposed patches conflict. Resolve the overlap before applying either change.')
  if (jobs.some((job) => object(job).status === 'failed'))
    lines.push('Review the reported causes and selected repair setup before trying again.')
  lines.push(
    filesConfirmed
      ? 'Full evidence: result.json. Saved job summaries: files/summary.txt. Changes have not been applied.'
      : 'Checkpoint and file delivery were not confirmed. Known job evidence is included in this failure result. Changes have not been applied.',
  )
  return lines.join('\n')
}
