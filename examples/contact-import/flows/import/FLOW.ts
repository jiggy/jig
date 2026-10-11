import { handle } from '@jigging/flow'
import { withReporting } from '@jigging/reporting'
import { runMethod } from './method.ts'

await handle((run) =>
  withReporting(run, 'progress', async (updates) => {
    try {
      return await runMethod(run, updates)
    } catch (error) {
      updates.notice(
        'Contact preview failed. No contacts were imported; inspect the final diagnostic.',
        'error',
      )
      throw error
    } finally {
      updates.clear('import')
    }
  }),
)
