import { type JsonValue, OperationError, type RunContext, type RunResult } from '@jigging/flow'
import type { UserUpdates } from '@jigging/user-updates'
import { answerView, type Branch, workView } from './dashboard.ts'

/** Two independent branches; no event race chooses a successor or grants power. */
export async function brief(run: RunContext, updates?: UserUpdates): Promise<RunResult> {
  const { replacement, ...context } = run.input as Record<string, JsonValue>
  const work = updates?.view('work', { title: 'Work', landing: true })
  const draft = updates?.view('brief', { title: 'Brief' })
  const questions = updates?.view('questions', { title: 'Review questions' })
  const settled: Branch[] = []
  work?.update(workView(run.input as Record<string, unknown>))
  draft?.update(answerView(undefined, true))
  questions?.update(answerView(undefined, false))
  const retain = (record: Branch) => {
    settled.push(record)
    if (record.failure || record.result?.outcome !== 'done') {
      const output = record.result?.output as { failureDetails?: { message: string }[] } | undefined
      const cause =
        record.message ?? output?.failureDetails?.[0]?.message ?? 'No further cause was retained.'
      updates?.notice(
        `${record.role === 'draft' ? 'Drafting' : 'Independent review'} could not complete: ${[...cause].slice(0, 512).join('')}${[...cause].length > 512 ? ' [excerpt; full cause in the result]' : ''}`,
        'error',
      )
    }
    work?.update(workView(run.input as Record<string, unknown>, settled))
    ;(record.role === 'draft' ? draft : questions)?.update(
      answerView(record, record.role === 'draft'),
    )
    return record
  }
  const revisions = await run.channel({ contract: './contracts/revisions.json' })
  const results = await Promise.all(
    ['draft', 'independent'].map(async (role) => {
      updates?.activity(
        role,
        role === 'draft'
          ? 'Drafting the internal incident brief'
          : 'Investigating independent review questions',
      )
      try {
        const result = await run.call({
          operationId: role,
          slot: 'worker',
          intent:
            role === 'draft'
              ? 'Prepare the internal incident brief'
              : 'Prepare independent review questions',
          input: {
            role,
            context,
            ...(role === 'independent' && replacement !== undefined ? { replacement } : {}),
          },
          channels:
            role === 'draft' ? { revisions: revisions.receive } : { updates: revisions.send },
        })
        return retain({ role, result })
      } catch (error) {
        return retain({
          role,
          failure: error instanceof OperationError ? error.code : 'EXECUTION_FAILED',
          message:
            error instanceof OperationError
              ? [...error.message].slice(0, 1024).join('')
              : 'The worker did not complete; no further cause was retained.',
        })
      } finally {
        updates?.clear(role)
      }
    }),
  )
  run.signal.throwIfAborted()
  return {
    outcome: results.every((record) => record.result?.outcome === 'done') ? 'done' : 'blocked',
    output: {
      results: results.map(
        (record): JsonValue =>
          record.result
            ? { role: record.role, result: { ...record.result } }
            : { role: record.role, failure: record.failure, message: record.message },
      ),
      purpose:
        'Internal suggestions for human review, not verified facts or permission to publish.',
    },
  }
}
