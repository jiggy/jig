import { handle } from '@jigging/flow'
import { withReporting } from '@jigging/reporting'
import { runMethod } from './method.ts'

await handle((run) =>
  withReporting(run, 'progress', async (updates) => {
    try {
      return await runMethod(run, updates)
    } catch (error) {
      updates.notice('The kitchen step did not complete; inspect the final cause.', 'error')
      throw error
    } finally {
      updates.clear('export-roster')
    }
  }),
)
