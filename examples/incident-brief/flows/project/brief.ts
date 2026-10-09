import { type JsonValue, OperationError, type RunContext, type RunResult } from '@jigging/flow'
import type { UserUpdates } from '@jigging/user-updates'
import { answerView, type Branch, workView } from './dashboard.ts'

/** Short human answers sit beside, never replace, the exact branch evidence. */
function answerExcerpt(branches: readonly Branch[], role: string, field: string): string {
  const output = branches.find((branch) => branch.role === role)?.result?.output
  const answer =
    output !== null && typeof output === 'object' && !Array.isArray(output)
      ? output[field]
      : undefined
  if (typeof answer !== 'string' || !answer)
    return 'No complete suggestion returned. See the retained branch outcome and failure evidence.'
  if (JSON.stringify(answer).length <= 800) return answer
  const suffix = '\n[Excerpt; complete answer retained in nested evidence.]'
  let text = ''
  for (const character of answer) {
    if (JSON.stringify(text + character + suffix).length > 800) break
    text += character
  }
  return text + suffix
}

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
        undefined,
        { operationId: role },
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
      brief: answerExcerpt(results, 'draft', 'brief'),
      questions: answerExcerpt(results, 'independent', 'questions'),
      purpose:
        'Internal suggestions for human review, not verified facts or permission to publish.',
      results: results.map(
        (record): JsonValue =>
          record.result
            ? { role: record.role, result: { ...record.result } }
            : { role: record.role, failure: record.failure, message: record.message },
      ),
    },
  }
}
