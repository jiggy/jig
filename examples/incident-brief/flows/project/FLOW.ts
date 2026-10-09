import { handle } from '@jigging/flow'
import { withUserUpdates } from '@jigging/user-updates'
import { brief } from './brief.ts'

await handle((run) =>
  withUserUpdates(run, 'progress', async (updates) => {
    try {
      return await brief(run, updates)
    } catch (error) {
      updates.notice(
        'Incident briefing failed. Inspect the final diagnostic and retained branch results.',
        'error',
      )
      throw error
    } finally {
      updates.clear('draft')
      updates.clear('independent')
    }
  }),
)
