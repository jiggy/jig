import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { type JsonValue, OperationError, type RunContext, type RunResult } from '@jigging/flow'
import { checkRoutingResult } from 'semantic-router-flow/decision'
import { checkName, loadChecks } from './checks.ts'
import {
  identity,
  inspect,
  readRepairInput,
  repairDeliverables,
  writeRepairDeliverables,
} from './files.ts'
import { candidates, methods } from './methods.ts'

interface Job {
  id: string
  directory: string
  checks: string
  issue: string
  editPaths: string[]
  method?: 'single-pass' | 'checked-correction' | 'auto'
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
      job?.method !== undefined &&
      job.method !== 'auto' &&
      !methods.some((method) => method.slot === job.method)
    )
      throw new TypeError('Choose single-pass, checked-correction, or auto for method.')
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
      (job.cancelAfterMs !== undefined &&
        (!Number.isSafeInteger(job.cancelAfterMs) ||
          job.cancelAfterMs < 1 ||
          job.cancelAfterMs > 300_000))
    )
      throw new TypeError(
        'Each job needs a unique id, a relative project directory, and a known check set; optional cancellation is 1–300,000 ms.',
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
  const results = await Promise.all(
    prepared
      .map(async ({ job, input }) => {
        const selection: Record<string, JsonValue> = {
          source:
            job.method === undefined ? 'default' : job.method === 'auto' ? 'auto' : 'explicit',
        }
        const captured = {
          id: job.id,
          directory: job.directory,
          baseDigest: identity(input.files),
          acceptanceDigest: identity(input.cases),
          selection,
        }
        const selected = new AbortController()
        const timer =
          job.cancelAfterMs === undefined
            ? undefined
            : setTimeout(() => selected.abort(), job.cancelAfterMs)
        let result: RunResult
        try {
          run.signal.throwIfAborted()
          let method = methods.find(
            (candidate) => candidate.slot === (job.method ?? 'checked-correction'),
          )
          if (job.method === 'auto') {
            const routingInput = { task: input.issue, candidates }
            const routing: Record<string, JsonValue> = { input: routingInput }
            selection.routing = routing
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
            if (route.outcome !== 'done' || route.output.candidateId === null)
              return { ...captured, status: 'unrouted' }
            method = methods.find((candidate) => candidate.id === route.output.candidateId)
          }
          if (!method)
            throw new OperationError('INVALID_RESULT', 'The selected method has no reviewed slot.')
          selection.method = method.slot
          // Do not reset the job budget after routing, including between calls.
          if (selected.signal.aborted)
            throw new OperationError('CANCELLED', 'The job interval expired.')
          result = await run.call(
            { operationId: `repair:${job.id}`, slot: method.slot, input },
            { signal: selected.signal },
          )
        } catch (error) {
          run.signal.throwIfAborted()
          // Preserve settled failure, not an invented candidate or verdict.
          const value = error as { code?: string; message?: string; details?: JsonValue }
          return {
            ...captured,
            status: 'failed',
            code: value.code ?? 'EXECUTION_FAILED',
            message: value.message ?? 'Selection or repair failed.',
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
              operationId: `progress:${++sequence}`,
              slot: 'progress',
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
          })
          saves = saving
          await saving
          return result
        }),
      ),
  )
  run.signal.throwIfAborted()
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
    ready?: boolean
    code?: string
    selection: {
      source: string
      method?: string
      routing?: {
        result?: { outcome: string; output: { candidateId?: string | null; reason: string } }
      }
    }
  }
  const route = job.selection.routing?.result
  const chosen =
    job.selection.method ?? (route?.outcome === 'done' ? 'abstained' : (route?.outcome ?? 'failed'))
  return `${job.id}: ${job.ready ? 'review-ready' : 'unsuccessful'}; selection: ${job.selection.source} → ${chosen}${job.code ? `; ${job.code}` : ''}${route ? `; ${route.output.reason.replace(/[\r\n]+/g, ' ')}` : ''}`
}
