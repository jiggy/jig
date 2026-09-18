import { OperationError, type JsonValue, type RunContext, type RunResult } from '@jigging/flow'

/** Two independent branches; no event race chooses a successor or grants power. */
export async function brief(run: RunContext): Promise<RunResult> {
  const revisions = await run.channel({ contract: './contracts/revisions.json' })
  const results = await Promise.all(
    ['draft', 'independent'].map(async (role) => {
      try {
        const result = await run.call({
          operationId: role,
          slot: 'worker',
          input: { role, context: run.input },
          channels:
            role === 'draft' ? { revisions: revisions.receive } : { updates: revisions.send },
        })
        console.log(`${role}: ${result.outcome}`)
        return { role, result }
      } catch (error) {
        return { role, failure: error instanceof OperationError ? error.code : 'EXECUTION_FAILED' }
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
            : { role: record.role, failure: record.failure },
      ),
      purpose:
        'Internal suggestions for human review, not verified facts or permission to publish.',
    },
  }
}
