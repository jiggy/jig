import { handle } from '@jigging/flow'
import { withUserUpdates } from '@jigging/user-updates'
import { repair } from './repair.ts'

await handle((run) =>
  withUserUpdates(run, 'updates', async (updates) => {
    try {
      return await repair(run, updates)
    } catch (error) {
      updates.notice(
        'Repair checks failed to complete. No passing patch is established; inspect the final diagnostic.',
        'error',
      )
      throw error
    } finally {
      updates.clear('repair')
    }
  }),
)
