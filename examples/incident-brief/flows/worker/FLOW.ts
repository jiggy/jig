import { handle } from '@jigging/flow'
import { withUserUpdates } from '@jigging/user-updates'
import { work } from './work.ts'

await handle((run) =>
  withUserUpdates(run, 'progress', async (updates) => {
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
