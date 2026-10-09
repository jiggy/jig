import { handle } from '@jigging/flow'
import { withUserUpdates } from '@jigging/user-updates'
import { selectionView } from './dashboard.ts'
import { routingInput } from './decision.ts'
import { route } from './route.ts'

await handle((run) =>
  withUserUpdates(run, 'progress', async (updates) => {
    const input = routingInput(run.input)
    const view = updates.view('selection', { title: 'Selection', landing: true })
    view.update(selectionView(input))
    if (input.candidates.length) updates.activity('selection', 'Judging candidate applicability')
    try {
      const result = await route(run)
      if (result.outcome !== 'done') {
        const cause =
          (result.output as { reason?: string } | undefined)?.reason ?? 'No reason supplied.'
        updates.notice(
          `Candidate selection ${result.outcome}: ${[...cause].slice(0, 512).join('')}${[...cause].length > 512 ? ' [excerpt; full cause in the result]' : ''}`,
          'error',
        )
      }
      view.update(selectionView(input, result))
      return result
    } catch (error) {
      updates.notice(
        'Candidate selection failed. No fallback was dispatched; inspect the final diagnostic.',
        'error',
      )
      throw error
    } finally {
      updates.clear('selection')
    }
  }),
)
