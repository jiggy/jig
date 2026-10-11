import { handle } from '@jigging/flow'
import { withReporting } from '@jigging/reporting'
import { work } from './work.ts'

await handle((run) =>
  withReporting(run, 'progress', async (updates) => {
    try {
      return await work(run, undefined, updates)
    } catch (error) {
      updates.notice(
        'Incident worker failed. Inspect the final diagnostic; no retry was requested.',
        'error',
      )
      throw error
    } finally {
      updates.clear('worker')
    }
  }),
)
