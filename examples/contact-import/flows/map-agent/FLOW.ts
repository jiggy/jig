import { handle } from '@jigging/flow'
import { withUserUpdates } from '@jigging/user-updates'
import { columnsView } from './dashboard.ts'
import { runMethod } from './method.ts'

await handle((run) =>
  withUserUpdates(run, 'progress', async (updates) => {
    const { headers } = run.input as { headers: string[] }
    const approach =
      'One operator-selected Agent interprets the supplied headings. Missing or ambiguous fields require abstention.'
    const view = updates.view('columns', { title: 'Columns', landing: true })
    view.update(columnsView(headers, approach))
    updates.activity('mapping', 'Choosing contact columns')
    try {
      const result = await runMethod(run)
      if (result.outcome !== 'done') {
        const cause =
          (result.output as { reason?: string } | undefined)?.reason ?? 'No reason supplied.'
        updates.notice(
          `Column proposal ${result.outcome}: ${[...cause].slice(0, 512).join('')}${[...cause].length > 512 ? ' [excerpt; full cause in the result]' : ''}`,
          'error',
        )
      }
      view.update(columnsView(headers, approach, result))
      return result
    } catch (error) {
      updates.notice('Column proposal failed. Inspect the final diagnostic.', 'error')
      throw error
    } finally {
      updates.clear('mapping')
    }
  }),
)
