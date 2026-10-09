import { handle } from '@jigging/flow'
import { withUserUpdates } from '@jigging/user-updates'
import { triageView } from './dashboard.ts'
import { triage } from './triage.ts'

await handle((run) =>
  withUserUpdates(run, 'progress', async (updates) => {
    const { message } = run.input as { message: string }
    const approach =
      'The reviewed classifier Binding chooses code, Agent interpretation, or both. This caller uses the same contract for each choice.'
    const view = updates.view('request', { title: 'Request', landing: true })
    view.update(triageView(message, approach))
    updates.activity('classifying', 'Choosing a support queue')
    try {
      const result = await triage(run)
      if (result.outcome !== 'done') {
        const cause =
          (result.output as { reason?: string } | undefined)?.reason ?? 'No reason supplied.'
        updates.notice(
          `Classification ${result.outcome}: ${[...cause].slice(0, 512).join('')}${[...cause].length > 512 ? ' [excerpt; full cause in the result]' : ''}`,
          'error',
        )
      }
      view.update(triageView(message, approach, result))
      return result
    } catch (error) {
      updates.notice(
        'Classification failed. Inspect the final diagnostic before trying again.',
        'error',
      )
      throw error
    } finally {
      updates.clear('classifying')
    }
  }),
)
