import { handle } from '@jigging/flow'
import { withUserUpdates } from '@jigging/user-updates'
import { caseView, chargesView } from './dashboard.ts'
import { resolve } from './resolve.ts'

await handle((run) =>
  withUserUpdates(run, 'progress', async (updates) => {
    const input = run.input as unknown as Parameters<typeof caseView>[0]
    const view = updates.view('case', { title: 'Case', landing: true })
    const charges = updates.view('charges', { title: 'Charges' })
    view.update(caseView(input, false))
    charges.update(chargesView(input))
    updates.activity('assessment', 'Interpreting the disputed charge')
    try {
      const result = await resolve(run)
      if (result.outcome !== 'done') {
        const cause =
          (result.output as { reason?: string } | undefined)?.reason ?? 'No reason supplied.'
        updates.notice(
          `Assessment ${result.outcome}: ${[...cause].slice(0, 512).join('')}${[...cause].length > 512 ? ' [excerpt; full cause in the result]' : ''}`,
          'error',
        )
      }
      view.update(caseView(input, false, result))
      return result
    } catch (error) {
      updates.notice(
        'Case handling failed. No credit has been issued; inspect the final diagnostic.',
        'error',
      )
      throw error
    } finally {
      updates.clear('assessment')
    }
  }),
)
