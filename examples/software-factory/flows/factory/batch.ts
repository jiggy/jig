import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { type JsonValue, OperationError, type RunContext, type RunResult } from '@jigging/flow'
import { type UserUpdates, withUserUpdates } from '@jigging/user-updates'
import { checkRoutingResult } from 'semantic-router-flow/decision'
import type { RepairInput } from '../repair/policy.ts'
import { checkName, loadChecks } from './checks.ts'
import {
  identity,
  inspect,
  readRepairInput,
  repairDeliverables,
  reportedText,
  writeRepairDeliverables,
} from './files.ts'
import { candidates, methods } from './methods.ts'

const repairProgressSchema = {
  type: 'object',
  properties: {
    phase: { type: 'string', enum: ['baseline', 'proposal', 'check', 'finished'] },
    attempt: { type: 'integer', minimum: 0, maximum: 2 },
  },
  required: ['phase', 'attempt'],
  additionalProperties: false,
} as const

interface Job {
  id: string
  directory: string
  checks: string
  issue: string
  editPaths: string[]
  method?: string
  cancelAfterMs?: number
}
export function batchJobs(value: unknown): Job[] {
  const input = value as { jobs: Job[] }
  if (
    !input ||
    Object.keys(input).join(',') !== 'jobs' ||
    !Array.isArray(input.jobs) ||
    input.jobs.length < 1 ||
    input.jobs.length > 2
  )
    throw new TypeError('Supply one or two jobs.')
  for (const job of input.jobs) {
    if (
      !job ||
      Object.keys(job).some(
        (k) =>
          !['id', 'directory', 'checks', 'issue', 'editPaths', 'method', 'cancelAfterMs'].includes(
            k,
          ),
      ) ||
      typeof job.id !== 'string' ||
      !/^[a-z][a-z0-9-]{0,31}$/.test(job.id) ||
      typeof job.directory !== 'string' ||
      job.directory.length > 256 ||
      !/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(job.directory) ||
      job.directory.split('/').length > 16 ||
      typeof job.checks !== 'string' ||
      (job.method !== undefined && !methods.some((method) => method.id === job.method)) ||
      (job.cancelAfterMs !== undefined &&
        (!Number.isSafeInteger(job.cancelAfterMs) ||
          job.cancelAfterMs < 1 ||
          job.cancelAfterMs > 300_000))
    )
      throw new TypeError(
        'Each job needs a unique id, a relative project directory, and a known check set; method must name a reviewed method; optional cancellation is 1–300,000 ms.',
      )
    checkName(job.checks)
  }
  if (new Set(input.jobs.map((j) => j.id)).size !== input.jobs.length)
    throw new TypeError('Job ids must be distinct.')
  return input.jobs
}

export function patchConflicts(changes: readonly { job: string; path: string; content: string }[]) {
  const paths = new Map<string, (typeof changes)[number][]>()
  for (const change of changes) paths.set(change.path, [...(paths.get(change.path) ?? []), change])
  return [...paths]
    .filter(([, entries]) => entries.length > 1)
    .map(([path, entries]) => ({
      path,
      jobs: entries.map((e) => e.job),
      conflicting: new Set(entries.map((e) => e.content)).size > 1,
    }))
}

/** Application promises schedule work; Jig's exact slots and root budget bound it. */
export async function repairBatch(run: RunContext): Promise<RunResult> {
  return withUserUpdates(run, 'progress', (updates) => repairBatchWithProgress(run, updates))
}

async function repairBatchWithProgress(run: RunContext, updates: UserUpdates): Promise<RunResult> {
  const { source, deliverables } = run.attachments
  if (source?.access !== 'read' || deliverables?.access !== 'read-write')
    throw new TypeError('Supply source and deliverables attachments.')
  const jobs = batchJobs(run.input)
  // Validate and capture every job before starting any paid work.
  const prepared = []
  for (const job of jobs)
    prepared.push({
      job,
      input: await readRepairInput(
        { issue: job.issue, editPaths: job.editPaths },
        join(source.path, job.directory),
        await loadChecks(job.checks, import.meta.dir),
      ),
    })
  const changes: { job: string; path: string; content: string }[] = []
  const retained: Record<string, JsonValue> = Object.create(null)
  const retainedFiles: Record<string, string> = Object.create(null)
  let sequence = 0
  let saves = Promise.resolve()
  // Job IDs are unique for this Run. Child callbacks are joined before the
  // parent clears their slots; attempts are labels, never completed-work counts.
  const publishPhase = (
    jobId: string,
    phase: 'selecting' | 'invoking' | 'baseline' | 'proposal' | 'check' | 'finished',
    attempt: number,
    extra: { method?: 'p1' | 'p2' } = {},
  ) => {
    run.signal.throwIfAborted()
    updates.activity(
      `job:${jobId}`,
      `${jobId}: ${phase}${attempt ? ` attempt ${attempt}` : ''}${extra.method ? ` (${extra.method})` : ''}`,
    )
  }
  const invokeRepair = async (
    jobId: string,
    method: (typeof methods)[number],
    input: RepairInput,
    selected: AbortSignal,
  ): Promise<RunResult> => {
    if (run.channels.progress === undefined)
      return run.call(
        { operationId: `repair:${jobId}`, slot: method.slot, input },
        { signal: selected },
      )

    const pair = await run.channel({ schema: repairProgressSchema })
    let observing = true
    const forwarding = (async () => {
      try {
        for await (const value of pair.receive) {
          if (!observing) break
          if (
            value === null ||
            typeof value !== 'object' ||
            Array.isArray(value) ||
            typeof value.phase !== 'string' ||
            !['baseline', 'proposal', 'check', 'finished'].includes(value.phase) ||
            typeof value.attempt !== 'number' ||
            !Number.isSafeInteger(value.attempt) ||
            value.attempt < 0 ||
            value.attempt > 2 ||
            Object.keys(value).some((key) => key !== 'phase' && key !== 'attempt')
          ) {
            updates.notice(`${jobId}: child activity unavailable (contract violation).`)
            break
          }
          publishPhase(
            jobId,
            value.phase as 'baseline' | 'proposal' | 'check' | 'finished',
            value.attempt,
            {
              method: method.id,
            },
          )
        }
      } catch (error) {
        run.signal.throwIfAborted()
        if (
          !(error instanceof OperationError) ||
          !['LAGGED', 'DISCONNECTED', 'OWNER_CLOSED', 'INVALID_INPUT'].includes(error.code)
        )
          throw error
        updates.notice(`${jobId}: child activity observation ended (${error.code}).`)
      } finally {
        observing = false
        updates.clear(`job:${jobId}`)
      }
    })()
    // The child may still be working when its observation fails. Keep the
    // original rejection owned until the call and reader are both joined.
    void forwarding.catch(() => undefined)
    try {
      const result = await run.call(
        {
          operationId: `repair:${jobId}`,
          slot: method.slot,
          input,
          channels: { progress: pair.send },
        },
        { signal: selected },
      )
      await forwarding
      return result
    } catch (error) {
      observing = false
      try {
        await pair.receive.close()
      } catch (closeError) {
        run.signal.throwIfAborted()
        if (
          !(closeError instanceof OperationError) ||
          !['LAGGED', 'DISCONNECTED', 'OWNER_CLOSED'].includes(closeError.code)
        ) {
          console.error('Child activity cleanup also failed; the repair failure remains primary.')
        }
      }
      await forwarding.catch((observationError) => {
        if (observationError !== error)
          console.error('Child activity also failed; the repair failure remains primary.')
      })
      throw error
    }
  }
  const workers = prepared
    .map(async ({ job, input }) => {
      const routingInput = { task: input.issue, candidates }
      const routing: Record<string, JsonValue> = job.method
        ? { mode: 'explicit', candidateId: job.method }
        : { mode: 'automatic', input: routingInput }
      const captured = {
        id: job.id,
        directory: job.directory,
        baseDigest: identity(input.files),
        acceptanceDigest: identity(input.cases),
        routing,
      }
      const selected = new AbortController()
      const timer =
        job.cancelAfterMs === undefined
          ? undefined
          : setTimeout(() => selected.abort(), job.cancelAfterMs)
      let result: RunResult
      let stage = job.method === undefined ? 'routing' : 'repair'
      try {
        run.signal.throwIfAborted()
        let candidateId = job.method
        if (candidateId === undefined) {
          publishPhase(job.id, 'selecting', 0)
          const decision = await run.call(
            { operationId: `route:${job.id}`, slot: 'router', input: routingInput },
            { signal: selected.signal },
          )
          run.signal.throwIfAborted()
          // A replacement router has no more authority than the ordinary router.
          let route: ReturnType<typeof checkRoutingResult>
          try {
            route = checkRoutingResult(decision, candidates)
          } catch {
            throw new OperationError('INVALID_RESULT', 'Router returned an invalid decision.')
          }
          routing.result = route
          if (route.outcome !== 'done' || route.output.candidateId === null) {
            return { ...captured, status: 'unrouted' }
          }
          candidateId = route.output.candidateId
        }
        const method = methods.find((candidate) => candidate.id === candidateId)
        if (!method)
          throw new OperationError('INVALID_RESULT', 'The selected method has no reviewed slot.')
        routing.slot = method.slot
        // Do not reset the job budget after routing, including between calls.
        if (selected.signal.aborted)
          throw new OperationError('CANCELLED', 'The routing and repair interval expired.')
        publishPhase(job.id, 'invoking', 0, { method: method.id })
        stage = 'repair'
        result = await invokeRepair(job.id, method, input, selected.signal)
      } catch (error) {
        run.signal.throwIfAborted()
        // Preserve settled failure, not an invented candidate or verdict.
        const value = error as { code?: string; message?: string; details?: JsonValue }
        return {
          ...captured,
          status: 'failed',
          stage,
          code: value.code ?? 'EXECUTION_FAILED',
          message: value.message ?? 'Routing or repair failed.',
          ...(value.details === undefined ? {} : { details: value.details }),
        }
      } finally {
        clearTimeout(timer)
      }
      run.signal.throwIfAborted()
      let checked: ReturnType<typeof inspect>
      try {
        checked = inspect(input, result)
      } catch (error) {
        return {
          ...captured,
          status: 'failed',
          stage: 'validation',
          code: 'INVALID_RESULT',
          message: error instanceof Error ? error.message : 'Invalid worker evidence.',
          rejectedResult: result,
        }
      }
      const output = join(deliverables.path, job.id)
      await mkdir(output)
      await writeRepairDeliverables(output, input, result)
      for (const [path, text] of Object.entries(repairDeliverables(input, result)))
        retainedFiles[`${job.id}/${path}`] = text
      if (checked.ready) {
        const attempt = (result.output as any).attempts.at(-1)
        for (const file of attempt.proposal.replacements)
          changes.push({
            job: job.id,
            path: `${job.directory}/${file.path}`,
            content: file.content,
          })
      }
      return {
        ...captured,
        status: 'settled',
        ready: checked.ready,
        result,
      }
    })
    .map((worker) =>
      worker.then(async (result) => {
        // Serialize complete aggregates; Jig does not choose application ordering.
        const saving = saves.then(async () => {
          run.signal.throwIfAborted()
          retained[result.id] = result as unknown as JsonValue
          const settled = jobs.filter((j) => Object.hasOwn(retained, j.id))
          const pending = jobs.filter((j) => !Object.hasOwn(retained, j.id)).map((j) => j.id)
          const files: Record<string, string> = Object.create(null)
          for (const job of settled)
            for (const [path, text] of Object.entries(retainedFiles))
              if (path.startsWith(`${job.id}/`)) files[path] = text
          files['summary.txt'] =
            settled
              .map((j) => {
                return summary(retained[j.id]!)
              })
              .join('\n') +
            `\nPending: ${pending.join(', ') || 'none'}\nPatches were checked separately. Review before applying.\n`
          await run.call({
            operationId: `checkpoint:${++sequence}`,
            slot: 'checkpoint',
            input: {
              sequence,
              evidence: {
                jobs: settled.map((j) => retained[j.id]!),
                pending,
                overlaps: patchConflicts(changes.filter((c) => Object.hasOwn(retained, c.job))),
              },
              files,
            },
          })
          updates.clear(`job:${result.id}`)
          updates.notice(
            `${result.id}: checkpoint retained; ${'ready' in result && result.ready ? 'review-ready' : result.status === 'unrouted' ? 'unrouted' : 'unsuccessful'}.`,
          )
          updates.activity('batch', 'Retaining settled job evidence', {
            completed: settled.length,
            total: jobs.length,
            unit: 'jobs',
          })
        })
        saves = saving
        await saving
        return result
      }),
    )
  // Every child producer settles before the publisher scope drains, including
  // when one checkpoint fails while another job is still running.
  const settledWorkers = await Promise.allSettled(workers)
  const failure = settledWorkers.find((result) => result.status === 'rejected')
  if (failure?.status === 'rejected') throw failure.reason
  const results = settledWorkers.map((result) => {
    if (result.status !== 'fulfilled') throw new Error('Unsettled factory worker')
    return result.value
  })
  run.signal.throwIfAborted()
  updates.clear('batch')
  const overlaps = patchConflicts(changes)
  const ready =
    results.every((r) => 'ready' in r && r.ready) && !overlaps.some((o) => o.conflicting)
  await writeFile(
    join(deliverables.path, 'summary.txt'),
    results.map((r) => summary(r as unknown as JsonValue)).join('\n') +
      '\nPatches were checked separately, not as a combined change. Review before applying.\n' +
      overlaps
        .map((o) => `${o.conflicting ? 'CONFLICT' : 'OVERLAP'} ${o.path}: ${o.jobs.join(', ')}`)
        .join('\n'),
    { flag: 'wx' },
  )
  return { outcome: ready ? 'done' : 'blocked', output: { jobs: results, overlaps } as JsonValue }
}

function summary(value: JsonValue): string {
  const job = value as unknown as {
    id: string
    status: 'failed' | 'unrouted' | 'settled'
    stage: string
    ready?: boolean
    code?: string
    message?: string
    details?: JsonValue
    result?: RunResult
    routing: {
      mode: 'explicit' | 'automatic'
      slot?: string
      result?: { outcome: string; output: { candidateId?: string | null; reason: string } }
    }
  }
  const route = job.routing.result
  const selection =
    job.routing.slot ?? (route?.outcome === 'done' ? 'abstained' : (route?.outcome ?? 'failed'))
  const mode = job.routing.mode === 'explicit' ? 'explicit' : 'automatic'
  const lines = [
    `${job.id}: ${job.ready ? 'review-ready' : 'unsuccessful'}; routing (${mode}): ${selection}`,
  ]
  if (route) lines.push(`  Reported routing reason: ${reportedText(route.output.reason)}`)
  if (job.status === 'failed') {
    lines.push(
      `  Failed stage: ${job.stage}; code: ${reportedText(job.code ?? 'EXECUTION_FAILED')}`,
      `  Reported cause: ${reportedText(job.message ?? 'No public cause was supplied.')}`,
      `  Evidence: result.json${job.details === undefined ? '' : ' (includes retained failure details)'}; no verified patch for this job.`,
      `  Next step: ${
        job.code === 'UNCERTAIN'
          ? 'Inspect retained evidence and confirm settlement before choosing a new Run.'
          : job.stage === 'validation'
            ? 'Inspect the rejected worker result; correct the worker or Binding and review before a new Run.'
            : 'Inspect the reported cause and selected Agent setup. Review configuration changes before choosing a new Run.'
      }`,
    )
  } else if (job.status === 'unrouted') {
    lines.push(
      '  Evidence: result.json contains the routing decision; no repair was dispatched.',
      '  Next step: inspect that decision; clarify the issue or select a reviewed method explicitly for a new Run.',
    )
  } else {
    const evidence = job.result!.output as { reason: string; attempts: { proposal?: unknown }[] }
    const proposals = evidence.attempts.flatMap((attempt, index) =>
      attempt.proposal === undefined ? [] : [`${job.id}/proposal-${index + 1}.patch`],
    )
    lines.push(
      `  Acceptance: ${job.result!.outcome}`,
      `  Reported reason: ${reportedText(evidence.reason)}`,
      `  Evidence: result.json; ${proposals.join(', ') || 'no validated proposals'}${job.ready ? `; ${job.id}/review.patch` : ''}.`,
      `  Next step: ${job.ready ? 'Review the patch and command evidence before applying it.' : 'Inspect the checks and proposal evidence; do not apply an unaccepted proposal.'}`,
    )
  }
  return lines.join('\n')
}
