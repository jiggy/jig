import { handle } from '@jigging/flow'
import { withUserUpdates } from '@jigging/user-updates'
import { runMethod } from './method.ts'

await handle((run) =>
  withUserUpdates(run, 'progress', async (updates) => {
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
