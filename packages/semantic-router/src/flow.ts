import { handle, OperationError, type RunContext, type RunResult } from '@jigging/flow'
import { withReporting } from '@jigging/reporting'
import { selectionView, selectionViewOptions } from './dashboard.js'
import { routingInput } from './decision.js'
import { route } from './route.js'

export async function routerFlow(run: RunContext): Promise<RunResult> {
  let input
  try {
    input = routingInput(run.input)
  } catch (error) {
    throw new OperationError('INVALID_INPUT', (error as Error).message)
  }
  return withReporting(run, 'progress', async (updates) => {
    const view = updates.view('selection', selectionViewOptions(input))
    view.update(selectionView(input))
    if (input.candidates.length) updates.activity('selection', 'Judging candidate applicability')
    try {
      const result = await route(run)
      if (result.outcome !== 'done') {
        const cause = (result.output as { reason: string }).reason
        updates.notice(
          `Candidate selection ${result.outcome}: ${[...cause].slice(0, 512).join('')}${[...cause].length > 512 ? ' [excerpt; full cause in the result]' : ''}`,
          'error',
        )
      }
      view.update(selectionView(input, result))
      return result
    } catch (error) {
      updates.notice('Candidate selection failed. Inspect the final diagnostic.', 'error')
      throw error
    } finally {
      updates.clear('selection')
    }
  })
}

export async function runRouterFlow(): Promise<void> {
  await handle(routerFlow)
}
