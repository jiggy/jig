import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { JsonValue, RunContext, RunResult } from '@jigging/flow'
import logs from './cases.json'
import {
  identity,
  inspect,
  readRepairInput,
  repairDeliverables,
  writeRepairDeliverables,
} from './files.ts'
import timesheet from './timesheet-cases.json'

const checks = { logs, timesheet }
interface Job {
  id: string
  directory: string
  checks: keyof typeof checks
  issue: string
  editPaths: string[]
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
        (k) => !['id', 'directory', 'checks', 'issue', 'editPaths', 'cancelAfterMs'].includes(k),
      ) ||
      typeof job.id !== 'string' ||
      !/^[a-z][a-z0-9-]{0,31}$/.test(job.id) ||
      typeof job.directory !== 'string' ||
      job.directory.length > 256 ||
      !/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(job.directory) ||
      job.directory.split('/').length > 16 ||
      !Object.hasOwn(checks, job.checks) ||
      (job.cancelAfterMs !== undefined &&
        (!Number.isSafeInteger(job.cancelAfterMs) ||
          job.cancelAfterMs < 1 ||
          job.cancelAfterMs > 300_000))
    )
      throw new TypeError(
        'Each job needs a unique id, a relative project directory, and a known check set; optional cancellation is 1–300,000 ms.',
      )
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
        checks[job.checks],
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
        const captured = {
          id: job.id,
          directory: job.directory,
          baseDigest: identity(input.files),
          acceptanceDigest: identity(input.cases),
        }
        const selected = new AbortController()
        const timer =
          job.cancelAfterMs === undefined
            ? undefined
            : setTimeout(() => selected.abort(), job.cancelAfterMs)
        let result: RunResult
        try {
          result = await run.runChildFlow(
            { operationId: `repair:${job.id}`, slot: 'repair', input },
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
            message: value.message ?? 'Worker failed.',
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
                  const value = retained[j.id] as { ready?: boolean }
                  return `${j.id}: ${value.ready ? 'review-ready' : 'unsuccessful'}`
                })
                .join('\n') +
              `\nPending: ${pending.join(', ') || 'none'}\nPatches were checked separately. Review before applying.\n`
            await run.callCapability({
              operationId: `progress:${++sequence}`,
              slot: 'progress',
              method: 'save',
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
    results
      .map((r) => `${r.id}: ${'ready' in r && r.ready ? 'review-ready' : 'unsuccessful'}`)
      .join('\n') +
      '\nPatches were checked separately, not as a combined change. Review before applying.\n' +
      overlaps
        .map((o) => `${o.conflicting ? 'CONFLICT' : 'OVERLAP'} ${o.path}: ${o.jobs.join(', ')}`)
        .join('\n'),
    { flag: 'wx' },
  )
  return { outcome: ready ? 'done' : 'blocked', output: { jobs: results, overlaps } as JsonValue }
}
